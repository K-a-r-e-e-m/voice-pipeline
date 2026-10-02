import asyncio
import json
import logging
import time
import uuid
from typing import Optional, List
import numpy as np
from fastapi import WebSocket, WebSocketDisconnect

from app.asr import ASRService
from app.audio import (
    pcm16_to_float32,
    save_wav_file,
    compute_audio_diagnostics,
)
from app.config import (
    AUDIO_DIR,
    DEFAULT_SILENCE_TIMEOUT_MS,
    DEFAULT_MIN_SPEECH_MS,
    DEFAULT_VAD_THRESHOLD,
    DEFAULT_MAX_UTTERANCE_SECONDS,
)
from app.metrics import get_gpu_metrics, SessionStatsTracker
from app.vad import VADSegmenter

logger = logging.getLogger("websocket_handler")


class WebSocketLiveSession:
    """Manages a single live WebSocket client connection."""

    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.asr_service = ASRService.get_instance()
        self.session_tracker = SessionStatsTracker()
        self.loop = asyncio.get_event_loop()

        # Session state
        self.mode = "live"  # "live" or "manual"
        self.is_active = False
        self.manual_audio_chunks: List[np.ndarray] = []
        self.manual_start_time: float = 0.0

        # Initialize VAD Segmenter with thread-safe async callbacks
        self.vad = VADSegmenter(
            silence_timeout_ms=DEFAULT_SILENCE_TIMEOUT_MS,
            min_speech_ms=DEFAULT_MIN_SPEECH_MS,
            threshold=DEFAULT_VAD_THRESHOLD,
            max_utterance_seconds=DEFAULT_MAX_UTTERANCE_SECONDS,
            on_speech_start=self._on_speech_start_sync,
            on_speech_end=self._on_speech_end_sync,
        )

    def _log_debug(self, message: str):
        """Sends a debug log event to the client."""
        now_str = time.strftime("%H:%M:%S")
        asyncio.run_coroutine_threadsafe(
            self.websocket.send_text(
                json.dumps({
                    "type": "debug",
                    "message": f"[{now_str}] {message}",
                    "timestamp": time.time(),
                })
            ),
            self.loop,
        )

    def _on_speech_start_sync(self):
        """Called by VAD segmenter when speech onset is detected."""
        asyncio.run_coroutine_threadsafe(self._handle_speech_start(), self.loop)

    async def _handle_speech_start(self):
        self._log_debug("Speech detected")
        await self.websocket.send_text(
            json.dumps({"type": "status", "status": "speaking"})
        )
        await self.websocket.send_text(
            json.dumps({"type": "utterance_started", "timestamp": time.time()})
        )

    def _on_speech_end_sync(self, utterance_audio: np.ndarray, silence_detect_time: float):
        """Called by VAD segmenter when silence indicates sentence completion."""
        asyncio.run_coroutine_threadsafe(
            self._handle_speech_end(utterance_audio, silence_detect_time),
            self.loop,
        )

    async def _handle_speech_end(self, utterance_audio: np.ndarray, silence_detect_time: float):
        """Processes the completed speech utterance through ASR and returns metrics."""
        sentence_end_time = time.perf_counter()
        utterance_id = f"utt_{int(time.time())}_{uuid.uuid4().hex[:6]}"
        self._log_debug(f"Silence detected ({silence_detect_time:.2f}s). Utterance {utterance_id} completed. Processing ASR...")

        await self.websocket.send_text(
            json.dumps({"type": "status", "status": "processing"})
        )
        await self.websocket.send_text(
            json.dumps({"type": "utterance_completed", "utterance_id": utterance_id})
        )

        # Save exact audio segment to WAV file
        wav_path = AUDIO_DIR / f"{utterance_id}.wav"
        save_wav_file(utterance_audio, wav_path)

        # Compute audio signal metrics
        audio_diag = compute_audio_diagnostics(utterance_audio)

        try:
            # Perform ASR inference on the completed segment
            asr_result = await self.asr_service.transcribe(utterance_audio)
            e2e_latency = time.perf_counter() - sentence_end_time

            # Update session stats
            self.session_tracker.add_utterance(
                duration=asr_result["duration_seconds"],
                asr_latency=asr_result["inference_time_seconds"],
                e2e_latency=round(e2e_latency, 3),
                rtf=asr_result["rtf"],
            )

            metrics = {
                "audio_duration_seconds": asr_result["duration_seconds"],
                "vad_silence_seconds": round(silence_detect_time, 3),
                "asr_inference_seconds": asr_result["inference_time_seconds"],
                "e2e_latency_seconds": round(e2e_latency, 3),
                "rtf": asr_result["rtf"],
                "speed_factor": asr_result["speed_factor"],
            }

            self._log_debug(
                f"ASR completed in {asr_result['inference_time_seconds']:.3f}s (E2E: {e2e_latency:.3f}s, RTF: {asr_result['rtf']})"
            )

            # Send result back to browser
            await self.websocket.send_text(
                json.dumps({
                    "type": "transcription",
                    "utterance_id": utterance_id,
                    "text": asr_result["text"],
                    "metrics": metrics,
                    "audio_url": f"/api/audio/{utterance_id}.wav",
                    "audio_diagnostics": audio_diag,
                    "session_summary": self.session_tracker.get_summary(),
                    "gpu_metrics": get_gpu_metrics(),
                })
            )

        except WebSocketDisconnect:
            logger.info(f"WebSocket client disconnected before {utterance_id} transcription was sent.")
        except Exception as e:
            logger.error(f"Error during ASR inference for {utterance_id}: {e}", exc_info=True)
            self._log_debug(f"ASR error: {str(e)}")
            await self.websocket.send_text(
                json.dumps({
                    "type": "error",
                    "message": f"Transcription failed: {str(e)}",
                    "utterance_id": utterance_id,
                })
            )
        finally:
            # Resume listening state if still active
            if self.is_active:
                await self.websocket.send_text(
                    json.dumps({"type": "status", "status": "listening"})
                )
            else:
                await self.websocket.send_text(
                    json.dumps({"type": "status", "status": "idle"})
                )

    async def handle_text_message(self, data: str):
        """Handles incoming JSON control messages from the client."""
        try:
            msg = json.loads(data)
            action = msg.get("type")

            if action == "start":
                self.mode = msg.get("mode", "live")
                self.is_active = True
                self.manual_audio_chunks.clear()
                self.manual_start_time = time.perf_counter()
                self.vad.reset()

                # Apply any provided settings
                settings = msg.get("settings", {})
                self.vad.update_settings(
                    silence_timeout_ms=settings.get("silence_timeout_ms"),
                    min_speech_ms=settings.get("min_speech_ms"),
                    threshold=settings.get("vad_threshold"),
                    max_utterance_seconds=settings.get("max_utterance_seconds"),
                )

                self._log_debug(f"Session started in {self.mode.upper()} mode")
                await self.websocket.send_text(
                    json.dumps({"type": "status", "status": "listening"})
                )
                await self.websocket.send_text(
                    json.dumps({"type": "gpu_metrics", "metrics": get_gpu_metrics()})
                )

            elif action == "stop":
                self.is_active = False
                self._log_debug("Stop requested by user")

                if self.mode == "manual":
                    # Process full manual recording
                    if self.manual_audio_chunks:
                        full_audio = np.concatenate(self.manual_audio_chunks)
                        self.manual_audio_chunks.clear()
                        await self._handle_speech_end(full_audio, silence_detect_time=0.0)
                    else:
                        await self.websocket.send_text(
                            json.dumps({"type": "status", "status": "idle"})
                        )
                else:
                    # Live mode: flush VAD buffer if user was speaking
                    self.vad.flush()
                    await self.websocket.send_text(
                        json.dumps({"type": "status", "status": "idle"})
                    )

            elif action == "update_settings":
                settings = msg.get("settings", {})
                self.vad.update_settings(
                    silence_timeout_ms=settings.get("silence_timeout_ms"),
                    min_speech_ms=settings.get("min_speech_ms"),
                    threshold=settings.get("vad_threshold"),
                    max_utterance_seconds=settings.get("max_utterance_seconds"),
                )
                self._log_debug("VAD settings updated")

            elif action == "clear_session":
                self.session_tracker.clear()
                await self.websocket.send_text(
                    json.dumps({
                        "type": "session_cleared",
                        "session_summary": self.session_tracker.get_summary(),
                    })
                )
                self._log_debug("Session metrics cleared")

            elif action == "ping":
                await self.websocket.send_text(
                    json.dumps({
                        "type": "pong",
                        "gpu_metrics": get_gpu_metrics(),
                    })
                )

        except Exception as e:
            logger.error(f"Failed to handle JSON message: {e}")
            await self.websocket.send_text(
                json.dumps({"type": "error", "message": f"Bad request: {str(e)}"})
            )

    async def handle_binary_message(self, data: bytes):
        """Processes binary 16-bit PCM audio chunks streamed from the microphone."""
        if not self.is_active:
            return

        # Convert PCM bytes to normalized float32
        audio_chunk = pcm16_to_float32(data)
        if len(audio_chunk) == 0:
            return

        if self.mode == "manual":
            self.manual_audio_chunks.append(audio_chunk)
            # Update status to speaking during manual recording
            await self.websocket.send_text(
                json.dumps({"type": "status", "status": "speaking"})
            )
        else:
            # Live mode: feed chunk to VAD segmenter
            self.vad.process_audio_chunk(audio_chunk)


async def live_websocket_endpoint(websocket: WebSocket):
    """FastAPI WebSocket endpoint for real-time microphone audio streaming."""
    await websocket.accept()
    session = WebSocketLiveSession(websocket)
    session._log_debug("WebSocket connection established")

    try:
        while True:
            message = await websocket.receive()
            if "text" in message and message["text"] is not None:
                await session.handle_text_message(message["text"])
            elif "bytes" in message and message["bytes"] is not None:
                await session.handle_binary_message(message["bytes"])
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected.")
    except RuntimeError as e:
        if "disconnect" in str(e).lower():
            logger.info("WebSocket connection closed cleanly.")
        else:
            logger.error(f"WebSocket session runtime exception: {e}")
    except Exception as e:
        logger.error(f"WebSocket session exception: {e}")
