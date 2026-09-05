"""
main.py — FastAPI Backend for Voice Changer App

This is the central API server that connects the React frontend to all
audio processing, training, and real-time conversion modules.

Run with: uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""

import os
import uuid
import asyncio
import logging
import subprocess
import sys
import socket
import psutil
import tempfile
import tkinter as tk
from tkinter import filedialog
from pathlib import Path
from typing import Optional
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
import httpx
from pydantic import BaseModel
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)

from file_manager import ensure_all_files_exist
from settings import settings

ensure_all_files_exist()

PROJECT_ROOT = Path(__file__).parent.parent
ENGINE_DIR = PROJECT_ROOT / "engine" / "voice-changer" / "server"

# --- Engine Sidecar Management ---
ENGINE_PROCESS = None

# --- External Trainer Process ---
_TRAINER_PROCESS: Optional[subprocess.Popen] = None
_TRAINER_LOG_LINES: list = []  # Circular buffer, last 200 lines

def get_engine_port():
    return settings.get_all().get("ports", {}).get("sidecar", 18888)




def start_engine_sidecar():
    global ENGINE_PROCESS
    if ENGINE_PROCESS is not None and ENGINE_PROCESS.poll() is None:
        return # Already running
        
    engine_port = get_engine_port()
    
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("0.0.0.0", engine_port))
        except socket.error:
            logger.info(f"Engine sidecar is already running on port {engine_port}. Reusing existing process.")
            return
        
    logger.info(f"Starting w-okada voice-changer sidecar on port {engine_port}...")
    
    # Reload engine dir from settings
    engine_dir = Path(settings.get_path("engine_dir"))
    script_path = engine_dir / "MMVCServerSIO.py"
    exe_path = engine_dir / "MMVCServerSIO.exe"
    
    if not engine_dir.is_dir():
        logger.error(f"Engine directory not found: {engine_dir}")
        return
        
    try:
        # Recursively search for MMVCServerSIO.exe if not directly in the directory
        if not exe_path.is_file():
            found = list(engine_dir.rglob("MMVCServerSIO.exe"))
            if found:
                exe_path = found[0]
                engine_dir = exe_path.parent
                
        if not script_path.is_file():
            found = list(engine_dir.rglob("MMVCServerSIO.py"))
            if found:
                script_path = found[0]

        if exe_path.is_file():
            ENGINE_PROCESS = subprocess.Popen(
                [str(exe_path), "-p", str(engine_port), "--https", "false"],
                cwd=str(exe_path.parent),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
        elif script_path.is_file():
            # Use sys.executable to run the python script
            ENGINE_PROCESS = subprocess.Popen(
                [sys.executable, str(script_path), "-p", str(engine_port), "--https", "false"],
                cwd=str(script_path.parent),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL
            )
        else:
            logger.error(f"Engine executable not found in {engine_dir}")
            return
            
        logger.info(f"Sidecar started successfully, PID: {ENGINE_PROCESS.pid}")
    except Exception as e:
        logger.error(f"Failed to start engine sidecar: {e}")

def stop_engine_sidecar():
    global ENGINE_PROCESS
    if ENGINE_PROCESS is not None:
        logger.info("Stopping w-okada voice-changer sidecar...")
        ENGINE_PROCESS.terminate()
        ENGINE_PROCESS = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    start_engine_sidecar()
    yield
    # Shutdown
    stop_engine_sidecar()
    _executor.shutdown(wait=False)

from audio_processor import (
    extract_audio,
    isolate_vocals,
    get_video_info,
    get_audio_duration,
    get_job_dir,
    UPLOADS_DIR,
    validate_video_file,
)
from trainer import (
    prepare_dataset,
    import_profile,
    list_profiles,
    detect_trainer,
    get_dataset_stats,
    scan_training_output,
    validate_training_complete,
    get_training_phase_status,
)
from voice_converter import (
    get_converter,
    list_audio_devices,
)

# ---------------------------------------------------------------------------
# Logging setup
# ---------------------------------------------------------------------------
log_path = settings.get_path("logs_dir")
log_path.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(log_path / "app.log")
    ]
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Voice Changer API",
    description="Local-first voice processing: upload video → isolate vocals → train profile → real-time conversion",
    version="1.0.0",
    lifespan=lifespan
)

# Allow the React dev server to talk to us
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Thread pool for CPU/GPU-bound work (audio processing, training)
_executor = ThreadPoolExecutor(max_workers=2)

# In-memory job tracking
# job_id → { "step": str, "progress": float, "error": str, "video_path": str, "vocals_path": str }
_jobs: dict = {}

DATASETS_DIR = settings.get_path("datasets_dir")


# ---------------------------------------------------------------------------
# Request/Response Models
# ---------------------------------------------------------------------------
class RegenerateRequest(BaseModel):
    job_id: str
    model: str = "Demucs v4"             # "Demucs v4", "MDX-Net", "BS-Roformer"
    strength: str = "normal"              # "normal" or "strong"
    apply_noise_reduction: bool = False


class DatasetPrepareRequest(BaseModel):
    profile_name: str
    dataset_files: list[str]

class ProfileOverwriteRequest(BaseModel):
    profile_name: str
    allow_overwrite: bool = False


class ConvertStartRequest(BaseModel):
    profile_name: str
    input_device: Optional[int] = None
    output_device: Optional[int] = None
    pitch_shift: int = 0
    index_rate: float = 0.75
    input_gain: float = 1.0
    output_gain: float = 1.0


class ConvertSettingsUpdate(BaseModel):
    input_gain: Optional[float] = None
    output_gain: Optional[float] = None
    pitch_shift: Optional[int] = None
    index_rate: Optional[float] = None
    enabled: Optional[bool] = None


# ---------------------------------------------------------------------------
# Upload & Processing Endpoints
# ---------------------------------------------------------------------------

@app.post("/api/upload")
@app.post("/api/upload")
async def upload_video(request: Request, file: UploadFile = File(...)):
    """
    Upload a video file and start the extraction + isolation pipeline.

    Accepts: MP4, MOV, AVI, MKV, WEBM
    Returns: { job_id, filename, duration }
    """
    allowed_extensions = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".wav", ".mp3", ".flac"}
    ext = Path(file.filename).suffix.lower()
    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Please upload a video file ({', '.join(allowed_extensions)}).",
        )

    # Validate system requirements
    from diagnostics import check_system
    sys_health = check_system()
    if sys_health["ffmpeg"]["status"] != "ready":
        raise HTTPException(
            status_code=500,
            detail="FFmpeg is missing. Please install FFmpeg to process videos."
        )

    # Validate File Size
    expected_size = getattr(file, 'size', 0)
    
    if expected_size > 0 and expected_size < 1024:
        raise HTTPException(status_code=400, detail="File is too small. Please upload a valid media file.")

    logger.info(f"[UPLOAD] Starting upload for {file.filename}, expected size: {expected_size} bytes")

    # Create a unique job ID
    job_id = str(uuid.uuid4())[:8]

    # Save the uploaded file to a temporary .uploading file
    job_dir = get_job_dir(job_id)
    temp_video_path = str(job_dir / f"input_{job_id}.uploading")
    final_video_path = str(job_dir / f"input_{job_id}{ext}")

    try:
        with open(temp_video_path, "wb") as f:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)
            # Ensure the file is fully written to disk before ffprobe checks it
            f.flush()
            os.fsync(f.fileno())
            
        saved_size = os.path.getsize(temp_video_path)
        logger.info(f"[UPLOAD] Saved {saved_size} bytes to {temp_video_path}")
        
        if expected_size > 0 and saved_size != expected_size:
            raise ValueError(f"Size mismatch: expected {expected_size}, got {saved_size}. Upload incomplete.")
            
        if saved_size == 0:
            raise ValueError("File is empty (0 bytes).")
            
        # Run ffprobe validation on the temporary file
        is_valid, ffprobe_error, info = validate_video_file(temp_video_path)
        
        logger.info(f"[UPLOAD] Validation result: valid={is_valid}")
        
        if not is_valid:
            # Prepare detailed error response
            error_detail = {
                "filename": file.filename,
                "file_size": saved_size,
                "mime_type": file.content_type or "unknown",
                "ffprobe_error": ffprobe_error,
                "job_id": job_id,
                "message": "The uploaded file is incomplete or corrupted. Please upload the original video again."
            }
            # Cleanup bad file
            os.remove(temp_video_path)
            # Use 400 Bad Request and pass JSON
            return JSONResponse(status_code=400, content={"detail": error_detail})
            
        # Rename to final extension once validation passes
        os.rename(temp_video_path, final_video_path)
        logger.info(f"[UPLOAD] Successfully validated and moved to {final_video_path}")
        
    except Exception as e:
        logger.error(f"[UPLOAD] Failed to process uploaded file: {e}")
        if os.path.exists(temp_video_path):
            os.remove(temp_video_path)
        if isinstance(e, ValueError):
             return JSONResponse(status_code=400, content={
                 "detail": {
                     "filename": file.filename,
                     "file_size": os.path.getsize(temp_video_path) if os.path.exists(temp_video_path) else 0,
                     "mime_type": getattr(file, 'content_type', 'unknown'),
                     "ffprobe_error": str(e),
                     "job_id": job_id,
                     "message": "Upload failed or incomplete. Please retry."
                 }
             })
        raise HTTPException(status_code=500, detail=f"Failed to process file: {e}")

    # Get video info (duration)
    duration = float(info.get("format", {}).get("duration", 0))

    # Initialize job tracking
    _jobs[job_id] = {
        "step": "uploaded",
        "progress": 0.0,
        "error": None,
        "video_path": final_video_path,
        "audio_path": "",
        "vocals_path": "",
        "filename": file.filename,
        "duration": round(duration, 1),
    }

    # Start processing in background
    logger.info(f"[PROCESS] extraction started for {job_id}")
    asyncio.get_event_loop().run_in_executor(
        _executor, _process_video, job_id
    )

    return {
        "job_id": job_id,
        "filename": file.filename,
        "duration": round(duration, 1),
    }


def _process_video(job_id: str):
    """
    Background worker: extract audio → isolate vocals.
    Updates the job status dict as it progresses.
    """
    job = _jobs[job_id]

    def progress_callback(step: str, percent: float):
        job["step"] = step
        job["progress"] = percent

    try:
        # Step 1: Extract audio from video
        progress_callback("extracting", 0.0)
        audio_path = extract_audio(
            job["video_path"], job_id, progress_callback
        )
        job["audio_path"] = audio_path

        # Step 2: Isolate vocals
        progress_callback("isolating", 0.0)
        vocals_path = isolate_vocals(
            audio_path, job_id, progress_callback=progress_callback
        )
        job["vocals_path"] = vocals_path

        # Initialize dataset with the isolated vocals
        import shutil
        dataset_dir = DATASETS_DIR / job_id
        dataset_dir.mkdir(parents=True, exist_ok=True)
        final_vocals_path = dataset_dir / f"isolated_vocals_{job_id}.wav"
        shutil.copy2(vocals_path, final_vocals_path)
        job["vocals_path"] = str(final_vocals_path)

        # Done!
        progress_callback("ready", 100.0)
        logger.info(f"Job {job_id} complete: vocals at {vocals_path}")

    except Exception as e:
        logger.error(f"Job {job_id} failed: {e}", exc_info=True)
        job["step"] = "error"
        job["error"] = {
            "success": False,
            "error_code": "PROCESS_FAILED",
            "title": "Audio processing failed",
            "message": str(e),
            "technical_details": repr(e),
            "suggested_actions": ["open_logs", "check_diagnostics"]
        }


@app.get("/api/status/{job_id}")
async def get_job_status(job_id: str):
    """
    Get the current processing status of an upload job.

    Returns: { step, progress, error, filename, duration }
    Steps: uploaded → extracting → isolating → ready → error
    """
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")

    return {
        "job_id": job_id,
        "step": job["step"],
        "progress": round(job["progress"], 1),
        "error": job["error"],
        "filename": job.get("filename", ""),
        "duration": job.get("duration", 0),
        "vocals_path": job.get("vocals_path", ""),
    }


@app.get("/api/preview/{job_id}")
async def preview_audio(job_id: str):
    """
    Stream the isolated vocals WAV file for preview playback.
    """
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")

    vocals_path = job.get("vocals_path", "")
    if not vocals_path or not os.path.exists(vocals_path):
        raise HTTPException(
            status_code=404,
            detail="Vocals not ready yet. Please wait for processing to complete.",
        )

    return FileResponse(
        vocals_path,
        media_type="audio/wav",
        filename=Path(vocals_path).name,
    )


@app.post("/api/regenerate")
async def regenerate_vocals(request: RegenerateRequest):
    """
    Re-run vocal isolation with different model/strength settings.
    """
    job = _jobs.get(request.job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")

    audio_path = job.get("audio_path", "")
    if not audio_path or not os.path.exists(audio_path):
        raise HTTPException(
            status_code=400,
            detail="No extracted audio found. Please upload a video first.",
        )

    # Reset job status
    job["step"] = "isolating"
    job["progress"] = 0.0
    job["error"] = ""

    # Run re-isolation in background
    def _regenerate():
        def progress_callback(step, percent):
            job["step"] = step
            job["progress"] = percent

        try:
            vocals_path = isolate_vocals(
                audio_path,
                request.job_id,
                model_name=request.model,
                strength=request.strength,
                apply_noise_reduction=request.apply_noise_reduction,
                progress_callback=progress_callback,
            )
            job["vocals_path"] = vocals_path
            job["step"] = "ready"
            job["progress"] = 100.0

        except Exception as e:
            logger.error(f"Regeneration failed: {e}", exc_info=True)
            job["step"] = "error"
            job["error"] = str(e)

    asyncio.get_event_loop().run_in_executor(_executor, _regenerate)

    return {"status": "regenerating", "job_id": request.job_id}


# ---------------------------------------------------------------------------
# Dataset Endpoints
# ---------------------------------------------------------------------------

@app.post("/api/upload_audio")
async def upload_audio_direct(file: UploadFile = File(...)):
    """Upload an audio file directly, bypassing isolation."""
    allowed_extensions = {".wav", ".mp3", ".flac"}
    ext = Path(file.filename).suffix.lower()
    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Only audio files allowed here.",
        )
        
    job_id = str(uuid.uuid4())[:8]
    dataset_dir = DATASETS_DIR / job_id
    dataset_dir.mkdir(parents=True, exist_ok=True)
    
    # Save file
    file_path = dataset_dir / f"direct_{job_id}{ext}"
    try:
        content = await file.read()
        file_path.write_bytes(content)
        
        info = get_video_info(str(file_path))
        return {
            "job_id": job_id,
            "filename": file.filename,
            "vocals_path": str(file_path),
            "duration": info["duration"]
        }
    except Exception as e:
        logger.error(f"Failed to upload audio file: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Training / Dataset / Trainer Endpoints
# ---------------------------------------------------------------------------

@app.post("/api/dataset/prepare")
async def prepare_dataset_endpoint(request: DatasetPrepareRequest):
    """Convert vocal files into a numbered 44.1kHz mono WAV dataset folder."""
    if not request.dataset_files:
        raise HTTPException(status_code=400, detail="No dataset files provided. Upload and process at least one audio file first.")
    if not request.profile_name or not request.profile_name.strip():
        raise HTTPException(status_code=400, detail="Profile name is required.")
    try:
        dataset_folder = prepare_dataset(request.profile_name, request.dataset_files)
        # Return real stats immediately
        stats = get_dataset_stats(dataset_folder)
        return {"status": "success", "dataset_folder": dataset_folder, "stats": stats}
    except RuntimeError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error(f"Failed to prepare dataset: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/dataset/stats")
async def get_dataset_stats_endpoint(folder: str):
    """Return real file stats (count, duration, sample rate) for a dataset folder."""
    if not folder:
        raise HTTPException(status_code=400, detail="folder query parameter is required.")
    try:
        stats = get_dataset_stats(folder)
        return stats
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/trainer/detect")
async def detect_trainer_endpoint(folder: str = ""):
    """Scan a folder for known Applio/RVC launch files. Returns detection result."""
    if not folder:
        # Try configured path
        folder = str(settings.get_path("external_trainer_path"))
    if not folder or folder in (".", ""):
        return {
            "found": False, "launch_target": None, "launch_target_abs": None,
            "type": None, "incomplete": False,
            "message": "External trainer path is not configured in Settings."
        }
    return detect_trainer(folder)


@app.post("/api/trainer/launch")
async def launch_external_trainer():
    """Launch the configured external trainer as a tracked subprocess."""
    global _TRAINER_PROCESS, _TRAINER_LOG_LINES

    if _TRAINER_PROCESS is not None and _TRAINER_PROCESS.poll() is None:
        return {
            "status": "already_running",
            "pid": _TRAINER_PROCESS.pid,
            "message": "Trainer is already running."
        }

    trainer_folder = str(settings.get_path("external_trainer_path"))
    if not trainer_folder or trainer_folder in (".", ""):
        raise HTTPException(status_code=400, detail="External trainer path is not configured. Go to Settings and set the Applio/RVC folder path.")

    folder_path = Path(trainer_folder)
    if not folder_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Trainer folder does not exist or is not a directory: {trainer_folder}")

    detection = detect_trainer(trainer_folder)

    if detection["incomplete"]:
        raise HTTPException(
            status_code=412,
            detail=f"Trainer installation is incomplete: {detection['message']}"
        )
    if not detection["found"]:
        raise HTTPException(
            status_code=404,
            detail=f"No launch file found in trainer folder: {detection['message']}"
        )

    launch_target = Path(detection["launch_target_abs"])
    if not launch_target.is_file():
        raise HTTPException(status_code=404, detail=f"Launch file no longer exists: {launch_target}")

    try:
        _TRAINER_LOG_LINES = []
        if launch_target.suffix.lower() == ".bat":
            cmd = ["cmd.exe", "/c", str(launch_target)]
        elif launch_target.suffix.lower() == ".sh":
            cmd = ["bash", str(launch_target)]
        elif launch_target.suffix.lower() == ".py":
            cmd = [sys.executable, str(launch_target)]
        else:
            cmd = [str(launch_target)]

        _TRAINER_PROCESS = subprocess.Popen(
            cmd,
            cwd=str(folder_path),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )

        # Stream output into log buffer in a background thread
        import threading
        def _collect_output():
            for line in _TRAINER_PROCESS.stdout:
                _TRAINER_LOG_LINES.append(line.rstrip())
                if len(_TRAINER_LOG_LINES) > 200:
                    _TRAINER_LOG_LINES.pop(0)

        threading.Thread(target=_collect_output, daemon=True).start()
        logger.info(f"External trainer launched: PID {_TRAINER_PROCESS.pid}, cmd={cmd}")

        return {
            "status": "launched",
            "pid": _TRAINER_PROCESS.pid,
            "launch_target": detection["launch_target"],
            "type": detection["type"],
            "message": f"Trainer started (PID {_TRAINER_PROCESS.pid})"
        }
    except Exception as e:
        logger.error(f"Failed to launch trainer: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to launch trainer: {e}")


@app.get("/api/trainer/status")
async def get_trainer_status():
    """Return whether the trainer process is running and its recent log output."""
    global _TRAINER_PROCESS, _TRAINER_LOG_LINES
    if _TRAINER_PROCESS is None:
        return {"running": False, "pid": None, "exit_code": None, "log": []}
    exit_code = _TRAINER_PROCESS.poll()
    return {
        "running": exit_code is None,
        "pid": _TRAINER_PROCESS.pid,
        "exit_code": exit_code,
        "log": list(_TRAINER_LOG_LINES[-50:])  # last 50 lines
    }


@app.post("/api/trainer/stop")
async def stop_trainer():
    """Terminate the running external trainer process."""
    global _TRAINER_PROCESS
    if _TRAINER_PROCESS is None or _TRAINER_PROCESS.poll() is not None:
        raise HTTPException(status_code=400, detail="No trainer process is currently running.")
    try:
        _TRAINER_PROCESS.terminate()
        _TRAINER_PROCESS.wait(timeout=10)
        pid = _TRAINER_PROCESS.pid
        _TRAINER_PROCESS = None
        return {"status": "stopped", "pid": pid}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to stop trainer: {e}")


# ---------------------------------------------------------------------------
# Training Output Scanning & Validation
# ---------------------------------------------------------------------------

@app.get("/api/training/scan")
async def scan_training_output_endpoint(model_name: str = ""):
    """
    Scan the Applio training output directory and report exactly which
    .pth/.index files exist, the training phase status, and a verdict.

    The scan path is auto-derived from:
        {external_trainer_path}/logs/{model_name}

    If model_name is empty, scans all subdirectories under logs/.
    """
    trainer_path = settings.get_path("external_trainer_path")
    if not trainer_path or str(trainer_path) in (".", ""):
        raise HTTPException(
            status_code=400,
            detail="External trainer path is not configured. Go to Settings and set the Applio/RVC folder path."
        )

    logs_root = trainer_path / "logs"
    if not logs_root.exists():
        return {
            "scan_path": str(logs_root),
            "dir_exists": False,
            "verdict": "no_directory",
            "verdict_message": f"Applio logs directory does not exist: {logs_root}",
            "models": [],
        }

    if model_name:
        # Scan a specific model
        scan_dir = logs_root / model_name
        return scan_training_output(str(scan_dir))
    else:
        # Scan all model directories under logs/
        models = []
        for d in sorted(logs_root.iterdir()):
            if d.is_dir():
                scan = scan_training_output(str(d))
                scan["model_name"] = d.name
                models.append(scan)
        return {
            "scan_path": str(logs_root),
            "dir_exists": True,
            "models": models,
        }


@app.get("/api/training/phases")
async def get_training_phases_endpoint(model_name: str = ""):
    """
    Return the granular training phase status for a model.
    Shows which of the 5 phases (dataset → features → index → checkpoint → model)
    have completed.
    """
    trainer_path = settings.get_path("external_trainer_path")
    if not trainer_path or str(trainer_path) in (".", ""):
        raise HTTPException(
            status_code=400,
            detail="External trainer path is not configured."
        )

    if not model_name:
        raise HTTPException(status_code=400, detail="model_name parameter is required.")

    log_dir = trainer_path / "logs" / model_name
    phases = get_training_phase_status(str(log_dir))
    validation = validate_training_complete(str(log_dir))

    return {
        "model_name": model_name,
        "log_dir": str(log_dir),
        "phases": phases,
        "validation": validation,
    }


@app.get("/api/trainer/logs")
async def get_trainer_logs_endpoint(limit: int = 100):
    """
    Return Applio training process stdout/stderr captured from the
    launched subprocess, plus any log files found on disk.
    """
    global _TRAINER_PROCESS, _TRAINER_LOG_LINES

    result = {
        "process_log": list(_TRAINER_LOG_LINES[-limit:]),
        "process_running": _TRAINER_PROCESS is not None and _TRAINER_PROCESS.poll() is None,
        "process_pid": _TRAINER_PROCESS.pid if _TRAINER_PROCESS else None,
        "disk_logs": [],
    }

    # Also look for log files in Applio directory
    trainer_path = settings.get_path("external_trainer_path")
    if trainer_path and trainer_path.exists():
        for log_pattern in ["*.log", "logs/**/*.log"]:
            for log_file in trainer_path.glob(log_pattern):
                try:
                    lines = log_file.read_text(encoding="utf-8", errors="replace").splitlines()
                    result["disk_logs"].append({
                        "path": str(log_file),
                        "name": log_file.name,
                        "lines": lines[-limit:],
                        "total_lines": len(lines),
                    })
                except Exception:
                    pass

    return result


@app.post("/api/profile/import/upload")
async def import_profile_upload(
    profile_name: str = Form(...),
    allow_overwrite: bool = Form(False),
    pth_file: UploadFile = File(...),
    index_file: Optional[UploadFile] = File(None),
):
    """
    Import a trained profile by uploading the .pth and optional .index files.
    Validates content before registering the profile.
    """
    if not profile_name.strip():
        raise HTTPException(status_code=400, detail="Profile name is required.")

    if not pth_file.filename.lower().endswith(".pth"):
        raise HTTPException(status_code=400, detail="The model file must have a .pth extension.")

    # Save uploaded files to a temp location for validation
    tmp_dir = Path(tempfile.mkdtemp())
    try:
        pth_tmp = tmp_dir / pth_file.filename
        pth_tmp.write_bytes(await pth_file.read())

        index_tmp_path = None
        if index_file and index_file.filename:
            if not index_file.filename.lower().endswith(".index"):
                raise HTTPException(status_code=400, detail="The index file must have a .index extension.")
            index_tmp = tmp_dir / index_file.filename
            index_tmp.write_bytes(await index_file.read())
            index_tmp_path = str(index_tmp)

        try:
            result = import_profile(
                profile_name=profile_name.strip(),
                pth_source_path=str(pth_tmp),
                index_source_path=index_tmp_path,
                allow_overwrite=allow_overwrite,
            )
            return result
        except FileExistsError as e:
            raise HTTPException(status_code=409, detail=str(e))
        except (FileNotFoundError,) as e:
            raise HTTPException(status_code=404, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except RuntimeError as e:
            raise HTTPException(status_code=500, detail=str(e))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

class ProfileImportLocalRequest(BaseModel):
    profile_name: str
    pth_path: str
    index_path: Optional[str] = None
    allow_overwrite: bool = False

@app.post("/api/profile/import/local")
async def import_profile_local(request: ProfileImportLocalRequest):
    if not request.profile_name.strip():
        raise HTTPException(status_code=400, detail="Profile name is required.")
        
    try:
        result = import_profile(
            profile_name=request.profile_name.strip(),
            pth_source_path=request.pth_path,
            index_source_path=request.index_path,
            allow_overwrite=request.allow_overwrite,
        )
        
        # Trigger API call to W-Okada to load the newly imported model
        try:
            from voice_converter import get_converter
            converter = get_converter()
            converter.load_profile(result["model_path"], result.get("index_path", ""))
            result["engine_loaded"] = True
        except RuntimeError as e:
            logger.warning(f"Engine unreachable during import, but profile was saved: {e}")
            result["engine_loaded"] = False
        except Exception as e:
            logger.error(f"Failed to load model into engine sidecar: {e}")
            result["engine_loaded"] = False

            result["engine_loaded"] = False

        return result
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except (FileNotFoundError,) as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Profile Management
# ---------------------------------------------------------------------------

@app.get("/api/profiles")
async def get_profiles():
    """List all saved voice profiles."""
    return {"profiles": list_profiles()}

@app.delete("/api/profile/{profile_name}")
async def delete_profile_endpoint(profile_name: str):
    """Delete a saved voice profile."""
    from trainer import delete_profile
    try:
        success = delete_profile(profile_name)
        if success:
            return {"status": "success", "message": f"Profile {profile_name} deleted."}
        else:
            raise HTTPException(status_code=404, detail="Profile not found.")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ProfileRepairRequest(BaseModel):
    profile_name: str

@app.post("/api/profile/repair")
async def repair_profile_registration(request: ProfileRepairRequest):
    """Re-uploads and registers a profile with the engine without re-importing files."""
    profiles = list_profiles()
    profile = next((p for p in profiles if p["name"] == request.profile_name), None)

    if profile is None:
        raise HTTPException(
            status_code=404,
            detail="Profile not found."
        )

    try:
        from voice_converter import get_converter
        converter = get_converter()
        converter.upload_profile_to_engine(profile["model_path"], profile.get("index_path", ""), slot=1)
        return {"status": "success", "message": f"Profile {request.profile_name} registration repaired."}
    except RuntimeError as e:
        logger.error(f"Engine sidecar error during repair: {e}")
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.error(f"Engine sidecar unexpected error during repair: {e}")
        raise HTTPException(status_code=500, detail="An unexpected error occurred repairing the voice engine registration.")

# ---------------------------------------------------------------------------
# Real-Time Voice Conversion Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/devices")
async def get_devices():
    """List available audio input and output devices."""
    try:
        return list_audio_devices()
    except Exception as e:
        logger.error(f"Failed to list devices: {e}")
        return {"input": [], "output": []}


@app.post("/api/convert/start")
async def start_conversion(request: ConvertStartRequest):
    """
    Start real-time voice conversion.

    Requires a trained profile to be available.
    """
    # Find the profile
    profiles = list_profiles()
    profile = next((p for p in profiles if p["name"] == request.profile_name), None)

    if profile is None:
        raise HTTPException(
            status_code=404,
            detail="Profile not found."
        )

    # Tell the engine sidecar to load this model (.pth and .index)
    try:
        from voice_converter import get_converter
        converter = get_converter()
        
        # Load the model
        model_path = profile["model_path"]
        index_path = profile["index_path"]
        converter.load_profile(model_path, index_path)
        
        # Start inference
        converter.start(
            input_device=request.input_device,
            output_device=request.output_device,
            settings={
                "pitch_shift": request.pitch_shift,
                "index_rate": request.index_rate
            }
        )
    except RuntimeError as e:
        logger.error(f"Engine sidecar error: {e}")
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        logger.error(f"Engine sidecar unexpected error: {e}")
        raise HTTPException(status_code=500, detail="An unexpected error occurred communicating with the voice engine.")

    return {"status": "running"}


@app.post("/api/convert/stop")
async def stop_conversion():
    """Stop real-time voice conversion."""
    try:
        from voice_converter import get_converter
        converter = get_converter()
        converter.stop()
    except Exception as e:
        logger.error(f"Engine sidecar stop error: {e}")
            
    return {"status": "stopped"}


@app.get("/api/settings")
async def get_settings():
    return settings.get_all()

@app.put("/api/settings")
async def update_settings(new_config: dict):
    settings.update_all(new_config)
    return {"status": "success", "settings": settings.get_all()}

@app.get("/api/browse/folder")
async def browse_folder():
    import tkinter as tk
    from tkinter import filedialog
    
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    folder_path = filedialog.askdirectory(parent=root, title="Select Folder")
    root.destroy()
    
    if folder_path:
        return {"path": os.path.abspath(folder_path)}
    else:
        raise HTTPException(status_code=400, detail="No folder selected")

@app.get("/api/browse/file")
async def browse_file(ext: str = ""):
    import tkinter as tk
    from tkinter import filedialog
    
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    
    filetypes = [("All Files", "*.*")]
    if ext == "pth":
        filetypes = [("PyTorch Model", "*.pth")]
    elif ext == "index":
        filetypes = [("Faiss Index", "*.index")]
        
    file_path = filedialog.askopenfilename(parent=root, title=f"Select File ({ext})", filetypes=filetypes)
    root.destroy()
    
    if file_path:
        return {"path": os.path.abspath(file_path)}
    else:
        raise HTTPException(status_code=400, detail="No file selected")

@app.get("/api/settings/check_port")
async def check_port(port: int, type: str):
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("0.0.0.0", port))
            return {"available": True, "message": f"Port {port} is free."}
        except socket.error:
            import psutil
            blocking_process = "Unknown"
            for conn in psutil.net_connections():
                if conn.laddr.port == port:
                    try:
                        p = psutil.Process(conn.pid)
                        blocking_process = f"PID {p.pid} ({p.name()})"
                    except Exception:
                        blocking_process = f"PID {conn.pid}"
                    break
            return {"available": False, "message": f"Port {port} is in use by {blocking_process}."}

class VerifyEngineRequest(BaseModel):
    path: str

@app.post("/api/settings/verify_engine")
async def verify_engine(request: VerifyEngineRequest):
    engine_path = Path(request.path)
    if not engine_path.exists():
        return {"valid": False, "message": "Directory does not exist", "edition": "none"}
        
    rvc_module = engine_path / "voice_changer" / "RVC"
    if rvc_module.exists():
        # Check if it's the raw source or packaged release
        # Packaged release has a specific structure or executable, but having RVC means it's a valid edition
        return {"valid": True, "message": "RVC module found. Edition verified.", "edition": "cuda_win"}
    
    return {"valid": False, "message": "RVC module not found in engine path.", "edition": "none"}

@app.post("/api/settings/kill_all")
async def kill_all():
    import subprocess
    try:
        subprocess.run(["cmd.exe", "/c", str(PROJECT_ROOT / "stop_all.bat")])
        return {"status": "success", "message": "All voice changer processes killed."}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/settings/restart_engine")
async def restart_engine_endpoint():
    stop_engine_sidecar()
    start_engine_sidecar()
    return {"status": "success", "message": "Sidecar restart triggered."}

from diagnostics import check_system
from file_manager import ensure_all_files_exist

@app.get("/api/diagnostics")
async def get_diagnostics():
    engine_pid = ENGINE_PROCESS.pid if ENGINE_PROCESS else None
    health = check_system(engine_pid)
    
    return health

class FixRequest(BaseModel):
    key: str

@app.post("/api/diagnostics/fix")
async def fix_diagnostic(request: FixRequest):
    if request.key == "vocal_models":
        try:
            from audio_separator.separator import Separator
            # Using the cache dir configured in settings
            models_dir = settings.get_path("models_dir")
            models_dir.mkdir(parents=True, exist_ok=True)
            
            separator = Separator(model_file_dir=str(models_dir))
            
            # This triggers download if it doesn't exist
            model_name = "UVR-MDX-NET-Inst_HQ_3.onnx"
            separator.load_model(model_filename=model_name)
            
            # Post-download verification
            target_file = models_dir / model_name
            if not target_file.exists():
                return JSONResponse(status_code=500, content={"status": "error", "message": f"Download returned success but {model_name} is not in {models_dir}."})
            
            size_bytes = target_file.stat().st_size
            if size_bytes < 1024 * 1024:
                return JSONResponse(status_code=500, content={"status": "error", "message": f"Downloaded file {model_name} is unexpectedly small ({size_bytes} bytes)."})
                
            return {"status": "success", "message": f"Model {model_name} downloaded successfully to {models_dir} ({size_bytes / (1024*1024):.1f} MB)."}
        except Exception as e:
            logger.error(f"Failed to download model: {e}")
            return JSONResponse(status_code=500, content={"status": "error", "message": f"Failed to download model: {str(e)}"})
            
    return JSONResponse(status_code=400, content={"status": "error", "message": "Unknown fix key"})

@app.get("/api/logs")
async def get_logs(limit: int = 100):
    log_file = settings.get_path("logs_dir") / "app.log"
    if not log_file.exists():
        return {"logs": []}
    
    with open(log_file, "r") as f:
        lines = f.readlines()
    return {"logs": lines[-limit:]}

@app.get("/api/convert/status")
async def get_conversion_status():
    """Get current conversion status and level meters."""
    converter = get_converter()
    return converter.get_status()


@app.post("/api/convert/settings")
async def update_conversion_settings(request: ConvertSettingsUpdate):
    """Update conversion settings on the fly (pitch, gain, etc.)."""
    converter = get_converter()
    settings = {k: v for k, v in request.model_dump().items() if v is not None}
    converter.update_settings(settings)
    return {"status": "updated", "settings": settings}


@app.post("/api/convert/test")
async def test_conversion():
    """
    Test voice conversion with a sample audio clip.
    Returns the converted audio file for playback.
    """
    converter = get_converter()

    # Use the most recently processed vocals as test audio,
    # or a built-in sample if available
    sample_path = None
    for job_id, job in _jobs.items():
        if job.get("vocals_path") and os.path.exists(job["vocals_path"]):
            sample_path = job["vocals_path"]
            break

    if sample_path is None:
        raise HTTPException(
            status_code=404,
            detail="No sample audio available. Upload and process a video first.",
        )

    output_path = str(UPLOADS_DIR / "test_conversion_output.wav")

    try:
        result_path = converter.test_with_sample(sample_path, output_path)
        return FileResponse(
            result_path,
            media_type="audio/wav",
            filename="test_conversion.wav",
        )
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Health Check
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "ok",
        "gpu_available": _check_gpu(),
    }

@app.get("/api/system/gpu")
async def system_gpu():
    try:
        import torch
        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            mem_allocated = torch.cuda.memory_allocated(0)
            mem_total = props.total_memory
            mem_free = mem_total - mem_allocated
            return {
                "cuda_available": True,
                "gpu_name": props.name,
                "pytorch_version": torch.__version__,
                "vram_free_mb": int(mem_free / (1024*1024)),
                "vram_total_mb": int(mem_total / (1024*1024))
            }
        else:
            return {
                "cuda_available": False,
                "pytorch_version": torch.__version__ if hasattr(torch, '__version__') else "unknown"
            }
    except Exception as e:
        return {"error": str(e), "cuda_available": False}


def _check_gpu() -> bool:
    """Check if CUDA GPU is available."""
    try:
        import torch
        return torch.cuda.is_available()
    except ImportError:
        return False


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
