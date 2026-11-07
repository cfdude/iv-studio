# Third-party notices

IV Studio ships these components. Their licence texts are in `resources/licenses/` and are installed
with the app.

| Component | Licence | Use |
| --- | --- | --- |
| Electron (with Chromium and Node.js) | MIT; Chromium's notices ship as `LICENSES.chromium.html` in the install folder | App runtime |
| React, React DOM | MIT | Interface |
| @modelcontextprotocol/sdk | MIT | MCP server |
| zod | MIT | MCP tool schemas |
| electron-updater | MIT | Updates from GitHub Releases |
| Barlow and Barlow Condensed (Jeremy Tribby) | SIL OFL 1.1 | Display type |
| DM Sans (Colophon Foundry) | SIL OFL 1.1 | Body type |
| JetBrains Mono (JetBrains) | SIL OFL 1.1 | Monospace type |
| Barlow Condensed SemiBold TTF (`resources/fonts`) | SIL OFL 1.1 | Titles in exported edits |
| FFmpeg 6.1.2 (`ffmpeg.exe`, `ffprobe.exe`) | GPL v3 (built with `--enable-gpl --enable-version3`); texts in `resources/licenses/GPL-3.0.txt` and `FFmpeg-LICENSE.md` | The editor's export and media probing |
| FFmpeg 6.1.1 (`ffmpeg`, `ffprobe`, macOS arm64 builds only) | GPL v3 or later (built with `--enable-gpl --enable-version3`) **and `--enable-nonfree`**; the `ffmpeg-ffprobe-static` package is GPL-3.0-or-later | The editor's export and media probing on a Mac |

FFmpeg is the BtbN FFmpeg-Builds `n6.1.2-9-g4571c80b40-20241023` build, shipped through the npm
package `ffmpeg-ffprobe-static` 6.1.2-rc.1. Source: https://github.com/FFmpeg/FFmpeg/tree/4571c80b40
and https://github.com/BtbN/FFmpeg-Builds (build scripts). IV Studio runs it as a separate program,
the same way you would from a command line.

The macOS arm64 build ships a different FFmpeg: version 6.1.1, from the npm package
`ffmpeg-ffprobe-static` 6.1.2-rc.1, which downloads the darwin-arm64 binaries from
https://github.com/descriptinc/ffmpeg-ffprobe-static (release `b6.1.2-rc.1`). The package is
GPL-3.0-or-later. **This build was configured with `--enable-nonfree`.** The configuration line that
`ffmpeg -version` prints for the shipped binary is:

```
--prefix=/Volumes/tempdisk/sw --extra-cflags=-fno-stack-check --arch=arm64 --cc=/usr/bin/clang --enable-gpl --enable-libvmaf --enable-libbluray --enable-libopenjpeg --enable-libopus --enable-libmp3lame --enable-libx264 --enable-libx265 --enable-libvpx --enable-libwebp --enable-libass --enable-libfreetype --enable-fontconfig --enable-libtheora --enable-libvorbis --enable-libsnappy --enable-libaom --enable-libvidstab --enable-libzimg --enable-libsvtav1 --enable-libharfbuzz --enable-libkvazaar --enable-version3 --pkg-config-flags=--static --enable-ffplay --enable-postproc --enable-nonfree --enable-neon --enable-runtime-cpudetect --disable-indev=qtkit --disable-indev=x11grab_xcb
```

A binary built with `--enable-nonfree` can't be redistributed. Mac builds of IV Studio are for personal use
until a redistributable FFmpeg replaces this one (tracked separately).

## Artwork

`src/renderer/src/assets/eye.webp` is Infinite Variance's own artwork (the "What If?" eye from infinitevariance.ai). It is © Infinite Variance and is **not** covered by the MIT licence; don't reuse it outside IV Studio without permission.

## Not bundled

IV Studio doesn't include ComfyUI, its node packs or any model weights. Setup downloads models
from their upstream hosts on request, and each comes under its own licence. Check the model page
before any commercial use. The node packs install from their own GitHub repositories under their
own licences.
