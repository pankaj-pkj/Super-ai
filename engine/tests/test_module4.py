"""Module 4 smoke test — microcompact / context collapse. Offline (heuristic)."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engine.memory import (
    ContextBudget, MemoryCompactor, estimate_tokens, find_compact_boundary, shrink_blob,
)
from engine.models import Message, Role


def big_tool_output(n: int, marker: str) -> str:
    lines = [f"{marker} line {i}: lorem ipsum dolor sit amet consectetur" for i in range(n)]
    lines.insert(n // 2, "Traceback (most recent call last): ValueError: boom")
    return "\n".join(lines)


async def main() -> None:
    k = 0
    def ok(m):
        nonlocal k; k += 1; print("  ok:", m)

    budget = ContextBudget(max_tokens=2000, keep_recent_tokens=800, summary_target_tokens=300)
    comp = MemoryCompactor(budget=budget, llm=None)  # offline heuristic

    # shrink_blob keeps head, tail, and the error line
    blob = big_tool_output(300, "OUT")
    small = shrink_blob(blob, budget)
    assert "Traceback" in small, "signal line dropped"
    assert "omitted" in small
    assert estimate_tokens(small) < estimate_tokens(blob) / 3
    ok(f"shrink_blob collapses {estimate_tokens(blob)}→{estimate_tokens(small)} tok, keeps error")

    # build an overflowing conversation
    msgs = [Message(role=Role.SYSTEM, content="You are Super AI by codian_studio.")]
    for i in range(6):
        msgs.append(Message(role=Role.USER, content=f"do step {i}"))
        msgs.append(Message(role=Role.ASSISTANT, content=f"running step {i}"))
        msgs.append(Message(role=Role.TOOL, name="bash", content=big_tool_output(120, f"S{i}")))
    # a fresh, important recent exchange at the end
    msgs.append(Message(role=Role.USER, content="FINAL_QUESTION: what failed?"))
    msgs.append(Message(role=Role.ASSISTANT, content="RECENT_ANSWER: the ValueError in step 3"))

    before = comp.total_tokens(msgs)
    assert before > budget.max_tokens, "test setup should overflow"

    boundary = find_compact_boundary(msgs, budget)
    assert 0 < boundary < len(msgs)
    ok(f"compact boundary found at index {boundary}/{len(msgs)}")

    out, stats = await comp.compact(msgs)
    after = comp.total_tokens(out)
    assert stats["compacted"] is True
    assert after <= budget.max_tokens, f"still over budget: {after}>{budget.max_tokens}"
    ok(f"compacted {stats['tokens_before']}→{stats['tokens_after']} tok (≤ {budget.max_tokens})")

    # system message pinned at front
    assert out[0].role == Role.SYSTEM and "codian_studio" in out[0].content
    ok("system prompt pinned + preserved")

    # recent working memory kept verbatim
    joined = "\n".join(m.content for m in out)
    assert "FINAL_QUESTION: what failed?" in joined
    assert "RECENT_ANSWER: the ValueError in step 3" in joined
    ok("recent working memory kept verbatim")

    # old region summarized into ONE memory message, error signal retained
    assert any("Compacted memory" in m.content for m in out)
    assert "ValueError" in joined or "Traceback" in joined
    ok("older tool logs collapsed into a summary (error signal retained)")

    # idempotent-ish: compacting an already-fit context is a no-op
    out2, stats2 = await comp.compact(out)
    assert stats2["compacted"] is False
    ok("already-compact context is left unchanged (no-op)")

    # extreme: a single huge recent tool blob still forced under budget
    huge = [Message(role=Role.SYSTEM, content="sys"),
            Message(role=Role.TOOL, name="bash", content=big_tool_output(4000, "HUGE"))]
    out3, stats3 = await comp.compact(huge)
    assert comp.total_tokens(out3) <= budget.max_tokens
    ok(f"single oversized tool output forced under budget ({stats3['mode']})")

    print(f"\nALL {k} MODULE-4 CHECKS PASSED")


if __name__ == "__main__":
    asyncio.run(main())
