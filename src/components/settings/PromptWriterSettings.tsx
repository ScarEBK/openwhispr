import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { HotkeyListInput } from "../ui/HotkeyListInput";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { SectionHeader, SettingsPanel, SettingsPanelRow } from "../ui/SettingsSection";

// Prompt Writer settings live in plain localStorage keys, read at use time by
// useAudioRecording. The hotkey is owned by the main process (.env).
const KEYS = {
  tool: "promptWriterTool",
  model: "promptWriterModel",
  extra: "promptWriterExtraInstructions",
  customPath: "promptWriterCustomPath",
} as const;

function readKey(key: string, fallback = ""): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeKey(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable: setting lasts for this session only
  }
}

type Preset = { id: string; label: string; defaultModel: string };

export default function PromptWriterSettings({
  validate,
  disabled,
}: {
  validate?: (hotkey: string) => string | null | undefined;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [hotkey, setHotkey] = useState("");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [tool, setTool] = useState(() => readKey(KEYS.tool, "claude"));
  const [model, setModel] = useState(() => readKey(KEYS.model, ""));
  const [extra, setExtra] = useState(() => readKey(KEYS.extra, ""));
  const [customPath, setCustomPath] = useState(() => readKey(KEYS.customPath, ""));
  const [testState, setTestState] = useState<"idle" | "running" | "ok" | "failed">("idle");
  const [testMessage, setTestMessage] = useState("");

  useEffect(() => {
    window.electronAPI?.getPromptWriterKey?.().then((k) => setHotkey(k || ""));
    window.electronAPI?.promptWriterPresets?.().then((p) => setPresets(p || []));
  }, []);

  const commitHotkey = useCallback(async (value: string) => {
    const result = await window.electronAPI?.updatePromptWriterHotkey?.(value);
    if (result?.success) {
      setHotkey(value);
      return true;
    }
    return false;
  }, []);

  const defaultModel = presets.find((p) => p.id === tool)?.defaultModel || "";

  const runTest = useCallback(async () => {
    setTestState("running");
    setTestMessage("");
    const result = await window.electronAPI?.promptWriterRun?.({
      text: "um so basically I want you to like add a dark mode button to my settings page, you know, and uh make sure it remembers it",
      tool,
      model,
      extraInstructions: extra,
      customPath,
    });
    if (result?.success) {
      setTestState("ok");
      setTestMessage(
        t("settingsPage.general.promptWriter.testOk", {
          seconds: Math.round((result.ms || 0) / 100) / 10,
        })
      );
    } else {
      setTestState("failed");
      setTestMessage(result?.error || t("settingsPage.general.promptWriter.testFailed"));
    }
  }, [tool, model, extra, customPath, t]);

  return (
    <div>
      <SectionHeader
        title={t("settingsPage.general.promptWriterHotkey.title")}
        description={t("settingsPage.general.promptWriterHotkey.description")}
      />
      <SettingsPanel>
        <SettingsPanelRow>
          <HotkeyListInput
            value={hotkey}
            onChange={(list) => commitHotkey(list)}
            onClear={() => commitHotkey("")}
            validate={validate}
            disabled={disabled}
            maxHotkeys={1}
          />
        </SettingsPanelRow>
        <SettingsPanelRow>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">
              {t("settingsPage.general.promptWriter.toolLabel")}
            </span>
            <Select
              value={tool}
              onValueChange={(value) => {
                setTool(value);
                writeKey(KEYS.tool, value);
                setModel("");
                writeKey(KEYS.model, "");
              }}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(presets.length
                  ? presets
                  : [{ id: "claude", label: "Claude", defaultModel: "opus" }]
                ).map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </SettingsPanelRow>
        <SettingsPanelRow>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">
              {t("settingsPage.general.promptWriter.modelLabel")}
            </span>
            <Input
              className="h-8 text-xs"
              value={model}
              placeholder={
                defaultModel
                  ? t("settingsPage.general.promptWriter.modelPlaceholder", { model: defaultModel })
                  : t("settingsPage.general.promptWriter.modelPlaceholderDefault")
              }
              onChange={(e) => {
                setModel(e.target.value);
                writeKey(KEYS.model, e.target.value);
              }}
            />
            <span className="text-[11px] text-muted-foreground/80">
              {t("settingsPage.general.promptWriter.modelHint")}
            </span>
          </div>
        </SettingsPanelRow>
        <SettingsPanelRow>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">
              {t("settingsPage.general.promptWriter.extraLabel")}
            </span>
            <Textarea
              className="min-h-[64px] text-xs"
              value={extra}
              placeholder={t("settingsPage.general.promptWriter.extraPlaceholder")}
              onChange={(e) => {
                setExtra(e.target.value);
                writeKey(KEYS.extra, e.target.value);
              }}
            />
          </div>
        </SettingsPanelRow>
        <SettingsPanelRow>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">
              {t("settingsPage.general.promptWriter.pathLabel")}
            </span>
            <Input
              className="h-8 text-xs"
              value={customPath}
              placeholder={t("settingsPage.general.promptWriter.pathPlaceholder")}
              onChange={(e) => {
                setCustomPath(e.target.value);
                writeKey(KEYS.customPath, e.target.value);
              }}
            />
          </div>
        </SettingsPanelRow>
        <SettingsPanelRow>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="h-7 rounded-md border border-border px-3 text-xs hover:bg-muted disabled:opacity-50"
              disabled={testState === "running"}
              onClick={runTest}
            >
              {testState === "running"
                ? t("settingsPage.general.promptWriter.testing")
                : t("settingsPage.general.promptWriter.test")}
            </button>
            {testMessage && (
              <span
                className={`text-xs ${testState === "ok" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
              >
                {testMessage}
              </span>
            )}
          </div>
        </SettingsPanelRow>
      </SettingsPanel>
    </div>
  );
}
