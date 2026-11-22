import json
import logging
import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.tts_service import TTSService
from app.config import settings

logger = logging.getLogger("TTS_WEBSOCKET")
router = APIRouter()

@router.websocket("/ws/tts")
async def websocket_tts_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info(f"[INFO] WebSocket client connected: {websocket.client}")

    tts_service = TTSService.get_instance()
    current_task: asyncio.Task | None = None

    try:
        while True:
            # Receive text / JSON message from client
            message_text = await websocket.receive_text()
            try:
                data = json.loads(message_text)
            except Exception:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": "Invalid JSON format."
                }))
                continue

            msg_type = data.get("type", "")

            # Handle Stop / Cancel request
            if msg_type == "stop":
                if current_task and not current_task.done():
                    current_task.cancel()
                    logger.info("[INFO] Synthesis generation cancelled by client.")
                continue

            if msg_type == "synthesize":
                text = data.get("text", "").strip()
                voice = data.get("voice", "lahgtna-v3-balanced")
                speed = float(data.get("speed", 1.0))
                pitch = float(data.get("pitch", 1.0))

                # Validation
                if not text:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": "Text cannot be empty."
                    }))
                    continue

                if len(text) > settings.MAX_TEXT_LENGTH:
                    await websocket.send_text(json.dumps({
                        "type": "error",
                        "message": f"Text exceeds maximum allowed length of {settings.MAX_TEXT_LENGTH} characters."
                    }))
                    continue

                # Cancel any ongoing task on this connection
                if current_task and not current_task.done():
                    current_task.cancel()

                async def stream_audio_task():
                    try:
                        logger.info(f"[INFO] Starting TTS inference for {len(text)} chars (voice: {voice}, speed: {speed})")

                        # Send audio_start metadata
                        sample_rate = tts_service.get_sample_rate(voice)

                        await websocket.send_text(json.dumps({
                            "type": "audio_start",
                            "sample_rate": sample_rate,
                            "channels": 1,
                            "format": "pcm_s16le",
                            "voice": voice
                        }))

                        # Stream chunks
                        chunk_count = 0
                        async for pcm_bytes, sr, meta in tts_service.generate_stream(
                            text=text, voice=voice, speed=speed, pitch=pitch
                        ):
                            # Send raw PCM 16-bit binary chunk over WebSocket
                            await websocket.send_bytes(pcm_bytes)
                            chunk_count += 1
                            logger.info(f"[INFO] Streamed chunk #{chunk_count} ({len(pcm_bytes)} bytes) in {meta['inference_time_ms']:.1f}ms")

                        # Send audio_end when generation completes
                        await websocket.send_text(json.dumps({
                            "type": "audio_end",
                            "total_chunks": chunk_count
                        }))
                        logger.info(f"[INFO] Generation completed successfully ({chunk_count} chunks)")

                    except asyncio.CancelledError:
                        logger.info("[INFO] Audio streaming task cancelled.")
                    except Exception as e:
                        logger.error(f"[ERROR] Synthesis error: {e}", exc_info=True)
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": f"TTS Inference failed: {str(e)}"
                        }))

                current_task = asyncio.create_task(stream_audio_task())

            else:
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": f"Unknown message type: {msg_type}"
                }))

    except WebSocketDisconnect:
        logger.info(f"[INFO] WebSocket disconnected: {websocket.client}")
        if current_task and not current_task.done():
            current_task.cancel()
    except Exception as e:
        logger.error(f"[ERROR] WebSocket connection error: {e}", exc_info=True)
        if current_task and not current_task.done():
            current_task.cancel()
