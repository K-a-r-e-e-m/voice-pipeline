import asyncio
import logging
import time
from typing import Dict, Any, Optional
import numpy as np
# pyrefly: ignore [missing-import]
import torch
from transformers import AutoProcessor, CohereAsrForConditionalGeneration

from app.config import MODEL_ID, TARGET_SAMPLE_RATE, LANGUAGE, MAX_NEW_TOKENS

logger = logging.getLogger("asr_service")


class ASRService:
    """Singleton service for Arabic ASR inference.
    
    Loads CohereAsrForConditionalGeneration model once onto the GPU, keeps it resident,
    and coordinates synchronous GPU generation with an asyncio lock.
    """

    _instance: Optional["ASRService"] = None

    def __init__(self):
        self.processor: Optional[AutoProcessor] = None
        self.model: Optional[CohereAsrForConditionalGeneration] = None
        self.device: Optional[torch.device] = None
        self.dtype: Optional[torch.dtype] = None
        self.model_lock = asyncio.Lock()
        self.is_loaded = False
        self.startup_time_sec: float = 0.0
        self.warmup_time_sec: float = 0.0

    @classmethod
    def get_instance(cls) -> "ASRService":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def load_model(self) -> None:
        """Loads processor and model onto GPU once."""
        if self.is_loaded:
            return

        logger.info(f"Loading ASR processor from '{MODEL_ID}'...")
        start_load = time.perf_counter()
        self.processor = AutoProcessor.from_pretrained(MODEL_ID)

        logger.info("Loading ASR model weights...")
        self.model = CohereAsrForConditionalGeneration.from_pretrained(
            MODEL_ID,
            device_map="auto",
        )
        self.device = self.model.device
        self.dtype = self.model.dtype

        self.startup_time_sec = time.perf_counter() - start_load
        self.is_loaded = True
        logger.info(
            f"ASR Model loaded successfully in {self.startup_time_sec:.2f}s on {self.device} with dtype {self.dtype}."
        )

        self._warmup()

    def _warmup(self) -> None:
        """Executes a quick 1-second dummy audio inference to warm up CUDA kernels."""
        try:
            logger.info("Performing ASR GPU warm-up...")
            warmup_audio = np.zeros(TARGET_SAMPLE_RATE, dtype=np.float32)
            start_warmup = time.perf_counter()
            self._run_inference_raw(warmup_audio)
            self.warmup_time_sec = time.perf_counter() - start_warmup
            logger.info(f"Warm-up complete in {self.warmup_time_sec:.3f}s.")
        except Exception as e:
            logger.warning(f"ASR warm-up encountered an exception: {e}")

    def _run_inference_raw(self, audio_array: np.ndarray) -> str:
        """Synchronous inference function running on the GPU."""
        inputs = self.processor(
            audio_array,
            sampling_rate=TARGET_SAMPLE_RATE,
            return_tensors="pt",
            language=LANGUAGE,
        )

        # Move tensors to correct device and dtype (mirroring test_inference.py)
        for key, value in inputs.items():
            if torch.is_tensor(value):
                if value.is_floating_point():
                    inputs[key] = value.to(device=self.device, dtype=self.dtype)
                else:
                    inputs[key] = value.to(self.device)

        if torch.cuda.is_available() and self.device.type == "cuda":
            torch.cuda.synchronize()

        outputs = self.model.generate(
            **inputs,
            max_new_tokens=MAX_NEW_TOKENS,
        )

        if torch.cuda.is_available() and self.device.type == "cuda":
            torch.cuda.synchronize()

        text = self.processor.decode(
            outputs[0],
            skip_special_tokens=True,
        )
        return text.strip()

    async def transcribe(self, audio_array: np.ndarray) -> Dict[str, Any]:
        """Asynchronously transcribes audio with lock serialization and accurate GPU timing.
        
        Args:
            audio_array: 1D float32 numpy array normalized to [-1.0, 1.0] at 16000 Hz.
            
        Returns:
            Dictionary containing transcription text and performance metrics.
        """
        if not self.is_loaded:
            raise RuntimeError("ASR model is not loaded.")

        if len(audio_array) == 0:
            return {
                "text": "",
                "duration_seconds": 0.0,
                "inference_time_seconds": 0.0,
                "rtf": 0.0,
                "speed_factor": 0.0,
            }

        duration_seconds = len(audio_array) / TARGET_SAMPLE_RATE

        async with self.model_lock:
            # Run blocking PyTorch generation in a background thread to avoid stalling the event loop
            start_time = time.perf_counter()
            text = await asyncio.to_thread(self._run_inference_raw, audio_array)
            inference_time = time.perf_counter() - start_time

        rtf = inference_time / duration_seconds if duration_seconds > 0 else 0.0
        speed_factor = duration_seconds / inference_time if inference_time > 0 else 0.0

        return {
            "text": text,
            "duration_seconds": round(duration_seconds, 3),
            "inference_time_seconds": round(inference_time, 3),
            "rtf": round(rtf, 3),
            "speed_factor": round(speed_factor, 2),
        }
