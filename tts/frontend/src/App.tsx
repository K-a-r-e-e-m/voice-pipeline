import React, { useState, useEffect } from 'react';
import { Play, Square, RefreshCw, Mic, AlertTriangle, Radio } from 'lucide-react';
import { useTTSWebSocket } from './hooks/useTTSWebSocket';
import { AudioVisualizer } from './components/AudioVisualizer';
import { Controls } from './components/Controls';
import { Metrics } from './components/Metrics';

export const App: React.FC = () => {
  const [text, setText] = useState<string>('');
  const [selectedVoice, setSelectedVoice] = useState<string>('lahgtna-v3-balanced');
  const [speed, setSpeed] = useState<number>(1.0);
  const [volume, setVolumeState] = useState<number>(1.0);
  const [healthInfo, setHealthInfo] = useState<{ status: string; device: string; model_loaded: boolean } | null>(null);

  const {
    status,
    errorMessage,
    isPlaying,
    metrics,
    synthesize,
    stop,
    setVolume,
    getAnalyser,
    reconnect,
  } = useTTSWebSocket();

  // Poll backend health check
  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await fetch('http://localhost:8000/health');
        if (res.ok) {
          const data = await res.json();
          setHealthInfo(data);
        }
      } catch {
        setHealthInfo(null);
      }
    };

    fetchHealth();
    const interval = setInterval(fetchHealth, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleVolumeChange = (vol: number) => {
    setVolumeState(vol);
    setVolume(vol);
  };

  const isGenerating = status === 'Generating...' || status === 'Streaming...';

  const handleGenerate = () => {
    synthesize(text, selectedVoice, speed, 1.0);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px' }}>
      <div style={{ width: '100%', maxWidth: '840px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        
        {/* Header */}
        <header className="glass-panel" style={{ padding: '20px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: 'var(--primary-gradient)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: 'var(--shadow-glow)'
            }}>
              <Mic size={24} color="#ffffff" />
            </div>
            <div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em', background: 'var(--primary-gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                OmniVoice Egyptian TTS 🇪🇬
              </h1>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                نظام تحويل النص إلى صوت باللهجة المصرية الطبيعية &bull; Real-Time Streaming
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Backend / Device Badge */}
            {healthInfo && (
              <div style={{
                fontSize: '0.75rem',
                fontFamily: 'var(--font-mono)',
                padding: '4px 10px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid var(--border-color)',
                color: '#34d399',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
                EGYPTIAN HI-FI 24kHz
              </div>
            )}

            {/* Connection Status Badge */}
            <div className={`status-badge ${
              status === 'Connected' ? 'status-connected' :
              status === 'Streaming...' ? 'status-streaming' :
              status === 'Generating...' ? 'status-generating' :
              'status-disconnected'
            }`}>
              <span className="status-dot" />
              {status}
            </div>

            {status === 'Disconnected' || status === 'Error' ? (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                onClick={reconnect}
              >
                <RefreshCw size={14} /> Reconnect
              </button>
            ) : null}
          </div>
        </header>

        {/* Main Card */}
        <main className="glass-panel" style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Visualizer & Waveform Bar */}
          <div style={{
            background: 'rgba(10, 13, 20, 0.6)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-color)',
            padding: '8px 16px',
            position: 'relative',
            overflow: 'hidden'
          }}>
            <AudioVisualizer
              analyser={getAnalyser()}
              isPlaying={isPlaying}
              isStreaming={status === 'Streaming...' || status === 'Generating...'}
            />
            {isPlaying && (
              <div style={{ position: 'absolute', top: '10px', right: '14px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', color: '#22d3ee', fontWeight: 600 }}>
                <Radio size={14} className="streaming-active" /> بث صوتي مباشر
              </div>
            )}
          </div>

          {/* Textarea Input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                اكتب النص المصري هنا:
              </label>
              <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: text.length > 4000 ? '#f43f5e' : 'var(--text-muted)' }}>
                {text.length} / 5000 حرف
              </span>
            </div>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={isGenerating}
              placeholder="اكتب أي جملة أو كلام بالمصري هنا، وهيتم تحويله فوراً لنطق وصوت مصري طبيعي خالص..."
              className="arabic-text"
              style={{
                width: '100%',
                minHeight: '130px',
                padding: '16px',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                fontSize: '1.15rem',
                outline: 'none',
                resize: 'vertical',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--border-focus)')}
              onBlur={(e) => (e.target.style.borderColor = 'var(--border-color)')}
            />
          </div>

          {/* Voice & Audio Controls */}
          <Controls
            selectedVoice={selectedVoice}
            onVoiceChange={setSelectedVoice}
            speed={speed}
            onSpeedChange={setSpeed}
            volume={volume}
            onVolumeChange={handleVolumeChange}
            disabled={isGenerating}
          />

          {/* Error Message Display */}
          {errorMessage && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              color: '#f87171',
              fontSize: '0.88rem',
            }}>
              <AlertTriangle size={18} />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ flex: 1, padding: '14px', fontSize: '1rem' }}
              onClick={handleGenerate}
              disabled={isGenerating || !text.trim()}
            >
              {isGenerating ? (
                <>
                  <RefreshCw size={18} className="spin" /> جاري التوليد...
                </>
              ) : (
                <>
                  <Play size={18} fill="currentColor" /> توليد وتشغيل الصوت المصري
                </>
              )}
            </button>

            {(isGenerating || isPlaying) && (
              <button
                type="button"
                className="btn btn-danger"
                style={{ padding: '14px 24px', fontSize: '1rem' }}
                onClick={stop}
              >
                <Square size={18} fill="currentColor" /> إيقاف
              </button>
            )}
          </div>

          {/* Performance Metrics */}
          <Metrics metrics={metrics} isStreaming={isGenerating} />
        </main>

        {/* Footer */}
        <footer style={{ textAlign: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          OmniVoice Egyptian TTS &bull; Real-Time Streaming Neural Speech
        </footer>
      </div>
    </div>
  );
};

export default App;
