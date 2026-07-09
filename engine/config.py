"""Engine configuration.

Plain-Pydantic settings (no pydantic-settings dependency) loaded from the
environment. Works identically on cPanel and Termux. Two logical model roles
share one OpenAI-compatible endpoint (Groq / OpenAI / Together / local vLLM),
each free to point at a different model id.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class ModelConfig(BaseModel):
    """One logical model role (chat or tool-maker)."""

    model: str = Field(..., description="Model id served by the endpoint")
    temperature: float = Field(0.6, ge=0.0, le=2.0)
    max_tokens: int = Field(1024, gt=0, le=32768)
    top_p: float = Field(1.0, ge=0.0, le=1.0)


class EngineConfig(BaseModel):
    """Root engine configuration."""

    # --- LLM endpoint (OpenAI-compatible) ---
    api_base: str = Field(
        "https://api.groq.com/openai/v1",
        description="Base URL of an OpenAI-compatible chat completions API",
    )
    api_key: str = Field("", description="Bearer key for the endpoint")
    request_timeout: float = Field(90.0, gt=0)
    max_retries: int = Field(3, ge=0, le=8)

    # --- the two models ---
    chat: ModelConfig = Field(
        default_factory=lambda: ModelConfig(model="llama-3.3-70b-versatile", temperature=0.6)
    )
    tool_maker: ModelConfig = Field(
        # low temperature: code must be deterministic & correct
        default_factory=lambda: ModelConfig(model="llama-3.3-70b-versatile", temperature=0.15, max_tokens=2048)
    )

    # --- persistence paths ---
    data_dir: Path = Field(default_factory=lambda: Path(os.getenv("SUPERAI_DATA", "./superai_data")))
    soul_file: str = Field("soul.md")
    tools_dirname: str = Field("generated_tools")

    # --- soul auto-evolution ---
    evolve_every: int = Field(6, ge=1, description="Reflect & rewrite the soul every N interactions")
    history_window: int = Field(40, ge=2, description="Interactions kept in the rolling buffer")

    # --- offline behaviour ---
    allow_offline: bool = Field(True, description="Fall back to a deterministic local provider when no api_key")

    @field_validator("api_base")
    @classmethod
    def _strip_slash(cls, v: str) -> str:
        return v.rstrip("/")

    @property
    def soul_path(self) -> Path:
        return self.data_dir / self.soul_file

    @property
    def tools_dir(self) -> Path:
        return self.data_dir / self.tools_dirname

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.tools_dir.mkdir(parents=True, exist_ok=True)

    @classmethod
    def from_env(cls) -> "EngineConfig":
        """Build config from environment variables (SUPERAI_* overrides)."""
        chat = ModelConfig(
            model=os.getenv("SUPERAI_CHAT_MODEL", "llama-3.3-70b-versatile"),
            temperature=float(os.getenv("SUPERAI_CHAT_TEMP", "0.6")),
            max_tokens=int(os.getenv("SUPERAI_CHAT_MAXTOK", "1024")),
        )
        tool = ModelConfig(
            model=os.getenv("SUPERAI_TOOL_MODEL", chat.model),
            temperature=float(os.getenv("SUPERAI_TOOL_TEMP", "0.15")),
            max_tokens=int(os.getenv("SUPERAI_TOOL_MAXTOK", "2048")),
        )
        return cls(
            api_base=os.getenv("SUPERAI_API_BASE", "https://api.groq.com/openai/v1"),
            api_key=os.getenv("SUPERAI_API_KEY", ""),
            data_dir=Path(os.getenv("SUPERAI_DATA", "./superai_data")),
            chat=chat,
            tool_maker=tool,
        )
