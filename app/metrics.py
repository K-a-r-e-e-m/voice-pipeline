import re
from typing import Dict, Any, List, Optional
import torch

try:
    import jiwer
except ImportError:
    jiwer = None


def get_gpu_metrics() -> Dict[str, Any]:
    """Queries current NVIDIA GPU information and VRAM usage safely."""
    if not torch.cuda.is_available():
        return {
            "available": False,
            "device_name": "CPU (CUDA not available)",
            "device": "cpu",
            "allocated_gb": 0.0,
            "peak_gb": 0.0,
            "total_gb": 0.0,
            "vram_percent": 0.0,
            "display": "Unavailable (CPU mode)",
        }

    try:
        device_idx = 0
        device_name = torch.cuda.get_device_name(device_idx)
        allocated_bytes = torch.cuda.memory_allocated(device_idx)
        max_bytes = torch.cuda.max_memory_allocated(device_idx)
        total_bytes = torch.cuda.get_device_properties(device_idx).total_memory

        allocated_gb = round(allocated_bytes / (1024 ** 3), 2)
        peak_gb = round(max_bytes / (1024 ** 3), 2)
        total_gb = round(total_bytes / (1024 ** 3), 2)
        vram_percent = round((allocated_gb / total_gb * 100), 1) if total_gb > 0 else 0.0

        return {
            "available": True,
            "device_name": device_name,
            "device": f"cuda:{device_idx}",
            "allocated_gb": allocated_gb,
            "peak_gb": peak_gb,
            "total_gb": total_gb,
            "vram_percent": vram_percent,
            "display": f"{allocated_gb} GB / {total_gb} GB ({vram_percent}%)",
        }
    except Exception as e:
        return {
            "available": False,
            "device_name": f"Error: {str(e)}",
            "device": "cuda",
            "allocated_gb": 0.0,
            "peak_gb": 0.0,
            "total_gb": 0.0,
            "vram_percent": 0.0,
            "display": "Unavailable",
        }


def normalize_arabic_text(text: str) -> str:
    """Normalizes Arabic text for fair ASR accuracy evaluation."""
    if not text:
        return ""

    # Remove Arabic Tashkeel / diacritics and Tatweel (Kashida)
    # 064B-0652: Fathatan, Dammatan, Kasratan, Fatha, Damma, Kasra, Shadda, Sukun
    # 0670: Superscript Alef, 0640: Tatweel
    tashkeel_regex = re.compile(r"[\u064B-\u0652\u0670\u0640]")
    text = tashkeel_regex.sub("", text)

    # Normalize Alef variations
    text = re.sub(r"[إأآٱ]", "ا", text)

    # Normalize Teh Marbuta to Heh
    text = re.sub(r"ة", "ه", text)

    # Normalize Alef Maqsura to Yeh
    text = re.sub(r"ى", "ي", text)

    # Remove punctuation (both Arabic and Latin)
    punctuation_regex = re.compile(r"[\.,!?;:\"\'«»\(\)\[\]\{\}—\-–_،؛؟]")
    text = punctuation_regex.sub(" ", text)

    # Collapse multiple whitespaces
    text = re.sub(r"\s+", " ", text)

    return text.strip()


def calculate_accuracy_metrics(reference: str, hypothesis: str, normalize: bool = True) -> Dict[str, Any]:
    """Calculates Word Error Rate (WER), Character Error Rate (CER), and edit breakdown."""
    ref_eval = normalize_arabic_text(reference) if normalize else reference.strip()
    hyp_eval = normalize_arabic_text(hypothesis) if normalize else hypothesis.strip()

    if not ref_eval:
        return {
            "reference": reference,
            "hypothesis": hypothesis,
            "normalized_reference": ref_eval,
            "normalized_hypothesis": hyp_eval,
            "wer": 0.0,
            "cer": 0.0,
            "substitutions": 0,
            "insertions": 0,
            "deletions": 0,
            "hits": 0,
            "error": "Reference text is empty.",
        }

    if not hyp_eval:
        ref_words = len(ref_eval.split())
        return {
            "reference": reference,
            "hypothesis": hypothesis,
            "normalized_reference": ref_eval,
            "normalized_hypothesis": hyp_eval,
            "wer": 1.0,
            "cer": 1.0,
            "substitutions": 0,
            "insertions": 0,
            "deletions": ref_words,
            "hits": 0,
            "error": None,
        }

    if jiwer is None:
        return {
            "reference": reference,
            "hypothesis": hypothesis,
            "wer": 0.0,
            "cer": 0.0,
            "substitutions": 0,
            "insertions": 0,
            "deletions": 0,
            "hits": 0,
            "error": "jiwer library is not installed.",
        }

    try:
        word_details = jiwer.process_words(ref_eval, hyp_eval)
        cer_value = jiwer.cer(ref_eval, hyp_eval)

        return {
            "reference": reference,
            "hypothesis": hypothesis,
            "normalized_reference": ref_eval,
            "normalized_hypothesis": hyp_eval,
            "wer": round(float(word_details.wer), 4),
            "cer": round(float(cer_value), 4),
            "substitutions": int(word_details.substitutions),
            "insertions": int(word_details.insertions),
            "deletions": int(word_details.deletions),
            "hits": int(word_details.hits),
            "error": None,
        }
    except Exception as e:
        return {
            "reference": reference,
            "hypothesis": hypothesis,
            "wer": 0.0,
            "cer": 0.0,
            "substitutions": 0,
            "insertions": 0,
            "deletions": 0,
            "hits": 0,
            "error": str(e),
        }


class SessionStatsTracker:
    """Tracks session-level metrics across multiple utterances."""

    def __init__(self):
        self.utterances: List[Dict[str, Any]] = []

    def add_utterance(self, duration: float, asr_latency: float, e2e_latency: float, rtf: float):
        self.utterances.append({
            "duration": duration,
            "asr_latency": asr_latency,
            "e2e_latency": e2e_latency,
            "rtf": rtf,
        })

    def get_summary(self) -> Dict[str, Any]:
        count = len(self.utterances)
        if count == 0:
            return {
                "utterances_count": 0,
                "total_audio_seconds": 0.0,
                "avg_asr_latency_seconds": 0.0,
                "avg_e2e_latency_seconds": 0.0,
                "avg_rtf": 0.0,
                "min_e2e_latency_seconds": 0.0,
                "max_e2e_latency_seconds": 0.0,
                "avg_utterance_duration_seconds": 0.0,
            }

        total_audio = sum(u["duration"] for u in self.utterances)
        avg_asr = sum(u["asr_latency"] for u in self.utterances) / count
        avg_e2e = sum(u["e2e_latency"] for u in self.utterances) / count
        avg_rtf = sum(u["rtf"] for u in self.utterances) / count
        min_e2e = min(u["e2e_latency"] for u in self.utterances)
        max_e2e = max(u["e2e_latency"] for u in self.utterances)
        avg_duration = total_audio / count

        return {
            "utterances_count": count,
            "total_audio_seconds": round(total_audio, 2),
            "avg_asr_latency_seconds": round(avg_asr, 3),
            "avg_e2e_latency_seconds": round(avg_e2e, 3),
            "avg_rtf": round(avg_rtf, 3),
            "min_e2e_latency_seconds": round(min_e2e, 3),
            "max_e2e_latency_seconds": round(max_e2e, 3),
            "avg_utterance_duration_seconds": round(avg_duration, 2),
        }

    def clear(self):
        self.utterances.clear()
