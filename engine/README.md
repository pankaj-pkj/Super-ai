# Super AI Engine

Autonomous, self-improving AI software-engineer backend (Python 3.11+,
asyncio + Pydantic v2). Runs on cloud (cPanel) and portable envs (Termux).

Roadmap: **Module 1 ✅** · **Module 2 ✅** · Modules 3–6 (sync/flush gate,
memory compaction, auto-verifiers, swarm/sandbox) land next.

## The "mind" — plug in a real model (GLM / Groq / …)

Intelligence is a **model you call**, not code you copy. The engine is
OpenAI-compatible, so switch the brain in one line via `engine/providers.py`:

```python
from engine.config import EngineConfig
from engine.providers import apply_preset
from engine.two_model import TwoModelSystem

cfg = apply_preset(EngineConfig(), "glm", api_key="your_zhipu_key")  # glm-4-flash is FREE
ai = TwoModelSystem(cfg)
```

Presets: `glm` (Zhipu — free flash tier), `groq` (free Llama 3.3 70B),
`openrouter` (GLM/Qwen/Llama with one key), `openai`, `ollama` (local).
Run `python3 -c "from engine.providers import list_presets; print(list_presets())"`.

## Module 2 — Task & Agent State Machine

| Class | Role |
|---|---|
| `Task` / `TaskStatus` / `TaskType` | strict lifecycle: pending→running→completed\|failed\|cancelled |
| `TaskManager` | async worker pool, retries, timeouts, `on_event` hook for live sync |
| `SafeBashExecutor` | `local_bash` — timeout, output caps, destructive-command denylist, confined cwd |
| `DreamEngine` | `dream` — autonomous idle self-review of generated tools → soul memory |

`local_agent` tasks run the Module-1 `TwoModelSystem`. Full process isolation
arrives with Module 6's sandbox (which replaces `SafeBashExecutor`).

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
Without an API key it runs in **offline mode** (deterministic responses + the
full soul-evolution loop) so you can develop and test anywhere.

### Test
```bash
python3 engine/tests/test_module1.py   # 8 checks, fully offline
```
