// vectors.js — local embeddings. Every sentence the mind learns is converted
// into a mathematical vector (feature-hashed bag of words+bigrams, L2 norm).
// Model-agnostic: any future engine can consume these vectors directly.

import { tokenize } from "./core.js";

export const DIM = 192;

function fnv(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function embed(text) {
  const v = new Float32Array(DIM);
  const words = tokenize(text);
  for (let i = 0; i < words.length; i++) {
    const h = fnv(words[i]);
    v[h % DIM] += (h & 1) ? 1 : -1;
    if (i > 0) { // bigrams capture word order
      const h2 = fnv(words[i - 1] + "_" + words[i]);
      v[h2 % DIM] += ((h2 & 1) ? 1 : -1) * 0.6;
    }
  }
  let norm = 0;
  for (let i = 0; i < DIM; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < DIM; i++) s += a[i] * b[i];
  return s;
}

// compact serialization for swarm bundles (3 decimals is plenty)
export function packVec(v) {
  return Array.from(v, (x) => Math.round(x * 1000) / 1000);
}
