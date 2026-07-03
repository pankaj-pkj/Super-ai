"""Self-learning harvester - the loop that makes Super AI improve itself.

A background thread that, forever:
  1. scrapes GitHub trending + raw README/code files and learns them
  2. resolves the "curiosity queue" (topics users asked about that the
     brain didn't know) via Wikipedia + GitHub search scraping
  3. retrains the LlamaLite neural model on the grown corpus
  4. logs every step to the evolution feed

Pure stdlib scraping (urllib + regex). No AI API anywhere.
"""

import json
import random
import re
import threading
import time
import urllib.parse
import urllib.request
from typing import Dict, List, Optional

UA = {"User-Agent": "SuperAI-SelfLearner/1.0 (+self-training research bot)"}

SEED_SOURCES = [
    ("https://en.wikipedia.org/wiki/Artificial_intelligence", "text"),
    ("https://en.wikipedia.org/wiki/Machine_learning", "text"),
    ("https://en.wikipedia.org/wiki/Large_language_model", "text"),
    ("https://raw.githubusercontent.com/torvalds/linux/master/README", "text"),
    ("https://raw.githubusercontent.com/python/cpython/main/README.rst", "text"),
]

GITHUB_TRENDING = "https://github.com/trending"


def fetch(url: str, timeout: int = 15) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")


def strip_html(html: str) -> str:
    html = re.sub(r"<script[^>]*>.*?</script>", " ", html, flags=re.S | re.I)
    html = re.sub(r"<style[^>]*>.*?</style>", " ", html, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", html)
    text = re.sub(r"&[a-z]+;", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def extract_title(html: str) -> str:
    m = re.search(r"<title>(.*?)</title>", html, re.I | re.S)
    return re.sub(r"\s+", " ", m.group(1)).strip()[:150] if m else ""


def extract_code_blocks(html: str) -> List[str]:
    blocks = re.findall(r"<(?:code|pre)[^>]*>(.*?)</(?:code|pre)>", html, re.S | re.I)
    out = []
    for b in blocks:
        b = strip_html(b)
        if 30 < len(b) < 800:
            out.append(b)
    return out[:10]


class Harvester:
    """Autonomous learning loop. Runs as a daemon thread."""

    def __init__(self, brain, state, interval: int = 600):
        self.brain = brain
        self.state = state
        self.interval = interval
        self.enabled = True
        self.last_run: Optional[float] = None
        self.last_report: Dict = {}
        self._thread: Optional[threading.Thread] = None

    # ------------------------------------------------------------------

    def learn_url(self, url: str) -> Dict:
        """Learn from one URL right now (also used by the /api/learn route)."""
        if not url.startswith(("http://", "https://")):
            return {"ok": False, "error": "URL must start with http:// or https://"}
        if self.state.has_source(url):
            return {"ok": True, "learned": 0, "note": "already learned this source"}
        try:
            raw = fetch(url)
        except Exception as e:
            return {"ok": False, "error": f"fetch failed: {e}"}

        is_raw_file = "raw.githubusercontent.com" in url or not raw.lstrip().startswith("<")
        if is_raw_file:
            title = url.rsplit("/", 1)[-1]
            kind = "code" if re.search(r"\.(py|js|ts|go|rs|java|c|cpp|rb|sh)$", url) else "text"
            n = self.brain.learn_text(url, title, raw[:15000], kind=kind)
            self.brain.evolve("learned-url", f"{url} -> {n} sentences ({kind})")
            return {"ok": True, "learned": n, "title": title}

        title = extract_title(raw)
        text = strip_html(raw)[:15000]
        n = self.brain.learn_text(url, title, text, kind="text")
        for i, code in enumerate(extract_code_blocks(raw)):
            n += self.brain.learn_text(f"{url}#code{i}", title, code, kind="code")
        self.brain.evolve("learned-url", f"{url} -> {n} sentences")
        return {"ok": True, "learned": n, "title": title}

    def harvest_github_trending(self) -> int:
        """Scrape GitHub trending, then learn READMEs of top repos."""
        learned = 0
        try:
            html = fetch(GITHUB_TRENDING)
        except Exception:
            return 0
        repos = re.findall(r'href="/([\w.-]+/[\w.-]+)"\s', html)
        seen = []
        for r in repos:
            if r.count("/") == 1 and r not in seen and not r.startswith(("login", "features", "trending", "topics", "sponsors", "site", "about", "contact", "pricing")):
                seen.append(r)
        for repo in seen[:3]:
            for branch in ("main", "master"):
                url = f"https://raw.githubusercontent.com/{repo}/{branch}/README.md"
                if self.state.has_source(url):
                    break
                try:
                    body = fetch(url)
                except Exception:
                    continue
                n = self.brain.learn_text(url, f"GitHub: {repo}", body[:12000], kind="code")
                if n:
                    learned += n
                    self.brain.evolve("github-harvest", f"learned {repo} README ({n} sentences)")
                break
        return learned

    def resolve_curiosity(self) -> int:
        """Self-learn topics users asked about but the brain didn't know."""
        queue = self.state.get_json("curiosity_queue", [])
        if not queue:
            return 0
        topic = queue.pop(0)
        self.state.put_json("curiosity_queue", queue)
        learned = 0
        # Wikipedia article scrape
        slug = urllib.parse.quote(topic.replace(" ", "_").title())
        url = f"https://en.wikipedia.org/wiki/{slug}"
        try:
            raw = fetch(url)
            text = strip_html(raw)[:12000]
            if len(text) > 500:
                learned += self.brain.learn_text(url, f"Wikipedia: {topic}", text)
        except Exception:
            pass
        if learned:
            self.brain.evolve("curiosity-resolved",
                              f"self-learned '{topic}' ({learned} sentences)")
        return learned

    # ------------------------------------------------------------------

    def seed_if_empty(self):
        if self.state.doc_count() > 0:
            return
        self.brain.evolve("boot", "first boot - seeding initial knowledge")
        for url, kind in SEED_SOURCES:
            try:
                raw = fetch(url)
                title = extract_title(raw) or url.rsplit("/", 1)[-1]
                text = strip_html(raw)[:12000] if raw.lstrip().startswith("<") else raw[:12000]
                n = self.brain.learn_text(url, title, text, kind=kind)
                self.brain.evolve("seed-learn", f"{url} -> {n} sentences")
            except Exception:
                continue
        # first neural training on the seed corpus
        self.brain.train_neural(steps=150)

    def cycle(self) -> Dict:
        """One full self-improvement cycle."""
        report = {"at": time.time(), "github": 0, "curiosity": 0, "neural": None}
        report["github"] = self.harvest_github_trending()
        report["curiosity"] = self.resolve_curiosity()
        if report["github"] or report["curiosity"] or random.random() < 0.5:
            report["neural"] = self.brain.train_neural(steps=120)
        self.last_run = time.time()
        self.last_report = report
        return report

    def _loop(self):
        # seed on boot (in background so the server starts instantly)
        try:
            self.seed_if_empty()
        except Exception:
            pass
        while True:
            time.sleep(self.interval)
            if not self.enabled:
                continue
            try:
                self.cycle()
            except Exception:
                pass

    def start(self):
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def status(self) -> Dict:
        return {
            "enabled": self.enabled,
            "interval_sec": self.interval,
            "last_run": self.last_run,
            "last_report": self.last_report,
        }
