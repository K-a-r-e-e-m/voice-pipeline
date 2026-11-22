import json
import pytest
from starlette.testclient import TestClient
from app.main import app
from app.services.tts_service import TTSService

@pytest.fixture(scope="module", autouse=True)
def init_models():
    tts_service = TTSService.get_instance()
    if not tts_service.is_loaded:
        tts_service.load_models()

def test_websocket_egyptian_salma_synthesis():
    client = TestClient(app)
    with client.websocket_connect("/ws/tts") as ws:
        ws.send_text(json.dumps({
            "type": "synthesize",
            "text": "مساء الفل يا باشا، نورت الدنيا!",
            "voice": "ar-EG-SalmaNeural"
        }))

        # 1. Expect audio_start
        msg1 = ws.receive_text()
        data1 = json.loads(msg1)
        assert data1["type"] == "audio_start"
        assert data1["sample_rate"] == 24000

        # 2. Expect binary audio chunks
        chunk_count = 0
        while True:
            msg = ws.receive()
            if "bytes" in msg:
                chunk_count += 1
                assert len(msg["bytes"]) > 0
            elif "text" in msg:
                end_data = json.loads(msg["text"])
                if end_data.get("type") == "audio_end":
                    break

        assert chunk_count > 0, "No audio chunks were streamed!"

def test_websocket_egyptian_shakir_synthesis():
    client = TestClient(app)
    with client.websocket_connect("/ws/tts") as ws:
        ws.send_text(json.dumps({
            "type": "synthesize",
            "text": "أهلاً وسهلاً بيك يا فنان، مرحب بيك معانا.",
            "voice": "ar-EG-ShakirNeural"
        }))

        msg1 = ws.receive_text()
        data1 = json.loads(msg1)
        assert data1["type"] == "audio_start"
        assert data1["sample_rate"] == 24000

        chunk_count = 0
        while True:
            msg = ws.receive()
            if "bytes" in msg:
                chunk_count += 1
            elif "text" in msg:
                end_data = json.loads(msg["text"])
                if end_data.get("type") == "audio_end":
                    break

        assert chunk_count > 0

def test_websocket_empty_text():
    client = TestClient(app)
    with client.websocket_connect("/ws/tts") as ws:
        ws.send_text(json.dumps({
            "type": "synthesize",
            "text": "   "
        }))
        msg = ws.receive_text()
        data = json.loads(msg)
        assert data["type"] == "error"
        assert "empty" in data["message"].lower()

def test_websocket_invalid_json():
    client = TestClient(app)
    with client.websocket_connect("/ws/tts") as ws:
        ws.send_text("THIS IS NOT JSON")
        msg = ws.receive_text()
        data = json.loads(msg)
        assert data["type"] == "error"
