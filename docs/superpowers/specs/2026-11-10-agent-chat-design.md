# Chat with your own Claude Code or Codex inside IV Studio (2026-11-10)

Matthew: "I wonder if we can add some type of chat now that we're connecting to Codex." He chose a chat inside IV
Studio, a side panel on every page, and "ask me first for risky things"; the goal: "use it almost like they would in an
MCP from one of the apps, but internally inside IV Studio"; and "this needs to exist in both Mac and Linux versions".

## What the person sees

- A **Chat** button in the title bar opens a panel down the right side, over whatever page is open. It stays open as
  they move around and closes with ×.
- At the top: Claude Code or Codex (whichever is installed and signed in), **New chat**, and the last few chats. With
  neither ready, the panel shows the Install / Sign in rows (AgentSetup.jsx).
- The conversation: their messages, the agent's replies, its tool steps in plain words (folded, like the Dashboard
  panel), renders it started with progress and **Open Shots**, and **Stop** while it works. Enter sends,
  Shift+Enter is a new line.
- Each message quietly carries what IV Studio is showing: the page and the open shot, film, sequence, edit, website
  film, rebuild or character, by id, so "make this one longer" works.
- **Allow / Don't allow** cards for anything that deletes, may cost money (Seedance, a confirm_cost above 0, anything
  that starts work while Settings renders on the cloud, training), installs or downloads, updates ComfyUI or changes
  Settings. Nothing runs unless they click Allow; Don't allow tells the agent no.
- Chats are saved in IV Studio's data folder (Incognito keeps its own), the last 20 kept.

## How it runs

- Every IV Studio MCP tool is available, like adding IV Studio to Claude Desktop or Codex; the agent has no other
  tools (no files, no shell).
- One turn per message, headless on the person's own login, in the chat's own folder:
  - Claude Code: the agent-run arguments without `--no-session-persistence`, plus `--resume <session>` after the
    first message; the session id comes from the stream. `MCP_TOOL_TIMEOUT` is raised so a wait for Allow isn't cut off.
  - Codex: `exec --json` first, then `exec resume <thread>` (resume takes no `--sandbox`/`-C`, so the sandbox is
    `-c sandbox_mode="read-only"` and the folder is the process's working folder); `tool_timeout_sec` raised.
- The MCP server runs with `IV_STUDIO_AGENT_RUN=chat`: it skips the Dashboard run's refusals, asks instead
  (`chatAsk` in agentrun.js says why), writes an ask file in the chat's folder and waits up to 10 minutes for the
  answer file the app writes when the person clicks. get_job waits up to 25 s as in an agent run.
- One agent at a time: a chat turn and the Dashboard's "Let Claude Code make it" don't run together.
- Stop ends the turn's whole process tree (Windows `taskkill /T`; Mac and Linux a process group) and cancels the
  renders that turn started.

## Mac and Linux

Nothing here is Windows-only: the agents are found by harness.js on all three, spawned directly (an npm `.cmd` only on
Windows), and Mac/Linux processes start in their own group so Stop ends the agent and its MCP server. The unit tests
cover the Mac/Linux branches; no real Mac or Linux run is possible on this PC.

## Checks

- Unit: chat arguments (first turn and resume, both agents), session ids from both streams, chatAsk, the ask/answer
  round trip through the built MCP server, a stand-in agent's turn (reply, Stop, Allow and Don't allow).
- Test copy with a stand-in agent: button, panel on every page, send, steps, Allow card, Stop, history, small window.
- Real: two-message chats on Claude Code and Codex, and one Allow on Claude Code.
