// Cut-outs: a picture or a video with everything but what you name taken away, so it can sit over other footage in
// Edit. SAM 3.1 (already used by Replace) finds and tracks "the woman", "the dog" or "the car" on this PC's
// ComfyUI and saves only the mask; the bundled ffmpeg joins that mask with the full-quality original into a PNG
// or a WebM (VP9) with a see-through background, keeping the video's sound. Free, local.
import fs from 'node:fs'
import path from 'node:path'
import { probe } from './media.js'

const SAM = 'sam3.1_multiplex_fp16.safetensors'
const IMAGE = /\.(png|jpe?g|webp|bmp)$/i
const slug = (s) => String(s || 'cutout').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'cutout'

// The mask graph. A picture: SAM 3 detection from the words, every match joined. A video: SAM 3 tracking from the
// words through every frame (at up to 1008 px; the mask is scaled back up by ffmpeg), all tracked objects joined.
export function cutoutGraph({ kind, source, what, prefix, fps = 24 }) {
  const g = {
    sam: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: SAM } },
    words: { class_type: 'CLIPTextEncode', inputs: { text: what, clip: ['sam', 1] } }
  }
  if (kind === 'image') {
    Object.assign(g, {
      load: { class_type: 'LoadImage', inputs: { image: source } },
      find: { class_type: 'SAM3_Detect', inputs: { model: ['sam', 0], image: ['load', 0], threshold: 0.4, refine_iterations: 2, individual_masks: false, conditioning: ['words', 0] } },
      img: { class_type: 'MaskToImage', inputs: { mask: ['find', 0] } },
      mask: { class_type: 'SaveImage', inputs: { images: ['img', 0], filename_prefix: prefix } }
    })
  } else {
    Object.assign(g, {
      load: { class_type: 'VHS_LoadVideoPath', inputs: { video: source, force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1, format: 'None' } },
      small: { class_type: 'ImageScaleToMaxDimension', inputs: { upscale_method: 'area', largest_size: 1008, image: ['load', 0] } },
      track: { class_type: 'SAM3_VideoTrack', inputs: { detection_threshold: 0.4, max_objects: 0, detect_interval: 1, images: ['small', 0], model: ['sam', 0], conditioning: ['words', 0] } },
      masks: { class_type: 'SAM3_TrackToMask', inputs: { object_indices: '', track_data: ['track', 0] } },
      img: { class_type: 'MaskToImage', inputs: { mask: ['masks', 0] } },
      mask: { class_type: 'VHS_VideoCombine', inputs: { images: ['img', 0], frame_rate: fps, loop_count: 0, filename_prefix: prefix, format: 'video/h264-mp4', pix_fmt: 'yuv420p', crf: 10, save_metadata: false, trim_to_audio: false, pingpong: false, save_output: true } }
    })
  }
  return g
}

export class Cutouts {
  // studio: () => Studio (ComfyUI jobs). edits: Edits (ffmpeg, ffprobe).
  constructor({ dataDir, studio, edits }) {
    this.dir = path.join(dataDir, 'cutouts')
    this.studio = studio
    this.edits = edits
  }

  // file: a picture or a video on this PC. what: the words for what stays ("the woman", "person", "the red car").
  // soften: edge softness in pixels. Resolves (in a minute or so for a 5 s clip) with { file, kind, coverage }:
  // coverage is how much of the frame is kept (0 when SAM 3 found nothing, which throws instead).
  async make({ file, what = 'person', soften = 1.2, name }) {
    if (!file || !fs.existsSync(file)) throw new Error('Pick a picture or a video.')
    const studio = this.studio()
    if (studio.comfy.hosted) throw new Error('Cut-outs run on this computer’s ComfyUI or on your own cloud (RunPod, Modal).')
    const kind = IMAGE.test(file) ? 'image' : 'video'
    const info = await probe(this.edits.ffprobe, file)
    const words = String(what || 'person').trim()
    const base = `${slug(name || path.basename(file).replace(/\.[^.]+$/, ''))}_${slug(words)}_${Date.now().toString(36)}`
    // a video on the person's own cloud is uploaded and read from ComfyUI's input folder (it can't read this PC's path)
    const cloudVideo = kind === 'video' && studio.comfy.ownCloud
    const source = kind === 'image' || cloudVideo ? await studio.comfy.upload(file) : file
    const graph = cutoutGraph({ kind, source, what: words, prefix: `iv_studio/cutouts/${base}_mask`, fps: info.fps || 24 })
    if (cloudVideo) graph.load.class_type = 'VHS_LoadVideo'
    const job = await studio.submitGraph({ kind: 'cutout', graph, name: `Cut out ${words}`, plan: { cutout: { what: words, from: file, kind } } })
    let j = job
    for (const end = Date.now() + 20 * 60e3; Date.now() < end; await new Promise((r) => setTimeout(r, 3000))) {
      j = await studio.refreshJob(job.id)
      if (['success', 'error', 'cancelled'].includes(j.status)) break
    }
    if (j.status !== 'success') throw new Error(j.error || `The cut-out ${j.status || 'took too long'}.`)
    const mask = (j.outputs || []).find((o) => o.kind === 'mask')
    // (a SaveImage output carries no path: it is fetched from ComfyUI into the cut-outs folder)
    const maskFile = mask && (await studio.localCopy(mask, path.join(this.dir, '_masks')))
    if (!maskFile || !fs.existsSync(maskFile)) throw new Error('The cut-out made no mask.')
    // how much the mask keeps (its mean brightness): nothing found means a blank mask
    const stats = await this.edits.runErr(['-hide_banner', '-nostats', '-i', maskFile, '-vf', 'format=gray,signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-'])
    const avgs = [...stats.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]))
    const coverage = avgs.length ? +(avgs.reduce((a, b) => a + b, 0) / avgs.length / 255).toFixed(3) : 0
    if (coverage < 0.002) throw new Error(`SAM 3 found no "${words}" in it. Try other words, like "person" or "the dog".`)
    fs.mkdirSync(this.dir, { recursive: true })
    const W = info.width
    const H = info.height
    const edge = Number(soften) > 0 ? `,gblur=sigma=${Number(soften)}` : ''
    const join = `[1:v]scale=${W}:${H}:flags=bicubic,format=gray${edge}[m];[0:v]format=rgba[c];[c][m]alphamerge`
    let out
    if (kind === 'image') {
      out = path.join(this.dir, `${base}.png`)
      await this.edits.run(['-y', '-v', 'error', '-i', file, '-i', maskFile, '-filter_complex', join, '-frames:v', '1', out])
    } else {
      out = path.join(this.dir, `${base}.webm`)
      await this.edits.run(['-y', '-v', 'error', '-i', file, '-i', maskFile, '-filter_complex', `${join},format=yuva420p[v]`, '-map', '[v]', '-map', '0:a?', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '24', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-auto-alt-ref', '0', '-c:a', 'libopus', '-b:a', '160k', '-shortest', out])
    }
    return { file: out, kind, what: words, coverage, mask: maskFile, jobId: j.id }
  }
}
