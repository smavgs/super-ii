from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded only from environment or an ignored .env file."""

    model_config = SettingsConfigDict(
        env_prefix="SUPERII_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    host: str = "127.0.0.1"
    allow_wildcard_bind: bool = False
    port: int = Field(default=8788, ge=1, le=65535)
    storage_root: Path = Path("data")
    database_url: SecretStr | None = None
    runtime_token: SecretStr | None = None
    max_upload_bytes: int = Field(default=10 * 1024**3, ge=1)
    clamav_command: str = "clamdscan"
    clamav_config_file: Path | None = None
    gitleaks_command: str = "gitleaks"
    llama_cli_command: str = "llama-cli"
    llama_server_command: str = "llama-server"
    public_base_url: str = "http://127.0.0.1:8788"
    spaces_image: str = "superii/gradio-space:0.1.0"
    semantic_search_enabled: bool = False
    vllm_enabled: bool = False
    space_cpu_limit: float = Field(default=2.0, gt=0)
    space_memory_limit: str = "4g"
    space_pids_limit: int = Field(default=256, ge=32)
    command_timeout_seconds: int = Field(default=900, ge=1)

    @field_validator("storage_root")
    @classmethod
    def absolute_storage_root(cls, value: Path) -> Path:
        return value.expanduser().resolve()

    @model_validator(mode="after")
    def block_accidental_wildcard_bind(self) -> Settings:
        # Container binding needs an explicit opt-in; host ports still bind localhost.
        if self.host in {"0.0.0.0", "::"} and not self.allow_wildcard_bind:
            raise ValueError("wildcard binding requires SUPERII_ALLOW_WILDCARD_BIND=true")
        return self

    def require_database_url(self) -> str:
        if self.database_url is None or not self.database_url.get_secret_value():
            raise RuntimeError("SUPERII_DATABASE_URL is required for repository operations")
        return self.database_url.get_secret_value()

    def require_runtime_token(self) -> str:
        if self.runtime_token is None or len(self.runtime_token.get_secret_value()) < 32:
            raise RuntimeError("SUPERII_RUNTIME_TOKEN must contain at least 32 characters")
        return self.runtime_token.get_secret_value()


@lru_cache
def get_settings() -> Settings:
    return Settings()
