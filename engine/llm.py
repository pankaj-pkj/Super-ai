"""Async LLM client for the two-model system.

`OpenAICompatibleProvider` talks to any OpenAI-compatible /chat/completions
endpoint (Groq, OpenAI, Together, Fireworks, OpenRouter, local vLLM/Ollama).
`OfflineProvider` gives deterministic, dependency-free responses so the whole
engine runs and self-tests without a network or API key.

`LLMClient` picks the provider automatically, applies per-role model settings,
retries with exponential backoff, and supports streaming.
"""

from __future__ import annotations

import asyncio
import json
import re
import time
from typing import AsyncIterator, List, Optional, Protocol

import httpx

from .config import EngineConfig, ModelConfig
from .models import LLMResponse, Message, ModelRole, Role


class LLMError(RuntimeError):
    pass


class LLMProvider(Protocol):
    name: str

    async def complete(self, messages: List[Message], mc: ModelConfig) -> LLMResponse: ...
    def stream(self, messages: List[Message], mc: ModelConfig) -> AsyncIterator[str]: ...


# ---------------------------------------------------------------------------
# Real provider
# ---------------------------------------------------------------------------
class OpenAICompatibleProvider:
    name = "openai_compatible"

    def __init__(self, cfg: EngineConfig):
        self.cfg = cfg
        self._client = httpx.AsyncClient(
            base_url=cfg.api_base,
            timeout=cfg.request_timeout,
            headers={
                "Authorization": f"Bearer {cfg.api_key}",
                "Content-Type": "application/json",
            },
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    def _payload(self, messages: List[Message], mc: ModelConfig, stream: bool) -> dict:
        return {
            "model": mc.model,
            "messages": [m.to_api() for m in messages],
            "temperature": mc.temperature,
            "max_tokens": mc.max_tokens,
            "top_p": mc.top_p,
            "stream": stream,
        }

    async def complete(self, messages: List[Message], mc: ModelConfig) -> LLMResponse:
        t0 = time.time()
        last_exc: Optional[Exception] = None
        for attempt in range(self.cfg.max_retries + 1):
            try:
                r = await self._client.post("/chat/completions", json=self._payload(messages, mc, False))
                if r.status_code == 429 or r.status_code >= 500:
                    raise LLMError(f"retryable HTTP {r.status_code}: {r.text[:200]}")
                r.raise_for_status()
                data = r.json()
                choice = data["choices"][0]
                usage = data.get("usage", {})
                return LLMResponse(
                    text=choice["message"]["content"] or "",
                    model=data.get("model", mc.model),
                    role_used=ModelRole.CHAT,
                    prompt_tokens=usage.get("prompt_tokens", 0),
                    completion_tokens=usage.get("completion_tokens", 0),
                    finish_reason=choice.get("finish_reason", "stop"),
                    latency_ms=int((time.time() - t0) * 1000),
                    provider=self.name,
                )
            except Exception as e:  # noqa: BLE001 — retry any transient failure
                last_exc = e
                if attempt < self.cfg.max_retries:
                    await asyncio.sleep(min(2 ** attempt, 16) + 0.1)
                    continue
                raise LLMError(f"completion failed after {attempt + 1} tries: {e}") from e
        raise LLMError(str(last_exc))

    async def stream(self, messages: List[Message], mc: ModelConfig) -> AsyncIterator[str]:
        async with self._client.stream(
            "POST", "/chat/completions", json=self._payload(messages, mc, True)
        ) as r:
            r.raise_for_status()
            async for line in r.aiter_lines():
                if not line or not line.startswith("data:"):
                    continue
                chunk = line[5:].strip()
                if chunk == "[DONE]":
                    break
                try:
                    delta = json.loads(chunk)["choices"][0]["delta"].get("content")
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue
                if delta:
                    yield delta


# ---------------------------------------------------------------------------
# Offline deterministic provider (no network) — keeps the engine fully runnable
# ---------------------------------------------------------------------------
class OfflineProvider:
    name = "offline"

    async def complete(self, messages: List[Message], mc: ModelConfig) -> LLMResponse:
        text = self._synthesize(messages, mc)
        return LLMResponse(
            text=text, model=f"offline:{mc.model}", role_used=ModelRole.CHAT,
            prompt_tokens=sum(len(m.content) // 4 for m in messages),
            completion_tokens=len(text) // 4, latency_ms=1, provider=self.name,
        )

    async def stream(self, messages: List[Message], mc: ModelConfig) -> AsyncIterator[str]:
        for word in self._synthesize(messages, mc).split(" "):
            yield word + " "
            await asyncio.sleep(0)

    def _synthesize(self, messages: List[Message], mc: ModelConfig) -> str:
        user = next((m.content for m in reversed(messages) if m.role == Role.USER), "")
        sys = " ".join(m.content for m in messages if m.role == Role.SYSTEM)
        # Tool-maker requests must return runnable code so the pipeline works offline.
        if "tool-maker" in sys.lower() or "return only python" in sys.lower() or mc.temperature <= 0.2:
            return self._offline_tool(user)
        return (
            f"[offline] I understood: \"{user[:160]}\". "
            "Connect an API key (Groq free tier) to get full model answers — "
            "the engine and soul evolution work either way."
        )

    def _offline_tool(self, task: str) -> str:
        safe = re.sub(r"[^a-z0-9_]", "_", task.lower())[:40] or "task"
        return (
            "```python\n"
            f'"""Auto-generated offline stub for: {task[:80]}"""\n\n'
            "def run(**kwargs):\n"
            f'    """Offline placeholder — connect an LLM for real synthesis."""\n'
            f'    return {{"tool": "{safe}", "status": "offline_stub", "args": kwargs}}\n'
            "```"
        )


# ---------------------------------------------------------------------------
# Client facade
# ---------------------------------------------------------------------------
class LLMClient:
    def __init__(self, cfg: EngineConfig, provider: Optional[LLMProvider] = None):
        self.cfg = cfg
        if provider is not None:
            self.provider = provider
        elif cfg.api_key:
            self.provider = OpenAICompatibleProvider(cfg)
        elif cfg.allow_offline:
            self.provider = OfflineProvider()
        else:
            raise LLMError("no api_key set and allow_offline=False")

    @property
    def online(self) -> bool:
        return self.provider.name != "offline"

    def _mc(self, role: ModelRole) -> ModelConfig:
        return self.cfg.tool_maker if role == ModelRole.TOOL_MAKER else self.cfg.chat

    async def complete(self, messages: List[Message], role: ModelRole = ModelRole.CHAT) -> LLMResponse:
        resp = await self.provider.complete(messages, self._mc(role))
        resp.role_used = role
        return resp

    def stream(self, messages: List[Message], role: ModelRole = ModelRole.CHAT) -> AsyncIterator[str]:
        return self.provider.stream(messages, self._mc(role))

    async def aclose(self) -> None:
        close = getattr(self.provider, "aclose", None)
        if close:
            await close()
