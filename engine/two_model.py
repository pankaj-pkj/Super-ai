"""MODULE 1 — The Two-Model System & 'Soul' Engine.

Two brains behind one facade:
  • Chat Model      — converses with the user, grounded in the evolving soul.
  • Tool-Maker Model — synthesises new, runnable Python tools on demand.

A lightweight router decides which brain a request needs. Every chat turn feeds
the SoulManager, which autonomously reflects and rewrites `soul.md` in the
background. Generated tools are persisted to disk via a ToolRegistry so the
agent's capabilities grow across restarts.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from pathlib import Path
from typing import AsyncIterator, Dict, List, Optional

from .config import EngineConfig
from .llm import LLMClient
from .models import (
    GeneratedTool,
    LLMResponse,
    Message,
    ModelRole,
    Role,
    RouteDecision,
)
from .soul import SoulManager

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------
_TOOL_INTENT = re.compile(
    r"\b(make|build|create|generate|write|banao|bana\s?do|likho)\b.{0,40}"
    r"\b(tool|script|function|utility|automation|command|helper|parser|scraper|bot)\b",
    re.IGNORECASE,
)
_TOOL_EXPLICIT = re.compile(r"^\s*/(tool|make|build)\b", re.IGNORECASE)


class ModelRouter:
    """Decide whether a prompt needs the Chat or the Tool-Maker brain."""

    def decide(self, prompt: str) -> RouteDecision:
        if _TOOL_EXPLICIT.search(prompt):
            return RouteDecision(role=ModelRole.TOOL_MAKER, confidence=1.0, reason="explicit /tool command")
        if _TOOL_INTENT.search(prompt):
            return RouteDecision(role=ModelRole.TOOL_MAKER, confidence=0.8,
                                 reason="reusable-tool intent detected")
        return RouteDecision(role=ModelRole.CHAT, confidence=0.7, reason="conversational")


# ---------------------------------------------------------------------------
# Tool registry
# ---------------------------------------------------------------------------
_IDENT = re.compile(r"[^a-zA-Z0-9_]")
_CODE_BLOCK = re.compile(r"```(?:python)?\s*(.*?)```", re.DOTALL)
_DEF = re.compile(r"^def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", re.MULTILINE)


class ToolRegistry:
    """Persists Tool-Maker output to disk and tracks it in memory."""

    def __init__(self, cfg: EngineConfig):
        self.cfg = cfg
        self.dir: Path = cfg.tools_dir
        self.tools: Dict[str, GeneratedTool] = {}
        cfg.ensure_dirs()
        self._load_index()

    def _index_path(self) -> Path:
        return self.dir / "_index.json"

    def _load_index(self) -> None:
        p = self._index_path()
        if p.exists():
            try:
                for raw in json.loads(p.read_text(encoding="utf-8")):
                    t = GeneratedTool(**raw)
                    self.tools[t.name] = t
            except (json.JSONDecodeError, TypeError, ValueError):
                pass

    def _save_index(self) -> None:
        self._index_path().write_text(
            json.dumps([t.model_dump() for t in self.tools.values()], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def add(self, tool: GeneratedTool) -> GeneratedTool:
        tool.filename = f"{tool.name}.py"
        (self.dir / tool.filename).write_text(tool.code, encoding="utf-8")
        self.tools[tool.name] = tool
        self._save_index()
        return tool

    def get(self, name: str) -> Optional[GeneratedTool]:
        return self.tools.get(name)

    def list(self) -> List[GeneratedTool]:
        return sorted(self.tools.values(), key=lambda t: t.created_at, reverse=True)


# ---------------------------------------------------------------------------
# The two-model system
# ---------------------------------------------------------------------------
_TOOL_MAKER_SYSTEM = (
    "You are the Tool-Maker subsystem of Super AI (by codian_studio). "
    "Given a task, output ONE complete, self-contained, runnable Python module. "
    "Rules: define a top-level `def run(**kwargs)` entrypoint that performs the task and "
    "returns a JSON-serialisable result; use only the standard library unless the task "
    "clearly needs more; include a short module docstring; NO placeholders, NO TODOs, "
    "NO explanations outside code. Return ONLY a single ```python code block."
)


class TwoModelSystem:
    """Public facade for Module 1."""

    def __init__(self, cfg: Optional[EngineConfig] = None, llm: Optional[LLMClient] = None):
        self.cfg = cfg or EngineConfig.from_env()
        self.cfg.ensure_dirs()
        self.llm = llm or LLMClient(self.cfg)
        self.router = ModelRouter()
        self.soul = SoulManager(self.cfg, self.llm)
        self.tools = ToolRegistry(self.cfg)
        self._bg: set[asyncio.Task] = set()

    # ------------------------------------------------------------ chat brain
    async def chat(self, prompt: str, extra: Optional[List[Message]] = None) -> LLMResponse:
        messages = [Message(role=Role.SYSTEM, content=self.soul.system_prompt())]
        messages.extend(extra or [])
        messages.append(Message(role=Role.USER, content=prompt))
        resp = await self.llm.complete(messages, role=ModelRole.CHAT)
        self._after_turn(prompt, resp.text, ModelRole.CHAT)
        return resp

    async def chat_stream(self, prompt: str, extra: Optional[List[Message]] = None) -> AsyncIterator[str]:
        messages = [Message(role=Role.SYSTEM, content=self.soul.system_prompt())]
        messages.extend(extra or [])
        messages.append(Message(role=Role.USER, content=prompt))
        collected: List[str] = []
        async for tok in self.llm.stream(messages, role=ModelRole.CHAT):
            collected.append(tok)
            yield tok
        self._after_turn(prompt, "".join(collected), ModelRole.CHAT)

    # ------------------------------------------------------- tool-maker brain
    async def make_tool(self, task: str) -> GeneratedTool:
        messages = [
            Message(role=Role.SYSTEM, content=_TOOL_MAKER_SYSTEM),
            Message(role=Role.USER, content=task),
        ]
        resp = await self.llm.complete(messages, role=ModelRole.TOOL_MAKER)
        code = self._extract_code(resp.text)
        name = self._infer_name(task, code)
        entry = self._infer_entrypoint(code)
        tool = GeneratedTool(
            name=name,
            description=task.strip()[:200],
            code=code,
            entrypoint=entry,
            source_task=task.strip(),
        )
        self.tools.add(tool)
        # record as an interaction so the soul learns the user's tooling patterns
        self._after_turn(task, f"[generated tool `{name}`]", ModelRole.TOOL_MAKER)
        return tool

    async def draft_tool_code(self, task: str, feedback: Optional[List[str]] = None) -> str:
        """Generate tool code WITHOUT persisting — used by the self-correction
        loop, which feeds prior tracebacks back in via `feedback`."""
        messages = [Message(role=Role.SYSTEM, content=_TOOL_MAKER_SYSTEM)]
        if feedback:
            messages.append(Message(
                role=Role.SYSTEM,
                content="Your previous attempts FAILED when executed:\n"
                        + "\n".join(f"- {f}" for f in feedback)
                        + "\nReturn a corrected version that runs with no error.",
            ))
        messages.append(Message(role=Role.USER, content=task))
        resp = await self.llm.complete(messages, role=ModelRole.TOOL_MAKER)
        return self._extract_code(resp.text)

    # ------------------------------------------------------------- unified io
    async def handle(self, prompt: str) -> Dict[str, object]:
        """Route automatically and return a normalized envelope."""
        decision = self.router.decide(prompt)
        if decision.role == ModelRole.TOOL_MAKER:
            tool = await self.make_tool(prompt)
            return {"kind": "tool", "route": decision.model_dump(), "tool": tool.model_dump()}
        resp = await self.chat(prompt)
        return {"kind": "chat", "route": decision.model_dump(), "response": resp.model_dump()}

    # -------------------------------------------------------------- internals
    def _after_turn(self, user: str, assistant: str, role: ModelRole) -> None:
        due = self.soul.record(user, assistant, role)
        if due:
            self._spawn(self.soul.maybe_evolve())

    def _spawn(self, coro) -> None:
        """Fire-and-forget background task with hard reference retention."""
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            asyncio.run(coro)  # no loop (sync context) — run inline
            return
        task = loop.create_task(coro)
        self._bg.add(task)
        task.add_done_callback(self._bg.discard)

    @staticmethod
    def _extract_code(text: str) -> str:
        m = _CODE_BLOCK.search(text)
        code = (m.group(1) if m else text).strip()
        if "def " not in code:
            # guarantee a runnable entrypoint even from a terse model
            code = (
                '"""Auto-wrapped tool."""\n\n'
                "def run(**kwargs):\n"
                f"    return {json.dumps({'note': 'model returned no function', 'raw': code[:400]})}\n"
            )
        return code

    def _infer_name(self, task: str, code: str) -> str:
        m = _DEF.search(code)
        if m and m.group(1) != "run":
            base = m.group(1)
        else:
            base = _IDENT.sub("_", task.lower()).strip("_")[:32] or "tool"
        name = f"{base}"
        # avoid clobbering an existing different tool
        if name in self.tools.tools:
            name = f"{base}_{int(time.time())}"
        return name

    @staticmethod
    def _infer_entrypoint(code: str) -> str:
        names = _DEF.findall(code)
        return "run" if "run" in names else (names[0] if names else "run")

    async def aclose(self) -> None:
        for t in list(self._bg):
            t.cancel()
        await self.llm.aclose()
