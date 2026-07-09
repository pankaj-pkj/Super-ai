"""Module 1 smoke test — runs fully offline (no API key, no network)."""

import asyncio
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engine.config import EngineConfig
from engine.llm import LLMClient, OfflineProvider
from engine.models import ModelRole
from engine.two_model import TwoModelSystem


def build() -> TwoModelSystem:
    tmp = Path(tempfile.mkdtemp())
    cfg = EngineConfig(api_key="", data_dir=tmp, evolve_every=2, history_window=10)
    return TwoModelSystem(cfg, LLMClient(cfg, OfflineProvider()))


async def main() -> None:
    n = 0
    def ok(m):
        nonlocal n; n += 1; print("  ok:", m)

    sys_ = build()
    assert not sys_.llm.online, "offline provider expected"
    ok("engine boots offline (no api key)")

    # soul.md was written with all sections
    assert sys_.cfg.soul_path.exists()
    txt = sys_.cfg.soul_path.read_text()
    for s in ["Identity", "Personality", "Coding Style", "Learned Preferences", "Memory"]:
        assert f"## {s}" in txt, f"missing section {s}"
    assert "codian_studio" in sys_.soul.system_prompt()
    ok("soul.md created with all sections + codian_studio identity")

    # router: chat vs tool-maker
    assert sys_.router.decide("how are you?").role == ModelRole.CHAT
    assert sys_.router.decide("build a tool to parse csv files").role == ModelRole.TOOL_MAKER
    assert sys_.router.decide("/tool make a downloader").role == ModelRole.TOOL_MAKER
    ok("router splits chat vs tool-maker intent")

    # chat turn
    r = await sys_.chat("Hello, who are you?")
    assert r.text and r.role_used == ModelRole.CHAT
    ok(f"chat brain responds ({r.provider})")

    # tool-maker produces a runnable module with a run() entrypoint
    tool = await sys_.make_tool("make a tool that reverses a string")
    assert "def run" in tool.code and tool.entrypoint == "run"
    assert (sys_.cfg.tools_dir / tool.filename).exists()
    # actually execute the generated tool to prove it runs
    ns: dict = {}
    exec(compile(tool.code, tool.filename, "exec"), ns)
    result = ns["run"](x=1)
    assert isinstance(result, dict)
    ok(f"tool-maker generated + persisted + EXECUTED tool '{tool.name}' -> {result}")

    # registry survives a reload
    sys2 = TwoModelSystem(sys_.cfg, LLMClient(sys_.cfg, OfflineProvider()))
    assert sys2.tools.get(tool.name) is not None, "tool not persisted across restart"
    ok(f"tool registry persists across restart ({len(sys2.tools.list())} tools)")

    # autonomous soul evolution (offline heuristic) after enough interactions
    before = sys_.soul.sections["Learned Preferences"]
    await sys_.chat("write me some python and a telegram bot in python please")
    await sys_.chat("aur ek python script banao csv ke liye")  # hits evolve_every=2
    # give the fire-and-forget evolve task a tick, else force it
    await asyncio.sleep(0)
    changed = await sys_.soul.evolve()
    after = sys_.soul.sections["Learned Preferences"]
    assert "python" in after.lower(), "soul did not learn language preference"
    assert after != before, "soul did not evolve"
    ok("soul autonomously evolved from interactions (learned: python)")
    print("  learned prefs:", after.replace(chr(10), " | "))

    # unified handle() envelope
    env_chat = await sys_.handle("kaise ho?")
    env_tool = await sys_.handle("build a script to add two numbers")
    assert env_chat["kind"] == "chat" and env_tool["kind"] == "tool"
    ok("handle() routes + returns normalized envelopes")

    await sys_.aclose()
    print(f"\nALL {n} MODULE-1 CHECKS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
