#!/usr/bin/env python3
"""Super AI website server - pure Python stdlib, zero dependencies.

Run:  python3 server.py            (http://localhost:8000)
      python3 server.py --port 9000
      python3 server.py --limit 50000     (custom daily token limit)

Everything is self-contained: the AI trains itself, learns from GitHub
and the web in a background loop, learns from every chat, and enforces
per-user daily token limits across task-specific models.
"""

import argparse
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from superai.state import SuperState, default_db_path
from superai.brain import SuperBrain, MODELS
from superai.tokens import TokenBank
from superai.harvester import Harvester

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"

state = None
brain = None
bank = None
harvester = None

USER_RE = re.compile(r"^[A-Za-z0-9_-]{4,64}$")


def json_body(handler) -> dict:
    try:
        length = int(handler.headers.get("Content-Length", 0))
        if length <= 0 or length > 1_000_000:
            return {}
        return json.loads(handler.rfile.read(length).decode("utf-8"))
    except (ValueError, TypeError):
        return {}


class SuperAIHandler(BaseHTTPRequestHandler):
    server_version = "SuperAI/1.0"

    def log_message(self, fmt, *args):
        pass  # keep the console clean

    # ---------------- helpers ----------------

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path: Path, ctype: str):
        try:
            data = path.read_bytes()
        except OSError:
            self.send_json({"error": "not found"}, 404)
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def user_id(self, data=None, query=None) -> str:
        uid = ""
        if data:
            uid = data.get("user", "")
        if not uid and query:
            uid = (query.get("user") or [""])[0]
        if not uid:
            uid = self.headers.get("X-Super-User", "")
        return uid if USER_RE.match(uid or "") else "anonymous"

    # ---------------- routes ----------------

    def do_GET(self):
        parsed = urlparse(self.path)
        route = parsed.path
        query = parse_qs(parsed.query)

        if route in ("/", "/index.html"):
            return self.send_file(STATIC / "index.html", "text/html; charset=utf-8")

        if route == "/api/models":
            return self.send_json({"models": [
                {"id": mid, **info} for mid, info in MODELS.items()
            ]})

        if route == "/api/tokens":
            uid = self.user_id(query=query)
            return self.send_json(bank.balance(uid))

        if route == "/api/stats":
            return self.send_json({
                "brain": brain.stats(),
                "harvester": harvester.status(),
                "daily_limit": bank.daily_limit,
            })

        if route == "/api/evolution":
            return self.send_json({"feed": state.evolution_feed(30)})

        return self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        route = urlparse(self.path).path
        data = json_body(self)

        if route == "/api/chat":
            return self.handle_chat(data)

        if route == "/api/learn":
            url = (data.get("url") or "").strip()
            result = harvester.learn_url(url)
            status = 200 if result.get("ok") else 400
            return self.send_json(result, status)

        if route == "/api/train":
            steps = min(1000, max(20, int(data.get("steps", 200))))
            if brain.llama.training:
                return self.send_json({"ok": False, "error": "already training"}, 409)
            result = {}

            def run():
                result.update(brain.train_neural(steps=steps))

            t = threading.Thread(target=run)
            t.start()
            t.join(timeout=120)
            if t.is_alive():
                return self.send_json({"ok": True, "note": "training continues in background"})
            return self.send_json({"ok": True, **result})

        if route == "/api/feedback":
            chat_id = data.get("chat_id")
            good = bool(data.get("good"))
            if isinstance(chat_id, int):
                state.set_feedback(chat_id, 1 if good else -1)
                brain.apply_feedback(good, data.get("model", "super-chat"))
                return self.send_json({"ok": True})
            return self.send_json({"ok": False, "error": "chat_id required"}, 400)

        if route == "/api/harvest":
            # manual trigger of one self-improvement cycle
            def run():
                harvester.cycle()
            threading.Thread(target=run, daemon=True).start()
            return self.send_json({"ok": True, "note": "self-improvement cycle started"})

        return self.send_json({"error": "not found"}, 404)

    def handle_chat(self, data):
        prompt = (data.get("message") or "").strip()
        model = data.get("model") or "super-chat"
        uid = self.user_id(data=data)

        if not prompt:
            return self.send_json({"error": "empty message"}, 400)
        if len(prompt) > 4000:
            return self.send_json({"error": "message too long (max 4000 chars)"}, 400)
        if model not in MODELS:
            return self.send_json({"error": f"unknown model '{model}'"}, 400)

        estimate = bank.estimate_cost(prompt, model)
        if not bank.can_spend(uid, estimate):
            bal = bank.balance(uid)
            return self.send_json({
                "error": "daily token limit reached",
                "limit_hit": True,
                "balance": bal,
            }, 429)

        t0 = time.time()
        response = brain.respond(prompt, model)
        elapsed = round((time.time() - t0) * 1000)

        cost = bank.cost_of(prompt, response, model)
        bank.spend(uid, cost)
        chat_id = state.log_chat(uid, model, prompt, response, cost)

        # learn from the user in the background (usage-based self-improvement)
        threading.Thread(
            target=brain.learn_from_chat, args=(prompt, response), daemon=True
        ).start()

        return self.send_json({
            "chat_id": chat_id,
            "response": response,
            "model": model,
            "tokens_charged": cost,
            "latency_ms": elapsed,
            "balance": bank.balance(uid),
        })


def main():
    global state, brain, bank, harvester

    ap = argparse.ArgumentParser(description="Super AI website")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--limit", type=int, default=None,
                    help="daily token limit per user")
    ap.add_argument("--harvest-interval", type=int, default=600,
                    help="seconds between self-learning cycles")
    ap.add_argument("--no-harvest", action="store_true",
                    help="disable the autonomous learning loop")
    args = ap.parse_args()

    state = SuperState(default_db_path())
    brain = SuperBrain(state)
    bank = TokenBank(state, daily_limit=args.limit)
    harvester = Harvester(brain, state, interval=args.harvest_interval)
    if args.no_harvest:
        harvester.enabled = False
    harvester.start()

    print("=" * 60)
    print("  SUPER AI - self-training mind, zero external APIs")
    print(f"  URL          : http://localhost:{args.port}")
    print(f"  Daily limit  : {bank.daily_limit} tokens/user")
    print(f"  Models       : {', '.join(MODELS)}")
    print(f"  Knowledge    : {state.doc_count()} docs, "
          f"{state.sentence_count()} sentences")
    print(f"  Self-learning: every {args.harvest_interval}s"
          + (" (DISABLED)" if args.no_harvest else ""))
    print("=" * 60)

    server = ThreadingHTTPServer((args.host, args.port), SuperAIHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nSuper AI shutting down. Knowledge persisted.")
        server.shutdown()


if __name__ == "__main__":
    main()
