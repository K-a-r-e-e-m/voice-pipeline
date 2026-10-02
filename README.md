# Arabic ASR Studio

> A high-performance, professional local web application for testing and demonstrating real-time Arabic Speech-to-Text (ASR) with Voice Activity Detection (VAD), live audio streaming, and deep performance telemetry.

[![Model: CohereLabs/cohere-transcribe-arabic-07-2026](https://img.shields.io/badge/Model-cohere--transcribe--arabic--07--2026-blue)](https://huggingface.co/CohereLabs/cohere-transcribe-arabic-07-2026)
[![PyTorch](https://img.shields.io/badge/PyTorch-2.5.1%2Bcu118-red.svg)](https://pytorch.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115%2B-green.svg)](https://fastapi.tiangolo.com/)
[![CUDA](https://img.shields.io/badge/CUDA-11.8-76B900.svg)](https://developer.nvidia.com/cuda-toolkit)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

---

## Overview

**Arabic ASR Studio** is an end-to-end local testing suite built specifically for evaluating and benchmarking modern Arabic speech recognition models on local hardware. 

Instead of relying on cloud APIs or impractical token-level streaming hacks, the system implements **audio-level continuous streaming**:
1. The browser continuously captures microphone audio and resamples it to **16 kHz 16-bit PCM**.
2. Audio chunks are streamed over a low-latency **WebSocket** connection to a local FastAPI backend.
3. A local **Silero VAD** engine segments continuous speech into discrete sentences/utterances based on conversational silence.
4. Completed utterances are fed directly to a resident **Cohere Arabic ASR model** on the GPU (`cuda:0` with `torch.bfloat16`).
5. Transcriptions, technical audio quality metrics, GPU memory usage, and precise latency benchmarks appear immediately in the UI.

---

## Key Features

- **Resident GPU Model**: Loaded once at server startup and kept in VRAM. Eliminates per-request cold starts.
- **Local Silero VAD**: Accurate speech onset and offset detection running locally on CPU via TorchScript without external dependencies.
- **3 Operating Modes**:
  - **Live Stream (VAD)**: Hands-free conversation mode. Speaks naturally; VAD detects sentence completion and transcribes automatically.
  - **Manual Record**: Push-to-start / push-to-stop recording for specific phrases or noisy environments.
  - **Audio File Upload**: Upload pre-recorded audio files (`.wav`, `.mp3`, `.flac`, `.ogg`) for instant transcription and benchmarking.
- **Microphone Signal Quality Diagnostics**:
  - Live oscilloscope waveform rendering.
  - Real-time RMS volume meter and peak level monitoring.
  - Signal warnings for silence, low gain, or digital clipping.
- **Exact Segment Playback**: Every recognized sentence is saved as a discrete WAV file (`audio/<utterance_id>.wav`) and can be played back, scrubbed, or downloaded directly from the UI.
- **Comprehensive Benchmarks & Telemetry**:
  - Audio duration, ASR GPU inference time, End-to-End (E2E) latency, Real-Time Factor (RTF), and speed factor.
  - Session-level aggregate statistics (average RTF, min/max E2E latency, total speech processed).
  - Live GPU VRAM allocation meter (NVIDIA Quadro P5000 / CUDA).
- **Ground-Truth Accuracy Evaluation (WER / CER)**:
  - Enter reference text for any sentence.
  - Automatically calculates Word Error Rate (WER) and Character Error Rate (CER).
  - Edit operation breakdown (Substitutions, Insertions, Deletions, Correct Hits).
  - Built-in Arabic text normalization layer (removes diacritics/tashkeel, unifies Alef, Yeh, and Teh Marbuta).
- **100% Local & Private**: No audio or data leaves your machine.

---

## System Architecture & Audio Flow

```
[ Browser Microphone ]
        │
        ▼ (Web Audio API)
[ Resampler: Native -> 16 kHz 16-bit Mono PCM ]
        │
        ▼ (Binary WebSocket Frame)
[ FastAPI WebSocket /ws/live ]
        │
        ▼ (Streaming Buffer)
[ Local Silero VAD Segmenter ]
   ├── Speech Start  ──> Emits "speaking" state to UI
   └── Silence End   ──> Emits completed audio segment (with 300ms pre-roll)
        │
        ▼
[ Utterance WAV Serialization ] ──> Saved to disk (audio/utt_*.wav)
        │
        ▼
[ ASR Service (GPU: cuda:0, torch.bfloat16) ]
   ├── torch.cuda.synchronize()
   ├── model.generate()
   └── torch.cuda.synchronize()
        │
        ▼
[ Metrics Calculation: RTF, Latency, Diagnostics ]
        │
        ▼ (JSON Message via WebSocket)
[ UI Render: Arabic Card + Audio Player + Metric Badges ]
```

---

## Technology Stack

- **Backend**: Python 3.11, FastAPI, Uvicorn (WebSockets), PyTorch 2.5.1 + CUDA 11.8, Hugging Face Transformers.
- **ASR Model**: `CohereLabs/cohere-transcribe-arabic-07-2026` (`CohereAsrForConditionalGeneration`).
- **Voice Activity Detection**: `silero-vad` (TorchScript execution on CPU).
- **Evaluation**: `jiwer`, `rapidfuzz`.
- **Audio Processing**: `soundfile`, `librosa`, `scipy`, `numpy`.
- **Frontend**: Vanilla HTML5, Modern CSS3 (Dark Theme, Cairo typography, responsive cards), Vanilla JavaScript (Web Audio API, Canvas oscilloscope).

---

## Hardware & Environment Requirements

- **Operating System**: Windows 10 / 11, Linux, or macOS (NVIDIA GPU recommended for high throughput).
- **GPU**: NVIDIA GPU with CUDA support (Tested on NVIDIA Quadro P5000 16GB, Pascal architecture / compute capability 6.1).
- **VRAM**: ~4 GB VRAM required for resident model weights in `bfloat16`.
- **Python**: Python 3.11 recommended.

---

## Installation & Setup

### 1. Activate Environment
Open PowerShell inside the project root:

```powershell
# If using the provided virtual environment:
.\.venv-test\Scripts\Activate.ps1
```

Or install requirements in a fresh virtual environment:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2. Verify CUDA and Baseline Inference
Run the baseline reference benchmark script:

```powershell
cmd /c "set PYTHONIOENCODING=utf-8 && python test_inference.py"
```

Expected output:
```text
Model device: cuda:0
Model dtype: torch.bfloat16
Inference time: ~1.1 seconds
Audio duration: 6.0 seconds
RTF: ~0.18
```

---

## Running the Web Application

Start the local server using Uvicorn:

```powershell
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Once started, open your web browser and navigate to:

```
http://localhost:8000
```

---

## Using the Application

### 1. Live Mode (Hands-Free VAD)
1. Ensure your desired microphone is selected from the dropdown.
2. Click **START**.
3. Speak Arabic naturally. The status badge will switch to `● SPEAKING` when speech is detected.
4. When you stop speaking, the VAD detects silence (default 500 ms) and updates status to `◐ PROCESSING`.
5. The transcribed Arabic text appears in a new card alongside its audio player, ASR latency, E2E latency, and RTF.
6. Continue speaking next sentences without pressing anything, or click **STOP** when finished.

### 2. Manual Mode
1. Click the **Manual Record** tab.
2. Click **START** to begin capturing audio.
3. Speak your phrase or sentence.
4. Click **STOP** to finalize recording and transcribe the entire captured audio segment.

### 3. File Upload Mode
1. Click the **Audio File Upload** tab.
2. Drag and drop any audio file (`.wav`, `.mp3`, `.flac`, `.ogg`) or click **Select Audio File**.
3. The server resamples the audio to 16 kHz Mono, runs inference on the GPU, and returns the transcription and metrics.

### 4. Accuracy Evaluation (WER / CER)
1. On any transcription card, click **🎯 Accuracy Evaluation (Ground-Truth Reference)**.
2. Type or paste the reference Arabic text into the input field.
3. Keep **Arabic Normalization** checked (removes diacritics, unifies Alef forms `أ/إ/آ` to `ا`, `ة` to `ه`, `ى` to `ي`).
4. Click **Calculate Accuracy** to inspect Word Error Rate (WER), Character Error Rate (CER), and substitution/insertion/deletion counts.

---

## Performance Metrics Definitions

| Metric | Definition | Example Value |
| :--- | :--- | :--- |
| **Audio Duration** | Length of the speech audio segment in seconds. | `3.21 s` |
| **ASR Latency** | Pure GPU inference time measured with `torch.cuda.synchronize()`. | `0.68 s` |
| **End-to-End Latency** | Time elapsed from the moment silence is detected until transcription renders in the browser. | `0.74 s` |
| **Real-Time Factor (RTF)** | Ratio of ASR inference time to audio duration (`Inference Time / Audio Duration`). Lower is faster; `< 1.0` is faster than real-time. | `0.21` |
| **Speed Factor** | Multiplier indicating how many times faster than real-time inference completed (`1 / RTF`). | `4.76x` |

---

## Project Structure

```
arabic-asr-service/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI server, REST routes, lifespan model startup
│   ├── asr.py               # Singleton ASR service, model warmup, GPU inference
│   ├── vad.py               # Silero VAD audio stream buffer & utterance segmenter
│   ├── websocket.py         # WebSocket live streaming handler & state machine
│   ├── audio.py             # Audio utilities (WAV writer, resampling, volume/RMS)
│   ├── metrics.py           # Latency, RTF, GPU VRAM tracking, WER/CER evaluation
│   └── config.py            # Global configuration and default parameters
├── static/
│   ├── index.html           # Dark-theme dashboard UI
│   ├── style.css            # Responsive modern styling & Cairo Arabic typography
│   └── app.js               # Web Audio capture, WebSocket client, oscilloscope
├── audio/                   # Stored utterance audio files (.wav)
│   └── .gitkeep
├── test_inference.py        # Preserved baseline benchmark script
├── requirements.txt         # Pinned Python package dependencies
├── README.md                # English documentation & repository overview
└── README_AR.md             # In-depth Arabic developer guide
```

---

## Security & Privacy Notice

This application runs **100% locally**. Microphone audio and uploaded files are processed directly on your local machine and GPU. No telemetry, audio data, or model inputs are transmitted to external cloud services.

---

## License

This project is licensed under the Apache 2.0 License.
