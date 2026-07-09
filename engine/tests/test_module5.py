"""Module 5 smoke test — auto-verifiers + self-correction. Offline + real exec."""

import asyncio
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import httpx

from engine.config import EngineConfig
from engine.llm import LLMClient, OfflineProvider
from engine.two_model import TwoModelSystem
from engine.verify import (
    ApiVerifier, AutoEngineer, CliVerifier, SelfCorrectionLoop, TracebackParser,
)


async def main() -> None:
    k = 0
    def ok(m):
        nonlocal k; k += 1; print("  ok:", m)

    tmp = Path(tempfile.mkdtemp())
    cfg = EngineConfig(api_key="", data_dir=tmp, evolve_every=99)
    cli = CliVerifier(cfg, timeout=15)

    # traceback parser
    et, es = TracebackParser.parse("", 'Traceback (most recent call last):\n  File "x.py", '
                                   'line 3, in <module>\nValueError: bad thing', 1)
    assert et == "ValueError" and "bad thing" in es and "x.py:3" in es
    ok(f"traceback parser → {es}")

    # CLI verifier: good code passes
    good = await cli.verify_code("print('hello'); print(2+2)")
    assert good.ok and "hello" in good.stdout
    ok(f"CliVerifier runs good code (stdout: {good.stdout.strip()!r})")

    # CLI verifier: broken code fails, error extracted
    bad = await cli.verify_code("x = 1/0\n")
    assert (not bad.ok) and bad.error_type == "ZeroDivisionError"
    ok(f"CliVerifier catches runtime error → {bad.error_summary}")

    # CLI verifier: syntax error
    syn = await cli.verify_code("def broken(:\n  pass\n")
    assert (not syn.ok) and "Error" in syn.error_type
    ok(f"CliVerifier catches syntax error → {syn.error_type}")

    # SELF-CORRECTION: generator emits broken code first, fixed code after seeing the traceback
    calls = {"n": 0}
    async def flaky_gen(task, feedback):
        calls["n"] += 1
        if calls["n"] == 1:
            return "raise RuntimeError('first attempt boom')\n"        # fails
        # proves the traceback was fed back
        assert feedback and "boom" in feedback[-1], "traceback not fed back into prompt"
        return "def run():\n    return 'fixed'\nprint(run())\n"          # passes
    loop = SelfCorrectionLoop(flaky_gen, cli, max_attempts=4)
    run = await loop.run("make something that works")
    assert run.success and run.attempts == 2
    ok(f"self-correction recovered after feeding back the traceback (attempts={run.attempts})")

    # fail-fast: identical error twice → stops early
    async def stuck_gen(task, feedback):
        return "raise ValueError('same every time')\n"
    stuck = await SelfCorrectionLoop(stuck_gen, cli, max_attempts=6).run("impossible")
    assert (not stuck.success) and stuck.attempts == 2 and "stuck" in stuck.error
    ok(f"fail-fast bails on repeating error (attempts={stuck.attempts})")

    # AutoEngineer end-to-end with the real Tool-Maker (offline stub runs cleanly)
    agent = TwoModelSystem(cfg, LLMClient(cfg, OfflineProvider()))
    eng = AutoEngineer(agent, verifier=cli, max_attempts=3)
    built = await eng.build("make a tool that adds two numbers")
    assert built.success, built.error
    assert agent.tools.list(), "verified tool not registered"
    assert "verified tool" in agent.soul.sections["Memory"]
    ok(f"AutoEngineer built+verified a real tool and logged it to the soul")

    # ApiVerifier with an injected mock transport (no network)
    def handler(request):
        if request.url.path == "/ok":
            return httpx.Response(200, text='{"status":"healthy"}')
        return httpx.Response(500, text="boom")
    mock = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="http://svc")
    api = ApiVerifier(client=mock)
    good_api = await api.verify("http://svc/ok", expect_status=200, expect_contains="healthy")
    bad_api = await api.verify("http://svc/broken", expect_status=200)
    assert good_api.ok and not bad_api.ok and bad_api.status_code == 500
    await mock.aclose()
    ok(f"ApiVerifier validates status+body (ok={good_api.ok}, bad={bad_api.error_summary})")

    # optional: tmux path if available on the host
    if shutil.which("tmux"):
        tcli = CliVerifier(cfg, timeout=15, use_tmux=True)
        tr = await tcli.verify_code("print('via tmux')")
        assert tr.ok and "via tmux" in tr.stdout
        ok("CliVerifier tmux mode works")
    else:
        ok("tmux not installed — subprocess mode used (tmux path is optional)")

    await agent.aclose()
    print(f"\nALL {k} MODULE-5 CHECKS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
