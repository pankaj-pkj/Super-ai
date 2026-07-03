"""LlamaLite - a Llama-style micro language model, pure Python, trained from scratch.

No numpy, no torch, no API. This is a character-level neural LM using the
same building blocks as Llama (RMSNorm + SiLU activation), scaled down so
it can train inside any Python process. Manual forward + backprop + SGD.

Architecture:
    context chars -> embeddings -> RMSNorm -> Linear -> SiLU -> Linear -> softmax
"""

import json
import math
import random
import threading
import time
from typing import Dict, List, Optional

VOCAB = list(
    "\n abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "0123456789.,;:!?'\"()[]{}<>=+-*/_#@%&|\\^~`$"
)
CHAR2ID = {c: i for i, c in enumerate(VOCAB)}
V = len(VOCAB)

CTX = 8       # context window (chars)
EMB = 20      # embedding dim
HID = 48      # hidden dim


def _rand_matrix(rows: int, cols: int, scale: float) -> List[List[float]]:
    return [[random.uniform(-scale, scale) for _ in range(cols)] for _ in range(rows)]


def _silu(x: float) -> float:
    # SiLU / swish, the Llama activation
    if x < -30:
        return 0.0
    return x / (1.0 + math.exp(-x))


def _silu_grad(x: float) -> float:
    if x < -30:
        return 0.0
    s = 1.0 / (1.0 + math.exp(-x))
    return s * (1.0 + x * (1.0 - s))


class LlamaLite:
    """Tiny Llama-flavored neural language model with manual backprop."""

    def __init__(self, state=None):
        self.state = state
        self.lock = threading.Lock()
        self.steps_trained = 0
        self.last_loss: Optional[float] = None
        self.loss_history: List[float] = []
        self.training = False
        self._init_weights()
        if state is not None:
            self._load_checkpoint()

    def _init_weights(self):
        random.seed(1337)
        self.emb = _rand_matrix(V, EMB, 0.08)              # V x EMB
        self.w1 = _rand_matrix(HID, CTX * EMB, 0.06)       # HID x (CTX*EMB)
        self.b1 = [0.0] * HID
        self.w2 = _rand_matrix(V, HID, 0.06)               # V x HID
        self.b2 = [0.0] * V

    # ---------------- forward / backward ----------------

    def _encode(self, text: str) -> List[int]:
        return [CHAR2ID.get(c, CHAR2ID[" "]) for c in text]

    def _forward(self, ctx_ids: List[int]):
        # gather + flatten embeddings
        x = []
        for cid in ctx_ids:
            x.extend(self.emb[cid])
        # RMSNorm (Llama-style, no mean-centering)
        ms = sum(v * v for v in x) / len(x)
        rms = math.sqrt(ms + 1e-6)
        xn = [v / rms for v in x]
        # hidden layer with SiLU
        pre = []
        hid = []
        for j in range(HID):
            wj = self.w1[j]
            s = self.b1[j]
            for k in range(len(xn)):
                s += wj[k] * xn[k]
            pre.append(s)
            hid.append(_silu(s))
        # output logits
        logits = []
        for o in range(V):
            wo = self.w2[o]
            s = self.b2[o]
            for j in range(HID):
                s += wo[j] * hid[j]
            logits.append(s)
        # softmax
        mx = max(logits)
        exps = [math.exp(l - mx) for l in logits]
        tot = sum(exps)
        probs = [e / tot for e in exps]
        return x, rms, xn, pre, hid, probs

    def _train_sample(self, ctx_ids: List[int], target: int, lr: float) -> float:
        x, rms, xn, pre, hid, probs = self._forward(ctx_ids)
        loss = -math.log(max(probs[target], 1e-12))

        # dL/dlogits = probs - onehot
        dlogits = list(probs)
        dlogits[target] -= 1.0

        # w2 / b2 grads + dL/dhid
        dhid = [0.0] * HID
        for o in range(V):
            g = dlogits[o]
            if abs(g) < 1e-9:
                continue
            wo = self.w2[o]
            for j in range(HID):
                dhid[j] += g * wo[j]
                wo[j] -= lr * g * hid[j]
            self.b2[o] -= lr * g

        # through SiLU -> w1 / b1 grads + dL/dxn
        n = len(xn)
        dxn = [0.0] * n
        for j in range(HID):
            g = dhid[j] * _silu_grad(pre[j])
            if abs(g) < 1e-9:
                continue
            wj = self.w1[j]
            for k in range(n):
                dxn[k] += g * wj[k]
                wj[k] -= lr * g * xn[k]
            self.b1[j] -= lr * g

        # through RMSNorm (approximate: treat rms as constant - stable & fast)
        # then into embeddings
        for pos, cid in enumerate(ctx_ids):
            erow = self.emb[cid]
            base = pos * EMB
            for d in range(EMB):
                erow[d] -= lr * (dxn[base + d] / rms)

        return loss

    # ---------------- public API ----------------

    def train(self, corpus: str, steps: int = 200, lr: float = 0.05,
              progress=None) -> Dict:
        """Train on corpus text. Returns summary dict."""
        corpus = corpus.strip()
        if len(corpus) < CTX + 2:
            return {"trained": 0, "loss": None, "error": "corpus too small"}
        ids = self._encode(corpus)
        losses = []
        with self.lock:
            self.training = True
            try:
                for step in range(steps):
                    i = random.randint(0, len(ids) - CTX - 1)
                    ctx = ids[i:i + CTX]
                    target = ids[i + CTX]
                    cur_lr = lr * (1.0 / (1.0 + 0.001 * self.steps_trained))
                    loss = self._train_sample(ctx, target, cur_lr)
                    losses.append(loss)
                    self.steps_trained += 1
                    if progress and step % 50 == 0:
                        progress(step, loss)
            finally:
                self.training = False
        avg = sum(losses[-50:]) / max(1, len(losses[-50:]))
        self.last_loss = round(avg, 4)
        self.loss_history.append(self.last_loss)
        self.loss_history = self.loss_history[-100:]
        self._save_checkpoint()
        return {"trained": len(losses), "loss": self.last_loss,
                "total_steps": self.steps_trained}

    def generate(self, prompt: str, length: int = 240,
                 temperature: float = 0.8) -> str:
        seed = (prompt or "the")[-CTX:]
        seed = seed.rjust(CTX)
        ids = self._encode(seed)
        out = []
        with self.lock:
            for _ in range(length):
                _, _, _, _, _, probs = self._forward(ids[-CTX:])
                if temperature != 1.0:
                    logp = [math.log(max(p, 1e-12)) / temperature for p in probs]
                    mx = max(logp)
                    exps = [math.exp(l - mx) for l in logp]
                    tot = sum(exps)
                    probs = [e / tot for e in exps]
                r = random.random()
                acc = 0.0
                nxt = V - 1
                for i, p in enumerate(probs):
                    acc += p
                    if r <= acc:
                        nxt = i
                        break
                out.append(VOCAB[nxt])
                ids.append(nxt)
        return "".join(out)

    # ---------------- persistence ----------------

    def _save_checkpoint(self):
        if self.state is None:
            return
        ckpt = {
            "steps": self.steps_trained,
            "last_loss": self.last_loss,
            "loss_history": self.loss_history,
            "emb": self.emb,
            "w1": self.w1,
            "b1": self.b1,
            "w2": self.w2,
            "b2": self.b2,
        }
        self.state.put("llamalite_ckpt", json.dumps(ckpt))

    def _load_checkpoint(self):
        raw = self.state.get("llamalite_ckpt")
        if not raw:
            return
        try:
            ckpt = json.loads(raw)
            if (len(ckpt["emb"]) == V and len(ckpt["emb"][0]) == EMB
                    and len(ckpt["w1"]) == HID and len(ckpt["w2"]) == V):
                self.emb = ckpt["emb"]
                self.w1 = ckpt["w1"]
                self.b1 = ckpt["b1"]
                self.w2 = ckpt["w2"]
                self.b2 = ckpt["b2"]
                self.steps_trained = ckpt.get("steps", 0)
                self.last_loss = ckpt.get("last_loss")
                self.loss_history = ckpt.get("loss_history", [])
        except (ValueError, KeyError, IndexError, TypeError):
            pass

    def stats(self) -> Dict:
        params = V * EMB + HID * CTX * EMB + HID + V * HID + V
        return {
            "architecture": "LlamaLite (RMSNorm + SiLU, char-level)",
            "params": params,
            "vocab": V,
            "context": CTX,
            "steps_trained": self.steps_trained,
            "last_loss": self.last_loss,
            "loss_history": self.loss_history[-30:],
            "training": self.training,
        }
