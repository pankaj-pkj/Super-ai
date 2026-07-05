// swarm.js — P2P Swarm Intelligence + Immutable Knowledge Portability.
//
// 1) Knowledge bundles: the whole trained mind exports to a standalone,
//    model-agnostic `knowledge_swarm_delta.json` — documents, embedding
//    vectors, strategy weights, and LoRA-style neural delta patches.
//    Inject the bundle into any future engine to inherit the intelligence.
// 2) P2P sync: two browsers pair over WebRTC data channels with NO server —
//    the signaling handshake travels as copy-paste codes (share via any
//    chat app). Once linked, minds sync both ways automatically.

import { embed, packVec } from "./vectors.js";

export const BUNDLE_VERSION = 3;

export async function exportBundle(brain, store) {
  const sentences = await store.allSentences(8000);
  const docsSeen = new Map();
  for (const s of sentences) {
    if (!docsSeen.has(s.source)) docsSeen.set(s.source, { source: s.source, title: s.title, kind: s.kind, sents: [] });
    docsSeen.get(s.source).sents.push(s.sent);
  }
  return {
    format: "superai-swarm-bundle",
    version: BUNDLE_VERSION,
    created: Date.now(),
    evolution_cycle: brain.evolutionCycle,
    strategy: brain.strategy,
    // knowledge as text + embedding vectors (model-agnostic)
    docs: [...docsSeen.values()].slice(0, 400).map((d) => ({
      ...d,
      vectors: d.sents.slice(0, 40).map((s) => packVec(embed(s))),
    })),
    // LoRA-style neural delta patch
    llama_delta: brain.llama.exportDelta(),
  };
}

export async function importBundle(brain, store, bundle) {
  if (!bundle || bundle.format !== "superai-swarm-bundle")
    return { ok: false, error: "not a Super AI swarm bundle" };
  let docs = 0, sents = 0;
  for (const d of bundle.docs || []) {
    if (await store.hasSource(d.source)) continue;
    const body = (d.sents || []).join(" ");
    const n = await brain.learnText(d.source, d.title || d.source, body, d.kind || "text");
    if (n) { docs++; sents += n; }
  }
  let neural = false;
  if (bundle.llama_delta) {
    neural = brain.llama.importDelta(bundle.llama_delta, 0.5);
    if (neural) await brain.llama.saveCheckpoint();
  }
  if (bundle.strategy) {
    for (const k of Object.keys(brain.strategy))
      if (typeof bundle.strategy[k] === "number")
        brain.strategy[k] = (brain.strategy[k] + bundle.strategy[k]) / 2;
    await store.setJSON("strategy", brain.strategy);
  }
  await brain.evolve("swarm-merge",
    `merged peer bundle: +${docs} docs, +${sents} sentences, neural delta ${neural ? "applied" : "skipped"}`);
  return { ok: true, docs, sents, neural };
}

// ---------------------------------------------------------------------
// WebRTC pairing with copy-paste signaling (works on a 100% static site)
// ---------------------------------------------------------------------

const RTC_CONFIG = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function waitIce(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const t = setTimeout(resolve, 4000); // don't hang forever
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") { clearTimeout(t); resolve(); }
    };
  });
}

export class SwarmLink {
  constructor(onBundle, onStatus) {
    this.pc = null;
    this.channel = null;
    this.onBundle = onBundle;   // (bundleObj) => void
    this.onStatus = onStatus;   // (text) => void
    this._rx = "";
  }

  _wireChannel(ch) {
    this.channel = ch;
    ch.onopen = () => this.onStatus("connected ✓ — syncing minds…");
    ch.onmessage = (e) => {
      if (e.data === "") { // EOT marker
        try { this.onBundle(JSON.parse(this._rx)); } catch { this.onStatus("bad bundle received"); }
        this._rx = "";
      } else {
        this._rx += e.data;
      }
    };
    ch.onclose = () => this.onStatus("peer disconnected");
  }

  // Host side: returns an offer code to share with the peer.
  async createOffer() {
    this.pc = new RTCPeerConnection(RTC_CONFIG);
    this._wireChannel(this.pc.createDataChannel("swarm"));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    await waitIce(this.pc);
    return btoa(JSON.stringify(this.pc.localDescription));
  }

  // Host side: paste the peer's answer code to finish.
  async acceptAnswer(code) {
    await this.pc.setRemoteDescription(JSON.parse(atob(code.trim())));
  }

  // Guest side: paste the host's offer code; returns an answer code.
  async acceptOffer(code) {
    this.pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc.ondatachannel = (e) => this._wireChannel(e.channel);
    await this.pc.setRemoteDescription(JSON.parse(atob(code.trim())));
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await waitIce(this.pc);
    return btoa(JSON.stringify(this.pc.localDescription));
  }

  // chunked send (data channels cap message size)
  sendBundle(bundle) {
    if (!this.channel || this.channel.readyState !== "open") return false;
    const json = JSON.stringify(bundle);
    for (let i = 0; i < json.length; i += 12000) this.channel.send(json.slice(i, i + 12000));
    this.channel.send("");
    return true;
  }

  close() {
    try { this.channel?.close(); this.pc?.close(); } catch { /* already closed */ }
  }
}
