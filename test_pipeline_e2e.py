import grpc
import proto.stt_pb2 as stt_pb2
import proto.stt_pb2_grpc as stt_pb2_grpc
import proto.tts_pb2 as tts_pb2
import proto.tts_pb2_grpc as tts_pb2_grpc

def test_stt(port=50051):
    channel = grpc.insecure_channel(f"localhost:{port}")
    client = stt_pb2_grpc.STTServiceStub(channel)
    # 1 second of dummy silence/tone audio
    dummy_wav_header = b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80>\x00\x00\x00}\x00\x00\x02\x00\x10\x00data\x00\x00\x00\x00"
    req = stt_pb2.AudioRequest(
        audio_data=dummy_wav_header,
        audio_format="wav",
        sample_rate=16000
    )
    resp = client.Transcribe(req)
    print("STT Response:", resp.status, "Text:", resp.text)
    channel.close()

def test_tts(port=50052):
    channel = grpc.insecure_channel(f"localhost:{port}")
    client = tts_pb2_grpc.TTSServiceStub(channel)
    req = tts_pb2.SynthesizeRequest(
        text="صباح الخير، كيف يمكنني مساعدتك اليوم؟",
        voice="lahgtna-v3-fast",
        speed=1.0
    )
    resp = client.Synthesize(req)
    print("TTS Response:", resp.status, "Audio bytes:", len(resp.audio_data), "Format:", resp.audio_format)
    channel.close()

if __name__ == "__main__":
    import sys
    mode = sys.argv[1] if len(sys.argv) > 1 else "both"
    if mode in ["stt", "both"]:
        try:
            test_stt()
        except Exception as e:
            print("STT Test failed:", e)
    if mode in ["tts", "both"]:
        try:
            test_tts()
        except Exception as e:
            print("TTS Test failed:", e)
