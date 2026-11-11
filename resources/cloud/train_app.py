"""IV Studio character training: Fizgig trains a MiniMax H3 character LoRA on the user's own Modal account.

IV Studio runs each step itself (the same steps trained the Tess LoRA, 2026-10-25):

  modal run train_app.py::fetch_models               CPU: Fizgig's H3 training files (~42 GB) into the volume, once
  modal volume put iv-studio-train <dataset> /datasets/<name>
  modal volume put iv-studio-train train.sh /train/<name>/train.sh   (and dataset.toml)
  modal run --detach train_app.py::train --name <name>   GPU: caching, then the epochs; keeps going if IV Studio closes
  modal volume get iv-studio-train /train/<name>/loras/<file> <local folder>

The GPU comes from IV_TRAIN_GPU (B200 by default; H200 is the fallback). The volume costs nothing while idle
under Modal's free storage allowance.
"""
import os
import subprocess
import threading
import time

import modal

FIZGIG_COMMIT = "8630fca0c5d7932d73fe7387fd7c8a4dc99d9467"  # v9.3.2, the commit IV Studio's train.sh flags were checked against (FIZGIG in training.js)
GPU = os.environ.get("IV_TRAIN_GPU", "B200")
VOL = "/vol"

volume = modal.Volume.from_name("iv-studio-train", create_if_missing=True)

# Fizgig's own published image (Ubuntu 24.04, CUDA 13.4 PyTorch in /opt/venv) at the release of that commit, pinned
# by digest, with Fizgig baked in at the commit and the entrypoint cleared so Modal can start its own process. Keep in
# step with FIZGIG in src/service/training.js.
image = (
    modal.Image.from_registry("ghcr.io/shootthesound/fizgig:9.3.2@sha256:aa84fc35f72ae0e5cdee10a018415d23c0bd4c0a4c55c234187a256ec167719a")
    .entrypoint([])
    .run_commands(
        "git clone https://github.com/shootthesound/Fizgig /opt/Fizgig",
        f"cd /opt/Fizgig && git checkout {FIZGIG_COMMIT}",
        "cd /opt/Fizgig && python3 uv_install_deps.py requirements.txt $VIRTUAL_ENV",
    )
    .env({"PYTHONPATH": "/opt/Fizgig/src", "PYTHONUNBUFFERED": "1", "HF_HUB_DISABLE_TELEMETRY": "1"})
)

app = modal.App("iv-studio-train", image=image)

MODELS = {
    "minimax_h3_fl2va_pruned_int8_convrot.safetensors": 20_970_379_616,
    "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors": 15_687_142_551,
    "minimax_h3_video_vae_fp16.safetensors": 5_207_808_496,
    "minimax_h3_audio_vae_fp32.safetensors": 605_254_808,
    "minimax_h3_image_training_adapter.safetensors": 620_284_872,
}


def _run(cmd, cwd="/opt/Fizgig", log=None):
    """Run a shell command, echoing its output (and appending it to a log file)."""
    print("$", cmd, flush=True)
    fh = open(log, "a", encoding="utf-8") if log else None
    p = subprocess.Popen(cmd, shell=True, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    for line in p.stdout:
        print(line, end="", flush=True)
        if fh:
            fh.write(line)
            fh.flush()
    p.wait()
    if fh:
        fh.close()
    if p.returncode:
        raise SystemExit(f"command failed ({p.returncode}): {cmd}")


def _missing_models():
    bad = []
    for f, size in MODELS.items():
        p = f"{VOL}/models/{f}"
        if not (os.path.exists(p) and os.path.getsize(p) == size):
            bad.append(f)
    return bad


@app.function(volumes={VOL: volume}, timeout=3 * 3600, cpu=4, memory=8192)
def fetch_models():
    """Download Fizgig's MiniMax H3 training files into the volume (CPU only). Skips files already there."""
    volume.reload()
    if not _missing_models():
        print("MODELS READY (already in your storage)")
        return
    os.makedirs(f"{VOL}/models", exist_ok=True)
    _run(f"python3 -m fizgig.scripts.fetch_models --family minimax --models-dir {VOL}/models")
    volume.commit()
    bad = _missing_models()
    if bad:
        raise SystemExit("These training files didn't download completely: " + ", ".join(bad))
    print("MODELS READY")


def _committer(stop):
    while not stop.wait(180):  # every 3 min, so progress shows and a crash keeps the saved epochs
        try:
            volume.commit()
        except Exception as e:  # a busy volume is fine; the next pass gets it
            print("[commit skipped]", e, flush=True)


@app.function(gpu=GPU, volumes={VOL: volume}, timeout=8 * 3600, memory=65536)
def train(name: str):
    """Caching, then the epochs. Checkpoints land in /vol/train/<name>/loras."""
    volume.reload()
    bad = _missing_models()
    if bad:
        raise SystemExit("Training files missing from storage: " + ", ".join(bad))
    root = f"{VOL}/train/{name}"
    if not os.path.isfile(f"{root}/train.sh"):
        raise SystemExit(f"No training set up for {name}")
    stop = threading.Event()
    threading.Thread(target=_committer, args=(stop,), daemon=True).start()
    log = f"{root}/train.log"
    t0 = time.time()
    try:
        _run(f"bash {root}/train.sh", cwd=root, log=log)
    finally:
        stop.set()
        with open(log, "a", encoding="utf-8") as fh:
            fh.write(f"\n[modal] finished after {(time.time() - t0) / 60:.1f} min\n")
        volume.commit()
    _run(f"cd {root}/loras && sha256sum *.safetensors > SHA256SUMS && ls -la", cwd="/")
    with open(log, "a", encoding="utf-8") as fh:
        fh.write("[modal] TRAINING DONE\n")
    volume.commit()
