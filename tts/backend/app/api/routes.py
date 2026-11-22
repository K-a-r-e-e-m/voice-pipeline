import io
import wave
import logging
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field
from app.services.tts_service import TTSService
from app.config import settings

logger = logging.getLogger("TTS_ROUTES")
router = APIRouter()

class SynthesizeRequest(BaseModel):
    text: str = Field(..., max_length=settings.MAX_TEXT_LENGTH)
    voice: str = "lahgtna-v3-balanced"
    speed: float = 1.0
    pitch: float = 1.0

@router.get("/health")
async def health_check():
    tts_service = TTSService.get_instance()
    info = tts_service.get_info()
    return {
        "status": "ok",
        "service": "OmniVoice Egyptian TTS Server",
        **info
    }

@router.get("/api/voices")
async def get_voices():
    return {
        "voices": [
            {"id": "lahgtna-v3-balanced", "name": "لهجتنا أومني فويس (متوازن - 8 خطوات)", "language": "arz", "flag": "🇪🇬", "gender": "طبيعي"},
            {"id": "lahgtna-v3-fast", "name": "لهجتنا أومني فويس (سريع - 4 خطوات)", "language": "arz", "flag": "⚡", "gender": "سريع"},
            {"id": "lahgtna-v3-studio", "name": "لهجتنا أومني فويس (جودة استوديو - 16 خطوة)", "language": "arz", "flag": "🎙️", "gender": "فائق الدقة"},
        ]
    }

@router.post("/api/synthesize")
async def synthesize_rest(req: SynthesizeRequest):
    """
    REST fallback endpoint: generates complete audio and returns WAV file.
    """
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty.")

    tts_service = TTSService.get_instance()

    try:
        pcm_chunks = []
        sample_rate = tts_service.sample_rate

        async for chunk_bytes, sr, _ in tts_service.generate_stream(
            text=text, voice=req.voice, speed=req.speed, pitch=req.pitch
        ):
            pcm_chunks.append(chunk_bytes)
            sample_rate = sr

        all_pcm = b"".join(pcm_chunks)

        # Build in-memory WAV file
        wav_io = io.BytesIO()
        with wave.open(wav_io, "wb") as wav_file:
            wav_file.setnchannels(1)  # Mono
            wav_file.setsampwidth(2)  # 16-bit
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(all_pcm)

        wav_bytes = wav_io.getvalue()
        return Response(content=wav_bytes, media_type="audio/wav")

    except Exception as e:
        logger.error(f"[ERROR] REST synthesis failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
