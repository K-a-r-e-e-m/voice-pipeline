/**
 * Real-Time Streaming Audio Player using Web Audio API
 * Plays Egyptian Speech Audio seamlessly without pitch distortion or stutter.
 */

export class AudioStreamPlayer {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private nextStartTime: number = 0;
  private isPlaying: boolean = false;
  private sampleRate: number = 24000;
  private activeSources: AudioBufferSourceNode[] = [];
  private onStateChangeCallback?: (isPlaying: boolean) => void;

  constructor(onStateChange?: (isPlaying: boolean) => void) {
    this.onStateChangeCallback = onStateChange;
  }

  private initAudioContext() {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      const AudioContextClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      // Initialize with native hardware sample rate to avoid driver resampling bugs
      this.audioContext = new AudioContextClass();
    }

    if (!this.gainNode && this.audioContext) {
      this.gainNode = this.audioContext.createGain();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.8;

      this.gainNode.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);
    }
  }

  public setSampleRate(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  public setVolume(volume: number) {
    if (this.gainNode && this.audioContext) {
      this.gainNode.gain.setValueAtTime(
        Math.max(0, Math.min(1, volume)),
        this.audioContext.currentTime
      );
    }
  }

  public getAnalyser(): AnalyserNode | null {
    return this.analyser;
  }

  public async prepare() {
    this.initAudioContext();
    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch {
        // ignore
      }
    }
  }

  public async startStream(sampleRate: number = 24000) {
    this.stop();
    this.sampleRate = sampleRate;
    this.initAudioContext();

    if (this.audioContext && this.audioContext.state === 'suspended') {
      try {
        await this.audioContext.resume();
      } catch {
        // ignore
      }
    }

    this.nextStartTime = 0;
    this.isPlaying = true;
    this.onStateChangeCallback?.(true);
  }

  /**
   * Convert linear PCM 16-bit byte buffer into normalized Float32Array [-1.0, 1.0]
   */
  public pcm16ToFloat32(pcmData: ArrayBuffer): Float32Array {
    const int16Array = new Int16Array(pcmData);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / (int16Array[i] < 0 ? 32768 : 32767);
    }
    return float32Array;
  }

  /**
   * Enqueue and schedule audio chunk for gapless playback
   */
  public enqueuePcmChunk(pcmData: ArrayBuffer) {
    if (!this.audioContext) {
      this.initAudioContext();
    }

    const float32Data = this.pcm16ToFloat32(pcmData);
    this.scheduleBuffer(float32Data);
  }

  public scheduleBuffer(float32Data: Float32Array) {
    if (!this.audioContext || !this.gainNode) return;
    if (float32Data.length === 0) return;

    const audioBuffer = this.audioContext.createBuffer(1, float32Data.length, this.sampleRate);
    audioBuffer.getChannelData(0).set(float32Data);

    const source = this.audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.gainNode);

    const currentTime = this.audioContext.currentTime;
    const startTime = this.nextStartTime === 0 ? currentTime + 0.05 : Math.max(currentTime, this.nextStartTime);
    source.start(startTime);

    this.nextStartTime = startTime + audioBuffer.duration;
    this.activeSources.push(source);
    this.isPlaying = true;
    this.onStateChangeCallback?.(true);

    source.onended = () => {
      const idx = this.activeSources.indexOf(source);
      if (idx !== -1) {
        this.activeSources.splice(idx, 1);
      }
      if (
        this.activeSources.length === 0 &&
        (!this.audioContext || this.audioContext.currentTime >= this.nextStartTime)
      ) {
        this.isPlaying = false;
        this.onStateChangeCallback?.(false);
      }
    };
  }

  public stop() {
    for (const source of this.activeSources) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        // ignore
      }
    }
    this.activeSources = [];
    this.nextStartTime = 0;
    this.isPlaying = false;
    this.onStateChangeCallback?.(false);
  }

  public isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }
}
