import os
import asyncio
import wave
import pytest
from app.services.tts_service import TTSService

@pytest.mark.asyncio
async def test_standalone_tts():
    print("\n" + "=" * 60)
    print("Testing Standalone Egyptian Neural TTS (Salma & Shakir)")
    print("=" * 60)

    tts_service = TTSService.get_instance()

    test_cases = [
        {
            "voice": "ar-EG-SalmaNeural",
            "name": "Salma (سلمى)",
            "text": "مساء الفل يا باشا! منور الدنيا كلها، طمني عليك كلو تمام؟",
            "output_file": "test_salma.wav",
        },
        {
            "voice": "ar-EG-ShakirNeural",
            "name": "Shakir (شاكر)",
            "text": "أهلاً وسهلاً بيك يا فنان، نورت المكان ومبسوطين بوجودك معانا.",
            "output_file": "test_shakir.wav",
        }
    ]

    for tc in test_cases:
        print(f"\n--- Testing Egyptian Voice: {tc['name']} ---")
        pcm_chunks = []
        sample_rate = 24000

        async for chunk_bytes, sr, meta in tts_service.generate_stream(
            text=tc["text"], voice=tc["voice"], speed=1.0
        ):
            pcm_chunks.append(chunk_bytes)
            sample_rate = sr

        all_pcm = b"".join(pcm_chunks)
        print(f"Total Generated PCM bytes: {len(all_pcm)} (Sample Rate: {sample_rate} Hz)")

        out_path = os.path.join(os.path.dirname(__file__), "..", tc["output_file"])
        out_path = os.path.abspath(out_path)

        with wave.open(out_path, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(sample_rate)
            wf.writeframes(all_pcm)

        file_size = os.path.getsize(out_path)
        print(f"Successfully saved WAV: {out_path} ({file_size} bytes)")
        assert file_size > 5000, "Generated Egyptian audio file is too small or empty!"

    print("\n[SUCCESS] All Egyptian standalone inference tests passed successfully!")

if __name__ == "__main__":
    asyncio.run(test_standalone_tts())
