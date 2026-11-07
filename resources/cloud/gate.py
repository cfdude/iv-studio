"""IV Studio cloud gate: the only way in to a cloud ComfyUI.

A public cloud address would otherwise give anyone who found it a free GPU and every file on it, so
this sits in front of ComfyUI (127.0.0.1:8188) on port 8189 and lets a request through only with the
token IV Studio created: an `Authorization: Bearer <token>` header, or `?iv_token=` for the few
requests that can't carry headers. HTTP (with Range, so videos seek) and ComfyUI's websocket are both
proxied. While ComfyUI is still starting, requests get 503 so IV Studio can show "warming up".

On RunPod (IV_PLATFORM=runpod, see runpod_boot.py) the gate does three more things, because a RunPod
pod neither stops by itself nor has a volume IV Studio can write to directly:
  /iv/health   also reports the boot stage (installing, downloading models, ready) from /tmp/iv-status.json
  /iv/upload   takes a character LoRA or RefMod in chunks (RunPod's proxy refuses bodies over 100 MB)
               into /workspace/models, checked against its SHA-256 before it is kept
  idle         with nothing to do for IV_IDLE_SECONDS the pod deletes itself, so the GPU stops billing;
               ComfyUI, the models and every render stay on the network volume
"""
import asyncio
import hashlib
import hmac
import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path

import aiohttp
from aiohttp import WSMsgType, web

TOKEN = os.environ.get("IV_TOKEN", "")
if not TOKEN:
    raise SystemExit("IV_TOKEN is empty: the gate will not start without a token.")
UPSTREAM = os.environ.get("IV_UPSTREAM", "http://127.0.0.1:8188")  # settable for tests
HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length", "content-encoding"}
RUNPOD = os.environ.get("IV_PLATFORM") == "runpod"
STATUS = Path(os.environ.get("IV_STATUS_FILE", "/tmp/iv-status.json"))
MODELS = Path(os.environ.get("IV_MODELS_DIR", "/workspace/models"))
UPLOAD_FOLDERS = ("loras/", "refmods/")
IDLE = int(os.environ.get("IV_IDLE_SECONDS", "300"))
SETUP_LIMIT = int(os.environ.get("IV_SETUP_LIMIT", str(3 * 3600)))  # a stuck install still ends
last_seen = time.time()
started = time.time()


def allowed(req):
    if not TOKEN:
        return False
    bearer = req.headers.get("Authorization", "")
    given = bearer[7:] if bearer.startswith("Bearer ") else req.query.get("iv_token", "")
    return hmac.compare_digest(given.encode(), TOKEN.encode())


def upstream_url(req):
    query = [(k, v) for k, v in req.query.items() if k != "iv_token"]
    return UPSTREAM + req.path, query


def stage():
    try:
        return json.loads(STATUS.read_text())
    except (OSError, ValueError):
        return {}


async def proxy_ws(req, session):
    url, query = upstream_url(req)
    client = web.WebSocketResponse(max_msg_size=0)
    await client.prepare(req)
    async with session.ws_connect(url.replace("http", "ws", 1), params=query, max_msg_size=0) as upstream:

        async def pump(src, dst):
            async for msg in src:
                if msg.type == WSMsgType.TEXT:
                    await dst.send_str(msg.data)
                elif msg.type == WSMsgType.BINARY:
                    await dst.send_bytes(msg.data)
                else:
                    break

        await asyncio.wait([asyncio.create_task(pump(client, upstream)), asyncio.create_task(pump(upstream, client))], return_when=asyncio.FIRST_COMPLETED)
    return client


def upload_target(rel):
    """The file a model upload writes, or None when the path leaves the allowed model folders."""
    rel = rel.replace("\\", "/").lstrip("/")
    if not rel.startswith(UPLOAD_FOLDERS) or ".." in rel.split("/") or not rel.endswith(".safetensors"):
        return None
    return MODELS / rel


async def upload(req):
    """PUT ?path=&offset= writes one chunk; POST ?path=&sha256= checks the whole file and keeps it."""
    dest = upload_target(req.query.get("path", ""))
    if dest is None:
        return web.json_response({"error": "uploads go into loras/ or refmods/ as .safetensors"}, status=400)
    part = dest.with_name(dest.name + ".part")
    if req.method == "PUT":
        offset = int(req.query.get("offset", "0"))
        part.parent.mkdir(parents=True, exist_ok=True)
        if offset == 0:
            part.write_bytes(b"")
        elif not part.exists() or part.stat().st_size != offset:
            return web.json_response({"error": "chunk out of order", "have": part.stat().st_size if part.exists() else 0}, status=409)
        with open(part, "ab") as f:
            async for chunk in req.content.iter_chunked(1 << 20):
                f.write(chunk)
        return web.json_response({"have": part.stat().st_size})
    if not part.exists():
        return web.json_response({"error": "nothing was uploaded to that path"}, status=404)
    want = req.query.get("sha256", "").lower()
    h = hashlib.sha256()
    with open(part, "rb") as f:
        while chunk := f.read(1 << 22):
            h.update(chunk)
    if want and h.hexdigest() != want:
        part.unlink()
        return web.json_response({"error": "the upload did not match its checksum; it was removed"}, status=422)
    part.replace(dest)
    return web.json_response({"saved": dest.relative_to(MODELS).as_posix(), "sha256": h.hexdigest()})


async def handle(req):
    global last_seen
    if req.path == "/iv/health":  # says only that the gate is up, and on RunPod how far the boot got; no token needed
        return web.json_response({"gate": "ok", **({"platform": "runpod", **stage()} if RUNPOD else {})})
    if not allowed(req):
        return web.Response(status=401, text="IV Studio token required")
    last_seen = time.time()
    if RUNPOD and req.path == "/iv/upload":
        return await upload(req)
    session = req.app["session"]
    try:
        if req.headers.get("Upgrade", "").lower() == "websocket":
            return await proxy_ws(req, session)
        url, query = upstream_url(req)
        headers = {k: v for k, v in req.headers.items() if k.lower() not in HOP | {"authorization", "origin", "referer", "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"}}
        body = await req.read() if req.can_read_body else None
        async with session.request(req.method, url, params=query, headers=headers, data=body, allow_redirects=False) as up:
            resp = web.StreamResponse(status=up.status, headers={k: v for k, v in up.headers.items() if k.lower() not in HOP})
            await resp.prepare(req)
            async for chunk in up.content.iter_chunked(1 << 16):
                await resp.write(chunk)
            await resp.write_eof()
            return resp
    except aiohttp.ClientConnectorError:
        return web.Response(status=503, text="ComfyUI is starting")


def delete_self():
    """Deletes this pod with the pod's own RunPod key. Tries runpodctl, then the REST API, then GraphQL."""
    pod, key = os.environ.get("RUNPOD_POD_ID"), os.environ.get("RUNPOD_API_KEY")
    if not pod:
        return False
    print(f"[iv] idle: deleting pod {pod} so the GPU stops billing", flush=True)
    try:
        if subprocess.run(["runpodctl", "remove", "pod", pod], timeout=60).returncode == 0:
            return True
    except (OSError, subprocess.SubprocessError):
        pass
    if not key:
        return False
    attempts = [
        urllib.request.Request(f"https://api.runpod.io/v2/pods/{pod}", method="DELETE", headers={"Authorization": f"Bearer {key}"}),
        urllib.request.Request(
            f"https://api.runpod.io/graphql?api_key={key}",
            data=json.dumps({"query": f'mutation {{ podTerminate(input: {{podId: "{pod}"}}) }}'}).encode(),
            headers={"Content-Type": "application/json"},
        ),
    ]
    for r in attempts:
        try:
            with urllib.request.urlopen(r, timeout=60) as res:
                if res.status < 300:
                    return True
        except Exception as e:  # noqa: BLE001 - any failure moves on to the next way
            print(f"[iv] could not delete the pod that way: {e}", flush=True)
    return False


async def idle_watch(app):
    """RunPod only: the pod deletes itself once nothing has asked for anything for IV_IDLE_SECONDS and
    ComfyUI's queue is empty. Setup (installing, downloading models) counts as busy, up to IV_SETUP_LIMIT."""
    session = app["session"]
    while True:
        await asyncio.sleep(30)
        st = stage().get("stage")
        if st not in ("ready", "error"):
            if time.time() - started > SETUP_LIMIT:
                delete_self()
            continue
        if time.time() - last_seen < IDLE:
            continue
        try:
            async with session.get(UPSTREAM + "/queue") as r:
                q = await r.json()
            if q.get("queue_running") or q.get("queue_pending"):
                continue
        except Exception:  # noqa: BLE001 - ComfyUI down: nothing can be running
            pass
        if delete_self():
            return


async def start_session(app):
    app["session"] = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=None, sock_connect=5), auto_decompress=False)
    if RUNPOD:
        app["idle"] = asyncio.create_task(idle_watch(app))


async def close_session(app):
    await app["session"].close()


def main():
    app = web.Application(client_max_size=4 * 1024**3)
    app.router.add_route("*", "/{tail:.*}", handle)
    app.on_startup.append(start_session)
    app.on_cleanup.append(close_session)
    web.run_app(app, host="0.0.0.0", port=int(os.environ.get("IV_GATE_PORT", "8189")), access_log=None)


if __name__ == "__main__":
    main()
