const VoiceState = {
  IDLE: "IDLE",
  LISTENING: "LISTENING",
  USER_SPEAKING: "USER_SPEAKING",
  PROCESSING: "PROCESSING",
  ASSISTANT_SPEAKING: "ASSISTANT_SPEAKING",
  ERROR: "ERROR",
};

const VAD = {
  rmsStart: 0.018,
  rmsHold: 0.01,
  minSpeechMs: 280,
  silenceMs: 850,
  prerollMs: 280,
  minUtteranceMs: 420,
  maxUtteranceMs: 18000,
  bargeInRms: 0.045,
  bargeInMs: 220,
};

const STATE_COPY = {
  IDLE: { label: "جاهز", hint: "اضغط الميكروفون لبدء الاستماع المستمر." },
  LISTENING: { label: "في انتظار كلامك", hint: "تكلم بشكل طبيعي. التوقف القصير داخل الجملة لن ينهي التسجيل." },
  USER_SPEAKING: { label: "يتم سماعك", hint: "بعد صمت قصير سيتم إرسال الجملة تلقائياً." },
  PROCESSING: { label: "جاري المعالجة", hint: "تحويل الكلام ثم تجهيز رد المساعد." },
  ASSISTANT_SPEAKING: { label: "المساعد يتحدث", hint: "يمكنك المقاطعة بالكلام أو بالضغط على الميكروفون." },
  ERROR: { label: "حدث خطأ", hint: "اضغط الميكروفون للمحاولة مرة أخرى." },
};

const sessionId =
  localStorage.getItem("voiceSessionId") ||
  (crypto.randomUUID ? crypto.randomUUID() : `sess_${Date.now()}`);
localStorage.setItem("voiceSessionId", sessionId);

const els = {
  micBtn: document.getElementById("micBtn"),
  stateLabel: document.getElementById("stateLabel"),
  stateHint: document.getElementById("stateHint"),
  activity: document.getElementById("activity"),
  bars: Array.from(document.querySelectorAll("#activity span")),
  alertBox: document.getElementById("alertBox"),
  transcription: document.getElementById("transcriptionText"),
  reply: document.getElementById("replyText"),
  audioPlayer: document.getElementById("audioPlayer"),
  voiceSelect: document.getElementById("voiceSelect"),
  silenceRange: document.getElementById("silenceRange"),
  silenceValue: document.getElementById("silenceValue"),
  metrics: document.getElementById("metricsBar"),
  sttMetric: document.getElementById("sttMetric"),
  llmMetric: document.getElementById("llmMetric"),
  ttsMetric: document.getElementById("ttsMetric"),
  totalMetric: document.getElementById("totalMetric"),
  fileInput: document.getElementById("audioFileInput"),
};

let state = VoiceState.IDLE;
let audioContext = null;
let mediaStream = null;
let sourceNode = null;
let processorNode = null;
let silentGain = null;
let captureBuffers = [];
let preroll = [];
let prerollSamples = 0;
let speechMs = 0;
let silenceMs = 0;
let bargeMs = 0;
let utteranceMs = 0;
let lastRms = 0;
let pipelineInFlight = false;
let finalizeLock = false;
let objectUrl = null;

function setState(next, hintOverride) {
  state = next;
  const copy = STATE_COPY[next];
  els.stateLabel.textContent = copy.label;
  els.stateHint.textContent = hintOverride || copy.hint;
  els.micBtn.className = `mic-button state-${next.toLowerCase()}`;
  els.micBtn.setAttribute("aria-label", copy.label);
  document.body.dataset.voiceState = next;
}

function showAlert(message, type = "error") {
  els.alertBox.textContent = message;
  els.alertBox.className = `alert ${type}`;
  els.alertBox.style.display = "block";
}

function hideAlert() {
  els.alertBox.textContent = "";
  els.alertBox.className = "alert";
  els.alertBox.style.removeProperty("display");
}

function setPlaceholder(target, text) {
  target.innerHTML = `<span class="placeholder">${text}</span>`;
}

function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    sum += v * v;
  }
  return Math.sqrt(sum / Math.max(samples.length, 1));
}

function updateActivity(level) {
  const active = state === VoiceState.LISTENING || state === VoiceState.USER_SPEAKING;
  els.activity.classList.toggle("active", active && level > 0.004);
  els.bars.forEach((bar, i) => {
    const threshold = (i + 1) / els.bars.length;
    const h = Math.max(6, Math.min(28, level * 180 * (0.45 + threshold)));
    bar.style.height = `${h}px`;
  });
}

function resampleTo16k(inputBuffer, inputSampleRate) {
  if (inputSampleRate === 16000) return inputBuffer;
  const ratio = inputSampleRate / 16000;
  const newLength = Math.round(inputBuffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < inputBuffer.length; i++) {
      accum += inputBuffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function build16kWavBlob(samplesFloat32) {
  const pcm16 = new Int16Array(samplesFloat32.length);
  for (let i = 0; i < samplesFloat32.length; i++) {
    const s = Math.max(-1, Math.min(1, samplesFloat32[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const buffer = new ArrayBuffer(44 + pcm16.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + pcm16.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, pcm16.length * 2, true);
  let offset = 44;
  for (let i = 0; i < pcm16.length; i++) {
    view.setInt16(offset, pcm16[i], true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function mergeBuffers(chunks) {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function pushPreroll(chunk) {
  preroll.push(chunk);
  prerollSamples += chunk.length;
  const maxSamples = Math.floor((VAD.prerollMs / 1000) * 16000);
  while (prerollSamples > maxSamples && preroll.length) {
    const removed = preroll.shift();
    prerollSamples -= removed.length;
  }
}

function micErrorMessage(err) {
  const name = err && err.name;
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "تم رفض إذن الميكروفون. فعّل الإذن من إعدادات المتصفح ثم حاول مرة أخرى.";
  }
  if (name === "NotFoundError") {
    return "لم يتم العثور على ميكروفون متصل.";
  }
  return `تعذر الوصول إلى الميكروفون: ${err.message || err}`;
}

async function startSession() {
  hideAlert();
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioContext = audioContext || new AudioCtx();
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    processorNode = audioContext.createScriptProcessor(4096, 1, 1);
    silentGain = audioContext.createGain();
    silentGain.gain.value = 0;
    processorNode.onaudioprocess = onAudioProcess;
    sourceNode.connect(processorNode);
    processorNode.connect(silentGain);
    silentGain.connect(audioContext.destination);
    resetUtterance();
    setState(VoiceState.LISTENING);
  } catch (err) {
    console.error("Microphone access error:", err);
    enterError(micErrorMessage(err));
  }
}

function stopMicGraph() {
  if (processorNode) {
    processorNode.disconnect();
    processorNode.onaudioprocess = null;
    processorNode = null;
  }
  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }
  if (silentGain) {
    silentGain.disconnect();
    silentGain = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
}

async function stopSession() {
  stopPlayback();
  stopMicGraph();
  if (audioContext && audioContext.state !== "closed") {
    await audioContext.close().catch(() => {});
    audioContext = null;
  }
  resetUtterance();
  pipelineInFlight = false;
  finalizeLock = false;
  setState(VoiceState.IDLE);
}

function resetUtterance() {
  captureBuffers = [];
  preroll = [];
  prerollSamples = 0;
  speechMs = 0;
  silenceMs = 0;
  bargeMs = 0;
  utteranceMs = 0;
}

function onAudioProcess(event) {
  if (!audioContext) return;
  const input = event.inputBuffer.getChannelData(0);
  const chunk = resampleTo16k(input, audioContext.sampleRate);
  const level = rms(chunk);
  lastRms = lastRms * 0.7 + level * 0.3;
  updateActivity(lastRms);

  const chunkMs = (chunk.length / 16000) * 1000;

  if (state === VoiceState.ASSISTANT_SPEAKING) {
    if (level >= VAD.bargeInRms) {
      bargeMs += chunkMs;
      if (bargeMs >= VAD.bargeInMs) {
        interruptAssistant(chunk);
      }
    } else {
      bargeMs = 0;
    }
    return;
  }

  if (state !== VoiceState.LISTENING && state !== VoiceState.USER_SPEAKING) {
    return;
  }

  if (state === VoiceState.LISTENING) {
    pushPreroll(chunk);
    if (level >= VAD.rmsStart) {
      speechMs += chunkMs;
      if (speechMs >= VAD.minSpeechMs) {
        captureBuffers = preroll.slice();
        utteranceMs = (mergeBuffers(captureBuffers).length / 16000) * 1000;
        silenceMs = 0;
        setState(VoiceState.USER_SPEAKING);
      }
    } else {
      speechMs = 0;
    }
    return;
  }

  captureBuffers.push(chunk);
  utteranceMs += chunkMs;
  if (level >= VAD.rmsHold) {
    silenceMs = 0;
  } else {
    silenceMs += chunkMs;
  }

  if (silenceMs >= VAD.silenceMs || utteranceMs >= VAD.maxUtteranceMs) {
    finalizeUtterance();
  }
}

function interruptAssistant(firstChunk) {
  stopPlayback();
  captureBuffers = preroll.slice();
  if (firstChunk) captureBuffers.push(firstChunk);
  utteranceMs = (mergeBuffers(captureBuffers).length / 16000) * 1000;
  silenceMs = 0;
  speechMs = VAD.minSpeechMs;
  setState(VoiceState.USER_SPEAKING);
}

function stopPlayback() {
  els.audioPlayer.onended = null;
  els.audioPlayer.onerror = null;
  els.audioPlayer.pause();
  els.audioPlayer.removeAttribute("src");
}

function finalizeUtterance() {
  if (finalizeLock || pipelineInFlight) return;
  finalizeLock = true;

  const samples = mergeBuffers(captureBuffers);
  const durationMs = (samples.length / 16000) * 1000;
  resetUtterance();

  if (durationMs < VAD.minUtteranceMs) {
    finalizeLock = false;
    setState(VoiceState.LISTENING);
    showAlert("تم تجاهل صوت قصير جداً.", "info");
    return;
  }

  const wavBlob = build16kWavBlob(samples);
  uploadAndProcessAudio(wavBlob, "utterance_16k.wav");
}

async function uploadAndProcessAudio(audioBlobOrFile, filename = "audio.wav") {
  if (pipelineInFlight) return;
  pipelineInFlight = true;
  hideAlert();
  setState(VoiceState.PROCESSING);
  els.micBtn.disabled = true;

  const formData = new FormData();
  formData.append("audio", audioBlobOrFile, filename);
  formData.append("voice", els.voiceSelect.value);
  formData.append("speed", "1.0");
  formData.append("sessionId", sessionId);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    const response = await fetch("/pipeline/process", {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const detail = errorData.message || `فشل الاتصال بالخادم (${response.status})`;
      throw new Error(detail);
    }

    const data = await response.json();
    renderPipelineResult(data);
  } catch (err) {
    console.error("Pipeline processing error:", err);
    const message =
      err.name === "AbortError"
        ? "انتهت مهلة الاتصال بالخادم."
        : err.message && err.message.includes("Failed to fetch")
          ? "تعذر الاتصال بالخادم أو خدمة gRPC. تأكد أن NestJS وSTT وTTS قيد التشغيل."
          : `حدث خطأ أثناء معالجة الصوت: ${err.message}`;
    enterError(message, { keepListening: Boolean(mediaStream) });
  } finally {
    pipelineInFlight = false;
    finalizeLock = false;
    els.micBtn.disabled = false;
  }
}

function renderPipelineResult(data) {
  if (data.transcription && data.transcription.trim()) {
    els.transcription.textContent = data.transcription;
  } else {
    setPlaceholder(els.transcription, "لم يتم التعرف على كلمات في هذا المقطع.");
  }

  if (data.processedText && data.processedText.trim()) {
    els.reply.textContent = data.processedText;
  } else {
    setPlaceholder(els.reply, "لا يوجد رد صوتي لهذه الجملة.");
  }

  if (data.timings) {
    els.sttMetric.textContent = `STT ${data.timings.sttSeconds}s`;
    els.llmMetric.textContent = `AI ${data.timings.llmSeconds}s`;
    els.ttsMetric.textContent = `TTS ${data.timings.ttsSeconds}s`;
    els.totalMetric.textContent = `E2E ${data.timings.totalSeconds}s`;
    els.metrics.style.display = "flex";
  }

  if (data.status === "empty" || !data.audioBase64) {
    showAlert(data.message || "تم تجاهل مقطع فارغ أو غير واضح.", "info");
    if (mediaStream) setState(VoiceState.LISTENING);
    else setState(VoiceState.IDLE);
    return;
  }

  playAssistantAudio(data);
}

function playAssistantAudio(data) {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  const bytes = Uint8Array.from(atob(data.audioBase64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: `audio/${data.audioFormat || "wav"}` });
  objectUrl = URL.createObjectURL(blob);
  els.audioPlayer.src = objectUrl;
  setState(VoiceState.ASSISTANT_SPEAKING);
  const resumeListening = () => {
    if (state === VoiceState.ASSISTANT_SPEAKING) {
      setState(mediaStream ? VoiceState.LISTENING : VoiceState.IDLE);
    }
  };
  els.audioPlayer.onended = resumeListening;
  els.audioPlayer.onerror = () => {
    enterError("تعذر تشغيل رد المساعد.");
  };
  els.audioPlayer.play().catch((e) => {
    console.log("Auto-play blocked:", e);
    showAlert("المتصفح منع التشغيل التلقائي. اضغط تشغيل على المشغّل.", "info");
    resumeListening();
  });
}

function enterError(message, { keepListening = false } = {}) {
  showAlert(message, "error");
  if (keepListening && mediaStream) {
    setState(VoiceState.LISTENING, message);
    return;
  }
  stopMicGraph();
  setState(VoiceState.ERROR, message);
}

els.micBtn.addEventListener("click", async () => {
  if (state === VoiceState.IDLE || state === VoiceState.ERROR) {
    await startSession();
    return;
  }
  if (state === VoiceState.ASSISTANT_SPEAKING) {
    interruptAssistant();
    return;
  }
  if (state === VoiceState.PROCESSING) {
    return;
  }
  await stopSession();
});

els.silenceRange.addEventListener("input", () => {
  VAD.silenceMs = Number(els.silenceRange.value);
  els.silenceValue.textContent = `${VAD.silenceMs} ms`;
});

els.fileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  hideAlert();
  try {
    const arrayBuffer = await file.arrayBuffer();
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const tempCtx = new AudioCtx();
    const decoded = await tempCtx.decodeAudioData(arrayBuffer);
    await tempCtx.close();
    let monoData = decoded.getChannelData(0);
    if (decoded.numberOfChannels > 1) {
      const ch1 = decoded.getChannelData(1);
      monoData = new Float32Array(decoded.length);
      for (let i = 0; i < decoded.length; i++) {
        monoData[i] = (decoded.getChannelData(0)[i] + ch1[i]) / 2;
      }
    }
    const wavBlob = build16kWavBlob(resampleTo16k(monoData, decoded.sampleRate));
    await uploadAndProcessAudio(wavBlob, "uploaded_audio_16k.wav");
  } catch (err) {
    await uploadAndProcessAudio(file, file.name);
  }
  els.fileInput.value = "";
});

els.silenceValue.textContent = `${VAD.silenceMs} ms`;
setPlaceholder(els.transcription, "سيظهر كلامك هنا بعد التعرف عليه.");
setPlaceholder(els.reply, "سيظهر رد المساعد هنا.");
setState(VoiceState.IDLE);
