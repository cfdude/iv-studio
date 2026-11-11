"""IV Studio in the cloud, on the user's own RunPod account: what every IV Studio pod runs.

IV Studio starts a pod from RunPod's official PyTorch image with the user's network volume at /workspace,
passing this folder (packed into the IV_BUNDLE variable, so the pod runs exactly this app version's files)
and the start command `bash -c "<unpack IV_BUNDLE into /opt/iv> && python3 /opt/iv/runpod_boot.py"`.
Standard library only: it runs before anything is installed.

  1. gate.py starts at once on port 8189, so IV Studio can follow the boot through /iv/health
  2. the first time (or after an update changes cloud.json or the node packs): a Python, torch, ComfyUI at its
     pinned tag and every cloud node pack (ivcloud.py), installed into /workspace/iv on the volume, so later
     pods skip it
  3. the models setup needs (H3's) that the volume lacks, downloaded into /workspace/models and checked against
     their SHA-256 (the same list Modal's fetch_models uses). Other models come later, through the gate's
     /iv/fetch, the first time a render needs them
  4. ComfyUI on 127.0.0.1:8188, reading models through extra_model_paths.yaml (/models -> /workspace/models),
     with its input and output folders on the volume
The gate deletes the pod after IV_IDLE_SECONDS with nothing to do; the volume keeps everything.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import ivcloud

HERE = Path(__file__).parent
W = Path("/workspace/iv")
VENV = W / "venv"
PY = VENV / "bin" / "python"
COMFY = W / "comfy"
MODELS = Path("/workspace/models")
STATUS = Path("/tmp/iv-status.json")
CLOUD, MANIFEST = ivcloud.load(HERE)
PACKS = ivcloud.cloud_packs(MANIFEST)


def status(stage, detail="", **extra):
    tmp = STATUS.with_suffix(".tmp")
    tmp.write_text(json.dumps({"stage": stage, "detail": detail, "at": int(time.time()), **extra}))
    tmp.replace(STATUS)
    print(f"[iv] {stage}: {detail}", flush=True)


def sh(cmd, **kw):
    print(f"[iv] $ {cmd}", flush=True)
    subprocess.run(cmd, shell=True, check=True, **kw)


def start_gate():
    try:
        import aiohttp  # noqa: F401
    except ImportError:
        sh(f"{sys.executable} -m pip install -q --break-system-packages aiohttp")
    env = {**os.environ, "IV_PLATFORM": "runpod", "IV_STATUS_FILE": str(STATUS), "IV_MODELS_DIR": str(MODELS), "PYTHONPATH": str(HERE)}
    return subprocess.Popen([sys.executable, str(HERE / "gate.py")], env=env)


def system_packages():
    if shutil.which("ffmpeg") and shutil.which("unzip"):
        return
    status("installing", "system packages (ffmpeg)")
    sh("apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends ffmpeg unzip libgl1 libglib2.0-0 >/dev/null")


def stamp():
    """What the install on the volume must match: this version's cloud.json and cloud node packs."""
    return hashlib.sha256((HERE / "cloud.json").read_bytes() + json.dumps(PACKS, sort_keys=True).encode()).hexdigest()[:16]


def wait_for_other_install():
    """Two pods on one volume must not install at once. A lock older than an hour is a crashed pod's."""
    lock = W / "install.lock"
    while True:
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, os.environ.get("RUNPOD_POD_ID", "?").encode())
            os.close(fd)
            return lock
        except FileExistsError:
            if time.time() - lock.stat().st_mtime > 3600:
                lock.unlink(missing_ok=True)
                continue
            status("installing", "another IV Studio pod is installing; waiting for it")
            time.sleep(20)


def install():
    W.mkdir(parents=True, exist_ok=True)
    if (W / "stamp").exists() and (W / "stamp").read_text().strip() == stamp() and PY.exists():
        return
    lock = wait_for_other_install()
    try:
        if (W / "stamp").exists() and (W / "stamp").read_text().strip() == stamp() and PY.exists():
            return
        status("installing", "Python and torch (first time only, about 5 minutes)")
        if not shutil.which("uv"):
            sh(f"{sys.executable} -m pip install -q --break-system-packages uv")
        shutil.rmtree(VENV, ignore_errors=True)
        shutil.rmtree(COMFY, ignore_errors=True)
        sh(f"uv venv {VENV} --python 3.12 --seed")
        torch = CLOUD["torch"]
        sh(f"uv pip install --python {PY} {' '.join(torch['packages'])} --index-url {torch['index']}")
        comfy = CLOUD["comfyui"]
        status("installing", f"ComfyUI {comfy['tag']}")
        sh(f"git clone --depth 1 --branch {comfy['tag']} {comfy['repo']} {COMFY}")
        sh(f"grep -viE '^[[:space:]]*(torch|torchvision|torchaudio)([^A-Za-z0-9_.-]|$)' {COMFY}/requirements.txt > /tmp/comfy-req.txt && uv pip install --python {PY} -r /tmp/comfy-req.txt")
        cmds = ivcloud.pack_commands(PACKS, str(COMFY / "custom_nodes"), f"uv pip install --python {PY}")
        downloaded = [p for p in PACKS if not p.get("bundled")]
        for i, p in enumerate(downloaded):
            status("installing", f"node pack {i + 1} of {len(downloaded)}: {p['dir']}")
            sh(cmds[2 * i])
            sh(cmds[2 * i + 1])
        (W / "stamp").write_text(stamp())
    finally:
        lock.unlink(missing_ok=True)


def fetch_models():
    """The models setup needs that the volume lacks (ivcloud.setup_models), each checked against its SHA-256."""
    models = ivcloud.setup_models(CLOUD, MANIFEST)
    have = len(ivcloud.present(models, MODELS))
    token = os.environ.get("HF_TOKEN") or None

    def say(e):
        if e["state"] == "downloading":
            status("models", f"{e['label']} ({e['index']} of {e['count']}), {e['percent']}%", model=e["id"], percent=e["percent"], done=have + e["index"] - 1, total=len(models))
        elif e["state"] == "done":
            print(f"[iv] model ready: {e['label']} (checksum verified)", flush=True)

    ivcloud.fetch([m for m in models if not ivcloud.target(MODELS, m).exists()], MODELS, token=token, progress=say)


def start_comfy():
    for p in PACKS:  # the packs that ship inside IV Studio (its own, Viggle Remake's), this version's, every boot
        if p.get("bundled") and (HERE / p["dir"]).exists():
            nodes = COMFY / "custom_nodes" / p["dir"]
            shutil.rmtree(nodes, ignore_errors=True)
            shutil.copytree(HERE / p["dir"], nodes)
    for d in ("input", "output"):
        (W / "data" / d).mkdir(parents=True, exist_ok=True)
    if not Path("/models").exists():
        os.symlink(MODELS, "/models")
    status("starting", "ComfyUI is loading")
    return subprocess.Popen(
        [str(PY), str(COMFY / "main.py"), "--listen", "127.0.0.1", "--port", "8188", "--disable-auto-launch", "--preview-method", "none",
         "--input-directory", str(W / "data" / "input"), "--output-directory", str(W / "data" / "output"),
         "--extra-model-paths-config", str(HERE / "extra_model_paths.yaml")]
    )


def wait_ready(proc):
    while proc.poll() is None:
        try:
            with urllib.request.urlopen("http://127.0.0.1:8188/system_stats", timeout=5):
                status("ready", "ComfyUI is ready", pod=os.environ.get("RUNPOD_POD_ID"))
                return True
        except Exception:  # noqa: BLE001 - not up yet
            time.sleep(3)
    status("error", f"ComfyUI stopped while starting (exit {proc.returncode})")
    return False


def main():
    MODELS.mkdir(parents=True, exist_ok=True)
    status("booting", "starting the gate")
    gate = start_gate()
    try:
        system_packages()
        install()
        fetch_models()
        comfy = start_comfy()
        wait_ready(comfy)
        comfy.wait()
        status("error", f"ComfyUI stopped (exit {comfy.returncode})")
    except Exception as e:  # noqa: BLE001 - the gate stays up so IV Studio can show what went wrong
        status("error", str(e)[:400])
    gate.wait()


if __name__ == "__main__":
    main()
