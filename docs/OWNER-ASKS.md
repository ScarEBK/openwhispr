# Owner answers (read before asking)

## 2026-11-03 — Replacing Handy

- **Base app:** Fork OpenWhispr (not Handy, not from scratch).
- **Prompt brain:** Claude through the owner's Claude plan (Claude Code CLI). Must be easy to swap or add others later (e.g. ChatGPT plan via Codex CLI).
- **How it works:** Two shortcut keys. Key 1 = plain words, instant. Key 2 = turns the ramble into a pro prompt.
- **Normal dictation cleanup:** Light fix only (spelling like "cloud" → "Claude", punctuation). Never cut or rewrite.

## Findings (why Handy felt bad)

- Handy's raw transcript was complete. The **Groq cleanup step cut off long recordings** (10-min notes ended mid-sentence).
- Handy waits until you stop, then transcribes everything. OpenWhispr's Nemotron streaming model transcribes **while you talk**, so stop = instant.

## 2026-11-03 — Pause media, Discord mute, overlay, auto send

- **Prompt writer key:** Page Up (was Insert). Delete stays plain dictation.
- **While recording:** pause Spotify/YouTube (real pause, not mute) and mute Discord. Restore only what the app changed.
- **Discord:** use the Discord link (RPC with a small Discord app the owner authorizes once). Not a keybind.
- **Auto send (press Enter after paste):** both keys.
- **On-screen box:** show only (no editing, never takes focus), Page Up only, bottom center, stays on top incl. games, shows status + raw text then final, fades after paste.

## 2026-11-03 — Box position

- Prompt box sits **right above the text box being typed in** (T3 Code, Claude), on that screen. Not fixed bottom-center.
- **Hide the right-side OpenWhispr bubble for Page Up**; keep it for Delete.
