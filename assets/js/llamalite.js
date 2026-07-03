// llamalite.js — Llama-style micro neural LM in pure JS with manual backprop.
// RMSNorm + SiLU, char-level. No TF.js, no WASM — just math. Trains in the
// browser in small async chunks so the UI never freezes. Checkpoints to the store.

import { VOCAB, CHAR2ID, V } from "./core.js";

const CTX = 8;   // context window (chars)
const EMB = 16;  // embedding dim
const HID = 32;  // hidden dim

function randMatrix(rows, cols, scale) {
  const m = new Array(rows);
  for (let i = 0; i < rows; i++) {
    const row = new Float64Array(cols);
    for (let j = 0; j < cols; j++) row[j] = (Math.random() * 2 - 1) * scale;
    m[i] = row;
  }
  return m;
}

function silu(x) {
  if (x < -30) return 0;
  return x / (1 + Math.exp(-x));
}
function siluGrad(x) {
  if (x < -30) return 0;
  const s = 1 / (1 + Math.exp(-x));
  return s * (1 + x * (1 - s));
}

export class LlamaLite {
  constructor(store) {
    this.store = store;
    this.stepsTrained = 0;
    this.lastLoss = null;
    this.lossHistory = [];
    this.training = false;
    this._initWeights();
  }

  _initWeights() {
    this.emb = randMatrix(V, EMB, 0.08);
    this.w1 = randMatrix(HID, CTX * EMB, 0.06);
    this.b1 = new Float64Array(HID);
    this.w2 = randMatrix(V, HID, 0.06);
    this.b2 = new Float64Array(V);
  }

  encode(text) {
    const out = new Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = CHAR2ID[text[i]] ?? CHAR2ID[" "];
    return out;
  }

  _forward(ctxIds) {
    const n = CTX * EMB;
    const x = new Float64Array(n);
    for (let p = 0; p < ctxIds.length; p++) {
      const erow = this.emb[ctxIds[p]];
      for (let d = 0; d < EMB; d++) x[p * EMB + d] = erow[d];
    }
    // RMSNorm
    let ms = 0;
    for (let i = 0; i < n; i++) ms += x[i] * x[i];
    ms /= n;
    const rms = Math.sqrt(ms + 1e-6);
    const xn = new Float64Array(n);
    for (let i = 0; i < n; i++) xn[i] = x[i] / rms;
    // hidden + SiLU
    const pre = new Float64Array(HID);
    const hid = new Float64Array(HID);
    for (let j = 0; j < HID; j++) {
      const wj = this.w1[j];
      let s = this.b1[j];
      for (let k = 0; k < n; k++) s += wj[k] * xn[k];
      pre[j] = s;
      hid[j] = silu(s);
    }
    // logits
    const logits = new Float64Array(V);
    for (let o = 0; o < V; o++) {
      const wo = this.w2[o];
      let s = this.b2[o];
      for (let j = 0; j < HID; j++) s += wo[j] * hid[j];
      logits[o] = s;
    }
    // softmax
    let mx = -Infinity;
    for (let o = 0; o < V; o++) if (logits[o] > mx) mx = logits[o];
    let tot = 0;
    const probs = new Float64Array(V);
    for (let o = 0; o < V; o++) { probs[o] = Math.exp(logits[o] - mx); tot += probs[o]; }
    for (let o = 0; o < V; o++) probs[o] /= tot;
    return { rms, xn, pre, hid, probs };
  }

  _trainSample(ctxIds, target, lr) {
    const { rms, xn, pre, hid, probs } = this._forward(ctxIds);
    const loss = -Math.log(Math.max(probs[target], 1e-12));
    const n = CTX * EMB;

    const dlogits = probs; // reuse
    dlogits[target] -= 1;

    const dhid = new Float64Array(HID);
    for (let o = 0; o < V; o++) {
      const g = dlogits[o];
      if (g > -1e-9 && g < 1e-9) continue;
      const wo = this.w2[o];
      for (let j = 0; j < HID; j++) { dhid[j] += g * wo[j]; wo[j] -= lr * g * hid[j]; }
      this.b2[o] -= lr * g;
    }

    const dxn = new Float64Array(n);
    for (let j = 0; j < HID; j++) {
      const g = dhid[j] * siluGrad(pre[j]);
      if (g > -1e-9 && g < 1e-9) continue;
      const wj = this.w1[j];
      for (let k = 0; k < n; k++) { dxn[k] += g * wj[k]; wj[k] -= lr * g * xn[k]; }
      this.b1[j] -= lr * g;
    }

    for (let p = 0; p < ctxIds.length; p++) {
      const erow = this.emb[ctxIds[p]];
      const base = p * EMB;
      for (let d = 0; d < EMB; d++) erow[d] -= lr * (dxn[base + d] / rms);
    }
    return loss;
  }

  // Async chunked training so the browser stays responsive.
  async train(corpus, steps = 250, lr = 0.05, onProgress = null) {
    corpus = (corpus || "").trim();
    if (corpus.length < CTX + 2) return { trained: 0, loss: null, error: "corpus too small" };
    const ids = this.encode(corpus);
    const losses = [];
    this.training = true;
    const CHUNK = 40;
    try {
      for (let step = 0; step < steps; step++) {
        const i = Math.floor(Math.random() * (ids.length - CTX - 1));
        const ctx = ids.slice(i, i + CTX);
        const target = ids[i + CTX];
        const curLr = lr / (1 + 0.001 * this.stepsTrained);
        losses.push(this._trainSample(ctx, target, curLr));
        this.stepsTrained++;
        if (step % CHUNK === CHUNK - 1) {
          if (onProgress) onProgress(step + 1, losses[losses.length - 1]);
          await new Promise((r) => setTimeout(r, 0)); // yield to UI
        }
      }
    } finally {
      this.training = false;
    }
    const tail = losses.slice(-60);
    this.lastLoss = Math.round((tail.reduce((a, b) => a + b, 0) / tail.length) * 1e4) / 1e4;
    this.lossHistory.push(this.lastLoss);
    this.lossHistory = this.lossHistory.slice(-100);
    await this.saveCheckpoint();
    return { trained: losses.length, loss: this.lastLoss, total_steps: this.stepsTrained };
  }

  generate(prompt, length = 220, temperature = 0.85) {
    let seed = (prompt || "the").slice(-CTX);
    while (seed.length < CTX) seed = " " + seed;
    const ids = this.encode(seed);
    const out = [];
    for (let t = 0; t < length; t++) {
      const ctx = ids.slice(-CTX);
      let { probs } = this._forward(ctx);
      if (temperature !== 1) {
        let mx = -Infinity;
        const lp = new Float64Array(V);
        for (let i = 0; i < V; i++) { lp[i] = Math.log(Math.max(probs[i], 1e-12)) / temperature; if (lp[i] > mx) mx = lp[i]; }
        let tot = 0;
        for (let i = 0; i < V; i++) { lp[i] = Math.exp(lp[i] - mx); tot += lp[i]; }
        for (let i = 0; i < V; i++) lp[i] /= tot;
        probs = lp;
      }
      const r = Math.random();
      let acc = 0, nxt = V - 1;
      for (let i = 0; i < V; i++) { acc += probs[i]; if (r <= acc) { nxt = i; break; } }
      out.push(VOCAB[nxt]);
      ids.push(nxt);
    }
    return out.join("");
  }

  async saveCheckpoint() {
    if (!this.store) return;
    const ckpt = {
      steps: this.stepsTrained, last_loss: this.lastLoss, loss_history: this.lossHistory,
      emb: this.emb.map((r) => Array.from(r)),
      w1: this.w1.map((r) => Array.from(r)),
      b1: Array.from(this.b1),
      w2: this.w2.map((r) => Array.from(r)),
      b2: Array.from(this.b2),
    };
    await this.store.setJSON("llamalite_ckpt", ckpt);
  }

  async loadCheckpoint() {
    if (!this.store) return;
    const ckpt = await this.store.getJSON("llamalite_ckpt", null);
    if (!ckpt) return;
    try {
      if (ckpt.emb.length === V && ckpt.emb[0].length === EMB &&
          ckpt.w1.length === HID && ckpt.w2.length === V) {
        this.emb = ckpt.emb.map((r) => Float64Array.from(r));
        this.w1 = ckpt.w1.map((r) => Float64Array.from(r));
        this.b1 = Float64Array.from(ckpt.b1);
        this.w2 = ckpt.w2.map((r) => Float64Array.from(r));
        this.b2 = Float64Array.from(ckpt.b2);
        this.stepsTrained = ckpt.steps || 0;
        this.lastLoss = ckpt.last_loss ?? null;
        this.lossHistory = ckpt.loss_history || [];
      }
    } catch { /* ignore corrupt checkpoint */ }
  }

  stats() {
    const params = V * EMB + HID * CTX * EMB + HID + V * HID + V;
    return {
      architecture: "LlamaLite (RMSNorm + SiLU, char-level)",
      params, vocab: V, context: CTX,
      steps_trained: this.stepsTrained, last_loss: this.lastLoss,
      loss_history: this.lossHistory.slice(-30), training: this.training,
    };
  }
}
