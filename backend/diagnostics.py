import os
import sys
import shutil
import platform
import logging
from typing import Dict, Any
import httpx
import psutil

from settings import settings
from voice_converter import get_converter
from trainer import detect_trainer, scan_training_output, get_training_phase_status

logger = logging.getLogger(__name__)

def check_system(engine_pid: int = None) -> Dict[str, Any]:
    """Run diagnostics on the system environment."""
    diagnostics = {}
    
    # 1. FFmpeg
    ffmpeg_path = shutil.which("ffmpeg")
    diagnostics["ffmpeg"] = {
        "status": "ready" if ffmpeg_path else "missing",
        "path": ffmpeg_path or "",
        "message": "FFmpeg is installed and accessible." if ffmpeg_path else "FFmpeg executable not found in PATH."
    }
    
    # 2. Python Backend
    diagnostics["python"] = {
        "status": "connected",
        "version": platform.python_version(),
        "message": f"Python {platform.python_version()} on {platform.system()}"
    }
    
    # 3. GPU / PyTorch
    cuda_available = False
    try:
        import torch
        cuda_available = torch.cuda.is_available()
        gpu_name = torch.cuda.get_device_name(0) if cuda_available else ""
        vram_free_gb = None
        if cuda_available:
            try:
                # Get total and allocated VRAM to calculate free VRAM
                total_vram = torch.cuda.get_device_properties(0).total_memory
                allocated_vram = torch.cuda.memory_allocated(0)
                vram_free_gb = (total_vram - allocated_vram) / (1024**3)
            except Exception:
                pass
                
        diagnostics["pytorch"] = {
            "status": "ready" if cuda_available else "warning",
            "cuda_enabled": cuda_available,
            "version": torch.__version__,
            "gpu": gpu_name,
            "vram_free_gb": round(vram_free_gb, 2) if vram_free_gb is not None else None,
            "message": "CUDA is available." if cuda_available else "PyTorch is running in CPU-only mode."
        }
    except ImportError:
        diagnostics["pytorch"] = {
            "status": "missing",
            "cuda_enabled": False,
            "message": "PyTorch is not installed."
        }
        
    # 4. Models
    models_dir = settings.get_path("models_dir")
    model_files = []
    if models_dir.exists():
        for f in models_dir.glob("*"):
            if f.suffix in [".onnx", ".ckpt", ".yaml", ".th", ".pth"]:
                size_mb = f.stat().st_size / (1024 * 1024)
                model_files.append({"name": f.name, "size_mb": round(size_mb, 2)})
                
    num_models = len(model_files)
    diagnostics["vocal_models"] = {
        "status": "ready" if num_models > 0 else "missing",
        "count": num_models,
        "path": str(models_dir),
        "files": model_files,
        "message": f"Found {num_models} vocal isolation models." if num_models > 0 else "No vocal isolation models found."
    }
    
    # 5. Profiles
    profiles_dir = settings.get_path("profiles_dir")
    num_profiles = sum(1 for p in profiles_dir.iterdir() if p.is_dir()) if profiles_dir.exists() else 0
    diagnostics["voice_profiles"] = {
        "status": "ready",
        "count": num_profiles,
        "path": str(profiles_dir),
    }
    
    # Voice Conversion Engine (W-Okada)
    converter = get_converter()
    expected_profile = converter._settings.profile_name
    
    engine_port = settings.get("ports", "sidecar", 18888)
    
    # 1. Determine who owns the port
    port_owner_pid = None
    port_owner_exe = None
    try:
        for conn in psutil.net_connections():
            if conn.laddr.port == engine_port and conn.status == 'LISTEN':
                try:
                    proc = psutil.Process(conn.pid)
                    port_owner_pid = proc.pid
                    port_owner_exe = proc.exe()
                except Exception:
                    pass
                break
    except Exception as e:
        logger.error(f"Error checking port ownership: {e}")

    # 2. Check HTTP health
    http_responding = False
    active_model = "Unknown"
    is_rvc = False
    http_error = ""
    
    if port_owner_pid:
        try:
            resp = httpx.get(f"http://127.0.0.1:{engine_port}/info", timeout=2.0)
            resp.raise_for_status()
            data = resp.json()
            http_responding = True
            
            # Determine which model is actually active on the sidecar
            slot_index = data.get("modelSlotIndex", -1)
            
            # W-Okada might represent a built-in model using a string instead of an int slot, or it might be an int.
            if isinstance(slot_index, str):
                active_model = slot_index
                is_rvc = False
            else:
                slots = data.get("modelSlots", [])
                for slot in slots:
                    if slot.get("slotIndex") == slot_index:
                        active_model = slot.get("name") or slot.get("voiceChangerType") or "Unknown Slot"
                        is_rvc = slot.get("voiceChangerType") == "RVC"
                        break
        except Exception as e:
            http_error = str(e)
            
    # 3. Formulate the authoritative status
    status = "missing"
    message = "Not installed or not running"
    endpoint_mismatch = False
    
    if port_owner_pid and not http_responding:
        # Running but not responding to health check, possibly an incompatible service
        is_managed = (engine_pid is not None) and (engine_pid == port_owner_pid)
        management_str = f"App-managed (PID: {port_owner_pid})" if is_managed else f"Running externally (PID: {port_owner_pid})"
        status = "error"
        message = f"Process running {management_str} but health check failed."
        if "404" in http_error:
            endpoint_mismatch = True
    elif http_responding:
        # It's running and responding
        is_managed = (engine_pid is not None) and (engine_pid == port_owner_pid)
        management_str = f"App-managed (PID: {port_owner_pid})" if is_managed else f"Running externally (PID: {port_owner_pid})"
        
        # Check for mismatch if a profile is expected to be loaded
        mismatch_msg = ""
        if expected_profile and expected_profile not in active_model:
            mismatch_msg = f" (Mismatch: UI expects '{expected_profile}')"
            status = "warning"
        else:
            status = "ready"
            
        model_type = "RVC" if is_rvc else "Beatrice"
        message = f"{management_str}. Active model: {active_model} [{model_type}]{mismatch_msg}"
        
    elif engine_pid:
        # Managed process is registered but port is not bound
        status = "warning"
        message = f"Starting up... (PID: {engine_pid})"

    diagnostics["voice_conversion_engine"] = {
        "status": status,
        "message": message,
        "active_model": active_model if http_responding else None,
        "pid": port_owner_pid,
        "port": engine_port,
        "executable": port_owner_exe,
        "health_check_result": "Passed" if http_responding else (http_error if http_error else "Service not running"),
        "endpoint_mismatch": endpoint_mismatch
    }
    
        
    # External Trainer
    external_trainer = settings.get_path("external_trainer_path")
    if not external_trainer or str(external_trainer) == "" or str(external_trainer) == ".":
        diagnostics["external_trainer"] = {
            "status": "missing",
            "path": "",
            "message": "External trainer path is not configured. Training requires an external Applio/RVC setup."
        }
    elif not external_trainer.exists():
        diagnostics["external_trainer"] = {
            "status": "error",
            "path": str(external_trainer),
            "message": "Configured external trainer path does not exist."
        }
    else:
        detection = detect_trainer(str(external_trainer))
        if not detection.get("found"):
            diagnostics["external_trainer"] = {
                "status": "error",
                "path": str(external_trainer),
                "message": f"Trainer launch file not found: {detection.get('message', 'Invalid folder')}"
            }
        elif detection.get("incomplete"):
            diagnostics["external_trainer"] = {
                "status": "warning",
                "path": str(external_trainer),
                "message": f"Trainer is incomplete: {detection.get('message', 'Missing env')}"
            }
        else:
            diagnostics["external_trainer"] = {
                "status": "ready",
                "path": str(external_trainer),
                "message": f"Detected valid {detection.get('type')} trainer: {detection.get('launch_target')}"
            }

    # Training Output Scan
    try:
        external_trainer = settings.get_path("external_trainer_path")
        if external_trainer and str(external_trainer) not in ("", ".") and external_trainer.exists():
            logs_root = external_trainer / "logs"
            if logs_root.exists():
                model_scans = []
                for d in sorted(logs_root.iterdir()):
                    if d.is_dir():
                        phases = get_training_phase_status(str(d))
                        # Only include dirs that have at least preprocessing done
                        if phases.get("dataset_prepared") or phases.get("features_extracted"):
                            scan = scan_training_output(str(d))
                            scan["model_name"] = d.name
                            model_scans.append(scan)

                if model_scans:
                    # Report worst verdict
                    has_missing = any(
                        s["verdict"] in ("preprocessing_only", "training_incomplete", "checkpoints_only")
                        for s in model_scans
                    )
                    has_ready = any(s["verdict"] == "model_ready" for s in model_scans)

                    if has_missing and not has_ready:
                        status = "error"
                        # Find the most relevant scan (preprocessing_only is the worst)
                        worst = next(
                            (s for s in model_scans if s["verdict"] == "preprocessing_only"),
                            model_scans[0]
                        )
                        message = (
                            f"Model '{worst.get('model_name', '?')}': {worst['verdict_message']}"
                        )
                    elif has_missing and has_ready:
                        status = "warning"
                        message = f"{len(model_scans)} model(s) scanned. Some are missing .pth files."
                    else:
                        status = "ready"
                        message = f"{len(model_scans)} model(s) found with valid outputs."

                    diagnostics["training_output"] = {
                        "status": status,
                        "path": str(logs_root),
                        "message": message,
                        "models": [
                            {
                                "name": s.get("model_name", "?"),
                                "verdict": s["verdict"],
                                "verdict_message": s["verdict_message"],
                                "phases": s.get("phases", {}),
                                "pth_count": len(s.get("pth_files", [])),
                                "index_count": len(s.get("index_files", [])),
                            }
                            for s in model_scans
                        ],
                    }
                else:
                    diagnostics["training_output"] = {
                        "status": "missing",
                        "path": str(logs_root),
                        "message": "No training output found. Train a model in Applio first.",
                    }
            else:
                diagnostics["training_output"] = {
                    "status": "missing",
                    "path": str(external_trainer),
                    "message": "Applio logs directory not found.",
                }
    except Exception as e:
        logger.error(f"Error scanning training output: {e}")
        diagnostics["training_output"] = {
            "status": "error",
            "message": f"Failed to scan training output: {e}",
        }
        
        
    # 6. Disk space (check temp dir)
    temp_dir = settings.get_path("temp_dir")
    try:
        total, used, free = shutil.disk_usage(temp_dir)
        free_gb = round(free / (1024**3), 1)
        diagnostics["disk_space"] = {
            "status": "ready" if free_gb > 5.0 else "warning",
            "free_gb": free_gb,
            "message": f"{free_gb} GB free on {temp_dir.drive or temp_dir.root}"
        }
    except Exception:
        diagnostics["disk_space"] = {"status": "error", "message": "Could not read disk space."}
        
    return diagnostics
