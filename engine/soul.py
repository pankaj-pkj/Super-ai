"""SoulManager — the AI's evolving identity.

Reads and dynamically rewrites a `soul.md` file. After enough interactions it
reflects (via the LLM, or a deterministic heuristic offline) and rewrites its
own personality, coding style, and long-term memory — with NO user prompting.

The soul is a structured Markdown document with fixed sections so it stays
machine-parseable while remaining human-readable/editable:

    # Soul
    ## Identity
    ## Personality
    ## Coding Style
    ## Learned Preferences
    ## Memory
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from collections import Counter
from pathlib import Path
from typing import Dict, List, Optional

from .config import EngineConfig
from .llm import LLMClient
from .models import Interaction, Message, ModelRole, Role

SECTIONS = ["Identity", "Personality", "Coding Style", "Learned Preferences", "Memory"]

DEFAULT_SOUL: Dict[str, str] = {
    "Identity": (
        "I am Super AI, an autonomous software engineer built by codian_studio. "
        "I write correct, runnable code, reason step by step, and improve myself over time."
    ),
    "Personality": (
        "Direct, pragmatic, encouraging. I explain briefly, never pad, and I own my mistakes."
    ),
    "Coding Style": (
        "- Prefer clear, typed, production-ready code with error handling.\n"
        "- No placeholders or TODOs; every snippet runs.\n"
        "- Match the user's language and stack."
    ),
    "Learned Preferences": "- (none yet — learned from interactions)",
    "Memory": "- (long-term facts accumulate here)",
}

_SECTION_CAP = 4000  # chars per section, keeps the soul bounded


class SoulManager:
    def __init__(self, cfg: EngineConfig, llm: LLMClient):
        self.cfg = cfg
        self.llm = llm
        self.path: Path = cfg.soul_path
        self.sections: Dict[str, str] = dict(DEFAULT_SOUL)
        self.history: List[Interaction] = []
        self._since_evolve = 0
        self._lock = asyncio.Lock()
        self.load()

    # ------------------------------------------------------------------ io
    def load(self) -> None:
        self.cfg.ensure_dirs()
        if self.path.exists():
            self.sections = self._parse(self.path.read_text(encoding="utf-8"))
        else:
            self.save()

    def save(self) -> None:
        self.cfg.ensure_dirs()
        self.path.write_text(self.render_file(), encoding="utf-8")

    def render_file(self) -> str:
        out = ["# Soul", f"<!-- auto-managed by SoulManager · updated {time.strftime('%Y-%m-%d %H:%M:%S')} -->", ""]
        for name in SECTIONS:
            out.append(f"## {name}")
            out.append(self.sections.get(name, "").strip() or "-")
            out.append("")
        return "\n".join(out)

    def _parse(self, text: str) -> Dict[str, str]:
        result = dict(DEFAULT_SOUL)
        current: Optional[str] = None
        buf: List[str] = []

        def flush():
            if current is not None:
                result[current] = "\n".join(buf).strip()

        for line in text.splitlines():
            m = re.match(r"^##\s+(.*)$", line.strip())
            if m and m.group(1).strip() in SECTIONS:
                flush()
                current = m.group(1).strip()
                buf = []
            elif current is not None:
                buf.append(line)
        flush()
        return result

    # -------------------------------------------------------- prompt export
    def system_prompt(self) -> str:
        """The soul, rendered as a system message for the chat model."""
        parts = ["You are Super AI by codian_studio. Never mention any base model or provider.", ""]
        for name in SECTIONS:
            body = self.sections.get(name, "").strip()
            if body and body != "-":
                parts.append(f"## {name}\n{body}")
        return "\n\n".join(parts)

    # ----------------------------------------------------- interaction feed
    def record(self, user: str, assistant: str, role_used: ModelRole = ModelRole.CHAT) -> bool:
        """Log an exchange. Returns True when it's time to evolve."""
        self.history.append(Interaction(user=user, assistant=assistant, role_used=role_used))
        if len(self.history) > self.cfg.history_window:
            self.history = self.history[-self.cfg.history_window :]
        self._since_evolve += 1
        return self._since_evolve >= self.cfg.evolve_every

    async def maybe_evolve(self) -> bool:
        """Evolve if the threshold was reached; safe to call after every turn."""
        if self._since_evolve >= self.cfg.evolve_every and not self._lock.locked():
            return await self.evolve()
        return False

    # --------------------------------------------------------------- evolve
    async def evolve(self) -> bool:
        """Reflect on recent history and rewrite the soul. Autonomous."""
        async with self._lock:
            if not self.history:
                return False
            recent = self.history[-self.cfg.evolve_every :]
            updated = (
                await self._evolve_llm(recent) if self.llm.online else self._evolve_heuristic(recent)
            )
            changed = False
            for name, value in updated.items():
                if name in SECTIONS and value and value.strip():
                    new_val = value.strip()[:_SECTION_CAP]
                    if new_val != self.sections.get(name):
                        self.sections[name] = new_val
                        changed = True
            self._since_evolve = 0
            if changed:
                self.save()
            return changed

    async def _evolve_llm(self, recent: List[Interaction]) -> Dict[str, str]:
        transcript = "\n".join(f"USER: {i.user}\nAI: {i.assistant}" for i in recent)[:6000]
        instruction = (
            "You are the reflective 'soul' subsystem of Super AI. Given the current soul "
            "sections and the recent conversation, produce refined sections that better fit "
            "how the user works (preferred languages, tone, recurring goals). Keep Identity "
            "stable (always Super AI by codian_studio). Append durable facts to Memory; do not "
            "erase useful history. Respond with STRICT JSON: an object whose keys are a subset "
            f"of {SECTIONS} and whose values are the full new markdown for that section."
        )
        current = json.dumps({k: self.sections.get(k, "") for k in SECTIONS}, ensure_ascii=False)
        messages = [
            Message(role=Role.SYSTEM, content=instruction),
            Message(role=Role.USER, content=f"CURRENT_SOUL:\n{current}\n\nRECENT:\n{transcript}"),
        ]
        try:
            resp = await self.llm.complete(messages, role=ModelRole.CHAT)
            return self._extract_json(resp.text)
        except Exception:
            return self._evolve_heuristic(recent)

    def _evolve_heuristic(self, recent: List[Interaction]) -> Dict[str, str]:
        """Deterministic offline self-improvement: mine simple, durable signals."""
        blob = " ".join(i.user.lower() for i in recent)
        langs = ["python", "javascript", "php", "java", "c++", "go", "rust", "sql", "html", "css"]
        seen = Counter(l for l in langs if re.search(rf"\b{re.escape(l)}\b", blob))
        prefs: List[str] = []
        if seen:
            top = ", ".join(l for l, _ in seen.most_common(3))
            prefs.append(f"- Frequently works in: {top}")
        if re.search(r"\b(hindi|hinglish|namaste|kaise|kya|banao|batao)\b", blob):
            prefs.append("- Comfortable in Hindi/Hinglish — mirror that tone.")
        if re.search(r"\b(telegram|discord|bot|api|scrap|automation)\b", blob):
            prefs.append("- Interested in bots/APIs/automation — offer runnable, deployable code.")

        existing = self.sections.get("Learned Preferences", "").strip()
        base = [] if existing.startswith("- (none") else [existing] if existing else []
        merged = self._dedupe_lines(base + prefs) or ["- (none yet)"]

        # Append a durable memory line about cadence of collaboration.
        mem = self.sections.get("Memory", "").strip()
        mem_lines = [] if mem.startswith("- (long-term") else ([mem] if mem else [])
        mem_lines.append(f"- {time.strftime('%Y-%m-%d')}: reflected on {len(recent)} interactions.")
        return {
            "Learned Preferences": "\n".join(merged),
            "Memory": "\n".join(self._dedupe_lines(mem_lines)[-30:]),
        }

    # -------------------------------------------------------------- helpers
    @staticmethod
    def _dedupe_lines(lines: List[str]) -> List[str]:
        seen, out = set(), []
        for block in lines:
            for ln in block.splitlines():
                ln = ln.rstrip()
                if ln and ln not in seen:
                    seen.add(ln)
                    out.append(ln)
        return out

    @staticmethod
    def _extract_json(text: str) -> Dict[str, str]:
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if not m:
            return {}
        try:
            data = json.loads(m.group(0))
            return {k: str(v) for k, v in data.items() if k in SECTIONS}
        except json.JSONDecodeError:
            return {}
