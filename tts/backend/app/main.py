import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.services.tts_service import TTSService
from app.api.routes import router as api_router
from app.websocket.tts_socket import router as ws_router

logger = logging.getLogger("MAIN")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize Egyptian TTS
    logger.info("[INFO] Starting OmniVoice TTS FastAPI Server...")
    tts_service = TTSService.get_instance()
    tts_service.load_models()
    yield
    # Shutdown: Clean up resources
    logger.info("[INFO] Shutting down OmniVoice TTS Server...")
    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass

app = FastAPI(
    title="OmniVoice Egyptian Neural TTS API",
    description="High-performance, low-latency Text-to-Speech server dedicated to Egyptian Arabic with WebSocket streaming.",
    version="1.0.0",
    lifespan=lifespan
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Root endpoint
@app.get("/")
async def root():
    return {
        "service": "OmniVoice Egyptian Neural TTS Server",
        "status": "active",
        "frontend_url": "http://localhost:5173",
        "api_docs": "http://localhost:8000/docs",
        "health_check": "http://localhost:8000/health"
    }

# Include Routers
app.include_router(api_router)
app.include_router(ws_router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=False)
