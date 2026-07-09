"""Module 6 smoke test — sandboxing + swarm orchestration. Offline + real jail."""

import asyncio
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engine.config import EngineConfig
from engine.llm import LLMClient, OfflineProvider
from engine.sandbox import (
    DockerSandbox, LocalSandbox, TermuxSandbox, pick_sandbox,
)
from engine.swarm import SwarmOrchestrator
from engine.two_model import TwoModelSystem


async def main() -> None:
    k = 0
    def ok(m):
        nonlocal k; k += 1; print("  ok:", m)

    tmp = Path(tempfile.mkdtemp())
    cfg = EngineConfig(api_key="", data_dir=tmp, evolve_every=99)

    # ---- LocalSandbox runs code in a confined workdir ----
    sb = LocalSandbox(cfg, cpu_secs=10)
    r = await sb.run("echo jailed && python3 -c 'print(6*7)'")
    assert r.ok and "jailed" in r.stdout and "42" in r.stdout
    ok(f"LocalSandbox runs code in a confined jail → {r.stdout.split()!r}")

    # ---- denylist blocks a destructive command (never executed) ----
    blocked = await sb.run("rm -rf /")
    assert blocked.blocked and not blocked.ok
    ok("sandbox denylist blocks destructive command")

    # ---- resource cap: fork bomb is contained, host survives ----
    fb = await sb.run(":(){ :|:& };:", timeout=5)
    assert not fb.ok            # contained (blocked or ulimit-killed), we're still alive
    ok("fork bomb contained (host not crashed)")

    # ---- timeout kills a runaway ----
    to = await sb.run("sleep 30", timeout=1)
    assert to.timed_out and not to.ok
    ok("runaway command killed on timeout")

    # ---- backend detection + auto-pick ----
    assert LocalSandbox.available() is True
    assert isinstance(DockerSandbox.available(), bool)
    assert isinstance(TermuxSandbox.available(), bool)
    picked = pick_sandbox(cfg)
    assert picked.name in ("docker", "termux", "local")
    ok(f"sandbox auto-pick chose '{picked.name}' (strongest available)")
    await picked.cleanup()

    # ---- SWARM: plan → code → review, offline ----
    agent = TwoModelSystem(cfg, LLMClient(cfg, OfflineProvider()))
    swarm = SwarmOrchestrator(agent, sandbox=LocalSandbox(cfg), max_rounds=2)

    plan = await swarm.plan("build a utility that adds two numbers")
    assert plan.steps, "planner produced no steps"
    ok(f"Planner produced {len(plan.steps)} step(s)")

    # reviewer is real ground-truth: rejects broken code, approves good code
    bad = await swarm.review("x", "def run(:\n pass")          # syntax error
    good = await swarm.review("x", "def run():\n    return 1+1\n")
    assert not bad.approved and good.approved
    ok(f"Reviewer rejects broken code ({bad.summary[:40]}), approves valid code")

    # reviewer catches placeholders
    ph = await swarm.review("x", "def run():\n    # TODO: your code here\n    pass\n")
    assert not ph.approved and any("placeholder" in i.lower() for i in ph.issues)
    ok("Reviewer catches placeholder/TODO code")

    # full pipeline with execution in the sandbox
    res = await swarm.run("make a tool that returns a greeting", execute=True)
    assert res.plan.steps and res.code
    assert res.review.approved, res.review.summary
    assert res.executed and res.sandbox_result and res.sandbox_result.ok
    ok(f"Swarm plan→code→review→run-in-jail OK "
       f"(iterations={res.iterations}, sandbox={res.sandbox_result.sandbox})")
    print("  sandbox stdout:", res.sandbox_result.stdout.strip()[:80])

    await agent.aclose()
    print(f"\nALL {k} MODULE-6 CHECKS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
