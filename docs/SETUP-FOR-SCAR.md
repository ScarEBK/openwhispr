# Setting up your new voice app (5 minutes)

The app is already running on your PC (test mode).

1. **Skip sign-in.** You don't need an OpenWhispr account. Pick the free / local option during setup.
2. **Pick the speech model:** Settings → Transcription → local models →
   **"Nemotron Speech Streaming EN 0.6B"**. It types while you talk, so when you stop, the text is ready almost instantly.
   - If you want max accuracy and don't mind a short wait: **"Parakeet Unified EN 0.6B"**.
3. **Shortcut key 1 (plain words):** Settings → General → Dictation Hotkey.
4. **Shortcut key 2 (prompt writer):** Settings → General → **Prompt Writer Hotkey**.
   - "Which AI writes the prompt": **Claude** (uses your Claude plan, no extra cost).
   - Model: leave empty for **Opus** (best, ~20-45 sec for a long ramble). Type `sonnet` for faster.
   - Press **Test it** to check it works.
5. **Light cleanup (optional):** Settings → AI cleanup → turn on, pick **Groq** and paste the same Groq key Handy used.
   Add words it gets wrong (Claude, Claude Code, Opus, Handy) to **Custom Dictionary**.

## Good to know
- If the prompt writer ever fails, your plain words get pasted instead. Nothing is lost.
- **ChatGPT option:** works once you sign in to Codex again (run `codex login` in a terminal).
- Turn off Handy so the two apps don't fight over the same shortcut keys.
