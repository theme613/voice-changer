import { useState, useEffect } from 'react';
import { getSettings, updateSettings, checkPortAvailability, verifyEngineEdition, killAllProcesses, restartEngine, detectTrainer, browseFolder, fixDiagnostics, getSystemGpu, type Settings, type TrainerDetectResult } from '../api';
import { Save, RefreshCw, FolderOpen, HardDrive, Cpu, Volume2, Settings as SettingsIcon, AlertCircle, CheckCircle, Server, Activity, Search } from 'lucide-react';

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  
  const [portStatus, setPortStatus] = useState<{backend?: string, sidecar?: string}>({});
  const [engineEdition, setEngineEdition] = useState<{valid?: boolean, edition?: string, msg?: string}>({});
  const [trainerDetect, setTrainerDetect] = useState<TrainerDetectResult | null>(null);
  const [detectingTrainer, setDetectingTrainer] = useState(false);
  const [settingUpModels, setSettingUpModels] = useState(false);
  const [activeTab, setActiveTab] = useState<'basic' | 'advanced'>('basic');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await getSettings();
      setSettings(data);
      const gpu = await getSystemGpu();
      
    } catch (err: any) {
      setMessage(`Failed to load settings: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleBrowse = async (key: keyof Settings['paths']) => {
    try {
      const folderPath = await browseFolder();
      if (folderPath && settings) {
        setSettings({...settings, paths: {...settings.paths, [key]: folderPath}});
        if (key === 'external_trainer_path') {
          setTrainerDetect(null);
        }
      }
    } catch (e) {
      console.error("Browse error:", e);
    }
  };

  const handleSave = async () => {
    if (!settings) return;
    setSaving(true);
    setMessage('');
    try {
      await updateSettings(settings);
      setMessage('Settings saved successfully!');
      setTimeout(() => setMessage(''), 3000);
    } catch (err: any) {
      setMessage(`Failed to save: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    loadSettings();
  };

  const handleVerifyEngine = async () => {
    if (!settings) return;
    try {
      const res = await verifyEngineEdition(settings.paths.engine_dir);
      setEngineEdition({ valid: res.valid, edition: res.edition, msg: res.message });
    } catch (e: any) {
      setEngineEdition({ valid: false, msg: e.message });
    }
  };

  const handleDetectTrainer = async () => {
    if (!settings) return;
    setDetectingTrainer(true);
    setTrainerDetect(null);
    try {
      const res = await detectTrainer(settings.paths.external_trainer_path || undefined);
      setTrainerDetect(res);
    } catch (e: any) {
      setTrainerDetect({
        found: false, launch_target: null, launch_target_abs: null,
        type: null, incomplete: false,
        message: `Detection failed: ${e.message}`
      });
    } finally {
      setDetectingTrainer(false);
    }
  };

  const handleOpenTrainer = async () => {
    try {
      await fetch('/api/trainer/launch', { method: 'POST' });
    } catch (e) {
      console.error(e);
    }
  };


  const handleCheckPort = async (port: number, type: 'backend' | 'sidecar') => {
    try {
      const res = await checkPortAvailability(port, type);
      setPortStatus(prev => ({ ...prev, [type]: res.available ? 'Available' : res.message }));
    } catch (e: any) {
      setPortStatus(prev => ({ ...prev, [type]: `Error: ${e.message}` }));
    }
  };

  const handleKillAll = async () => {
    try {
      const res = await killAllProcesses();
      setMessage(res.message);
    } catch (e: any) {
      setMessage(`Kill failed: ${e.message}`);
    }
  };

  const handleRestartEngine = async () => {
    try {
      const res = await restartEngine();
      setMessage(res.message);
    } catch (e: any) {
      setMessage(`Restart failed: ${e.message}`);
    }
  };

  if (loading || !settings) {
    return <div style={{ padding: '24px' }}>Loading settings...</div>;
  }

  return (
    <div style={{ padding: '24px', maxWidth: '800px', width: '100%' }}>
      <h2 style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <SettingsIcon className="icon" size={24} /> Application Settings
      </h2>
      
      {/* Tabs */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '24px', borderBottom: '1px solid var(--border-default)' }}>
        <button 
          onClick={() => setActiveTab('basic')} 
          style={{ padding: '8px 16px', background: 'none', border: 'none', borderBottom: activeTab === 'basic' ? '2px solid var(--accent-blue)' : '2px solid transparent', color: activeTab === 'basic' ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '16px' }}
        >
          Basic
        </button>
        <button 
          onClick={() => setActiveTab('advanced')} 
          style={{ padding: '8px 16px', background: 'none', border: 'none', borderBottom: activeTab === 'advanced' ? '2px solid var(--accent-blue)' : '2px solid transparent', color: activeTab === 'advanced' ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer', fontSize: '16px' }}
        >
          Advanced
        </button>
      </div>

      {activeTab === 'basic' && (
        <>
          {/* 1. Storage & Models */}
      <div className="card" style={{ padding: '20px', marginBottom: '20px', backgroundColor: 'var(--bg-surface)', borderRadius: '8px' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}><FolderOpen size={18}/> Storage & Models</h3>
        
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: 'var(--text-secondary)' }}>Vocal Isolation Models Folder</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input type="text" value={settings.paths.models_dir} onChange={e => setSettings({...settings, paths: {...settings.paths, models_dir: e.target.value}})} style={{ flex: 1, padding: '8px', borderRadius: '4px', backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-default)', color: 'white' }} />
            <button className="btn-secondary" onClick={() => handleBrowse('models_dir')}>Browse</button>
            <button className="btn-primary" onClick={async () => {
              setSettingUpModels(true);
              try {
                const res = await fixDiagnostics('vocal_models');
                setMessage(res.message);
              } catch (e: any) {
                setMessage(`Setup failed: ${e.message}`);
              } finally {
                setSettingUpModels(false);
              }
            }} disabled={settingUpModels}>
              {settingUpModels ? 'Setting up...' : 'Set Up Vocal Models'}
            </button>
          </div>
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: 'var(--text-secondary)' }}>RVC Voice Profiles Folder</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input type="text" value={settings.paths.profiles_dir} onChange={e => setSettings({...settings, paths: {...settings.paths, profiles_dir: e.target.value}})} style={{ flex: 1, padding: '8px', borderRadius: '4px', backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-default)', color: 'white' }} />
            <button className="btn-secondary" onClick={() => handleBrowse('profiles_dir')}>Browse</button>
          </div>
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: 'var(--text-secondary)' }}>Temporary Files Folder</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input type="text" value={settings.paths.temp_dir} onChange={e => setSettings({...settings, paths: {...settings.paths, temp_dir: e.target.value}})} style={{ flex: 1, padding: '8px', borderRadius: '4px', backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-default)', color: 'white' }} />
            <button className="btn-secondary" onClick={() => handleBrowse('temp_dir')}>Browse</button>
          </div>
        </div>
        
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: 'var(--text-secondary)' }}>Engine Server Folder</label>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
            <input type="text" value={settings.paths.engine_dir} onChange={e => setSettings({...settings, paths: {...settings.paths, engine_dir: e.target.value}})} style={{ flex: 1, padding: '8px', borderRadius: '4px', backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-default)', color: 'white' }} />
            <button className="btn-secondary" onClick={() => handleBrowse('engine_dir')}>Browse</button>
            <button className="btn-secondary" onClick={handleVerifyEngine}>Verify Edition</button>
          </div>
          {engineEdition.msg && (
            <div style={{ fontSize: '12px', color: engineEdition.valid ? 'var(--success)' : 'var(--error)' }}>
              {engineEdition.valid ? <CheckCircle size={12} style={{marginRight: 4}}/> : <AlertCircle size={12} style={{marginRight: 4}}/>}
              {engineEdition.msg} {engineEdition.edition && `(Edition: ${engineEdition.edition})`}
            </div>
          )}
        </div>
        
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: 'var(--text-secondary)' }}>External Applio/RVC Trainer Folder</label>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
            <input
              type="text"
              value={settings.paths.external_trainer_path || ''}
              onChange={e => {
                setSettings({...settings, paths: {...settings.paths, external_trainer_path: e.target.value}});
                setTrainerDetect(null);
              }}
              placeholder="e.g. C:\Applio"
              style={{ flex: 1, padding: '8px', borderRadius: '4px', backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-default)', color: 'white' }}
            />
            <button className="btn-secondary" onClick={() => handleBrowse('external_trainer_path')}>Browse</button>
            <button className="btn-secondary" onClick={handleDetectTrainer} disabled={detectingTrainer} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Search size={14} />{detectingTrainer ? 'Detecting…' : 'Detect'}
            </button>
          </div>
          {trainerDetect && (
            <div style={{
              fontSize: '12px', padding: '8px 10px', borderRadius: '6px',
              backgroundColor: trainerDetect.found ? 'rgba(52,211,153,0.08)' : trainerDetect.incomplete ? 'rgba(245,158,11,0.08)' : 'rgba(239,68,68,0.08)',
              border: `1px solid ${trainerDetect.found ? '#34d39940' : trainerDetect.incomplete ? '#f59e0b40' : '#ef444440'}`,
              color: 'var(--text-secondary)', marginBottom: '4px'
            }}>
              {trainerDetect.found
                ? <>✅ {trainerDetect.message} <span style={{ opacity: 0.6, marginLeft: '8px' }}>type: {trainerDetect.type}</span></>
                : trainerDetect.incomplete
                  ? <>⚠️ {trainerDetect.message}</>
                  : <>❌ {trainerDetect.message}</>}
            </div>
          )}
          {!trainerDetect && (
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>Point this to your Applio or RVC-Project <strong>folder</strong>, then click Detect to verify it.</div>
          )}
          <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
            <button className="btn-secondary" onClick={() => window.open('https://github.com/IAHispano/Applio/releases', '_blank')}>Download Applio (GitHub)</button>
            <button className="btn-secondary" onClick={handleOpenTrainer} disabled={!trainerDetect?.found}>Open Trainer</button>
          </div>
        </div>
      </div>
      {/* Performance */}
      <div className="card" style={{ padding: '20px', marginBottom: '20px', backgroundColor: 'var(--bg-surface)', borderRadius: '8px' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}><Cpu size={18}/> Performance</h3>
        
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: 'var(--text-secondary)' }}>Processing Device</label>
          <select value={settings.performance.device} onChange={e => setSettings({...settings, performance: {...settings.performance, device: e.target.value}})} style={{ padding: '8px', borderRadius: '4px', backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-default)', color: 'white', width: '200px' }}>
            <option value="auto">Auto</option>
            <option value="cuda">NVIDIA GPU (CUDA)</option>
            <option value="cpu">CPU Only</option>
          </select>
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: 'var(--text-secondary)' }}>FP16 (Half Precision)</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginBottom: '16px' }}>
            <input type="checkbox" checked={settings.performance.fp16} onChange={e => setSettings({...settings, performance: {...settings.performance, fp16: e.target.checked}})} />
            Enable FP16 (Faster, uses less VRAM)
          </label>
        </div>
        
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: 'var(--text-secondary)' }}>Chunk Size</label>
          <select value={settings.performance.chunk_size} onChange={e => setSettings({...settings, performance: {...settings.performance, chunk_size: parseInt(e.target.value)}})} style={{ padding: '8px', borderRadius: '4px', backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-default)', color: 'white', width: '200px' }}>
            <option value="32">32 (Lowest Latency)</option>
            <option value="64">64 (Lower Latency)</option>
            <option value="128">128 (Balanced - Recommended)</option>
            <option value="256">256 (Better Quality)</option>
          </select>
        </div>
      </div>
      </>
      )}

      {activeTab === 'advanced' && (
        <>
      {/* Ports */}
      <div className="card" style={{ padding: '20px', marginBottom: '20px', backgroundColor: 'var(--bg-surface)', borderRadius: '8px' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}><Server size={18}/> Server Ports</h3>
        
        <div style={{ display: 'flex', gap: '20px' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: 'var(--text-secondary)' }}>Backend API Port</label>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
              <input type="number" value={settings.ports.backend} onChange={e => setSettings({...settings, ports: {...settings.ports, backend: parseInt(e.target.value)}})} style={{ width: '120px', padding: '8px', borderRadius: '4px', backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-default)', color: 'white' }} />
              <button className="btn-secondary" onClick={() => handleCheckPort(settings.ports.backend, 'backend')}>Check Port</button>
            </div>
            {portStatus.backend && <div style={{fontSize: '12px', color: portStatus.backend === 'Available' ? 'var(--success)' : 'var(--error)'}}>{portStatus.backend}</div>}
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>Requires full app restart to apply.</div>
          </div>
          
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: 'var(--text-secondary)' }}>Engine Sidecar Port</label>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
              <input type="number" value={settings.ports.sidecar} onChange={e => setSettings({...settings, ports: {...settings.ports, sidecar: parseInt(e.target.value)}})} style={{ width: '120px', padding: '8px', borderRadius: '4px', backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-default)', color: 'white' }} />
              <button className="btn-secondary" onClick={() => handleCheckPort(settings.ports.sidecar, 'sidecar')}>Check Port</button>
            </div>
            {portStatus.sidecar && <div style={{fontSize: '12px', color: portStatus.sidecar === 'Available' ? 'var(--success)' : 'var(--error)'}}>{portStatus.sidecar}</div>}
            <div style={{ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px' }}>Requires engine restart to apply.</div>
          </div>
        </div>
      </div>

      {/* 3. Audio Devices */}
      <div className="card" style={{ padding: '20px', marginBottom: '20px', backgroundColor: 'var(--bg-surface)', borderRadius: '8px' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}><Volume2 size={18}/> Audio Config</h3>
        
        <div style={{ display: 'flex', gap: '16px' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: 'var(--text-secondary)' }}>Sample Rate</label>
            <select value={settings.audio.sample_rate} onChange={e => setSettings({...settings, audio: {...settings.audio, sample_rate: parseInt(e.target.value)}})} style={{ width: '100%', padding: '8px', borderRadius: '4px', backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-default)', color: 'white' }}>
              <option value={44100}>44100 Hz</option>
              <option value={48000}>48000 Hz</option>
            </select>
          </div>
          
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '14px', color: 'var(--text-secondary)' }}>Buffer Size</label>
            <select value={settings.audio.buffer_size} onChange={e => setSettings({...settings, audio: {...settings.audio, buffer_size: parseInt(e.target.value)}})} style={{ width: '100%', padding: '8px', borderRadius: '4px', backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-default)', color: 'white' }}>
              <option value={512}>512 (Fastest, High CPU)</option>
              <option value={1024}>1024 (Balanced)</option>
              <option value={2048}>2048 (Safest, High Latency)</option>
            </select>
          </div>
        </div>
      </div>

      {/* 4. Startup & Logs */}
      <div className="card" style={{ padding: '20px', marginBottom: '20px', backgroundColor: 'var(--bg-surface)', borderRadius: '8px' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}><HardDrive size={18}/> Startup & Logs</h3>
        
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', cursor: 'pointer' }}>
          <input type="checkbox" checked={settings.general.auto_check_files} onChange={e => setSettings({...settings, general: {...settings.general, auto_check_files: e.target.checked}})} />
          Automatically check for missing files on startup
        </label>
        
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', cursor: 'pointer' }}>
          <input type="checkbox" checked={settings.general.detailed_logs} onChange={e => setSettings({...settings, general: {...settings.general, detailed_logs: e.target.checked}})} />
          Keep detailed logs (useful for debugging)
        </label>
      </div>

      {/* Process Management */}
      <div className="card" style={{ padding: '20px', marginBottom: '20px', backgroundColor: 'var(--bg-surface)', borderRadius: '8px' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}><Activity size={18}/> Process Management</h3>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={handleRestartEngine}>Restart Engine</button>
          <button className="btn-secondary" onClick={() => window.open(`${window.location.origin}/api/logs`, '_blank')}>View Engine Logs</button>
          <button className="btn-danger" onClick={handleKillAll} style={{ backgroundColor: 'var(--error)', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}>Kill All Voice Changer Processes</button>
        </div>
      </div>
      
      </>
      )}

      {/* Action Bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '24px' }}>
        <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Save size={18} /> {saving ? 'Saving...' : 'Save Settings'}
        </button>
        <button className="btn-secondary" onClick={handleReset} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <RefreshCw size={18} /> Reset Changes
        </button>
        
        {message && (
          <span style={{ color: message.includes('failed') ? 'var(--error-red)' : 'var(--success-green)' }}>
            {message}
          </span>
        )}
      </div>
    </div>
  );
}
