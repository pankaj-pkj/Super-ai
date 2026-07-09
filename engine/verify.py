"""MODULE 5 — Auto-Verifiers & Self-Correction.

The AI runs its OWN code, reads stdout/stderr, extracts the traceback, and feeds
the error back into its prompt queue to fix itself — a fail-fast loop.

Verifiers
---------
CliVerifier   executes code/commands via subprocess (optionally inside tmux for
              observability), captures output, parses tracebacks.
ApiVerifier   probes an HTTP endpoint (optionally after booting a server), checks
              status/body. Uses httpx; injectable client for tests.

Self-correction
---------------
TracebackParser  turns raw stderr into a concise, model-friendly error summary.
SelfCorrectionLoop  generate → verify → (on fail) feed traceback back → regenerate,
                    until it passes or attempts run out. Detects "stuck" (same
                    error twice) and bails early.
AutoEngineer     wires the loop to the Module-1 Tool-Maker + CliVerifier and
                    records the lesson into the soul on success.
"""

from __future__ import annotations

import asyncio
import re
import shutil
import time
import uuid
from typing import Any, Awaitable, Callable, List, Optional

from pydantic import BaseModel, Field

from .config import EngineConfig
from .tasks import SafeBashExecutor


# ---------------------------------------------------------------------------
# Result model
# ---------------------------------------------------------------------------
class VerificationResult(BaseModel):
    ok: bool
    kind: str = "cli"                # cli | api
    returncode: Optional[int] = None
    status_code: Optional[int] = None
    stdout: str = ""
    stderr: str = ""
    error_type: str = ""
    error_summary: str = ""
    latency_ms: int = 0


# ---------------------------------------------------------------------------
# Traceback parsing
# ---------------------------------------------------------------------------
class TracebackParser:
    _ERR_LINE = re.compile(r"^\s*([A-Za-z_][\w.]*(?:Error|Exception|Warning))\s*:?\s*(.*)$")
    _FILE_LINE = re.compile(r'File "([^"]+)", line (\d+)')

    @classmethod
    def parse(cls, stdout: str, stderr: str, returncode: Optional[int]) -> tuple[str, str]:
        text = (stderr or "") + "\n" + (stdout or "")
        lines = [ln for ln in text.splitlines() if ln.strip()]

        # 1) classic Python exception — the last matching "XxxError: msg" line
        err_type, err_msg = "", ""
        for ln in reversed(lines):
            m = cls._ERR_LINE.match(ln)
            if m:
                err_type, err_msg = m.group(1), m.group(2).strip()
                break

        # 2) location (deepest frame)
        loc = ""
        locs = cls._FILE_LINE.findall(text)
        if locs:
            f, n = locs[-1]
            loc = f" at {f}:{n}"

        if err_type:
            return err_type, f"{err_type}: {err_msg}{loc}".strip()

        # 3) no python traceback — infer from exit code / generic error text
        if returncode not in (0, None):
            generic = next((ln for ln in reversed(lines)
                            if re.search(r"error|fail|not found|denied", ln, re.I)), "")
            summary = generic.strip() or f"process exited with code {returncode}"
            return "NonZeroExit", summary[:300]
        return "", ""


# ---------------------------------------------------------------------------
# CLI verifier
# ---------------------------------------------------------------------------
class CliVerifier:
    def __init__(self, cfg: EngineConfig, python: str = "python3",
                 timeout: float = 30.0, use_tmux: bool = False):
        self.cfg = cfg
        self.python = python
        self.timeout = timeout
        self.executor = SafeBashExecutor(cfg, timeout=timeout)
        self.use_tmux = use_tmux and shutil.which("tmux") is not None

    async def verify_command(self, command: str) -> VerificationResult:
        t0 = time.time()
        res = (await self._run_tmux(command)) if self.use_tmux else (await self.executor.run(command))
        et, es = TracebackParser.parse(res["stdout"], res["stderr"], res["returncode"])
        return VerificationResult(
            ok=res["ok"], kind="cli", returncode=res["returncode"],
            stdout=res["stdout"], stderr=res["stderr"], error_type=et, error_summary=es,
            latency_ms=int((time.time() - t0) * 1000),
        )

    async def verify_code(self, code: str, filename: Optional[str] = None) -> VerificationResult:
        fname = filename or f"candidate_{uuid.uuid4().hex[:8]}.py"
        (self.executor.workdir / fname).write_text(code, encoding="utf-8")
        return await self.verify_command(f"{self.python} {fname}")

    async def _run_tmux(self, command: str) -> dict:
        """Run inside a detached tmux session for observability; capture the pane."""
        sess = f"superai_{uuid.uuid4().hex[:8]}"
        done = self.executor.workdir / f"{sess}.done"
        wrapped = f"cd {self.executor.workdir}; ({command}) >{sess}.out 2>{sess}.err; echo $? >{done.name}"
        await self.executor.run(f"tmux new-session -d -s {sess} {_q(wrapped)}")
        # poll for completion
        deadline = time.time() + self.timeout
        while time.time() < deadline and not done.exists():
            await asyncio.sleep(0.1)
        rc = int((done.read_text().strip() or "-9")) if done.exists() else -9
        out = (self.executor.workdir / f"{sess}.out")
        err = (self.executor.workdir / f"{sess}.err")
        await self.executor.run(f"tmux kill-session -t {sess} 2>/dev/null; true")
        return {
            "ok": rc == 0, "returncode": rc,
            "stdout": out.read_text("utf-8", "replace") if out.exists() else "",
            "stderr": err.read_text("utf-8", "replace") if err.exists() else "",
        }


def _q(s: str) -> str:
    return "'" + s.replace("'", "'\\''") + "'"


# ---------------------------------------------------------------------------
# API verifier
# ---------------------------------------------------------------------------
class ApiVerifier:
    def __init__(self, timeout: float = 10.0, client: Any = None):
        self.timeout = timeout
        self._client = client  # inject an httpx.AsyncClient (or MockTransport) for tests

    async def verify(self, url: str, method: str = "GET", expect_status: int = 200,
                     expect_contains: Optional[str] = None, json: Any = None,
                     headers: Optional[dict] = None) -> VerificationResult:
        import httpx
        t0 = time.time()
        client = self._client or httpx.AsyncClient(timeout=self.timeout)
        owns = self._client is None
        try:
            r = await client.request(method, url, json=json, headers=headers)
            body = r.text
            ok = r.status_code == expect_status and (expect_contains is None or expect_contains in body)
            summary = "" if ok else (
                f"expected {expect_status}"
                + (f" containing {expect_contains!r}" if expect_contains else "")
                + f", got {r.status_code}"
            )
            return VerificationResult(
                ok=ok, kind="api", status_code=r.status_code, stdout=body[:4000],
                error_type="" if ok else "ApiMismatch", error_summary=summary,
                latency_ms=int((time.time() - t0) * 1000),
            )
        except Exception as e:  # noqa: BLE001 — connection/timeout/etc.
            return VerificationResult(ok=False, kind="api", error_type="ApiError",
                                      error_summary=str(e)[:300],
                                      latency_ms=int((time.time() - t0) * 1000))
        finally:
            if owns:
                await client.aclose()

    async def verify_server(self, boot_command: str, probe_url: str, cfg: EngineConfig,
                            ready_timeout: float = 10.0, **verify_kw) -> VerificationResult:
        """Boot a server via CLI, wait until it answers, probe it, then tear down."""
        executor = SafeBashExecutor(cfg, timeout=ready_timeout + 5)
        # launch detached
        await executor.run(f"nohup {boot_command} >server.log 2>&1 & echo $! >server.pid")
        deadline = time.time() + ready_timeout
        result = VerificationResult(ok=False, kind="api", error_summary="server never became ready")
        try:
            while time.time() < deadline:
                probe = await self.verify(probe_url, **verify_kw)
                if probe.ok or probe.status_code:
                    result = probe
                    break
                await asyncio.sleep(0.3)
        finally:
            await executor.run("kill $(cat server.pid) 2>/dev/null; true")
        return result


# ---------------------------------------------------------------------------
# Self-correction loop
# ---------------------------------------------------------------------------
class CorrectionRun(BaseModel):
    success: bool
    attempts: int
    final_code: str = ""
    error: str = ""
    history: List[VerificationResult] = Field(default_factory=list)


Generator = Callable[[str, List[str]], Awaitable[str]]  # (task, feedback) -> code


class SelfCorrectionLoop:
    def __init__(self, generate: Generator, verifier: CliVerifier, max_attempts: int = 4):
        self.generate = generate
        self.verifier = verifier
        self.max_attempts = max_attempts

    async def run(self, task: str) -> CorrectionRun:
        feedback: List[str] = []          # the prompt queue of past errors
        history: List[VerificationResult] = []
        last_summary = None
        # stable filename across attempts → identical failures produce identical
        # summaries, so "stuck" detection is reliable
        fname = f"candidate_{uuid.uuid4().hex[:8]}.py"
        for attempt in range(1, self.max_attempts + 1):
            code = await self.generate(task, feedback)
            result = await self.verifier.verify_code(code, filename=fname)
            history.append(result)
            if result.ok:
                return CorrectionRun(success=True, attempts=attempt, final_code=code, history=history)
            summary = result.error_summary or (result.stderr or "unknown error")[:300]
            feedback.append(f"attempt {attempt}: {summary}")
            # fail-fast: identical error twice in a row → we're stuck, stop early
            if summary == last_summary:
                return CorrectionRun(success=False, attempts=attempt, final_code=code,
                                     error=f"stuck on repeating error: {summary}", history=history)
            last_summary = summary
        return CorrectionRun(success=False, attempts=self.max_attempts, final_code=code,
                             error=f"exhausted {self.max_attempts} attempts: {last_summary}",
                             history=history)


class AutoEngineer:
    """Generate a tool with the Module-1 Tool-Maker and self-correct until it runs."""

    def __init__(self, agent, verifier: Optional[CliVerifier] = None, max_attempts: int = 4):
        self.agent = agent
        self.verifier = verifier or CliVerifier(agent.cfg)
        self.loop = SelfCorrectionLoop(self._gen, self.verifier, max_attempts=max_attempts)

    async def _gen(self, task: str, feedback: List[str]) -> str:
        return await self.agent.draft_tool_code(task, feedback)

    async def build(self, task: str) -> CorrectionRun:
        run = await self.loop.run(task)
        if run.success:
            from .models import GeneratedTool
            tool = GeneratedTool(
                name=self.agent._infer_name(task, run.final_code),
                description=task.strip()[:200], code=run.final_code,
                entrypoint=self.agent._infer_entrypoint(run.final_code), source_task=task.strip(),
            )
            self.agent.tools.add(tool)
            # remember the win in the soul's memory
            mem = self.agent.soul.sections.get("Memory", "").strip()
            lines = [] if mem.startswith("- (long-term") else ([mem] if mem else [])
            lines.append(f"- {time.strftime('%Y-%m-%d')}: built & verified tool for '{task[:60]}' "
                         f"in {run.attempts} attempt(s).")
            self.agent.soul.sections["Memory"] = "\n".join(lines[-30:])
            self.agent.soul.save()
        return run
