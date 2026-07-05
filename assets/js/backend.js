// backend.js — optional cPanel backend bridge.
//
// If SUPERAI_CONFIG.BACKEND_URL is set, the app gains server powers:
//   • real server-side Google/email verification
//   • realtime answers scraped live by the server (no browser CORS limits)
//   • the always-on knowledge base the cron learner grows 24×7
// If it's blank or the server is unreachable, everything falls back to the
// fully local on-device experience — nothing breaks.

export class Backend {
  constructor() {
    const cfg = window.SUPERAI_CONFIG || {};
    this.base = (cfg.BACKEND_URL || "").replace(/\/$/, "");
    this.enabled = !!this.base;
    this.userId = null;
  }

  async _post(path, data) {
    const r = await fetch(this.base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return r.json();
  }
  async _get(path) {
    const r = await fetch(this.base + path);
    return r.json();
  }

  // verify a login server-side; returns the DB user or null
  async login(profile) {
    if (!this.enabled) return null;
    try {
      const payload = profile.credential
        ? { mode: "google", credential: profile.credential }
        : { mode: "email", name: profile.name, email: profile.email };
      const r = await this._post("/api/auth.php", payload);
      if (r.ok) { this.userId = r.user.id; return r.user; }
    } catch { /* offline — stay local */ }
    return null;
  }

  // realtime answer: server knowledge base first, then a live web lookup
  async realtimeAnswer(prompt) {
    if (!this.enabled) return null;
    try {
      const k = await this._get("/api/knowledge.php?q=" + encodeURIComponent(prompt));
      if (k.ok && k.results && k.results.length && k.results[0].score > 0.1)
        return k.results[0].body;
      const rt = await this._get("/api/realtime.php?q=" + encodeURIComponent(prompt));
      if (rt.ok && rt.answer) return rt.answer + (rt.source ? `\n\n[source](${rt.source})` : "");
    } catch { /* offline */ }
    return null;
  }

  async logChat(model, prompt, session) {
    if (!this.enabled || !this.userId) return null;
    try {
      return await this._post("/api/chat.php", { user_id: this.userId, model, message: prompt, session });
    } catch { return null; }
  }
}
