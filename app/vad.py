import collections
import logging
import time
from typing import Callable, Optional, List
import numpy as np
import torch
import silero_vad

from app.config import (
    TARGET_SAMPLE_RATE,
    DEFAULT_SILENCE_TIMEOUT_MS,
    DEFAULT_MIN_SPEECH_MS,
    DEFAULT_VAD_THRESHOLD,
    DEFAULT_MAX_UTTERANCE_SECONDS,
    DEFAULT_PRE_ROLL_MS,
)

logger = logging.getLogger("vad_service")

# Silero VAD requires chunks of exactly 512 samples at 16000 Hz (32 ms)
VAD_FRAME_SIZE = 512
FRAME_DURATION_MS = (VAD_FRAME_SIZE / TARGET_SAMPLE_RATE) * 1000.0  # 32 ms


class VADModelSingleton:
    """Singleton holder for the Silero VAD TorchScript model on CPU."""

    _model = None

    @classmethod
    def get_model(cls):
        if cls._model is None:
            logger.info("Loading Silero VAD model onto CPU...")
            cls._model = silero_vad.load_silero_vad()
            cls._model.eval()
        return cls._model


class VADSegmenter:
    """Stream audio buffer and utterance segmenter using Silero VAD."""

    def __init__(
        self,
        silence_timeout_ms: float = DEFAULT_SILENCE_TIMEOUT_MS,
        min_speech_ms: float = DEFAULT_MIN_SPEECH_MS,
        threshold: float = DEFAULT_VAD_THRESHOLD,
        max_utterance_seconds: float = DEFAULT_MAX_UTTERANCE_SECONDS,
        pre_roll_ms: float = DEFAULT_PRE_ROLL_MS,
        on_speech_start: Optional[Callable[[], None]] = None,
        on_speech_end: Optional[Callable[[np.ndarray, float], None]] = None,
    ):
        self.silence_timeout_ms = silence_timeout_ms
        self.min_speech_ms = min_speech_ms
        self.threshold = threshold
        self.max_utterance_seconds = max_utterance_seconds
        self.pre_roll_ms = pre_roll_ms

        self.on_speech_start = on_speech_start
        self.on_speech_end = on_speech_end

        self.model = VADModelSingleton.get_model()

        # State variables
        self.is_speaking = False
        self.current_speech_chunks: List[np.ndarray] = []
        self.consecutive_speech_ms = 0.0
        self.consecutive_silence_ms = 0.0
        self.speech_start_time: float = 0.0
        self.pending_raw_samples = np.empty(0, dtype=np.float32)

        # Pre-roll ring buffer to prevent cutting initial phonemes
        max_pre_roll_samples = int((self.pre_roll_ms / 1000.0) * TARGET_SAMPLE_RATE)
        self.pre_roll_buffer = collections.deque(maxlen=max_pre_roll_samples)

    def update_settings(
        self,
        silence_timeout_ms: Optional[float] = None,
        min_speech_ms: Optional[float] = None,
        threshold: Optional[float] = None,
        max_utterance_seconds: Optional[float] = None,
    ):
        if silence_timeout_ms is not None:
            self.silence_timeout_ms = float(silence_timeout_ms)
        if min_speech_ms is not None:
            self.min_speech_ms = float(min_speech_ms)
        if threshold is not None:
            self.threshold = float(threshold)
        if max_utterance_seconds is not None:
            self.max_utterance_seconds = float(max_utterance_seconds)

    def reset(self):
        """Resets the state machine without reallocating resources."""
        self.is_speaking = False
        self.current_speech_chunks.clear()
        self.consecutive_speech_ms = 0.0
        self.consecutive_silence_ms = 0.0
        self.speech_start_time = 0.0
        self.pending_raw_samples = np.empty(0, dtype=np.float32)
        self.pre_roll_buffer.clear()
        try:
            self.model.reset_states()
        except Exception:
            pass

    def process_audio_chunk(self, audio_chunk: np.ndarray):
        """Processes incoming float32 16kHz audio chunk of arbitrary length."""
        if len(audio_chunk) == 0:
            return

        # Append to pending samples buffer
        self.pending_raw_samples = np.concatenate([self.pending_raw_samples, audio_chunk])

        # Slice into 512-sample frames for VAD
        while len(self.pending_raw_samples) >= VAD_FRAME_SIZE:
            frame = self.pending_raw_samples[:VAD_FRAME_SIZE]
            self.pending_raw_samples = self.pending_raw_samples[VAD_FRAME_SIZE:]
            self._process_frame(frame)

    def _process_frame(self, frame: np.ndarray):
        tensor_frame = torch.from_numpy(frame)
        with torch.no_grad():
            speech_prob = float(self.model(tensor_frame, TARGET_SAMPLE_RATE).item())

        is_speech_frame = speech_prob >= self.threshold

        if not self.is_speaking:
            # Maintain pre-roll audio prior to speech onset
            self.pre_roll_buffer.extend(frame.tolist())

            if is_speech_frame:
                self.consecutive_speech_ms += FRAME_DURATION_MS
                if self.consecutive_speech_ms >= self.min_speech_ms:
                    # Speech confirmed!
                    self.is_speaking = True
                    self.speech_start_time = time.perf_counter()
                    self.consecutive_silence_ms = 0.0

                    # Prepend pre-roll buffer to utterance
                    if len(self.pre_roll_buffer) > 0:
                        pre_roll_array = np.array(self.pre_roll_buffer, dtype=np.float32)
                        self.current_speech_chunks.append(pre_roll_array)
                        self.pre_roll_buffer.clear()

                    self.current_speech_chunks.append(frame)

                    if self.on_speech_start:
                        self.on_speech_start()
            else:
                self.consecutive_speech_ms = 0.0

        else:
            # Currently in speech segment
            self.current_speech_chunks.append(frame)
            current_duration = sum(len(c) for c in self.current_speech_chunks) / TARGET_SAMPLE_RATE

            if is_speech_frame:
                self.consecutive_silence_ms = 0.0
            else:
                self.consecutive_silence_ms += FRAME_DURATION_MS

            # Check if silence timeout reached or max utterance duration exceeded
            if self.consecutive_silence_ms >= self.silence_timeout_ms or current_duration >= self.max_utterance_seconds:
                self._finish_utterance()

    def _finish_utterance(self):
        """Finalizes the accumulated speech utterance and triggers callback."""
        if not self.current_speech_chunks:
            self.is_speaking = False
            return

        utterance_array = np.concatenate(self.current_speech_chunks)
        silence_detect_time = self.consecutive_silence_ms / 1000.0

        # Reset state for next utterance
        self.is_speaking = False
        self.current_speech_chunks.clear()
        self.consecutive_speech_ms = 0.0
        self.consecutive_silence_ms = 0.0
        self.pre_roll_buffer.clear()
        try:
            self.model.reset_states()
        except Exception:
            pass

        if self.on_speech_end and len(utterance_array) > 0:
            self.on_speech_end(utterance_array, silence_detect_time)

    def flush(self):
        """Forces completion of any currently buffered speech (used on manual STOP)."""
        if self.is_speaking and self.current_speech_chunks:
            self._finish_utterance()
        elif len(self.pending_raw_samples) > 0 and len(self.current_speech_chunks) > 0:
            self.current_speech_chunks.append(self.pending_raw_samples)
            self.pending_raw_samples = np.empty(0, dtype=np.float32)
            self._finish_utterance()
        else:
            self.reset()
