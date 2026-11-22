import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app

@pytest.mark.asyncio
async def test_health_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "device" in data
        assert "model_loaded" in data

@pytest.mark.asyncio
async def test_voices_endpoint():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.get("/api/voices")
        assert response.status_code == 200
        data = response.json()
        assert "voices" in data
        voice_ids = [v["id"] for v in data["voices"]]
        assert "ar-EG-SalmaNeural" in voice_ids
        assert "ar-EG-ShakirNeural" in voice_ids
