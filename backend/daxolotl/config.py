"""App configuration loaded from env / .env."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="DAXOLOTL_", extra="ignore")

    data_dir: Path = Path("./data")
    db_url: str = "sqlite:///./daxolotl.db"


settings = Settings()
