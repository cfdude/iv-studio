IV Studio portable: your data folder

IV Studio keeps everything it makes and installs for itself in this folder because it sits next to
IV Studio.exe: projects, edits, voices, trainings, the voice engine and Shinobi, settings and keys.
Nothing goes into %APPDATA%. Keep this folder with IV Studio.exe; move or copy the whole IV Studio folder
to take it to another drive or PC.

ComfyUI isn't in here. IV Studio uses the ComfyUI you already have (set its folder in Settings), and H3
models, LoRAs and renders download into that ComfyUI's own folders.

Updates install themselves: IV Studio downloads a new version in the background, then Update to ...
(bottom of the sidebar) or Settings > Updates restarts into it. It replaces the program files beside
IV Studio.exe and never touches this data folder. Its download and log sit in the updates folder here.

Delete this "data" folder (or rename it) and IV Studio uses the installed app's data folder instead.
