// Arabic ASR Studio - Frontend Client Controller

class ArabicASRApp {
  constructor() {
    this.currentMode = "live"; // "live", "manual", "file"
    this.isRecording = false;
    this.recordingStartTime = 0;
    this.timerInterval = null;
    this.utteranceCounter = 0;

    // Web Audio State
    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.analyserNode = null;
    this.animationFrameId = null;

    // WebSocket State
    this.ws = null;
    this.wsConnected = false;

    // Settings
    this.settings = {
      silence_timeout_ms: 500,
      min_speech_ms: 250,
      vad_threshold: 0.5,
      max_utterance_seconds: 25.0,
      auto_play: false,
    };

    // Cache DOM Elements
    this.dom = {
      tabLive: document.getElementById("tabLive"),
      tabManual: document.getElementById("tabManual"),
      tabFile: document.getElementById("tabFile"),
      micControlPanel: document.getElementById("micControlPanel"),
      fileUploadPanel: document.getElementById("fileUploadPanel"),
      micSelect: document.getElementById("micSelect"),
      permPill: document.getElementById("permPill"),
      mainRecordBtn: document.getElementById("mainRecordBtn"),
      recordBtnText: document.getElementById("recordBtnText"),
      clearSessionBtn: document.getElementById("clearSessionBtn"),
      sessionTimer: document.getElementById("sessionTimer"),
      appStatusPill: document.getElementById("appStatusPill"),
      statusPulseDot: document.getElementById("statusPulseDot"),
      statusLabel: document.getElementById("statusLabel"),
      connPill: document.getElementById("connPill"),
      connDot: document.getElementById("connDot"),
      connText: document.getElementById("connText"),
      gpuDeviceName: document.getElementById("gpuDeviceName"),
      gpuVramText: document.getElementById("gpuVramText"),
      waveformCanvas: document.getElementById("waveformCanvas"),
      meterFill: document.getElementById("meterFill"),
      meterDbText: document.getElementById("meterDbText"),
      micQualityBadge: document.getElementById("micQualityBadge"),
      feedEmptyState: document.getElementById("feedEmptyState"),
      transcriptionFeed: document.getElementById("transcriptionFeed"),
      utteranceCounter: document.getElementById("utteranceCounter"),
      statUtterances: document.getElementById("statUtterances"),
      statTotalAudio: document.getElementById("statTotalAudio"),
      statAvgAsr: document.getElementById("statAvgAsr"),
      statAvgE2e: document.getElementById("statAvgE2e"),
      statAvgRtf: document.getElementById("statAvgRtf"),
      statMinMaxE2e: document.getElementById("statMinMaxE2e"),
      toggleDebugBtn: document.getElementById("toggleDebugBtn"),
      clearDebugBtn: document.getElementById("clearDebugBtn"),
      debugBody: document.getElementById("debugBody"),
      debugTerminal: document.getElementById("debugTerminal"),
      openSettingsBtn: document.getElementById("openSettingsBtn"),
      closeSettingsBtn: document.getElementById("closeSettingsBtn"),
      settingsModal: document.getElementById("settingsModal"),
      saveSettingsBtn: document.getElementById("saveSettingsBtn"),
      settingSilenceTimeout: document.getElementById("settingSilenceTimeout"),
      valSilenceTimeout: document.getElementById("valSilenceTimeout"),
      settingMinSpeech: document.getElementById("settingMinSpeech"),
      valMinSpeech: document.getElementById("valMinSpeech"),
      settingThreshold: document.getElementById("settingThreshold"),
      valThreshold: document.getElementById("valThreshold"),
      settingMaxUtterance: document.getElementById("settingMaxUtterance"),
      valMaxUtterance: document.getElementById("valMaxUtterance"),
      settingAutoPlay: document.getElementById("settingAutoPlay"),
      dropzone: document.getElementById("dropzone"),
      audioFileInput: document.getElementById("audioFileInput"),
      selectFileBtn: document.getElementById("selectFileBtn"),
      fileUploadProgress: document.getElementById("fileUploadProgress"),
    };

    this.init();
  }

  init() {
    this.setupEventListeners();
    this.initWebSocket();
    this.populateMicrophoneDevices();
    this.fetchGpuMetrics();
    this.logDebug("Client initialized");
  }

  /* ==========================================================================
     WebSocket Management
     ========================================================================== */
  initWebSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/live`;
    this.logDebug(`Connecting to WebSocket: ${wsUrl}`);

    try {
      this.ws = new WebSocket(wsUrl);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        this.wsConnected = true;
        this.dom.connDot.classList.add("connected");
        this.dom.connDot.classList.remove("disconnected");
        this.dom.connText.textContent = "Connected";
        this.logDebug("WebSocket connected successfully");
        this.sendWsControl({ type: "ping" });
      };

      this.ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const msg = JSON.parse(event.data);
            this.handleWsMessage(msg);
          } catch (e) {
            console.error("JSON parse error from WS:", e);
          }
        }
      };

      this.ws.onclose = () => {
        this.wsConnected = false;
        this.dom.connDot.classList.remove("connected");
        this.dom.connDot.classList.add("disconnected");
        this.dom.connText.textContent = "Disconnected";
        this.updateStatus("idle");
        this.logDebug("WebSocket disconnected. Reconnecting in 3s...");
        setTimeout(() => this.initWebSocket(), 3000);
      };

      this.ws.onerror = (err) => {
        this.logDebug("WebSocket error occurred");
        console.error("WebSocket error:", err);
      };
    } catch (e) {
      this.logDebug(`WebSocket init error: ${e.message}`);
    }
  }

  sendWsControl(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  sendAudioChunk(arrayBuffer) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.isRecording) {
      this.ws.send(arrayBuffer);
    }
  }

  handleWsMessage(msg) {
    switch (msg.type) {
      case "status":
        this.updateStatus(msg.status);
        break;
      case "utterance_started":
        this.updateStatus("speaking");
        break;
      case "utterance_completed":
        this.updateStatus("processing");
        break;
      case "transcription":
        this.handleTranscriptionResult(msg);
        break;
      case "gpu_metrics":
        this.updateGpuDisplay(msg.metrics || msg);
        break;
      case "debug":
        this.logDebug(msg.message);
        break;
      case "session_summary":
      case "session_cleared":
        this.updateSessionStats(msg.session_summary);
        break;
      case "error":
        this.logDebug(`[ERROR] ${msg.message}`);
        this.updateStatus("idle");
        break;
      case "pong":
        if (msg.gpu_metrics) this.updateGpuDisplay(msg.gpu_metrics);
        break;
      default:
        break;
    }
  }

  /* ==========================================================================
     Status & UI State
     ========================================================================== */
  updateStatus(state) {
    const pill = this.dom.appStatusPill;
    pill.className = "live-status-pill";

    switch (state) {
      case "listening":
        pill.classList.add("status-listening");
        this.dom.statusLabel.textContent = "● LISTENING";
        break;
      case "speaking":
        pill.classList.add("status-speaking");
        this.dom.statusLabel.textContent = "● SPEAKING";
        break;
      case "processing":
        pill.classList.add("status-processing");
        this.dom.statusLabel.textContent = "◐ PROCESSING";
        break;
      case "error":
        pill.classList.add("status-idle");
        this.dom.statusLabel.textContent = "✕ ERROR";
        break;
      case "idle":
      default:
        pill.classList.add("status-idle");
        this.dom.statusLabel.textContent = "○ IDLE";
        break;
    }
  }

  updateGpuDisplay(gpu) {
    if (!gpu) return;
    if (gpu.device_name) {
      this.dom.gpuDeviceName.textContent = gpu.device_name;
    }
    if (gpu.display) {
      this.dom.gpuVramText.textContent = `VRAM: ${gpu.display}`;
    }
  }

  async fetchGpuMetrics() {
    try {
      const res = await fetch("/api/gpu");
      if (res.ok) {
        const data = await res.json();
        this.updateGpuDisplay(data);
      }
    } catch (e) {
      console.warn("GPU fetch failed:", e);
    }
  }

  /* ==========================================================================
     Microphone Audio Capture & Resampling (16 kHz 16-bit PCM)
     ========================================================================== */
  async populateMicrophoneDevices() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === "audioinput");

      this.dom.micSelect.innerHTML = '<option value="">Default Microphone</option>';
      audioInputs.forEach((dev, idx) => {
        const option = document.createElement("option");
        option.value = dev.deviceId;
        option.textContent = dev.label || `Microphone ${idx + 1}`;
        this.dom.micSelect.appendChild(option);
      });
    } catch (e) {
      console.warn("Could not enumerate audio devices:", e);
    }
  }

  async startMicrophone() {
    try {
      const selectedDeviceId = this.dom.micSelect.value;
      const constraints = {
        audio: {
          deviceId: selectedDeviceId ? { exact: selectedDeviceId } : undefined,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      };

      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.dom.permPill.textContent = "Granted";
      this.dom.permPill.className = "permission-pill granted";

      // Create AudioContext
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
      const sourceSampleRate = this.audioContext.sampleRate;
      const targetSampleRate = 16000;

      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Create AnalyserNode for visualizer and volume meter
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 512;
      this.analyserNode.smoothingTimeConstant = 0.3;
      this.sourceNode.connect(this.analyserNode);

      // Create ScriptProcessor for streaming chunks
      const bufferSize = 4096;
      this.processorNode = this.audioContext.createScriptProcessor(bufferSize, 1, 1);

      this.processorNode.onaudioprocess = (e) => {
        if (!this.isRecording) return;
        const inputChannelData = e.inputBuffer.getChannelData(0);

        // Resample from sourceSampleRate to 16,000 Hz
        const resampledData = this.resampleAudio(inputChannelData, sourceSampleRate, targetSampleRate);

        // Convert float32 array to 16-bit PCM binary buffer
        const pcm16Buffer = this.floatTo16BitPCM(resampledData);
        this.sendAudioChunk(pcm16Buffer);
      };

      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);

      // Start live visualizer
      this.startVisualizer();

      // Send WebSocket start command
      this.sendWsControl({
        type: "start",
        mode: this.currentMode,
        settings: this.settings,
      });

      this.isRecording = true;
      this.recordingStartTime = Date.now();
      this.startTimer();
      this.dom.recordBtnText.textContent = "STOP";
      this.dom.mainRecordBtn.classList.add("recording");
      this.logDebug(`Microphone capture started (Input SR: ${sourceSampleRate}Hz -> Resampled: 16000Hz)`);
    } catch (err) {
      console.error("Microphone capture failed:", err);
      this.dom.permPill.textContent = "Denied";
      this.dom.permPill.className = "permission-pill denied";
      this.updateStatus("error");
      this.logDebug(`Microphone error: ${err.message}`);
      alert(`Microphone access error: ${err.message}`);
    }
  }

  stopMicrophone() {
    this.isRecording = false;
    this.stopTimer();

    // Send WebSocket stop command
    this.sendWsControl({ type: "stop" });

    // Stop audio nodes
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // Reset visualizer and meter
    this.resetVisualizer();

    this.dom.recordBtnText.textContent = "START";
    this.dom.mainRecordBtn.classList.remove("recording");
    this.updateStatus("idle");
    this.logDebug("Microphone capture stopped");
  }

  resampleAudio(sourceBuffer, sourceRate, targetRate) {
    if (sourceRate === targetRate) {
      return sourceBuffer;
    }
    const ratio = sourceRate / targetRate;
    const newLength = Math.round(sourceBuffer.length / ratio);
    const result = new Float32Array(newLength);

    for (let i = 0; i < newLength; i++) {
      const position = i * ratio;
      const index = Math.floor(position);
      const frac = position - index;
      const sample1 = sourceBuffer[index] || 0;
      const sample2 = sourceBuffer[index + 1] || sample1;
      result[i] = sample1 + frac * (sample2 - sample1);
    }
    return result;
  }

  floatTo16BitPCM(float32Array) {
    const buffer = new ArrayBuffer(float32Array.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < float32Array.length; i++) {
      let s = Math.max(-1, Math.min(1, float32Array[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); // Little endian
    }
    return buffer;
  }

  /* ==========================================================================
     Visualizer & Volume Meter
     ========================================================================== */
  startVisualizer() {
    const canvas = this.dom.waveformCanvas;
    const ctx = canvas.getContext("2d");
    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);

    const draw = () => {
      this.animationFrameId = requestAnimationFrame(draw);
      this.analyserNode.getByteTimeDomainData(dataArray);

      // Render Oscilloscope
      ctx.fillStyle = "rgba(10, 14, 23, 0.5)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#38bdf8";
      ctx.beginPath();

      const sliceWidth = canvas.width / dataArray.length;
      let x = 0;
      let sumSquares = 0;
      let peak = 0;

      for (let i = 0; i < dataArray.length; i++) {
        const v = dataArray[i] / 128.0; // [0, 2] -> 1.0 is zero
        const centered = v - 1.0;
        sumSquares += centered * centered;
        const absVal = Math.abs(centered);
        if (absVal > peak) peak = absVal;

        const y = (v * canvas.height) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.stroke();

      // Compute RMS & dBFS
      const rms = Math.sqrt(sumSquares / dataArray.length);
      const dbfs = rms > 0.0001 ? 20 * Math.log10(rms) : -100;
      const meterPercent = Math.min(100, Math.max(0, (dbfs + 60) * 1.66)); // Range -60dBFS to 0dBFS

      this.dom.meterFill.style.width = `${meterPercent}%`;
      this.dom.meterDbText.textContent = dbfs > -90 ? `${dbfs.toFixed(1)} dBFS` : "-∞ dBFS";

      // Signal quality badge
      if (peak > 0.95) {
        this.dom.micQualityBadge.textContent = "CLIPPING";
        this.dom.micQualityBadge.className = "quality-badge badge-clip";
      } else if (dbfs < -48) {
        this.dom.micQualityBadge.textContent = "QUIET";
        this.dom.micQualityBadge.className = "quality-badge badge-quiet";
      } else {
        this.dom.micQualityBadge.textContent = "GOOD";
        this.dom.micQualityBadge.className = "quality-badge badge-good";
      }
    };

    draw();
  }

  resetVisualizer() {
    const canvas = this.dom.waveformCanvas;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0a0e17";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    this.dom.meterFill.style.width = "0%";
    this.dom.meterDbText.textContent = "-∞ dBFS";
    this.dom.micQualityBadge.textContent = "IDLE";
    this.dom.micQualityBadge.className = "quality-badge badge-quiet";
  }

  startTimer() {
    this.stopTimer();
    this.timerInterval = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - this.recordingStartTime) / 1000);
      const mins = String(Math.floor(elapsedSeconds / 60)).padStart(2, "0");
      const secs = String(elapsedSeconds % 60).padStart(2, "0");
      this.dom.sessionTimer.textContent = `${mins}:${secs}`;
    }, 500);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  /* ==========================================================================
     Transcription Results & Card Rendering
     ========================================================================== */
  handleTranscriptionResult(data) {
    this.utteranceCounter++;
    this.dom.feedEmptyState.classList.add("hidden");
    this.dom.utteranceCounter.textContent = `${this.utteranceCounter} sentence${this.utteranceCounter > 1 ? "s" : ""}`;

    const card = this.createUtteranceCard(data, this.utteranceCounter);
    this.dom.transcriptionFeed.prepend(card);

    if (data.session_summary) {
      this.updateSessionStats(data.session_summary);
    }

    if (this.settings.auto_play && data.audio_url) {
      const audio = new Audio(data.audio_url);
      audio.play().catch((e) => console.warn("Auto-play prevented:", e));
    }
  }

  createUtteranceCard(data, index) {
    const card = document.createElement("div");
    card.className = "utterance-card";
    card.id = `card_${data.utterance_id}`;

    const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const metrics = data.metrics || {};
    const diag = data.audio_diagnostics || {};

    const audioDuration = metrics.audio_duration_seconds != null ? `${metrics.audio_duration_seconds.toFixed(2)}s` : "-";
    const asrLatency = metrics.asr_inference_seconds != null ? `${(metrics.asr_inference_seconds * 1000).toFixed(0)}ms` : "-";
    const e2eLatency = metrics.e2e_latency_seconds != null ? `${(metrics.e2e_latency_seconds * 1000).toFixed(0)}ms` : "-";
    const rtf = metrics.rtf != null ? metrics.rtf.toFixed(2) : "-";
    const speedFactor = metrics.speed_factor != null ? `${metrics.speed_factor}x` : "-";

    card.innerHTML = `
      <div class="card-header">
        <div class="card-meta">
          <span class="utt-badge">Sentence #${index}</span>
          <span class="utt-timestamp">${timeStr}</span>
        </div>
        <div class="card-actions">
          <button class="btn btn-secondary btn-small copy-btn" title="Copy Arabic transcription">Copy</button>
          <a href="${data.audio_url}" download="${data.utterance_id}.wav" class="btn btn-secondary btn-small" title="Download audio WAV">Download</a>
          <button class="btn btn-secondary btn-small delete-btn" title="Delete card">✕</button>
        </div>
      </div>

      <div class="arabic-text-box" dir="rtl">${data.text || "—"}</div>

      <!-- Custom Audio Player -->
      <div class="audio-player-row">
        <button class="play-pause-btn" data-audio-src="${data.audio_url}">▶</button>
        <div class="audio-progress-bar">
          <div class="audio-progress-fill"></div>
        </div>
        <span class="audio-time-label">0:00 / ${audioDuration}</span>
        <audio src="${data.audio_url}" preload="metadata" style="display: none;"></audio>
      </div>

      <!-- Performance Metrics Badges -->
      <div class="card-metrics-grid">
        <div class="metric-pill">
          <span class="metric-pill-label">Audio:</span>
          <span class="metric-pill-value">${audioDuration}</span>
        </div>
        <div class="metric-pill">
          <span class="metric-pill-label">ASR Latency:</span>
          <span class="metric-pill-value">${asrLatency}</span>
        </div>
        <div class="metric-pill">
          <span class="metric-pill-label">End-to-End:</span>
          <span class="metric-pill-value">${e2eLatency}</span>
        </div>
        <div class="metric-pill">
          <span class="metric-pill-label">RTF:</span>
          <span class="metric-pill-value rtf-good">${rtf}</span>
        </div>
        <div class="metric-pill">
          <span class="metric-pill-label">Speed:</span>
          <span class="metric-pill-value">${speedFactor}</span>
        </div>
      </div>

      <!-- Audio Diagnostics Details -->
      <details class="audio-diagnostics-details">
        <summary class="diag-summary">Audio Signal Quality & Details</summary>
        <div class="diag-grid">
          <div class="diag-item"><span>Format:</span><span>${diag.format || "16-bit PCM WAV"}</span></div>
          <div class="diag-item"><span>Sample Rate:</span><span>${diag.sample_rate || 16000} Hz</span></div>
          <div class="diag-item"><span>Samples:</span><span>${diag.samples || "-"}</span></div>
          <div class="diag-item"><span>Peak Amplitude:</span><span>${diag.peak_dbfs != null ? diag.peak_dbfs + " dBFS" : "-"}</span></div>
          <div class="diag-item"><span>RMS Volume:</span><span>${diag.rms_dbfs != null ? diag.rms_dbfs + " dBFS" : "-"}</span></div>
          <div class="diag-item"><span>Quality Status:</span><span>${diag.quality_status || "good"}</span></div>
        </div>
      </details>

      <!-- Accuracy Evaluation Section -->
      <details class="accuracy-accordion">
        <summary class="accordion-summary">🎯 Accuracy Evaluation (Ground-Truth Reference)</summary>
        <div class="accuracy-content">
          <div class="ref-input-group">
            <label>Reference Arabic Text (نص المرجع الحقيقي):</label>
            <input type="text" class="ref-input" placeholder="اكتب النص الحقيقي هنا للمقارنة..." dir="rtl">
          </div>
          <div class="accuracy-options-row">
            <label class="checkbox-label">
              <input type="checkbox" class="eval-norm-toggle" checked>
              <span>Arabic Normalization (إزالة التشكيل وتوحيد الألف والياء)</span>
            </label>
            <button class="btn btn-primary btn-small eval-btn">Calculate Accuracy</button>
          </div>
          <div class="eval-results-box hidden">
            <div class="eval-scores-row">
              <div class="eval-score-item">
                <span class="eval-score-label">Word Error Rate (WER)</span>
                <span class="eval-score-val eval-wer">-</span>
              </div>
              <div class="eval-score-item">
                <span class="eval-score-label">Character Error Rate (CER)</span>
                <span class="eval-score-val eval-cer">-</span>
              </div>
            </div>
            <div class="eval-breakdown">
              <span>Substitutions: <strong class="eval-subs">0</strong></span>
              <span>Insertions: <strong class="eval-ins">0</strong></span>
              <span>Deletions: <strong class="eval-dels">0</strong></span>
              <span>Correct Hits: <strong class="eval-hits">0</strong></span>
            </div>
          </div>
        </div>
      </details>
    `;

    // Attach Player Event Handlers
    const playBtn = card.querySelector(".play-pause-btn");
    const audioElem = card.querySelector("audio");
    const progressFill = card.querySelector(".audio-progress-fill");
    const progressBar = card.querySelector(".audio-progress-bar");
    const timeLabel = card.querySelector(".audio-time-label");

    playBtn.addEventListener("click", () => {
      if (audioElem.paused) {
        // Pause any other playing audio
        document.querySelectorAll("audio").forEach((a) => {
          if (a !== audioElem) a.pause();
        });
        document.querySelectorAll(".play-pause-btn").forEach((b) => {
          if (b !== playBtn) b.textContent = "▶";
        });
        audioElem.play();
        playBtn.textContent = "⏸";
      } else {
        audioElem.pause();
        playBtn.textContent = "▶";
      }
    });

    audioElem.addEventListener("timeupdate", () => {
      if (audioElem.duration) {
        const percent = (audioElem.currentTime / audioElem.duration) * 100;
        progressFill.style.width = `${percent}%`;
        const curMins = Math.floor(audioElem.currentTime / 60);
        const curSecs = String(Math.floor(audioElem.currentTime % 60)).padStart(2, "0");
        timeLabel.textContent = `${curMins}:${curSecs} / ${audioDuration}`;
      }
    });

    audioElem.addEventListener("ended", () => {
      playBtn.textContent = "▶";
      progressFill.style.width = "0%";
    });

    progressBar.addEventListener("click", (e) => {
      const rect = progressBar.getBoundingClientRect();
      const clickPos = (e.clientX - rect.left) / rect.width;
      if (audioElem.duration) {
        audioElem.currentTime = clickPos * audioElem.duration;
      }
    });

    // Copy Text Handler
    const copyBtn = card.querySelector(".copy-btn");
    copyBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(data.text || "").then(() => {
        copyBtn.textContent = "Copied!";
        setTimeout(() => (copyBtn.textContent = "Copy"), 1500);
      });
    });

    // Delete Card Handler
    const deleteBtn = card.querySelector(".delete-btn");
    deleteBtn.addEventListener("click", () => {
      card.remove();
      if (this.dom.transcriptionFeed.children.length === 0) {
        this.dom.feedEmptyState.classList.remove("hidden");
      }
    });

    // Accuracy Evaluation Handler
    const evalBtn = card.querySelector(".eval-btn");
    const refInput = card.querySelector(".ref-input");
    const normToggle = card.querySelector(".eval-norm-toggle");
    const resultsBox = card.querySelector(".eval-results-box");

    evalBtn.addEventListener("click", async () => {
      const refText = refInput.value.trim();
      if (!refText) {
        alert("Please enter a reference transcription text.");
        return;
      }

      evalBtn.textContent = "Calculating...";
      try {
        const response = await fetch("/api/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reference: refText,
            hypothesis: data.text,
            normalize: normToggle.checked,
          }),
        });

        if (response.ok) {
          const evalData = await response.json();
          resultsBox.classList.remove("hidden");
          card.querySelector(".eval-wer").textContent = `${(evalData.wer * 100).toFixed(1)}%`;
          card.querySelector(".eval-cer").textContent = `${(evalData.cer * 100).toFixed(1)}%`;
          card.querySelector(".eval-subs").textContent = evalData.substitutions;
          card.querySelector(".eval-ins").textContent = evalData.insertions;
          card.querySelector(".eval-dels").textContent = evalData.deletions;
          card.querySelector(".eval-hits").textContent = evalData.hits;
        } else {
          alert("Evaluation failed.");
        }
      } catch (err) {
        console.error("Evaluation request error:", err);
      } finally {
        evalBtn.textContent = "Calculate Accuracy";
      }
    });

    return card;
  }

  updateSessionStats(summary) {
    if (!summary) return;
    this.dom.statUtterances.textContent = summary.utterances_count || 0;
    this.dom.statTotalAudio.innerHTML = `${(summary.total_audio_seconds || 0).toFixed(1)} <span class="unit">s</span>`;
    this.dom.statAvgAsr.innerHTML = `${(summary.avg_asr_latency_seconds || 0).toFixed(2)} <span class="unit">s</span>`;
    this.dom.statAvgE2e.innerHTML = `${(summary.avg_e2e_latency_seconds || 0).toFixed(2)} <span class="unit">s</span>`;
    this.dom.statAvgRtf.textContent = (summary.avg_rtf || 0).toFixed(2);

    const minE2e = (summary.min_e2e_latency_seconds || 0).toFixed(2);
    const maxE2e = (summary.max_e2e_latency_seconds || 0).toFixed(2);
    this.dom.statMinMaxE2e.innerHTML = `${minE2e} / ${maxE2e} <span class="unit">s</span>`;
  }

  /* ==========================================================================
     File Upload Mode
     ========================================================================== */
  async handleFileUpload(file) {
    if (!file) return;

    this.dom.fileUploadProgress.classList.remove("hidden");
    this.updateStatus("processing");
    this.logDebug(`Uploading file: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/transcribe-file", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Upload transcription failed");
      }

      const result = await res.json();
      this.handleTranscriptionResult(result);
      this.logDebug(`File transcription completed for ${file.name}`);
    } catch (e) {
      alert(`Transcription error: ${e.message}`);
      this.logDebug(`File error: ${e.message}`);
    } finally {
      this.dom.fileUploadProgress.classList.add("hidden");
      this.updateStatus("idle");
    }
  }

  /* ==========================================================================
     Debug Logger & UI Events
     ========================================================================== */
  logDebug(message) {
    const term = this.dom.debugTerminal;
    const now = new Date().toLocaleTimeString();
    const line = document.createElement("div");
    line.className = "log-line";
    line.textContent = `[${now}] ${message}`;
    term.appendChild(line);
    this.dom.debugBody.scrollTop = this.dom.debugBody.scrollHeight;
  }

  setupEventListeners() {
    // Mode switcher tabs
    this.dom.tabLive.addEventListener("click", () => this.switchMode("live"));
    this.dom.tabManual.addEventListener("click", () => this.switchMode("manual"));
    this.dom.tabFile.addEventListener("click", () => this.switchMode("file"));

    // Record Start / Stop Button
    this.dom.mainRecordBtn.addEventListener("click", () => {
      if (this.isRecording) {
        this.stopMicrophone();
      } else {
        this.startMicrophone();
      }
    });

    // Clear Session Button
    this.dom.clearSessionBtn.addEventListener("click", () => {
      this.sendWsControl({ type: "clear_session" });
      this.dom.transcriptionFeed.innerHTML = "";
      this.dom.feedEmptyState.classList.remove("hidden");
      this.utteranceCounter = 0;
      this.dom.utteranceCounter.textContent = "0 sentences";
      this.dom.sessionTimer.textContent = "00:00";
    });

    // Debug Panel Toggle & Clear
    this.dom.toggleDebugBtn.addEventListener("click", (e) => {
      if (e.target === this.dom.clearDebugBtn) return;
      this.dom.debugBody.classList.toggle("collapsed");
    });
    this.dom.clearDebugBtn.addEventListener("click", () => {
      this.dom.debugTerminal.innerHTML = '<div class="log-line text-muted">[System] Logs cleared.</div>';
    });

    // Settings Modal
    this.dom.openSettingsBtn.addEventListener("click", () => {
      this.dom.settingsModal.classList.remove("hidden");
    });
    this.dom.closeSettingsBtn.addEventListener("click", () => {
      this.dom.settingsModal.classList.add("hidden");
    });

    // Settings Range Sliders
    this.dom.settingSilenceTimeout.addEventListener("input", (e) => {
      this.dom.valSilenceTimeout.textContent = `${e.target.value} ms`;
    });
    this.dom.settingMinSpeech.addEventListener("input", (e) => {
      this.dom.valMinSpeech.textContent = `${e.target.value} ms`;
    });
    this.dom.settingThreshold.addEventListener("input", (e) => {
      this.dom.valThreshold.textContent = Number(e.target.value).toFixed(2);
    });
    this.dom.settingMaxUtterance.addEventListener("input", (e) => {
      this.dom.valMaxUtterance.textContent = `${e.target.value} s`;
    });

    this.dom.saveSettingsBtn.addEventListener("click", () => {
      this.settings = {
        silence_timeout_ms: parseFloat(this.dom.settingSilenceTimeout.value),
        min_speech_ms: parseFloat(this.dom.settingMinSpeech.value),
        vad_threshold: parseFloat(this.dom.settingThreshold.value),
        max_utterance_seconds: parseFloat(this.dom.settingMaxUtterance.value),
        auto_play: this.dom.settingAutoPlay.checked,
      };
      this.sendWsControl({
        type: "update_settings",
        settings: this.settings,
      });
      this.dom.settingsModal.classList.add("hidden");
      this.logDebug("Applied and synced updated settings with backend");
    });

    // File Upload Handlers
    this.dom.selectFileBtn.addEventListener("click", () => {
      this.dom.audioFileInput.click();
    });

    this.dom.audioFileInput.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) {
        this.handleFileUpload(e.target.files[0]);
      }
    });

    // Drag and Drop
    const dropzone = this.dom.dropzone;
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("dragover");
    });
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        this.handleFileUpload(e.dataTransfer.files[0]);
      }
    });
  }

  switchMode(mode) {
    if (this.isRecording) {
      this.stopMicrophone();
    }
    this.currentMode = mode;

    this.dom.tabLive.classList.toggle("active", mode === "live");
    this.dom.tabManual.classList.toggle("active", mode === "manual");
    this.dom.tabFile.classList.toggle("active", mode === "file");

    if (mode === "file") {
      this.dom.micControlPanel.classList.add("hidden");
      this.dom.fileUploadPanel.classList.remove("hidden");
    } else {
      this.dom.micControlPanel.classList.remove("hidden");
      this.dom.fileUploadPanel.classList.add("hidden");
    }

    this.logDebug(`Switched to ${mode.toUpperCase()} mode`);
  }
}

// Start application when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  window.app = new ArabicASRApp();
});
