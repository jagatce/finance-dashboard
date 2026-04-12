import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).parent.parent.parent
DB_PATH = os.getenv("DB_PATH", str(BASE_DIR / "finance.db"))
DB_PASSPHRASE = os.getenv("DB_PASSPHRASE", "")  # SQLCipher encryption — leave empty for now
LOGIN_PASSPHRASE = os.getenv("LOGIN_PASSPHRASE", "")  # App login — separate from DB encryption
API_PORT = int(os.getenv("API_PORT", "8000"))
