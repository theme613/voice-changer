/**
 * api.ts — Backend API Client
 *
 * Typed functions wrapping all backend endpoints.
 * Handles file uploads, polling, and error messages.
 */

const BASE_URL = '/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UploadResponse {
  job_id: string;
  filename: string;
  duration: number;
}

export interface JobStatus {
  job_id: string;
  step: 'uploaded' | 'extracting' | 'isolating' | 'ready' | 'error';
  progress: number;
  error?: any;
  filename: string;
  duration: number;
  vocals_path?: string;
  current_step?: string;
}

export interface VoiceProfile {
  name: string;
  model_path: string;
  index_path: string;
  size_mb: number;
}

export interface VoiceProfile {
  name: string;
  model_path: string;
  index_path: string;
  size_mb: number;
}

export interface AudioDevice {
  id: number;
  name: string;
  channels: number;
  sample_rate?: number;
  is_default?: boolean;
}

export interface ConversionStatus {
  is_running: boolean;
  input_level: number;
  output_level: number;
  settings: {
    profile_name: string;
    input_gain: number;
    output_gain: number;
    pitch_shift: number;
    index_rate: number;
    enabled: boolean;
  };
}

// ---------------------------------------------------------------------------
// Helper: Fetch with error handling
// ---------------------------------------------------------------------------

async function apiFetch<T>(
  url: string,
  options?: RequestInit,
): Promise<T> {
  try {
    const response = await fetch(`${BASE_URL}${url}`, {
      ...options,
      headers: {
        ...(options?.headers || {}),
        // Don't set Content-Type for FormData — browser sets it with boundary
      },
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const message = data.detail || `Request failed (${response.status})`;
      throw new Error(message);
    }

    return response.json();
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error(
        'Cannot connect to the backend server. Make sure it is running on http://localhost:8000'
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Upload & Processing
// ---------------------------------------------------------------------------

export class UploadError extends Error {
  details: any;
  constructor(message: string, details: any) {
    super(message);
    this.name = 'UploadError';
    this.details = details;
  }
}

/**
 * Upload a video file for processing.
 * Returns a job ID to track progress.
 */
export async function uploadVideo(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);

  // Use XMLHttpRequest for upload progress tracking
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}/upload`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          // Check if it's our structured error (data.detail is an object)
          if (data.detail && typeof data.detail === 'object' && data.detail.filename) {
             reject(new UploadError(data.detail.message || 'Upload failed', data.detail));
          } else {
             reject(new Error(data.detail || 'Upload failed'));
          }
        } catch {
          reject(new Error(`Upload failed (${xhr.status})`));
        }
      }
    };

    xhr.onerror = () => {
      reject(new Error('Cannot connect to the backend server.'));
    };

    xhr.send(formData);
  });
}

/**
 * Poll the processing status of an upload job.
 */
export async function getJobStatus(jobId: string): Promise<JobStatus> {
  return apiFetch<JobStatus>(`/status/${jobId}`);
}

/**
 * Get the URL for previewing isolated vocals.
 */
export function getPreviewUrl(jobId: string): string {
  return `${BASE_URL}/preview/${jobId}`;
}

/**
 * Re-run vocal isolation with different settings.
 */
export async function regenerateVocals(params: {
  job_id: string;
  model: string;
  strength: string;
  apply_noise_reduction: boolean;
}): Promise<{ status: string }> {
  return apiFetch('/regenerate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

// ---------------------------------------------------------------------------
// Training
// ---------------------------------------------------------------------------

export async function uploadAudio(file: File): Promise<{ job_id: string; vocals_path: string; duration: number; filename: string }> {
  const formData = new FormData();
  formData.append('file', file);

  return apiFetch(`/upload_audio`, {
    method: 'POST',
    body: formData,
  });
}

// ---------------------------------------------------------------------------
// Training / Dataset / Trainer
// ---------------------------------------------------------------------------

export interface TrainerDetectResult {
  found: boolean;
  launch_target: string | null;
  launch_target_abs: string | null;
  type: 'applio' | 'rvc' | 'generic' | 'exe' | null;
  incomplete: boolean;
  message: string;
}

export interface TrainerStatusResult {
  running: boolean;
  pid: number | null;
  exit_code: number | null;
  log: string[];
}

export interface DatasetStats {
  file_count: number;
  total_duration_s: number;
  sample_rate: number;
  format: string;
  folder: string;
  files: Array<{ name: string; duration_s: number; size_bytes: number }>;
}



export async function prepareDataset(
  datasetFiles: string[],
  profileName: string
): Promise<{ status: string; dataset_folder: string; stats: DatasetStats }> {
  return apiFetch('/dataset/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset_files: datasetFiles, profile_name: profileName }),
  });
}

export async function getDatasetStats(folder: string): Promise<DatasetStats> {
  return apiFetch<DatasetStats>(`/dataset/stats?folder=${encodeURIComponent(folder)}`);
}

export async function detectTrainer(folder?: string): Promise<TrainerDetectResult> {
  const q = folder ? `?folder=${encodeURIComponent(folder)}` : '';
  return apiFetch<TrainerDetectResult>(`/trainer/detect${q}`);
}

export async function launchTrainer(): Promise<{ status: string; pid: number; launch_target: string; type: string; message: string }> {
  return apiFetch('/trainer/launch', { method: 'POST' });
}

export async function getTrainerStatus(): Promise<TrainerStatusResult> {
  return apiFetch<TrainerStatusResult>('/trainer/status');
}

export async function stopTrainer(): Promise<{ status: string; pid: number }> {
  return apiFetch('/trainer/stop', { method: 'POST' });
}

/**
 * Import a trained profile by uploading .pth and optional .index files.
 * Uses multipart/form-data — native file upload, no path typing needed.
 */
export async function importProfileUpload(
  profileName: string,
  pthFile: File,
  indexFile: File | null,
  forceOverwrite: boolean = false
): Promise<{ status: string; profile_name: string; model_size_mb: number; index_size_mb: number | null }> {
  const formData = new FormData();
  formData.append('profile_name', profileName);
  formData.append('pth_file', pthFile);
  if (indexFile) formData.append('index_file', indexFile);
  if (forceOverwrite) formData.append('allow_overwrite', 'true');

  return apiFetch('/profiles/import', {
    method: 'POST',
    body: formData,
  });
}

export async function importProfileLocal(
  profileName: string,
  pthPath: string,
  indexPath: string | null,
  forceOverwrite: boolean = false
): Promise<{ status: string; profile_name: string; model_size_mb: number; index_size_mb: number | null }> {
  return apiFetch('/profile/import/local', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile_name: profileName,
      pth_path: pthPath,
      index_path: indexPath,
      allow_overwrite: forceOverwrite,
    }),
  });
}

export async function browseFolder(): Promise<string> {
  const response = await fetch(`${BASE_URL}/browse/folder`);
  if (!response.ok) throw new Error('Failed to browse folder');
  const data = await response.json();
  return data.path;
}

export async function browseFile(ext: string = ""): Promise<string> {
  const response = await fetch(`${BASE_URL}/browse/file?ext=${ext}`);
  if (!response.ok) throw new Error('Failed to browse file');
  const data = await response.json();
  return data.path;
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

/**
 * List all saved voice profiles.
 */
export async function getProfiles(): Promise<{ profiles: VoiceProfile[] }> {
  return apiFetch('/profiles');
}

/**
 * Delete a voice profile by name.
 */
export async function deleteProfile(profileName: string): Promise<{ status: string; message: string }> {
  return apiFetch(`/profile/${encodeURIComponent(profileName)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Voice Conversion
// ---------------------------------------------------------------------------

/**
 * List available audio devices.
 */
export async function getAudioDevices(): Promise<{
  input: AudioDevice[];
  output: AudioDevice[];
}> {
  return apiFetch('/devices');
}

/**
 * Start real-time voice conversion.
 */
export async function startConversion(params: {
  profile_name: string;
  input_device?: number | null;
  output_device?: number | null;
  pitch_shift: number;
  index_rate: number;
  input_gain: number;
  output_gain: number;
}): Promise<{ status: string }> {
  return apiFetch('/convert/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

/**
 * Stop real-time voice conversion.
 */
export async function stopConversion(): Promise<{ status: string }> {
  return apiFetch('/convert/stop', { method: 'POST' });
}

/**
 * Get current conversion status and level meters.
 */
export async function getConversionStatus(): Promise<ConversionStatus> {
  return apiFetch('/convert/status');
}

/**
 * Update conversion settings on the fly.
 */
export async function updateConversionSettings(params: {
  input_gain?: number;
  output_gain?: number;
  pitch_shift?: number;
  index_rate?: number;
  enabled?: boolean;
}): Promise<{ status: string }> {
  return apiFetch('/convert/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

/**
 * Test voice conversion with a sample clip.
 * Returns a blob URL for playback.
 */
export async function testConversion(): Promise<string> {
  const response = await fetch(`${BASE_URL}/convert/test`, { method: 'POST' });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || 'Test conversion failed');
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

/**
 * Health check — verify backend is running.
 */
export async function healthCheck(): Promise<{ status: string; gpu_available: boolean }> {
  return apiFetch('/health');
}

export async function getSystemGpu(): Promise<{ cuda_available: boolean; gpu_name?: string; pytorch_version: string; vram_free_mb?: number; vram_total_mb?: number; error?: string }> {
  return apiFetch('/system/gpu');
}
// --- Settings & Diagnostics ---

export interface Settings {
  general: {
    theme: string;
    detailed_logs: boolean;
    auto_check_files: boolean;
  };
  paths: {
    models_dir: string;
    profiles_dir: string;
    datasets_dir: string;
    temp_dir: string;
    logs_dir: string;
    engine_dir: string;
    ffmpeg_path: string;
    external_trainer_path: string;
  };
  performance: {
    device: string;
    quality_preset: string;
    batch_size: number;
    fp16: boolean;
    chunk_size: number;
  };
  audio: {
    sample_rate: number;
    buffer_size: number;
    input_device: number;
    output_device: number;
  };
  ports: {
    backend: number;
    sidecar: number;
  };
}

export async function checkPortAvailability(port: number, type: 'backend' | 'sidecar'): Promise<{available: boolean, message: string}> {
  return apiFetch<{available: boolean, message: string}>(`/settings/check_port?port=${port}&type=${type}`);
}

export async function verifyEngineEdition(path: string): Promise<{valid: boolean, message: string, edition: string}> {
  return apiFetch<{valid: boolean, message: string, edition: string}>(`/settings/verify_engine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
}

export async function killAllProcesses(): Promise<{status: string, message: string}> {
  return apiFetch<{status: string, message: string}>('/settings/kill_all', { method: 'POST' });
}

export async function restartEngine(): Promise<{status: string, message: string}> {
  return apiFetch<{status: string, message: string}>('/settings/restart_engine', { method: 'POST' });
}

export async function getSettings(): Promise<Settings> {
  return apiFetch<Settings>('/settings');
}

export async function updateSettings(settings: Partial<Settings>): Promise<{status: string, settings: Settings}> {
  return apiFetch<{status: string, settings: Settings}>('/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}

export async function getDiagnostics(): Promise<any> {
  return apiFetch<any>('/diagnostics');
}

export async function getLogs(limit: number = 100): Promise<{logs: string[]}> {
  return apiFetch<{logs: string[]}>(`/logs?limit=${limit}`);
}

export async function fixDiagnostics(key: string): Promise<any> {
  return apiFetch<any>('/diagnostics/fix', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
}

// ---------------------------------------------------------------------------
// Training Output Scanning & Validation
// ---------------------------------------------------------------------------

export interface TrainingPhases {
  dataset_prepared: boolean;
  features_extracted: boolean;
  index_generated: boolean;
  checkpoint_saved: boolean;
  model_exported: boolean;
  dir_exists: boolean;
}

export interface TrainingScanPthFile {
  name: string;
  path: string;
  size_bytes: number;
  size_mb: number;
  modified: string;
  is_checkpoint: boolean;
  is_valid: boolean;
  is_mock: boolean;
}

export interface TrainingScanResult {
  scan_path: string;
  dir_exists: boolean;
  pth_files: TrainingScanPthFile[];
  index_files: Array<{ name: string; path: string; size_bytes: number; size_kb: number; modified: string }>;
  checkpoint_files: TrainingScanPthFile[];
  tensorboard_events: Array<{ name: string; size_bytes: number; modified: string; has_training_data: boolean }>;
  phases: TrainingPhases;
  config: any;
  model_info: any;
  verdict: 'model_ready' | 'checkpoints_only' | 'preprocessing_only' | 'training_incomplete' | 'empty' | 'no_directory' | 'unknown';
  verdict_message: string;
  best_model_path?: string;
  best_index_path?: string | null;
  model_name?: string;
}

export interface TrainingPhasesResult {
  model_name: string;
  log_dir: string;
  phases: TrainingPhases;
  validation: {
    success: boolean;
    model_path: string | null;
    model_size_mb: number | null;
    index_path: string | null;
    error: string | null;
    phases: TrainingPhases;
  };
}

export interface TrainerLogsResult {
  process_log: string[];
  process_running: boolean;
  process_pid: number | null;
  disk_logs: Array<{ path: string; name: string; lines: string[]; total_lines: number }>;
}

/**
 * Scan the Applio training output directory for a specific model.
 * Returns full inventory of .pth/.index files, phase status, and verdict.
 */
export async function scanTrainingOutput(modelName?: string): Promise<TrainingScanResult> {
  const q = modelName ? `?model_name=${encodeURIComponent(modelName)}` : '';
  return apiFetch<TrainingScanResult>(`/training/scan${q}`);
}

/**
 * Get the granular training phase status for a model.
 */
export async function getTrainingPhases(modelName: string): Promise<TrainingPhasesResult> {
  return apiFetch<TrainingPhasesResult>(`/training/phases?model_name=${encodeURIComponent(modelName)}`);
}

/**
 * Get Applio training process logs (captured stdout/stderr + disk logs).
 */
export async function getTrainerLogs(limit: number = 100): Promise<TrainerLogsResult> {
  return apiFetch<TrainerLogsResult>(`/trainer/logs?limit=${limit}`);
}
