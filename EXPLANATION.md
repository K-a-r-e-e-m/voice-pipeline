# Voice Pipeline Architecture & Implementation Report

---

## 🇬🇧 English Documentation

### 1. Overview & Objectives
This project implements the backend gateway and end-to-end integration for an Arabic Voice Pipeline:
$$\text{Frontend} \longrightarrow \text{NestJS Gateway} \longrightarrow \text{STT (gRPC)} \longrightarrow \text{NestJS} \longrightarrow \text{TTS (gRPC)} \longrightarrow \text{Frontend}$$

The system is architected as clean microservices communicating through high-performance **gRPC**, decoupled from the application gateway. Although the current phase directly forwards the transcribed text into the TTS engine, a dedicated **LLM Extension Hook** has been engineered inside the NestJS pipeline service to allow effortless integration of conversational AI models (e.g., local LLMs, GPT, Claude, or custom Arabic fine-tuned models) in the next phase.

---

### 2. Inspection of Existing Projects & Audio Formats

#### A. STT (Speech-to-Text / ASR) Service
* **Model**: `CohereLabs/cohere-transcribe-arabic-07-2026` via Hugging Face Transformers.
* **Input Audio**: 16,000 Hz (16 kHz), 16-bit Mono PCM (or standard audio files like WAV, MP3, FLAC).
* **Processing**: Audio is normalized to float32 NumPy arrays via [app/audio.py](file:///d:/PROGRAMMING/Inflaixus/arabic-asr-service/app/audio.py), processed by `CohereAsrForConditionalGeneration`, returning transcribed Arabic text and telemetry metrics.

#### B. TTS (Text-to-Speech) Service (`tts/` folder)
* **Model**: `ehabnegm/lahgtna-omnivoice-egyptian-v3` (`OmniVoice`) in [tts/backend/app/services/tts_service.py](file:///d:/PROGRAMMING/Inflaixus/arabic-asr-service/tts/backend/app/services/tts_service.py).
* **Output Audio**: 24,000 Hz (24 kHz), 16-bit Mono WAV / PCM.
* **Voices / Modes**:
  * `lahgtna-v3-balanced`: 8 diffusion steps (balanced latency and acoustic quality).
  * `lahgtna-v3-fast`: 4 diffusion steps (ultra-fast latency).
  * `lahgtna-v3-studio`: 16 diffusion steps (high fidelity).
* **Text Preprocessing**: Handles Arabic digits to words (`num2words`), removes Latin characters, strips MSA harakat to retain colloquial natural Egyptian phrasing, and splits clauses.

---

### 3. gRPC Contract Definitions (`proto/`)

Because the existing Python services originally provided only FastAPI REST and WebSocket interfaces, clean gRPC protocol buffers were created to decouple communication:

1. **`proto/stt.proto`**:
   ```protobuf
   syntax = "proto3";
   package stt;

   service STTService {
     rpc Transcribe (AudioRequest) returns (TranscriptionResponse);
   }

   message AudioRequest {
     bytes audio_data = 1;
     string audio_format = 2;
     int32 sample_rate = 3;
   }

   message TranscriptionResponse {
     string text = 1;
     float duration_seconds = 2;
     float inference_time_seconds = 3;
     float rtf = 4;
     string status = 5;
     string error_message = 6;
   }
   ```

2. **`proto/tts.proto`**:
   ```protobuf
   syntax = "proto3";
   package tts;

   service TTSService {
     rpc Synthesize (SynthesizeRequest) returns (SynthesizeResponse);
   }

   message SynthesizeRequest {
     string text = 1;
     string voice = 2;
     float speed = 3;
     float pitch = 4;
   }

   message SynthesizeResponse {
     bytes audio_data = 1;
     int32 sample_rate = 2;
     string audio_format = 3;
     float inference_time_seconds = 4;
     string status = 5;
     string error_message = 6;
   }
   ```

---

### 4. NestJS Gateway Architecture (`nest-backend/`)

The NestJS backend acts as the central orchestration gateway. It is structured into decoupled modules:

* [nest-backend/src/stt/](file:///d:/PROGRAMMING/Inflaixus/arabic-asr-service/nest-backend/src/stt/):
  * `SttModule` registers the gRPC client (`@nestjs/microservices`) connecting to `localhost:50051`.
  * `SttService` wraps `transcribe(audioBuffer, format, sampleRate)` using RxJS and converts responses into promises.
* [nest-backend/src/tts/](file:///d:/PROGRAMMING/Inflaixus/arabic-asr-service/nest-backend/src/tts/):
  * `TtsModule` registers the gRPC client connecting to `localhost:50052`.
  * `TtsService` wraps `synthesize(text, voice, speed, pitch)` targeting OmniVoice TTS.
* [nest-backend/src/pipeline/](file:///d:/PROGRAMMING/Inflaixus/arabic-asr-service/nest-backend/src/pipeline/):
  * `PipelineService`: Orchestrates the complete flow and houses the `processWithLlm(text)` hook.
  * `PipelineController`: Exposes REST endpoints:
    * `POST /pipeline/process`: Accepts audio file uploads (`multipart/form-data`).
    * `POST /pipeline/process-base64`: Accepts Base64-encoded audio JSON payload.
    * `GET /pipeline/health`: Health status and service diagnostics.

```typescript
// NestJS LLM Extension Hook in pipeline.service.ts
async processWithLlm(transcribedText: string): Promise<string> {
  this.logger.log(`[LLM Hook] Passthrough mode. Input: "${transcribedText}"`);
  // Future phase: Call LLM API (OpenAI / Anthropic / Local vLLM)
  // const reply = await this.llmService.generate(transcribedText);
  // return reply;
  return transcribedText;
}
```

---

### 5. Testing Frontend Client (`frontend/`)

In strict accordance with the requirements:
* **Clean & Minimalist Aesthetics**: Pure white/light background (`#ffffff`), subtle borders (`#e5e7eb`), modern sans-serif & Arabic typography (`Cairo`, `Inter`).
* **Zero Bloat**: No dark-mode cyberpunk neon, glowing cards, or distracting animations.
* **Core Functionality**:
  * Record / Stop microphone toggle with live duration counter.
  * File upload option for testing with pre-recorded WAV/MP3 files.
  * Voice preset dropdown (Balanced, Fast, Studio).
  * Arabic transcribed text display box.
  * Built-in HTML5 audio player for instant playback of synthesized speech.
  * Latency diagnostics display (STT duration, TTS duration, Total E2E).

---

### 6. Robust Cross-Platform Enhancements
1. **Batch Launcher & Console Fix**:
   - Resolved the CMD syntax error where unescaped `&` in batch scripts evaluated `Frontend` as an internal command.
   - Replaced Windows `timeout` with non-blocking, cross-compatible ping delays to avoid `Input redirection is not supported` errors.
   - Enforced `chcp 65001` (UTF-8 encoding) and `PYTHONIOENCODING=utf-8` across all launchers so Arabic transcriptions and logs render without encoding crashes.
   - Added automatic browser opening to `http://localhost:3000/`.

2. **Client-Side 16 kHz WAV Audio Recording**:
   - Browser `MediaRecorder` defaults to container formats like WebM/Opus which standard audio libraries (like `libsndfile`) cannot decode directly on Windows.
   - The frontend was upgraded with a Web Audio API recorder that samples and normalizes microphone input to **pure 16,000 Hz 16-bit Mono WAV** directly in the browser before transmission.
   - For uploaded files, the browser decodes and resamples them via `AudioContext.decodeAudioData` to 16 kHz WAV, ensuring zero decoding failures at the STT layer.

---

### 7. How to Run the Services

#### Option A: One-Click Launcher (Windows)
Double-click [start_all.bat](file:///d:/PROGRAMMING/Inflaixus/arabic-asr-service/start_all.bat). It will launch STT gRPC, TTS gRPC, and NestJS in separate terminal windows and open `http://localhost:3000/`.

#### Option B: Manual Execution

1. **Start STT gRPC Server (Port 50051)**:
   ```powershell
   .\.venv-test\Scripts\python.exe app\stt_grpc_server.py
   ```

2. **Start TTS gRPC Server (Port 50052)**:
   ```powershell
   .\.venv-test\Scripts\python.exe tts\tts_grpc_server.py
   ```

3. **Start NestJS Gateway (Port 3000)**:
   ```powershell
   cd nest-backend
   node dist/main.js
   ```

4. **Access the Testing Frontend**:
   Open [http://localhost:3000/](http://localhost:3000/) in your web browser.

---
---

## 🇸🇦 الشرح والتوثيق باللغة العربية

### 1. نظرة عامة والهدف من المشروع
تم بناء الخادم الخلفي (Backend) لمنظومة معالجة الصوت التفاعلية باستخدام إطار العمل **NestJS** وفق المسار المطلوب:
$$\text{Frontend (الواجهة)} \longrightarrow \text{NestJS} \longrightarrow \text{STT (gRPC)} \longrightarrow \text{NestJS} \longrightarrow \text{TTS (gRPC)} \longrightarrow \text{Frontend}$$

المنظومة مصممة وفق معمارية الخدمات المصغرة (Microservices) المستقلة عبر بروتوكول **gRPC** لضمان أعلى سرعة وأقل زمن استجابة (Low Latency). كما تم تجهيز طبقة معمارية نظيفة (Hook) لإدراج النموذج اللغوي (LLM) مستقبلاً بين مرحلتي تحويل الصوت لنص وتحويل النص لصوت.

---

### 2. فحص المشاريع الموجودة وصيغ الصوت

#### أ. خدمة تحويل الصوت إلى نص (STT / ASR)
* **المكان**: داخل المجلد [app/](file:///d:/PROGRAMMING/Inflaixus/arabic-asr-service/app/).
* **النموذج**: `CohereLabs/cohere-transcribe-arabic-07-2026`.
* **صيغة الصوت**: 16,000 هرتز (16 kHz)، أحادي القناة (Mono)، ترميز 16-bit PCM (أو ملفات WAV / MP3).
* **آلية المعالجة**: قراءة الصوت وتطبيعه عبر [app/audio.py](file:///d:/PROGRAMMING/Inflaixus/arabic-asr-service/app/audio.py) وتمريره للنموذج لإنتاج النص العربي مع مقاييس الأداء الزمني.

#### ب. خدمة توليد الصوت من النص (TTS)
* **المكان**: داخل المجلد [tts/](file:///d:/PROGRAMMING/Inflaixus/arabic-asr-service/tts/).
* **النموذج**: `ehabnegm/lahgtna-omnivoice-egyptian-v3` المخصص للهجة المصرية في [tts/backend/app/services/tts_service.py](file:///d:/PROGRAMMING/Inflaixus/arabic-asr-service/tts/backend/app/services/tts_service.py).
* **صيغة الصوت المخرج**: 24,000 هرتز (24 kHz)، أحادي القناة (Mono)، ترميز WAV / PCM 16-bit.
* **أنماط الصوت المتوفرة**:
  * `lahgtna-v3-balanced`: النمط المتوازن (8 خطوات توليد - جودة ممتازة وزمن سريع).
  * `lahgtna-v3-fast`: النمط فائق السرعة (4 خطوات توليد).
  * `lahgtna-v3-studio`: جودة استوديو (16 خطوة توليد).

---

### 3. عقود بروتوكول gRPC (`proto/`)
تم إنشاء ملفات التعريف الخاصة بـ gRPC لربط الخدمات دون التعديل على منطق النماذج الداخلية:
1. **`proto/stt.proto`**: يحدد خدمة `STTService` ودالة `Transcribe` لاستقبال بيانات الصوت وإرجاع النص المحول ومقاييس المعالجة.
2. **`proto/tts.proto`**: يحدد خدمة `TTSService` ودالة `Synthesize` لاستقبال النص وإرجاع ملف الصوت (WAV) ومعدل العينات.

---

### 4. بنية خادم NestJS (`nest-backend/`)
تم بناء الخادم وفق أفضل ممارسات NestJS والتقسيم المعياري النظيف:
* **`SttModule` & `SttService`**: عميل gRPC يتصل بالمنفذ `50051`.
* **`TtsModule` & `TtsService`**: عميل gRPC يتصل بالمنفذ `50052`.
* **`PipelineService`**: المسؤول عن إدارة تدفق البيانات بالكامل، ويحتوي على نقطة التوسعة `processWithLlm`:
  * في الوقت الحالي: تمرير النص مباشرة (Passthrough).
  * مستقبلاً: استدعاء نموذج LLM لتوليد الردود الذكية قبل إرسالها لـ TTS.
* **`PipelineController`**: يوفر واجهات برمجية REST:
  * `POST /pipeline/process`: استقبال ملف الصوت المسجل ومعالجته.
  * `POST /pipeline/process-base64`: استقبال الصوت بصيغة Base64.
  * `GET /pipeline/health`: فحص حالة المنظومة.

---

### 5. واجهة المستخدم البسيطة (`frontend/`)
تم تصميم الواجهة بدقة وفق تعليمات التصميم:
* خلفية بيضاء ونظيفة بدون ألوان داكنة أو تدرجات نيون أو بطاقات مضيئة.
* زر تسجيل وإيقاف واضح مع مؤشر زمني للتسجيل.
* صندوق لعرض النص العربي المحول من الصوت مع دعم كامل لاتجاه الكتابة (RTL).
* مشغل صوتي لتشغيل الصوت الناتج عن التوليف مباشرة.
* إحصائيات زمن المعالجة (زمن STT، زمن TTS، والزمن الإجمالي).

---

### 6. تشغيل النظام واختباره
* **التشغيل التلقائي**: تشغيل الملف [start_all.bat](file:///d:/PROGRAMMING/Inflaixus/arabic-asr-service/start_all.bat).
* **التشغيل اليدوي**:
  1. تشغيل STT: `.\.venv-test\Scripts\python.exe app\stt_grpc_server.py`
  2. تشغيل TTS: `.\.venv-test\Scripts\python.exe tts\tts_grpc_server.py`
  3. تشغيل NestJS: `cd nest-backend && node dist/main.js`
  4. فتح المتصفح على: [http://localhost:3000/](http://localhost:3000/)
