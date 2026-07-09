"""Central Brain Hub — one powerful brain, served to ALL clients.

Solves the "my model is strong but someone else's browser is weak" problem:
the server hosts ONE brain (your local GPU model) and every client — web, mobile,
another Super AI instance — connects to it over REST + WebSocket. No client runs
its own weak model; everyone shares the same powerful, self-improving mind and
the same growing knowledge.

Run:
    pip install fastapi uvicorn[standard]
    uvicorn engine.hub:app --host 0.0.0.0 --port 8000
    # brain: local by default (offline until you attach a GPU model)

Attach the powerful local brain (no API):
    SUPERAI_HUB_MODEL=glm-9b   uvicorn engine.hub:app --port 8000
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from .config import EngineConfig
from .llm import LLMClient
from .models import Message, ModelRole, Role
from .sync import FlushGate, SyncEvent, sse_sink
from .tasks import TaskManager, TaskType
from .two_model import TwoModelSystem


class _State:
    agent: Optional[TwoModelSystem] = None
    tasks: Optional[TaskManager] = None


state = _State()


def _build_brain() -> TwoModelSystem:
    """The ONE shared brain. Local GPU model when requested, else offline/API."""
    model = os.getenv("SUPERAI_HUB_MODEL", "").strip()
    cfg = EngineConfig.from_env()
    if model:  # local, no-API brain on the server's GPU
        from .providers import local_brain
        four_bit = os.getenv("SUPERAI_HUB_4BIT", "").lower() in ("1", "true", "yes")
        return TwoModelSystem(cfg, local_brain(model, cfg=cfg, load_in_4bit=four_bit))
    return TwoModelSystem(cfg, LLMClient(cfg))  # API key if set, else offline


@asynccontextmanager
async def lifespan(app: FastAPI):
    state.agent = _build_brain()
    state.tasks = TaskManager(state.agent.cfg, agent=state.agent, concurrency=3)
    await state.tasks.start()
    yield
    await state.tasks.stop()
    await state.agent.aclose()


app = FastAPI(title="Super AI Hub", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


class ChatTurn(BaseModel):
    role: str
    content: str


class ChatIn(BaseModel):
    message: str
    user: str = "anonymous"
    stream: bool = False
    history: list[ChatTurn] = []   # prior turns for multi-turn context


def _history_messages(history: list["ChatTurn"]) -> list[Message]:
    out: list[Message] = []
    for t in history[-12:]:
        role = t.role.lower()
        if role in ("user", "assistant"):  # ignore client-sent system to protect the soul
            out.append(Message(role=Role.USER if role == "user" else Role.ASSISTANT,
                               content=t.content))
    return out


@app.get("/health")
async def health():
    a = state.agent
    return {
        "ok": True,
        "brain": a.llm.provider.name if a else "none",
        "online": a.llm.online if a else False,
        "tools": len(a.tools.list()) if a else 0,
    }


@app.post("/chat")
async def chat(inp: ChatIn):
    """Every client hits this ONE brain — same power for everyone.
    `history` carries prior turns so follow-ups ('now make it faster') keep
    context instead of being treated as a brand-new request."""
    extra = _history_messages(inp.history)
    if inp.stream:
        import json as _json
        async def gen():
            # JSON-encode each token so multi-line code never breaks SSE framing
            async for tok in state.agent.chat_stream(inp.message, extra=extra):
                yield f"data: {_json.dumps(tok)}\n\n"
            yield "data: [DONE]\n\n"
        return StreamingResponse(gen(), media_type="text/event-stream")
    resp = await state.agent.chat(inp.message, extra=extra)
    return JSONResponse({"kind": "chat", "response": resp.model_dump()})


@app.get("/tools")
async def tools():
    return {"tools": [t.model_dump() for t in state.agent.tools.list()]}


@app.get("/soul")
async def soul():
    return {"soul": state.agent.soul.sections}


@app.websocket("/ws")
async def ws(sock: WebSocket):
    """Bidirectional stream: one shared brain, loss-free via the FlushGate."""
    await sock.accept()

    async def sink(batch):
        await sock.send_json({"events": [e.model_dump() for e in batch]})
        return True

    gate = FlushGate(sink, max_batch=16, max_interval=0.05)
    await gate.start()
    try:
        while True:
            msg = await sock.receive_json()
            prompt = msg.get("message", "")
            if not prompt:
                continue
            await gate.emit("start", {"prompt": prompt})
            async for tok in state.agent.chat_stream(prompt):
                await gate.emit("token", tok)
            await gate.emit("done", None)
            await gate.drain(timeout=10)
    except WebSocketDisconnect:
        pass
    finally:
        await gate.stop()
