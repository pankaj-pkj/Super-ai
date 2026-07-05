// core.js — shared vocab, tokenizer, helpers (browser + Node)

export const VOCAB = (
  "\n abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ" +
  "0123456789.,;:!?'\"()[]{}<>=+-*/_#@%&|\\^~`$"
).split("");
export const CHAR2ID = Object.fromEntries(VOCAB.map((c, i) => [c, i]));
export const V = VOCAB.length;

export const WORD_RE = /[A-Za-z_][A-Za-z0-9_']*/g;

export const STOP = new Set(
  ("the a an and or but if then else for while of to in on at by with from is are was " +
   "were be been being do does did have has had i you he she it we they me my your this " +
   "that these those as not no so what who whom which when where why how can could will " +
   "would should may might must am s t d ll re ve").split(" ")
);

export function tokenize(text) {
  const out = [];
  let m;
  WORD_RE.lastIndex = 0;
  while ((m = WORD_RE.exec(text)) !== null) out.push(m[0].toLowerCase());
  return out;
}

export function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 22);
}

// ~4 chars per token, like real LLM tokenizers
export function approxTokens(text) {
  return Math.max(1, Math.floor((text || "").length / 4));
}

export function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

export function secondsToResetUTC() {
  const now = new Date();
  const end = new Date(now);
  end.setUTCHours(23, 59, 59, 999);
  return Math.floor((end - now) / 1000);
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// Is this a phone / low-power device? Used to throttle heavy background work
// so we never freeze a mobile browser.
export function isMobileDevice() {
  if (typeof navigator === "undefined") return false;
  if (navigator.userAgentData?.mobile === true) return true; // only trust a positive
  const ua = navigator.userAgent || "";
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile|Opera Mini|IEMobile|Silk/i.test(ua);
  const touchFewCores = (navigator.maxTouchPoints || 0) > 0 && (navigator.hardwareConcurrency || 8) <= 4;
  return mobileUA || touchFewCores;
}
