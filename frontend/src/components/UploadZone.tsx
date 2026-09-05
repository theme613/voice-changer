/**
 * UploadZone.tsx — Screen 1: Dataset Builder
 *
 * Handles accumulating multiple audio/video clips into a unified dataset:
 * - Persistent across refreshes via localStorage.
 * - Add Video -> Extracts and isolates.
 * - Add Audio -> Copies directly (or isolates if requested).
 */

import { useState, useRef, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload, FileVideo, FileAudio, AudioWaveform,
  CheckCircle2, AlertCircle, Loader2,
  Trash2, PlayCircle, Settings
} from 'lucide-react';

import PreviewPlayer from './PreviewPlayer';
import RegenerateModal, { type RegenerateSettings } from './RegenerateModal';
import {
  uploadVideo, uploadAudio, getJobStatus,
  getPreviewUrl, regenerateVocals,
} from '../api';

export interface DatasetRow {
  id: string;
  type: 'video' | 'audio';
  filename: string;
  vocalsPath?: string;
  duration: number;
  status: 'ready' | 'processing' | 'error';
  jobId?: string;
  errorMsg?: string;
  errorDetails?: any;
  uploadProgress?: number;
  stepName?: string;
}

interface UploadZoneProps {
  onComplete: (datasetFiles: string[]) => void;
}

export default function UploadZone({ onComplete }: UploadZoneProps) {
  const [rows, setRows] = useState<DatasetRow[]>(() => {
    try {
      const saved = localStorage.getItem('draft_dataset');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [];
  });

  const [activePreview, setActivePreview] = useState<string | null>(null);
  const [regenRowId, setRegenRowId] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Auto-save to localStorage
  useEffect(() => {
    localStorage.setItem('draft_dataset', JSON.stringify(rows));
  }, [rows]);

  const updateRow = (id: string, updates: Partial<DatasetRow>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  // Poll processing jobs
  useEffect(() => {
    const intervals: Record<string, ReturnType<typeof setInterval>> = {};

    rows.forEach(row => {
      if (row.status === 'processing' && row.jobId && !intervals[row.id]) {
        intervals[row.id] = setInterval(async () => {
          try {
            const status = await getJobStatus(row.jobId!);
            
            if (['complete', 'error', 'cancelled'].includes(status.current_step || '') || status.step === 'ready' || status.step === 'error') {
              clearInterval(intervals[row.id]);
              if (status.step === 'error' || status.current_step === 'error') {
                const msg = typeof status.error === 'string' ? status.error : (status.error?.message || 'Failed');
                updateRow(row.id, { status: 'error', errorMsg: msg, errorDetails: status.error });
              } else {
                updateRow(row.id, { 
                  status: 'ready', 
                  vocalsPath: status.vocals_path,
                  duration: status.duration || row.duration,
                  filename: status.filename || row.filename
                });
              }
            } else {
              updateRow(row.id, { uploadProgress: status.progress, stepName: status.step });
            }
          } catch (e) {
            clearInterval(intervals[row.id]);
            updateRow(row.id, { status: 'error', errorMsg: 'Failed to poll status.' });
          }
        }, 1000);
      }
    });

    return () => {
      Object.values(intervals).forEach(clearInterval);
    };
  }, [rows]);

  // --- Handlers ---
  const handleAddVideo = async (files: File[]) => {
    for (const file of files) {
      const id = Math.random().toString(36).substring(2, 9);
      setRows(prev => [...prev, { id, type: 'video', filename: file.name, duration: 0, status: 'processing', uploadProgress: 0, stepName: 'uploading' }]);
      try {
        const result = await uploadVideo(file, (pct) => updateRow(id, { uploadProgress: pct, stepName: 'uploading' }));
        updateRow(id, { jobId: result.job_id, duration: result.duration, filename: result.filename, stepName: 'uploaded' });
      } catch (err: any) {
        if (err.name === 'UploadError') {
          updateRow(id, { status: 'error', errorMsg: err.message, errorDetails: err.details });
        } else {
          updateRow(id, { status: 'error', errorMsg: err.message });
        }
      }
    }
  };

  const handleAddAudio = async (e: React.ChangeEvent<HTMLInputElement>, isolate: boolean) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    e.target.value = '';

    for (const file of files) {
      const id = Math.random().toString(36).substring(2, 9);
      setRows(prev => [...prev, { id, type: 'audio', filename: file.name, duration: 0, status: 'processing', uploadProgress: 0, stepName: 'uploading' }]);
      
      try {
        if (isolate) {
          const result = await uploadVideo(file, (pct) => updateRow(id, { uploadProgress: pct, stepName: 'uploading' }));
          updateRow(id, { jobId: result.job_id, duration: result.duration, filename: result.filename, stepName: 'uploaded' });
        } else {
          const result = await uploadAudio(file);
          updateRow(id, { 
            status: 'ready', 
            vocalsPath: result.vocals_path, 
            duration: result.duration, 
            filename: result.filename 
          });
        }
      } catch (err: any) {
        if (err.name === 'UploadError') {
          updateRow(id, { status: 'error', errorMsg: err.message, errorDetails: err.details });
        } else {
          updateRow(id, { status: 'error', errorMsg: err.message });
        }
      }
    }
  };

  const handleRemove = (id: string) => {
    setRows(prev => prev.filter(r => r.id !== id));
    if (activePreview === id) setActivePreview(null);
  };

  const handleRetry = (id: string) => {
    // Remove the failed row
    handleRemove(id);
    // Prompt for new upload
    audioInputRef.current?.click();
  };

  const handleRegenerate = async (settings: RegenerateSettings) => {
    if (!regenRowId) return;
    const row = rows.find(r => r.id === regenRowId);
    if (!row || !row.jobId) return;

    setIsRegenerating(true);
    try {
      await regenerateVocals({
        job_id: row.jobId,
        model: settings.model,
        strength: settings.strength,
        apply_noise_reduction: settings.applyNoiseReduction
      });
      updateRow(regenRowId, { status: 'processing', uploadProgress: 0, stepName: 'uploaded' });
      setShowRegenModal(false);
    } catch (e: any) {
      alert("Failed to regenerate: " + e.message);
    } finally {
      setIsRegenerating(false);
    }
  };

  const [showRegenModal, setShowRegenModal] = useState(false);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const audioInputIsolateRef = useRef<HTMLInputElement>(null);

  const { getRootProps: getVideoRootProps, getInputProps: getVideoInputProps, isDragActive: isVideoDrag } = useDropzone({
    onDrop: handleAddVideo,
    accept: { 'video/*': ['.mp4', '.mov', '.avi', '.webm', '.mkv'] },
  });

  const totalDuration = rows.filter(r => r.status === 'ready').reduce((acc, r) => acc + r.duration, 0);
  const totalMins = totalDuration / 60;
  const isReady = rows.length > 0 && rows.every(r => r.status === 'ready');
  const datasetPaths = rows.filter(r => r.status === 'ready' && r.vocalsPath).map(r => r.vocalsPath!);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="flex items-center gap-2 m-0 text-primary">
          <AudioWaveform size={24} />
          Dataset Builder
        </h3>
        {rows.length > 0 && (
          <div className="text-sm">
            <strong>{rows.length}</strong> clips | 
            <span style={{ color: totalMins < 5 ? 'var(--accent-amber)' : 'var(--accent-green)', marginLeft: '4px' }}>
              {totalMins.toFixed(1)} mins total
            </span>
          </div>
        )}
      </div>

      {totalMins > 0 && totalMins < 5 && (
        <div className="info-box warning mb-4" style={{ padding: '8px 12px', fontSize: '14px' }}>
          <AlertCircle size={16} />
          <span>Recommended dataset size is at least 5 minutes. You have {totalMins.toFixed(1)} minutes.</span>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '24px' }}>
        <AnimatePresence>
          {rows.map(row => (
            <motion.div 
              key={row.id} 
              initial={{ opacity: 0, height: 0 }} 
              animate={{ opacity: 1, height: 'auto' }} 
              exit={{ opacity: 0, height: 0 }}
              style={{ 
                padding: '12px', 
                border: `1px solid ${row.status === 'error' ? 'var(--error-red)' : 'var(--border-color)'}`, 
                borderRadius: '8px', 
                background: row.status === 'error' ? 'rgba(239, 68, 68, 0.05)' : 'var(--bg-card-hover)', 
                overflow: 'hidden' 
              }}
            >
              <div className="flex items-center gap-3">
                {row.type === 'video' ? <FileVideo size={20} className={row.status === 'error' ? 'text-red-500' : 'text-muted'} /> : <FileAudio size={20} className={row.status === 'error' ? 'text-red-500' : 'text-muted'} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="font-semibold text-sm truncate">{row.filename}</div>
                  <div className="text-xs text-muted flex items-center gap-2">
                    {row.status === 'processing' ? (
                      <span className="flex items-center gap-1 text-primary">
                        <Loader2 size={12} className="animate-spin" /> 
                        {row.stepName === 'uploading' ? `Uploading... ${Math.round(row.uploadProgress || 0)}%` :
                         row.stepName === 'uploaded' ? 'In Queue' :
                         row.stepName === 'extracting' ? 'Extracting audio' :
                         row.stepName === 'isolating' ? 'Isolating vocals (This takes a while)' :
                         'Processing...'}
                      </span>
                    ) : row.status === 'error' ? (
                      <span className="text-red-500 font-semibold">{row.errorMsg}</span>
                    ) : (
                      <span className="text-green-500 flex items-center gap-1"><CheckCircle2 size={12} /> Ready ({(row.duration / 60).toFixed(1)}m)</span>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  {row.status === 'ready' && (
                    <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => setActivePreview(activePreview === row.id ? null : row.id)}>
                      <PlayCircle size={16} />
                    </button>
                  )}
                  {row.status === 'ready' && row.type === 'video' && row.jobId && (
                    <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => { setRegenRowId(row.id); setShowRegenModal(true); }}>
                      <Settings size={16} />
                    </button>
                  )}
                  <button className="btn btn-secondary" style={{ padding: '4px 8px', color: 'var(--accent-red)' }} onClick={() => handleRemove(row.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {row.status === 'error' && row.errorDetails && row.errorDetails.ffprobe_error && (
                <div className="mt-4 pt-4 border-t border-[var(--error-red)] opacity-90">
                  <h4 className="text-sm font-semibold text-red-500 mb-2">Upload Validation Failed</h4>
                  <ul className="text-xs text-muted mb-4 space-y-1">
                    <li><strong>File:</strong> {row.errorDetails.filename}</li>
                    <li><strong>Received Size:</strong> {row.errorDetails.file_size} bytes</li>
                    <li><strong>MIME Type:</strong> {row.errorDetails.mime_type}</li>
                    <li><strong>Job ID:</strong> {row.errorDetails.job_id}</li>
                  </ul>
                  <div className="bg-black/30 p-2 rounded text-xs font-mono text-red-400 whitespace-pre-wrap mb-4 overflow-auto max-h-32">
                    {row.errorDetails.ffprobe_error}
                  </div>
                  <button className="btn btn-primary bg-red-600 hover:bg-red-700 text-xs py-1 px-3" onClick={() => handleRetry(row.id)}>
                    Retry Upload
                  </button>
                </div>
              )}

              {activePreview === row.id && row.jobId && (
                <div className="mt-4 pt-4 border-t border-[var(--border-color)]">
                  <PreviewPlayer 
                  audioUrl={getPreviewUrl(row.jobId)} 
                  label={`Preview isolated vocals for ${row.filename}`}
                /></div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        
        {rows.length === 0 && (
          <div className="text-center p-8 text-muted border border-dashed border-[var(--border-color)] rounded-lg">
            No clips added yet. Add video or audio below.
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div 
          {...getVideoRootProps()} 
          className={`upload-zone flex flex-col items-center justify-center p-6 text-center cursor-pointer border-2 border-dashed rounded-lg transition-colors ${isVideoDrag ? 'border-primary bg-primary/10' : 'border-[var(--border-color)] hover:border-primary'}`}
        >
          <input {...getVideoInputProps()} />
          <Upload size={32} className="text-muted mb-2" />
          <div className="font-semibold text-sm">Add Video</div>
          <div className="text-xs text-muted">Will isolate vocals automatically</div>
        </div>

        <div className="flex flex-col gap-2">
          <button className="btn btn-secondary flex-1 flex flex-col items-center justify-center gap-1 h-full" onClick={() => audioInputRef.current?.click()}>
            <FileAudio size={24} className="text-muted" />
            <div className="font-semibold text-sm">Add Audio</div>
            <div className="text-xs text-muted font-normal">(Skips isolation)</div>
          </button>
          
          <button className="btn btn-secondary py-2 text-xs text-muted hover:text-primary" onClick={() => audioInputIsolateRef.current?.click()}>
            + Add Audio (Run Noise Removal)
          </button>
          
          <input type="file" ref={audioInputRef} style={{ display: 'none' }} multiple accept="audio/*" onChange={(e) => handleAddAudio(e, false)} />
          <input type="file" ref={audioInputIsolateRef} style={{ display: 'none' }} multiple accept="audio/*" onChange={(e) => handleAddAudio(e, true)} />
        </div>
      </div>

      <button 
        className="btn btn-primary btn-lg w-full" 
        disabled={!isReady || datasetPaths.length === 0} 
        onClick={() => onComplete(datasetPaths)}
      >
        <CheckCircle2 size={18} />
        Proceed to Training
      </button>

      <AnimatePresence>
        {showRegenModal && (
          <RegenerateModal
            isOpen={showRegenModal}
            onClose={() => setShowRegenModal(false)}
            onRegenerate={handleRegenerate}
            isProcessing={isRegenerating}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
