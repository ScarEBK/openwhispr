# Owner answers (read before asking)

## 2026-11-03 — Replacing Handy

- **Base app:** Fork OpenWhispr (not Handy, not from scratch).
- **Prompt brain:** Claude through the owner's Claude plan (Claude Code CLI). Must be easy to swap or add others later (e.g. ChatGPT plan via Codex CLI).
- **How it works:** Two shortcut keys. Key 1 = plain words, instant. Key 2 = turns the ramble into a pro prompt.
- **Normal dictation cleanup:** Light fix only (spelling like "cloud" → "Claude", punctuation). Never cut or rewrite.

## Findings (why Handy felt bad)

- Handy's raw transcript was complete. The **Groq cleanup step cut off long recordings** (10-min notes ended mid-sentence).
- Handy waits until you stop, then transcribes everything. OpenWhispr's Nemotron streaming model transcribes **while you talk**, so stop = instant.
