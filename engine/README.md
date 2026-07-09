# Super AI Engine — 🔒 NO API. Your model, your GPU, your box.

Autonomous, self-improving AI software-engineer backend (Python 3.11+,
asyncio + Pydantic v2). Runs on your own cloud/GPU (cPanel) and portable envs
(Termux). **The brain runs LOCALLY — no external API, no keys, nothing leaves
your machine.** (Optional hosted-API presets exist for convenience, but they're
strictly opt-in; the default powerful path is 100% local.)

Roadmap: **Module 1 ✅** · **Module 2 ✅** · **Module 3 ✅** · **Module 4 ✅** ·
Modules 5–6 (auto-verifiers, swarm/sandbox) land next.

## 🌐 One brain for everyone — Central Hub

So your model is powerful for **everyone**, not weak in someone else's browser:
the server hosts ONE brain and every client (web, mobile, other instances)
connects to it. Nobody runs a weak local model — all share the same powerful,
self-improving mind and knowledge.

```bash
pip install fastapi "uvicorn[standard]"
SUPERAI_HUB_MODEL=glm-9b uvicorn engine.hub:app --host 0.0.0.0 --port 8000
```
Endpoints: `POST /chat` (REST, `stream:true` for SSE), `WS /ws` (loss-free
streaming via the Module-3 FlushGate), `GET /health` `/tools` `/soul`.

## 🧠 The powerful brain — 100% local, ZERO API

Intelligence is a **model**, not repo code. Run a real open model IN-PROCESS on
your GPU — nothing is ever sent anywhere:

```python
from engine.providers import local_brain
from engine.two_model import TwoModelSystem

ai = TwoModelSystem(llm=local_brain("glm-9b"))                   # GLM on your GPU, no API
ai = TwoModelSystem(llm=local_brain("coder-7b", load_in_4bit=True))  # less VRAM
```

After you have a GPU:
```bash
pip install torch transformers accelerate       # + bitsandbytes for 4-bit
```

Curated local models (no API, pick by VRAM):

| key | model | notes |
|---|---|---|
| `coder-7b` | Qwen2.5-Coder-7B | best value for code (~16GB fp16 / ~6GB 4-bit) |
| `coder-32b` | Qwen2.5-Coder-32B | strong coding (24GB+ / 4-bit) |
| `glm-9b` | GLM-4-9B | **GLM on one GPU — your "real mind"** |
| `llama-8b` | Llama-3.1-8B | general |

Runs even without a GPU/model for development: an **OfflineProvider** gives
deterministic responses so the whole engine + self-evolution loop is testable
anywhere, no downloads.

<details><summary>Optional hosted-API presets (opt-in, not required)</summary>

If you ever want a cloud model instead of your GPU, `apply_preset(cfg, name,
api_key)` supports `glm` (Zhipu free flash), `groq`, `openrouter`, `openai`,
`ollama` (localhost). This is optional — the local path above needs no API.
</details>

## Module 2 — Task & Agent State Machine

| Class | Role |
|---|---|
| `Task` / `TaskStatus` / `TaskType` | strict lifecycle: pending→running→completed\|failed\|cancelled |
| `TaskManager` | async worker pool, retries, timeouts, `on_event` hook for live sync |
| `SafeBashExecutor` | `local_bash` — timeout, output caps, destructive-command denylist, confined cwd |
| `DreamEngine` | `dream` — autonomous idle self-review of generated tools → soul memory |

`local_agent` tasks run the Module-1 `TwoModelSystem`. Full process isolation
arrives with Module 6's sandbox (which replaces `SafeBashExecutor`).

## Module 3 — Network Sync & Flush Gate

| Class | Role |
|---|---|
| `SerialBatchEventUploader` | monotonic seq, ordered outbox, batch flush, retry-until-acked, reconnect replay — **zero data loss** |
| `FlushGate` | backpressure (`emit()` awaits when the outbox is full) + size/time flush timing |
| `InboundChannel` | frontend→backend delivery, in-order + exactly-once (dedup) |
| `websocket_sink` / `sse_sink` | thin adapters for WebSocket or SSE transports |

Transport-agnostic: give `FlushGate` any async `sink(batch)->bool`.

## Module 4 — Memory Compaction & Context Collapse

`microcompact_messages` / `MemoryCompactor` prevent token overflow: system
prompt pinned, recent working memory kept verbatim, and older verbose tool/
terminal output collapsed (head+tail + error/signal lines) — summarized by the
LLM when online, deterministically offline. `find_compact_boundary` marks where
"recent" begins; the result is guaranteed under `ContextBudget.max_tokens`.

## Tests (all fully offline)
```bash
python3 engine/tests/test_module1.py   # two-model + soul       (8)
python3 engine/tests/test_module2.py   # task machine + dream    (10)
python3 engine/tests/test_module3.py   # sync/flush gate         (5)
python3 engine/tests/test_module4.py   # memory compaction       (8)
```

## Module 1 — Two-Model System & Soul Engine

| File | Role |
|---|---|
| `config.py` | `EngineConfig` / `ModelConfig` — env-driven, no extra deps |
| `models.py` | Pydantic domain models (Message, LLMResponse, GeneratedTool…) |
| `llm.py` | Async `LLMClient` — OpenAI-compatible provider + offline fallback, retries, streaming |
| `soul.py` | `SoulManager` — reads/rewrites `soul.md`, auto-evolves from history |
| `two_model.py` | `TwoModelSystem` — Chat + Tool-Maker brains, `ModelRouter`, `ToolRegistry` |

### Quick start
```bash
pip install -r engine/requirements.txt
export SUPERAI_API_KEY="gsk_...        # Groq free tier (or any OpenAI-compatible)
export SUPERAI_API_BASE="https://api.groq.com/openai/v1"
export SUPERAI_CHAT_MODEL="llama-3.3-70b-versatile"
```
```python
import asyncio
from engine.two_model import TwoModelSystem

async def main():
    ai = TwoModelSystem()                     # reads SUPERAI_* env
    print(await ai.handle("who are you?"))    # -> chat
    print(await ai.handle("build a tool to parse CSV"))  # -> generates a Python tool
    await ai.aclose()

asyncio.run(main())
```
Without a GPU/model it runs in **offline mode** (deterministic responses + the
full soul-evolution loop) so you can develop and test anywhere.
