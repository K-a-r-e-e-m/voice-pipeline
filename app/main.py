from contextlib import asynccontextmanager
import logging
import os
import sys
import time
import uuid
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.asr import ASRService
from app.audio import load_and_resample_file, save_wav_file, compute_audio_diagnostics
from app.config import AUDIO_DIR, STATIC_DIR, HOST, PORT
from app.metrics import get_gpu_metrics, calculate_accuracy_metrics
from app.websocket import live_websocket_endpoint

# Configure logging with UTF-8 support
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("arabic_asr_app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan manager: Loads and warms up the ASR model once at startup."""
    logger.info("Initializing Arabic ASR Service...")
    asr_service = ASRService.get_instance()
    try:
        asr_service.load_model()
    except Exception as e:
        logger.error(f"Failed to load ASR model at startup: {e}", exc_info=True)
        raise e
    yield
    logger.info("Arabic ASR Service shutting down...")


app = FastAPI(
    title="Arabic ASR Service",
    description="Professional local web application for Arabic Speech-to-Text inference and testing",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS middleware for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class EvaluationRequest(BaseModel):
    reference: str
    hypothesis: str
    normalize: bool = True


@app.get("/api/gpu")
async def api_get_gpu():
    """Returns GPU metrics and VRAM usage."""
    return get_gpu_metrics()


@app.post("/api/transcribe-file")
async def api_transcribe_file(file: UploadFile = File(...)):
    """Transcribes an uploaded audio file (WAV, MP3, etc.)."""
    try:
        content = await file.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        audio_array = load_and_resample_file(content)
        utterance_id = f"file_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        wav_path = AUDIO_DIR / f"{utterance_id}.wav"
        save_wav_file(audio_array, wav_path)

        audio_diag = compute_audio_diagnostics(audio_array)

        asr_service = ASRService.get_instance()
        start_time = time.perf_counter()
        asr_result = await asr_service.transcribe(audio_array)
        e2e_latency = time.perf_counter() - start_time

        metrics = {
            "audio_duration_seconds": asr_result["duration_seconds"],
            "vad_silence_seconds": 0.0,
            "asr_inference_seconds": asr_result["inference_time_seconds"],
            "e2e_latency_seconds": round(e2e_latency, 3),
            "rtf": asr_result["rtf"],
            "speed_factor": asr_result["speed_factor"],
        }

        return {
            "utterance_id": utterance_id,
            "text": asr_result["text"],
            "metrics": metrics,
            "audio_url": f"/api/audio/{utterance_id}.wav",
            "audio_diagnostics": audio_diag,
            "gpu_metrics": get_gpu_metrics(),
        }

    except Exception as e:
        logger.error(f"File transcription failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/evaluate")
async def api_evaluate_accuracy(req: EvaluationRequest):
    """Calculates WER, CER, and Levenshtein edit operations."""
    return calculate_accuracy_metrics(
        reference=req.reference,
        hypothesis=req.hypothesis,
        normalize=req.normalize,
    )


@app.get("/api/audio/{filename}")
async def api_get_audio(filename: str):
    """Serves the exact recorded or processed audio file."""
    # Prevent directory traversal
    safe_filename = Path(filename).name
    file_path = AUDIO_DIR / safe_filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found.")
    return FileResponse(file_path, media_type="audio/wav")


@app.websocket("/ws/live")
async def websocket_route(websocket: WebSocket):
    """Handles real-time WebSocket live audio streaming."""
    await live_websocket_endpoint(websocket)


# Mount static assets
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def root_index():
    """Serves the main web dashboard."""
    index_path = STATIC_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return HTMLResponse("<h1>Arabic ASR Service is running. Frontend static files not found.</h1>")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=False)
