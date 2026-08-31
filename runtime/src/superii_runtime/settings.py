from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

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
    transfer_url: str = "http://127.0.0.1:8790"
    transfer_token: SecretStr | None = None
    transfer_max_chunk_bytes: int = Field(default=32 * 1024**2, ge=1, le=32 * 1024**2)
    max_upload_bytes: int = Field(default=10 * 1024**3, ge=1)
    clamav_command: str = "clamdscan"
    clamav_config_file: Path | None = None
    gitleaks_command: str = "gitleaks"
    llama_cli_command: str = "llama-cli"
    llama_server_command: str = "llama-server"
    llama_server_context_size: int = Field(default=4096, ge=512, le=131_072)
    llama_server_parallel: int = Field(default=2, ge=1, le=8)
    llama_server_idle_seconds: int = Field(default=900, ge=60, le=86_400)
    llama_server_start_timeout_seconds: int = Field(default=120, ge=10, le=600)
    public_base_url: str = "http://127.0.0.1:8788"
    spaces_image: str = "superii/gradio-space:0.1.0"
    notebook_image: str = "superii/notebook-executor:0.1.0"
    notebook_cpu_limit: float = Field(default=1.0, gt=0, le=4)
    notebook_memory_bytes: int = Field(default=2 * 1024**3, ge=256 * 1024**2, le=16 * 1024**3)
    notebook_pids_limit: int = Field(default=128, ge=16, le=512)
    notebook_timeout_seconds: int = Field(default=900, ge=5, le=3600)
    notebook_cell_timeout_seconds: int = Field(default=120, ge=1, le=900)
    notebook_result_max_bytes: int = Field(default=10 * 1024**2, ge=1024, le=50 * 1024**2)
    semantic_search_enabled: bool = False
    vllm_enabled: bool = False
    space_cpu_limit: float = Field(default=2.0, gt=0)
    space_memory_limit: str = "4g"
    space_pids_limit: int = Field(default=256, ge=32)
    space_start_timeout_seconds: int = Field(default=60, ge=5, le=300)
    artifact_retention_seconds: int = Field(default=86_400, ge=300, le=604_800)
    command_timeout_seconds: int = Field(default=900, ge=1)

    @field_validator("storage_root")
    @classmethod
    def absolute_storage_root(cls, value: Path) -> Path:
        return value.expanduser().resolve()

    @field_validator("transfer_url")
    @classmethod
    def loopback_transfer_url(cls, value: str) -> str:
        parsed = urlsplit(value.rstrip("/"))
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("SUPERII_TRANSFER_URL must use loopback HTTP")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("SUPERII_TRANSFER_URL cannot contain credentials, query, or fragment")
        return value.rstrip("/")

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

    def require_transfer_token(self) -> str:
        configured = self.transfer_token or self.runtime_token
        if configured is None or len(configured.get_secret_value()) < 32:
            raise RuntimeError(
                "SUPERII_TRANSFER_TOKEN (or SUPERII_RUNTIME_TOKEN) must contain "
                "at least 32 characters"
            )
        return configured.get_secret_value()


@lru_cache
def get_settings() -> Settings:
    return Settings()
