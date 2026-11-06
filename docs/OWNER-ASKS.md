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

## 2026-11-05 — Voice input reliability + T3 Code mic

- **Cause found:** mostly the speech model (streaming Nemotron mishears names, ignores the custom word list). Mic is quiet (peaks ~-17 dB) but not the main cause. Delete-key light cleanup was OFF (useCleanupModel=false), so raw words got pasted and agents replied "I don't know what you mean".
- **"The other version" (speed point)** = the Delete key (plain words): fast but does nothing.
- **Speech model:** accurate model after you stop (not live). OK to add ~5-10 sec.
- **Runs where:** on the machine the chat is on (PC chats on PC, VPS chats on VPS).
- **T3 mic modes:** one mode only: always smart rewrite (Opus, same writing style as Page Up) using that chat's memory, then auto send.
- **Memory:** per project/chat, from what the owner and agent said in that conversation.
- **OpenWhispr:** keep it for apps outside T3 Code (Discord, browser, games) and plug it into the same better model.
- **Applied 2026-11-05:** speech model switched to Parakeet TDT 0.6B v3 (after-stop, ~3 sec, adds punctuation; same files as Scar Mic). Page Up prompt writer got the owner's names list + "never reply, always rewrite" as extra instructions. LLM cleanup for Delete stays off on purpose: the new model already punctuates, and an LLM cleanup can answer instead of clean.
