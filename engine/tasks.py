"""MODULE 2 — The Task & Agent State Machine (the core loop).

A strict, async task lifecycle:  pending → running → completed | failed | cancelled.
Illegal transitions raise. Tasks are dispatched by TaskType to registered
handlers, executed by a pool of async workers with retries, timeouts and full
log capture.

TaskTypes
---------
LOCAL_BASH   safe shell execution (timeout, output caps, denylist, confined cwd;
             real jailing arrives in Module 6's sandbox).
LOCAL_AGENT  runs the Module-1 TwoModelSystem (chat or tool synthesis).
DREAM        autonomous idle mode — the AI reviews its own generated code and
             writes improvement notes back into its soul.
"""

from __future__ import annotations

import asyncio
import os
import shlex
import signal
import time
import uuid
from enum import Enum
from typing import Any, Awaitable, Callable, Dict, List, Optional, Protocol

from pydantic import BaseModel, Field

from .config import EngineConfig


# ---------------------------------------------------------------------------
# State machine
# ---------------------------------------------------------------------------
class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskType(str, Enum):
    LOCAL_BASH = "local_bash"
    LOCAL_AGENT = "local_agent"
    DREAM = "dream"


_ALLOWED: Dict[TaskStatus, set] = {
    TaskStatus.PENDING: {TaskStatus.RUNNING, TaskStatus.CANCELLED},
    TaskStatus.RUNNING: {TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED},
    TaskStatus.COMPLETED: set(),
    TaskStatus.FAILED: set(),
    TaskStatus.CANCELLED: set(),
}


class InvalidTransition(RuntimeError):
    pass


class Task(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    type: TaskType
    payload: Dict[str, Any] = Field(default_factory=dict)
    status: TaskStatus = TaskStatus.PENDING
    result: Any = None
    error: str = ""
    logs: List[str] = Field(default_factory=list)
    attempts: int = 0
    max_retries: int = 0
    created_at: float = Field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None

    def transition(self, new: TaskStatus) -> None:
        if new not in _ALLOWED[self.status]:
            raise InvalidTransition(f"{self.id}: {self.status.value} → {new.value} not allowed")
        self.status = new
        if new == TaskStatus.RUNNING:
            self.started_at = time.time()
        elif new in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED):
            self.finished_at = time.time()

    def log(self, msg: str) -> None:
        self.logs.append(f"[{time.strftime('%H:%M:%S')}] {msg}")
        if len(self.logs) > 500:
            self.logs = self.logs[-500:]

    @property
    def duration_ms(self) -> Optional[int]:
        if self.started_at and self.finished_at:
            return int((self.finished_at - self.started_at) * 1000)
        return None


class TaskHandler(Protocol):
    async def __call__(self, task: Task, mgr: "TaskManager") -> Any: ...


# ---------------------------------------------------------------------------
# Safe bash executor (first-line safety; full jail = Module 6)
# ---------------------------------------------------------------------------
_DENYLIST = [
    r"rm\s+-rf\s+/", r":\(\)\s*\{", r"\bmkfs\b", r"\bdd\s+if=", r"\bshutdown\b",
    r"\breboot\b", r"\b/dev/sd[a-z]\b", r">\s*/dev/sd", r"\bchmod\s+-R\s+777\s+/",
    r"\bcurl\b.+\|\s*(sh|bash)", r"\bwget\b.+\|\s*(sh|bash)", r"\bforkbomb\b",
]
import re as _re
_DENY_RE = [_re.compile(p, _re.IGNORECASE) for p in _DENYLIST]


class SafeBashExecutor:
    """Run a shell command with a timeout, output caps and a destructive-pattern
    denylist, confined to a working directory. Not a security boundary on its
    own — Module 6's TermuxSandbox/DockerSandbox replaces this executor."""

    def __init__(self, cfg: EngineConfig, timeout: float = 30.0, max_output: int = 20000):
        self.cfg = cfg
        self.timeout = timeout
        self.max_output = max_output
        self.workdir = cfg.data_dir / "bash_workdir"
        self.workdir.mkdir(parents=True, exist_ok=True)

    def _blocked(self, command: str) -> Optional[str]:
        for rx in _DENY_RE:
            if rx.search(command):
                return f"blocked by safety denylist: /{rx.pattern}/"
        return None

    async def run(self, command: str, timeout: Optional[float] = None) -> Dict[str, Any]:
        blocked = self._blocked(command)
        if blocked:
            return {"ok": False, "returncode": -1, "stdout": "", "stderr": blocked, "blocked": True}

        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(self.workdir),
               "LANG": "C.UTF-8"}
        proc = await asyncio.create_subprocess_exec(
            "/bin/bash", "-c", command,
            cwd=str(self.workdir), env=env,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            start_new_session=True,  # own process group so we can kill children
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout or self.timeout)
            rc = proc.returncode
            timed_out = False
        except asyncio.TimeoutError:
            self._kill(proc)
            out, err = b"", b"process killed after timeout"
            rc, timed_out = -9, True
        return {
            "ok": rc == 0 and not timed_out,
            "returncode": rc,
            "timed_out": timed_out,
            "stdout": out.decode("utf-8", "replace")[: self.max_output],
            "stderr": err.decode("utf-8", "replace")[: self.max_output],
        }

    @staticmethod
    def _kill(proc: "asyncio.subprocess.Process") -> None:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            try:
                proc.kill()
            except ProcessLookupError:
                pass


# ---------------------------------------------------------------------------
# Dream engine — autonomous self-review
# ---------------------------------------------------------------------------
class DreamEngine:
    """When idle, review recently generated tools and record improvement notes
    into the soul's Memory. Uses the model when online, static heuristics offline."""

    def __init__(self, agent):  # agent: engine.two_model.TwoModelSystem
        self.agent = agent

    async def dream(self, limit: int = 5) -> Dict[str, Any]:
        tools = self.agent.tools.list()[:limit] if self.agent else []
        reviews: List[Dict[str, Any]] = []
        for t in tools:
            reviews.append(self._review_static(t))
        notes = self._summarise(reviews)
        if notes and self.agent:
            mem = self.agent.soul.sections.get("Memory", "").strip()
            lines = [] if mem.startswith("- (long-term") else ([mem] if mem else [])
            lines.append(f"- {time.strftime('%Y-%m-%d')} dream: {notes}")
            self.agent.soul.sections["Memory"] = "\n".join(lines[-30:])
            self.agent.soul.save()
        return {"reviewed": len(reviews), "reviews": reviews, "notes": notes}

    @staticmethod
    def _review_static(tool) -> Dict[str, Any]:
        code = tool.code
        issues: List[str] = []
        if '"""' not in code:
            issues.append("missing module/function docstring")
        if "try:" not in code:
            issues.append("no error handling (try/except)")
        if _re.search(r"\beval\(|\bexec\(", code):
            issues.append("uses eval/exec — review for safety")
        if "offline_stub" in code:
            issues.append("offline stub — regenerate with a live model")
        return {"tool": tool.name, "issues": issues,
                "healthy": not issues, "lines": code.count("\n") + 1}

    @staticmethod
    def _summarise(reviews: List[Dict[str, Any]]) -> str:
        if not reviews:
            return ""
        weak = [r["tool"] for r in reviews if not r["healthy"]]
        if not weak:
            return f"reviewed {len(reviews)} tools — all healthy"
        return f"{len(weak)}/{len(reviews)} tools need work: {', '.join(weak[:5])}"


# ---------------------------------------------------------------------------
# Task manager
# ---------------------------------------------------------------------------
class TaskManager:
    def __init__(self, cfg: EngineConfig, agent=None, concurrency: int = 2):
        self.cfg = cfg
        self.agent = agent
        self.concurrency = max(1, concurrency)
        self.tasks: Dict[str, Task] = {}
        self._queue: "asyncio.Queue[str]" = asyncio.Queue()
        self._handlers: Dict[TaskType, TaskHandler] = {}
        self._workers: List[asyncio.Task] = []
        self._running = False
        self.on_event: Optional[Callable[[Task], Awaitable[None]]] = None  # hook for Module 3
        self.bash = SafeBashExecutor(cfg)
        self.dreamer = DreamEngine(agent) if agent else None
        self._register_defaults()

    # -------- registration --------
    def register(self, ttype: TaskType, handler: TaskHandler) -> None:
        self._handlers[ttype] = handler

    def _register_defaults(self) -> None:
        self.register(TaskType.LOCAL_BASH, self._handle_bash)
        self.register(TaskType.LOCAL_AGENT, self._handle_agent)
        self.register(TaskType.DREAM, self._handle_dream)

    # -------- default handlers --------
    async def _handle_bash(self, task: Task, mgr: "TaskManager") -> Any:
        cmd = task.payload.get("command", "")
        if not cmd:
            raise ValueError("local_bash task requires payload.command")
        task.log(f"$ {cmd}")
        res = await self.bash.run(cmd, timeout=task.payload.get("timeout"))
        task.log(f"exit={res['returncode']} ok={res['ok']}")
        if not res["ok"]:
            raise RuntimeError(res["stderr"] or f"command failed (exit {res['returncode']})")
        return res

    async def _handle_agent(self, task: Task, mgr: "TaskManager") -> Any:
        if not self.agent:
            raise RuntimeError("no agent attached for local_agent tasks")
        prompt = task.payload.get("prompt", "")
        task.log(f"agent prompt: {prompt[:80]}")
        return await self.agent.handle(prompt)

    async def _handle_dream(self, task: Task, mgr: "TaskManager") -> Any:
        if not self.dreamer:
            raise RuntimeError("no agent attached for dream tasks")
        task.log("entering dream (self-review)")
        return await self.dreamer.dream(limit=task.payload.get("limit", 5))

    # -------- submission / lifecycle --------
    def submit(self, ttype: TaskType, payload: Optional[Dict[str, Any]] = None,
               max_retries: int = 0) -> Task:
        task = Task(type=ttype, payload=payload or {}, max_retries=max_retries)
        self.tasks[task.id] = task
        self._queue.put_nowait(task.id)
        return task

    async def _emit(self, task: Task) -> None:
        if self.on_event:
            try:
                await self.on_event(task)
            except Exception:  # a broken sink must not kill the worker
                pass

    async def _run_one(self, task: Task) -> None:
        handler = self._handlers.get(task.type)
        if handler is None:
            task.error = f"no handler for {task.type.value}"
            task.transition(TaskStatus.FAILED)
            await self._emit(task)
            return
        while True:
            task.attempts += 1
            task.transition(TaskStatus.RUNNING)
            await self._emit(task)
            try:
                task.result = await handler(task, self)
                task.transition(TaskStatus.COMPLETED)
                await self._emit(task)
                return
            except asyncio.CancelledError:
                if task.status == TaskStatus.RUNNING:
                    task.transition(TaskStatus.CANCELLED)
                await self._emit(task)
                raise
            except Exception as e:  # noqa: BLE001
                task.log(f"error: {e}")
                if task.attempts <= task.max_retries:
                    task.log(f"retry {task.attempts}/{task.max_retries}")
                    task.status = TaskStatus.PENDING  # reset for the retry loop
                    await asyncio.sleep(min(2 ** task.attempts, 8))
                    continue
                task.error = str(e)
                task.transition(TaskStatus.FAILED)
                await self._emit(task)
                return

    async def _worker(self) -> None:
        while self._running:
            try:
                tid = await asyncio.wait_for(self._queue.get(), timeout=0.5)
            except asyncio.TimeoutError:
                continue
            task = self.tasks.get(tid)
            if task and task.status == TaskStatus.PENDING:
                await self._run_one(task)
            self._queue.task_done()

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._workers = [asyncio.create_task(self._worker()) for _ in range(self.concurrency)]

    async def stop(self) -> None:
        self._running = False
        for w in self._workers:
            w.cancel()
        for w in self._workers:
            try:
                await w
            except asyncio.CancelledError:
                pass
        self._workers = []

    async def wait(self, *task_ids: str, timeout: float = 30.0) -> None:
        """Block until the given tasks (or all) reach a terminal state."""
        ids = list(task_ids) or list(self.tasks.keys())
        deadline = time.time() + timeout
        terminal = {TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED}
        while time.time() < deadline:
            if all(self.tasks[i].status in terminal for i in ids if i in self.tasks):
                return
            await asyncio.sleep(0.02)
        raise asyncio.TimeoutError("tasks did not finish in time")

    # -------- queries --------
    def get(self, task_id: str) -> Optional[Task]:
        return self.tasks.get(task_id)

    def list(self, status: Optional[TaskStatus] = None) -> List[Task]:
        ts = sorted(self.tasks.values(), key=lambda t: t.created_at, reverse=True)
        return [t for t in ts if status is None or t.status == status]

    def cancel(self, task_id: str) -> bool:
        t = self.tasks.get(task_id)
        if t and t.status == TaskStatus.PENDING:
            t.transition(TaskStatus.CANCELLED)
            return True
        return False

    async def dream_loop(self, interval: float = 300.0) -> None:
        """Autonomous idle mode: periodically submit a DREAM task."""
        while self._running:
            await asyncio.sleep(interval)
            if self._queue.empty():
                self.submit(TaskType.DREAM)
