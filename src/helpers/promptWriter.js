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

const PROMPT_WRITER_SYSTEM_PROMPT = `You rewrite a person's spoken voice note into a clear message for an AI coding agent (Claude Code, Codex). It gets pasted into a chat where that agent is already working with them, so the agent already knows the project and the conversation so far.

The voice note is raw speech-to-text: rambling, repetitive, full of filler, with mis-heard words. The speaker is not a programmer. Your only job is to make what they said easy for the agent to act on, without changing or adding to what they meant.

Rules, most important first:
1. Faithful, not creative. Every point, complaint, like, dislike and instruction the speaker gave must appear, and nothing they did not say may appear. Do not invent requirements, test steps, screen sizes, browsers, causes, or fixes. Do not explain how to solve anything; the agent will work that out.
2. Describe exactly what they saw, in concrete terms. Keep their specifics: which section, which text, which letters, when it happens (for example "after I reload the page"), what they like and want kept. A vague summary like "fix the styling" is a failure when they said something specific.
3. Fix mis-heard words silently using context, and write the corrected word. Examples: "cloud code" = "Claude Code", "the zero" next to a header usually = "the hero section", "five macro sheet FPS" = something like "5 Macro Sheets · 60 FPS" (quote it as the on-screen text they meant). Only if a point truly cannot be understood, add it once at the end as "Unclear: <their words>" instead of guessing.
4. Keep their priorities. Put the biggest issues first. If they repeated something or sounded frustrated about it, say it matters.
5. Keep what they said they like, so the agent does not break it ("Keep the orbit animation as it is").
6. First person, as the speaker ("I want...", "Fix..."). Never mention a voice note, transcript, or yourself.
7. Short and direct. One line of intent, then a numbered list with one item per point. No headings unless the note covers several separate topics. No "Done when", no "Ideas", no "Questions" sections, no speculation, no filler. Only if the speaker explicitly asked for suggestions or for the agent to ask them questions, add that one request at the end.

Output only the finished message, ready to paste. No preamble, no code fences.`;

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
