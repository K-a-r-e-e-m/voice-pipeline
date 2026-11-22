import os
import sys
import io
import time
import wave
import logging
from concurrent import futures

# Add project root and tts/backend to python path
current_dir = os.path.dirname(os.path.abspath(__file__))
tts_backend_dir = os.path.join(current_dir, "backend")
project_root = os.path.dirname(current_dir)

if tts_backend_dir not in sys.path:
    sys.path.insert(0, tts_backend_dir)
if project_root not in sys.path:
    sys.path.insert(1, project_root)

import grpc
import proto.tts_pb2 as tts_pb2
import proto.tts_pb2_grpc as tts_pb2_grpc

# Import TTSService from tts/backend
import importlib.util
tts_service_spec = importlib.util.spec_from_file_location("tts_service_mod", os.path.join(tts_backend_dir, "app", "services", "tts_service.py"))
tts_service_mod = importlib.util.module_from_spec(tts_service_spec)
# Add tts backend app to sys.modules if needed by relative imports
sys.modules["tts_service_mod"] = tts_service_mod
tts_service_spec.loader.exec_module(tts_service_mod)
TTSService = tts_service_mod.TTSService
split_clauses = tts_service_mod.split_clauses
preprocess_egyptian_text = tts_service_mod.preprocess_egyptian_text


logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] [TTS_GRPC]: %(message)s")
logger = logging.getLogger("TTS_GRPC")


class TTSServicer(tts_pb2_grpc.TTSServiceServicer):
    def __init__(self):
        logger.info("Initializing TTS gRPC Servicer (OmniVoice Egyptian v3)...")
        self.tts_service = TTSService.get_instance()
        try:
            self.tts_service.load_models()
        except Exception as e:
            logger.warning(f"Could not load full TTS weights at startup (will retry on request or fallback): {e}")

    def Synthesize(self, request, context):
        text = request.text.strip()
        voice = request.voice or "lahgtna-v3-balanced"
        speed = request.speed if request.speed > 0 else 1.0
        pitch = request.pitch if request.pitch > 0 else 1.0

        logger.info(f"Received TTS Synthesize request. Text: '{text[:50]}...' (Voice: {voice}, Speed: {speed})")

        if not text:
            context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
            context.set_details("Text cannot be empty.")
            return tts_pb2.SynthesizeResponse(
                status="error",
                error_message="Text cannot be empty."
            )

        start_time = time.time()
        try:
            sample_rate = self.tts_service.sample_rate
            # Synthesize audio using TTSService
            if self.tts_service.model is not None:
                # Use synchronous inference per clause
                from app.services.tts_service import split_clauses, preprocess_egyptian_text
                import numpy as np

                clauses = split_clauses(text)
                num_steps = 4 if "fast" in voice else (16 if "studio" in voice else 8)
                all_audio_np = []

                for clause in clauses:
                    cleaned = preprocess_egyptian_text(clause)
                    if not cleaned:
                        continue
                    clause_audio = self.tts_service._infer_clause(cleaned, num_steps=num_steps, speed=speed)
                    if len(clause_audio) > 0:
                        all_audio_np.append(clause_audio)

                if all_audio_np:
                    full_audio = np.concatenate(all_audio_np)
                else:
                    full_audio = np.array([], dtype=np.float32)

                # Convert to 16-bit PCM bytes
                pcm_data = (full_audio * 32767.0).clip(-32768, 32767).astype(np.int16).tobytes()
            else:
                # Fallback tone/synthesizer if model is offline/loading in lightweight environment
                logger.warning("TTS Model is not loaded. Generating fallback audio tone...")
                import numpy as np
                duration = 1.5
                t = np.linspace(0, duration, int(sample_rate * duration), False)
                tone = np.sin(440 * 2 * np.pi * t) * 0.3
                pcm_data = (tone * 32767.0).astype(np.int16).tobytes()

            # Package as in-memory WAV
            wav_io = io.BytesIO()
            with wave.open(wav_io, "wb") as wav_file:
                wav_file.setnchannels(1)  # Mono
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(sample_rate)
                wav_file.writeframes(pcm_data)

            wav_bytes = wav_io.getvalue()
            elapsed = time.time() - start_time
            logger.info(f"Synthesized {len(wav_bytes)} bytes WAV in {elapsed:.3f}s")

            return tts_pb2.SynthesizeResponse(
                audio_data=wav_bytes,
                sample_rate=sample_rate,
                audio_format="wav",
                inference_time_seconds=float(elapsed),
                status="success"
            )

        except Exception as e:
            logger.error(f"Error in TTS synthesis: {e}", exc_info=True)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return tts_pb2.SynthesizeResponse(
                status="error",
                error_message=str(e)
            )


def serve(port=50052):
    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=4),
        options=[
            ('grpc.max_receive_message_length', 50 * 1024 * 1024),
            ('grpc.max_send_message_length', 50 * 1024 * 1024),
        ]
    )
    tts_pb2_grpc.add_TTSServiceServicer_to_server(TTSServicer(), server)
    server.add_insecure_port(f"0.0.0.0:{port}")
    server.start()
    logger.info(f"TTS gRPC Server running on port {port}...")
    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        logger.info("Stopping TTS gRPC Server...")
        server.stop(0)


if __name__ == "__main__":
    port = int(os.getenv("TTS_GRPC_PORT", 50052))
    serve(port)
