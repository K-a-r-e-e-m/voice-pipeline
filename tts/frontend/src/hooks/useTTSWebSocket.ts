import { useState, useEffect, useRef, useCallback } from 'react';
import { AudioStreamPlayer } from '../services/audioStreamPlayer';
import type { PerformanceMetrics } from '../components/Metrics';

export type ConnectionStatus =
  | 'Disconnected'
  | 'Connecting...'
  | 'Connected'
  | 'Generating...'
  | 'Streaming...'
  | 'Completed'
  | 'Error';

export interface UseTTSWebSocketOptions {
  wsUrl?: string;
  onAudioStart?: () => void;
  onAudioEnd?: () => void;
}

export function useTTSWebSocket(options: UseTTSWebSocketOptions = {}) {
  const defaultWsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:8000/ws/tts`;
  const wsUrl = options.wsUrl || defaultWsUrl;

  const [status, setStatus] = useState<ConnectionStatus>('Connecting...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    ttfaMs: null,
    totalTimeMs: null,
    audioDurationSec: null,
    rtf: null,
    chunkCount: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<AudioStreamPlayer | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const requestStartTimeRef = useRef<number>(0);
  const firstChunkReceivedRef = useRef<boolean>(false);
  const chunkCountRef = useRef<number>(0);
  const totalPcmBytesRef = useRef<number>(0);
  const currentSampleRateRef = useRef<number>(16000);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPayloadRef = useRef<Record<string, unknown> | null>(null);

  // Initialize Player
  useEffect(() => {
    playerRef.current = new AudioStreamPlayer((playing) => {
      setIsPlaying(playing);
    });

    return () => {
      playerRef.current?.stop();
    };
  }, []);

  const handleBinaryChunk = useCallback((buffer: ArrayBuffer) => {
    const now = performance.now();
    if (!firstChunkReceivedRef.current) {
      firstChunkReceivedRef.current = true;
      const ttfa = now - requestStartTimeRef.current;
      setMetrics((prev) => ({ ...prev, ttfaMs: ttfa }));
    }

    chunkCountRef.current += 1;
    totalPcmBytesRef.current += buffer.byteLength;

    setMetrics((prev) => ({
      ...prev,
      chunkCount: chunkCountRef.current,
    }));

    playerRef.current?.enqueuePcmChunk(buffer);
  }, []);

  // Connect WebSocket
  const connectWebSocket = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    setStatus('Connecting...');

    try {
      const ws = new WebSocket(wsUrl);
      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        setStatus('Connected');
        setErrorMessage(null);

        // If there was a pending synthesis request during reconnect, send it now
        if (pendingPayloadRef.current) {
          const payload = pendingPayloadRef.current;
          pendingPayloadRef.current = null;
          setStatus('Generating...');
          requestStartTimeRef.current = performance.now();
          ws.send(JSON.stringify(payload));
        }
      };

      ws.onmessage = async (event) => {
        // Binary audio chunk
        if (event.data instanceof ArrayBuffer) {
          handleBinaryChunk(event.data);
          return;
        }

        // JSON protocol message
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case 'audio_start': {
              const sampleRate = msg.sample_rate || 16000;
              currentSampleRateRef.current = sampleRate;
              chunkCountRef.current = 0;
              totalPcmBytesRef.current = 0;
              firstChunkReceivedRef.current = false;
              setStatus('Streaming...');
              await playerRef.current?.startStream(sampleRate);
              optionsRef.current.onAudioStart?.();
              break;
            }
            case 'audio_chunk': {
              if (msg.data) {
                const binaryString = atob(msg.data);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                handleBinaryChunk(bytes.buffer);
              }
              break;
            }
            case 'audio_end': {
              const now = performance.now();
              const totalLatency = now - requestStartTimeRef.current;
              const totalSamples = totalPcmBytesRef.current / 2;
              const durationSec = totalSamples / currentSampleRateRef.current;
              const rtf = durationSec > 0 ? (totalLatency / 1000) / durationSec : 0;

              setMetrics((prev) => ({
                ...prev,
                totalTimeMs: totalLatency,
                audioDurationSec: durationSec,
                rtf: rtf,
                chunkCount: chunkCountRef.current,
              }));

              setStatus('Completed');
              optionsRef.current.onAudioEnd?.();
              break;
            }
            case 'error': {
              setErrorMessage(msg.message || 'An error occurred during synthesis');
              setStatus('Error');
              playerRef.current?.stop();
              break;
            }
            default:
              break;
          }
        } catch {
          // Ignore unparseable non-JSON text
        }
      };

      ws.onerror = () => {
        setStatus('Error');
        setErrorMessage('WebSocket connection failed. Ensure backend server is running on port 8000.');
      };

      ws.onclose = () => {
        setStatus('Disconnected');
        wsRef.current = null;
        // Auto-reconnect after 3 seconds
        if (!reconnectTimeoutRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            connectWebSocket();
          }, 3000);
        }
      };

      wsRef.current = ws;
    } catch (err: unknown) {
      setStatus('Error');
      setErrorMessage(err instanceof Error ? err.message : 'Failed to create WebSocket connection');
    }
  }, [wsUrl, handleBinaryChunk]);

  useEffect(() => {
    connectWebSocket();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectWebSocket]);

  const synthesize = (text: string, voice: string = 'ara', speed: number = 1.0, pitch: number = 1.0) => {
    if (!text.trim()) {
      setErrorMessage('Please enter some text to synthesize.');
      return;
    }

    // Prepare audio context inside the user interaction handler
    playerRef.current?.prepare();

    // Reset metrics
    requestStartTimeRef.current = performance.now();
    firstChunkReceivedRef.current = false;
    chunkCountRef.current = 0;
    totalPcmBytesRef.current = 0;
    setErrorMessage(null);
    setStatus('Generating...');
    setMetrics({
      ttfaMs: null,
      totalTimeMs: null,
      audioDurationSec: null,
      rtf: null,
      chunkCount: 0,
    });

    playerRef.current?.stop();

    const payload = {
      type: 'synthesize',
      text: text.trim(),
      voice: voice,
      speed: speed,
      pitch: pitch,
    };

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      pendingPayloadRef.current = payload;
      connectWebSocket();
      return;
    }

    wsRef.current.send(JSON.stringify(payload));
  };

  const stop = () => {
    pendingPayloadRef.current = null;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'stop' }));
    }
    playerRef.current?.stop();
    setStatus('Connected');
  };

  const setVolume = (vol: number) => {
    playerRef.current?.setVolume(vol);
  };

  const getAnalyser = () => playerRef.current?.getAnalyser() || null;

  return {
    status,
    errorMessage,
    isPlaying,
    metrics,
    synthesize,
    stop,
    setVolume,
    getAnalyser,
    reconnect: connectWebSocket,
  };
}
