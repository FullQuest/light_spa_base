import os

class Settings:
    SECRET_KEY: str = os.environ["SECRET_KEY"]
    ALGORITHM: str = "HS256"
    DOCUMENTS_DIR: str = os.getenv("DOCUMENTS_DIR", "/api/storage/documents")
    # Можно поменять значение по умолчанию здесь или задать через окружение.
    REGISTRATION_ENABLED: bool = os.getenv("REGISTRATION_ENABLED", "true").lower() in ("true", "1")
    # Используются при создании аккаунта, не сбрасывают существующий пароль.
    ADMIN_LOGIN: str = os.getenv("ADMIN_LOGIN", "admin1")
    ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "12345678")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(
        os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440")
    )

settings = Settings()

