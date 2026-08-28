from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class CreateRevisionRequest(BaseModel):
    parent_revision_id: UUID | None = None
    message: str = Field(default="", max_length=2000)
    created_by: str = Field(min_length=1, max_length=255)


class InspectRevisionRequest(BaseModel):
    kind: Literal["model", "dataset", "space"]


class TokenizeRequest(BaseModel):
    text: str = Field(max_length=100_000)
    add_special_tokens: bool = True


class LlamaGenerateRequest(BaseModel):
    model_path: str | None = Field(default=None, max_length=1024)
    prompt: str = Field(min_length=1, max_length=100_000)
    max_tokens: int = Field(default=256, ge=1, le=4096)
    temperature: float = Field(default=0.7, ge=0, le=2)
    top_p: float = Field(default=0.95, gt=0, le=1)
    seed: int = Field(default=-1, ge=-1)


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str = Field(min_length=1, max_length=100_000)


class LlamaChatRequest(BaseModel):
    model_path: str | None = Field(default=None, max_length=1024)
    messages: list[ChatMessage] = Field(min_length=1, max_length=100)
    max_tokens: int = Field(default=256, ge=1, le=4096)
    temperature: float = Field(default=0.7, ge=0, le=2)
    top_p: float = Field(default=0.95, gt=0, le=1)
    seed: int = Field(default=-1, ge=-1)


class DiffusionGenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=5000)
    negative_prompt: str | None = Field(default=None, max_length=5000)
    steps: int = Field(default=30, ge=1, le=100)
    guidance_scale: float = Field(default=7.5, ge=0, le=30)
    width: int = Field(default=512, ge=128, le=2048, multiple_of=8)
    height: int = Field(default=512, ge=128, le=2048, multiple_of=8)
    seed: int = Field(default=0, ge=0, le=2**32 - 1)
