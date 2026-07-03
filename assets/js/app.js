// app.js — wires the in-browser AI to the UI. No server, no API.

import { createStore } from "./store.js";
import { SuperBrain, MODELS } from "./brain.js";
import { TokenBank } from "./tokens.js";
import { Harvester } from "./harvester.js";
import { I18N } from "./knowledge.js";
import { escapeHtml } from "./core.js";
import { RealBrain, BRAIN_MODELS } from "./realbrain.js";

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

// ---------------- boot ----------------
(async function boot() {
  applyI18n();
  // ask the browser to never evict our storage (model cache + knowledge)
  try { navigator.storage?.persist?.(); } catch { /* optional */ }
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
  await restoreHistory();

  realBrain.userName = await store.getKV("user_name");
  autoLoadBrain(); // reload cached Real Brain in the background (no re-download)

  harvester.start(); // 24×7 self-learning while the tab is open
  setInterval(refreshStats, 15000);
  setInterval(refreshEvolution, 20000);
  setInterval(refreshTokens, 30000);
  $("bootMsg")?.remove();
  $("input").focus();
})();

// bring back the last conversation so a refresh never wipes the chat
async function restoreHistory() {
  const chats = await store.recentChats(12);
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
  const sep = document.createElement("div");
  sep.className = "history-sep";
  sep.textContent = lang === "hi" ? "— pichhli baatein upar, nayi shuru karo —" : "— previous conversation above —";
  $("chat").appendChild(sep);
  $("chat").scrollTop = $("chat").scrollHeight;
}

// if the user loaded a Real Brain before, load it again from the browser
// cache automatically — no click, no re-download
async function autoLoadBrain() {
  const saved = localStorage.getItem("superai_brain_model");
  if (!saved || !realBrain.supported() || realBrain.ready) return;
  setBrainBadge(lang === "hi" ? "cache se load ho raha…" : "loading from cache…");
  try {
    await realBrain.load(saved, (r) => {
      const pct = Math.round((r.progress || 0) * 100);
      setBrainBadge(pct < 100 ? pct + "%" : "…");
    });
    setBrainBadge("ready ✓");
    toast("🧩 Real Brain ready (from cache) — " + saved.split("-q4")[0], "good");
  } catch {
    setBrainBadge("");
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
    if (currentModel === "super-brain") {
      if (!realBrain.ready) {
        typing.remove();
        openBrainModal();
        addMsg("ai", "🧩 " + (lang === "hi"
          ? "Pehle Real Brain load karo — one-time download, phir sab kuch aapke browser me hi chalega (bina API ke)."
          : "Load the Real Brain first — one-time download, then everything runs inside your browser (no API)."));
        busy = false; $("sendBtn").disabled = false; return;
      }
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
    const chatId = await store.logChat(userId, currentModel, text, response, cost);
    brain.learnFromChat(text); // learn from the user (fire and forget)

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

// ---------------- Real Brain modal ----------------
function openBrainModal() {
  const box = $("brainModels");
  if (!realBrain.supported()) {
    box.innerHTML = `<p style="color:var(--bad);font-size:13px;line-height:1.6">⚠️ ${lang === "hi"
      ? "Is browser me WebGPU nahi hai. Latest <b>Chrome/Edge</b> (desktop ya Android) ya Safari 26+ use karo — phir yahan asli Llama/Qwen LLM chalega."
      : "WebGPU isn't available in this browser. Use a recent <b>Chrome/Edge</b> (desktop or Android) or Safari 26+ to run a real Llama/Qwen LLM here."}</p>`;
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
    toast("🧩 Real Brain ready — " + sel.value.split("-q4")[0] + " (cached: next visit loads instantly)", "good");
    brain.evolve("real-brain", `loaded ${sel.value} via WebLLM (local, no API)`);
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
