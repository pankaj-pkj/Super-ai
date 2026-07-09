// hubclient.js — browser client for the GPU Hub (engine/hub.py).
//
// When SUPERAI_CONFIG.HUB_URL is set and the Hub is reachable, every visitor
// streams from the ONE powerful server brain — no weak per-browser model. If the
// Hub is absent or unreachable, the app silently falls back to the on-device
// brain, so nothing breaks.

export class HubClient {
  constructor() {
    const cfg = window.SUPERAI_CONFIG || {};
    this.base = (cfg.HUB_URL || "").replace(/\/$/, "");
    this.enabled = !!this.base;
    this.active = false; // true after a successful health check
    this.info = null;
  }

  async health() {
    if (!this.enabled) return null;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(this.base + "/health", { signal: ctrl.signal });
      clearTimeout(t);
      const j = await r.json();
      this.active = !!j.ok;
      this.info = j;
      return j;
    } catch {
      this.active = false;
      return null;
    }
  }

  // Stream a reply token-by-token from the shared brain.
  // `history` is prior [{role,content}] turns for multi-turn context.
  // onToken(fullTextSoFar) fires as tokens arrive. Returns the full text.
  async chatStream(message, history, onToken) {
    const r = await fetch(this.base + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history: history || [], stream: true }),
    });
    if (!r.ok || !r.body) throw new Error("hub HTTP " + r.status);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "", full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop(); // keep the trailing partial line
      for (const ln of lines) {
        if (!ln.startsWith("data:")) continue;
        const payload = ln.slice(5).trim();
        if (!payload) continue;
        if (payload === "[DONE]") return full;
        try { full += JSON.parse(payload); } catch { full += payload; }
        onToken(full);
      }
    }
    return full;
  }

  // Non-streaming fallback (also gives chat-vs-tool routing).
  async ask(message) {
    const r = await fetch(this.base + "/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, stream: false }),
    });
    const j = await r.json();
    if (j.kind === "tool") return "```python\n" + (j.tool.code || "") + "\n```";
    return j.response?.text || j.response || "";
  }
}
