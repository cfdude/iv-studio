# Your own agent inside IV Studio (2026-11-10)

Matthew: "Can we add their AI agent somewhere in there, like Claude Code or Codex, on the main page? It's like, what do
you want to create?" He chose "Runs inside IV Studio" over opening a chat window or copying a message, then approved
this design ("Yes, build it").

## What the person sees

- The Dashboard's "What if?" bar keeps **Make it** and gains **Let Claude Code make it** (or Codex): the agent picked as
  the prompt writer in Settings if it is one of the two, otherwise whichever is installed, Claude Code first. Neither
  installed: no button.
- Pressing it starts a run and shows a panel under the banner: "Claude Code is working", the steps in plain words
  (checked your setup, wrote the prompt, started the previews, rendering 40%), the agent's latest words and **Stop**.
  At the end: what it made and **Open Shots**.
- The run lives in the main process, so it keeps going on other pages; a pill in the top bar shows it and goes to the
  Dashboard.

## How it runs

- `src/service/agentrun.js` spawns the person's own CLI headless on their existing login, in an empty temporary folder:
  - Claude Code: `-p --output-format stream-json --verbose --tools "" --mcp-config <file> --strict-mcp-config
    --allowedTools mcp__iv-studio --permission-mode dontAsk --no-session-persistence --append-system-prompt-file`.
    No built-in tools; only IV Studio's MCP server, whose tools are pre-approved.
  - Codex: `exec --json --skip-git-repo-check --ephemeral --ignore-user-config --sandbox read-only
    -c approval_policy="never"` with the `iv-studio` server given as `-c mcp_servers.iv-studio.*` overrides. A real
    Codex 0.167 call with these arguments used an IV Studio tool headless without asking.
- In an agent run `get_job` waits up to 25 s while a job is queued or running: the agent has no other way to wait, and
  the first real run checked 19 times in 30 s; with the wait the next one checked 8 times in about 3.5 minutes.
- The MCP server is this install's own (`mcpCommand()`), started with `IV_STUDIO_AGENT_RUN=1` and a jobs file.
- One run at a time, 45-minute cap, the writer model from Settings (claudeModel / codexModel).
- The agent is told to make previews of the idea with H3 on this PC, decide for itself (it can't ask), use a character
  only if the idea names one, and stop with one or two sentences on what it made.

## Guardrails (in the MCP server, `agentGuard`)

With `IV_STUDIO_AGENT_RUN=1` the server refuses:
- anything that deletes, installs, downloads or trains (the named list in agentrun.js);
- any spend: `engine` or `way` seedance, or a `confirm_cost` above 0;
- every tool while Settings renders on the cloud (the app also won't start a run then);
- `cancel_job` for a job this run didn't start, and the other cancel tools.

Jobs the run starts are appended to the jobs file. Stop kills the agent and cancels those jobs.

## Checks

- Unit tests: argument builders, the two stream parsers, step labels, the guard.
- An isolated test copy driven over DevTools with a stand-in agent (a script printing a recorded stream): button,
  panel steps, Stop, pill, cloud block.
- Real runs with Matthew's Claude Code in a test copy on his ComfyUI: a paper boat in neon rain (stopped early to fix
  the polling, its three takes still finished) and a lighthouse at dusk (done; three on-brief takes in about 4 minutes).
  One tiny real Codex call (get_menu).

Not covered: a full Codex render run, Mac and Linux.
