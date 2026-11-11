// The start menu an agent offers when the person opens a chat with IV Studio: what they can make. Each entry is
// also an MCP prompt (a slash command in clients that show prompts, like Claude Code's /mcp__iv-studio__...), and
// get_menu returns the list for clients that don't. `brief` is what the agent is told when the person picks it.
export const START_MENU = [
  {
    id: 'make_a_shot',
    title: 'Make a video shot',
    blurb: 'An idea in plain words becomes an H3 shot: previews first, then you pick one to finish.',
    args: { idea: 'What happens in the shot, in plain words (optional)', character: 'Which character, e.g. Tess (optional)' },
    brief: `Make one H3 shot. Ask for whatever is missing: the idea, the character (list_characters), the mode (text, references, first/last frame, continue) and the length. Write the prompt with write_prompt (free local writer), show it, then generate_previews (usually 3) and poll get_job. Show the previews, let the person pick one, then finish it with finish_candidate.`
  },
  {
    id: 'make_a_picture',
    title: 'Make or edit a picture',
    blurb: 'Pictures from a prompt, or a picture changed with an instruction, on six image models.',
    args: { idea: 'What the picture shows, or how to change one (optional)' },
    brief: `Make or edit a picture (Create -> Image). Call list_image_models, ask whether they want a new picture or to change one (edit needs a picture path), pick a model family that suits it, then make_image and poll get_image. Show the results; offer "use in a shot" or another round.`
  },
  {
    id: 'make_a_film',
    title: 'Make a short film',
    blurb: 'From an idea (or a script) to a storyboard, takes and a finished film, step by step.',
    args: { idea: 'The film: a logline, an idea or a whole script (optional)' },
    brief: `Make a short film as a project (the app's Projects page, a six-step wizard the person can follow). create_film with their idea as the logline, then write_film_script for a first draft (or set_film_script with theirs) and get their OK on the script. Check the cast and places (update_film: describe each place), then break_down_film: it plans the shots, writes their prompts and sketches a storyboard. When get_film shows it done, walk the person through the storyboard and get their OK before filming anything. Then film scene by scene (render_film_scene), show each shot's takes, finish_film_shot the ones they pick, and build_rough_cut. Follow the guide's Projects section.`
  },
  {
    id: 'make_a_sequence',
    title: 'Make a longer scene',
    blurb: 'Several shots that play as one continuous video, in one take or shot by shot.',
    args: { story: 'The scene, beat by beat (optional)' },
    brief: `Make a sequence (several shots as one continuous video). Ask for the story and the character, split it into 10 or 15 s shots, and confirm the shot list before rendering. Follow the guide's Sequences section (save_sequence, then the one-take or shot-by-shot render), poll get_job, then offer a render out.`
  },
  {
    id: 'voice_line',
    title: 'Give a character a line to say',
    blurb: "A spoken line in a character's own voice, ready to use in a shot.",
    args: { line: 'The words to say (optional)', character: 'Who says it (optional)' },
    brief: `Make a spoken line. Use list_voices and the character's voice (or design one with the person), speak it with speak_line, play it back, and offer to use it as a shot's voice line.`
  },
  {
    id: 'make_music',
    title: 'Write a song or score',
    blurb: 'A song with lyrics, or music for a video, made on this computer.',
    args: { idea: 'The mood, style or lyrics (optional)' },
    brief: `Make music. Ask for the style, mood and length, and whether it has lyrics (MiniMax Music 3 sings clearly; ACE-Step is quicker for instrumentals). Make it with make_music, then offer it for an edit or as a shot's sound.`
  },
  {
    id: 'edit_video',
    title: 'Cut my renders together',
    blurb: "Put shots, music and titles on IV Studio's timeline and export a finished video.",
    args: { goal: 'What the finished video is for (optional)' },
    brief: `Cut an edit. list_renders and list_edits, ask what the video is for and which renders to use, then build it with add_media and edit_timeline (titles, music, fades). Check frames with grab_frame, then export_edit. The person sees every change live in the Edit page.`
  },
  {
    id: 'website_sizzle',
    title: 'Turn a website into a promo film',
    blurb: "Give a web address; get a storyboard, then a cut film from the site's own look.",
    args: { url: 'The website address (optional)' },
    brief: `Make a website sizzle. Ask for the address, then follow the guide's Website sizzle section: capture the site, write the storyboard and get the person's OK on it before anything renders, then make the pieces and the first cut.`
  },
  {
    id: 'replace_someone',
    title: 'Swap someone in a video',
    blurb: 'Put a character in place of a person, or change an object, keeping the camera and motion.',
    args: { video: 'Path of the video (optional)' },
    brief: `Replace someone or something in a video. Ask for the video and who or what goes in, run the mask check first and show it, then the replace. Follow the guide's Replace section.`
  },
  {
    id: 'new_character',
    title: 'Design and train a new character',
    blurb: 'A recurring actor of your own: designed faces, clips, then a LoRA trained on your Modal account.',
    args: { idea: 'Who the character is (optional)' },
    brief: `Design and train a new character. Follow the guide's "Train a new character" section. Training bills the person's Modal account: give the estimate and get a clear yes before start_training (confirm_cost).`
  },
  {
    id: 'show_me_around',
    title: 'Show me what IV Studio can do',
    blurb: 'A quick tour of what is set up on this computer and what you could make first.',
    args: {},
    brief: `Give a short tour. Run check_setup, list_characters and list_renders, then say in a few plain lines what's ready, what's missing, and three things they could make right now, and offer the menu (get_menu) to start one.`
  }
]

// What the agent is told to do when a chat starts with IV Studio and no request.
export const MENU_RULE = `When a new chat starts with IV Studio and the person hasn't said what they want, offer the start menu: call get_menu and give the choices as one multiple-choice question (your app's question or options tool if it has one, otherwise a short numbered list), plus "something else". The same choices are slash commands in apps that show MCP prompts.`

// The text an MCP prompt returns: the person's pick plus what they filled in, then the brief.
export function menuMessage(entry, args = {}) {
  const given = Object.entries(args).filter(([, v]) => v && String(v).trim())
  return [
    `I picked "${entry.title}" from IV Studio's menu.`,
    given.length ? given.map(([k, v]) => `${k}: ${v}`).join('\n') : '',
    `\n(For the agent) ${entry.brief} If you haven't yet this chat, call get_guide first. Ask before anything that costs money or deletes.`
  ]
    .filter(Boolean)
    .join('\n')
}
