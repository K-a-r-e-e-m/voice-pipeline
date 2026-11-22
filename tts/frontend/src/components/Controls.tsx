import React from 'react';
import { Globe, Gauge, Volume2 } from 'lucide-react';

export interface VoiceOption {
  id: string;
  name: string;
  lang: string;
  flag: string;
  gender: string;
}

export const AVAILABLE_VOICES: VoiceOption[] = [
  { id: 'lahgtna-v3-balanced', name: 'لهجتنا أومني فويس (مصري متوازن - 8 خطوات)', lang: 'arz', flag: '🇪🇬', gender: 'طبيعي' },
  { id: 'lahgtna-v3-fast', name: 'لهجتنا أومني فويس (فائق السرعة - 4 خطوات)', lang: 'arz', flag: '⚡', gender: 'سريع' },
  { id: 'lahgtna-v3-studio', name: 'لهجتنا أومني فويس (جودة استوديو - 16 خطوة)', lang: 'arz', flag: '🎙️', gender: 'فائق الدقة' },
];

interface ControlsProps {
  selectedVoice: string;
  onVoiceChange: (voice: string) => void;
  speed: number;
  onSpeedChange: (speed: number) => void;
  volume: number;
  onVolumeChange: (volume: number) => void;
  disabled: boolean;
}

export const Controls: React.FC<ControlsProps> = ({
  selectedVoice,
  onVoiceChange,
  speed,
  onSpeedChange,
  volume,
  onVolumeChange,
  disabled,
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Voice & Sliders Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
        {/* Voice Selector */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
            <Globe size={16} color="var(--primary)" /> اختيار الصوت المصري
          </label>
          <select
            value={selectedVoice}
            onChange={(e) => onVoiceChange(e.target.value)}
            disabled={disabled}
            style={{
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 14px',
              fontSize: '0.9rem',
              outline: 'none',
              cursor: 'pointer',
            }}
          >
            {AVAILABLE_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.flag} {v.name}
              </option>
            ))}
          </select>
        </div>

        {/* Speed Slider */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
              <Gauge size={16} color="var(--accent-emerald)" /> سرعة النطق
            </label>
            <span style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-emerald)' }}>
              {speed.toFixed(1)}x
            </span>
          </div>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={speed}
            onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
            disabled={disabled}
            style={{ accentColor: 'var(--accent-emerald)', cursor: 'pointer', width: '100%', marginTop: '6px' }}
          />
        </div>

        {/* Volume Slider */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
              <Volume2 size={16} color="var(--accent-cyan)" /> مستوى الصوت
            </label>
            <span style={{ fontSize: '0.85rem', fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>
              {Math.round(volume * 100)}%
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
            style={{ accentColor: 'var(--accent-cyan)', cursor: 'pointer', width: '100%', marginTop: '6px' }}
          />
        </div>
      </div>
    </div>
  );
};
