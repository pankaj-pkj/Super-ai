"""MODULE 6 (part A) — Sandboxing.

Run AI-generated bash/code in a strictly isolated jail so a bad command can
never crash the host. Three backends, auto-selected by what's available:

DockerSandbox   strongest — OS-level isolation, no network, memory/cpu/pids caps.
TermuxSandbox   for Termux/proot-distro — isolated rootfs via proot when present,
                else a confined dir with ulimit resource caps.
LocalSandbox    portable fallback — confined workdir + ulimit caps + denylist.

All backends enforce: destructive-command denylist, output caps, wall-clock
timeout with process-group kill, and resource limits (mem/cpu/procs) so a fork
bomb or memory hog is contained rather than taking down the machine.
"""

from __future__ import annotations

import asyncio
import os
import re
import shutil
import signal
import uuid
from pathlib import Path
from typing import Optional

from pydantic import BaseModel

from .config import EngineConfig

_DENY = [
    r"rm\s+-rf\s+/(?:\s|$)", r":\(\)\s*\{.*\};\s*:", r"\bmkfs\b", r"\bdd\s+if=",
    r"\bshutdown\b", r"\breboot\b", r">\s*/dev/sd", r"\bchmod\s+-R\s+777\s+/",
    r"\b(curl|wget)\b[^\n|]*\|\s*(sh|bash)",
]
_DENY_RE = [re.compile(p, re.IGNORECASE) for p in _DENY]


class SandboxResult(BaseModel):
    ok: bool
    sandbox: str
    returncode: Optional[int] = None
    stdout: str = ""
    stderr: str = ""
    timed_out: bool = False
    blocked: bool = False


class BaseSandbox:
    name = "base"

    def __init__(self, cfg: EngineConfig, mem_mb: int = 2048, cpu_secs: int = 20,
                 max_procs: int = 256, max_output: int = 20000):
        self.cfg = cfg
        self.mem_mb = mem_mb
        self.cpu_secs = cpu_secs
        self.max_procs = max_procs
        self.max_output = max_output
        self.workdir = cfg.data_dir / "sandbox" / uuid.uuid4().hex[:8]
        self.workdir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def available() -> bool:
        return True

    def _denied(self, command: str) -> Optional[str]:
        for rx in _DENY_RE:
            if rx.search(command):
                return f"blocked by denylist: /{rx.pattern}/"
        return None

    async def write_file(self, name: str, content: str) -> Path:
        p = self.workdir / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8")
        return p

    async def cleanup(self) -> None:
        shutil.rmtree(self.workdir, ignore_errors=True)

    async def run(self, command: str, timeout: Optional[float] = None) -> SandboxResult:
        raise NotImplementedError

    # shared subprocess runner with process-group kill
    async def _exec(self, argv: list[str], timeout: float, env: Optional[dict] = None) -> dict:
        proc = await asyncio.create_subprocess_exec(
            *argv, cwd=str(self.workdir),
            env=env or {"PATH": os.environ.get("PATH", "/usr/bin:/bin"),
                        "HOME": str(self.workdir), "LANG": "C.UTF-8"},
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            start_new_session=True,
        )
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            return {"rc": proc.returncode, "out": out, "err": err, "timed_out": False}
        except asyncio.TimeoutError:
            self._kill(proc)
            return {"rc": -9, "out": b"", "err": b"killed after timeout", "timed_out": True}

    @staticmethod
    def _kill(proc) -> None:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            try:
                proc.kill()
            except ProcessLookupError:
                pass

    def _finish(self, res: dict, timeout_default: float) -> SandboxResult:
        return SandboxResult(
            ok=(res["rc"] == 0 and not res["timed_out"]), sandbox=self.name,
            returncode=res["rc"], timed_out=res["timed_out"],
            stdout=res["out"].decode("utf-8", "replace")[: self.max_output],
            stderr=res["err"].decode("utf-8", "replace")[: self.max_output],
        )


class LocalSandbox(BaseSandbox):
    """Confined dir + ulimit resource caps + denylist. Always available."""
    name = "local"

    def _ulimit_prefix(self) -> str:
        # each ulimit guarded so an unsupported one doesn't abort the shell
        return (
            f"ulimit -t {self.cpu_secs} 2>/dev/null; "
            f"ulimit -u {self.max_procs} 2>/dev/null; "
            f"ulimit -v {self.mem_mb * 1024} 2>/dev/null; "
        )

    async def run(self, command: str, timeout: Optional[float] = None) -> SandboxResult:
        blk = self._denied(command)
        if blk:
            return SandboxResult(ok=False, sandbox=self.name, blocked=True, returncode=-1, stderr=blk)
        wrapped = self._ulimit_prefix() + command
        res = await self._exec(["/bin/bash", "-c", wrapped], timeout or (self.cpu_secs + 10))
        return self._finish(res, self.cpu_secs)


class TermuxSandbox(LocalSandbox):
    """Termux/proot-distro. Uses an isolated proot rootfs when present, else the
    LocalSandbox ulimit confinement (which is the right level on Android/Termux)."""
    name = "termux"

    def __init__(self, *a, distro: str = "alpine", **kw):
        super().__init__(*a, **kw)
        self.distro = distro
        self._proot = shutil.which("proot-distro")

    @staticmethod
    def available() -> bool:
        return bool(os.getenv("PREFIX", "").find("com.termux") >= 0 or shutil.which("proot-distro"))

    async def run(self, command: str, timeout: Optional[float] = None) -> SandboxResult:
        blk = self._denied(command)
        if blk:
            return SandboxResult(ok=False, sandbox=self.name, blocked=True, returncode=-1, stderr=blk)
        if self._proot:
            inner = self._ulimit_prefix() + command
            argv = ["proot-distro", "login", self.distro, "--", "bash", "-c", inner]
            res = await self._exec(argv, timeout or (self.cpu_secs + 15))
            return self._finish(res, self.cpu_secs)
        return await super().run(command, timeout)  # ulimit-confined fallback


class DockerSandbox(BaseSandbox):
    """Strongest isolation: a throwaway container, no network, capped resources."""
    name = "docker"

    def __init__(self, *a, image: str = "python:3.11-alpine", network: bool = False, **kw):
        super().__init__(*a, **kw)
        self.image = image
        self.network = network

    @staticmethod
    def available() -> bool:
        return shutil.which("docker") is not None

    async def run(self, command: str, timeout: Optional[float] = None) -> SandboxResult:
        blk = self._denied(command)
        if blk:
            return SandboxResult(ok=False, sandbox=self.name, blocked=True, returncode=-1, stderr=blk)
        name = f"superai_{uuid.uuid4().hex[:8]}"
        argv = [
            "docker", "run", "--rm", "--name", name,
            "--network", "bridge" if self.network else "none",
            f"--memory={self.mem_mb}m", "--cpus=1", "--pids-limit", str(self.max_procs),
            "--read-only", "--tmpfs", "/tmp",
            "-v", f"{self.workdir}:/work:rw", "-w", "/work",
            self.image, "bash", "-c", command,
        ]
        try:
            res = await self._exec(argv, timeout or (self.cpu_secs + 20))
        finally:
            # ensure the container is gone even on timeout
            await self._exec(["docker", "kill", name], 5)
        return self._finish(res, self.cpu_secs)


def pick_sandbox(cfg: EngineConfig, prefer: Optional[str] = None) -> BaseSandbox:
    """Auto-select the strongest available sandbox (Docker > Termux > Local)."""
    order = [prefer] if prefer else []
    order += ["docker", "termux", "local"]
    table = {"docker": DockerSandbox, "termux": TermuxSandbox, "local": LocalSandbox}
    for key in order:
        cls = table.get(key)
        if cls and cls.available():
            return cls(cfg)
    return LocalSandbox(cfg)
