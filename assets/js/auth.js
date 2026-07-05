// auth.js — client-side login for a static site.
// Email login works out of the box (profile stored locally, per-user tokens).
// Google Sign-In lights up automatically when a GOOGLE_CLIENT_ID is set in
// config.js (Google Identity Services is pure client-side — no backend).

const EMAIL_RE = /^[\w.+-]+@[\w-]+\.[\w.-]{2,}$/;

function hash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export class Auth {
  constructor() {
    try { this.profile = JSON.parse(localStorage.getItem("superai_profile")) || null; }
    catch { this.profile = null; }
  }

  get loggedIn() { return !!this.profile; }

  get userId() {
    if (!this.profile) return "anonymous";
    return "u_" + hash(this.profile.email || this.profile.name || "guest");
  }

  get initials() {
    const n = this.profile?.name || "?";
    return n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  }

  loginEmail(name, email) {
    name = (name || "").trim();
    email = (email || "").trim().toLowerCase();
    if (name.length < 2) return { ok: false, error: "Please enter your name" };
    if (!EMAIL_RE.test(email)) return { ok: false, error: "Please enter a valid email" };
    this.profile = { name, email, provider: "email", at: Date.now() };
    localStorage.setItem("superai_profile", JSON.stringify(this.profile));
    return { ok: true };
  }

  loginGuest() {
    this.profile = { name: "Guest", email: "guest_" + Math.random().toString(36).slice(2, 8), provider: "guest", at: Date.now() };
    localStorage.setItem("superai_profile", JSON.stringify(this.profile));
    return { ok: true };
  }

  loginGoogleCredential(jwt) {
    try {
      const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      this.profile = {
        name: payload.name || payload.email,
        email: payload.email,
        picture: payload.picture || null,
        provider: "google",
        at: Date.now(),
      };
      localStorage.setItem("superai_profile", JSON.stringify(this.profile));
      return { ok: true };
    } catch {
      return { ok: false, error: "could not read Google credential" };
    }
  }

  logout() {
    this.profile = null;
    localStorage.removeItem("superai_profile");
  }

  // renders the official Google button into `el` if a client id is configured
  mountGoogleButton(el, onLogin) {
    const cid = window.SUPERAI_CONFIG?.GOOGLE_CLIENT_ID;
    if (!cid) return false;
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => {
      window.google.accounts.id.initialize({
        client_id: cid,
        callback: (resp) => {
          const r = this.loginGoogleCredential(resp.credential);
          if (r.ok) onLogin();
        },
      });
      window.google.accounts.id.renderButton(el, { theme: "filled_black", size: "large", shape: "pill", width: 280 });
    };
    document.head.appendChild(s);
    return true;
  }
}
