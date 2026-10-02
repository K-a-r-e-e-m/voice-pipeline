# Arabic Voice Pipeline (STT + TTS via gRPC & NestJS)

> A production-ready, low-latency end-to-end Arabic voice assistant pipeline combining resident GPU-accelerated **Arabic Speech-to-Text (STT)**, **OmniVoice Arabic Text-to-Speech (TTS)**, and an intelligent **NestJS Gateway Orchestrator** connected via high-performance **gRPC microservices**.

---

## 🏗️ System Architecture & Workflow

```text
[ Browser / Web Client ] (http://localhost:3000)
       │ ▲
       │ │ Audio Stream / Base64 & Audio Response
       ▼ │
┌────────────────────────────────────────────────────────┐
│              NestJS Voice Gateway (:3000)              │
│  - Pipeline Orchestration & REST Endpoints             │
│  - Static Frontend Web Server                          │
│  - Conversational Assistant Logic                      │
└───────┬────────────────────────────────────────▲───────┘
        │                                        │
        │ 1. gRPC Audio Request                  │ 3. gRPC Synthesize Request
        │    (Port :50051)                       │    (Port :50052)
        ▼                                        │
┌───────────────────────────┐        ┌───────────┴───────────────┐
│     STT gRPC Service      │        │     TTS gRPC Service      │
│  Cohere Transcribe Arabic │        │   OmniVoice Egyptian TTS  │
│  (Port :50051, GPU/CUDA)  │        │   (Port :50052, GPU/CUDA) │
└───────────┬───────────────┘        └───────────────────────────┘
            │                                    ▲
            ▼                                    │
     Transcribed Text  ──────────────────────────┘
```

### End-to-End Pipeline Workflow:
1. **Audio Capture**: The browser records user speech and sends the audio to the NestJS Gateway (`POST /pipeline/process` or `/pipeline/process-base64`).
2. **Speech-to-Text (STT)**: NestJS transmits the raw audio over low-latency binary **gRPC** (port `50051`) to the Python STT service powered by `CohereLabs/cohere-transcribe-arabic-07-2026`.
3. **Dialogue / Assistant Logic**: The transcribed Arabic text is processed by `AssistantService` in NestJS to determine the appropriate response.
4. **Text-to-Speech (TTS)**: NestJS sends the generated response text over **gRPC** (port `50052`) to the Python OmniVoice TTS service, which synthesizes natural Arabic audio.
5. **Playback**: NestJS returns the synthesized audio (WAV / Base64) to the web UI for immediate playback.

---

## 📁 Project Structure

| Directory / File | Description |
| :--- | :--- |
| **`nest-backend/`** | **NestJS API Gateway**: Orchestrates the voice pipeline, hosts REST endpoints (`/pipeline/*`), communicates with STT & TTS over gRPC, and serves the frontend client. |
| **`app/`** | **STT Microservice & Engine**: Contains `stt_grpc_server.py` (gRPC port `50051`), resident GPU model loader (`asr.py`), Silero VAD segmentation (`vad.py`), and FastAPI WebSocket server (`main.py`). |
| **`tts/`** | **TTS Microservice**: Contains `tts_grpc_server.py` (gRPC port `50052`), model downloaders, and the OmniVoice Arabic speech synthesis engine. |
| **`proto/`** | **Protocol Buffers**: Defines gRPC contracts (`stt.proto`, `tts.proto`) and generated Python/TypeScript stubs for cross-service communication. |
| **`frontend/`** | **Web Assistant Client**: Interactive conversational UI with audio recorder, waveform visualizer, and response audio player served at `http://localhost:3000`. |
| **`static/`** | **Standalone ASR Studio UI**: Web dashboard used exclusively when running the standalone FastAPI ASR testing server on port `8000`. |
| **`audio/`** | **Audio Storage**: Local folder for storing recorded utterances and test audio segments (all `.wav` ignored in git via `.gitignore`). |
| **`start_all.bat`** | One-click launcher that boots all 3 services concurrently. |
| **`test_pipeline_e2e.py`** | CLI test script verifying both STT and TTS gRPC connections. |

---

## 🚀 How to Run the Project

### Prerequisites
1. **Python 3.11** with CUDA support.
2. **Node.js (v18+)** for NestJS backend.
3. Install dependencies:
   ```powershell
   # 1. Python dependencies (in your virtualenv)
   pip install -r requirements.txt

   # 2. NestJS dependencies
   cd nest-backend
   npm install
   npm run build
   cd ..
   ```

---

### Option A: One-Click Quick Start (Recommended)

Simply double-click or run:
```powershell
.\start_all.bat
```
This automatically launches:
1. `STT gRPC Service` on **`localhost:50051`**
2. `TTS gRPC Service` on **`localhost:50052`**
3. `NestJS Gateway` on **`localhost:3000`**
4. Opens your browser to **`http://localhost:3000`**

---

### Option B: Manual Step-by-Step Execution

Open 3 separate terminals:

#### Terminal 1 — Start STT gRPC Server (:50051)
```powershell
python app/stt_grpc_server.py
```

#### Terminal 2 — Start TTS gRPC Server (:50052)
```powershell
python tts/tts_grpc_server.py
```

#### Terminal 3 — Start NestJS Gateway (:3000)
```powershell
cd nest-backend
npm run start:prod
# Or in development mode:
# npm run start:dev
```

Open your browser at:
```
http://localhost:3000
```

---

### Option C: Standalone ASR Testing Studio (Optional)
If you only want to test real-time ASR with live WebSocket streaming and VAD (without TTS or NestJS):
```powershell
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```
Open: `http://localhost:8000`

---

## 🧪 Testing the Services

Verify the gRPC services directly using the end-to-end Python test script:

```powershell
# Test both STT and TTS gRPC endpoints:
python test_pipeline_e2e.py both

# Or test STT only:
python test_pipeline_e2e.py stt

# Or test TTS only:
python test_pipeline_e2e.py tts
```

Check NestJS Gateway health:
```
GET http://localhost:3000/pipeline/health
```

---

## 🔒 Security Note
Private tokens (e.g. Hugging Face tokens), virtual environments (`.venv*`), `node_modules/`, and generated `.wav` files are excluded by `.gitignore`. Never commit `.token` or `.env` files to source control.
