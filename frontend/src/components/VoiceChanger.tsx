/**
 * VoiceChanger.tsx — Screen 3: Real-Time Voice Changer
 *
 * Controls for real-time voice conversion:
 * - Profile selector
 * - Audio device selection (input/output)
 * - Pitch shift and index rate controls
 * - Volume sliders
 * - Level meters
 * - Start/Stop toggle
 * - Sample test playback
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Mic,
  Speaker,
  Volume2,
  Play,
  Square,
  Zap,
  FlaskConical,
  AlertCircle,
  Server,
} from 'lucide-react';

import Tooltip from './Tooltip';
import {
  getProfiles,
  getAudioDevices,
  startConversion,
  stopConversion,
  getConversionStatus,
  updateConversionSettings,
  testConversion,
  healthCheck,
  type VoiceProfile,
  type AudioDevice,
} from '../api';

interface VoiceChangerProps {
  /** Pre-selected profile name from training */
  initialProfile?: string;
}

export default function VoiceChanger({ initialProfile }: VoiceChangerProps) {
  // Profile & Devices
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [selectedProfile, setSelectedProfile] = useState(initialProfile || '');
  const [inputDevices, setInputDevices] = useState<AudioDevice[]>([]);
  const [showAdvancedDevices, setShowAdvancedDevices] = useState(false);
  const [outputDevices, setOutputDevices] = useState<AudioDevice[]>([]);
  const [selectedInput, setSelectedInput] = useState<number | null>(null);
  const [selectedOutput, setSelectedOutput] = useState<number | null>(null);

  // Conversion settings
  const [pitchShift, setPitchShift] = useState(0);
  const [indexRate, setIndexRate] = useState(0.75);
  const [inputGain, setInputGain] = useState(1.0);
  const [outputGain, setOutputGain] = useState(1.0);
  const [isEnabled, setIsEnabled] = useState(true);

  const [engineStatus, setEngineStatus] = useState<any>(null);
  const [engineStatusLoading, setEngineStatusLoading] = useState(false);

  const checkEngineStatus = async () => {
    setEngineStatusLoading(true);
    try {
      const res = await healthCheck();
      setEngineStatus(res);
    } catch (err) {
      setEngineStatus({ status: 'error', message: 'Failed to communicate with backend' });
    } finally {
      setEngineStatusLoading(false);
    }
  };

  const [chunkSize, setChunkSize] = useState(128);
  const [f0Detector, setF0Detector] = useState('rmvpe');
  const updateEngineSettings = (key: string, val: any) => { console.log("updateEngineSettings", key, val); };


  // Status
  const [isRunning, setIsRunning] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [outputLevel, setOutputLevel] = useState(0);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [_testAudioUrl, setTestAudioUrl] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const testAudioRef = useRef<HTMLAudioElement | null>(null);

  // --- Load profiles and devices on mount ---
  const loadDevices = async () => {
    try {
      const devicesRes = await getAudioDevices();
      setInputDevices(devicesRes.input);
      setOutputDevices(devicesRes.output);
      
      // Auto-selection logic
      if (!selectedInput && devicesRes.input.length > 0) {
        const mic = devicesRes.input.find(d => !d.name.toLowerCase().includes('cable output') && d.is_default) || devicesRes.input[0];
        if (mic) setSelectedInput(mic.id);
      }
      
      if (!selectedOutput && devicesRes.output.length > 0) {
        const out = devicesRes.output.find(d => d.name.toLowerCase().includes('cable input') || d.is_default) || devicesRes.output[0];
        if (out) setSelectedOutput(out.id);
      }

      if (devicesRes.input.length === 0 || devicesRes.output.length === 0) {
        setError('No audio devices found. Please ensure virtual cables and a microphone are connected.');
      } else {
        // Clear device error if previously set
        if (error.includes('No audio devices found')) setError('');
      }
    } catch (err: any) {
      console.error('Failed to load devices:', err);
      setError('Failed to fetch audio devices.');
    }
  };

  useEffect(() => {
    const loadData = async () => {
      try {
        const [profilesRes] = await Promise.all([
          getProfiles(),
          loadDevices()
        ]);
        setProfiles(profilesRes.profiles);
        checkEngineStatus();

        // Auto-select initial profile
        if (initialProfile && profilesRes.profiles.some(p => p.name === initialProfile)) {
          setSelectedProfile(initialProfile);
        } else if (profilesRes.profiles.length > 0) {
          setSelectedProfile(profilesRes.profiles[0].name);
        }
      } catch (err: any) {
        console.error('Failed to load data:', err);
        setError('Failed to connect to the backend. Make sure the server is running.');
      }
    };
    loadData();
  }, [initialProfile]);

  // --- Level meter polling ---
  useEffect(() => {
    if (isRunning) {
      pollRef.current = setInterval(async () => {
        try {
          const status = await getConversionStatus();
          setInputLevel(status.input_level);
          setOutputLevel(status.output_level);
          setIsRunning(status.is_running);
        } catch {
          // Ignore poll errors
        }
      }, 100); // Poll every 100ms for smooth meters
    }

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [isRunning]);

  // Poll engine status if starting
  useEffect(() => {
    let timeout: any;
    if (engineStatus?.status === 'starting') {
      timeout = setTimeout(() => {
        checkEngineStatus();
      }, 2000);
    }
    return () => clearTimeout(timeout);
  }, [engineStatus]);

  // --- Start/Stop ---
  const handleStart = async () => {
    if (!selectedProfile) {
      setError('Please select a voice profile first.');
      return;
    }

    setError('');
    setIsLoading(true);

    try {
      await startConversion({
        profile_name: selectedProfile,
        input_device: selectedInput,
        output_device: selectedOutput,
        pitch_shift: pitchShift,
        index_rate: indexRate,
        input_gain: inputGain,
        output_gain: outputGain,
      });
      setIsRunning(true);
    } catch (err: any) {
      setError(err.message || 'Failed to start voice conversion.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStop = async () => {
    try {
      await stopConversion();
      setIsRunning(false);
      setInputLevel(0);
      setOutputLevel(0);
    } catch (err: any) {
      console.error('Stop error:', err);
    }
  };

  // --- Live Settings Updates ---
  const handleSettingsUpdate = useCallback(
    async (settings: Record<string, number | boolean>) => {
      if (!isRunning) return;
      try {
        await updateConversionSettings(settings);
      } catch {
        // Ignore setting update errors
      }
    },
    [isRunning],
  );

  // --- Test with Sample ---
  const handleTest = async () => {
    setIsTesting(true);
    setError('');

    try {
      const url = await testConversion();
      setTestAudioUrl(url);

      // Auto-play the test result
      if (testAudioRef.current) {
        testAudioRef.current.src = url;
        testAudioRef.current.play();
      }
    } catch (err: any) {
      setError(err.message || 'Test conversion failed.');
    } finally {
      setIsTesting(false);
    }
  };

  // Convert level (0.0-1.0) to percentage for meter display
  const levelToPercent = (level: number) => Math.min(100, Math.round(level * 500));

  return (
    <div>
      <motion.div
        className="card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {/* --- Status Badge --- */}
        <div className="flex items-center justify-between mb-6">
          <div className="font-semibold" style={{ fontSize: 'var(--font-size-lg)' }}>
            Configuration
          </div>
          <div className={`status-badge ${isRunning ? 'active' : 'paused'}`}>
            {isRunning ? 'Conversion Active' : 'Conversion Paused'}
          </div>
        </div>
        
        {/* Engine Status Widget */}
        <div className="card" style={{ padding: '16px', marginBottom: '20px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-default)', borderRadius: '8px' }}>
            <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Server size={18} /> Engine Status</div>
                <button 
                  className="btn btn-secondary" 
                  style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                  onClick={checkEngineStatus}
                  disabled={engineStatusLoading}
                >
                  Retry Connection
                </button>
            </h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.9rem' }}>
                <div>
                  <strong>Status: </strong>
                  {!engineStatus || (engineStatusLoading && !engineStatus?.status) ? 'Connecting...' : 
                   engineStatus.status === 'starting' ? <span style={{color: '#fbbf24'}}>Engine starting... ⏳</span> : 
                   (engineStatus.status === 'OK' || engineStatus.status === 'ok') ? <span style={{color: '#4ade80'}}>Engine ready</span> : 
                   <span style={{color: '#f87171'}}>Engine unavailable ({engineStatus.message || 'Error'})</span>}
                </div>
                <div>
                  <strong>Latency: </strong> 
                  {(engineStatus?.status === 'OK' || engineStatus?.status === 'ok') && engineStatus?.perfInfo?.perf ? (engineStatus.perfInfo.perf[1]*1000).toFixed(1) + ' ms' : 'N/A'}
                </div>
            </div>
        </div>

        {/* --- Profile Selector --- */}
        <div className="form-group">
          <label className="form-label">
            <Zap size={14} />
            Voice Profile
            <Tooltip text="Select which trained voice profile to use for conversion." />
          </label>
          <select
            className="form-input"
            value={selectedProfile}
            onChange={(e) => setSelectedProfile(e.target.value)}
            disabled={isRunning}
          >
            {profiles.length === 0 && (
              <option value="">No RVC profile imported</option>
            )}
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name} ({p.size_mb} MB)
              </option>
            ))}
          </select>
        </div>

        <div className="divider" />

        {/* --- Audio Devices --- */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Audio Devices</h3>
          <button 
            className="btn btn-secondary" 
            style={{ padding: '4px 8px', fontSize: '0.8rem' }}
            onClick={loadDevices}
            disabled={isRunning}
          >
            Refresh Devices
          </button>
        </div>
        <div style={{ padding: '12px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid var(--accent-blue)', borderRadius: '6px', marginBottom: '16px', fontSize: '0.9rem' }}>
          <strong>Audio Routing:</strong> For Discord/Games, set <em>Output (Speakers)</em> below to <strong>CABLE Input</strong>. Then, in Discord, set your microphone to <strong>CABLE Output</strong>.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
          <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input type="checkbox" checked={showAdvancedDevices} onChange={e => setShowAdvancedDevices(e.target.checked)} />
            Show Advanced Devices
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          {/* Input Device */}
          <div className="form-group">
            <label className="form-label">
              <Mic size={14} />
              Input (Microphone)
            </label>
            <select
              className={`form-input ${inputDevices.length === 0 ? 'error-border' : ''}`}
              value={selectedInput ?? ''}
              onChange={(e) => setSelectedInput(e.target.value ? Number(e.target.value) : null)}
              disabled={isRunning || inputDevices.length === 0}
            >
              <option value="">Select Input Device...</option>
              {inputDevices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.is_default ? '★ ' : ''}{d.name} ({d.sample_rate ? d.sample_rate / 1000 + 'kHz, ' : ''}{d.channels}ch)
                </option>
              ))}
            </select>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Select your physical microphone.
            </div>
          </div>

          {/* Output Device */}
          <div className="form-group">
            <label className="form-label">
              <Speaker size={14} />
              Output (Converter Destination)
            </label>
            <select
              className={`form-input ${outputDevices.length === 0 ? 'error-border' : ''}`}
              value={selectedOutput ?? ''}
              onChange={(e) => setSelectedOutput(e.target.value ? Number(e.target.value) : null)}
              disabled={isRunning || outputDevices.length === 0}
            >
              <option value="">Select Output Device...</option>
              {inputDevices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.is_default ? '★ ' : ''}{d.name} ({d.sample_rate ? d.sample_rate / 1000 + 'kHz, ' : ''}{d.channels}ch)
                </option>
              ))}
            </select>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
              Select CABLE Input (Virtual Cable) to route audio to Discord.
            </div>
          </div>
        </div>

        <div className="divider" />

        {/* --- Conversion Controls --- */}

        {/* Enable Toggle */}
        <div className="form-group">
          <div
            className="toggle"
            onClick={() => {
              const newEnabled = !isEnabled;
              setIsEnabled(newEnabled);
              handleSettingsUpdate({ enabled: newEnabled });
            }}
          >
            <div className={`toggle-track ${isEnabled ? 'active' : ''}`}>
              <div className="toggle-thumb" />
            </div>
            <span className="toggle-label">
              {isEnabled ? 'Voice conversion enabled' : 'Voice conversion disabled (pass-through)'}
            </span>
          </div>
        </div>

        {/* Pitch Shift */}
        <div className="form-group">
          <label className="form-label">
            Pitch Shift
            <Tooltip text="Move your voice higher (+) or lower (-). Each step is one semitone. 0 = no change." />
          </label>
          <div className="slider-container">
            <span className="text-sm text-muted">-12</span>
            <input
              type="range"
              min={-12}
              max={12}
              step={1}
              value={pitchShift}
              onChange={(e) => {
                const val = Number(e.target.value);
                setPitchShift(val);
                handleSettingsUpdate({ pitch_shift: val });
              }}
            />
            <span className="text-sm text-muted">+12</span>
            <div className="slider-value">
              {pitchShift > 0 ? `+${pitchShift}` : pitchShift}
            </div>
          </div>
        </div>

        {/* Chunk Size */}
        <div className="form-group">
          <label className="form-label">Chunk Size</label>
          <select 
            className="form-input" 
            value={chunkSize}
            onChange={(e) => {
              const val = Number(e.target.value);
              setChunkSize(val);
              updateEngineSettings('chunkSize', String(val));
            }}
          >
            <option value={64}>64</option>
            <option value={128}>128 (Default)</option>
            <option value={256}>256</option>
            <option value={512}>512</option>
          </select>
        </div>

        {/* F0 Detector */}
        <div className="form-group">
          <label className="form-label">F0 Detector</label>
          <select 
            className="form-input" 
            value={f0Detector}
            onChange={(e) => {
              const val = e.target.value;
              setF0Detector(val);
              updateEngineSettings('f0Detector', val);
            }}
          >
            <option value="rmvpe">rmvpe (Best Quality)</option>
            <option value="rmvpe_onnx">rmvpe_onnx</option>
            <option value="crepe_tiny_onnx">crepe_tiny_onnx</option>
            <option value="crepe_full_onnx">crepe_full_onnx</option>
          </select>
        </div>

        {/* Index Rate */}
        <div className="form-group">
          <label className="form-label">
            Voice Similarity
            <Tooltip text="How closely to match the trained voice. Higher = more similar, lower = more natural. 0.75 works well for most voices." />
          </label>
          <div className="slider-container">
            <span className="text-sm text-muted">0.0</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={indexRate}
              onChange={(e) => {
                const val = Number(e.target.value);
                setIndexRate(val);
                handleSettingsUpdate({ index_rate: val });
              }}
            />
            <span className="text-sm text-muted">1.0</span>
            <div className="slider-value">{indexRate.toFixed(2)}</div>
          </div>
        </div>

        <div className="divider" />

        {/* --- Volume Controls --- */}
        <div style={{ padding: '12px', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid var(--accent-blue)', borderRadius: '6px', marginBottom: '16px', fontSize: '0.9rem' }}>
          <strong>Audio Routing:</strong> For Discord/Games, set <em>Output (Speakers)</em> below to <strong>CABLE Input</strong>. Then, in Discord, set your microphone to <strong>CABLE Output</strong>.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          <div className="form-group">
            <label className="form-label">
              <Volume2 size={14} />
              Input Gain
            </label>
            <div className="slider-container">
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={inputGain}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setInputGain(val);
                  handleSettingsUpdate({ input_gain: val });
                }}
              />
              <div className="slider-value">{(inputGain * 100).toFixed(0)}%</div>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              <Volume2 size={14} />
              Output Gain
            </label>
            <div className="slider-container">
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={outputGain}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setOutputGain(val);
                  handleSettingsUpdate({ output_gain: val });
                }}
              />
              <div className="slider-value">{(outputGain * 100).toFixed(0)}%</div>
            </div>
          </div>
        </div>

        {/* --- Level Meters --- */}
        <div className="level-meters">
          <div className="level-meter">
            <div className="level-meter-label">Input Level</div>
            <div className="level-meter-bar">
              <div
                className="level-meter-fill"
                style={{ width: `${levelToPercent(inputLevel)}%` }}
              />
            </div>
          </div>
          <div className="level-meter">
            <div className="level-meter-label">Output Level</div>
            <div className="level-meter-bar">
              <div
                className="level-meter-fill"
                style={{ width: `${levelToPercent(outputLevel)}%` }}
              />
            </div>
          </div>
        </div>

        {/* --- Error Display --- */}
        {error && (
          <div className="info-box error mb-4">
            <div className="info-box-icon"><AlertCircle size={18} /></div>
            <div>{error}</div>
          </div>
        )}

        {/* --- Action Buttons --- */}
        <div className="btn-group justify-center mt-6">
          {!isRunning ? (
            <button
              className="btn btn-success btn-lg"
              onClick={handleStart}
              disabled={isLoading || !selectedProfile}
            >
              {isLoading ? (
                <>
                  <Mic size={18} style={{ animation: 'spin 1s linear infinite' }} />
                  Starting...
                </>
              ) : (
                <>
                  <Play size={18} />
                  Start Conversion
                </>
              )}
            </button>
          ) : (
            <button
              className="btn btn-danger btn-lg"
              onClick={handleStop}
            >
              <Square size={18} />
              Stop Conversion
            </button>
          )}

          <button
            className="btn btn-ghost"
            onClick={handleTest}
            disabled={isTesting || !selectedProfile}
          >
            {isTesting ? (
              <>
                <FlaskConical size={16} style={{ animation: 'spin 1s linear infinite' }} />
                Testing...
              </>
            ) : (
              <>
                <FlaskConical size={16} />
                Test with Sample
              </>
            )}
          </button>
        </div>

        {/* Hidden audio element for test playback */}
        <audio ref={testAudioRef} style={{ display: 'none' }} />
      </motion.div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
