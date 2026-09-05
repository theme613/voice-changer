/**
 * TrainForm.tsx — Prepare Dataset & Import Profile
 *
 * External-only workflow. Internal training is removed.
 * Steps:
 *  1. Profile Name
 *  2. Export Dataset (with real file stats, copy/open buttons)
 *  3. Launch external Applio/RVC trainer (with live status + stop)
 *  4. Import Profile via native file picker OR auto-scan (with validation, overwrite guard)
 *
 * Training phase indicators track:
 *  ✓ Dataset prepared → ✓ Features extracted → ✓ Index generated → ✗ Checkpoint saved → ✗ Model exported
 *
 * CRITICAL: The UI cannot show "Model trained successfully" unless a real .pth file
 * exists, is >1MB, is readable, and was created after training began.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Cpu, FolderOpen, Download, Upload, CheckCircle2, XCircle,
  Info, Copy, Square, Play, RefreshCw, AlertTriangle, Search,
  Terminal, FileText, Circle,
} from 'lucide-react';

import Tooltip from './Tooltip';
import {
  prepareDataset,
  getDatasetStats,
  detectTrainer,
  launchTrainer,
  getTrainerStatus,
  stopTrainer,
  importProfileLocal,
  browseFile,
  getSystemGpu,
  scanTrainingOutput,
  getTrainerLogs,
  type DatasetStats,
  type TrainerDetectResult,
  type TrainerStatusResult,
  type TrainingScanResult,
  type TrainerLogsResult,
} from '../api';

interface TrainFormProps {
  datasetFiles: string[];
  onComplete: (profileName: string) => void;
  onCancel?: () => void;
}

function formatDuration(s: number) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(2)} MB`;
}

/** Phase indicator pill */
function PhaseIndicator({ label, done, active }: { label: string; done: boolean; active?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px',
      padding: '4px 10px', borderRadius: '6px',
      backgroundColor: done
        ? 'rgba(52,211,153,0.10)'
        : active
          ? 'rgba(79,140,255,0.10)'
          : 'rgba(255,255,255,0.03)',
      border: `1px solid ${done ? 'rgba(52,211,153,0.3)' : active ? 'rgba(79,140,255,0.3)' : 'var(--border-subtle)'}`,
      color: done ? 'var(--accent-green)' : active ? 'var(--accent-blue)' : 'var(--text-tertiary)',
    }}>
      {done
        ? <CheckCircle2 size={13} />
        : active
          ? <Circle size={13} style={{ animation: 'pulse 1.5s infinite' }} />
          : <Circle size={13} />
      }
      {label}
    </div>
  );
}

export default function TrainForm({ datasetFiles, onComplete, onCancel }: TrainFormProps) {
  const [profileName, setProfileName] = useState('My Voice 1');

  // Dataset state
  const [datasetFolder, setDatasetFolder] = useState<string | null>(null);
  const [datasetStats, setDatasetStats] = useState<DatasetStats | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);

  // Trainer state
  const [trainerInfo, setTrainerInfo] = useState<TrainerDetectResult | null>(null);
  const [trainerStatus, setTrainerStatus] = useState<TrainerStatusResult | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const trainerPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [gpuStats, setGpuStats] = useState<any>(null);
  const [showTrainerLogs, setShowTrainerLogs] = useState(false);
  const [trainerLogs, setTrainerLogs] = useState<TrainerLogsResult | null>(null);

  // Training scan state
  const [scanResult, setScanResult] = useState<TrainingScanResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  // Import state
  const [pthPath, setPthPath] = useState<string | null>(null);
  const [indexPath, setIndexPath] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [needsOverwriteConfirm, setNeedsOverwriteConfirm] = useState(false);

  // Status
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [copied, setCopied] = useState(false);

  // On mount: detect trainer + poll trainer status
  useEffect(() => {
    detectTrainer().then(setTrainerInfo).catch(() => {});
    getSystemGpu().then(setGpuStats).catch(() => {});
    refreshTrainerStatus();
    trainerPollRef.current = setInterval(refreshTrainerStatus, 5000);
    return () => {
      if (trainerPollRef.current) clearInterval(trainerPollRef.current);
    };
  }, []);

  const refreshTrainerStatus = useCallback(async () => {
    try {
      const s = await getTrainerStatus();
      setTrainerStatus(s);
    } catch { /* backend may not be up yet */ }
  }, []);

  const refreshTrainerLogs = useCallback(async () => {
    try {
      const logs = await getTrainerLogs(200);
      setTrainerLogs(logs);
    } catch { /* ignore */ }
  }, []);

  // ─── Step 1: Prepare Dataset ─────────────────────────────────────────────

  const handlePrepareDataset = async () => {
    if (!profileName.trim()) { setError('Enter a profile name first.'); return; }
    setError(''); setSuccessMsg(''); setIsPreparing(true);
    try {
      const result = await prepareDataset(datasetFiles, profileName.trim());
      setDatasetFolder(result.dataset_folder);
      setDatasetStats(result.stats);
      setSuccessMsg('Dataset exported successfully.');
    } catch (err: any) {
      setError(err.message || 'Failed to export dataset.');
    } finally {
      setIsPreparing(false);
    }
  };

  const handleCopyPath = async () => {
    if (!datasetFolder) return;
    await navigator.clipboard.writeText(datasetFolder);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const refreshDatasetStats = async () => {
    if (!datasetFolder) return;
    try {
      const s = await getDatasetStats(datasetFolder);
      setDatasetStats(s);
    } catch (e: any) {
      setError(`Failed to refresh dataset stats: ${e.message}`);
    }
  };

  // ─── Step 2: Launch / Stop Trainer ───────────────────────────────────────

  const handleLaunch = async () => {
    setError(''); setIsLaunching(true);
    try {
      await launchTrainer();
      await refreshTrainerStatus();
      const info = await detectTrainer();
      setTrainerInfo(info);
    } catch (err: any) {
      setError(err.message || 'Failed to launch trainer.');
    } finally {
      setIsLaunching(false);
    }
  };

  const handleStop = async () => {
    setError('');
    try {
      await stopTrainer();
      await refreshTrainerStatus();
    } catch (err: any) {
      setError(err.message || 'Failed to stop trainer.');
    }
  };

  // ─── Step 3: Find Training Output / Import ─────────────────────────────

  const handleFindTrainingOutput = async () => {
    setError(''); setIsScanning(true); setScanResult(null);
    try {
      const safeName = profileName.trim().replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'songbird';
      const result = await scanTrainingOutput(safeName);
      setScanResult(result);

      if (result.verdict === 'model_ready' && result.best_model_path) {
        // Auto-populate the paths
        setPthPath(result.best_model_path);
        if (result.best_index_path) {
          setIndexPath(result.best_index_path);
        }
        setSuccessMsg(`Found trained model: ${result.pth_files?.[0]?.name || 'model.pth'} (${result.pth_files?.[0]?.size_mb || '?'} MB)`);
      } else {
        // Show the scan verdict as an error
        setError(result.verdict_message);
        // Also load trainer logs for context
        await refreshTrainerLogs();
        setShowTrainerLogs(true);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to scan training output.');
    } finally {
      setIsScanning(false);
    }
  };

  const handlePthBrowse = async () => {
    try {
      const path = await browseFile('pth');
      if (path) {
        setPthPath(path);
        setError('');
        setNeedsOverwriteConfirm(false);
      }
    } catch (e: any) {
      if (e.message !== 'No file selected') {
        setError(`Failed to select file: ${e.message}`);
      }
    }
  };

  const handleIndexBrowse = async () => {
    try {
      const path = await browseFile('index');
      if (path) {
        setIndexPath(path);
        setError('');
      }
    } catch (e: any) {
      if (e.message !== 'No file selected') {
        setError(`Failed to select file: ${e.message}`);
      }
    }
  };

  const handleImport = async (forceOverwrite = false) => {
    if (!profileName.trim()) { setError('Profile name is required.'); return; }
    if (!pthPath) { setError('Select a .pth model file to import.'); return; }

    setError(''); setSuccessMsg(''); setIsImporting(true); setNeedsOverwriteConfirm(false);
    try {
      const result = await importProfileLocal(
        profileName.trim(),
        pthPath,
        indexPath || null,
        forceOverwrite
      );
      setSuccessMsg(`Profile '${result.profile_name}' imported — ${result.model_size_mb} MB. Ready to use.`);
      setTimeout(() => onComplete(result.profile_name), 1500);
    } catch (err: any) {
      // 409 = profile already exists
      if (err.message?.includes('already exists')) {
        setNeedsOverwriteConfirm(true);
        setError(err.message);
      } else {
        setError(err.message || 'Import failed.');
      }
    } finally {
      setIsImporting(false);
    }
  };

  const handleCopyTrainingError = async () => {
    const errorText = [
      `Verdict: ${scanResult?.verdict || 'unknown'}`,
      `Message: ${scanResult?.verdict_message || error}`,
      `Scan path: ${scanResult?.scan_path || 'N/A'}`,
      `PTH files: ${scanResult?.pth_files?.length || 0}`,
      `Checkpoint files: ${scanResult?.checkpoint_files?.length || 0}`,
      `Index files: ${scanResult?.index_files?.length || 0}`,
      `TensorBoard events: ${scanResult?.tensorboard_events?.map(e => `${e.name} (${e.size_bytes}B)`).join(', ') || 'none'}`,
      '',
      'Phases:',
      ...(scanResult?.phases ? Object.entries(scanResult.phases).map(([k, v]) => `  ${k}: ${v}`) : ['  N/A']),
      '',
      'Recent trainer log:',
      ...(trainerLogs?.process_log?.slice(-20) || ['  No logs captured']),
    ].join('\n');
    await navigator.clipboard.writeText(errorText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRetryTraining = async () => {
    setError(''); setScanResult(null);
    await handleLaunch();
  };

  const trainerRunning = trainerStatus?.running ?? false;

  // Derive phases from scan result
  const phases = scanResult?.phases;

  return (
    <div>
      {/* Info banner */}
      <div className="info-box info" style={{ marginBottom: '24px' }}>
        <div className="info-box-icon"><Info size={20} /></div>
        <div>
          <strong>How it works:</strong>
          <ol style={{ margin: '8px 0 0 20px', padding: 0 }}>
            <li>Name your profile and click <strong>Export Dataset</strong> to convert your vocals into training files.</li>
            <li>Launch your external Applio or RVC-Project trainer and point it at the dataset folder shown.</li>
            <li>After the trainer finishes, click <strong>Find Training Output</strong> to auto-detect the model, or manually pick the <code>.pth</code> file.</li>
            <li>The profile will be available instantly in the Voice Changer tab.</li>
          </ol>
        </div>
      </div>

      <motion.div className="card" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Cpu size={22} className="text-primary" />
            Profile Workflow
          </h3>
          {onCancel && (
            <button onClick={onCancel} className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '13px' }}>
              ← Back to Audio
            </button>
          )}
        </div>

        {/* Profile Name */}
        <div className="form-group" style={{ maxWidth: '400px' }}>
          <label className="form-label" htmlFor="profile-name">
            Profile Name
            <Tooltip text="Used as the dataset folder name and imported profile identifier." />
          </label>
          <input
            id="profile-name"
            type="text"
            className="form-input"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder="e.g., My Streamer Voice"
            maxLength={50}
          />
        </div>

        {/* ─── Training Phase Indicators ──────────────────── */}
        {phases && (
          <div style={{ marginTop: '20px', marginBottom: '8px' }}>
            <div style={{
              fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px',
              fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px'
            }}>
              Training Progress
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <PhaseIndicator label="Dataset Prepared" done={phases.dataset_prepared} />
              <PhaseIndicator label="Features Extracted" done={phases.features_extracted} />
              <PhaseIndicator label="Index Generated" done={phases.index_generated} />
              <PhaseIndicator label="Checkpoint Saved" done={phases.checkpoint_saved} active={phases.index_generated && !phases.checkpoint_saved} />
              <PhaseIndicator label="Model Exported" done={phases.model_exported} active={phases.checkpoint_saved && !phases.model_exported} />
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px', marginTop: '28px' }}>

          {/* ─── STEP 1: Export Dataset ─────────────────── */}
          <div style={{ padding: '20px', border: '1px solid var(--border-default)', borderRadius: '10px', backgroundColor: 'var(--bg-base)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
              <Download size={16} /> Step 1 — Export Dataset
            </h4>

            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              {datasetFiles.length} audio file{datasetFiles.length !== 1 ? 's' : ''} queued
            </div>

            <button
              className="btn btn-primary"
              onClick={handlePrepareDataset}
              disabled={isPreparing || datasetFiles.length === 0}
              style={{ width: '100%' }}
            >
              {isPreparing ? 'Exporting…' : 'Export Dataset'}
            </button>

            {datasetFolder && (
              <div style={{ fontSize: '12px', backgroundColor: 'var(--bg-surface)', padding: '12px', borderRadius: '6px', border: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Dataset Folder</span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '2px 8px', fontSize: '11px' }}
                      onClick={handleCopyPath}
                    >
                      <Copy size={11} style={{ marginRight: '3px' }} />
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: '2px 8px', fontSize: '11px' }}
                      onClick={refreshDatasetStats}
                    >
                      <RefreshCw size={11} />
                    </button>
                  </div>
                </div>
                <code style={{ display: 'block', wordBreak: 'break-all', color: 'var(--accent-blue)', fontSize: '11px', marginBottom: '10px' }}>
                  {datasetFolder}
                </code>
                {datasetStats && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', color: 'var(--text-secondary)', fontSize: '12px' }}>
                    <span>Files</span><span style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>{datasetStats.file_count}</span>
                    <span>Duration</span><span style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>{formatDuration(datasetStats.total_duration_s)}</span>
                    <span>Sample Rate</span><span style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>{datasetStats.sample_rate} Hz</span>
                    <span>Format</span><span style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>{datasetStats.format}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ─── STEP 2: Launch Trainer ──────────────────── */}
          <div style={{ padding: '20px', border: '1px solid var(--border-default)', borderRadius: '10px', backgroundColor: 'var(--bg-base)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
              <Cpu size={16} /> Step 2 — Launch Trainer
            </h4>

            {/* Trainer detection status */}
            {trainerInfo ? (
              <div style={{
                fontSize: '12px', padding: '8px 10px', borderRadius: '6px',
                backgroundColor: trainerInfo.found
                  ? 'rgba(52,211,153,0.08)'
                  : trainerInfo.incomplete
                    ? 'rgba(245,158,11,0.08)'
                    : 'rgba(239,68,68,0.08)',
                border: `1px solid ${trainerInfo.found ? 'var(--accent-green)' : trainerInfo.incomplete ? 'var(--accent-amber)' : 'var(--accent-red)'}20`,
                color: 'var(--text-secondary)'
              }}>
                {trainerInfo.found
                  ? <><CheckCircle2 size={12} style={{ marginRight: '4px', color: 'var(--accent-green)' }} />{trainerInfo.message}</>
                  : trainerInfo.incomplete
                    ? <><AlertTriangle size={12} style={{ marginRight: '4px', color: 'var(--accent-amber)' }} />{trainerInfo.message}</>
                    : <><XCircle size={12} style={{ marginRight: '4px', color: 'var(--accent-red)' }} />{trainerInfo.message}</>}
              </div>
            ) : (
              <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Detecting trainer…</div>
            )}

            {/* Recommended Preset (Handoff Panel) */}
            {trainerInfo?.found && datasetStats && gpuStats && (
              <div style={{ fontSize: '12px', backgroundColor: 'var(--bg-surface)', padding: '12px', borderRadius: '6px', border: '1px solid var(--accent-blue)' }}>
                <strong style={{ color: 'var(--accent-blue)', display: 'block', marginBottom: '8px' }}>Recommended Training Settings:</strong>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', color: 'var(--text-secondary)' }}>
                  <span>Batch Size:</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {gpuStats.vram_total_mb && gpuStats.vram_total_mb >= 10000 ? '12 - 16' : gpuStats.vram_total_mb && gpuStats.vram_total_mb >= 6000 ? '8' : '4'}
                  </span>
                  
                  <span>Save Frequency:</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {datasetStats.total_duration_s < 600 ? '10 - 15' : '20 - 25'} epochs
                  </span>
                  
                  <span>Total Epochs:</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                    {datasetStats.total_duration_s < 600 ? '250 - 300' : '150 - 200'}
                  </span>
                </div>
                <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                  <em>Note: Applio does not currently support fully automated headless training safely. Launch Applio and enter these values in the Train tab.</em>
                </div>
              </div>
            )}

            {/* Trainer process status */}
            {trainerStatus && (
              <div style={{
                fontSize: '12px', padding: '8px 10px', borderRadius: '6px',
                backgroundColor: trainerRunning ? 'rgba(79,140,255,0.08)' : 'transparent',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)'
              }}>
                {trainerRunning
                  ? <><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--accent-green)', marginRight: 6 }} />Running · PID {trainerStatus.pid}</>
                  : trainerStatus.exit_code !== null
                    ? `Exited with code ${trainerStatus.exit_code}`
                    : 'Not running'}
              </div>
            )}

            {!trainerRunning ? (
              <button
                className="btn btn-primary"
                onClick={handleLaunch}
                disabled={isLaunching || !trainerInfo?.found}
                style={{ width: '100%' }}
              >
                {isLaunching ? 'Launching…' : <><Play size={14} style={{ marginRight: '6px' }} />Launch Trainer</>}
              </button>
            ) : (
              <button
                className="btn btn-secondary"
                onClick={handleStop}
                style={{ width: '100%', borderColor: 'var(--accent-red)', color: 'var(--accent-red)' }}
              >
                <Square size={14} style={{ marginRight: '6px' }} />Stop Trainer
              </button>
            )}

            {!trainerInfo?.found && (
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>
                Configure the trainer path in <strong>Settings → External Trainer</strong>.
              </div>
            )}

            {/* Trainer log toggle */}
            <button
              className="btn btn-secondary"
              style={{ width: '100%', fontSize: '11px', padding: '4px 8px', opacity: 0.7 }}
              onClick={async () => {
                if (!showTrainerLogs) await refreshTrainerLogs();
                setShowTrainerLogs(!showTrainerLogs);
              }}
            >
              <Terminal size={12} style={{ marginRight: '4px' }} />
              {showTrainerLogs ? 'Hide Logs' : 'Show Training Logs'}
            </button>

            {/* Recent trainer log — expanded view */}
            <AnimatePresence>
              {showTrainerLogs && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  style={{ overflow: 'hidden' }}
                >
                  <div style={{
                    fontSize: '10px', fontFamily: 'monospace', backgroundColor: '#000',
                    padding: '8px', borderRadius: '4px', maxHeight: '200px', overflowY: 'auto',
                    color: '#aaa', whiteSpace: 'pre-wrap'
                  }}>
                    {(trainerLogs?.process_log?.length || 0) > 0
                      ? trainerLogs!.process_log.slice(-50).map((line, i) => (
                          <div key={i} style={{
                            color: line.toLowerCase().includes('error') ? '#ef4444'
                              : line.toLowerCase().includes('warning') ? '#f59e0b'
                              : line.includes('epoch=') ? '#34d399'
                              : '#aaa'
                          }}>{line}</div>
                        ))
                      : trainerRunning && trainerStatus && trainerStatus.log.length > 0
                        ? trainerStatus.log.slice(-30).join('\n')
                        : 'No training logs captured yet. Launch the trainer and start training in Applio.'
                    }
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ─── STEP 3: Import Profile ──────────────────── */}
          <div style={{ padding: '20px', border: '1px solid var(--border-default)', borderRadius: '10px', backgroundColor: 'var(--bg-base)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h4 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
              <Upload size={16} /> Step 3 — Import Profile
            </h4>

            {/* Find Training Output button */}
            <button
              className="btn btn-secondary"
              onClick={handleFindTrainingOutput}
              disabled={isScanning}
              style={{ width: '100%', fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
            >
              <Search size={14} />
              {isScanning ? 'Scanning…' : 'Find Training Output'}
            </button>

            {/* Scan result verdict */}
            {scanResult && scanResult.verdict !== 'model_ready' && (
              <div style={{
                fontSize: '12px', padding: '10px', borderRadius: '6px',
                backgroundColor: 'rgba(239,68,68,0.08)',
                border: '1px solid rgba(239,68,68,0.2)',
                color: 'var(--text-secondary)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', color: 'var(--accent-red)', fontWeight: 600 }}>
                  <XCircle size={14} />
                  Training did not produce a model file
                </div>
                <div style={{ fontSize: '11px', marginBottom: '10px', lineHeight: '1.5' }}>
                  {scanResult.verdict_message}
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '11px', padding: '4px 10px', flex: '1 1 auto' }}
                    onClick={async () => {
                      await refreshTrainerLogs();
                      setShowTrainerLogs(true);
                    }}
                  >
                    <Terminal size={11} style={{ marginRight: '3px' }} />
                    Open Applio Logs
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '11px', padding: '4px 10px', flex: '1 1 auto' }}
                    onClick={handleCopyTrainingError}
                  >
                    <Copy size={11} style={{ marginRight: '3px' }} />
                    {copied ? 'Copied!' : 'Copy Training Error'}
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '11px', padding: '4px 10px', flex: '1 1 auto', borderColor: 'var(--accent-blue)', color: 'var(--accent-blue)' }}
                    onClick={handleRetryTraining}
                  >
                    <RefreshCw size={11} style={{ marginRight: '3px' }} />
                    Retry Training
                  </button>
                </div>
              </div>
            )}

            {scanResult && scanResult.verdict === 'model_ready' && (
              <div style={{
                fontSize: '12px', padding: '10px', borderRadius: '6px',
                backgroundColor: 'rgba(52,211,153,0.08)',
                border: '1px solid rgba(52,211,153,0.2)',
                color: 'var(--text-secondary)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-green)', fontWeight: 600 }}>
                  <CheckCircle2 size={14} />
                  {scanResult.verdict_message}
                </div>
              </div>
            )}

            <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textAlign: 'center' }}>
              — or manually select files —
            </div>

            {/* .pth picker */}
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Trained Model (.pth) <span style={{ color: 'var(--accent-red)' }}>*</span>
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input type="text" readOnly value={pthPath || ''} placeholder="Click Browse to select .pth file…" style={{ flex: 1, padding: '8px', borderRadius: '4px', backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-default)', color: 'white', fontSize: '12px' }} />
                <button className="btn-secondary" onClick={handlePthBrowse} style={{ fontSize: '12px' }}>Browse</button>
              </div>
            </div>

            {/* .index picker */}
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                Feature Index (.index) — optional
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input type="text" readOnly value={indexPath || ''} placeholder="Click Browse to select .index file…" style={{ flex: 1, padding: '8px', borderRadius: '4px', backgroundColor: 'var(--bg-base)', border: '1px solid var(--border-default)', color: 'white', fontSize: '12px' }} />
                <button className="btn-secondary" onClick={handleIndexBrowse} style={{ fontSize: '12px' }}>Browse</button>
              </div>
            </div>

            <button
              className="btn btn-primary"
              onClick={() => handleImport(false)}
              disabled={isImporting || !pthPath}
              style={{ width: '100%', marginTop: '4px' }}
            >
              {isImporting ? 'Importing…' : 'Import Profile'}
            </button>

            {/* Overwrite confirmation */}
            <AnimatePresence>
              {needsOverwriteConfirm && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  style={{ overflow: 'hidden' }}
                >
                  <div style={{
                    padding: '10px', border: '1px solid var(--accent-amber)',
                    borderRadius: '6px', backgroundColor: 'rgba(245,158,11,0.08)',
                    fontSize: '12px', color: 'var(--text-secondary)'
                  }}>
                    <AlertTriangle size={12} style={{ marginRight: '4px', color: 'var(--accent-amber)' }} />
                    A profile with this name already exists.
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                      <button className="btn btn-secondary" style={{ flex: 1, fontSize: '12px', padding: '4px 8px' }} onClick={() => setNeedsOverwriteConfirm(false)}>Cancel</button>
                      <button className="btn btn-primary" style={{ flex: 1, fontSize: '12px', padding: '4px 8px', backgroundColor: 'var(--accent-amber)', borderColor: 'var(--accent-amber)' }} onClick={() => handleImport(true)}>Replace It</button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

        </div>

        {/* Global status messages */}
        <AnimatePresence>
          {error && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="info-box error"
              style={{ marginTop: '20px' }}
            >
              <div className="info-box-icon"><XCircle size={18} /></div>
              <div>{error}</div>
            </motion.div>
          )}
          {successMsg && !error && (
            <motion.div
              key="success"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="info-box success"
              style={{ marginTop: '20px' }}
            >
              <div className="info-box-icon"><CheckCircle2 size={18} /></div>
              <div>{successMsg}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
