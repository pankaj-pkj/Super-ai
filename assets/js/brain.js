// brain.js — the mind. TF-IDF retrieval + word Markov generation + LlamaLite
// neural model + feedback-adaptive strategy + curiosity queue. All in-browser.

import { tokenize, splitSentences, STOP, nowSec } from "./core.js";
import { LlamaLite } from "./llamalite.js";
import { KB } from "./knowledge.js";
import { isHindi, tryMath, trySmallTalk, tryCodeGen, codeFallback } from "./codegen.js";

export const MODELS = {
  "super-brain": { name: "Real Brain",  task: "Real LLM (Llama/Qwen) inside your browser — no API", cost: 3, icon: "🧩", tier: "LLM" },
  "super-chat":  { name: "Super Chat",  task: "General conversation & everyday questions",  cost: 2, icon: "💬", tier: "Balanced" },
  "super-coder": { name: "Super Coder", task: "Writes & explains code, many languages",     cost: 4, icon: "👨‍💻", tier: "Specialist" },
  "super-mini":  { name: "Super Mini",  task: "Fast replies, quick facts",                 cost: 1, icon: "⚡",  tier: "Fast" },
  "super-sage":  { name: "Super Sage",  task: "Deep research & multi-source synthesis",     cost: 6, icon: "🧠", tier: "Heavy" },
  "super-llama": { name: "Super Llama", task: "Raw output of the tiny self-trained net (experimental)", cost: 3, icon: "🦙", tier: "Neural" },
};

const KB_VERSION = "2";

const GREETING_RE = /^\s*(hi|hii+|hello|hey|namaste|namaskar|yo|hola|salaam|assalam)\b/i;
const IDENTITY_RE = /\b(who are you|tum kaun|kaun ho|what are you|about you|aap kaun)\b/i;
const CODE_HINT_RE = /\b(code|function|error|bug|compile|syntax|api|class|loop|array|pointer|async|sql|query|regex|algorithm|program|script)\b/i;

export class SuperBrain {
  constructor(store) {
    this.store = store;
    this.llama = new LlamaLite(store);
    this.index = new Map();       // word -> Set(sentenceId)
    this.sentById = new Map();
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
    const key = model === "super-llama" ? "neural" : "retrieval";
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
    const ranked = [];
    for (const [sid, sc0] of scores) {
      const row = this.sentById.get(sid);
      if (!row) continue;
      let sc = sc0;
      if (kind && row.kind !== kind) sc *= 0.5;
      if (kind && row.kind === kind) sc *= 1.4;
      sc /= Math.sqrt(1 + row.sent.length / 200);
      const coverage = (matched.get(sid) || 0) / qWords.length;
      ranked.push([sc * (0.4 + coverage), row, coverage]);
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

    if (IDENTITY_RE.test(prompt)) {
      const st = this.llama.stats();
      const docs = await this.store.docCount();
      const sents = await this.store.sentenceCount();
      return hindi
        ? `Main **Super AI** hu — bina kisi external API ke, 100% aapke browser me. Ab tak ${docs} documents (${sents} sentences) padh chuki hu, apna neural model ${st.steps_trained} steps train kiya hai, aur ${this.evolutionCycle} baar evolve hui hu. GitHub aur web se khud seekhti hu, aur har chat se bhi — is wali se bhi. 🧩 Real Brain select karo to asli Llama/Qwen LLM bhi mere andar chalega.`
        : `I am Super AI — a fully self-contained mind with no external API. I run 100% in your browser, persist my knowledge in IndexedDB, and keep learning 24×7. So far I've read ${docs} documents (${sents} sentences), trained my own neural model for ${st.steps_trained} steps, and evolved ${this.evolutionCycle} times. Pick the 🧩 Real Brain to run an actual Llama/Qwen LLM inside me.`;
    }

    // universal skills first (except raw-neural model): small talk, math, code writing
    if (model !== "super-llama") {
      const st = trySmallTalk(prompt);
      if (st) return st;
      const math = tryMath(prompt);
      if (math) return math;
      const code = tryCodeGen(prompt);
      if (code) return code;
    }

    // auto-route obvious code questions to the coder path even on chat model
    const codey = CODE_HINT_RE.test(prompt);

    if (model === "super-mini") return this._respMini(prompt);
    if (model === "super-coder" || codey) return this._respCoder(prompt);
    if (model === "super-sage") return this._respSage(prompt);
    if (model === "super-llama") return this._respLlama(prompt);
    return this._respChat(prompt);
  }

  async _unknown(prompt) {
    const topic = await this._queueCuriosity(prompt);
    // a code request deserves the honest code answer, not a research promise
    const cf = codeFallback(prompt);
    if (cf) return cf;
    return isHindi(prompt)
      ? `Iske baare me abhi mujhe poora nahi pata — maine ise apni curiosity queue me daal diya hai ("${topic}"), mera 24×7 self-learning loop Wikipedia aur GitHub se research karega. Aap "Teach from URL" se turant bhi sikha sakte ho, ya 🧩 Real Brain load karo — wo turant jawab de dega.`
      : `I don't know enough about that yet — I've added it to my curiosity queue ("${topic}") so my 24×7 self-learning loop will research it from Wikipedia and GitHub. You can also teach me instantly with "Teach from URL", or load the 🧩 Real Brain for an immediate answer.`;
  }

  async _respMini(prompt) {
    const hits = this._scoreSentences(prompt, null, 1);
    return this._relevant(hits) ? hits[0][1].sent : this._unknown(prompt);
  }

  async _respChat(prompt) {
    const hits = this._scoreSentences(prompt, null, 3);
    if (!this._relevant(hits)) return this._unknown(prompt);
    const parts = [hits[0][1].sent];
    // only add a second sentence if it's also genuinely on-topic
    if (hits.length > 1 && hits[1][2] >= 0.45 && Math.random() < this.strategy.retrieval / 2)
      parts.push(hits[1][1].sent);
    const src = hits[0][1].title || hits[0][1].source;
    return `${parts.join(" ")}\n\n_learned from: ${src}_`;
  }

  async _respCoder(prompt) {
    const hits = this._scoreSentences(prompt, "code", 5);
    if (!this._relevant(hits)) return this._unknown(prompt);
    const codeHits = hits.filter((h) => h[1].kind === "code" && h[2] >= 0.45);
    if (codeHits.length) {
      const best = codeHits[0][1];
      return `${best.sent}\n\n_source: ${best.title || best.source}_`;
    }
    return `${hits[0][1].sent}\n\n_source: ${hits[0][1].title || hits[0][1].source}_`;
  }

  async _respSage(prompt) {
    const hits = this._scoreSentences(prompt, null, 6).filter((h) => h[2] >= 0.4);
    if (!this._relevant(hits, 0.45)) return this._unknown(prompt);
    const sources = [];
    const lines = hits.slice(0, 4).map(([, row]) => {
      const src = row.title || row.source;
      if (!sources.includes(src)) sources.push(src);
      return `• ${row.sent}`;
    });
    return "Deep synthesis from my knowledge base:\n\n" + lines.join("\n") +
      `\n\n_sources: ${sources.slice(0, 4).join(", ")}_`;
  }

  async _respLlama(prompt) {
    const st = this.llama.stats();
    if (st.steps_trained === 0) return `My LlamaLite neural model hasn't been trained yet. Hit "Train Neural" (or wait for the auto-training cycle) and ask again.`;
    const gen = this.llama.generate(prompt, 200, 0.85);
    return `Raw output from my self-trained LlamaLite (${st.params.toLocaleString()} params, ${st.steps_trained} steps, loss ${st.last_loss}):\n\n\`\`\`\n${gen.trim()}\n\`\`\`\n\n_A from-scratch neural net trained only on what I've learned — it sharpens every cycle._`;
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
