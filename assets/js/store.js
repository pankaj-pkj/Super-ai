// store.js — persistence layer.
//   IDBStore  : IndexedDB, used in the browser (survives across sessions)
//   MemStore  : in-memory, used for Node tests
// Both expose the same async API so brain/harvester don't care which runs.

import { nowSec } from "./core.js";

class BaseStore {
  // ---- to be provided by subclasses ----
  async _getRaw(store, key) { throw new Error("nyi"); }
  async _put(store, obj) { throw new Error("nyi"); }
  async _all(store) { throw new Error("nyi"); }
  async _count(store) { throw new Error("nyi"); }

  // ---------------- kv ----------------
  async getKV(key, dflt = null) {
    const row = await this._getRaw("kv", key);
    return row ? row.value : dflt;
  }
  async setKV(key, value) {
    await this._put("kv", { key, value });
  }
  async getJSON(key, dflt = null) {
    const raw = await this.getKV(key, null);
    if (raw == null) return dflt;
    try { return JSON.parse(raw); } catch { return dflt; }
  }
  async setJSON(key, value) {
    await this.setKV(key, JSON.stringify(value));
  }

  // ---------------- docs / sentences ----------------
  async hasSource(source) {
    const docs = await this._all("docs");
    return docs.some((d) => d.source === source);
  }

  async addDoc(source, title, kind, body, sentences) {
    const docId = await this._put("docs", {
      source, title, kind, body: body.slice(0, 20000), created_at: nowSec(),
    });
    const rows = [];
    for (const s of sentences) {
      const id = await this._put("sentences", {
        doc_id: docId, kind, sent: s.slice(0, 1000),
      });
      rows.push({ id, kind, sent: s.slice(0, 1000), title, source });
    }
    return { docId, rows };
  }

  async allSentences(limit = 40000) {
    const sents = await this._all("sentences");
    const docs = await this._all("docs");
    const docMap = new Map(docs.map((d) => [d.id, d]));
    sents.sort((a, b) => b.id - a.id);
    return sents.slice(0, limit).map((s) => {
      const d = docMap.get(s.doc_id) || {};
      return { id: s.id, kind: s.kind, sent: s.sent, title: d.title || "", source: d.source || "" };
    });
  }

  async corpusText(maxChars = 120000) {
    const docs = await this._all("docs");
    docs.sort((a, b) => b.id - a.id);
    const text = docs.slice(0, 80).map((d) => d.body).join("\n");
    return text.slice(0, maxChars);
  }

  async docCount() { return this._count("docs"); }
  async sentenceCount() { return this._count("sentences"); }

  // ---------------- usage ----------------
  async addUsage(userId, day, tokens) {
    const key = userId + "|" + day;
    const cur = (await this._getRaw("usage", key)) || { key, used: 0, requests: 0 };
    cur.used += tokens;
    cur.requests += 1;
    await this._put("usage", cur);
  }
  async getUsage(userId, day) {
    const cur = await this._getRaw("usage", userId + "|" + day);
    return cur ? { used: cur.used, requests: cur.requests } : { used: 0, requests: 0 };
  }

  // ---------------- chats ----------------
  async logChat(userId, model, prompt, response, tokens) {
    return this._put("chats", {
      user_id: userId, model, prompt: prompt.slice(0, 4000),
      response: response.slice(0, 8000), tokens, feedback: 0, created_at: nowSec(),
    });
  }
  async setFeedback(chatId, feedback) {
    const row = await this._getRaw("chats", chatId);
    if (row) { row.feedback = feedback; await this._put("chats", row); }
  }
  async chatCount() { return this._count("chats"); }
  async recentChats(limit = 20) {
    const rows = await this._all("chats");
    rows.sort((a, b) => a.id - b.id);
    return rows.slice(-limit);
  }
  async feedbackStats() {
    const chats = await this._all("chats");
    return {
      good: chats.filter((c) => c.feedback === 1).length,
      bad: chats.filter((c) => c.feedback === -1).length,
    };
  }

  // ---------------- evolution ----------------
  async logEvolution(cycle, event, detail = "") {
    await this._put("evolution", { cycle, event, detail: detail.slice(0, 500), created_at: nowSec() });
  }
  async evolutionFeed(limit = 30) {
    const rows = await this._all("evolution");
    rows.sort((a, b) => b.id - a.id);
    return rows.slice(0, limit).map((r) => ({ cycle: r.cycle, event: r.event, detail: r.detail, at: r.created_at }));
  }
}

// ======================================================================
// MemStore (Node / tests)
// ======================================================================
export class MemStore extends BaseStore {
  constructor() {
    super();
    this.data = { kv: new Map(), docs: new Map(), sentences: new Map(),
      usage: new Map(), chats: new Map(), evolution: new Map() };
    this.seq = { docs: 0, sentences: 0, chats: 0, evolution: 0 };
  }
  async _getRaw(store, key) { return this.data[store].get(key) || null; }
  async _put(store, obj) {
    if (store === "kv") { this.data.kv.set(obj.key, obj); return obj.key; }
    if (store === "usage") { this.data.usage.set(obj.key, obj); return obj.key; }
    if (obj.id == null) obj.id = ++this.seq[store];
    this.data[store].set(obj.id, obj);
    return obj.id;
  }
  async _all(store) { return Array.from(this.data[store].values()); }
  async _count(store) { return this.data[store].size; }
}

// ======================================================================
// IDBStore (browser)
// ======================================================================
const STORES = {
  kv: { keyPath: "key" },
  docs: { keyPath: "id", autoIncrement: true },
  sentences: { keyPath: "id", autoIncrement: true },
  usage: { keyPath: "key" },
  chats: { keyPath: "id", autoIncrement: true },
  evolution: { keyPath: "id", autoIncrement: true },
};

export class IDBStore extends BaseStore {
  constructor(dbName = "superai") { super(); this.dbName = dbName; this.db = null; }

  async open() {
    this.db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [name, opts] of Object.entries(STORES)) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, opts);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this;
  }

  _tx(store, mode) { return this.db.transaction(store, mode).objectStore(store); }
  _wrap(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async _getRaw(store, key) { return (await this._wrap(this._tx(store, "readonly").get(key))) || null; }
  async _put(store, obj) { return this._wrap(this._tx(store, "readwrite").put(obj)); }
  async _all(store) { return this._wrap(this._tx(store, "readonly").getAll()); }
  async _count(store) { return this._wrap(this._tx(store, "readonly").count()); }
}

export async function createStore() {
  if (typeof indexedDB !== "undefined") {
    return new IDBStore().open();
  }
  return new MemStore();
}
