"""resources/cloud/ivcloud.py, without a cloud: run by test/cloudprep.mjs as
    python test/ivcloud_test.py <a free port>
It serves files from a local HTTP server and checks downloads, checksums, refusals, listings and the pack list."""
import hashlib
import json
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "resources" / "cloud"))
import ivcloud  # noqa: E402

passed = failed = 0


def ok(cond, what):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {what}")
    else:
        failed += 1
        print(f"  FAIL {what}")


BODY = bytes((i * 13) % 256 for i in range(3 * 1024 * 1024))
SHA = hashlib.sha256(BODY).hexdigest()


class Host(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path.startswith("/gated") and self.headers.get("Authorization") != "Bearer hf_good":
            self.send_response(403)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(BODY)))
        self.end_headers()
        self.wfile.write(BODY)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 18555
    srv = ThreadingHTTPServer(("127.0.0.1", port), Host)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    print("ivcloud.py")
    try:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "models"
            good = {"id": "a", "label": "Model A", "folder": "loras/Sub", "match": "a.safetensors", "url": f"{base}/a", "size": len(BODY), "sha256": SHA}
            events = []
            done = ivcloud.fetch([good], root, progress=events.append)
            f = root / "loras" / "Sub" / "a.safetensors"
            ok(done == ["a"] and f.exists() and f.read_bytes() == BODY, "fetch: a file with a known SHA-256 lands in its folder, byte for byte")
            ok(events[-1]["state"] == "done" and not list(root.rglob("*.part")), "fetch: reports done, leaves no .part")
            events.clear()
            ok(ivcloud.fetch([good], root, progress=events.append) == ["a"] and events[0]["state"] == "have", "fetch: a file already there isn't downloaded again")

            bad = {**good, "id": "b", "match": "b.safetensors", "sha256": "0" * 64}
            try:
                ivcloud.fetch([bad], root)
                ok(False, "fetch: a checksum mismatch is refused")
            except RuntimeError as e:
                ok("did not match" in str(e) and not (root / "loras" / "Sub" / "b.safetensors").exists() and not list(root.rglob("*.part")), "fetch: a checksum mismatch is refused and removed")

            nosum = {**good, "id": "c", "match": "c.safetensors", "sha256": None}
            try:
                ivcloud.fetch([nosum], root)
                ok(False, "fetch: a file with no published checksum is refused")
            except RuntimeError as e:
                ok("no published checksum" in str(e) and not (root / "loras" / "Sub" / "c.safetensors").exists(), "fetch: a file with no published checksum is refused before downloading")

            gated = {**good, "id": "g", "match": "g.safetensors", "url": f"{base}/gated", "gated": "https://huggingface.co/x/y"}
            try:
                ivcloud.fetch([gated], root)
                ok(False, "fetch: a gated file without a token is refused")
            except RuntimeError as e:
                ok("Hugging Face token" in str(e) and "huggingface.co/x/y" in str(e), "fetch: a gated file without a token says to add the token and accept the licence")

            listing = ivcloud.listing(root)
            ok(listing == {"loras/Sub/a.safetensors": len(BODY)}, "listing: model files by relative path, with sizes")
            ok(ivcloud.present([good, bad], root) == ["a"], "present: which of the models are there")

        req = "torch>=2.0\ntorchvision\nnumpy\ntorchsde\n  torchaudio==2.1 ; platform_system=='Linux'\nxformers\ntriton-windows\neinops\n"
        kept = ivcloud.requirements_without_torch(req).split("\n")
        ok(kept == ["numpy", "torchsde", "einops"], "requirements: the torch family is left out, torchsde is kept")

        cloud, manifest = ivcloud.load(ROOT / "resources" / "cloud")
        manifest = json.loads((ROOT / "resources" / "models.json").read_text(encoding="utf-8"))
        packs = ivcloud.cloud_packs(manifest)
        dirs = [p["dir"] for p in packs]
        ok(not any(p.get("windowsOnly") for p in packs) and "comfyui-dlss5-enhancer-v15" not in dirs, "packs: DLSS 5 (Windows-only) is left out")
        ok("comfyui-h3-oneclick-swap" not in dirs and "ComfyUI-LTXVideo" in dirs and "seedvr2_videoupscaler" in dirs and "ComfyUI-Viggle-Remake" in dirs and "comfyui-minimaxh3-contex-loop" in dirs, "packs: the old Replace engine's are left out; LTX-Video, SeedVR2, Viggle Remake and Context Loop are in")
        ok(all(p.get("bundled") or ("git" in p and p.get("commit")) or "registry" in p for p in packs), "packs: each is pinned (a git commit, a registry version) or ships inside IV Studio")
        cmds = ivcloud.pack_commands(packs, "/comfy/custom_nodes", "uv pip install --system")
        ok(len(cmds) == 2 * len([p for p in packs if not p.get("bundled")]) and all("grep -viE" in c for c in cmds[1::2]), "packs: one install and one requirements command each, requirements without torch")

        every = ivcloud.catalog(cloud, manifest)
        ok(all(m.get("sha256") or "huggingface.co" in m["url"] for m in every.values()), "catalog: every cloud model has a SHA-256 or comes from Hugging Face (which publishes one)")
        ok(every["ff_ltx_2_5_video_vae_bf16"].get("gated") and every["flux2_unet"].get("gated") and not every["qwen21_unet"].get("gated"), "catalog: LTX and Flux files are gated, Qwen isn't")
        setup = ivcloud.setup_models(cloud, manifest)
        ok({m["id"] for m in setup} == {m["id"] for m in manifest["models"] if not m.get("optional")} | {"esrgan_x2"}, "setup downloads H3's required models and the 2x upscaler only")
        ok(cloud["comfyui"]["tag"] == "v0.44.1" and all("==" in p for p in cloud["torch"]["packages"]), "cloud.json: ComfyUI v0.44.1 and an exactly pinned torch")
        folders = {m["folder"].split("/")[0] for m in every.values()}
        yaml = (ROOT / "resources" / "cloud" / "extra_model_paths.yaml").read_text(encoding="utf-8")
        missing = [f for f in folders if f"  {f}:" not in yaml and f"{f}\n" not in yaml.split(": ", 1)[-1] and not (f == "SEEDVR2" and "seedvr2: SEEDVR2" in yaml)]
        ok(not missing, f"extra_model_paths.yaml maps every cloud model folder{(' (missing: ' + ', '.join(missing) + ')') if missing else ''}")
    finally:
        srv.shutdown()
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
