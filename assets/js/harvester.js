// harvester.js — the 24×7 self-learning loop, running in the browser.
//
// GitHub Pages is static, so learning happens client-side via fetch() against
// CORS-friendly sources only:
//   * raw.githubusercontent.com  (READMEs / raw code — sends ACAO: *)
//   * en.wikipedia.org REST API  (article summaries — CORS enabled)
//   * api.github.com             (repo search — CORS enabled)
// Anything a user asked that the brain didn't know goes on a curiosity queue
// and gets researched automatically.

import { LANGUAGES } from "./knowledge.js";

// Seed docs across many languages (all CORS-friendly raw files).
const SEED = [
  ["https://raw.githubusercontent.com/python/cpython/main/README.rst", "code"],
  ["https://raw.githubusercontent.com/nodejs/node/main/README.md", "code"],
  ["https://raw.githubusercontent.com/microsoft/TypeScript/main/README.md", "code"],
  ["https://raw.githubusercontent.com/golang/go/master/README.md", "code"],
  ["https://raw.githubusercontent.com/rust-lang/rust/master/README.md", "code"],
  ["https://raw.githubusercontent.com/torvalds/linux/master/README", "text"],
];

const LANG_TOPICS = {
  Python: "Python (programming language)", JavaScript: "JavaScript", TypeScript: "TypeScript",
  Java: "Java (programming language)", "C++": "C++", Go: "Go (programming language)",
  Rust: "Rust (programming language)", Ruby: "Ruby (programming language)",
  Swift: "Swift (programming language)", Kotlin: "Kotlin (programming language)",
  SQL: "SQL", Haskell: "Haskell", Scala: "Scala (programming language)",
};

function stripHtml(html) {
  html = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ");
  return html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchText(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "text/plain,*/*" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

export class Harvester {
  constructor(brain, store, intervalSec = 300) {
    this.brain = brain;
    this.store = store;
    this.intervalSec = intervalSec;
    this.enabled = true;
    this.lastRun = null;
    this.lastReport = {};
    this._timer = null;
    this.onUpdate = null; // callback to refresh UI
  }

  // Learn one URL right now (also used by "Teach from URL").
  async learnUrl(url) {
    if (!/^https?:\/\//.test(url)) return { ok: false, error: "URL must start with http:// or https://" };
    if (await this.store.hasSource(url)) return { ok: true, learned: 0, note: "already learned this source" };
    let raw;
    try { raw = await fetchText(url); }
    catch (e) { return { ok: false, error: `fetch failed (${e.message}). Note: many sites block cross-origin requests; raw.githubusercontent.com and Wikipedia work.` }; }

    const isRawFile = url.includes("raw.githubusercontent.com") || !raw.trimStart().startsWith("<");
    let title, kind, text;
    if (isRawFile) {
      title = url.split("/").pop();
      kind = /\.(py|js|ts|go|rs|java|c|cpp|rb|sh|kt|swift|php|sql)$/.test(url) ? "code" : "text";
      text = raw.slice(0, 15000);
    } else {
      const m = raw.match(/<title>([\s\S]*?)<\/title>/i);
      title = m ? m[1].replace(/\s+/g, " ").trim().slice(0, 150) : url;
      kind = "text";
      text = stripHtml(raw).slice(0, 15000);
    }
    const n = await this.brain.learnText(url, title, text, kind);
    await this.brain.evolve("learned-url", `${url} -> ${n} sentences (${kind})`);
    return { ok: true, learned: n, title };
  }

  async harvestGitHub() {
    // search a random popular language, learn a top repo's README
    const lang = LANGUAGES[Math.floor(Math.random() * LANGUAGES.length)];
    let learned = 0;
    try {
      const api = `https://api.github.com/search/repositories?q=language:${encodeURIComponent(lang)}&sort=stars&order=desc&per_page=5`;
      const data = JSON.parse(await fetchText(api));
      for (const repo of (data.items || []).slice(0, 3)) {
        for (const branch of ["main", "master"]) {
          const url = `https://raw.githubusercontent.com/${repo.full_name}/${branch}/README.md`;
          if (await this.store.hasSource(url)) break;
          try {
            const body = await fetchText(url);
            const n = await this.brain.learnText(url, `GitHub: ${repo.full_name}`, body.slice(0, 12000), "code");
            if (n) { learned += n; await this.brain.evolve("github-harvest", `${lang}: learned ${repo.full_name} (${n} sentences)`); }
            break;
          } catch { /* try next branch */ }
        }
        if (learned) break;
      }
    } catch { /* GitHub API rate-limited or offline */ }
    return learned;
  }

  async resolveCuriosity() {
    const queue = await this.store.getJSON("curiosity_queue", []);
    if (!queue.length) return 0;
    const topic = queue.shift();
    await this.store.setJSON("curiosity_queue", queue);
    let learned = 0;
    const title = (LANG_TOPICS[topic] || topic).replace(/\b\w/g, (c) => c.toUpperCase());
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
    try {
      const data = JSON.parse(await fetchText(url));
      if (data.extract && data.extract.length > 120) {
        learned = await this.brain.learnText(
          data.content_urls?.desktop?.page || url, `Wikipedia: ${data.title}`, data.extract, "text");
        await this.brain.evolve("curiosity-resolved", `self-learned "${topic}" (${learned} sentences)`);
      }
    } catch { /* not found / offline */ }
    return learned;
  }

  async seedIfEmpty() {
    if ((await this.store.docCount()) > 40) return; // KB already seeded ~45
    for (const [url, kind] of SEED) {
      try {
        const body = await fetchText(url);
        const title = url.split("/").pop();
        await this.brain.learnText(url, title, body.slice(0, 12000), kind);
        await this.brain.evolve("seed-learn", `${title} -> learned`);
      } catch { /* offline is fine — KB still works */ }
    }
  }

  async cycle() {
    const report = { at: Date.now(), github: 0, curiosity: 0, neural: null };
    try { report.github = await this.harvestGitHub(); } catch {}
    try { report.curiosity = await this.resolveCuriosity(); } catch {}
    if (report.github || report.curiosity || Math.random() < 0.6) {
      try { report.neural = await this.brain.trainNeural(120); } catch {}
    }
    this.lastRun = Date.now();
    this.lastReport = report;
    if (this.onUpdate) this.onUpdate();
    return report;
  }

  start() {
    // background seed + first training, then loop forever while the tab is open
    (async () => {
      try { await this.seedIfEmpty(); } catch {}
      if (this.brain.llama.stepsTrained === 0) {
        try { await this.brain.trainNeural(150); if (this.onUpdate) this.onUpdate(); } catch {}
      }
    })();
    const tick = async () => {
      if (this.enabled) { try { await this.cycle(); } catch {} }
      this._timer = setTimeout(tick, this.intervalSec * 1000);
    };
    this._timer = setTimeout(tick, this.intervalSec * 1000);
  }

  status() {
    return { enabled: this.enabled, interval_sec: this.intervalSec, last_run: this.lastRun, last_report: this.lastReport };
  }
}
