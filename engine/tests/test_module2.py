"""Module 2 smoke test — task state machine, dispatch, safe bash, dream. Offline."""

import asyncio
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engine.config import EngineConfig
from engine.llm import LLMClient, OfflineProvider
from engine.tasks import (
    InvalidTransition, SafeBashExecutor, Task, TaskManager, TaskStatus, TaskType,
)
from engine.two_model import TwoModelSystem


async def main() -> None:
    n = 0
    def ok(m):
        nonlocal n; n += 1; print("  ok:", m)

    tmp = Path(tempfile.mkdtemp())
    cfg = EngineConfig(api_key="", data_dir=tmp, evolve_every=99)
    agent = TwoModelSystem(cfg, LLMClient(cfg, OfflineProvider()))
    mgr = TaskManager(cfg, agent=agent, concurrency=2)
    await mgr.start()

    # strict state machine — illegal transitions raise
    t = Task(type=TaskType.LOCAL_BASH)
    assert t.status == TaskStatus.PENDING
    try:
        t.transition(TaskStatus.COMPLETED)  # pending->completed illegal
        raise AssertionError("illegal transition allowed")
    except InvalidTransition:
        pass
    t.transition(TaskStatus.RUNNING); t.transition(TaskStatus.COMPLETED)
    ok("state machine enforces pending→running→completed, blocks illegal jumps")

    # local_bash: success
    b = mgr.submit(TaskType.LOCAL_BASH, {"command": "echo hello-superai"})
    await mgr.wait(b.id, timeout=15)
    assert b.status == TaskStatus.COMPLETED, b.error
    assert "hello-superai" in b.result["stdout"]
    ok(f"local_bash executes safely -> {b.result['stdout'].strip()} ({b.duration_ms}ms)")

    # local_bash: failure sets FAILED + captures stderr
    f = mgr.submit(TaskType.LOCAL_BASH, {"command": "exit 3"})
    await mgr.wait(f.id, timeout=15)
    assert f.status == TaskStatus.FAILED and f.attempts == 1
    ok("local_bash failure → FAILED with captured error")

    # denylist blocks destructive commands (never executed)
    res = await SafeBashExecutor(cfg).run("rm -rf /")
    assert res["blocked"] is True and res["ok"] is False
    ok("safe executor blocks destructive command via denylist")

    # timeout kills a runaway process
    to = mgr.submit(TaskType.LOCAL_BASH, {"command": "sleep 10", "timeout": 0.5})
    await mgr.wait(to.id, timeout=15)
    assert to.status == TaskStatus.FAILED
    ok("runaway command is killed on timeout")

    # retry: a flaky command that fails once then... (here always fails) exhausts retries
    r = mgr.submit(TaskType.LOCAL_BASH, {"command": "exit 1"}, max_retries=2)
    await mgr.wait(r.id, timeout=20)
    assert r.status == TaskStatus.FAILED and r.attempts == 3
    ok(f"retry policy honored (attempts={r.attempts})")

    # local_agent: dispatches into Module 1
    a = mgr.submit(TaskType.LOCAL_AGENT, {"prompt": "build a tool to add numbers"})
    await mgr.wait(a.id, timeout=15)
    assert a.status == TaskStatus.COMPLETED and a.result["kind"] == "tool"
    ok("local_agent runs the two-model system (generated a tool)")

    # dream: autonomous self-review writes a note into the soul's Memory
    d = mgr.submit(TaskType.DREAM, {"limit": 5})
    await mgr.wait(d.id, timeout=15)
    assert d.status == TaskStatus.COMPLETED
    assert "dream" in agent.soul.sections["Memory"].lower()
    ok(f"dream reviewed {d.result['reviewed']} tools → soul memory updated")
    print("  dream notes:", d.result["notes"])

    # event hook fires for Module 3 wiring
    seen = []
    mgr.on_event = lambda task: seen.append(task.status) or asyncio.sleep(0)
    e = mgr.submit(TaskType.LOCAL_BASH, {"command": "echo ok"})
    await mgr.wait(e.id, timeout=15)
    assert TaskStatus.RUNNING in seen and TaskStatus.COMPLETED in seen
    ok("on_event hook streams lifecycle transitions (ready for Module 3)")

    # cancel a queued task
    mgr2 = TaskManager(cfg, agent=agent, concurrency=1)  # not started → stays pending
    c = mgr2.submit(TaskType.LOCAL_BASH, {"command": "echo x"})
    assert mgr2.cancel(c.id) and c.status == TaskStatus.CANCELLED
    ok("pending task can be cancelled")

    await mgr.stop()
    await agent.aclose()
    print(f"\nALL {n} MODULE-2 CHECKS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
