"""Model-provider presets — flip the 'mind' with one line.

The engine is OpenAI-compatible, so any of these real, powerful models can be
the brain. GLM (Zhipu AI) is a genuinely strong open model family and its
`glm-4-flash` tier is FREE — a great default "real mind" without a GPU.

Usage:
    from engine.config import EngineConfig
    from engine.providers import apply_preset
    cfg = apply_preset(EngineConfig(), "glm", api_key="your_zhipu_key")
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict

from .config import EngineConfig, ModelConfig


@dataclass(frozen=True)
class Preset:
    api_base: str
    chat_model: str
    tool_model: str
    note: str


PRESETS: Dict[str, Preset] = {
    # GLM (Zhipu AI) — real, powerful, and glm-4-flash is free.
    "glm": Preset(
        api_base="https://open.bigmodel.cn/api/paas/v4",
        chat_model="glm-4-flash",           # free tier
        tool_model="glm-4.6",               # stronger for code (paid); swap to glm-4-flash to stay free
        note="GLM by Zhipu AI — glm-4-flash is free. Get a key at bigmodel.cn.",
    ),
    # Groq — free tier, very fast Llama.
    "groq": Preset(
        api_base="https://api.groq.com/openai/v1",
        chat_model="llama-3.3-70b-versatile",
        tool_model="llama-3.3-70b-versatile",
        note="Groq free tier — fast Llama 3.3 70B. Key at console.groq.com.",
    ),
    # OpenRouter — one key, hundreds of models (incl. GLM, Llama, Qwen).
    "openrouter": Preset(
        api_base="https://openrouter.ai/api/v1",
        chat_model="z-ai/glm-4.6",
        tool_model="qwen/qwen-2.5-coder-32b-instruct",
        note="OpenRouter — one key for GLM/Qwen/Llama/etc. Key at openrouter.ai.",
    ),
    # OpenAI.
    "openai": Preset(
        api_base="https://api.openai.com/v1",
        chat_model="gpt-4o-mini",
        tool_model="gpt-4o",
        note="OpenAI — needs a paid key.",
    ),
    # Local Ollama / vLLM — fully offline if you have the hardware.
    "ollama": Preset(
        api_base="http://localhost:11434/v1",
        chat_model="qwen2.5-coder:7b",
        tool_model="qwen2.5-coder:7b",
        note="Local Ollama — free, private, needs a capable machine (no cloud).",
    ),
}


def apply_preset(cfg: EngineConfig, name: str, api_key: str = "") -> EngineConfig:
    """Return a copy of cfg pointed at the named provider."""
    if name not in PRESETS:
        raise ValueError(f"unknown preset '{name}'. Options: {', '.join(PRESETS)}")
    p = PRESETS[name]
    data = cfg.model_dump()
    data["api_base"] = p.api_base
    if api_key:
        data["api_key"] = api_key
    data["chat"] = ModelConfig(**{**cfg.chat.model_dump(), "model": p.chat_model})
    data["tool_maker"] = ModelConfig(**{**cfg.tool_maker.model_dump(), "model": p.tool_model})
    return EngineConfig(**data)


def list_presets() -> str:
    return "\n".join(f"{k:12} → {v.chat_model:28} {v.note}" for k, v in PRESETS.items())
