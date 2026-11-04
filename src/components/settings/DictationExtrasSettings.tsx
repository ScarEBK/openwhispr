import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "../ui/input";
import { Toggle } from "../ui/toggle";
import { SectionHeader, SettingsPanel, SettingsPanelRow, SettingsRow } from "../ui/SettingsSection";

// Owner additions: auto send (Enter after paste) and Discord mute while
// dictating. Flags live in localStorage and are read by useAudioRecording.
function readFlag(key: string, fallback: boolean) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "true";
  } catch {
    return fallback;
  }
}
function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // storage unavailable
  }
}

type DiscordStatus = { configured: boolean; connected: boolean; clientId: string };

export default function DictationExtrasSettings() {
  const { t } = useTranslation();
  const [autoSend, setAutoSend] = useState(() => readFlag("autoSendAfterPaste", true));
  const [muteDiscord, setMuteDiscord] = useState(() => readFlag("muteDiscordOnDictation", true));
  const [status, setStatus] = useState<DiscordStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    window.electronAPI?.discordVoiceStatus?.().then((s) => {
      if (!s) return;
      setStatus(s);
      setClientId(s.clientId || "");
    });
  }, []);

  const connect = useCallback(async () => {
    setBusy(true);
    setMessage({ ok: true, text: t("settingsPage.general.discordVoice.waiting") });
    try {
      if (clientId.trim()) {
        await window.electronAPI?.discordVoiceSetCredentials?.({ clientId, clientSecret });
      }
      const result = await window.electronAPI?.discordVoiceConnect?.();
      if (result) setStatus(result);
      setMessage(
        result?.success
          ? { ok: true, text: t("settingsPage.general.discordVoice.connected") }
          : { ok: false, text: result?.error || t("settingsPage.general.discordVoice.failed") }
      );
      setClientSecret("");
    } finally {
      setBusy(false);
    }
  }, [clientId, clientSecret, t]);

  const disconnect = useCallback(async () => {
    const s = await window.electronAPI?.discordVoiceDisconnect?.();
    if (s) setStatus(s);
    setMessage(null);
  }, []);

  return (
    <div>
      <SectionHeader
        title={t("settingsPage.general.dictationExtras.title")}
        description={t("settingsPage.general.dictationExtras.description")}
      />
      <SettingsPanel>
        <SettingsPanelRow>
          <SettingsRow
            label={t("settingsPage.general.dictationExtras.autoSend")}
            description={t("settingsPage.general.dictationExtras.autoSendDescription")}
          >
            <Toggle
              checked={autoSend}
              onChange={(v: boolean) => {
                setAutoSend(v);
                writeFlag("autoSendAfterPaste", v);
              }}
            />
          </SettingsRow>
        </SettingsPanelRow>
        <SettingsPanelRow>
          <SettingsRow
            label={t("settingsPage.general.discordVoice.toggle")}
            description={t("settingsPage.general.discordVoice.toggleDescription")}
          >
            <Toggle
              checked={muteDiscord}
              onChange={(v: boolean) => {
                setMuteDiscord(v);
                writeFlag("muteDiscordOnDictation", v);
              }}
            />
          </SettingsRow>
        </SettingsPanelRow>
        <SettingsPanelRow>
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-foreground">
              {t("settingsPage.general.discordVoice.appLabel")}
            </span>
            <Input
              className="h-8 text-xs"
              value={clientId}
              placeholder={t("settingsPage.general.discordVoice.clientIdPlaceholder")}
              onChange={(e) => setClientId(e.target.value)}
            />
            <Input
              className="h-8 text-xs"
              type="password"
              value={clientSecret}
              placeholder={
                status?.configured
                  ? t("settingsPage.general.discordVoice.secretSaved")
                  : t("settingsPage.general.discordVoice.secretPlaceholder")
              }
              onChange={(e) => setClientSecret(e.target.value)}
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="h-7 rounded-md border border-border px-3 text-xs hover:bg-muted disabled:opacity-50"
                disabled={busy || (!clientId.trim() && !status?.configured)}
                onClick={connect}
              >
                {status?.connected
                  ? t("settingsPage.general.discordVoice.reconnect")
                  : t("settingsPage.general.discordVoice.connect")}
              </button>
              {status?.connected && (
                <button
                  type="button"
                  className="h-7 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={disconnect}
                >
                  {t("settingsPage.general.discordVoice.disconnect")}
                </button>
              )}
              <span
                className={`text-xs ${message ? (message.ok ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400") : "text-muted-foreground"}`}
              >
                {message?.text ??
                  (status?.connected
                    ? t("settingsPage.general.discordVoice.connected")
                    : t("settingsPage.general.discordVoice.notConnected"))}
              </span>
            </div>
          </div>
        </SettingsPanelRow>
      </SettingsPanel>
    </div>
  );
}
