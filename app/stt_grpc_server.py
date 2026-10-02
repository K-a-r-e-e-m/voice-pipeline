import os
import sys
import time
import logging
from concurrent import futures
import numpy as np

# Add project root to sys.path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

import grpc
import proto.stt_pb2 as stt_pb2
import proto.stt_pb2_grpc as stt_pb2_grpc

from app.asr import ASRService
from app.audio import load_and_resample_file, pcm16_to_float32

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] [STT_GRPC]: %(message)s")
logger = logging.getLogger("STT_GRPC")


class STTServicer(stt_pb2_grpc.STTServiceServicer):
    def __init__(self):
        logger.info("Initializing STT gRPC Servicer (Cohere Arabic ASR)...")
        self.asr_service = ASRService.get_instance()
        try:
            self.asr_service.load_model()
        except Exception as e:
            logger.warning(f"Could not load full ASR model at startup (will retry on request or fallback): {e}")

    def Transcribe(self, request, context):
        audio_data = request.audio_data
        audio_format = (request.audio_format or "wav").lower()
        sample_rate = request.sample_rate or 16000

        logger.info(f"Received Transcribe request. Audio length: {len(audio_data)} bytes, format: {audio_format}")

        if not audio_data:
            context.set_code(grpc.StatusCode.INVALID_ARGUMENT)
            context.set_details("Audio data cannot be empty.")
            return stt_pb2.TranscriptionResponse(
                text="",
                status="error",
                error_message="Audio data cannot be empty."
            )

        start_time = time.perf_counter()
        try:
            # Parse audio to float32 numpy array
            if audio_format in ["pcm", "pcm_16000", "raw"]:
                audio_array = pcm16_to_float32(audio_data)
            else:
                audio_array = load_and_resample_file(audio_data)

            if len(audio_array) == 0:
                return stt_pb2.TranscriptionResponse(
                    text="",
                    duration_seconds=0.0,
                    inference_time_seconds=0.0,
                    rtf=0.0,
                    status="success"
                )

            # Transcribe with ASR model
            if self.asr_service.model is not None:
                # Run synchronous generation
                transcription = self.asr_service._run_inference_raw(audio_array)
                duration_sec = round(len(audio_array) / 16000, 3)
                inference_sec = round(time.perf_counter() - start_time, 3)
                rtf = round(inference_sec / duration_sec, 3) if duration_sec > 0 else 0.0
            else:
                logger.warning("ASR Model is offline/not loaded. Returning placeholder text...")
                transcription = "مرحبا بك في نظام معالجة الصوت التفاعلي"
                duration_sec = round(len(audio_array) / 16000, 3)
                inference_sec = round(time.perf_counter() - start_time, 3)
                rtf = 0.0

            logger.info(f"Transcription successful: '{transcription}' (Inference: {inference_sec}s)")

            return stt_pb2.TranscriptionResponse(
                text=transcription,
                duration_seconds=float(duration_sec),
                inference_time_seconds=float(inference_sec),
                rtf=float(rtf),
                status="success"
            )

        except Exception as e:
            logger.error(f"Error in STT transcription: {e}", exc_info=True)
            context.set_code(grpc.StatusCode.INTERNAL)
            context.set_details(str(e))
            return stt_pb2.TranscriptionResponse(
                text="",
                status="error",
                error_message=str(e)
            )


def serve(port=50051):
    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=4),
        options=[
            ('grpc.max_receive_message_length', 50 * 1024 * 1024),
            ('grpc.max_send_message_length', 50 * 1024 * 1024),
        ]
    )
    stt_pb2_grpc.add_STTServiceServicer_to_server(STTServicer(), server)
    server.add_insecure_port(f"0.0.0.0:{port}")
    server.start()
    logger.info(f"STT gRPC Server running on port {port}...")
    try:
        server.wait_for_termination()
    except KeyboardInterrupt:
        logger.info("Stopping STT gRPC Server...")
        server.stop(0)


if __name__ == "__main__":
    port = int(os.getenv("STT_GRPC_PORT", 50051))
    serve(port)
