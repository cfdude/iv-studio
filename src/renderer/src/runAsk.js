// The two buttons on a run in the Shot page that hand it to the person's own agent (Claude Code or Codex), worded for
// what each one does. One opens the chat about the run and waits for the person to type; the other sends a fixed
// question at once and the agent ranks the takes and says which it would finish.
export const runAskWords = (agent) => ({
  chat: { label: `Chat with ${agent} about this run`, title: `Opens the chat with this run attached. You write the question; nothing is sent until you do.` },
  pick: { label: `Have ${agent} pick the best take`, title: `Sends ${agent} one fixed question right away: it ranks the takes, looks closely at the best two and says which it would finish. It doesn't finish anything until you say so.` }
})
