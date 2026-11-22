import os
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEVICE: str = "auto"  # "auto", "cuda", "cpu"
    CORS_ORIGINS: str = "*"
    MAX_TEXT_LENGTH: int = 5000
    MODEL_CACHE_DIR: str = "./models_cache"
    LOG_LEVEL: str = "INFO"
    SAMPLE_RATE: int = 22050

    model_config = SettingsConfigDict(env_file=".env", extra="allow")

    @property
    def cors_origins_list(self) -> List[str]:
        if self.CORS_ORIGINS.strip() == "*":
            return ["*"]
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

settings = Settings()

