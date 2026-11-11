"""IV Studio in the cloud, on the user's own Modal account.

IV Studio deploys this for the user (they never need to read it):
  modal deploy modal_app.py                          # builds the image once, publishes the ComfyUI address
  modal run modal_app.py::fetch_models               # CPU: the models setup needs, into the iv-studio-models volume
  modal run modal_app.py::fetch_models --ids a,b     # CPU: the models a render needs, the first time it needs them
  modal run modal_app.py::list_models                # CPU: what the volume holds (one JSON line)
  modal run modal_app.py::fetch_voice                # CPU: the voice engine's models (VoxCPM2, Whisper), once
  modal volume put iv-studio-models <file> <path>    # the user's LoRAs and RefMods

What runs:
  comfy          ComfyUI behind gate.py (the token gate) as a web server. It starts on the first request,
                 keeps running while IV Studio is using it and shuts itself down after IV_IDLE_SECONDS
                 with nothing to do, so the GPU is billed only while rendering.
  download_models / list_files
                 CPU functions on the models volume (ivcloud.py): downloads checked against their SHA-256, and
                 the volume's file list.
  voices         IV Studio's voice engine (voice_server.py, its own environment in the image at /opt/voice)
                 runs in the comfy container on request, through the gate's /iv/voice routes (voicehost.py);
                 download_voice puts its models in the volume's voice folder.
Volumes: iv-studio-models (models, read by ComfyUI through extra_model_paths.yaml) and iv-studio-data
(ComfyUI's input and output folders, so uploads and renders outlive a container).
The gate's token lives in the Modal secret iv-studio-token, and the person's Hugging Face token (for gated
files, or "none") in iv-studio-hf. IV Studio creates both.
"""
import json
import os
import subprocess
import time
from pathlib import Path

import modal

HERE = Path(__file__).parent
try:  # on the PC at deploy time ivcloud.py sits beside this file; the containers that need it get a copy
    import ivcloud
except ImportError:  # pragma: no cover - inside the GPU container, which never reads the manifests
    ivcloud = None

CLOUD, MANIFEST = ivcloud.load(HERE) if ivcloud else ({}, {"models": [], "node_packs": []})
APP_NAME = os.environ.get("IV_APP_NAME", "iv-studio")
GPU = os.environ.get("IV_GPU", "L40S")
IDLE = int(os.environ.get("IV_IDLE_SECONDS", "300"))

models_vol = modal.Volume.from_name("iv-studio-models", create_if_missing=True)
data_vol = modal.Volume.from_name("iv-studio-data", create_if_missing=True)

comfy_cfg = CLOUD.get("comfyui", {"repo": "https://github.com/Comfy-Org/ComfyUI", "tag": "v0.44.1"})
torch_cfg = CLOUD.get("torch", {"index": "https://download.pytorch.org/whl/cu128", "packages": ["torch==2.11.0", "torchvision==0.26.0", "torchaudio==2.11.0"]})
PACKS = ivcloud.cloud_packs(MANIFEST) if ivcloud else []
voice_cfg = CLOUD.get("voice", {"index": "https://download.pytorch.org/whl/cu128", "packages": ["torch==2.9.1", "torchaudio==2.9.1", "torchcodec==0.9.1", "voxcpm==2.0.3"]})

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "curl", "unzip", "ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install(*torch_cfg["packages"], index_url=torch_cfg["index"])
    .run_commands(
        f"git clone --depth 1 --branch {comfy_cfg['tag']} {comfy_cfg['repo']} /comfy",
        # uv, not pip, from here on: inside Modal's gVisor sandbox pip crashes on requirement markers that compare
        # the kernel version ('4.19.0-gvisor' is not a valid version to it)
        "pip install aiohttp uv",
        "grep -viE '^[[:space:]]*(torch|torchvision|torchaudio)([^A-Za-z0-9_.-]|$)' /comfy/requirements.txt > /tmp/comfy-req.txt && uv pip install --system -r /tmp/comfy-req.txt",
    )
    .run_commands(*(ivcloud.pack_commands(PACKS, "/comfy/custom_nodes", "uv pip install --system") if ivcloud else ["true"]))
    # the voice engine's own environment, with the same pins as on a PC (its torch is not ComfyUI's)
    .run_commands(
        "uv venv /opt/voice/venv --python 3.12",
        f"uv pip install --python /opt/voice/venv --index {voice_cfg['index']} --index-strategy unsafe-best-match {' '.join(voice_cfg['packages'])}",
    )
    .env({"PYTHONUNBUFFERED": "1", "HF_HUB_DISABLE_TELEMETRY": "1", "IV_VOICE_PYTHON": "/opt/voice/venv/bin/python", "IV_VOICE_MODELS": "/models/voice"})
)
# packs that ship inside IV Studio (its own, Viggle Remake's) are copied from the deploy folder
for _p in PACKS:
    if _p.get("bundled") and (HERE / _p["dir"]).exists():
        image = image.add_local_dir(str(HERE / _p["dir"]), f"/comfy/custom_nodes/{_p['dir']}", copy=True)
for _f in ("extra_model_paths.yaml", "gate.py", "voicehost.py", "voice_server.py", "cloud.json"):
    if (HERE / _f).exists():
        image = image.add_local_file(str(HERE / _f), f"/opt/iv/{_f}", copy=True)

# the CPU functions: Python only, with ivcloud.py; the voice download also needs huggingface_hub and voice_server.py
cpu_image = modal.Image.debian_slim(python_version="3.12").add_local_python_source("ivcloud")
voice_dl_image = modal.Image.debian_slim(python_version="3.12").pip_install("huggingface_hub==2.4.0").add_local_file(str(HERE / "voice_server.py"), "/root/voice_server.py")

app = modal.App(APP_NAME)


@app.function(
    image=image,
    gpu=GPU,
    volumes={"/models": models_vol, "/data": data_vol},
    secrets=[modal.Secret.from_name("iv-studio-token")],
    timeout=24 * 3600,
    scaledown_window=IDLE,
    max_containers=1,
)
@modal.concurrent(max_inputs=200)
@modal.web_server(8189, startup_timeout=600)
def comfy():
    for d in ("/data/input", "/data/output"):
        os.makedirs(d, exist_ok=True)
    subprocess.Popen(
        "python /comfy/main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch --preview-method none "
        "--input-directory /data/input --output-directory /data/output "
        "--extra-model-paths-config /opt/iv/extra_model_paths.yaml",
        shell=True,
    )
    subprocess.Popen("python /opt/iv/gate.py", shell=True)


# ---------- models ----------


@app.function(image=cpu_image, volumes={"/models": models_vol}, secrets=[modal.Secret.from_name("iv-studio-hf")], timeout=6 * 3600, cpu=4)
def download_models(models):
    """Downloads the models the volume lacks. Prints one line per step, which IV Studio follows."""
    import ivcloud as iv

    token = os.environ.get("HF_TOKEN", "")

    def say(e):
        if e["state"] == "have":
            print(f"have {e['label']}", flush=True)
        elif e["state"] == "downloading":
            print(f"progress {e['id']} {e['percent']}% of {e['total']}", flush=True)
        else:
            models_vol.commit()
            print(f"done {e['label']} (checksum verified)", flush=True)

    return iv.fetch(models, "/models", token=token if token and token != "none" else None, progress=say)


@app.function(image=cpu_image, volumes={"/models": models_vol})
def list_files():
    import ivcloud as iv

    return iv.listing("/models")


@app.local_entrypoint()
def fetch_models(ids: str = ""):
    """Run by IV Studio with models.json and cloud.json next to this file. No ids: what setup needs."""
    every = ivcloud.catalog(CLOUD, MANIFEST)
    wanted = [i for i in ids.split(",") if i]
    unknown = [i for i in wanted if i not in every]
    if unknown:
        raise SystemExit(f"Unknown models: {', '.join(unknown)}")
    models = [every[i] for i in wanted] if wanted else ivcloud.setup_models(CLOUD, MANIFEST)
    t0 = time.time()
    done = download_models.remote(models)
    print(f"models ready: {len(done)}/{len(models)} in {int(time.time() - t0)} s", flush=True)


@app.function(image=voice_dl_image, volumes={"/models": models_vol}, timeout=3 * 3600, cpu=4)
def download_voice():
    """VoxCPM2 and Whisper at the revisions voice_server.py pins, into the volume's voice folder."""
    import sys

    sys.path.insert(0, "/root")
    import voice_server

    voice_server.download("/models/voice")
    models_vol.commit()


@app.local_entrypoint()
def fetch_voice():
    t0 = time.time()
    download_voice.remote()
    print(f"voice models ready in {int(time.time() - t0)} s", flush=True)


@app.local_entrypoint()
def list_models():
    print("IV_FILES " + json.dumps(list_files.remote()), flush=True)
