"""MODULE 6 (part B) — Multi-Agent Orchestration.

A SwarmOrchestrator delegates a goal across three specialist sub-agents that
share the one brain but wear different hats:

    Planner   breaks the goal into concrete steps.
    Coder     writes the code for the plan.
    Reviewer  judges the code (syntax + placeholders + optional model review),
              and on rejection sends feedback back to the Coder (bounded rounds).

Optionally the approved code is executed inside a Module-6 sandbox and verified,
closing the loop: plan → code → review → run-in-jail → result.
"""

from __future__ import annotations

import ast
import re
from typing import List, Optional

from pydantic import BaseModel, Field

from .models import Message, ModelRole, Role
from .sandbox import BaseSandbox, SandboxResult, pick_sandbox

PLANNER_SYS = (
    "You are the Planner in Super AI's engineering swarm. Break the user's goal "
    "into a short numbered list of concrete, ordered implementation steps. "
    "Output only the numbered steps."
)
CODER_SYS = (
    "You are the Coder in Super AI's engineering swarm. Implement the plan as ONE "
    "complete, runnable Python module with a top-level `def run(**kwargs)` entrypoint "
    "that returns a JSON-serialisable result. Standard library only unless essential. "
    "No placeholders, no TODOs. Return ONLY a ```python code block."
)
REVIEWER_SYS = (
    "You are the Reviewer in Super AI's engineering swarm. Judge the code for "
    "correctness and completeness. Reply with `APPROVE` or `REJECT` on the first "
    "line, then bullet-point issues. Be strict about placeholders and missing logic."
)

_CODE_BLOCK = re.compile(r"```(?:python)?\s*(.*?)```", re.DOTALL)


class SubAgent:
    """A role-specialised view over the shared brain."""

    def __init__(self, name: str, system_prompt: str, llm, role: ModelRole = ModelRole.CHAT):
        self.name = name
        self.system_prompt = system_prompt
        self.llm = llm
        self.role = role

    async def run(self, task: str, context: str = "") -> str:
        msgs = [Message(role=Role.SYSTEM, content=self.system_prompt)]
        if context:
            msgs.append(Message(role=Role.SYSTEM, content=context))
        msgs.append(Message(role=Role.USER, content=task))
        resp = await self.llm.complete(msgs, role=self.role)
        return resp.text


class Plan(BaseModel):
    goal: str
    steps: List[str] = Field(default_factory=list)


class Review(BaseModel):
    approved: bool
    issues: List[str] = Field(default_factory=list)
    summary: str = ""


class SwarmResult(BaseModel):
    goal: str
    plan: Plan
    code: str = ""
    review: Review
    iterations: int = 1
    executed: bool = False
    sandbox_result: Optional[SandboxResult] = None


class SwarmOrchestrator:
    def __init__(self, agent, sandbox: Optional[BaseSandbox] = None, max_rounds: int = 2):
        self.agent = agent
        self.llm = agent.llm
        self.sandbox = sandbox
        self.max_rounds = max_rounds
        self.planner = SubAgent("planner", PLANNER_SYS, self.llm, ModelRole.CHAT)
        self.coder = SubAgent("coder", CODER_SYS, self.llm, ModelRole.TOOL_MAKER)
        self.reviewer = SubAgent("reviewer", REVIEWER_SYS, self.llm, ModelRole.CHAT)

    # ---------------- individual roles ----------------
    async def plan(self, goal: str) -> Plan:
        text = await self.planner.run(goal)
        steps = [re.sub(r"^\s*\d+[.)]\s*", "", ln).strip()
                 for ln in text.splitlines() if re.match(r"^\s*\d+[.)]", ln)]
        if not steps:  # fallback: treat non-empty lines as steps, else the goal itself
            steps = [ln.strip("-• ").strip() for ln in text.splitlines() if len(ln.strip()) > 3][:6]
        return Plan(goal=goal, steps=steps or [goal])

    async def code(self, goal: str, plan: Plan, feedback: str = "") -> str:
        ctx = "Plan:\n" + "\n".join(f"{i+1}. {s}" for i, s in enumerate(plan.steps))
        if feedback:
            ctx += f"\n\nReviewer feedback to address:\n{feedback}"
        text = await self.coder.run(goal, ctx)
        m = _CODE_BLOCK.search(text)
        code = (m.group(1) if m else text).strip()
        if "def " not in code:
            code = '"""stub."""\n\ndef run(**kwargs):\n    return {"status": "empty"}\n'
        return code

    async def review(self, goal: str, code: str) -> Review:
        # ground truth first: does it even parse, and is it free of placeholders?
        issues: List[str] = []
        try:
            ast.parse(code)
        except SyntaxError as e:
            issues.append(f"syntax error: {e.msg} (line {e.lineno})")
        if re.search(r"\bTODO\b|\bFIXME\b|your code here|insert .* logic|\bpass\s*#", code, re.I):
            issues.append("contains placeholder/TODO")
        if "def run" not in code:
            issues.append("missing run() entrypoint")

        # optional model review adds qualitative issues (online only)
        if getattr(self.llm, "online", False):
            try:
                verdict = await self.reviewer.run(goal, f"Code:\n```python\n{code}\n```")
                first = verdict.strip().splitlines()[0].upper() if verdict.strip() else ""
                if "REJECT" in first:
                    extra = [ln.strip("-• ").strip() for ln in verdict.splitlines()[1:]
                             if ln.strip().startswith(("-", "•", "*"))]
                    issues.extend(extra[:5] or ["reviewer rejected"])
            except Exception:
                pass

        approved = not issues
        return Review(approved=approved, issues=issues,
                      summary="approved" if approved else "; ".join(issues[:5]))

    # ---------------- full pipeline ----------------
    async def run(self, goal: str, execute: bool = False) -> SwarmResult:
        plan = await self.plan(goal)
        feedback = ""
        code = ""
        review = Review(approved=False, summary="not started")
        rounds = 0
        for rounds in range(1, self.max_rounds + 1):
            code = await self.code(goal, plan, feedback)
            review = await self.review(goal, code)
            if review.approved:
                break
            feedback = "; ".join(review.issues)  # delegate fixes back to the Coder

        result = SwarmResult(goal=goal, plan=plan, code=code, review=review, iterations=rounds)

        if execute and review.approved:
            sandbox = self.sandbox or pick_sandbox(self.agent.cfg)
            await sandbox.write_file("main.py", code + "\n\nif __name__ == '__main__':\n"
                                     "    import json; print(json.dumps(run()))\n")
            result.sandbox_result = await sandbox.run("python3 main.py", timeout=20)
            result.executed = True
            if sandbox is not self.sandbox:
                await sandbox.cleanup()
        return result
