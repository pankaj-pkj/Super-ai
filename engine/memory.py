"""MODULE 4 — Memory Compaction & Context Collapse.

Prevents token overflow on long agent runs (GLM-5-level contexts and beyond).

`microcompact_messages` keeps recent working memory intact and dynamically
collapses OLDER, verbose tool outputs / terminal logs into a compact summary,
so the model always stays under budget without losing what matters (errors,
decisions, results).

Strategy
--------
1. System messages are pinned at the front, always kept.
2. Walk from the newest message backwards, accumulating tokens until the
   `keep_recent_tokens` working-memory budget is hit → that's the COMPACT
   BOUNDARY. Everything newer than the boundary is kept verbatim.
3. Everything older than the boundary is summarized into a single message.
   Verbose tool/terminal output is shrunk head+tail with error lines preserved;
   an LLM writes the summary when available, else a deterministic heuristic.
4. If the recent region alone still exceeds budget, its largest tool outputs are
   shrunk too — the loop guarantees the result fits `max_tokens`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List, Optional, Tuple

from .models import Message, ModelRole, Role

# lines worth keeping even when we shrink a big blob
_SIGNAL = re.compile(
    r"(traceback|error|exception|failed|fail\b|exit\s*code|warning|assert|"
    r"\bE\d{3,}\b|panic|fatal|✓|✗|passed|success)", re.IGNORECASE
)


def estimate_tokens(text: str) -> int:
    """~4 chars/token, matching common LLM tokenizers closely enough for budgeting."""
    return max(1, len(text) // 4)


def message_tokens(m: Message) -> int:
    return estimate_tokens(m.content) + 4  # + role/framing overhead


@dataclass
class ContextBudget:
    max_tokens: int = 8000          # hard ceiling for the whole context
    keep_recent_tokens: int = 3000  # working-memory kept verbatim
    summary_target_tokens: int = 700  # size cap for the collapsed summary
    head_lines: int = 6             # lines kept from the top of a shrunk blob
    tail_lines: int = 8             # lines kept from the bottom


def shrink_blob(text: str, budget: ContextBudget) -> str:
    """Collapse a large tool/terminal output: keep head, tail, and signal lines."""
    lines = text.splitlines()
    if len(lines) <= budget.head_lines + budget.tail_lines:
        return text
    head = lines[: budget.head_lines]
    tail = lines[-budget.tail_lines :]
    middle = lines[budget.head_lines : -budget.tail_lines]
    signals = [ln for ln in middle if _SIGNAL.search(ln)][:12]
    omitted = len(middle) - len(signals)
    out = head[:]
    if signals:
        out.append(f"… [{omitted} lines omitted; kept {len(signals)} signal lines] …")
        out.extend(signals)
    else:
        out.append(f"… [{len(middle)} lines omitted] …")
    out.extend(tail)
    return "\n".join(out)


def find_compact_boundary(messages: List[Message], budget: ContextBudget) -> int:
    """Index of the first message that belongs to RECENT (kept verbatim).
    Everything with index < boundary (and not a pinned system msg) is old."""
    acc = 0
    boundary = len(messages)
    for i in range(len(messages) - 1, -1, -1):
        if messages[i].role == Role.SYSTEM:
            continue
        acc += message_tokens(messages[i])
        if acc > budget.keep_recent_tokens:
            boundary = i + 1
            break
        boundary = i
    return boundary


class MemoryCompactor:
    def __init__(self, budget: Optional[ContextBudget] = None, llm=None):
        self.budget = budget or ContextBudget()
        self.llm = llm  # optional engine.llm.LLMClient for high-quality summaries

    def total_tokens(self, messages: List[Message]) -> int:
        return sum(message_tokens(m) for m in messages)

    async def compact(self, messages: List[Message]) -> Tuple[List[Message], dict]:
        before = self.total_tokens(messages)
        if before <= self.budget.max_tokens:
            return messages, {"compacted": False, "tokens_before": before, "tokens_after": before}

        system = [m for m in messages if m.role == Role.SYSTEM]
        body = [m for m in messages if m.role != Role.SYSTEM]
        boundary = find_compact_boundary(messages, self.budget)
        # translate boundary (index into full list) to the body list
        old = [m for m in messages[:boundary] if m.role != Role.SYSTEM]
        recent = [m for m in messages[boundary:] if m.role != Role.SYSTEM]
        if not old:  # recent alone is too big → shrink its biggest tool blobs
            recent = self._shrink_recent(recent)
            result = system + recent
            after = self.total_tokens(result)
            return result, {"compacted": True, "mode": "recent-shrink",
                            "tokens_before": before, "tokens_after": after}

        summary_text = await self._summarize(old)
        summary = Message(role=Role.SYSTEM, content=f"[Compacted memory of {len(old)} earlier "
                          f"messages]\n{summary_text}")
        result = system + [summary] + recent
        # safety net: still over budget → shrink recent tool blobs too
        if self.total_tokens(result) > self.budget.max_tokens:
            recent = self._shrink_recent(recent)
            result = system + [summary] + recent
        after = self.total_tokens(result)
        return result, {
            "compacted": True, "mode": "summarize",
            "boundary": boundary, "summarized_msgs": len(old),
            "kept_recent": len(recent), "tokens_before": before, "tokens_after": after,
        }

    def _shrink_recent(self, recent: List[Message]) -> List[Message]:
        out: List[Message] = []
        for m in recent:
            if m.role == Role.TOOL or message_tokens(m) > 400:
                out.append(Message(role=m.role, name=m.name,
                                   content=shrink_blob(m.content, self.budget)))
            else:
                out.append(m)
        return out

    async def _summarize(self, old: List[Message]) -> str:
        # pre-shrink verbose blobs so the summarizer/heuristic isn't overwhelmed
        condensed = []
        for m in old:
            content = m.content
            if m.role == Role.TOOL or message_tokens(m) > 300:
                content = shrink_blob(content, self.budget)
            condensed.append(f"{m.role.value.upper()}: {content}")
        joined = "\n".join(condensed)

        if self.llm is not None and getattr(self.llm, "online", False):
            try:
                prompt = [
                    Message(role=Role.SYSTEM, content=(
                        "Summarize this earlier conversation for an AI agent's memory. "
                        "Preserve decisions, code/tool results, errors and open threads. "
                        f"Be under {self.budget.summary_target_tokens} tokens. Bullet points.")),
                    Message(role=Role.USER, content=joined[: self.budget.max_tokens * 4]),
                ]
                resp = await self.llm.complete(prompt, role=ModelRole.CHAT)
                if resp.text.strip():
                    return resp.text.strip()[: self.budget.summary_target_tokens * 4]
            except Exception:
                pass
        return self._heuristic_summary(old, joined)

    def _heuristic_summary(self, old: List[Message], joined: str) -> str:
        """Deterministic offline summary: counts + preserved signal lines."""
        by_role = {}
        for m in old:
            by_role[m.role.value] = by_role.get(m.role.value, 0) + 1
        signals = [ln for ln in joined.splitlines() if _SIGNAL.search(ln)][:15]
        parts = ["- roles: " + ", ".join(f"{k}×{v}" for k, v in by_role.items())]
        # first user goal + last assistant action give continuity
        first_user = next((m.content for m in old if m.role == Role.USER), "")
        last_ai = next((m.content for m in reversed(old) if m.role == Role.ASSISTANT), "")
        if first_user:
            parts.append(f"- earlier goal: {first_user[:200]}")
        if last_ai:
            parts.append(f"- last action: {last_ai[:200]}")
        if signals:
            parts.append("- notable log lines:")
            parts.extend("  " + s.strip()[:160] for s in signals)
        text = "\n".join(parts)
        return text[: self.budget.summary_target_tokens * 4]
