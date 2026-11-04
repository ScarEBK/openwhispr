// Prompt Writer overlay: a small Handy-style box at the bottom center of the
// screen that shows what Page Up dictation is doing (listening -> writing the
// prompt -> done). It never takes focus and ignores the mouse, so it is safe
// over games (borderless/windowed; exclusive full-screen can still cover it).

const { BrowserWindow, screen } = require("electron");
const { execFile } = require("child_process");

const WIDTH = 560;
const HEIGHT = 168;
const BOTTOM_GAP = 72;
const HIDE_AFTER_DONE_MS = 3500;

const HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>
  html,body{margin:0;height:100%;background:transparent;overflow:hidden;
    font-family:"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;-webkit-user-select:none;}
  #box{position:absolute;left:8px;right:8px;bottom:8px;max-height:${HEIGHT - 16}px;
    background:rgba(22,22,26,.94);border:1px solid rgba(255,255,255,.09);border-radius:16px;
    box-shadow:0 10px 30px rgba(0,0,0,.45);color:#ececf1;padding:12px 16px 13px;
    opacity:0;transform:translateY(8px);transition:opacity .18s ease,transform .18s ease;}
  #box.show{opacity:1;transform:none}
  #head{display:flex;align-items:center;gap:8px;font-size:12.5px;font-weight:600;letter-spacing:.01em}
  #dot{width:8px;height:8px;border-radius:50%;background:#ef4444;flex:none}
  .listening #dot{animation:pulse 1.1s ease-in-out infinite}
  .working #dot{background:#a78bfa;animation:pulse .8s ease-in-out infinite}
  .done #dot{background:#22c55e}
  .error #dot{background:#f59e0b}
  @keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.75)}}
  #label{flex:1}
  #time{font-weight:500;color:#8b8b98;font-variant-numeric:tabular-nums}
  #text{margin-top:7px;font-size:13.5px;line-height:1.45;color:#c9c9d3;max-height:${HEIGHT - 70}px;
    overflow:hidden;display:flex;flex-direction:column;justify-content:flex-end;white-space:pre-wrap;word-break:break-word}
  #text:empty{display:none}
  .working #text{color:#8b8b98}
</style></head><body>
<div id="box"><div id="head"><span id="dot"></span><span id="label"></span><span id="time"></span></div><div id="text"></div></div>
<script>
  let started=0,timer=null;
  function tick(){document.getElementById('time').textContent=started?Math.floor((Date.now()-started)/1000)+'s':'';}
  window.__set=function(s){
    const box=document.getElementById('box');
    box.className='show '+(s.state||'');
    document.getElementById('label').textContent=s.label||'';
    const t=s.text||'';
    document.getElementById('text').textContent=t.length>600?'\\u2026'+t.slice(-600):t;
    if(s.state==='working'){ if(!started) started=Date.now(); if(!timer) timer=setInterval(tick,500); }
    else { started=0; clearInterval(timer); timer=null; }
    tick();
  };
  window.__hide=function(){document.getElementById('box').className='';};
</script></body></html>`;

// Reads the focused element's rectangle and its window's rectangle (physical
// pixels) via UI Automation. Resolves null when nothing useful is found.
const ANCHOR_PS = `
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$f=[System.Windows.Automation.AutomationElement]::FocusedElement
if($f -eq $null){ 'none'; exit }
$r=$f.Current.BoundingRectangle
$w=[System.Windows.Rect]::Empty
$walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker
$p=$f
while($p -ne $null){
  if($p.Current.ControlType -eq [System.Windows.Automation.ControlType]::Window){ $w=$p.Current.BoundingRectangle; break }
  $p=$walker.GetParent($p)
}
"$($r.X),$($r.Y),$($r.Width),$($r.Height)|$($w.X),$($w.Y),$($w.Width),$($w.Height)"
`;

function parseRect(text) {
  const [x, y, width, height] = String(text || "")
    .split(",")
    .map(Number);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function captureFocusAnchor() {
  if (process.platform !== "win32") return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", ANCHOR_PS],
      { windowsHide: true, timeout: 5000 },
      (err, stdout) => {
        if (err) return resolve(null);
        const [focusText, windowText] = String(stdout).trim().split("|");
        const toDip = (r) => (r ? screen.screenToDipRect(null, r) : null);
        resolve({ focus: toDip(parseRect(focusText)), window: toDip(parseRect(windowText)) });
      }
    );
  });
}

// Above the text box when we know it; else bottom center of its window; else
// bottom center of the screen the mouse is on.
function computeBounds(anchor) {
  const focus = anchor?.focus;
  const win = anchor?.window;
  const ref = focus || win;
  const area = ref
    ? screen.getDisplayMatching(ref).workArea
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const clampX = (x, w) => Math.min(Math.max(x, area.x + 8), area.x + area.width - w - 8);

  const usableFocus =
    focus && focus.width >= 80 && (!win || focus.height <= win.height * 0.6) ? focus : null;
  if (usableFocus) {
    const width = Math.round(Math.min(WIDTH, Math.max(380, usableFocus.width)));
    const x = clampX(Math.round(usableFocus.x + usableFocus.width / 2 - width / 2), width);
    let y = Math.round(usableFocus.y - HEIGHT + 2);
    if (y < area.y) y = Math.round(usableFocus.y + usableFocus.height - 6); // no room above
    return { x, y, width, height: HEIGHT };
  }
  if (win) {
    const width = Math.round(Math.min(WIDTH, win.width - 32));
    return {
      x: clampX(Math.round(win.x + win.width / 2 - width / 2), width),
      y: Math.round(Math.min(win.y + win.height, area.y + area.height) - HEIGHT - BOTTOM_GAP),
      width,
      height: HEIGHT,
    };
  }
  return {
    x: Math.round(area.x + (area.width - WIDTH) / 2),
    y: Math.round(area.y + area.height - HEIGHT - BOTTOM_GAP + 8),
    width: WIDTH,
    height: HEIGHT,
  };
}

class PromptOverlay {
  constructor() {
    this.win = null;
    this.ready = null;
    this.hideTimer = null;
    this.state = "hidden";
    this.label = "";
  }

  /** Live words while listening; ignored unless the box is in "listening". */
  feedPartial(text) {
    if (this.state !== "listening" || !text) return;
    this.update({ state: "listening", label: this.label, text });
  }

  _ensureWindow() {
    if (this.win && !this.win.isDestroyed()) return this.ready;
    this.win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      show: false,
      hasShadow: false,
      alwaysOnTop: true,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    this.win.setIgnoreMouseEvents(true);
    this.win.setAlwaysOnTop(true, "screen-saver");
    this.win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.win.setContentProtection(false);
    this.ready = this.win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(HTML));
    this.win.on("closed", () => {
      this.win = null;
    });
    return this.ready;
  }

  /**
   * Called on the Page Up press, before anything can move focus: finds the
   * text box being typed in (UI Automation) and its window, so the box can sit
   * right above it on that screen. Also fades out the right-side mic bubble.
   */
  beginPromptRecording(pillWindow) {
    this.anchorPromise = captureFocusAnchor();
    this.pillWindow = pillWindow || null;
    try {
      if (this.pillWindow && !this.pillWindow.isDestroyed()) this.pillWindow.setOpacity(0);
    } catch {
      // ignore
    }
    // If the recording never starts, bring the bubble back anyway.
    clearTimeout(this.pillTimer);
    this.pillTimer = setTimeout(() => {
      if (this.state === "hidden") this._restorePill();
    }, 4000);
  }

  _restorePill() {
    clearTimeout(this.pillTimer);
    try {
      if (this.pillWindow && !this.pillWindow.isDestroyed()) this.pillWindow.setOpacity(1);
    } catch {
      // ignore
    }
    this.pillWindow = null;
  }

  async _place() {
    let anchor = null;
    if (this.anchorPromise) {
      anchor = await Promise.race([
        this.anchorPromise,
        new Promise((r) => setTimeout(() => r(null), 1500)),
      ]);
    }
    const bounds = computeBounds(anchor);
    if (this.win && !this.win.isDestroyed()) this.win.setBounds(bounds);
  }

  /** state: listening | working | done | error | hidden */
  async update({ state, label, text } = {}) {
    clearTimeout(this.hideTimer);
    if (state === "hidden") return this.hide();
    this.state = state;
    this.label = label;
    await this._ensureWindow();
    if (!this.win || this.win.isDestroyed()) return;
    if (!this.win.isVisible()) {
      await this._place();
      if (!this.win || this.win.isDestroyed() || this.state === "hidden") return;
      this.win.showInactive();
      this.win.setAlwaysOnTop(true, "screen-saver");
    } else {
      this.win.moveTop();
    }
    await this.win.webContents
      .executeJavaScript(`window.__set(${JSON.stringify({ state, label, text })})`)
      .catch(() => {});
    if (state === "done" || state === "error") {
      this.hideTimer = setTimeout(() => this.hide(), HIDE_AFTER_DONE_MS);
    }
  }

  async hide() {
    clearTimeout(this.hideTimer);
    this.state = "hidden";
    this.anchorPromise = null;
    this._restorePill();
    if (!this.win || this.win.isDestroyed() || !this.win.isVisible()) return;
    await this.win.webContents.executeJavaScript("window.__hide()").catch(() => {});
    setTimeout(() => {
      if (this.win && !this.win.isDestroyed()) this.win.hide();
    }, 220);
  }
}

module.exports = new PromptOverlay();
