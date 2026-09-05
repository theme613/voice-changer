/**
 * PreviewPlayer.tsx — Audio Preview with Waveform Visualization
 *
 * Uses wavesurfer.js to render a waveform of the isolated vocals.
 * Provides play/pause control and time display.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, Loader2 } from 'lucide-react';

interface PreviewPlayerProps {
  /** URL to the audio file (e.g., /api/preview/{job_id}) */
  audioUrl: string;
  /** Optional label above the player */
  label?: string;
}

export default function PreviewPlayer({ audioUrl, label = 'Preview isolated vocals' }: PreviewPlayerProps) {
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState('0:00');
  const [totalTime, setTotalTime] = useState('0:00');

  /** Format seconds to mm:ss */
  const formatTime = useCallback((seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // Initialize WaveSurfer
  useEffect(() => {
    if (!waveformRef.current) return;

    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: 'rgba(79, 140, 255, 0.4)',
      progressColor: '#4f8cff',
      cursorColor: '#a78bfa',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      height: 80,
      normalize: true,
      backend: 'WebAudio',
    });

    ws.on('ready', () => {
      setIsLoading(false);
      setTotalTime(formatTime(ws.getDuration()));
    });

    ws.on('audioprocess', () => {
      setCurrentTime(formatTime(ws.getCurrentTime()));
    });

    ws.on('seeking', () => {
      setCurrentTime(formatTime(ws.getCurrentTime()));
    });

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('finish', () => setIsPlaying(false));

    ws.on('error', (err) => {
      console.error('WaveSurfer error:', err);
      setIsLoading(false);
    });

    ws.load(audioUrl);
    wavesurferRef.current = ws;

    return () => {
      ws.destroy();
    };
  }, [audioUrl, formatTime]);

  const togglePlayPause = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.playPause();
    }
  };

  return (
    <div className="audio-preview">
      <div className="audio-preview-label">{label}</div>

      {/* Waveform visualization */}
      <div className="audio-waveform" ref={waveformRef}>
        {isLoading && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--text-muted)',
            gap: '8px',
            fontSize: 'var(--font-size-sm)',
          }}>
            <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
            Loading audio...
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="audio-controls">
        <button
          className="audio-play-btn"
          onClick={togglePlayPause}
          disabled={isLoading}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} style={{ marginLeft: '2px' }} />}
        </button>

        <span className="audio-time">
          {currentTime} / {totalTime}
        </span>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
