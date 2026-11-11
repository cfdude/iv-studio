// Credits: everything IV Studio is built on, shown in Settings → About → Credits. Each entry names the work, who made it
// (only where that's certain), what IV Studio uses it for, its licence where IV Studio records one, and a link.
// test/credits.mjs fails when resources/models.json gains a model or node pack that isn't credited here, so a new
// download or pack gets its line in the same change (covers: the manifest ids and image families an entry stands for).
export const CREDITS = [
  {
    group: 'Models',
    note: 'IV Studio bundles no model weights. Each downloads from its own page, under its own licence.',
    items: [
      { name: 'MiniMax H3', covers: ['fl2va', 'ref2va', 'video_vae', 'audio_vae', 'image:h3'], by: 'MiniMax', use: 'Every shot: video with sound, references, first and last frames, Continue', licence: 'MiniMax H3 Community License', url: 'https://huggingface.co/MiniMaxAI/MiniMax-H3', note: 'Powered by MiniMax H3. ComfyUI’s packaging by Comfy Org.' },
      { name: 'MiniMax H3 INT4 ConvRot text encoder', covers: ['text_encoder'], by: 'Merserk', use: 'The compact Qwen3-VL text encoder H3 reads prompts with', url: 'https://huggingface.co/Merserk/MiniMax-H3-INT4-ConvRot' },
      { name: 'MiniMax H3 experimental (DMAD turbo LoRA)', covers: ['dmad'], by: 'Kijai', use: 'Fast previews in 4 to 8 steps', url: 'https://huggingface.co/Kijai/MiniMax-H3-experimental' },
      { name: 'TAEH3', covers: ['taeh3'], by: 'Kijai', use: 'The live step pictures while a shot renders', licence: 'Apache-2.0', url: 'https://huggingface.co/Kijai/MiniMax-H3-TAE' },
      { name: 'MiniMax H3 latent upscaler', covers: ['upscaler'], by: 'LBH-123-AI', use: 'The 2 MP finishing pass', url: 'https://huggingface.co/LBH-123-AI/Minimax_h3_latent_Upscaler' },
      { name: 'Viggle Remake', covers: ['remake_swap', 'remake_edit'], by: 'Viggle AI', use: 'Replace: swap people or change the scene, keeping the motion and sound', licence: 'MiniMax H3 Community License (weights), Apache-2.0 (code)', url: 'https://huggingface.co/Viggle/Viggle-Remake', note: 'Powered by Viggle Remake.' },
      { name: 'Seedance 2.5', by: 'ByteDance', use: 'The Seedance model switch on Create, through ComfyUI’s partner nodes on your Comfy.org credits', url: 'https://www.comfy.org' },
      { name: 'SeedVR2', by: 'ByteDance Seed', use: 'Detail restore when finishing and enhancing', url: 'https://github.com/ByteDance-Seed/SeedVR' },
      { name: 'MiniMax Music 3', covers: ['music3_dit', 'music3_te', 'music3_vae'], by: 'MiniMax', use: 'Songs with sung lyrics on the Music page', licence: 'MiniMax-Music3 Community License', url: 'https://huggingface.co/Comfy-Org/MiniMax-Music-3', note: 'Made with MiniMax-Music3.' },
      { name: 'ACE-Step 1.5 Turbo', covers: ['ace15'], use: 'Quick songs and scores on the Music page', licence: 'Apache-2.0', url: 'https://huggingface.co/Comfy-Org/ACE-Step-1.5' },
      { name: 'VoxCPM2', by: 'OpenBMB', use: 'Voices: designing, cloning and speaking lines', licence: 'Apache-2.0', url: 'https://huggingface.co/openbmb/VoxCPM2' },
      { name: 'Whisper large-v3 turbo', by: 'OpenAI', use: 'Reading spoken words back: voices, take ranking, lyrics checks', licence: 'MIT', url: 'https://huggingface.co/openai/whisper-large-v3-turbo' },
      { name: 'Flux.2 Klein 9B and Flux 3 Klein', covers: ['image:flux2', 'image:flux3', 'flux2_unet', 'flux2_te', 'flux2_vae', 'flux3_unet'], by: 'Black Forest Labs', use: 'Pictures, picture edits and storyboard sketches', licence: 'FLUX Non-Commercial License (Flux.2 Klein 9B), FLUX Kommunity License (Flux 3 Klein)', url: 'https://huggingface.co/black-forest-labs' },
      { name: 'MiniMax H3 Image', covers: ['h3image', 'h3image_vae', 'image:h3image'], by: 'MiniMax', use: 'Big pictures (4 to 16 MP) and edits with up to 16 pictures', licence: 'MiniMax-H3-Image Community License', url: 'https://huggingface.co/MiniMaxAI/MiniMax-H3-Image', note: 'ComfyUI’s packaging by Comfy Org.' },
      { name: 'Krea 2', covers: ['image:krea2', 'krea2_unet', 'qwen3vl_4b_te'], by: 'Krea', use: 'Pictures and picture edits', url: 'https://www.krea.ai' },
      { name: 'Qwen Image 2.1', covers: ['image:qwen21', 'qwen21_unet', 'qwen21_vae'], by: 'Qwen (Alibaba)', use: 'Picture edits, place angles and reframing pictures', licence: 'Apache-2.0', url: 'https://huggingface.co/Qwen' },
      { name: 'QMA camera angles LoRA', covers: ['qma'], by: 'gribbliest', use: 'More angles of a place in Projects', licence: 'Apache-2.0', url: 'https://huggingface.co/gribbliest/qwen-image-2.1-qma-camera-angles' },
      { name: 'Qwen Image 2.1 outpaint LoRA', by: 'ausboss', use: 'Reframing a picture to a new shape', url: 'https://huggingface.co/ausboss' },
      { name: 'Z-Image Turbo', covers: ['zimage', 'zimage_te', 'zimage_vae', 'image:zimage'], use: 'Character design stills and pictures', licence: 'Apache-2.0', url: 'https://huggingface.co/Comfy-Org/Z-Image-Turbo' },
      { name: 'Moss', covers: ['image:moss', 'moss_unet', 'moss_te', 'moss_vae'], use: 'Pictures', licence: 'Apache-2.0' },
      { name: 'Stable Diffusion XL', covers: ['sdxl_base', 'image:sdxl'], by: 'Stability AI', use: 'Pictures from any SDXL checkpoint', licence: 'CreativeML Open RAIL++-M (base)', url: 'https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0' },
      { name: 'SAM 3.1', covers: ['sam31'], by: 'Meta', use: 'Cut out, and tracking people and objects in Replace', url: 'https://huggingface.co/Comfy-Org/sam3.1' },
      { name: 'Qwen3-VL', covers: ['describer'], by: 'Qwen (Alibaba)', use: 'Describing clips for Replace’s prompts', url: 'https://huggingface.co/Comfy-Org/Qwen3-VL' },
      { name: 'Qwen3-VL 8B abliterated', by: 'huihui-ai', use: 'The local prompt writer (through Ollama)', licence: 'Apache-2.0', url: 'https://ollama.com/huihui_ai/qwen3-vl-abliterated' },
      { name: 'InsightFace buffalo_l', by: 'InsightFace', use: 'Likeness scores for takes and training checkpoints', licence: 'Non-commercial', url: 'https://github.com/deepinsight/insightface' },
      { name: 'Stable Audio 3 (medium)', by: 'Stability AI', covers: ['sa3', 'sa3_te'], use: 'Sounds: sound effects, ambiences, one-shots and loops', licence: 'Stable Audio Community License', url: 'https://huggingface.co/Comfy-Org/stable-audio-3' },
      { name: 'Qwen Image Edit 2509 and its Relight LoRA', by: 'Qwen (Alibaba)', covers: ['relight_unet', 'relight_te', 'relight_vae', 'relight_lora'], use: 'Relight, in Create → Image → Tools', licence: 'Apache-2.0', url: 'https://huggingface.co/Comfy-Org/Qwen-Image-Edit_ComfyUI' },
      { name: 'Qwen Image Lightning', by: 'lightx2v', covers: ['relight_lightning'], use: 'Relight in 4 steps', licence: 'Apache-2.0', url: 'https://huggingface.co/lightx2v/Qwen-Image-Lightning' },
      { name: 'BiRefNet', by: 'ZhengPeng7', covers: ['birefnet'], use: 'Remove background, for pictures and clips', licence: 'MIT', url: 'https://github.com/ZhengPeng7/BiRefNet' },
      { name: 'MoGe-2', by: 'Microsoft Research', covers: ['moge'], use: 'Depth maps, and the geometry behind Reshoot', licence: 'MIT', url: 'https://github.com/microsoft/MoGe' },
      { name: 'LTX-2.5 (22B distilled, with its Gemma text encoder)', by: 'Lightricks', covers: ['ff_ltx_2_5_22b_distilled_transformer_comfy_int8_convrot', 'ff_gemma4_12b_with_proj_ltx_2_5_comfy_int8_convrot', 'ff_ltx_2_5_video_vae_bf16', 'ff_ltx_2_5_audio_vae_bf16'], use: 'Dub, the VFX passes, SDR to HDR, Transformations and Transitions', licence: 'LTX-2.x Community License', url: 'https://huggingface.co/Lightricks/LTX-2.5' },
      { name: 'LTX IC-LoRAs: DubIt, Clean Plate, Day to Night, Water Simulation, SDR to HDR', by: 'Lightricks', covers: ['ff_ltx_2_3_22b_ic_lora_dubit_0_9', 'ff_ltx_2_5_22b_ic_lora_clean_plate_1_0', 'ff_ltx_2_5_22b_ic_lora_day_to_night_0_9', 'ff_ltx_2_5_22b_ic_lora_water_simulation_0_9', 'ff_ltx_2_5_22b_ic_lora_sdr_to_hdr_1_0', 'ff_ltx_2_5_22b_ic_lora_sdr_to_hdr_scene_emb'], use: 'The editor’s Dub and VFX effects', licence: 'LTX-2.x Community License', url: 'https://huggingface.co/Lightricks' },
      { name: 'LTX transition LoRA', by: 'joyfox', covers: ['ff_ltx2_3_transition'], use: 'Transformations and Transitions', licence: 'Apache-2.0', url: 'https://huggingface.co/joyfox/LTX-2.3-Transition-LORA' },
      { name: 'Wan 2.1 image-to-video 14B', by: 'Wan (Alibaba)', covers: ['ff_wan2_1_i2v_480p_14b_fp8_scaled', 'ff_umt5_xxl_fp8_e4m3fn_scaled', 'ff_clip_vision_h', 'ff_wan_2_1_vae'], use: 'The Effects gallery', licence: 'Apache-2.0', url: 'https://huggingface.co/Comfy-Org/Wan_2.1_ComfyUI_repackaged' },
      { name: 'Wan 2.1 effect LoRAs', by: 'Remade-AI, joyfox, lvfengchun and ostris', covers: ['ff_cakeify_16_epochs', 'ff_angry_face_5_epochs', 'ff_crying_20_epochs', 'ff_laughing_15_epochs', 'ff_puppy_50_epochs', 'ff_wan21_penqi_000003500', 'ff_money_000003000', 'ff_crush_20_epochs', 'ff_deflate_20_epochs', 'ff_electrify_50_epochs', 'ff_explode_30_epochs', 'ff_inflate_20_epochs', 'ff_rotate_20_epochs', 'ff_squish_18', 'ff_360_orbit', 'ff_arc_shot', 'ff_wan21_i2v_rotation_000003750', 'ff_car_chase', 'ff_crane_down', 'ff_crane_overhead', 'ff_crane_up', 'ff_crash_zoom_in', 'ff_wan_21_i2v_dolly_zoom', 'ff_hero_run'], use: 'The 24 effects: Cakeify, Explode, Money rain, 360° orbit and the rest', licence: 'Apache-2.0', url: 'https://huggingface.co/Remade-AI' },
      { name: 'Wan 2.1 step-distill LoRA', by: 'lightx2v', covers: ['ff_lightx2v_i2v_14b_480p_cfg_step_distill_rank64_bf16'], use: 'Fast Effects', licence: 'Apache-2.0', url: 'https://huggingface.co/Kijai/WanVideo_comfy' },
      { name: 'MiniMax H3 Turbo (ref2v, 8 steps)', by: 'lightx2v', covers: ['ff_minimax_h3_ref2v_turbo_8step_v1_0_768p_comfyui_bf16'], use: 'Reshoot in 8 steps', url: 'https://huggingface.co/lightx2v/Minimax-h3-Turbo' },
      { name: 'FILM frame interpolation', by: 'Google Research', covers: ['ff_film_net_fp16'], use: 'Smooth and slow motion', licence: 'Apache-2.0', url: 'https://github.com/google-research/frame-interpolation' },
      { name: 'Real-ESRGAN and RIFE', use: 'Upscaling and frame interpolation for finals in the cloud and on Linux', url: 'https://github.com/xinntao/Real-ESRGAN' },
      { name: 'Turnaround LoRA (Contact-Sheet diffusion)', by: 'matlod', use: 'Characters: five views of a character from one picture', licence: 'MiniMax H3 Community License', url: 'https://huggingface.co/matlod/minimax-h3-turnaround' },
      { name: 'Camera Motion and Spatial Physics LoRAs', by: 'Jojocodex', use: 'Recommended LoRAs: camera moves, and objects that collide and fall believably', licence: 'Apache-2.0', url: 'https://huggingface.co/Jojocodex/minimax-h3-Camera-Motion-lora' },
      { name: 'Natural Face Speech LoRA', by: 'vpakarinen', use: 'Recommended LoRAs: natural faces and clear speech', licence: 'Apache-2.0', url: 'https://huggingface.co/vpakarinen/natural-face-speech-h3-lora' },
      { name: 'Motion Continuity Repair LoRA', by: 'JOKER141', use: 'Recommended LoRAs: bodies that stay whole through fast action', licence: 'MiniMax H3 Community License', url: 'https://huggingface.co/JOKER141/MiniMax-H3-General-Motion-Continuity-Repair' },
      { name: 'Head-mounted FPV LoRA', by: 'neph1', use: 'Recommended LoRAs: a first-person camera', licence: 'MiniMax H3 Community License', url: 'https://huggingface.co/neph1/minimax_h3_headmounted_fpv_cam' },
      { name: '360° Orbit LoRA', by: 'pablodawson', use: 'Recommended LoRAs: a frozen moment with the camera going all the way round', licence: 'MiniMax H3 Community License', url: 'https://huggingface.co/pablodawson/MiniMax-H3-360-Orbit-LoRA' },
      { name: 'Transformation LoRA', by: 'Ashmotv', use: 'Recommended LoRAs: one picture morphing into another', licence: 'MiniMax H3 Community License', url: 'https://huggingface.co/Ashmotv/transformation_lora' }
    ]
  },
  {
    group: 'Tools IV Studio runs on',
    items: [
      { name: 'ComfyUI', by: 'Comfy Org', use: 'Everything that renders: IV Studio is a front end for ComfyUI', licence: 'GPL-3.0', url: 'https://github.com/comfyanonymous/ComfyUI' },
      { name: 'Fizgig', by: 'shootthesound', use: 'Character LoRA training, on this PC, Modal and RunPod. RunPod training pods start from Fizgig’s own template.', url: 'https://github.com/shootthesound/Fizgig' },
      { name: 'Freefield', by: 'Sammir Femat (neuregex)', use: 'The workflows behind Sounds, the picture tools, the editor’s Effects (dub, VFX, slow motion) and Workflows → Effects', licence: 'MIT', url: 'https://github.com/neuregex/freefield' },
      { name: 'OpenKatana', by: 'rk0neki', use: 'Shinobi, the motion-graphics films', licence: 'Apache-2.0', url: 'https://github.com/rk0neki/OpenKatana' },
      { name: 'OpenJutsu', by: 'D3voz', use: 'Replace’s earlier engine, and Finish (faces and colours)', licence: 'MIT', url: 'https://github.com/D3voz/openjutsu' },
      { name: 'Ollama', use: 'Runs the local prompt writer', licence: 'MIT', url: 'https://ollama.com' },
      { name: 'three.js', use: 'Previs: the staging board in motion', licence: 'MIT', url: 'https://threejs.org' },
      { name: 'FFmpeg', use: 'Exports, trims, reels, cut-outs and media checks', licence: 'GPL-3.0 (the bundled builds)', url: 'https://ffmpeg.org', note: 'Windows and Linux: BtbN’s builds. Mac: Martin Riedl’s GPL build.' },
      { name: 'uv', by: 'Astral', use: 'Installs the Python tools (voices, Shinobi, cloud tools)', url: 'https://github.com/astral-sh/uv' },
      { name: 'Claude Code and Codex', by: 'Anthropic and OpenAI', use: 'Optional prompt writers and reviewers, on your own logins' }
    ]
  },
  {
    group: 'ComfyUI node packs',
    note: 'Setup installs these from their own repositories, at pinned versions, under their own licences.',
    items: [
      { name: 'ComfyUI-MiniMaxH3Mod (RefMods)', by: 'Luisacaotica', use: 'RefMods and RefMod characters', licence: 'MIT', url: 'https://github.com/Luisacaotica/ComfyUI-MiniMaxH3Mod' },
      { name: 'Fantastic MiniMaxH3 PromptBuilder', by: 'Adudeguyman', use: 'The media loader for References mode', url: 'https://github.com/Adudeguyman/ComfyUI-Fantastic-MiniMaxH3-PromptBuilder' },
      { name: 'MiniMax H3 latent upscaler nodes', by: 'LBH-123-AI', use: 'The 2 MP finishing pass', url: 'https://github.com/LBH-123-AI/Comfyui_Minimax_h3_latent_Upscaler' },
      { name: 'VideoHelperSuite', by: 'Kosinkadink', use: 'Loading and saving video', url: 'https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite' },
      { name: 'DLSS5 Enhancer v15', by: 'Strix-3D', use: 'Quick sharpen (DLSS 5) when finishing', url: 'https://github.com/Strix-3D/ComfyUI-DLSS5-Enhancer-v15' },
      { name: 'rgthree-comfy', by: 'rgthree', use: 'Switches in the shot workflow', url: 'https://github.com/rgthree/rgthree-comfy' },
      { name: 'Impact Pack', by: 'ltdrdata', use: 'Utility nodes in the shot workflow', url: 'https://github.com/ltdrdata/ComfyUI-Impact-Pack' },
      { name: 'ComfyUI-Pixaroma', by: 'Pixaroma', use: 'The LoRA loader; its by-hash lookup inspired IV Studio’s LoRA pages', url: 'https://github.com/pixaroma/ComfyUI-Pixaroma' },
      { name: 'ComfyUI-Easy-Use', by: 'yolain', use: 'Seeds', url: 'https://github.com/yolain/ComfyUI-Easy-Use' },
      { name: 'ComfyUI_essentials', by: 'cubiq', use: 'Maths nodes', url: 'https://github.com/cubiq/ComfyUI_essentials' },
      { name: 'ComfyUI-KJNodes', by: 'Kijai', use: 'Live previews and utility nodes', url: 'https://github.com/kijai/ComfyUI-KJNodes' },
      { name: 'ComfyUI-H3-Multishot', by: 'jlucasmcrell', use: 'Sequences: one continuous take, retakes', url: 'https://github.com/jlucasmcrell/ComfyUI-H3-Multishot' },
      { name: 'MiniMax H3 Context Loop', by: 'ethanfel', use: 'Replace and Reframe', url: 'https://github.com/ethanfel/ComfyUI-MiniMaxH3-Context-Loop' },
      { name: 'H3 One-Click Swap', by: 'D3voz', use: 'Replace’s earlier engine', url: 'https://github.com/D3voz/comfyui-h3-oneclick-swap' },
      { name: 'H3 Face Refine', by: 'Carasibana', use: 'Replace: faces', url: 'https://github.com/Carasibana/ComfyUI-H3-FaceRefine' },
      { name: 'Image Detail Contrast', by: 'D3voz', use: 'Replace: finishing', url: 'https://github.com/D3voz/comfyui-image-detail-contrast' },
      { name: 'Orion4D FXMax', by: 'orion4d', use: 'Replace: colours', url: 'https://github.com/orion4d/Orion4D_FXMax' },
      { name: 'Spectrum for MiniMax H3', by: 'xmarre', use: 'Replace', url: 'https://github.com/xmarre/ComfyUI-Spectrum-MiniMax-H3' },
      { name: 'SeedVR2 Video Upscaler', by: 'numz', use: 'Detail restore (SeedVR2)', url: 'https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler' },
      { name: 'ComfyUI Frame Interpolation (RIFE)', by: 'Fannovel16', use: 'Frame interpolation for finals on Linux and in the cloud', url: 'https://github.com/Fannovel16/ComfyUI-Frame-Interpolation' },
      { name: 'Viggle Remake nodes and prompt guide', by: 'Viggle AI', use: 'Replace (Remake)', licence: 'Apache-2.0', url: 'https://huggingface.co/Viggle/Viggle-Remake/tree/main/comfyui/ComfyUI-Viggle-Remake' },
      { name: 'ComfyUI-LTXVideo', by: 'Lightricks', use: 'Dub, VFX and SDR to HDR', url: 'https://github.com/Lightricks/ComfyUI-LTXVideo' },
      { name: 'ComfyUI-H3-ContactSheet', by: 'matlowai', use: 'Turnaround sheets: packs five pictures into one H3 run and decodes them', licence: 'GPL-3.0', url: 'https://github.com/matlowai/ComfyUI-H3-ContactSheet' },
      { name: 'IV Studio nodes', by: 'Infinite Variance', use: 'The latent cache, picks that survive restarts, the shot list', licence: 'MIT', url: 'https://github.com/hollisorg/iv-studio/tree/main/resources/comfy-nodes/ComfyUI-IV-Studio' }
    ]
  },
  {
    group: 'Methods and guides',
    items: [
      { name: 'The Claire character method', by: 'u/DeliciousGorilla', use: 'Designing and training H3 characters: stills, talking clips and the dataset', url: 'https://www.reddit.com/user/DeliciousGorilla' },
      { name: 'H3 prompt-writing guide', by: 'MiniMax', use: 'How the prompt writers shape H3 prompts (downloaded from MiniMax on first use)', licence: 'MiniMax H3 Community License', url: 'https://github.com/MiniMax-AI/MiniMax-H3' },
      { name: 'Directing workflow', by: 'Matthew Hollis', use: 'Staging, reviews and the writers’ direction rules' },
      { name: 'Slate', by: 'Sam Wasserman (wassermanproductions.com)', use: 'The Cinematography setups and coverage plans (bundled unchanged), and the ideas behind the prompt tools, continuity check, Lookbook and shot list', licence: 'Apache-2.0', url: 'https://wassermanproductions.com', note: 'Through Imagination Studio by keys + Wasserman. Slate’s NOTICE ships in resources/slate.' },
      { name: 'Imagination Studio', by: 'keys and Sam Wasserman', use: 'Ideas for catching cuts in a take, checking first and last frames, the "no X" warning, export to Premiere and Resolve, the Recommended LoRAs shelf, turnaround sheets, search by what’s in a file, a soft mouth on reference videos and dailies (no code used)', licence: 'Apache-2.0', url: 'https://github.com/drowzeys/Imagination-Studio-by-keys-Wasserman' },
      { name: 'Valtz', by: 'tgo-app-dev', use: 'Ideas for the prompt checker, @ mentions, versions and Compare (no code used)', url: 'https://github.com/tgo-app-dev/valtz' }
    ]
  },
  {
    group: 'Clouds and services',
    items: [
      { name: 'RunPod', use: 'Cloud rendering and training on your own account', url: 'https://www.runpod.io' },
      { name: 'Modal', use: 'Cloud rendering and training on your own account', url: 'https://modal.com' },
      { name: 'Comfy Cloud and Comfy.org', by: 'Comfy Org', use: 'Comfy Cloud rendering, and partner nodes such as Seedance on your credits', url: 'https://www.comfy.org' },
      { name: 'Civitai', use: 'Finding and downloading LoRAs', url: 'https://civitai.com' },
      { name: 'Hugging Face', use: 'Where the models download from', url: 'https://huggingface.co' }
    ]
  },
  {
    group: 'The app itself',
    items: [
      { name: 'Electron', use: 'The app (with Chromium and Node.js)', licence: 'MIT', url: 'https://www.electronjs.org' },
      { name: 'React', use: 'The window', licence: 'MIT', url: 'https://react.dev' },
      { name: 'Model Context Protocol SDK', use: 'The MCP server agents use', licence: 'MIT', url: 'https://github.com/modelcontextprotocol/typescript-sdk' },
      { name: 'zod', use: 'The MCP tools’ inputs', licence: 'MIT', url: 'https://zod.dev' },
      { name: 'electron-updater', use: 'Updates on Windows and Linux', licence: 'MIT', url: 'https://github.com/electron-userland/electron-builder' },
      { name: 'js-yaml', use: 'Reading the update feed on a Mac', licence: 'MIT', url: 'https://github.com/nodeca/js-yaml' },
      { name: 'JSONata', use: 'Working out partner-node prices', licence: 'MIT', url: 'https://jsonata.org' },
      { name: 'Barlow and Barlow Condensed', by: 'Jeremy Tribby', use: 'Display type and exported titles', licence: 'SIL OFL 1.1', url: 'https://github.com/jpt/barlow' },
      { name: 'DM Sans', by: 'Colophon Foundry', use: 'Body type', licence: 'SIL OFL 1.1', url: 'https://github.com/googlefonts/dm-fonts' },
      { name: 'JetBrains Mono', by: 'JetBrains', use: 'Monospace type', licence: 'SIL OFL 1.1', url: 'https://www.jetbrains.com/lp/mono/' }
    ]
  }
]
