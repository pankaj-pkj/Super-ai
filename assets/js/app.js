// app.js — wires the in-browser AI to the UI. No server, no API.

import { createStore } from "./store.js";
import { SuperBrain, MODELS } from "./brain.js";
import { TokenBank } from "./tokens.js";
import { Harvester } from "./harvester.js";
import { I18N } from "./knowledge.js";
import { escapeHtml } from "./core.js";
import { RealBrain, BRAIN_MODELS } from "./realbrain.js";
import { Auth } from "./auth.js";
import { exportBundle, importBundle, SwarmLink } from "./swarm.js";
import { isMobileDevice } from "./core.js";
import { Backend } from "./backend.js";
import { HubClient } from "./hubclient.js";

const $ = (id) => document.getElementById(id);

// ---------------- identity + prefs ----------------
const auth = new Auth();
const backend = new Backend();
const hub = new HubClient();
let userId = auth.loggedIn ? auth.userId : "anonymous";
let currentModel = localStorage.getItem("superai_model") || "super-chat";
let lang = localStorage.getItem("superai_lang") || "en";
let busy = false;
let sessionId = localStorage.getItem("superai_session") || "s_" + Date.now().toString(36);
localStorage.setItem("superai_session", sessionId);

let store, brain, bank, harvester;
const realBrain = new RealBrain();

// ---------------- UI zoom (mobile-friendly, guaranteed to work) ----------------
let uiScale = parseFloat(localStorage.getItem("superai_zoom") || "1");
function applyZoom() {
  document.body.style.zoom = uiScale;
  localStorage.setItem("superai_zoom", String(uiScale));
}
window.uiZoom = function (delta) {
  uiScale = Math.min(1.6, Math.max(0.7, Math.round((uiScale + delta) * 100) / 100));
  applyZoom();
};
applyZoom();

// ---------------- login gate ----------------
function showLogin() {
  $("loginOverlay").classList.add("show");
  auth.mountGoogleButton($("googleBtn"), finishLogin);
}
function finishLogin() {
  userId = auth.userId;
  $("loginOverlay").classList.remove("show");
  renderProfile();
  refreshTokens();
  // verify server-side + enable realtime answers when a backend is configured
  if (backend.enabled) {
    backend.login(auth.profile).then((u) => {
      if (u && brain) brain.onUnknown = (p) => backend.realtimeAnswer(p);
    }).catch(() => {});
  }
  toast((lang === "hi" ? "Swagat hai, " : "Welcome, ") + auth.profile.name + "! 👋", "good");
}
window.doEmailLogin = function () {
  const r = auth.loginEmail($("loginName").value, $("loginEmail").value);
  if (!r.ok) { $("loginErr").textContent = r.error; return; }
  finishLogin();
};
window.doGuestLogin = function () { auth.loginGuest(); finishLogin(); };
window.doLogout = function () {
  auth.logout();
  location.reload();
};
function renderProfile() {
  const el = $("profileChip");
  if (!el) return;
  if (auth.loggedIn) {
    el.style.display = "flex";
    el.title = auth.profile.email + " — tap to logout";
    el.innerHTML = auth.profile.picture
      ? `<img src="${auth.profile.picture}" alt="">`
      : `<span>${auth.initials}</span>`;
  } else {
    el.style.display = "none";
  }
}

// ---------------- boot ----------------
(async function boot() {
  applyI18n();
  // ask the browser to never evict our storage (model cache + knowledge)
  try { navigator.storage?.persist?.(); } catch { /* optional */ }
  if (!auth.loggedIn) showLogin(); else renderProfile();
  store = await createStore();
  brain = new SuperBrain(store);
  await brain.init();
  bank = new TokenBank(store);
  await bank.init();
  harvester = new Harvester(brain, store, 120);
  harvester.onUpdate = () => { refreshStats(); refreshEvolution(); };

  loadModels();
  await refreshTokens();
  await refreshStats();
  await refreshEvolution();
  await restoreHistory();

  // Connect to the GPU Hub if configured — then everyone shares the one powerful brain.
  if (hub.enabled) {
    hub.health().then((h) => {
      if (hub.active) toast("☁ Cloud Brain connected — powered by the server model", "good");
    });
  }

  realBrain.userName = auth.profile?.name || (await store.getKV("user_name"));

  // If a cPanel backend is configured, verify the login server-side and wire
  // realtime answers (server scrapes live + serves its 24×7 knowledge base).
  if (backend.enabled && auth.loggedIn) {
    backend.login(auth.profile).catch(() => {});
    brain.onUnknown = (prompt) => backend.realtimeAnswer(prompt);
  }

  autoLoadBrain(); // reload cached Codian Neo in the background

  harvester.start(); // 24×7 self-learning while the tab is open
  setInterval(refreshStats, 15000);
  setInterval(refreshEvolution, 20000);
  setInterval(refreshTokens, 30000);
  $("bootMsg")?.remove();
  $("input").focus();
})();

// bring back the current conversation so a refresh never wipes the chat
async function restoreHistory() {
  const chats = await store.recentChats(30, sessionId);
  await renderSessions();
  if (!chats.length) return;
  for (const c of chats) {
    addMsg("user", md(c.prompt));
    const m = addMsg("ai", md(c.response));
    const info = MODELS[c.model] || {};
    m.querySelector(".meta").innerHTML =
      `<span>${info.icon || ""} ${info.name || c.model}</span><span>⛁ ${c.tokens} tokens</span>` +
      `<span class="fb" title="Good" onclick="feedback(this,${c.id},true)">👍</span>` +
      `<span class="fb" title="Bad" onclick="feedback(this,${c.id},false)">👎</span>`;
  }
  $("chat").scrollTop = $("chat").scrollHeight;
}

// sidebar list of past conversations
async function renderSessions() {
  const box = $("sessionList");
  if (!box) return;
  const sessions = await store.chatSessions(30);
  box.innerHTML = "";
  if (!sessions.length) {
    box.innerHTML = `<div class="sess-empty">${lang === "hi" ? "abhi koi chat nahi" : "no chats yet"}</div>`;
    return;
  }
  for (const s of sessions) {
    const d = document.createElement("div");
    d.className = "sess" + (s.id === sessionId ? " active" : "");
    d.onclick = () => switchSession(s.id);
    d.innerHTML = `<span class="sess-t">${escapeHtml(s.title || "Chat")}</span><span class="sess-n">${s.count}</span>`;
    box.appendChild(d);
  }
}

window.newChat = function () {
  sessionId = "s_" + Date.now().toString(36);
  localStorage.setItem("superai_session", sessionId);
  document.querySelectorAll(".msg, .history-sep").forEach((el) => el.remove());
  const chat = $("chat");
  if (!$("welcome")) {
    const w = document.createElement("div");
    w.className = "welcome"; w.id = "welcome";
    w.innerHTML = `<div class="big-orb">✦</div><h2><span>${lang === "hi" ? "Nayi chat" : "New chat"}</span> — <span>Super AI</span></h2>
      <p>${lang === "hi" ? "Kuch bhi poochho ya code mangwao — main yaad rakhungi." : "Ask anything or request code — I'll remember it."}</p>`;
    chat.appendChild(w);
  }
  renderSessions();
  $("input").focus();
  toast(lang === "hi" ? "Nayi chat shuru ✨" : "New chat started ✨");
};

async function switchSession(sid) {
  sessionId = sid;
  localStorage.setItem("superai_session", sid);
  document.querySelectorAll(".msg, .history-sep, #welcome").forEach((el) => el.remove());
  const chats = await store.recentChats(40, sid);
  for (const c of chats) {
    addMsg("user", md(c.prompt));
    const m = addMsg("ai", md(c.response));
    const info = MODELS[c.model] || {};
    m.querySelector(".meta").innerHTML =
      `<span>${info.icon || ""} ${info.name || c.model}</span><span>⛁ ${c.tokens} tokens</span>`;
  }
  renderSessions();
  $("chat").scrollTop = $("chat").scrollHeight;
}

// if the user loaded a Real Brain before, load it again from the browser
// cache automatically — no click, no re-download
async function autoLoadBrain() {
  let saved = localStorage.getItem("superai_brain_model");
  const cfg = window.SUPERAI_CONFIG || {};
  // first visit: auto-download the small Real Brain in the background,
  // so every user gets a real LLM without clicking anything
  if (!saved && cfg.AUTO_BRAIN_DOWNLOAD && realBrain.supported() && !isMobileDevice()
      && !localStorage.getItem("superai_brain_optout")) {
    saved = cfg.AUTO_BRAIN_MODEL || "SmolLM2-360M-Instruct-q4f16_1-MLC";
    toast(lang === "hi"
      ? "✦ Codian Neo taiyaar ho raha hai…"
      : "✦ Preparing Codian Neo…");
  }
  if (!saved || !realBrain.supported() || realBrain.ready) return;
  setBrainBadge(lang === "hi" ? "cache se load ho raha…" : "loading from cache…");
  try {
    await realBrain.load(saved, (r) => {
      const pct = Math.round((r.progress || 0) * 100);
      setBrainBadge(pct < 100 ? pct + "%" : "…");
    });
    setBrainBadge("ready ✓");
    toast("✦ Codian Neo ready", "good");
    localStorage.setItem("superai_brain_model", saved); // remember for next visit
  } catch {
    setBrainBadge("");
    localStorage.setItem("superai_brain_optout", "1"); // don't retry-loop on failure
  }
}

function setBrainBadge(text) {
  const el = document.getElementById("brainBadge");
  if (el) { el.textContent = text || "LLM"; el.classList.toggle("on", /ready/.test(text)); }
}

// ---------------- i18n ----------------
function applyI18n() {
  const t = I18N[lang];
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (t[key]) el.textContent = t[key];
  });
  $("input").placeholder = t.placeholder;
  $("langToggle").textContent = lang === "en" ? "🌐 EN" : "🌐 हिं";
  document.documentElement.lang = lang;
}
window.toggleLang = function () {
  lang = lang === "en" ? "hi" : "en";
  localStorage.setItem("superai_lang", lang);
  applyI18n();
};

// ---------------- models ----------------
function loadModels() {
  const list = $("modelList");
  list.innerHTML = "";
  for (const [id, m] of Object.entries(MODELS)) {
    const d = document.createElement("div");
    d.className = "model" + (id === currentModel ? " active" : "");
    d.onclick = () => selectModel(id);
    const tierPill = id === "super-brain"
      ? `<span class="pill" id="brainBadge">${realBrain.ready ? "ready ✓" : m.tier}</span>`
      : `<span class="pill">${m.tier}</span>`;
    d.innerHTML = `
      <div class="mi">${m.icon}</div>
      <div style="flex:1">
        <div class="mn">${m.name}</div>
        <div class="mt">${m.task}</div>
        <div class="badges">${tierPill}<span class="pill cost">${m.cost}× tokens</span></div>
      </div>`;
    list.appendChild(d);
  }
  updateTopbar();
}
function selectModel(id) {
  currentModel = id;
  localStorage.setItem("superai_model", id);
  document.querySelectorAll(".model").forEach((el, i) =>
    el.classList.toggle("active", Object.keys(MODELS)[i] === id));
  updateTopbar();
  if (id === "super-brain" && !realBrain.ready) {
    openBrainModal();
  } else {
    toast(`→ ${MODELS[id].name}`);
  }
}
function updateTopbar() {
  const m = MODELS[currentModel];
  $("curModelIcon").textContent = m.icon;
  $("curModelName").textContent = m.name;
  $("curModelTask").textContent = m.task;
}

// ---------------- tokens ----------------
function renderBalance(b) {
  const t = I18N[lang];
  $("tokRemaining").textContent = b.remaining.toLocaleString();
  $("tokLimit").textContent = b.daily_limit.toLocaleString();
  $("tokUsed").textContent = `${b.used.toLocaleString()} ${t.used}`;
  $("tokReqs").textContent = `${b.requests_today} ${t.requests}`;
  const pct = Math.max(0, Math.min(100, (100 * b.remaining) / b.daily_limit));
  const bar = $("tokBar");
  bar.style.width = pct + "%";
  bar.classList.toggle("low", pct < 20);
  const h = Math.floor(b.resets_in_sec / 3600), mn = Math.floor((b.resets_in_sec % 3600) / 60);
  $("resetIn").textContent = `${t.resets} ${h}h ${mn}m`;
  $("limitBanner").classList.toggle("show", b.remaining <= 0);
}
async function refreshTokens() { renderBalance(await bank.balance(userId)); }

// Internal stats/feed are hidden in the public product — kept as safe no-ops
// so background code that calls them never breaks.
async function refreshStats() {}
async function refreshEvolution() {}

// ---------------- chat ----------------
const LANG_EXT = { python: "py", javascript: "js", html: "html", java: "java", cpp: "cpp",
  c: "c", sql: "sql", css: "css", bash: "sh", go: "go", rust: "rs", typescript: "ts" };

function md(s) {
  // protect code blocks first so inline rules can't mangle code (underscores!)
  const codes = [];
  let h = escapeHtml(s);
  h = h.replace(/```([\s\S]*?)(```|$)/g, (_, c) => {
    // capture the language hint (```python / ```sql), then strip it from the code
    const langMatch = c.match(/^[ \t]*([a-z0-9+#]{1,12})\r?\n/i);
    const cl = langMatch ? langMatch[1].toLowerCase() : "";
    codes.push({ code: c.replace(/^[ \t]*[a-z0-9+#]{1,12}\r?\n/i, "").trim(), lang: cl });
    return "\uE000" + (codes.length - 1) + "\uE001";
  });
  h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
  h = h.replace(/\*\*([^*\n]{1,200})\*\*/g, "<b>$1</b>");
  h = h.replace(/(^|[\s(])_([^_\n]{3,160})_(?=$|[\s.,;:)!?])/gm, "$1<em>$2</em>");
  h = h.replace(/^[\u2022*-] /gm, "&bull; ");
  // reasoning traces -> collapsible blocks (local [[think]] + Real Brain <thinking>)
  h = h.replace(/\[\[think\]\]([\s\S]*?)(\[\[\/think\]\]|$)/g,
    '<details class="think"><summary>\u{1F9E0} Reasoning</summary><div>$1</div></details>');
  h = h.replace(/&lt;thinking&gt;([\s\S]*?)(&lt;\/thinking&gt;|$)/gi,
    '<details class="think"><summary>\u{1F9E0} Thinking</summary><div>$1</div></details>');
  h = h.replace(/\uE000(\d+)\uE001/g, (_, i) => {
    const { code, lang: cl } = codes[+i];
    return `<div class="codebox"><div class="codebar"><span class="cb-lang">${cl || "code"}</span>` +
      `<span class="cb-actions"><button class="cb-btn" onclick="copyCode(this)">\u{1F4CB} Copy</button>` +
      `<button class="cb-btn" onclick="downloadCode(this,'${LANG_EXT[cl] || "txt"}')">\u2B07 Save</button></span></div>` +
      `<pre>${code}</pre></div>`;
  });
  return h;
}

window.copyCode = function (btn) {
  const code = btn.closest(".codebox").querySelector("pre").innerText;
  navigator.clipboard.writeText(code).then(
    () => { btn.textContent = "\u2705 Copied"; setTimeout(() => (btn.innerHTML = "\u{1F4CB} Copy"), 1600); },
    () => toast("\u26A0\uFE0F copy blocked by browser", "bad"));
};
window.downloadCode = function (btn, ext) {
  const code = btn.closest(".codebox").querySelector("pre").innerText;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([code], { type: "text/plain" }));
  a.download = "superai-code." + ext;
  a.click();
  URL.revokeObjectURL(a.href);
};

// Typewriter effect for local answers. Fixed frame count (~65 frames) means
// even a huge code answer finishes in ~1.6s and never hangs the browser.
function typeOut(bubble, text) {
  return new Promise((resolve) => {
    const total = text.length;
    const step = Math.max(4, Math.ceil(total / 65));
    let i = 0;
    const iv = setInterval(() => {
      i += step;
      if (i >= total) {
        clearInterval(iv);
        bubble.innerHTML = md(text);
        $("chat").scrollTop = $("chat").scrollHeight;
        resolve();
        return;
      }
      bubble.innerHTML = md(text.slice(0, i)) + '<span class="caret"></span>';
      $("chat").scrollTop = $("chat").scrollHeight;
    }, 24);
  });
}
function addMsg(role, html) {
  $("welcome")?.remove();
  const m = document.createElement("div");
  m.className = "msg " + role;
  m.innerHTML = `<div class="avatar">${role === "ai" ? "🧠" : "👤"}</div>
    <div style="min-width:0"><div class="bubble">${html}</div><div class="meta"></div></div>`;
  $("chat").appendChild(m);
  $("chat").scrollTop = $("chat").scrollHeight;
  return m;
}
function addTyping() {
  const m = addMsg("ai", '<div class="typing"><i></i><i></i><i></i></div>');
  return m;
}

window.send = async function () {
  const input = $("input");
  const text = input.value.trim();
  if (!text || busy) return;
  busy = true; $("sendBtn").disabled = true;
  input.value = ""; autosize(input);
  addMsg("user", md(text));
  const typing = addTyping();

  try {
    const estimate = bank.estimateCost(text, currentModel);
    if (!(await bank.canSpend(userId, estimate))) {
      typing.remove();
      renderBalance(await bank.balance(userId));
      addMsg("ai", "🚫 <b>" + I18N[lang].limitHit + "</b>");
      busy = false; $("sendBtn").disabled = false; return;
    }

    const t0 = performance.now();
    let response, aiMsg;
    // Identity/creator questions always answer locally (guaranteed codian_studio).
    const CREATOR = /(who (made|created|built|are) you|kisne banaya|tum kaun|kaun ho|aap kaun|tumhe kisne)/i;
    // Priority: GPU Hub (shared powerful brain) → on-device Neo → local engine.
    const useHub = hub.active && !CREATOR.test(text);
    const useBrain = !useHub && (currentModel === "super-brain" ||
      (realBrain.ready && currentModel !== "super-llama" && !CREATOR.test(text)));

    if (currentModel === "super-brain" && !realBrain.ready && !hub.active) {
      typing.remove();
      openBrainModal();
      addMsg("ai", "🧩 " + (lang === "hi"
        ? "Pehle Codian Neo activate karo — ek baar taiyaar hone ke baad sab kuch aapke device par private chalega."
        : "Activate Codian Neo first — after a one-time setup everything runs privately on your device."));
      busy = false; $("sendBtn").disabled = false; return;
    }

    if (useHub) {
      // stream from the ONE shared server brain; throttled paint so big code is smooth
      typing.remove();
      aiMsg = addMsg("ai", '<span class="caret"></span>');
      const bubble = aiMsg.querySelector(".bubble");
      let latest = "", done = false;
      const painter = setInterval(() => {
        if (latest) {
          bubble.innerHTML = md(latest) + (done ? "" : '<span class="caret"></span>');
          $("chat").scrollTop = $("chat").scrollHeight;
        }
        if (done) clearInterval(painter);
      }, 80);
      try {
        response = await hub.chatStream(text, (partial) => { latest = partial; });
      } catch (err) {
        // Hub went down mid-session → fall back to the local engine, no data lost
        hub.active = false;
        response = await brain.respond(text, currentModel);
      } finally {
        done = true;
      }
      latest = response;
      bubble.innerHTML = md(response);
    } else if (useBrain) {
      // stream into ONE bubble, throttled to ~12fps so big code never hangs the tab
      typing.remove();
      aiMsg = addMsg("ai", '<span class="caret"></span>');
      const bubble = aiMsg.querySelector(".bubble");
      let latest = "", done = false;
      const painter = setInterval(() => {
        if (latest) {
          bubble.innerHTML = md(latest) + (done ? "" : '<span class="caret"></span>');
          $("chat").scrollTop = $("chat").scrollHeight;
        }
        if (done) clearInterval(painter);
      }, 80);
      try {
        response = await realBrain.chat(text, (partial) => { latest = partial; });
      } finally {
        done = true;
      }
      latest = response;
      bubble.innerHTML = md(response);
    } else {
      response = await brain.respond(text, currentModel);
      typing.remove();
      aiMsg = addMsg("ai", "");
      await typeOut(aiMsg.querySelector(".bubble"), response);
    }
    const latency = Math.round(performance.now() - t0);
    const cost = bank.costOf(text, response, currentModel);
    await bank.spend(userId, cost);
    const chatId = await store.logChat(userId, currentModel, text, response, cost, sessionId);
    // learn from every conversation (the user is teaching it), then refresh history
    await brain.learnFromChat(text);
    if ((useBrain || useHub) && response) await brain.learnText(`brain:${Date.now()}`, "AI answer", response, "chat");
    renderSessions();

    const meta = aiMsg.querySelector(".meta");
    const info = MODELS[currentModel];
    meta.innerHTML = `
      <span>${info.icon} ${info.name}</span>
      <span>⛁ ${cost} tokens</span>
      <span>⏱ ${latency}ms</span>
      <span class="fb" title="Good" onclick="feedback(this,${chatId},true)">👍</span>
      <span class="fb" title="Bad — it adapts" onclick="feedback(this,${chatId},false)">👎</span>`;
    renderBalance(await bank.balance(userId));
    refreshStats(); refreshEvolution();
  } catch (e) {
    typing.remove();
    addMsg("ai", "⚠️ " + escapeHtml(e.message));
  }
  busy = false; $("sendBtn").disabled = false; input.focus();
};

window.feedback = async function (el, chatId, good) {
  if (el.classList.contains("done")) return;
  el.parentElement.querySelectorAll(".fb").forEach((f) => f.classList.add("done"));
  el.style.transform = "scale(1.3)";
  await store.setFeedback(chatId, good ? 1 : -1);
  await brain.applyFeedback(good, currentModel);
  toast(good ? "👍 reinforced" : "👎 will adapt", good ? "good" : "bad");
  refreshEvolution();
};

window.ask = function (q) { $("input").value = q; window.send(); };
window.onKey = function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); window.send(); } };
window.autosize = autosize;
function autosize(t) { t.style.height = "auto"; t.style.height = Math.min(140, t.scrollHeight) + "px"; }

// ---------------- actions ----------------
window.openTeach = function () { $("teachOverlay").classList.add("show"); $("teachUrl").focus(); };
window.closeTeach = function () { $("teachOverlay").classList.remove("show"); };
window.teach = async function () {
  const url = $("teachUrl").value.trim();
  if (!url) return;
  const btn = $("teachGo"); btn.disabled = true; btn.textContent = "Learning…";
  const res = await harvester.learnUrl(url);
  btn.disabled = false; btn.textContent = "Learn it";
  if (res.ok) {
    window.closeTeach(); $("teachUrl").value = "";
    toast(`📚 Learned ${res.learned} sentences from "${res.title || url}"`, "good");
    refreshStats(); refreshEvolution();
  } else {
    toast("⚠️ " + res.error, "bad");
  }
};

window.trainNeural = async function () {
  const btn = $("trainBtn"); btn.disabled = true;
  const res = await brain.trainNeural(300, (step) => { btn.textContent = `🦙 ${step}/300`; });
  btn.disabled = false; btn.textContent = "🦙 " + I18N[lang].train;
  toast(res.loss != null ? `🦙 trained ${res.trained} steps — loss ${res.loss}` : (res.error || "done"), "good");
  refreshStats(); refreshEvolution();
};

window.selfImprove = async function () {
  toast("⚡ Self-improvement cycle: GitHub + curiosity + neural training…");
  harvester.cycle().then(() => { refreshStats(); refreshEvolution(); });
};

// ---------------- Swarm Intelligence (export / import / P2P) ----------------
let swarmLink = null;

window.openSwarm = function () { $("swarmOverlay").classList.add("show"); $("swarmStatus").textContent = ""; };
window.closeSwarm = function () { $("swarmOverlay").classList.remove("show"); swarmLink?.close(); swarmLink = null; };

window.swarmExport = async function () {
  $("swarmStatus").textContent = "packing the mind…";
  const bundle = await exportBundle(brain, store);
  const blob = new Blob([JSON.stringify(bundle)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "knowledge_swarm_delta.json";
  a.click();
  URL.revokeObjectURL(a.href);
  $("swarmStatus").textContent = `exported ${bundle.docs.length} docs + neural delta ✓`;
  brain.evolve("swarm-export", `mind exported as knowledge_swarm_delta.json (${bundle.docs.length} docs)`);
};

window.swarmImport = function () { $("swarmFile").click(); };
window.swarmImportFile = async function (input) {
  const file = input.files[0];
  if (!file) return;
  $("swarmStatus").textContent = "merging peer mind…";
  try {
    const bundle = JSON.parse(await file.text());
    const r = await importBundle(brain, store, bundle);
    $("swarmStatus").textContent = r.ok
      ? `merged: +${r.docs} docs, +${r.sents} sentences, neural ${r.neural ? "✓" : "—"}`
      : "⚠️ " + r.error;
    refreshStats(); refreshEvolution();
  } catch (e) {
    $("swarmStatus").textContent = "⚠️ invalid file: " + e.message;
  }
  input.value = "";
};

async function onPeerBundle(bundle) {
  const r = await importBundle(brain, store, bundle);
  $("swarmStatus").textContent = r.ok
    ? `🔗 peer mind merged: +${r.docs} docs, neural ${r.neural ? "✓" : "—"}`
    : "⚠️ " + r.error;
  refreshStats(); refreshEvolution();
  toast("🔗 Swarm sync complete — this AI now knows what the peer's AI learned", "good");
}

window.swarmHost = async function () {
  swarmLink = new SwarmLink(onPeerBundle, (t) => { $("swarmStatus").textContent = t; syncWhenOpen(); });
  $("swarmStatus").textContent = "creating pairing code…";
  const code = await swarmLink.createOffer();
  $("swarmCode").value = code;
  $("swarmStatus").textContent = "1) Send this code to your friend  2) paste their reply below  3) Connect";
};
window.swarmJoin = async function () {
  const code = $("swarmCode").value.trim();
  if (!code) { $("swarmStatus").textContent = "paste the friend's code first"; return; }
  swarmLink = new SwarmLink(onPeerBundle, (t) => { $("swarmStatus").textContent = t; syncWhenOpen(); });
  const answer = await swarmLink.acceptOffer(code);
  $("swarmCode").value = answer;
  $("swarmStatus").textContent = "reply code ready — send it back to the host";
};
window.swarmConnect = async function () {
  if (!swarmLink) { $("swarmStatus").textContent = "create a code first"; return; }
  await swarmLink.acceptAnswer($("swarmCode").value);
};
function syncWhenOpen() {
  // once the channel opens, both sides push their minds automatically
  if (swarmLink?.channel?.readyState === "open") {
    exportBundle(brain, store).then((b) => swarmLink.sendBundle(b));
  }
}
window.copySwarmCode = function () {
  navigator.clipboard.writeText($("swarmCode").value).then(() => toast("code copied ✓", "good"));
};

// ---------------- Real Brain modal ----------------
function openBrainModal() {
  const box = $("brainModels");
  if (!realBrain.supported()) {
    box.innerHTML = `<p style="color:var(--bad);font-size:13px;line-height:1.6">⚠️ ${lang === "hi"
      ? "Codian Neo ke liye latest <b>Chrome/Edge</b> (desktop ya Android) ya Safari 26+ chahiye. Tab tak baaki models bilkul chalte hain."
      : "Codian Neo needs a recent <b>Chrome/Edge</b> (desktop or Android) or Safari 26+. The other models work everywhere."}</p>`;
    $("brainGo").style.display = "none";
  } else {
    box.innerHTML = BRAIN_MODELS.map((m, i) => `
      <label class="brain-opt">
        <input type="radio" name="brainModel" value="${m.id}" ${i === 0 ? "checked" : ""}>
        <span><b>${m.label}</b> <span class="pill cost">${m.size}</span><br>
        <small>${m.desc}</small></span>
      </label>`).join("");
    $("brainGo").style.display = "";
  }
  $("brainProgress").style.display = "none";
  $("brainOverlay").classList.add("show");
}
window.openBrainModal = openBrainModal;
window.closeBrainModal = function () { $("brainOverlay").classList.remove("show"); };

window.loadRealBrain = async function () {
  const sel = document.querySelector('input[name="brainModel"]:checked');
  if (!sel) return;
  const btn = $("brainGo");
  btn.disabled = true;
  const prog = $("brainProgress");
  prog.style.display = "block";
  try {
    await realBrain.load(sel.value, (r) => {
      const pct = Math.round((r.progress || 0) * 100);
      $("brainBar").style.width = pct + "%";
      $("brainStatus").textContent = (r.text || "").slice(0, 90) || `${pct}%`;
    });
    window.closeBrainModal();
    localStorage.setItem("superai_brain_model", sel.value); // auto-reload next visit
    setBrainBadge("ready ✓");
    toast("✦ Codian Neo activated — loads instantly next time", "good");
    brain.evolve("neo", "on-device intelligence activated");
    refreshEvolution();
  } catch (e) {
    $("brainStatus").textContent = "⚠️ " + e.message;
  }
  btn.disabled = false;
};

let toastTimer;
function toast(msg, cls = "") {
  const t = $("toast");
  t.className = "toast show " + cls;
  t.innerHTML = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}
