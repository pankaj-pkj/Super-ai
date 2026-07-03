"""SQLite-backed persistent state for Super AI.

Everything the mind learns survives restarts: documents, sentences,
markov chains, neural checkpoints, token usage, evolution history.
"""

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional


class SuperState:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._lock = threading.Lock()
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    def _init_db(self):
        with self._conn() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS kv_store (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
                );

                CREATE TABLE IF NOT EXISTS docs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source TEXT NOT NULL,
                    title TEXT DEFAULT '',
                    kind TEXT DEFAULT 'text',      -- text | code | chat
                    body TEXT NOT NULL,
                    created_at INTEGER DEFAULT (strftime('%s', 'now'))
                );

                CREATE TABLE IF NOT EXISTS sentences (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    doc_id INTEGER NOT NULL,
                    kind TEXT DEFAULT 'text',
                    sent TEXT NOT NULL,
                    FOREIGN KEY (doc_id) REFERENCES docs(id)
                );

                CREATE TABLE IF NOT EXISTS usage (
                    user_id TEXT NOT NULL,
                    day TEXT NOT NULL,
                    used INTEGER DEFAULT 0,
                    requests INTEGER DEFAULT 0,
                    PRIMARY KEY (user_id, day)
                );

                CREATE TABLE IF NOT EXISTS chats (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT NOT NULL,
                    model TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    response TEXT NOT NULL,
                    tokens INTEGER DEFAULT 0,
                    feedback INTEGER DEFAULT 0,   -- 1 good, -1 bad, 0 none
                    created_at INTEGER DEFAULT (strftime('%s', 'now'))
                );

                CREATE TABLE IF NOT EXISTS evolution (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    cycle INTEGER NOT NULL,
                    event TEXT NOT NULL,
                    detail TEXT DEFAULT '',
                    created_at INTEGER DEFAULT (strftime('%s', 'now'))
                );

                CREATE INDEX IF NOT EXISTS idx_sent_doc ON sentences(doc_id);
                CREATE INDEX IF NOT EXISTS idx_chats_user ON chats(user_id);
                CREATE INDEX IF NOT EXISTS idx_docs_source ON docs(source);
                """
            )

    # ---------------- kv ----------------

    def put(self, key: str, value: str):
        with self._lock, self._conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO kv_store (key, value, updated_at) "
                "VALUES (?, ?, strftime('%s','now'))",
                (key, value),
            )

    def get(self, key: str, default: Optional[str] = None) -> Optional[str]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT value FROM kv_store WHERE key = ?", (key,)
            ).fetchone()
            return row[0] if row else default

    def put_json(self, key: str, value: Any):
        self.put(key, json.dumps(value))

    def get_json(self, key: str, default: Any = None) -> Any:
        raw = self.get(key)
        if raw is None:
            return default
        try:
            return json.loads(raw)
        except (ValueError, TypeError):
            return default

    # ---------------- docs / sentences ----------------

    def has_source(self, source: str) -> bool:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT 1 FROM docs WHERE source = ? LIMIT 1", (source,)
            ).fetchone()
            return row is not None

    def add_doc(self, source: str, title: str, kind: str, body: str,
                sentences: List[str]) -> int:
        with self._lock, self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO docs (source, title, kind, body) VALUES (?, ?, ?, ?)",
                (source, title, kind, body[:20000]),
            )
            doc_id = cur.lastrowid
            conn.executemany(
                "INSERT INTO sentences (doc_id, kind, sent) VALUES (?, ?, ?)",
                [(doc_id, kind, s[:1000]) for s in sentences],
            )
            return doc_id

    def all_sentences(self, limit: int = 20000) -> List[Dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT s.id, s.kind, s.sent, d.title, d.source "
                "FROM sentences s JOIN docs d ON d.id = s.doc_id "
                "ORDER BY s.id DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [
                {"id": r[0], "kind": r[1], "sent": r[2], "title": r[3], "source": r[4]}
                for r in rows
            ]

    def corpus_text(self, max_chars: int = 120000) -> str:
        """Recent learned text, used as neural training corpus."""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT body FROM docs ORDER BY id DESC LIMIT 60"
            ).fetchall()
        text = "\n".join(r[0] for r in rows)
        return text[:max_chars]

    def doc_count(self) -> int:
        with self._conn() as conn:
            return conn.execute("SELECT COUNT(*) FROM docs").fetchone()[0]

    def sentence_count(self) -> int:
        with self._conn() as conn:
            return conn.execute("SELECT COUNT(*) FROM sentences").fetchone()[0]

    # ---------------- token usage ----------------

    def add_usage(self, user_id: str, day: str, tokens: int):
        with self._lock, self._conn() as conn:
            conn.execute(
                "INSERT INTO usage (user_id, day, used, requests) VALUES (?, ?, ?, 1) "
                "ON CONFLICT(user_id, day) DO UPDATE SET "
                "used = used + excluded.used, requests = requests + 1",
                (user_id, day, tokens),
            )

    def get_usage(self, user_id: str, day: str) -> Dict:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT used, requests FROM usage WHERE user_id = ? AND day = ?",
                (user_id, day),
            ).fetchone()
            return {"used": row[0], "requests": row[1]} if row else {"used": 0, "requests": 0}

    # ---------------- chats ----------------

    def log_chat(self, user_id: str, model: str, prompt: str,
                 response: str, tokens: int) -> int:
        with self._lock, self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO chats (user_id, model, prompt, response, tokens) "
                "VALUES (?, ?, ?, ?, ?)",
                (user_id, model, prompt[:4000], response[:8000], tokens),
            )
            return cur.lastrowid

    def set_feedback(self, chat_id: int, feedback: int):
        with self._lock, self._conn() as conn:
            conn.execute(
                "UPDATE chats SET feedback = ? WHERE id = ?", (feedback, chat_id)
            )

    def chat_count(self) -> int:
        with self._conn() as conn:
            return conn.execute("SELECT COUNT(*) FROM chats").fetchone()[0]

    def feedback_stats(self) -> Dict:
        with self._conn() as conn:
            good = conn.execute("SELECT COUNT(*) FROM chats WHERE feedback = 1").fetchone()[0]
            bad = conn.execute("SELECT COUNT(*) FROM chats WHERE feedback = -1").fetchone()[0]
            return {"good": good, "bad": bad}

    # ---------------- evolution ----------------

    def log_evolution(self, cycle: int, event: str, detail: str = ""):
        with self._lock, self._conn() as conn:
            conn.execute(
                "INSERT INTO evolution (cycle, event, detail) VALUES (?, ?, ?)",
                (cycle, event, detail[:500]),
            )

    def evolution_feed(self, limit: int = 25) -> List[Dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT cycle, event, detail, created_at FROM evolution "
                "ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [
                {"cycle": r[0], "event": r[1], "detail": r[2], "at": r[3]}
                for r in rows
            ]


def default_db_path() -> str:
    return str(Path(__file__).resolve().parent.parent / "superai_state.db")
