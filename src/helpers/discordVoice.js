// Discord voice control over Discord's local RPC pipe: mutes the user while
// they dictate and unmutes afterwards, but only if we were the ones who muted.
//
// Needs a Discord application the user owns (client id + secret, redirect
// http://localhost). The first connect shows Discord's "Authorize" prompt;
// after that the saved token is reused/refreshed silently.

const net = require("net");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app, safeStorage } = require("electron");
const debugLogger = require("./debugLogger");

const OP_HANDSHAKE = 0;
const OP_FRAME = 1;
const OP_CLOSE = 2;
const OP_PING = 3;
const OP_PONG = 4;
const SCOPES = ["rpc", "rpc.voice.read", "rpc.voice.write"];
const REDIRECT_URI = "http://localhost";
const COMMAND_TIMEOUT_MS = 4000;
const AUTHORIZE_TIMEOUT_MS = 120000;

function configPath() {
  return path.join(app.getPath("userData"), "discord-voice.json");
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(configPath());
    const text =
      safeStorage.isEncryptionAvailable() && raw[0] !== 0x7b
        ? safeStorage.decryptString(raw)
        : raw.toString("utf8");
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function saveConfig(config) {
  const text = JSON.stringify(config);
  const data = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(text)
    : Buffer.from(text, "utf8");
  fs.writeFileSync(configPath(), data);
}

class DiscordVoice {
  constructor() {
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.connecting = null;
    this.authed = false;
    this.didMute = false;
    this.queue = Promise.resolve();
  }

  _serialize(fn) {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => {});
    return run;
  }

  getStatus() {
    const c = loadConfig();
    return {
      configured: !!(c.clientId && c.clientSecret),
      connected: !!c.accessToken,
      clientId: c.clientId || "",
    };
  }

  setCredentials({ clientId, clientSecret }) {
    const c = loadConfig();
    const changed = c.clientId !== clientId;
    saveConfig({
      ...(changed ? {} : c),
      clientId: String(clientId || "").trim(),
      clientSecret: String(clientSecret || "").trim() || c.clientSecret || "",
    });
    if (changed) this._close();
    return this.getStatus();
  }

  disconnect() {
    const c = loadConfig();
    delete c.accessToken;
    delete c.refreshToken;
    delete c.expiresAt;
    saveConfig(c);
    this._close();
    return this.getStatus();
  }

  _close() {
    this.authed = false;
    if (this.socket) {
      try {
        this.socket.destroy();
      } catch {
        // already closed
      }
    }
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    for (const { reject } of this.pending.values()) reject(new Error("Discord connection closed"));
    this.pending.clear();
  }

  _write(op, payload) {
    const json = Buffer.from(JSON.stringify(payload), "utf8");
    const header = Buffer.alloc(8);
    header.writeInt32LE(op, 0);
    header.writeInt32LE(json.length, 4);
    this.socket.write(Buffer.concat([header, json]));
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const op = this.buffer.readInt32LE(0);
      const len = this.buffer.readInt32LE(4);
      if (this.buffer.length < 8 + len) return;
      const body = this.buffer.subarray(8, 8 + len).toString("utf8");
      this.buffer = this.buffer.subarray(8 + len);
      let msg = null;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      if (op === OP_PING) {
        this._write(OP_PONG, msg);
      } else if (op === OP_CLOSE) {
        this._close();
      } else if (msg.evt === "READY" && this.pending.has("__ready")) {
        this.pending.get("__ready").resolve(msg);
        this.pending.delete("__ready");
      } else if (msg.nonce && this.pending.has(msg.nonce)) {
        const { resolve, reject } = this.pending.get(msg.nonce);
        this.pending.delete(msg.nonce);
        if (msg.evt === "ERROR") reject(new Error(msg.data?.message || "Discord RPC error"));
        else resolve(msg.data);
      }
    }
  }

  _connectPipe(clientId) {
    return new Promise((resolve, reject) => {
      const tryIndex = (i) => {
        if (i > 9) {
          reject(new Error("Discord is not running"));
          return;
        }
        const pipe =
          process.platform === "win32"
            ? `\\\\?\\pipe\\discord-ipc-${i}`
            : path.join(process.env.XDG_RUNTIME_DIR || "/tmp", `discord-ipc-${i}`);
        const sock = net.createConnection(pipe);
        sock.once("connect", () => {
          this.socket = sock;
          sock.on("data", (d) => this._onData(d));
          sock.on("close", () => this._close());
          sock.on("error", () => this._close());
          const ready = new Promise((res, rej) => {
            this.pending.set("__ready", { resolve: res, reject: rej });
            setTimeout(() => rej(new Error("Discord did not answer")), COMMAND_TIMEOUT_MS);
          });
          this._write(OP_HANDSHAKE, { v: 1, client_id: clientId });
          ready.then(resolve, reject);
        });
        sock.once("error", () => tryIndex(i + 1));
      };
      tryIndex(0);
    });
  }

  _command(cmd, args, timeoutMs = COMMAND_TIMEOUT_MS) {
    if (!this.socket) return Promise.reject(new Error("Not connected to Discord"));
    const nonce = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(nonce);
        reject(new Error(`Discord ${cmd} timed out`));
      }, timeoutMs);
      this.pending.set(nonce, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this._write(OP_FRAME, { cmd, args, nonce });
    });
  }

  async _token(body) {
    const res = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.access_token) {
      throw new Error(
        json.error_description || json.error || `Token request failed (${res.status})`
      );
    }
    return json;
  }

  _storeToken(c, tok) {
    c.accessToken = tok.access_token;
    c.refreshToken = tok.refresh_token || c.refreshToken;
    c.expiresAt = Date.now() + (tok.expires_in || 604800) * 1000;
    saveConfig(c);
  }

  // Connects and authenticates. `interactive` allows Discord's Authorize prompt.
  async _ensureReady(interactive = false) {
    if (this.socket && this.authed) return true;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const c = loadConfig();
      if (!c.clientId || !c.clientSecret) throw new Error("Discord app is not set up");
      if (!this.socket) await this._connectPipe(c.clientId);

      if (c.accessToken && c.expiresAt && c.expiresAt - Date.now() < 86400000 && c.refreshToken) {
        try {
          this._storeToken(
            c,
            await this._token({
              client_id: c.clientId,
              client_secret: c.clientSecret,
              grant_type: "refresh_token",
              refresh_token: c.refreshToken,
            })
          );
        } catch (e) {
          debugLogger.warn("Discord token refresh failed", { error: e.message }, "discord");
        }
      }

      if (c.accessToken) {
        try {
          await this._command("AUTHENTICATE", { access_token: c.accessToken });
          this.authed = true;
          return true;
        } catch (e) {
          debugLogger.warn("Discord saved token rejected", { error: e.message }, "discord");
          delete c.accessToken;
          saveConfig(c);
        }
      }

      if (!interactive) throw new Error("Discord is not connected yet");
      const auth = await this._command(
        "AUTHORIZE",
        { client_id: c.clientId, scopes: SCOPES },
        AUTHORIZE_TIMEOUT_MS
      );
      this._storeToken(
        c,
        await this._token({
          client_id: c.clientId,
          client_secret: c.clientSecret,
          grant_type: "authorization_code",
          code: auth.code,
          redirect_uri: REDIRECT_URI,
        })
      );
      await this._command("AUTHENTICATE", { access_token: c.accessToken });
      this.authed = true;
      return true;
    })();
    try {
      return await this.connecting;
    } catch (e) {
      this._close();
      throw e;
    } finally {
      this.connecting = null;
    }
  }

  /** Settings "Connect" button: shows Discord's Authorize prompt if needed. */
  connect() {
    return this._serialize(async () => {
      try {
        await this._ensureReady(true);
        const voice = await this._command("GET_VOICE_SETTINGS", {});
        return { success: true, muted: !!voice?.mute, ...this.getStatus() };
      } catch (e) {
        return { success: false, error: e.message, ...this.getStatus() };
      }
    });
  }

  /** Recording started: mute unless already muted. Silent no-op if Discord is closed. */
  muteForDictation() {
    return this._serialize(async () => {
      this.didMute = false;
      try {
        if (!this.getStatus().connected) return { success: false, skipped: true };
        await this._ensureReady(false);
        const voice = await this._command("GET_VOICE_SETTINGS", {});
        if (voice?.mute) return { success: true, alreadyMuted: true };
        await this._command("SET_VOICE_SETTINGS", { mute: true });
        this.didMute = true;
        return { success: true, muted: true };
      } catch (e) {
        debugLogger.debug("Discord mute skipped", { error: e.message }, "discord");
        return { success: false, error: e.message };
      }
    });
  }

  /** Recording ended: unmute only if we muted. */
  restoreAfterDictation() {
    return this._serialize(async () => {
      if (!this.didMute) return { success: true, skipped: true };
      this.didMute = false;
      try {
        await this._ensureReady(false);
        await this._command("SET_VOICE_SETTINGS", { mute: false });
        return { success: true, unmuted: true };
      } catch (e) {
        debugLogger.warn("Discord unmute failed", { error: e.message }, "discord");
        return { success: false, error: e.message };
      }
    });
  }
}

module.exports = new DiscordVoice();
