import io
import math
from pathlib import Path
from typing import Dict, Any, Union
import numpy as np
import soundfile as sf

from app.config import TARGET_SAMPLE_RATE


def pcm16_to_float32(pcm_bytes: bytes) -> np.ndarray:
    """Converts 16-bit PCM bytes (little endian) into a normalized float32 numpy array [-1.0, 1.0]."""
    if not pcm_bytes:
        return np.empty(0, dtype=np.float32)
    int16_array = np.frombuffer(pcm_bytes, dtype=np.int16)
    return (int16_array.astype(np.float32) / 32768.0).astype(np.float32)


def float32_to_pcm16(audio_array: np.ndarray) -> bytes:
    """Converts normalized float32 array [-1.0, 1.0] to 16-bit signed integer PCM bytes."""
    clipped = np.clip(audio_array, -1.0, 1.0)
    int16_array = (clipped * 32767.0).astype(np.int16)
    return int16_array.tobytes()


def save_wav_file(audio_array: np.ndarray, file_path: Union[str, Path], sample_rate: int = TARGET_SAMPLE_RATE) -> None:
    """Saves a 1D float32 audio array as a standard 16-bit PCM WAV file."""
    path = Path(file_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), audio_array, sample_rate, subtype="PCM_16", format="WAV")


def compute_audio_diagnostics(audio_array: np.ndarray, sample_rate: int = TARGET_SAMPLE_RATE) -> Dict[str, Any]:
    """Computes technical audio diagnostics to monitor microphone input quality."""
    if len(audio_array) == 0:
        return {
            "duration_seconds": 0.0,
            "sample_rate": sample_rate,
            "channels": 1,
            "format": "PCM 16-bit WAV",
            "samples": 0,
            "peak_level": 0.0,
            "peak_dbfs": -100.0,
            "rms_level": 0.0,
            "rms_dbfs": -100.0,
            "quality_status": "silent",
            "warning": "No audio signal detected.",
        }

    sample_count = len(audio_array)
    duration = sample_count / sample_rate
    peak = float(np.max(np.abs(audio_array)))
    rms = float(np.sqrt(np.mean(audio_array ** 2)))

    # dBFS calculation (0 dBFS is full scale)
    peak_dbfs = round(20.0 * math.log10(peak), 1) if peak > 1e-6 else -100.0
    rms_dbfs = round(20.0 * math.log10(rms), 1) if rms > 1e-6 else -100.0

    # Quality check
    if peak >= 0.999:
        quality_status = "clipping"
        warning = "Audio signal is near digital ceiling (0 dBFS)."
    elif rms_dbfs < -48.0 or peak < 0.01:
        quality_status = "too_quiet"
        warning = "Microphone input is very quiet. Speak closer to the microphone."
    else:
        quality_status = "good"
        warning = "Optimal signal levels."

    return {
        "duration_seconds": round(duration, 3),
        "sample_rate": sample_rate,
        "channels": 1,
        "format": "PCM 16-bit WAV",
        "samples": sample_count,
        "peak_level": round(peak, 4),
        "peak_dbfs": peak_dbfs,
        "rms_level": round(rms, 4),
        "rms_dbfs": rms_dbfs,
        "quality_status": quality_status,
        "warning": warning,
    }


def load_and_resample_file(file_content: bytes) -> np.ndarray:
    """Reads audio file bytes (WAV, FLAC, OGG, MP3) and returns 16kHz mono float32 array."""
    with io.BytesIO(file_content) as bio:
        data, sr = sf.read(bio, dtype="float32")

    # If stereo or multichannel, convert to mono
    if data.ndim > 1:
        data = np.mean(data, axis=1)

    # Resample if sample rate doesn't match target
    if sr != TARGET_SAMPLE_RATE:
        import librosa
        data = librosa.resample(data, orig_sr=sr, target_sr=TARGET_SAMPLE_RATE)

    return data.astype(np.float32)
