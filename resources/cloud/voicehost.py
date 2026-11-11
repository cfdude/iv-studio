"""IV Studio's voice engine in the cloud: the same resources/python/voice_server.py the PC runs (VoxCPM2 speaks,
designs and clones voices; Whisper reads recordings), in its own Python environment beside ComfyUI, reached
through the gate (gate.py) with IV Studio's token.

  GET  /iv/voice            {installed, installing, setup, running}
  POST /iv/voice/setup      RunPod only: the environment (torch 2.9.1 for CUDA 12.8, voxcpm) and both models onto
                            the network volume, in the background (Modal builds the environment into its image and
                            downloads the models on a CPU function instead)
  POST /iv/voice/run        {op, text, description, seed, ref_text, ref_wav (base64), file (base64)} -> {id}
  GET  /iv/voice/job?id=    {state: running|done|error, result} (a done result carries the WAV as base64)
  POST /iv/voice/release    stops the worker, giving the GPU back

Jobs are polled, not held open: a first line loads VoxCPM2 (30-45 s) and Modal ends web requests after 150 s.
The worker stops when a render is queued on ComfyUI (the cloud's version of the PC's "one model family at a time")
and after IV_VOICE_IDLE seconds with nothing to say. Before it loads, ComfyUI is asked to unload its models when
its queue is empty.
"""
import asyncio
import base64
import json
import os
import shutil
import sys
import tempfile
import time
import uuid
from pathlib import Path

from aiohttp import web

HERE = Path(__file__).parent
PY = Path(os.environ.get("IV_VOICE_PYTHON", "/workspace/iv/voice/venv/bin/python"))
MODELS = Path(os.environ.get("IV_VOICE_MODELS", "/workspace/models/voice"))
SCRIPT = Path(os.environ.get("IV_VOICE_SCRIPT") or HERE / "voice_server.py")  # settable for tests
IDLE = int(os.environ.get("IV_VOICE_IDLE", "600"))
CAN_INSTALL = os.environ.get("IV_PLATFORM") == "runpod"


def voice_config():
    try:
        return json.loads((HERE / "cloud.json").read_text()).get("voice", {})
    except (OSError, ValueError):
        return {}


def installed():
    return PY.exists() and all((MODELS / name / ".revision").exists() for name in ("voxcpm2", "whisper"))


class VoiceHost:
    # free: async () -> None, asks ComfyUI to unload when its queue is empty (the gate supplies it)
    def __init__(self, free=None):
        self.free = free or (lambda: asyncio.sleep(0))
        self.proc = None
        self.ready = None
        self.pending = {}
        self.jobs = {}
        self.seq = 0
        self.last = time.time()
        self.setup = {"state": "idle"}
        self.starting = None

    def status(self):
        return {"installed": installed(), "installing": self.setup.get("state") == "running", "setup": self.setup, "running": self.proc is not None, "canInstall": CAN_INSTALL}

    # ---------- the worker ----------
    async def start(self):
        if self.proc and self.proc.returncode is None:
            return
        if not installed():
            raise RuntimeError("Voices aren't set up in your cloud yet: press Set up voices on the Voices page.")
        try:
            await self.free()
        except Exception:  # noqa: BLE001 - a busy or absent ComfyUI just doesn't unload
            pass
        env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1", "HF_HUB_DISABLE_TELEMETRY": "1", "HF_HUB_DISABLE_PROGRESS_BARS": "1"}
        self.proc = await asyncio.create_subprocess_exec(str(PY), "-u", str(SCRIPT), str(MODELS), stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, env=env, limit=1 << 26)
        self.ready = asyncio.get_running_loop().create_future()
        asyncio.create_task(self.read(self.proc, self.ready))
        asyncio.create_task(self.drain(self.proc))
        await asyncio.wait_for(asyncio.shield(self.ready), 600)

    async def read(self, proc, ready):
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if msg.get("ready") and not ready.done():
                ready.set_result(True)
            fut = self.pending.pop(msg.get("id"), None)
            if fut and not fut.done():
                fut.set_result(msg)
        await proc.wait()
        why = RuntimeError(f"The voice engine stopped ({proc.returncode}).")
        if not ready.done():
            ready.set_exception(why)
        for fut in self.pending.values():
            if not fut.done():
                fut.set_exception(why)
        self.pending.clear()
        if self.proc is proc:
            self.proc = None

    async def drain(self, proc):
        # the worker's library chatter (and tracebacks) go to the pod's log
        while True:
            line = await proc.stderr.readline()
            if not line:
                break
            sys.stderr.write("[voice] " + line.decode(errors="replace"))

    async def call(self, req):
        if not self.starting:
            self.starting = asyncio.ensure_future(self.start())
        try:
            await self.starting
        finally:
            self.starting = None
        self.seq += 1
        req = {**req, "id": self.seq}
        fut = asyncio.get_running_loop().create_future()
        self.pending[self.seq] = fut
        self.proc.stdin.write((json.dumps(req) + "\n").encode())
        await self.proc.stdin.drain()
        self.last = time.time()
        msg = await fut
        self.last = time.time()
        if msg.get("error"):
            raise RuntimeError(msg["error"])
        return msg

    def stop(self):
        proc, self.proc = self.proc, None
        if proc and proc.returncode is None:
            try:
                proc.kill()
            except ProcessLookupError:
                pass

    async def idle_watch(self):
        while True:
            await asyncio.sleep(30)
            if self.proc and not self.pending and time.time() - self.last > IDLE:
                self.stop()

    # ---------- a job: files in and out as base64 ----------
    async def run_job(self, jid, body):
        tmp = Path(tempfile.mkdtemp(prefix="ivvoice-"))
        try:
            req = {"op": body.get("op")}
            for k in ("text", "description", "ref_text", "seed"):
                if body.get(k) is not None:
                    req[k] = body[k]
            if body.get("ref_wav"):
                (tmp / "ref.wav").write_bytes(base64.b64decode(body["ref_wav"]))
                req["ref_wav"] = str(tmp / "ref.wav")
            if body.get("file"):
                (tmp / "in.wav").write_bytes(base64.b64decode(body["file"]))
                req["file"] = str(tmp / "in.wav")
            if req["op"] in ("speak", "design"):
                req["out"] = str(tmp / "out.wav")
            msg = await self.call(req)
            result = {k: v for k, v in msg.items() if k not in ("id", "ok", "file")}
            if req.get("out") and Path(req["out"]).exists():
                result["wav"] = base64.b64encode(Path(req["out"]).read_bytes()).decode()
            self.jobs[jid] = {"state": "done", "result": result, "at": time.time()}
        except Exception as e:  # noqa: BLE001 - the reason goes back to IV Studio in words
            self.jobs[jid] = {"state": "error", "error": str(e)[:600], "at": time.time()}
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    # ---------- setup on RunPod: the environment and models onto the network volume ----------
    async def run_setup(self):
        cfg = voice_config()
        venv = PY.parent.parent
        uv = shutil.which("uv")
        steps = [
            ("Python for voices", [uv or sys.executable, *([] if uv else ["-m", "uv"]), "venv", str(venv), "--python", "3.12", "--allow-existing"]),
            ("PyTorch and VoxCPM (about 5 GB)", [uv or sys.executable, *([] if uv else ["-m", "uv"]), "pip", "install", "--python", str(venv), "--index", cfg.get("index", "https://download.pytorch.org/whl/cu128"), "--index-strategy", "unsafe-best-match", *cfg.get("packages", [])]),
            ("VoxCPM2 and Whisper (about 6.6 GB)", [str(PY), "-u", str(SCRIPT), "--download", str(MODELS)]),
        ]
        try:
            for i, (label, cmd) in enumerate(steps, 1):
                self.setup = {"state": "running", "step": i, "steps": len(steps), "detail": label, "at": int(time.time())}
                proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
                tail = []
                while True:
                    line = await proc.stdout.readline()
                    if not line:
                        break
                    tail = (tail + [line.decode(errors="replace").strip()])[-8:]
                    self.last = time.time()
                if await proc.wait() != 0:
                    raise RuntimeError(f"{label}: {' | '.join(t for t in tail if t)[-500:]}")
            self.setup = {"state": "done", "at": int(time.time())}
        except Exception as e:  # noqa: BLE001
            self.setup = {"state": "error", "error": str(e)[:600], "at": int(time.time())}

    # ---------- routes (the gate has checked the token) ----------
    async def handle(self, req):
        path = req.path
        if path == "/iv/voice" and req.method == "GET":
            return web.json_response(self.status())
        if path == "/iv/voice/setup" and req.method == "POST":
            if not CAN_INSTALL:
                return web.json_response({"error": "on Modal, IV Studio sets voices up itself"}, status=400)
            if installed():
                return web.json_response(self.status())
            if self.setup.get("state") != "running":
                self.setup = {"state": "running", "step": 0, "detail": "Starting"}
                asyncio.create_task(self.run_setup())
            return web.json_response(self.status())
        if path == "/iv/voice/run" and req.method == "POST":
            body = await req.json()
            if body.get("op") not in ("speak", "design", "transcribe", "load"):
                return web.json_response({"error": "op is speak, design, transcribe or load"}, status=400)
            jid = uuid.uuid4().hex[:12]
            self.jobs = {k: v for k, v in self.jobs.items() if v.get("state") == "running" or time.time() - v.get("at", 0) < 3600}
            self.jobs[jid] = {"state": "running", "at": time.time()}
            self.last = time.time()
            asyncio.create_task(self.run_job(jid, body))
            return web.json_response({"id": jid})
        if path == "/iv/voice/job":
            job = self.jobs.get(req.query.get("id", ""))
            if not job:
                return web.json_response({"error": "no such job"}, status=404)
            if job["state"] != "running":
                self.jobs.pop(req.query["id"], None)
            return web.json_response(job)
        if path == "/iv/voice/release" and req.method == "POST":
            self.stop()
            return web.json_response({"released": True})
        return web.json_response({"error": "not found"}, status=404)
