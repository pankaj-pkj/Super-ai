// brain.js — the mind. TF-IDF retrieval + word Markov generation + LlamaLite
// neural model + feedback-adaptive strategy + curiosity queue. All in-browser.

import { tokenize, splitSentences, STOP, nowSec } from "./core.js";
import { LlamaLite } from "./llamalite.js";
import { KB } from "./knowledge.js";

export const MODELS = {
  "super-mini":  { name: "Super Mini",  task: "Fast replies, quick facts",                 cost: 1, icon: "⚡",  tier: "Fast" },
  "super-chat":  { name: "Super Chat",  task: "General conversation & everyday questions",  cost: 2, icon: "💬", tier: "Balanced" },
  "super-llama": { name: "Super Llama", task: "Raw neural generation (self-trained model)", cost: 3, icon: "🦙", tier: "Neural" },
  "super-coder": { name: "Super Coder", task: "Code help across many languages",           cost: 4, icon: "👨‍💻", tier: "Specialist" },
  "super-sage":  { name: "Super Sage",  task: "Deep research & multi-source synthesis",     cost: 6, icon: "🧠", tier: "Heavy" },
};

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
    // seed the built-in knowledge base once
    if (!(await this.store.getKV("kb_seeded"))) {
      for (const e of KB) {
        // answer stays clean; trigger keywords ride in the (indexed) title
        await this.learnText(`kb:${e.lang}:${e.title}`, `${e.title} · ${e.q}`,
          e.a, e.lang === "CS" ? "text" : "code", true);
      }
      await this.store.setKV("kb_seeded", "1");
      await this.evolve("boot", `seeded ${KB.length} built-in knowledge entries`);
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
  _scoreSentences(query, kind = null, top = 6) {
    let qWords = tokenize(query).filter((w) => !STOP.has(w));
    if (!qWords.length) qWords = tokenize(query);
    if (!qWords.length) return [];
    const nSents = Math.max(1, this.sentById.size);
    const scores = new Map();
    for (const w of qWords) {
      const ids = this.index.get(w);
      if (!ids) continue;
      const idf = Math.log(1 + nSents / (1 + (this.docFreq.get(w) || 0)));
      for (const sid of ids) scores.set(sid, (scores.get(sid) || 0) + idf);
    }
    const ranked = [];
    for (const [sid, sc0] of scores) {
      const row = this.sentById.get(sid);
      if (!row) continue;
      let sc = sc0;
      if (kind && row.kind !== kind) sc *= 0.5;
      if (kind && row.kind === kind) sc *= 1.4;
      sc /= Math.sqrt(1 + row.sent.length / 200);
      ranked.push([sc, row]);
    }
    ranked.sort((a, b) => b[0] - a[0]);
    return ranked.slice(0, top);
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

    if (GREETING_RE.test(prompt)) {
      const docs = await this.store.docCount();
      return pick([
        `Hello! I am Super AI — a self-training mind running entirely in your browser. I've learned from ${docs} sources so far. Ask me anything or teach me something new.`,
        `Namaste! Super AI here. I know many programming languages out of the box and I keep learning 24×7. What shall we build?`,
        `Hey! Switch models in the sidebar for coding, research, or raw neural generation. Each has its own token cost.`,
      ]);
    }

    if (IDENTITY_RE.test(prompt)) {
      const st = this.llama.stats();
      const docs = await this.store.docCount();
      const sents = await this.store.sentenceCount();
      return `I am Super AI — a fully self-contained mind with no external API. I run 100% in your browser, persist my knowledge in IndexedDB, and keep learning 24×7. So far I've read ${docs} documents (${sents} sentences), trained my own Llama-style neural model for ${st.steps_trained} steps, and evolved ${this.evolutionCycle} times. I harvest knowledge from GitHub and the web on my own, and I learn from every chat — including this one.`;
    }

    // auto-route obvious code questions to the coder path even on chat model
    const codey = CODE_HINT_RE.test(prompt);

    if (model === "super-mini") return this._respMini(prompt);
    if (model === "super-coder" || (model === "super-chat" && codey)) return this._respCoder(prompt);
    if (model === "super-sage") return this._respSage(prompt);
    if (model === "super-llama") return this._respLlama(prompt);
    return this._respChat(prompt);
  }

  async _unknown(prompt) {
    const topic = await this._queueCuriosity(prompt);
    return `I don't know enough about that yet — but I just added it to my curiosity queue ("${topic}") so my 24×7 self-learning loop will research it from Wikipedia and GitHub. You can also teach me instantly with the "Teach from URL" button.`;
  }

  async _respMini(prompt) {
    const hits = this._scoreSentences(prompt, null, 1);
    return hits.length ? hits[0][1].sent : this._unknown(prompt);
  }

  async _respChat(prompt) {
    const hits = this._scoreSentences(prompt, null, 3);
    if (!hits.length) return this._unknown(prompt);
    const parts = [hits[0][1].sent];
    if (hits.length > 1 && Math.random() < this.strategy.retrieval / 2) parts.push(hits[1][1].sent);
    if (Math.random() < this.strategy.markov / 2) {
      const ride = this._markovRide(tokenize(prompt));
      if (ride && ride.length > 30) parts.push(ride);
    }
    const src = hits[0][1].title || hits[0][1].source;
    return `${parts.join(" ")}\n\n_learned from: ${src}_`;
  }

  async _respCoder(prompt) {
    const hits = this._scoreSentences(prompt, "code", 5);
    const codeHits = hits.filter((h) => h[1].kind === "code");
    if (codeHits.length) {
      const best = codeHits[0][1];
      const related = codeHits.slice(1, 3).map((h) => `- ${h[1].sent.slice(0, 150)}`).join("\n");
      let out = `${best.sent}\n\n_source: ${best.title || best.source}_`;
      if (related) out += `\n\nRelated patterns I know:\n${related}`;
      return out;
    }
    if (hits.length) return `${hits[0][1].sent}\n\n_I haven't harvested exact code for this yet — my GitHub learner is on it. Ask again after the next learning cycle._`;
    return this._unknown(prompt);
  }

  async _respSage(prompt) {
    const hits = this._scoreSentences(prompt, null, 6);
    if (!hits.length) return this._unknown(prompt);
    const sources = [];
    const lines = hits.slice(0, 5).map(([, row]) => {
      const src = row.title || row.source;
      if (!sources.includes(src)) sources.push(src);
      return `• ${row.sent}`;
    });
    let out = "Deep synthesis from my knowledge base:\n\n" + lines.join("\n");
    const synth = this._markovRide(tokenize(prompt), 28);
    if (synth && synth.length > 30) out += `\n\nMy own synthesis: ${synth}`;
    out += `\n\n_sources: ${sources.slice(0, 4).join(", ")}_`;
    return out;
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
