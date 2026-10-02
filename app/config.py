from pathlib import Path
import os

# Base paths
BASE_DIR = Path(__file__).resolve().parent.parent
AUDIO_DIR = BASE_DIR / "audio"
STATIC_DIR = BASE_DIR / "static"

# Ensure audio directory exists
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

# ASR Model configuration
MODEL_ID = os.getenv("ASR_MODEL_ID", "CohereLabs/cohere-transcribe-arabic-07-2026")
TARGET_SAMPLE_RATE = 16000
LANGUAGE = "ar"
MAX_NEW_TOKENS = 256

# VAD default configuration
DEFAULT_SILENCE_TIMEOUT_MS = 500
DEFAULT_MIN_SPEECH_MS = 250
DEFAULT_VAD_THRESHOLD = 0.5
DEFAULT_MAX_UTTERANCE_SECONDS = 25.0
DEFAULT_PRE_ROLL_MS = 300

# Server configuration
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))
