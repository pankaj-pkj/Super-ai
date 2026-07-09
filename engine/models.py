"""Shared Pydantic domain models for the engine."""

from __future__ import annotations

import time
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class Role(str, Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    TOOL = "tool"


class ModelRole(str, Enum):
    """Which of the two brains handles a request."""
    CHAT = "chat"
    TOOL_MAKER = "tool_maker"


class Message(BaseModel):
    role: Role
    content: str
    name: Optional[str] = None

    def to_api(self) -> Dict[str, Any]:
        d: Dict[str, Any] = {"role": self.role.value, "content": self.content}
        if self.name:
            d["name"] = self.name
        return d


class LLMResponse(BaseModel):
    text: str
    model: str
    role_used: ModelRole
    prompt_tokens: int = 0
    completion_tokens: int = 0
    finish_reason: str = "stop"
    latency_ms: int = 0
    provider: str = "openai_compatible"

    @property
    def total_tokens(self) -> int:
        return self.prompt_tokens + self.completion_tokens


class Interaction(BaseModel):
    """One user→assistant exchange, fed to the soul's reflection loop."""
    user: str
    assistant: str
    role_used: ModelRole = ModelRole.CHAT
    at: float = Field(default_factory=time.time)


class GeneratedTool(BaseModel):
    """A Python tool synthesised by the Tool-Maker model."""
    name: str
    description: str
    language: str = "python"
    code: str
    entrypoint: str = "run"
    created_at: float = Field(default_factory=time.time)
    source_task: str = ""
    filename: Optional[str] = None

    def signature(self) -> str:
        return f"{self.name}.{self.entrypoint}()  # {self.description}"


class RouteDecision(BaseModel):
    role: ModelRole
    confidence: float = Field(0.5, ge=0.0, le=1.0)
    reason: str = ""
