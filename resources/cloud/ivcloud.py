"""What the IV Studio cloud installs and downloads, shared by the Modal app (modal_app.py), the RunPod boot
(runpod_boot.py) and the gate's model routes (gate.py). Standard library only.

Node packs: models.json's node_packs (the list Setup installs on a PC), without the Windows-only ones and those
marked "cloud": false. A pack's requirements are installed without the torch family, so no pack can swap the
pinned torch for another build.

Models: models.json's models plus cloud.json's extraModels, by id. A download is kept only when it matches its
sha256, or, when that is null, the SHA-256 Hugging Face publishes for the file (X-Linked-ETag). A file with
neither is refused. Gated Hugging Face files are fetched with the person's Hugging Face token (HF_TOKEN).
"""
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

TORCH_FAMILY = re.compile(r"^\s*(torch|torchvision|torchaudio|xformers|triton|triton-windows)(\s*$|[^A-Za-z0-9_.-])", re.I)
MODEL_EXT = (".safetensors", ".pth", ".pt", ".ckpt", ".gguf", ".bin", ".sft")


def load(here):
    here = Path(here)
    cloud = json.loads((here / "cloud.json").read_text()) if (here / "cloud.json").exists() else {}
    manifest = json.loads((here / "models.json").read_text()) if (here / "models.json").exists() else {"models": [], "node_packs": []}
    return cloud, manifest


def cloud_packs(manifest):
    return [p for p in manifest.get("node_packs", []) if not p.get("windowsOnly") and p.get("cloud") is not False]


def pack_commands(packs, custom_nodes, pip):
    """Shell commands that install each downloaded pack into custom_nodes (bundled packs are copied by the caller).
    pip: the command that installs a requirements file, e.g. "uv pip install --system"."""
    cmds = []
    for p in packs:
        if p.get("bundled"):
            continue
        dest = f"{custom_nodes}/{p['dir']}"
        if "git" in p:
            cmds.append(f"rm -rf '{dest}' && git clone -q {p['git']} '{dest}' && git -C '{dest}' checkout -q {p['commit']}")
        else:
            # registry archives are usually zips whatever their extension says; try zip, then tar
            cmds.append(f"rm -rf '{dest}' && mkdir -p '{dest}' && curl -fsSL {p['registry']} -o /tmp/pack && (unzip -q -o /tmp/pack -d '{dest}' || tar -xzf /tmp/pack -C '{dest}') && rm /tmp/pack")
        # the requirements without the torch family (see requirements_without_torch)
        cmds.append(
            f"if [ -f '{dest}/requirements.txt' ]; then grep -viE '^[[:space:]]*(torch|torchvision|torchaudio|xformers|triton)([^A-Za-z0-9_.-]|$)' '{dest}/requirements.txt' > /tmp/req.txt || true; {pip} -r /tmp/req.txt; fi"
        )
    return cmds


def requirements_without_torch(text):
    """The same filter as pack_commands' grep, for tests."""
    return "\n".join(line for line in text.splitlines() if not TORCH_FAMILY.match(line))


def catalog(cloud, manifest):
    """Every model the cloud can download, by id."""
    out = {}
    gated = set(cloud.get("gatedRepos", []))
    for m in list(manifest.get("models", [])) + list(cloud.get("extraModels", [])):
        if m.get("url"):
            repo = re.search(r"huggingface\.co/([^/]+/[^/]+)/", m["url"])
            if not m.get("gated") and repo and repo.group(1) in gated:
                m = {**m, "gated": f"https://huggingface.co/{repo.group(1)}"}
            out[m["id"]] = m
    return out


def setup_models(cloud, manifest):
    """What setup downloads: H3's required models and the cloud's own required ones. Everything else waits for the
    first render that needs it."""
    return [m for m in manifest.get("models", []) if not m.get("optional")] + [m for m in cloud.get("extraModels", []) if m.get("required")]


def target(root, m):
    return Path(root) / m["folder"] / m["match"]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def _hf_headers(url, token):
    return {"Authorization": f"Bearer {token}"} if token and "huggingface.co" in url else {}


def hf_sha256(url, token=None):
    """SHA-256 Hugging Face publishes for an LFS file (X-Linked-ETag), or None."""
    if "huggingface.co" not in url:
        return None
    req = urllib.request.Request(url, method="HEAD", headers=_hf_headers(url, token))
    try:
        r = urllib.request.build_opener(_NoRedirect).open(req, timeout=30)
        headers = r.headers
    except urllib.error.HTTPError as e:
        headers = e.headers
    etag = (headers.get("X-Linked-ETag") or "").strip('"')
    return etag.lower() if len(etag) == 64 else None


def refusal(m, code, token):
    """What a refused download means, in words."""
    if code in (401, 403) and m.get("gated"):
        if not token:
            return f"{m['label']} is behind a licence on Hugging Face. Add your Hugging Face token on the Cloud page, after accepting the licence at {m['gated']}."
        return f"Hugging Face refused {m['label']}. Accept its licence at {m['gated']} with the account your token belongs to, then try again."
    return f"{m['label']}: the host answered {code} for {m['url']}"


def fetch(models, root, token=None, progress=None):
    """Downloads each model root lacks. progress(event) gets {id, label, state: have|downloading|done, percent,
    got, total, index, count}. Returns the ids now present. Raises on a refused download or a checksum mismatch."""
    progress = progress or (lambda e: None)
    done = []
    for i, m in enumerate(models, 1):
        dest = target(root, m)
        base = {"id": m["id"], "label": m["label"], "index": i, "count": len(models)}
        if dest.exists():
            progress({**base, "state": "have"})
            done.append(m["id"])
            continue
        want = (m.get("sha256") or "").lower() or hf_sha256(m["url"], token)
        if not want:
            raise RuntimeError(f"{m['label']} has no published checksum, so IV Studio won't put it in your cloud storage.")
        dest.parent.mkdir(parents=True, exist_ok=True)
        part = dest.with_name(dest.name + ".part")
        h = hashlib.sha256()
        try:
            r = urllib.request.urlopen(urllib.request.Request(m["url"], headers=_hf_headers(m["url"], token)), timeout=60)
        except urllib.error.HTTPError as e:  # plain text, so the reason reaches IV Studio intact
            raise RuntimeError(refusal(m, e.code, token)) from None
        with r, open(part, "wb") as f:
            total = int(r.headers.get("Content-Length") or m.get("size") or 0)
            got, last = 0, 0.0
            while chunk := r.read(1 << 22):
                f.write(chunk)
                h.update(chunk)
                got += len(chunk)
                if time.time() - last > 3:
                    progress({**base, "state": "downloading", "got": got, "total": total, "percent": int(got * 100 / total) if total else 0})
                    last = time.time()
        if h.hexdigest() != want:
            part.unlink()
            raise RuntimeError(f"{m['label']} did not match its checksum; it was removed.")
        part.replace(dest)
        progress({**base, "state": "done", "got": got, "total": got, "percent": 100})
        done.append(m["id"])
    return done


def listing(root):
    """Every model file under root: {relative path: size}. Half-downloaded files are left out."""
    root = Path(root)
    out = {}
    if not root.exists():
        return out
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            if f.lower().endswith(MODEL_EXT):
                p = Path(dirpath) / f
                try:
                    out[p.relative_to(root).as_posix()] = p.stat().st_size
                except OSError:
                    pass
    return out


def present(models, root):
    return [m["id"] for m in models if target(root, m).exists()]
