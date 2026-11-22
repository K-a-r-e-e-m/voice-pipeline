import os
import io
import re
import time
import logging
import asyncio
from typing import AsyncGenerator, Tuple, Optional, List
import numpy as np
import torch
import soundfile as sf
from num2words import num2words
from app.config import settings

logger = logging.getLogger("TTS_SERVICE")
logging.basicConfig(level=settings.LOG_LEVEL, format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s")

_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")
HARAKAT = re.compile(r"[ً-ْٰـ]")

def preprocess_egyptian_text(text: str) -> str:
    """
    Preprocesses text specifically for Lahgtna-OmniVoice Egyptian v3:
    1. Converts Arabic and English digits to spoken Arabic words (e.g. 25 -> خمسة وعشرون).
    2. Strips Latin/English words.
    3. Strips Harakat / MSA diacritics to ensure pure natural colloquial speech.
    4. Normalizes Alef Maksura to Yaa.
    """
    if not text:
        return ""
    # 1. Digits translation
    t = text.translate(_DIGITS)
    t = re.sub(r"\d+", lambda m: " " + num2words(int(m.group()), lang="ar") + " ", t)
    # 2. Remove English letters
    t = re.sub(r"[A-Za-z]+", " ", t)
    # 3. Strip MSA diacritics (v3 is trained on raw colloquial text)
    t = HARAKAT.sub("", t).replace("ى", "ي")
    # 4. Normalize whitespace
    return re.sub(r"\s+", " ", t).strip()

def split_clauses(text: str) -> List[str]:
    """
    Splits text into clauses and sentences based on punctuation to prevent drift
    and enable seamless streaming per sentence.
    """
    out, cur = [], ""
    for p in re.split(r"([،؛\.؟!\n]+)", text):
        cur += p
        if re.search(r"[،؛\.؟!\n]", p):
            if cur.strip():
                out.append(cur.strip())
            cur = ""
    if cur.strip():
        out.append(cur.strip())
    return out if out else [text]

class TTSService:
    _instance: Optional['TTSService'] = None

    def __init__(self):
        self.sample_rate = 24000
        self.model = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.dtype = torch.float16 if torch.cuda.is_available() else torch.float32
        self.ref_audio_path = None
        self.ref_text = "كان العمل التطوعي واللي لما تفتح الباب بس ليه الناس"
        self.is_loaded = False
        self.lock = asyncio.Lock()
        self.model_repo = "ehabnegm/lahgtna-omnivoice-egyptian-v3"
        self.local_model_dir = os.path.abspath(os.path.join(settings.MODEL_CACHE_DIR, "lahgtna-omnivoice-egyptian-v3"))

    @classmethod
    def get_instance(cls) -> 'TTSService':
        if cls._instance is None:
            cls._instance = TTSService()
        return cls._instance

    def load_models(self):
        """Loads Lahgtna OmniVoice Egyptian v3 model."""
        if self.is_loaded:
            return

        logger.info(f"[INFO] Initializing Lahgtna-OmniVoice Egyptian v3 on {self.device} ({self.dtype})...")
        try:
            from omnivoice.models.omnivoice import OmniVoice

            # Check if local files are fully downloaded (size > 2GB), otherwise wait or load from HF hub
            safetensors_path = os.path.join(self.local_model_dir, "model.safetensors")
            is_local_ready = (
                os.path.exists(self.local_model_dir) 
                and os.path.exists(safetensors_path) 
                and os.path.getsize(safetensors_path) > 2000 * 1024 * 1024
            )
            model_source = self.local_model_dir if is_local_ready else self.model_repo

            logger.info(f"[INFO] Loading model from: {model_source} ...")
            self.model = OmniVoice.from_pretrained(
                model_source,
                device_map=self.device,
                dtype=self.dtype
            )

            # Locate reference audio clip
            ref_local = os.path.join(self.local_model_dir, "reference.wav")
            if os.path.exists(ref_local):
                self.ref_audio_path = ref_local
            else:
                from huggingface_hub import hf_hub_download
                self.ref_audio_path = hf_hub_download(self.model_repo, "reference.wav")

            self.is_loaded = True
            logger.info(f"[SUCCESS] Lahgtna-OmniVoice Egyptian v3 loaded successfully (Ref Audio: {self.ref_audio_path})")
        except Exception as e:
            logger.error(f"[ERROR] Failed to load Lahgtna OmniVoice: {e}", exc_info=True)
            self.is_loaded = False

    def get_sample_rate(self, voice: str = "") -> int:
        return self.sample_rate

    def _infer_clause(self, clause_text: str, num_steps: int = 8, speed: float = 1.0) -> np.ndarray:
        """Runs synchronous inference for a single clause."""
        if self.model is None:
            self.load_models()

        if self.model is None:
            raise RuntimeError("OmniVoice model is not loaded.")

        clean_text = preprocess_egyptian_text(clause_text)
        if not clean_text:
            return np.array([], dtype=np.float32)

        # Generate waveform
        audio_tensor = self.model.generate(
            text=clean_text,
            language="arz",
            ref_audio=self.ref_audio_path,
            ref_text=self.ref_text,
            num_step=num_steps
        )[0]

        # Convert to numpy float32
        if isinstance(audio_tensor, torch.Tensor):
            audio_np = audio_tensor.detach().cpu().numpy()
        else:
            audio_np = np.asarray(audio_tensor, dtype=np.float32)

        # Apply speed adjustment if needed
        if abs(speed - 1.0) > 0.05 and len(audio_np) > 0:
            target_len = int(len(audio_np) / max(0.5, min(2.0, speed)))
            indices = np.linspace(0, len(audio_np) - 1, target_len)
            audio_np = np.interp(indices, np.arange(len(audio_np)), audio_np)

        # Normalize volume peak
        max_val = np.max(np.abs(audio_np)) if len(audio_np) > 0 else 0
        if max_val > 0:
            audio_np = audio_np / max(max_val, 1.0) * 0.95

        return audio_np

    async def generate_stream(
        self,
        text: str,
        voice: str = "lahgtna-v3-balanced",
        speed: float = 1.0,
        pitch: float = 1.0
    ) -> AsyncGenerator[Tuple[bytes, int, dict], None]:
        """
        Processes Egyptian text clause-by-clause through Lahgtna-OmniVoice v3
        and streams 24kHz 16-bit PCM chunks in real-time.
        """
        # Determine number of diffusion steps based on voice/mode
        if "fast" in voice.lower():
            num_steps = 4
        elif "studio" in voice.lower() or "hq" in voice.lower():
            num_steps = 16
        else:
            num_steps = 8  # Recommended balanced mode (~0.5s latency)

        clauses = split_clauses(text)
        logger.info(f"[STREAM] Processing {len(clauses)} clauses with Lahgtna-OmniVoice (Steps: {num_steps}, Speed: {speed}x)")

        async with self.lock:
            for idx, clause in enumerate(clauses):
                cleaned = preprocess_egyptian_text(clause)
                if not cleaned:
                    continue

                start_t = time.time()
                # Run inference in worker thread
                audio_np = await asyncio.to_thread(self._infer_clause, cleaned, num_steps, speed)
                infer_ms = (time.time() - start_t) * 1000

                if len(audio_np) == 0:
                    continue

                # Convert float32 [-1.0, 1.0] to 16-bit PCM bytes
                pcm_data = (audio_np * 32767.0).clip(-32768, 32767).astype(np.int16).tobytes()

                # Stream out in sub-chunks (~85ms per packet) for smooth browser playback
                subchunk_size = 4096 * 2  # 8192 bytes = 4096 samples = ~170ms at 24kHz
                total_sub = max(1, (len(pcm_data) + subchunk_size - 1) // subchunk_size)

                for s_i in range(0, len(pcm_data), subchunk_size):
                    chunk_bytes = pcm_data[s_i:s_i + subchunk_size]
                    meta = {
                        "clause_index": idx,
                        "total_clauses": len(clauses),
                        "clause_text": cleaned,
                        "subchunk_index": s_i // subchunk_size,
                        "total_subchunks": total_sub,
                        "inference_time_ms": infer_ms,
                        "bytes_len": len(chunk_bytes)
                    }
                    yield chunk_bytes, self.sample_rate, meta
                    await asyncio.sleep(0.01)

    def get_info(self) -> dict:
        return {
            "model_loaded": self.is_loaded,
            "engine": "Lahgtna-OmniVoice Egyptian v3 (لهجتنا أومني فويس)",
            "model_repo": self.model_repo,
            "device": f"{self.device.upper()} ({torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU'})",
            "available_voices": [
                "lahgtna-v3-balanced (لهجتنا أومني فويس - النمط المتوازن 8 خطوات)",
                "lahgtna-v3-fast (لهجتنا أومني فويس - فائق السرعة 4 خطوات)",
                "lahgtna-v3-studio (لهجتنا أومني فويس - جودة استوديو 16 خطوة)"
            ],
            "sample_rate": self.sample_rate,
        }
