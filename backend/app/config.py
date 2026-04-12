"""Environment-driven configuration.

Authoritative env var table: `docs/SERVICE_BACKEND.md` §5.
Constants locked by `CLAUDE.md` §5 must match exactly.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration loaded from environment (or .env)."""

    # --- Server ---
    BACKEND_HOST: str = "0.0.0.0"
    BACKEND_PORT: int = 5000

    # --- Storage ---
    SQLITE_PATH: str = "./data/rememberme.db"

    # --- Auth0 ---
    AUTH0_DOMAIN: str
    AUTH0_AUDIENCE: str
    AUTH0_ROLE_CLAIM: str = "https://rememberme.app/role"

    # --- ElevenLabs ---
    ELEVENLABS_API_KEY: str
    ELEVENLABS_DEFAULT_VOICE_ID: str

    # --- LLM (Anthropic) ---
    LLM_API_KEY: str
    LLM_MODEL: str = "claude-sonnet-4-5"

    # --- Recognition tuning (values locked by CLAUDE.md §5) ---
    RECOGNITION_THRESHOLD: float = 0.50
    RECOGNITION_MARGIN: float = 0.05
    CACHE_REFRESH_SECONDS: int = 30

    # --- CORS ---
    CORS_ALLOWED_ORIGINS: str = "http://localhost:3000,http://localhost:3001"

    # --- Dev-mode auth bypass (hackathon only) ---
    # NEVER default to true. See plan §0.5.
    BACKEND_DEV_AUTH_BYPASS: bool = False

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    @property
    def cors_origins(self) -> list[str]:
        """Parse CORS_ALLOWED_ORIGINS into a stripped list."""
        return [o.strip() for o in self.CORS_ALLOWED_ORIGINS.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached singleton accessor. Reads env once per process."""
    return Settings()
