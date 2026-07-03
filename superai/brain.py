"""SuperBrain - the mind of Super AI.

No external AI API. Everything is learned locally:
  * TF-IDF inverted index over every sentence it has ever read
  * word-level Markov chain for fluent generation
  * LlamaLite neural model trained on the learned corpus
  * feedback-weighted strategy that adapts to what users like

Task-specific models route the same mind different ways with different
token costs (see MODELS).
"""

import math
import random
import re
import threading
import time
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

from .trainer import LlamaLite

# ---------------------------------------------------------------------
# Model registry: task-specific models with their own token pricing
# ---------------------------------------------------------------------

MODELS = {
    "super-mini": {
        "name": "Super Mini",
        "task": "Fast replies, greetings, quick facts",
        "cost": 1,          # token multiplier
        "icon": "⚡",
        "tier": "Fast",
    },
    "super-chat": {
        "name": "Super Chat",
        "task": "General conversation & everyday questions",
        "cost": 2,
        "icon": "💬",
        "tier": "Balanced",
    },
    "super-coder": {
        "name": "Super Coder",
        "task": "Code help - learns from GitHub repositories",
        "cost": 4,
        "icon": "👨‍💻",
        "tier": "Specialist",
    },
    "super-sage": {
        "name": "Super Sage",
        "task": "Deep research & multi-source knowledge synthesis",
        "cost": 6,
        "icon": "🧠",
        "tier": "Heavy",
    },
    "super-llama": {
        "name": "Super Llama",
        "task": "Raw neural generation from the self-trained LlamaLite model",
        "cost": 3,
        "icon": "🦙",
        "tier": "Neural",
    },
}

WORD_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_']*")
STOP = set(
    "the a an and or but if then else for while of to in on at by with from is are was "
    "were be been being do does did have has had i you he she it we they me my your this "
    "that these those as not no so what who whom which when where why how can could will "
    "would should may might must am s t d ll re ve".split()
)


def tokenize(text: str) -> List[str]:
    return [w.lower() for w in WORD_RE.findall(text)]


def split_sentences(text: str) -> List[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n+", text)
    return [p.strip() for p in parts if len(p.strip()) > 25]


def approx_tokens(text: str) -> int:
    """~4 chars per token, like real LLM tokenizers."""
    return max(1, len(text) // 4)


class SuperBrain:
    def __init__(self, state):
        self.state = state
        self.lock = threading.Lock()
        self.llama = LlamaLite(state)

        # in-memory indexes, rebuilt from DB on boot
        self.index: Dict[str, set] = defaultdict(set)     # word -> sentence ids
        self.sent_by_id: Dict[int, Dict] = {}
        self.doc_freq: Dict[str, int] = defaultdict(int)
        self.markov: Dict[Tuple[str, str], Dict[str, int]] = defaultdict(dict)
        self.markov_starts: List[Tuple[str, str]] = []

        # strategy weights adapt with user feedback
        self.strategy = self.state.get_json(
            "strategy", {"retrieval": 1.0, "markov": 0.6, "neural": 0.4}
        )
        self.evolution_cycle = int(self.state.get("evolution_cycle", "0") or 0)
        self._rebuild_indexes()

    # ------------------------------------------------------------------
    # learning
    # ------------------------------------------------------------------

    def _rebuild_indexes(self):
        for row in self.state.all_sentences():
            self._index_sentence(row["id"], row)

    def _index_sentence(self, sid: int, row: Dict):
        self.sent_by_id[sid] = row
        words = set(tokenize(row["sent"]))
        for w in words:
            self.index[w].add(sid)
            self.doc_freq[w] += 1
        toks = tokenize(row["sent"])
        if len(toks) >= 3:
            self.markov_starts.append((toks[0], toks[1]))
            for i in range(len(toks) - 2):
                key = (toks[i], toks[i + 1])
                nxt = toks[i + 2]
                self.markov[key][nxt] = self.markov[key].get(nxt, 0) + 1

    def learn_text(self, source: str, title: str, body: str,
                   kind: str = "text") -> int:
        """Ingest text into permanent knowledge. Returns sentences learned."""
        body = re.sub(r"\s+", " ", body).strip()
        if len(body) < 30:
            return 0
        sentences = split_sentences(body)
        if not sentences:
            sentences = [body[:500]]
        with self.lock:
            doc_id = self.state.add_doc(source, title, kind, body, sentences)
            # re-read the freshly inserted sentences to get their real ids
            fresh = self.state.all_sentences(limit=len(sentences))
            for row in fresh:
                if row["id"] not in self.sent_by_id:
                    self._index_sentence(row["id"], row)
        return len(sentences)

    def learn_from_chat(self, prompt: str, response: str):
        """Every conversation makes the mind smarter (user use se sikhna)."""
        if len(prompt) > 40:
            self.learn_text(
                f"chat:{int(time.time())}", "User conversation", prompt, kind="chat"
            )

    def apply_feedback(self, good: bool, model: str):
        """Thumbs up/down retunes the generation strategy."""
        delta = 0.05 if good else -0.05
        key = "neural" if model == "super-llama" else "retrieval"
        self.strategy[key] = min(2.0, max(0.1, self.strategy[key] + delta))
        if not good:
            self.strategy["markov"] = min(2.0, self.strategy["markov"] + 0.03)
        self.state.put_json("strategy", self.strategy)
        self.evolve("feedback", f"{'👍' if good else '👎'} on {model}; strategy retuned")

    def evolve(self, event: str, detail: str = ""):
        self.evolution_cycle += 1
        self.state.put("evolution_cycle", str(self.evolution_cycle))
        self.state.log_evolution(self.evolution_cycle, event, detail)

    def train_neural(self, steps: int = 200) -> Dict:
        corpus = self.state.corpus_text()
        result = self.llama.train(corpus, steps=steps)
        if result.get("trained"):
            self.evolve(
                "neural-training",
                f"LlamaLite trained {result['trained']} steps, loss={result['loss']}",
            )
        return result

    # ------------------------------------------------------------------
    # retrieval
    # ------------------------------------------------------------------

    def _score_sentences(self, query: str, kind: Optional[str] = None,
                         top: int = 6) -> List[Tuple[float, Dict]]:
        q_words = [w for w in tokenize(query) if w not in STOP] or tokenize(query)
        if not q_words:
            return []
        n_sents = max(1, len(self.sent_by_id))
        scores: Dict[int, float] = defaultdict(float)
        for w in q_words:
            ids = self.index.get(w)
            if not ids:
                continue
            idf = math.log(1 + n_sents / (1 + self.doc_freq[w]))
            for sid in ids:
                scores[sid] += idf
        ranked = []
        for sid, sc in scores.items():
            row = self.sent_by_id.get(sid)
            if not row:
                continue
            if kind and row["kind"] != kind:
                sc *= 0.4
            # prefer denser matches over long rambly sentences
            sc /= math.sqrt(1 + len(row["sent"]) / 200.0)
            ranked.append((sc, row))
        ranked.sort(key=lambda x: -x[0])
        return ranked[:top]

    def _markov_ride(self, seed_words: List[str], max_words: int = 40) -> str:
        key = None
        for i in range(len(seed_words) - 1):
            cand = (seed_words[i].lower(), seed_words[i + 1].lower())
            if cand in self.markov:
                key = cand
                break
        if key is None:
            if not self.markov_starts:
                return ""
            key = random.choice(self.markov_starts)
        out = [key[0], key[1]]
        for _ in range(max_words):
            nxts = self.markov.get(key)
            if not nxts:
                break
            words, weights = zip(*nxts.items())
            nxt = random.choices(words, weights=weights, k=1)[0]
            out.append(nxt)
            key = (key[1], nxt)
        text = " ".join(out)
        return text[0].upper() + text[1:] + "." if text else ""

    # ------------------------------------------------------------------
    # response generation per model
    # ------------------------------------------------------------------

    GREETING_RE = re.compile(
        r"^\s*(hi|hii+|hello|hey|namaste|namaskar|yo|hola|salaam)\b", re.I
    )
    IDENTITY_RE = re.compile(r"\b(who are you|tum kaun|kaun ho|what are you|about you)\b", re.I)

    def respond(self, prompt: str, model: str) -> str:
        model = model if model in MODELS else "super-chat"
        prompt = prompt.strip()

        if self.GREETING_RE.match(prompt):
            return random.choice([
                "Hello! I am Super AI - a self-training mind. I learn from GitHub, "
                "the web, and every conversation. Ask me anything or teach me something.",
                "Namaste! Super AI here. I have learned from "
                f"{self.state.doc_count()} sources so far and I keep improving myself. "
                "What shall we explore?",
                "Hey! Ready when you are. Tip: switch models in the sidebar for "
                "coding, research, or raw neural generation.",
            ])

        if self.IDENTITY_RE.search(prompt):
            st = self.llama.stats()
            return (
                "I am Super AI - a fully self-contained mind. No external API powers me: "
                f"I have read {self.state.doc_count()} documents "
                f"({self.state.sentence_count()} sentences), trained my own "
                f"Llama-style neural model for {st['steps_trained']} steps, and evolved "
                f"{self.evolution_cycle} times. I harvest knowledge from GitHub and the "
                "web on my own, and I learn from every chat, including this one."
            )

        if model == "super-mini":
            return self._respond_mini(prompt)
        if model == "super-coder":
            return self._respond_coder(prompt)
        if model == "super-sage":
            return self._respond_sage(prompt)
        if model == "super-llama":
            return self._respond_llama(prompt)
        return self._respond_chat(prompt)

    def _unknown(self, prompt: str) -> str:
        # curiosity: queue the topic so the harvester self-learns it
        queue = self.state.get_json("curiosity_queue", [])
        topic = " ".join([w for w in tokenize(prompt) if w not in STOP][:4])
        if topic and topic not in queue:
            queue.append(topic)
            self.state.put_json("curiosity_queue", queue[-25:])
        return (
            "I don't know enough about that yet - but I just added it to my "
            f"curiosity queue ('{topic}') so my self-learning loop will hunt for it "
            "on the web and GitHub. You can also teach me instantly with the "
            "'Teach from URL' button."
        )

    def _respond_mini(self, prompt: str) -> str:
        hits = self._score_sentences(prompt, top=1)
        if hits:
            return hits[0][1]["sent"]
        return self._unknown(prompt)

    def _respond_chat(self, prompt: str) -> str:
        hits = self._score_sentences(prompt, top=3)
        if not hits:
            return self._unknown(prompt)
        parts = [hits[0][1]["sent"]]
        if len(hits) > 1 and random.random() < self.strategy["retrieval"] / 2:
            parts.append(hits[1][1]["sent"])
        if random.random() < self.strategy["markov"] / 2:
            ride = self._markov_ride(tokenize(prompt))
            if ride and len(ride) > 30:
                parts.append(ride)
        src = hits[0][1]["title"] or hits[0][1]["source"]
        answer = " ".join(parts)
        return f"{answer}\n\n_learned from: {src}_"

    def _respond_coder(self, prompt: str) -> str:
        hits = self._score_sentences(prompt, kind="code", top=4)
        code_hits = [h for h in hits if h[1]["kind"] == "code"]
        if code_hits:
            best = code_hits[0][1]
            related = "\n".join(f"- {h[1]['sent'][:160]}" for h in code_hits[1:3])
            out = (
                f"From my GitHub-learned knowledge:\n\n```\n{best['sent']}\n```\n"
                f"_source: {best['source']}_"
            )
            if related:
                out += f"\n\nRelated patterns I know:\n{related}"
            return out
        if hits:
            return (
                f"{hits[0][1]['sent']}\n\n_I haven't harvested code for this exact "
                "topic yet - my GitHub learner is on it. Ask again after my next "
                "learning cycle._"
            )
        return self._unknown(prompt)

    def _respond_sage(self, prompt: str) -> str:
        hits = self._score_sentences(prompt, top=6)
        if not hits:
            return self._unknown(prompt)
        seen_sources = []
        lines = []
        for sc, row in hits[:5]:
            lines.append(f"• {row['sent']}")
            src = row["title"] or row["source"]
            if src not in seen_sources:
                seen_sources.append(src)
        synthesis = self._markov_ride(tokenize(prompt), max_words=30)
        out = "Deep synthesis from my knowledge base:\n\n" + "\n".join(lines)
        if synthesis and len(synthesis) > 30:
            out += f"\n\nMy own synthesis: {synthesis}"
        out += "\n\n_sources: " + ", ".join(seen_sources[:4]) + "_"
        return out

    def _respond_llama(self, prompt: str) -> str:
        st = self.llama.stats()
        if st["steps_trained"] == 0:
            return (
                "My LlamaLite neural model hasn't been trained yet. Hit the "
                "'Train Neural Model' button (or wait for my auto-training cycle) "
                "and then ask again."
            )
        gen = self.llama.generate(prompt, length=200, temperature=0.85)
        return (
            f"Raw output from my self-trained LlamaLite "
            f"({st['params']:,} params, {st['steps_trained']} steps, "
            f"loss {st['last_loss']}):\n\n```\n{gen.strip()}\n```\n\n"
            "_This is a from-scratch neural net trained only on what I've learned - "
            "it gets sharper every training cycle._"
        )

    # ------------------------------------------------------------------

    def stats(self) -> Dict:
        fb = self.state.feedback_stats()
        return {
            "docs": self.state.doc_count(),
            "sentences": self.state.sentence_count(),
            "vocab_indexed": len(self.index),
            "markov_states": len(self.markov),
            "chats": self.state.chat_count(),
            "evolution_cycle": self.evolution_cycle,
            "feedback": fb,
            "strategy": self.strategy,
            "neural": self.llama.stats(),
            "curiosity_queue": self.state.get_json("curiosity_queue", []),
        }
