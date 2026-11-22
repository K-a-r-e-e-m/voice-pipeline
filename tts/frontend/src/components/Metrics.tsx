import React from 'react';
import { Zap, Clock, Activity, Layers } from 'lucide-react';

export interface PerformanceMetrics {
  ttfaMs: number | null;
  totalTimeMs: number | null;
  audioDurationSec: number | null;
  rtf: number | null;
  chunkCount: number;
}

interface MetricsProps {
  metrics: PerformanceMetrics;
  isStreaming?: boolean;
}

export const Metrics: React.FC<MetricsProps> = ({ metrics }) => {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: '12px',
        padding: '16px',
        background: 'rgba(255, 255, 255, 0.02)',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border-color)',
      }}
    >
      {/* TTFA */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Zap size={14} color="var(--accent-amber)" /> Time To First Audio
        </span>
        <span style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: metrics.ttfaMs ? '#fbbf24' : 'var(--text-muted)' }}>
          {metrics.ttfaMs !== null ? `${metrics.ttfaMs.toFixed(0)} ms` : '--'}
        </span>
      </div>

      {/* Total Latency */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Clock size={14} color="var(--primary)" /> Total Generation
        </span>
        <span style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: metrics.totalTimeMs ? '#818cf8' : 'var(--text-muted)' }}>
          {metrics.totalTimeMs !== null ? `${(metrics.totalTimeMs / 1000).toFixed(2)} s` : '--'}
        </span>
      </div>

      {/* RTF */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Activity size={14} color="var(--accent-emerald)" /> Real-Time Factor
        </span>
        <span style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: metrics.rtf ? '#34d399' : 'var(--text-muted)' }}>
          {metrics.rtf !== null ? `${metrics.rtf.toFixed(2)}x` : '--'}
        </span>
      </div>

      {/* Chunks */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Layers size={14} color="var(--accent-cyan)" /> Audio Chunks
        </span>
        <span style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: metrics.chunkCount > 0 ? '#22d3ee' : 'var(--text-muted)' }}>
          {metrics.chunkCount}
        </span>
      </div>
    </div>
  );
};
