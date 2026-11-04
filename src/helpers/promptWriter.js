// Prompt Writer: turns a spoken ramble into a strong prompt for an AI coding
// agent, using a command-line AI tool the user is already signed in to
// (Claude Code on a Claude plan, Codex on a ChatGPT plan). No API key needed.
//
// Adding another tool = add one entry to CLI_PRESETS.

const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const debugLogger = require("./debugLogger");

const DEFAULT_TIMEOUT_MS = 240_000;

const PROMPT_WRITER_SYSTEM_PROMPT = `You turn a person's spoken voice note into an excellent prompt for an AI coding agent (Claude Code, Codex, or a similar agent running a top model).

The voice note is raw speech-to-text: long, rambling, repetitive, with filler words, half-finished thoughts, frustration, and mis-heard words. The speaker is not a programmer. Your job is to work out what they actually want and write the prompt they would have written if they were an expert at prompting AI agents.

How to write it:
- Write in the first person, as the speaker talking to the agent ("I want...", "Please..."). Never mention the voice note, the transcript, or yourself.
- Start with one or two sentences that state the goal plainly.
- Then give the context the agent needs: what exists today, what is wrong with it, and why the speaker cares. The "why" matters: agents do better work when they know the purpose.
- Then list the concrete requirements. Keep every specific detail the speaker gave: names, numbers, tools, examples, likes and dislikes, things they said not to do. Losing a detail is the worst mistake you can make.
- Add a short "Done when" list: how the agent and the speaker can tell the job is finished.
- If the speaker was unsure or contradicted themselves, do not guess. Put it under "Questions to ask me first" so the agent asks before acting on it.
- Add an "Ideas worth considering" section with a few genuinely useful suggestions the speaker did not say but would likely want (better approaches, edge cases, things to check). Keep these clearly separate from what the speaker asked for, and keep them short.
- Drop filler, repetition, venting, and apologies, but keep the intent and the priorities behind them (for example, if they repeated something many times, it is important: say so).
- Fix obvious mis-hearings using context (for example "cloud code" means "Claude Code", "cloud" often means "Claude", "hand-y" means "Handy").
- Use short headings and bullet points. Plain, direct language. No hype.
- Leave out any section that would be empty.

Output only the finished prompt, ready to paste. No preamble, no closing remarks, no code fences around the whole thing.`;

const CLI_PRESETS = {
  claude: {
    label: "Claude (your Claude plan, via Claude Code)",
    command: "claude",
    defaultModel: "opus",
    // Claude Code takes the system prompt as a file and the voice note on stdin.
    buildArgs: ({ model, systemPromptFile }) => [
      "-p",
      "--model",
      model,
      "--system-prompt-file",
      systemPromptFile,
      "--tools",
      "",
      "--strict-mcp-config",
      "--no-session-persistence",
      "--setting-sources",
      "",
      "--output-format",
      "text",
    ],
    // Keep the user's personal CLAUDE.md rules out of the prompt writer.
    env: { CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1" },
    stdinIncludesSystemPrompt: false,
    readsOutputFile: false,
  },
  codex: {
    label: "ChatGPT (your ChatGPT plan, via Codex CLI)",
    command: "codex",
    defaultModel: "",
    buildArgs: ({ model, outputFile }) => [
      "exec",
      "--skip-git-repo-check",
      "--ephemeral",
      "-s",
      "read-only",
      "-c",
      "project_doc_max_bytes=0",
      "--color",
      "never",
      ...(model ? ["-m", model] : []),
      "-o",
      outputFile,
      "-",
    ],
    env: {},
    // Codex exec has no system prompt flag, so the instructions lead the input.
    stdinIncludesSystemPrompt: true,
    readsOutputFile: true,
  },
};

function listPresets() {
  return Object.entries(CLI_PRESETS).map(([id, p]) => ({
    id,
    label: p.label,
    defaultModel: p.defaultModel,
  }));
}

// Finds the real executable so we can avoid going through a shell where possible.
function resolveCommand(command, customPath) {
  if (customPath && fs.existsSync(customPath)) {
    return { file: customPath, useShell: /\.(cmd|bat)$/i.test(customPath) };
  }
  if (process.platform !== "win32") return { file: command, useShell: false };
  try {
    const found = execFileSync("where.exe", [command], { encoding: "utf8", windowsHide: true })
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const exe = found.find((f) => /\.exe$/i.test(f));
    if (exe) return { file: exe, useShell: false };
    const cmd = found.find((f) => /\.(cmd|bat)$/i.test(f));
    if (cmd) return { file: cmd, useShell: true };
  } catch {
    // fall through
  }
  // Common install spots in case the app was started without the user's PATH.
  const home = os.homedir();
  const guesses = [
    path.join(home, ".local", "bin", `${command}.exe`),
    path.join(home, "AppData", "Roaming", "npm", `${command}.cmd`),
  ];
  const guess = guesses.find((g) => fs.existsSync(g));
  if (guess) return { file: guess, useShell: /\.cmd$/i.test(guess) };
  return { file: command, useShell: true };
}

// cmd.exe needs quoting when args go through a shell (only used for .cmd shims,
// whose args here never contain user text).
function shellQuote(arg) {
  if (arg === "") return '""';
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function buildSystemPrompt(extraInstructions) {
  const extra = (extraInstructions || "").trim();
  return extra
    ? `${PROMPT_WRITER_SYSTEM_PROMPT}\n\nExtra instructions from the speaker (always follow these):\n${extra}`
    : PROMPT_WRITER_SYSTEM_PROMPT;
}

/**
 * @param {{ text: string, tool?: string, model?: string, extraInstructions?: string,
 *           customPath?: string, timeoutMs?: number }} options
 * @returns {Promise<{ success: boolean, text?: string, error?: string, ms: number }>}
 */
async function runPromptWriter({
  text,
  tool = "claude",
  model,
  extraInstructions,
  customPath,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  const started = Date.now();
  const preset = CLI_PRESETS[tool];
  if (!preset) return { success: false, error: `Unknown prompt writer tool: ${tool}`, ms: 0 };
  const transcript = (text || "").trim();
  if (!transcript) return { success: false, error: "Nothing was said.", ms: 0 };

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "openwhispr-prompt-"));
  const systemPromptFile = path.join(workDir, "system-prompt.txt");
  const outputFile = path.join(workDir, "output.txt");
  const systemPrompt = buildSystemPrompt(extraInstructions);
  fs.writeFileSync(systemPromptFile, systemPrompt, "utf8");

  const chosenModel = (model || "").trim() || preset.defaultModel;
  const args = preset.buildArgs({ model: chosenModel, systemPromptFile, outputFile });
  const stdinText = preset.stdinIncludesSystemPrompt
    ? `${systemPrompt}\n\n<voice_note>\n${transcript}\n</voice_note>`
    : `<voice_note>\n${transcript}\n</voice_note>`;

  const { file, useShell } = resolveCommand(preset.command, customPath);

  try {
    const result = await new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      const child = spawn(
        useShell ? shellQuote(file) : file,
        useShell ? args.map(shellQuote) : args,
        {
          cwd: workDir, // empty folder: no project files leak into the prompt
          env: { ...process.env, ...preset.env },
          shell: useShell,
          windowsHide: true,
        }
      );
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // already gone
        }
        finish({ code: -1, stdout, stderr, timedOut: true });
      }, timeoutMs);
      child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
      child.stderr.on("data", (d) => (stderr += d.toString("utf8")));
      child.on("error", (err) => finish({ code: -1, stdout, stderr: err.message }));
      child.on("close", (code) => finish({ code, stdout, stderr }));
      child.stdin.on("error", () => {});
      child.stdin.end(stdinText, "utf8");
    });

    const ms = Date.now() - started;
    if (result.timedOut) {
      return { success: false, error: "The prompt writer took too long and was stopped.", ms };
    }
    let output = result.stdout;
    if (preset.readsOutputFile && fs.existsSync(outputFile)) {
      output = fs.readFileSync(outputFile, "utf8");
    }
    output = (output || "").trim();
    if (result.code !== 0 || !output) {
      const why = (result.stderr || result.stdout || "").trim().split(/\r?\n/).slice(-3).join(" ");
      debugLogger.warn("Prompt writer failed", { tool, code: result.code, why }, "reasoning");
      return {
        success: false,
        error: why || `${preset.command} exited with code ${result.code}`,
        ms,
      };
    }
    debugLogger.info(
      "Prompt writer finished",
      { tool, model: chosenModel, ms, inChars: transcript.length, outChars: output.length },
      "reasoning"
    );
    return { success: true, text: output, ms };
  } finally {
    fs.rm(workDir, { recursive: true, force: true }, () => {});
  }
}

module.exports = { runPromptWriter, listPresets, PROMPT_WRITER_SYSTEM_PROMPT, CLI_PRESETS };
