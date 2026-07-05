// brain.js — the mind. TF-IDF retrieval + word Markov generation + LlamaLite
// neural model + feedback-adaptive strategy + curiosity queue. All in-browser.

import { tokenize, splitSentences, STOP, nowSec } from "./core.js";
import { LlamaLite } from "./llamalite.js";
import { KB } from "./knowledge.js";
import { isHindi, tryMath, trySmallTalk, tryCodeGen, codeFallback } from "./codegen.js";
import { embed, cosine } from "./vectors.js";

export const MODELS = {
  "super-coder": { name: "Codian Coder", task: "Flagship coding engine — writes & explains any language", cost: 4, icon: "⌘", tier: "Pro" },
  "super-chat":  { name: "Codian Core",  task: "Everyday questions & conversation",           cost: 2, icon: "◆", tier: "Standard" },
  "super-brain": { name: "Codian Neo",   task: "On-device intelligence — private & offline", cost: 3, icon: "✦", tier: "Neo" },
  "super-mini":  { name: "Codian Swift", task: "Instant answers, lowest cost",                cost: 1, icon: "⚡", tier: "Swift" },
  "super-sage":  { name: "Codian Sage",  task: "Deep reasoning & multi-source research",      cost: 6, icon: "❖", tier: "Max" },
};

const KB_VERSION = "2";

const GREETING_RE = /^\s*(hi|hii+|hello|hey|namaste|namaskar|yo|hola|salaam|assalam)\b/i;
const IDENTITY_RE = /\b(who are you|tum kaun|kaun ho|what are you|about you|aap kaun|tu kya (hai|h)|kya ho tum)\b/i;
const CREATOR_RE = /(who (made|created|built|designed) you|kisne banaya|kis ?ne banaya|tumhe kisne|kaun banaya|creator kaun|developer kaun|banane wala|owner kaun|malik kaun)/i;
const CODE_HINT_RE = /\b(code|function|error|bug|compile|syntax|api|class|loop|array|pointer|async|sql|query|regex|algorithm|program|script)\b/i;

export class SuperBrain {
  constructor(store) {
    this.store = store;
    this.llama = new LlamaLite(store);
    this.index = new Map();       // word -> Set(sentenceId)
    this.sentById = new Map();
    this.vecById = new Map();     // sentenceId -> embedding vector
    this.docFreq = new Map();
    this.markov = new Map();      // "w1|w2" -> {word:count}
    this.markovStarts = [];
    this.strategy = { retrieval: 1.0, markov: 0.6, neural: 0.4 };
    this.evolutionCycle = 0;
  }

  async init() {
    await this.llama.loadCheckpoint();
    this.strategy = await this.store.getJSON("strategy", this.strategy);
    this.evolutionCycle = parseInt(await this.store.getKV("evolution_cycle", "0")) || 0;
    // seed the built-in knowledge base (versioned: re-seeds new entries on upgrade)
    if ((await this.store.getKV("kb_seeded")) !== KB_VERSION) {
      let added = 0;
      for (const e of KB) {
        const src = `kb:${e.lang}:${e.title}`;
        if (await this.store.hasSource(src)) continue;
        // answer stays clean; trigger keywords ride in the (indexed) title
        await this.learnText(src, `${e.title} · ${e.q}`,
          e.a, e.lang === "CS" ? "text" : "code", true);
        added++;
      }
      await this.store.setKV("kb_seeded", KB_VERSION);
      if (added) await this.evolve("boot", `seeded ${added} built-in knowledge entries (v${KB_VERSION})`);
    }
    await this._rebuild();
  }

  async _rebuild() {
    this.index.clear(); this.sentById.clear(); this.docFreq.clear();
    this.markov.clear(); this.markovStarts = [];
    for (const row of await this.store.allSentences()) this._indexSentence(row.id, row);
  }

  _indexSentence(sid, row) {
    if (this.sentById.has(sid)) return;
    this.sentById.set(sid, row);
    this.vecById.set(sid, embed(row.sent + " " + (row.title || "")));
    // index the sentence AND its title, so trigger keywords in the title
    // (which persist across reloads) improve retrieval without cluttering answers
    const words = new Set(tokenize(row.sent + " " + (row.title || "")));
    for (const w of words) {
      if (!this.index.has(w)) this.index.set(w, new Set());
      this.index.get(w).add(sid);
      this.docFreq.set(w, (this.docFreq.get(w) || 0) + 1);
    }
    const toks = tokenize(row.sent);
    if (toks.length >= 3) {
      this.markovStarts.push([toks[0], toks[1]]);
      for (let i = 0; i < toks.length - 2; i++) {
        const key = toks[i] + "|" + toks[i + 1];
        if (!this.markov.has(key)) this.markov.set(key, {});
        const m = this.markov.get(key);
        m[toks[i + 2]] = (m[toks[i + 2]] || 0) + 1;
      }
    }
  }

  // ---------------- learning ----------------
  async learnText(source, title, body, kind = "text", keepWhole = false) {
    body = keepWhole ? body.trim() : body.replace(/\s+/g, " ").trim();
    if (body.length < 25) return 0;
    let sentences;
    if (keepWhole) {
      sentences = [body.slice(0, 1000)];
    } else {
      sentences = splitSentences(body);
      if (!sentences.length) sentences = [body.slice(0, 500)];
    }
    const { rows } = await this.store.addDoc(source, title, kind, body, sentences);
    for (const r of rows) this._indexSentence(r.id, r);
    return rows.length;
  }

  async learnFromChat(prompt) {
    if (prompt.length > 40) {
      await this.learnText(`chat:${nowSec()}`, "User conversation", prompt, "chat");
    }
  }

  async applyFeedback(good, model) {
    const delta = good ? 0.05 : -0.05;
    const key = model === "super-brain" ? "neural" : "retrieval";
    this.strategy[key] = Math.min(2, Math.max(0.1, this.strategy[key] + delta));
    if (!good) this.strategy.markov = Math.min(2, this.strategy.markov + 0.03);
    await this.store.setJSON("strategy", this.strategy);
    await this.evolve("feedback", `${good ? "👍" : "👎"} on ${model}; strategy retuned`);
  }

  async evolve(event, detail = "") {
    this.evolutionCycle++;
    await this.store.setKV("evolution_cycle", String(this.evolutionCycle));
    await this.store.logEvolution(this.evolutionCycle, event, detail);
  }

  async trainNeural(steps = 250, onProgress = null) {
    const corpus = await this.store.corpusText();
    const res = await this.llama.train(corpus, steps, 0.05, onProgress);
    if (res.trained) await this.evolve("neural-training", `LlamaLite trained ${res.trained} steps, loss=${res.loss}`);
    return res;
  }

  // ---------------- retrieval ----------------
  // Returns [score, row, coverage] where coverage = fraction of the query's
  // content words that this sentence actually matches. Low coverage answers
  // are garbage mash-ups — callers must gate on it.
  _scoreSentences(query, kind = null, top = 6) {
    let qWords = [...new Set(tokenize(query).filter((w) => !STOP.has(w)))];
    if (!qWords.length) qWords = [...new Set(tokenize(query))];
    if (!qWords.length) return [];
    const nSents = Math.max(1, this.sentById.size);
    const scores = new Map();
    const matched = new Map(); // sid -> count of distinct query words present
    for (const w of qWords) {
      const ids = this.index.get(w);
      if (!ids) continue;
      const idf = Math.log(1 + nSents / (1 + (this.docFreq.get(w) || 0)));
      for (const sid of ids) {
        scores.set(sid, (scores.get(sid) || 0) + idf);
        matched.set(sid, (matched.get(sid) || 0) + 1);
      }
    }
    const qVec = embed(query);
    const ranked = [];
    for (const [sid, sc0] of scores) {
      const row = this.sentById.get(sid);
      if (!row) continue;
      let sc = sc0;
      if (kind && row.kind !== kind) sc *= 0.5;
      if (kind && row.kind === kind) sc *= 1.4;
      sc /= Math.sqrt(1 + row.sent.length / 200);
      const coverage = (matched.get(sid) || 0) / qWords.length;
      // hybrid: TF-IDF keyword score blended with embedding cosine similarity
      const vec = this.vecById.get(sid);
      const sim = vec ? Math.max(0, cosine(qVec, vec)) : 0;
      ranked.push([sc * (0.4 + coverage) * (1 + sim), row, Math.max(coverage, sim)]);
    }
    ranked.sort((a, b) => b[0] - a[0]);
    return ranked.slice(0, top);
  }

  // is the best hit actually about the question?
  _relevant(hits, minCoverage = 0.45) {
    return hits.length > 0 && hits[0][2] >= minCoverage;
  }

  _markovRide(seedWords, maxWords = 38) {
    let key = null;
    for (let i = 0; i < seedWords.length - 1; i++) {
      const cand = seedWords[i].toLowerCase() + "|" + seedWords[i + 1].toLowerCase();
      if (this.markov.has(cand)) { key = cand; break; }
    }
    if (!key) {
      if (!this.markovStarts.length) return "";
      const s = this.markovStarts[Math.floor(Math.random() * this.markovStarts.length)];
      key = s[0] + "|" + s[1];
    }
    const out = key.split("|");
    for (let i = 0; i < maxWords; i++) {
      const m = this.markov.get(key);
      if (!m) break;
      const words = Object.keys(m);
      const weights = Object.values(m);
      const tot = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * tot, nxt = words[0];
      for (let j = 0; j < words.length; j++) { r -= weights[j]; if (r <= 0) { nxt = words[j]; break; } }
      out.push(nxt);
      key = out[out.length - 2] + "|" + nxt;
    }
    const t = out.join(" ");
    return t ? t[0].toUpperCase() + t.slice(1) + "." : "";
  }

  async _queueCuriosity(prompt) {
    const queue = await this.store.getJSON("curiosity_queue", []);
    const topic = tokenize(prompt).filter((w) => !STOP.has(w)).slice(0, 4).join(" ");
    if (topic && !queue.includes(topic)) {
      queue.push(topic);
      await this.store.setJSON("curiosity_queue", queue.slice(-25));
    }
    return topic;
  }

  // ---------------- response ----------------
  async respond(prompt, model) {
    model = MODELS[model] ? model : "super-chat";
    prompt = prompt.trim();
    const hindi = isHindi(prompt);

    if (GREETING_RE.test(prompt)) {
      const docs = await this.store.docCount();
      return hindi
        ? pick([
            `Namaste! 🙏 Main Super AI hu — poori tarah aapke browser me chalne wali self-training mind. Ab tak ${docs} sources se seekh chuki hu. Code chahiye, sawal hai, ya kuch sikhana hai?`,
            `Hello ji! Kuch bhi pucho — code likhwa lo, math karwa lo, ya 🧩 Real Brain select karke asli LLM se baat karo (bina API ke!).`,
          ])
        : pick([
            `Hello! I am Super AI — a self-training mind running entirely in your browser. I've learned from ${docs} sources so far. Ask me anything or teach me something new.`,
            `Hey! I can write code, do math, and answer programming questions. Pick 🧩 Real Brain in the sidebar to chat with a real LLM running locally — no API.`,
          ]);
    }

    if (IDENTITY_RE.test(prompt) || CREATOR_RE.test(prompt)) {
      return this._identityAnswer(hindi);
    }

    // universal skills first: memory, small talk, math, code
    const mem = await this._tryMemory(prompt, hindi);
    if (mem) return mem;
    const st = trySmallTalk(prompt);
    if (st) return st;
    const math = tryMath(prompt);
    if (math) return math;
    const code = tryCodeGen(prompt);
    if (code) return code;

    // auto-route obvious code questions to the coder path even on chat model
    const codey = CODE_HINT_RE.test(prompt);

    if (model === "super-mini") return this._respMini(prompt);
    if (model === "super-coder" || codey) return this._respCoder(prompt);
    if (model === "super-sage") return this._respSage(prompt);
    return this._respChat(prompt);
  }

  // ---------------- identity (varied, never a fixed script) ----------------
  _identityAnswer(hindi) {
    const HI = [
      "Main **Super AI** hu — ek product by **codian_studio**. Coding, reasoning aur har tarah ke sawaal mera kaam hai. Batao, kya banaye?",
      "Naam hai **Super AI**, banaya hai **codian_studio** ne. Meri specialty coding hai — professional level. Aap shuru karo!",
      "Super AI bolte hain mujhe — **codian_studio** ka product. Code likhna ho ya kuch samajhna ho, main haazir hu. \u{1F600}",
      "Main **codian_studio** ki **Super AI** hu. Aapka personal coding aur answering assistant. Poochho jo poochhna hai!",
      "**Super AI** — powered by **codian_studio**. Fast, smart, aur coding me expert. Kaise madad karu?",
      "Mujhe **codian_studio** ne banaya hai — naam **Super AI**. Coding meri jaan hai, par normal baat-cheet bhi karti hu. \u{1F680}",
    ];
    const EN = [
      "I'm **Super AI** — a product by **codian_studio**. Coding, reasoning and everyday questions are all mine. What shall we build?",
      "The name's **Super AI**, built by **codian_studio**. Coding is my specialty \u2014 professional grade. Let's get started!",
      "They call me Super AI \u2014 a **codian_studio** product. Whether it's writing code or explaining ideas, I'm here. \u{1F600}",
      "I'm **codian_studio**'s **Super AI**, your personal coding and answering assistant. Ask me anything!",
      "**Super AI** \u2014 powered by **codian_studio**. Fast, smart, and expert at code. How can I help?",
      "Built by **codian_studio** and named Super AI. Coding is my passion, but I'm happy to just chat too. \u{1F680}",
    ];
    const pool = hindi ? HI : EN;
    let idx = Math.floor(Math.random() * pool.length);
    if (idx === this._lastIdentityIdx) idx = (idx + 1) % pool.length; // never repeat back-to-back
    this._lastIdentityIdx = idx;
    return pool[idx];
  }

  // ---------------- personal memory (remembers the user) ----------------
  async _tryMemory(prompt, hindi) {
    // recall must be checked FIRST — "mera naam kya hai" also matches the save pattern
    if (/(mera naam kya|what('s| is) my name|do you know my name|my name\?|mujhe jaant[ei] ho|main kaun hu)/i.test(prompt)) {
      const name = await this.store.getKV("user_name");
      if (name)
        return hindi ? `Aap **${name}** ho! 😊 Maine yaad rakha tha.` : `You're **${name}**! 😊 I remembered.`;
      return hindi
        ? `Abhi aapne mujhe apna naam nahi bataya. Bolo "mera naam ___ hai" — main hamesha yaad rakhungi.`
        : `You haven't told me your name yet. Say "my name is ___" and I'll always remember it.`;
    }
    // learn the user's name
    let m = prompt.match(/(?:mera naam|my name is|i am called|me?ra name)\s+([A-Za-zऀ-ॿ]{2,20})/i);
    if (m && /^(kya|kaun|kaisa|batao|hai|h)$/i.test(m[1])) m = null;
    if (m) {
      const name = m[1][0].toUpperCase() + m[1].slice(1);
      await this.store.setKV("user_name", name);
      await this.evolve("memory", `remembered the user's name: ${name}`);
      return hindi
        ? `Yaad rakh liya, **${name}**! 🤝 Ab main aapko naam se jaanti hu — refresh ke baad bhi yaad rahega.`
        : `Got it, **${name}**! 🤝 I'll remember your name — even after a refresh.`;
    }
    // learn the user's city
    m = prompt.match(/(?:main|mai|mein)\s+([A-Za-zऀ-ॿ]{2,25})\s+(?:se hu|se hoon|me rehta|me rahta|me rehti)|i (?:live in|am from)\s+([A-Za-z ]{2,25})/i);
    if (m) {
      const city = (m[1] || m[2]).trim();
      await this.store.setKV("user_city", city);
      return hindi
        ? `Accha, aap **${city}** se ho! Yaad rakh liya. 📍`
        : `Nice, you're from **${city}**! I'll remember that. 📍`;
    }
    // recall city
    if (/(main kaha se|where am i from|meri city|mera sheher)/i.test(prompt)) {
      const city = await this.store.getKV("user_city");
      if (city) return hindi ? `Aap **${city}** se ho! 📍` : `You're from **${city}**! 📍`;
    }
    return null;
  }

  async _unknown(prompt) {
    await this._queueCuriosity(prompt); // silently queue for the backend learner
    const cf = codeFallback(prompt);
    if (cf) return cf;
    // realtime hook: app.js can attach a live web lookup; if absent, answer cleanly
    if (this.onUnknown) {
      const live = await this.onUnknown(prompt).catch(() => null);
      if (live) return live;
    }
    return isHindi(prompt)
      ? `Iska pakka jawab dene ke liye mujhe thoda aur context chahiye. Aap sawaal thoda alag tarike se poochho, ya **Codian Neo** on karke poochho — wo detail me jawab dega.`
      : `I need a bit more to answer that precisely. Try rephrasing, or switch on **Codian Neo** for a detailed answer.`;
  }

  async _respMini(prompt) {
    const hits = this._scoreSentences(prompt, null, 1);
    return this._relevant(hits) ? hits[0][1].sent : this._unknown(prompt);
  }

  async _respChat(prompt) {
    const hits = this._scoreSentences(prompt, null, 3);
    if (!this._relevant(hits)) return this._unknown(prompt);
    const parts = [hits[0][1].sent];
    if (hits.length > 1 && hits[1][2] >= 0.45 && Math.random() < this.strategy.retrieval / 2)
      parts.push(hits[1][1].sent);
    return parts.join(" ");
  }

  async _respCoder(prompt) {
    const hits = this._scoreSentences(prompt, "code", 5);
    if (!this._relevant(hits)) return this._unknown(prompt);
    const codeHits = hits.filter((h) => h[1].kind === "code" && h[2] >= 0.45);
    if (codeHits.length) return codeHits[0][1].sent;
    return hits[0][1].sent;
  }

  async _respSage(prompt) {
    const hits = this._scoreSentences(prompt, null, 6).filter((h) => h[2] >= 0.4);
    if (!this._relevant(hits, 0.45)) return this._unknown(prompt);
    const lines = hits.slice(0, 4).map(([, row]) => `• ${row.sent}`);
    return lines.join("\n");
  }

  async stats() {
    return {
      docs: await this.store.docCount(),
      sentences: await this.store.sentenceCount(),
      vocab_indexed: this.index.size,
      markov_states: this.markov.size,
      chats: await this.store.chatCount(),
      evolution_cycle: this.evolutionCycle,
      feedback: await this.store.feedbackStats(),
      strategy: this.strategy,
      neural: this.llama.stats(),
      curiosity_queue: await this.store.getJSON("curiosity_queue", []),
    };
  }
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
