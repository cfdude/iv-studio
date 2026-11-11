# Third-party notices

IV Studio ships these components. Settings → About → Credits lists everything it's built on, including the models and tools it downloads. Their licence texts are in `resources/licenses/` and are installed
with the app.

| Component | Licence | Use |
| --- | --- | --- |
| Electron (with Chromium and Node.js) | MIT; Chromium's notices ship as `LICENSES.chromium.html` in the install folder | App runtime |
| React, React DOM | MIT | Interface |
| @modelcontextprotocol/sdk | MIT | MCP server |
| zod | MIT | MCP tool schemas |
| electron-updater | MIT | Updates from GitHub Releases |
| JSONata | MIT | Working out partner-node prices |
| js-yaml | MIT | Reading the Mac update feed (bundled into the app's main script) |
| Barlow and Barlow Condensed (Jeremy Tribby) | SIL OFL 1.1 | Display type |
| DM Sans (Colophon Foundry) | SIL OFL 1.1 | Body type |
| JetBrains Mono (JetBrains) | SIL OFL 1.1 | Monospace type |
| Barlow Condensed SemiBold TTF (`resources/fonts`) | SIL OFL 1.1 | Titles in exported edits |
| Viggle Remake ComfyUI nodes and prompt guide (Viggle AI; `resources/comfy-nodes/ComfyUI-Viggle-Remake`, `resources/remake`) | Apache 2.0; `ViggleRemake-Apache-2.0.txt`, `ViggleRemake-NOTICE.txt` | Replace (Remake) |
| FFmpeg 6.1.2 (`ffmpeg.exe`, `ffprobe.exe`) | GPL v3 (built with `--enable-gpl --enable-version3`); texts in `resources/licenses/GPL-3.0.txt` and `FFmpeg-LICENSE.md` | The editor's export and media probing |

FFmpeg is the BtbN FFmpeg-Builds `n6.1.2-9-g4571c80b40-20241023` build, shipped through the npm
package `ffmpeg-ffprobe-static` 6.1.2-rc.1. Source: https://github.com/FFmpeg/FFmpeg/tree/4571c80b40
and https://github.com/BtbN/FFmpeg-Builds (build scripts). IV Studio runs it as a separate program,
the same way you would from a command line.

## MiniMax H3

MiniMax H3 is licensed under the MiniMax H3 Community License Agreement, Copyright © 2026 MiniMax. All Rights Reserved.

IV Studio is Powered by MiniMax H3. It doesn't include H3's weights (see Not bundled), but it ships a copy of MiniMax's
licence (`resources/licenses/MiniMax-H3-LICENSE.txt`, from Hugging Face `MiniMaxAI/MiniMax-H3` revision `42ed227`) and
its notice (`MiniMax-H3-NOTICE.txt`). Everyone who uses H3 through IV Studio agrees to [TERMS.md](TERMS.md), which
carries the licence's use restrictions and Acceptable Use Policy.

## Artwork

`src/renderer/src/assets/eye.webp` is Infinite Variance's own artwork (the "What If?" eye from infinitevariance.ai). It is © Infinite Variance and is **not** covered by the MIT licence; don't reuse it outside IV Studio without permission.

## Not bundled

IV Studio doesn't include ComfyUI or any model weights. Setup downloads models from their upstream
hosts on request, and each comes under its own licence. Check the model page before any commercial
use. Node packs install from their own repositories under their own licences; IV Studio's own small
pack and Viggle Remake's nodes are copied from the app.

The Viggle Remake weights (Setup, from Hugging Face `Viggle/Viggle-Remake`) are a Model Derivative of
MiniMax H3 under the MiniMax H3 Community License Agreement. Powered by Viggle Remake
(https://huggingface.co/Viggle/Viggle-Remake). IV Studio isn't made or endorsed by Viggle.
