// app.js — wires the in-browser AI to the UI. No server, no API.

import { createStore } from "./store.js";
import { SuperBrain, MODELS } from "./brain.js";
import { TokenBank } from "./tokens.js";
import { Harvester } from "./harvester.js";
import { I18N } from "./knowledge.js";
import { escapeHtml } from "./core.js";

const $ = (id) => document.getElementById(id);

// ---------------- identity + prefs ----------------
let userId = localStorage.getItem("superai_uid");
if (!userId) {
  userId = "u_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  localStorage.setItem("superai_uid", userId);
}
let currentModel = localStorage.getItem("superai_model") || "super-chat";
let lang = localStorage.getItem("superai_lang") || "en";
let busy = false;

let store, brain, bank, harvester;

// ---------------- boot ----------------
(async function boot() {
  applyI18n();
  store = await createStore();
  brain = new SuperBrain(store);
  await brain.init();
  bank = new TokenBank(store);
  await bank.init();
  harvester = new Harvester(brain, store, 300);
  harvester.onUpdate = () => { refreshStats(); refreshEvolution(); };

  loadModels();
  await refreshTokens();
  await refreshStats();
  await refreshEvolution();

  harvester.start(); // 24×7 self-learning while the tab is open
  setInterval(refreshStats, 15000);
  setInterval(refreshEvolution, 20000);
  setInterval(refreshTokens, 30000);
  $("bootMsg")?.remove();
  $("input").focus();
})();

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
    d.innerHTML = `
      <div class="mi">${m.icon}</div>
      <div style="flex:1">
        <div class="mn">${m.name}</div>
        <div class="mt">${m.task}</div>
        <div class="badges"><span class="pill">${m.tier}</span><span class="pill cost">${m.cost}× tokens</span></div>
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
  toast(`→ ${MODELS[id].name}`);
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

// ---------------- stats + evolution ----------------
async function refreshStats() {
  const b = await brain.stats();
  const t = I18N[lang];
  $("stDocs").textContent = b.docs;
  $("stSents").textContent = b.sentences.toLocaleString();
  $("stEvo").textContent = b.evolution_cycle;
  $("stSteps").textContent = b.neural.steps_trained.toLocaleString();
  $("stLoss").textContent = b.neural.last_loss ? "loss " + b.neural.last_loss : "not trained yet";
  const spark = $("lossSpark"); spark.innerHTML = "";
  const hist = b.neural.loss_history || [];
  if (hist.length) {
    const mx = Math.max(...hist);
    hist.forEach((l) => {
      const bar = document.createElement("i");
      bar.style.height = Math.max(6, (100 * l) / mx) + "%";
      spark.appendChild(bar);
    });
  }
  ["stDocsK","stSentsK","stEvoK","stStepsK"].forEach((k, i) =>
    { const el = $(k); if (el) el.textContent = [t.docs, t.sentences, t.evolutions, t.steps][i]; });
}
async function refreshEvolution() {
  const feed = await store.evolutionFeed(30);
  const box = $("evoFeed");
  if (!feed.length) return;
  box.innerHTML = "";
  for (const e of feed) {
    const d = document.createElement("div");
    d.className = "e";
    d.innerHTML = `<b>#${e.cycle} ${escapeHtml(e.event)}</b><br>${escapeHtml(e.detail)}`;
    box.appendChild(d);
  }
}

// ---------------- chat ----------------
function md(s) {
  let h = escapeHtml(s);
  h = h.replace(/```([\s\S]*?)```/g, (_, c) => {
    // drop a leading bare language hint (```python / ```sql / ```javascript)
    const code = c.replace(/^[ \t]*[a-z0-9+#]{1,12}\r?\n/i, "").trim();
    return `<pre>${code}</pre>`;
  });
  h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
  h = h.replace(/_([^_]{3,160})_/g, "<em>$1</em>");
  h = h.replace(/^• /gm, "&bull; ");
  return h;
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
    const response = await brain.respond(text, currentModel);
    const latency = Math.round(performance.now() - t0);
    const cost = bank.costOf(text, response, currentModel);
    await bank.spend(userId, cost);
    const chatId = await store.logChat(userId, currentModel, text, response, cost);
    brain.learnFromChat(text); // learn from the user (fire and forget)

    typing.remove();
    const m = addMsg("ai", md(response));
    const meta = m.querySelector(".meta");
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

let toastTimer;
function toast(msg, cls = "") {
  const t = $("toast");
  t.className = "toast show " + cls;
  t.innerHTML = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}
