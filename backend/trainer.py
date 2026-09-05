"""
trainer.py — Dataset Preparation and External Profile Import

Architecture: External-only training.
- Internal rvc-python/fairseq training is REMOVED. There is no internal training path.
- This module prepares datasets for Applio/RVC and imports trained .pth/.index files back.
- list_profiles() validates real models (size + mock-content check).
"""

import os
import json
import wave
import shutil
import logging
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

from settings import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Known Applio / RVC launch file candidates, in priority order
# ---------------------------------------------------------------------------
_APPLIO_LAUNCHERS = [
    "run-applio.bat", "run-applio-ux.bat", "go-applio.bat",
    "run-applio.sh", "go-applio.sh",
]
_RVC_LAUNCHERS = [
    "infer-web.bat", "go-web.bat", "run.bat", "run.sh", "go-web.sh",
]
_GENERIC_LAUNCHERS = ["app.py"]
_INSTALLER_NAMES = ["run-install.bat", "run-install.sh", "install.bat", "install.sh"]

_MOCK_CONTENT_SIGNATURES = [b"Mock", b"placeholder", b"fake", b"THIS_IS_NOT_A_REAL"]


def detect_trainer(folder: str) -> Dict[str, Any]:
    """
    Scan a folder for known Applio/RVC-Project launch files.

    Returns a dict with:
        found (bool): True if a usable launch target was found.
        launch_target (str|None): Relative path to the launch file.
        launch_target_abs (str|None): Absolute path to the launch file.
        type (str|None): "applio", "rvc", "generic", or None.
        incomplete (bool): True if only an installer was found.
        message (str): Human-readable status message.
    """
    folder_path = Path(folder)

    if not folder_path.exists():
        return {
            "found": False, "launch_target": None, "launch_target_abs": None,
            "type": None, "incomplete": False,
            "message": f"Folder does not exist: {folder}"
        }
    if not folder_path.is_dir():
        return {
            "found": False, "launch_target": None, "launch_target_abs": None,
            "type": None, "incomplete": False,
            "message": f"Path exists but is not a directory: {folder}"
        }

    # Walk top-level only (don't recurse into venv/etc.)
    existing_files = {f.name.lower(): f for f in folder_path.iterdir() if f.is_file()}

    # Check for known launchers in priority order
    for name in _APPLIO_LAUNCHERS:
        if name.lower() in existing_files:
            target = existing_files[name.lower()]
            return {
                "found": True,
                "launch_target": name,
                "launch_target_abs": str(target),
                "type": "applio",
                "incomplete": False,
                "message": f"Applio found \u2014 launch target: {name}"
            }

    for name in _RVC_LAUNCHERS:
        if name.lower() in existing_files:
            target = existing_files[name.lower()]
            return {
                "found": True,
                "launch_target": name,
                "launch_target_abs": str(target),
                "type": "rvc",
                "incomplete": False,
                "message": f"RVC-Project found \u2014 launch target: {name}"
            }

    for name in _GENERIC_LAUNCHERS:
        if name.lower() in existing_files:
            target = existing_files[name.lower()]
            return {
                "found": True,
                "launch_target": name,
                "launch_target_abs": str(target),
                "type": "generic",
                "incomplete": False,
                "message": f"Generic launcher found: {name}"
            }

    # Check for any .exe that isn't an installer
    for f in folder_path.iterdir():
        if f.suffix.lower() == ".exe" and "install" not in f.name.lower() and "unins" not in f.name.lower():
            return {
                "found": True,
                "launch_target": f.name,
                "launch_target_abs": str(f),
                "type": "exe",
                "incomplete": False,
                "message": f"Executable found: {f.name}"
            }

    # Only installer present — installation is incomplete
    for name in _INSTALLER_NAMES:
        if name.lower() in existing_files:
            return {
                "found": False,
                "launch_target": name,
                "launch_target_abs": str(existing_files[name.lower()]),
                "type": None,
                "incomplete": True,
                "message": (
                    f"Installation is not complete. Only '{name}' was found. "
                    f"Run the installer first, then point this path at the installed folder."
                )
            }

    return {
        "found": False, "launch_target": None, "launch_target_abs": None,
        "type": None, "incomplete": False,
        "message": "No known Applio or RVC launch file found in this folder."
    }


def get_dataset_stats(dataset_folder: str) -> Dict[str, Any]:
    """
    Read real stats from a dataset folder using ffprobe and stdlib wave.
    Returns file count, total duration (s), sample rate, format.
    """
    folder = Path(dataset_folder)
    if not folder.exists() or not folder.is_dir():
        raise FileNotFoundError(f"Dataset folder not found: {dataset_folder}")

    wav_files = sorted(folder.glob("*.wav"))
    if not wav_files:
        return {
            "file_count": 0,
            "total_duration_s": 0.0,
            "sample_rate": 0,
            "format": "wav",
            "folder": dataset_folder,
            "files": []
        }

    total_duration = 0.0
    sample_rate = 44100
    file_details = []

    ffprobe = shutil.which("ffprobe") or shutil.which("ffmpeg.exe")

    for wav_path in wav_files:
        dur = 0.0
        sr = 44100
        # Try stdlib wave first (fast, no subprocess)
        try:
            with wave.open(str(wav_path), "rb") as wf:
                sr = wf.getframerate()
                dur = wf.getnframes() / float(sr)
                sample_rate = sr
        except Exception:
            # Fallback: ffprobe
            if ffprobe:
                try:
                    result = subprocess.run(
                        [ffprobe, "-v", "error", "-show_entries", "format=duration",
                         "-of", "default=noprint_wrappers=1:nokey=1", str(wav_path)],
                        capture_output=True, text=True, timeout=10
                    )
                    dur = float(result.stdout.strip() or 0)
                except Exception:
                    pass

        total_duration += dur
        file_details.append({
            "name": wav_path.name,
            "duration_s": round(dur, 2),
            "size_bytes": wav_path.stat().st_size
        })

    return {
        "file_count": len(wav_files),
        "total_duration_s": round(total_duration, 2),
        "sample_rate": sample_rate,
        "format": "WAV 16-bit PCM",
        "folder": dataset_folder,
        "files": file_details
    }


def prepare_dataset(profile_name: str, input_audio_paths: List[str]) -> str:
    """
    Prepare a dataset for external training.
    Creates a folder and converts each audio file to 44.1kHz mono WAV using ffmpeg.
    """
    safe_name = "".join(c for c in profile_name if c.isalnum() or c in " _-").strip()
    if not safe_name:
        safe_name = "voice_profile"

    datasets_dir = settings.get_path("datasets_dir")
    dataset_folder = datasets_dir / f"{safe_name}_dataset"
    dataset_folder.mkdir(parents=True, exist_ok=True)

    ffmpeg_path = shutil.which("ffmpeg") or "ffmpeg"
    processed_count = 0

    for idx, input_path_str in enumerate(input_audio_paths):
        input_path = Path(input_path_str)
        if not input_path.exists() or not input_path.is_file():
            logger.warning(f"Skipping missing input file: {input_path}")
            continue

        output_filename = f"{safe_name}_{idx:03d}.wav"
        output_path = dataset_folder / output_filename

        try:
            cmd = [
                ffmpeg_path, "-y",
                "-i", str(input_path),
                "-ac", "1",
                "-ar", "44100",
                "-c:a", "pcm_s16le",
                str(output_path)
            ]
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
            processed_count += 1
        except subprocess.CalledProcessError as e:
            logger.error(f"ffmpeg failed for {input_path}: {e}")

    if processed_count == 0:
        raise RuntimeError("No valid audio files were successfully processed for the dataset.")

    return str(dataset_folder)


def _is_mock_content(pth_path: Path) -> bool:
    """Check first 512 bytes for known mock/placeholder signatures."""
    try:
        header = pth_path.read_bytes()[:512]
        return any(sig in header for sig in _MOCK_CONTENT_SIGNATURES)
    except Exception:
        return False


def import_profile(
    profile_name: str,
    pth_source_path: str,
    index_source_path: Optional[str] = None,
    allow_overwrite: bool = False
) -> Dict[str, Any]:
    """
    Import a trained profile.
    - Validates the .pth: existence, size (>1MB), no mock content.
    - Raises FileExistsError if profile already exists and allow_overwrite=False.
    - Saves profile metadata as profile_meta.json.
    """
    safe_name = "".join(c for c in profile_name if c.isalnum() or c in " _-").strip()
    if not safe_name:
        raise ValueError("Profile name must contain at least one alphanumeric character.")

    pth_path = Path(pth_source_path)
    if not pth_path.exists() or not pth_path.is_file():
        raise FileNotFoundError(f"Model file not found: {pth_source_path}")

    if not pth_path.suffix.lower() == ".pth":
        raise ValueError(f"Expected a .pth file, got: {pth_path.suffix}")

    size_bytes = pth_path.stat().st_size
    size_mb = size_bytes / (1024 * 1024)

    try:
        header_32 = pth_path.read_bytes()[:32]
        header_hex = header_32.hex()
    except Exception:
        header_32 = b""
        header_hex = "UNREADABLE"

    logger.info(f"Importing profile: {safe_name} | Path: {pth_path} | Size: {size_bytes} | Header(32): {header_hex}")

    if size_bytes == 0:
        raise ValueError("Model file is zero bytes (empty).")

    if size_mb < 1.0:
        raise ValueError(
            f"Model file is too small ({size_mb:.2f} MB, {size_bytes} bytes). "
            f"Expected a real trained model (>1 MB). This may be a placeholder or empty file."
        )

    # Check for known mock markers with diagnostic reason
    try:
        header_512 = pth_path.read_bytes()[:512]
        for sig in _MOCK_CONTENT_SIGNATURES:
            if sig in header_512:
                raise ValueError(
                    f"Model file contains mock/placeholder content ('{sig.decode('ascii', errors='ignore')}') and is not a real trained model. "
                    "Train the model in Applio/RVC and use the output .pth file."
                )
    except ValueError:
        raise
    except Exception:
        pass

    # Validate PyTorch/RVC structural signature
    if header_32:
        is_zip = header_32.startswith(b"PK\x03\x04")
        is_legacy = header_32.startswith(b"\x80") or (b"pytorch" in header_32.lower())
        if not (is_zip or is_legacy):
            raise ValueError(
                f"File does not appear to be a valid PyTorch/RVC checkpoint (missing zip or legacy header). "
                f"First 32 bytes: {header_hex}"
            )

    profiles_dir = settings.get_path("profiles_dir")
    profile_folder = profiles_dir / safe_name

    if profile_folder.exists() and any(profile_folder.glob("*.pth")) and not allow_overwrite:
        raise FileExistsError(
            f"A profile named '{safe_name}' already exists. "
            f"Set allow_overwrite=true to replace it."
        )

    profile_folder.mkdir(parents=True, exist_ok=True)

    # Copy .pth
    dest_pth = profile_folder / pth_path.name
    shutil.copy2(pth_path, dest_pth)

    # Verify the copy
    if dest_pth.stat().st_size != size_bytes:
        raise RuntimeError(
            f"File copy verification failed: source was {size_bytes} bytes "
            f"but destination is {dest_pth.stat().st_size} bytes."
        )

    # Copy .index if provided
    dest_index = ""
    index_size_bytes = 0
    if index_source_path:
        idx_path = Path(index_source_path)
        if idx_path.exists() and idx_path.is_file():
            idx_dest = profile_folder / idx_path.name
            shutil.copy2(idx_path, idx_dest)
            index_size_bytes = idx_dest.stat().st_size
            dest_index = str(idx_dest)
        else:
            logger.warning(f"Index file provided but not found: {index_source_path}")

    # Save metadata
    meta = {
        "profile_name": safe_name,
        "model_file": pth_path.name,
        "model_size_mb": round(size_mb, 3),
        "index_file": Path(dest_index).name if dest_index else None,
        "index_size_bytes": index_size_bytes,
        "imported_at": datetime.now().isoformat(),
        "source_pth": str(pth_path),
        "source_index": index_source_path or None,
    }
    (profile_folder / "profile_meta.json").write_text(json.dumps(meta, indent=2))

    return {
        "status": "success",
        "profile_name": safe_name,
        "model_path": str(dest_pth),
        "index_path": dest_index,
        "model_size_mb": round(size_mb, 3),
    }


def list_profiles() -> List[Dict[str, Any]]:
    """
    List all valid saved profiles.
    Skips directories with no .pth files, or only fake/mock models.
    """
    profiles = []
    profiles_dir = settings.get_path("profiles_dir")
    if not profiles_dir.exists():
        return profiles

    for profile_dir in sorted(profiles_dir.iterdir()):
        if not profile_dir.is_dir():
            continue

        pth_files = list(profile_dir.glob("*.pth"))
        if not pth_files:
            continue

        # Filter to real models (>1MB, no mock content)
        valid = [
            f for f in pth_files
            if f.stat().st_size >= (1024 * 1024) and not _is_mock_content(f)
        ]
        if not valid:
            continue

        model_path = valid[0]
        index_files = list(profile_dir.glob("*.index"))
        index_path = index_files[0] if index_files else None

        # Load metadata if present
        meta_file = profile_dir / "profile_meta.json"
        meta = {}
        if meta_file.exists():
            try:
                meta = json.loads(meta_file.read_text())
            except Exception:
                pass

        profiles.append({
            "name": profile_dir.name,
            "model_path": str(model_path),
            "index_path": str(index_path) if index_path else "",
            "size_mb": round(model_path.stat().st_size / (1024 * 1024), 2),
            "imported_at": meta.get("imported_at", ""),
        })

    return profiles


# ---------------------------------------------------------------------------
# Training Output Scanner & Validator
# ---------------------------------------------------------------------------

def delete_profile(profile_name: str) -> bool:
    """Delete a saved voice profile by name."""
    safe_name = "".join(c for c in profile_name if c.isalnum() or c in " _-").strip()
    if not safe_name:
        raise ValueError("Invalid profile name")
    profiles_dir = settings.get_path("profiles_dir")
    profile_folder = profiles_dir / safe_name
    if not profile_folder.exists():
        return False
    import shutil
    shutil.rmtree(profile_folder)
    return True


def get_training_phase_status(applio_log_dir: str) -> Dict[str, Any]:
    """
    Check which training phases have completed by inspecting
    the Applio output directory structure.

    Returns a dict with boolean status for each phase:
      - dataset_prepared: sliced_audios/ has WAV files
      - features_extracted: extracted/ has .npy files AND f0/ has .npy files
      - index_generated: .index file exists and > 1 KB
      - checkpoint_saved: Any G_*.pth or D_*.pth checkpoint exists
      - model_exported: Final <name>_*e_*s.pth exists and > 1 MB
    """
    log_path = Path(applio_log_dir)
    if not log_path.exists() or not log_path.is_dir():
        return {
            "dataset_prepared": False,
            "features_extracted": False,
            "index_generated": False,
            "checkpoint_saved": False,
            "model_exported": False,
            "dir_exists": False,
        }

    # 1. Dataset prepared
    sliced_dir = log_path / "sliced_audios"
    dataset_prepared = (
        sliced_dir.exists()
        and any(sliced_dir.glob("*.wav"))
    )

    # 2. Features extracted
    extracted_dir = log_path / "extracted"
    f0_dir = log_path / "f0"
    features_extracted = (
        extracted_dir.exists()
        and any(extracted_dir.glob("*.npy"))
        and f0_dir.exists()
        and any(f0_dir.glob("*.npy"))
    )

    # 3. Index generated
    index_files = list(log_path.glob("*.index"))
    index_generated = any(f.stat().st_size > 1024 for f in index_files)

    # 4. Checkpoint saved (G_*.pth or D_*.pth)
    g_checkpoints = list(log_path.glob("G_*.pth"))
    d_checkpoints = list(log_path.glob("D_*.pth"))
    checkpoint_saved = len(g_checkpoints) > 0 and len(d_checkpoints) > 0

    # 5. Final model exported (<name>_<epoch>e_<step>s.pth)
    # These are NOT G_/D_ prefixed — they're the extracted final model
    all_pth = list(log_path.glob("*.pth"))
    exported_models = [
        f for f in all_pth
        if not f.name.startswith("G_")
        and not f.name.startswith("D_")
        and f.stat().st_size >= (1024 * 1024)
        and not _is_mock_content(f)
    ]
    model_exported = len(exported_models) > 0

    return {
        "dataset_prepared": dataset_prepared,
        "features_extracted": features_extracted,
        "index_generated": index_generated,
        "checkpoint_saved": checkpoint_saved,
        "model_exported": model_exported,
        "dir_exists": True,
    }


def scan_training_output(applio_log_dir: str) -> Dict[str, Any]:
    """
    Scan the Applio training output directory and report exactly what exists.

    Returns a detailed inventory of all training artifacts:
    - .pth files (with size, modified time, validity)
    - .index files (with size)
    - Checkpoint files (G_*.pth, D_*.pth)
    - TensorBoard event files (with size — 88 bytes = no training data)
    - Phase status
    - Overall verdict
    """
    log_path = Path(applio_log_dir)
    result: Dict[str, Any] = {
        "scan_path": applio_log_dir,
        "dir_exists": log_path.exists() and log_path.is_dir(),
        "pth_files": [],
        "index_files": [],
        "checkpoint_files": [],
        "tensorboard_events": [],
        "phases": {},
        "config": None,
        "model_info": None,
        "verdict": "unknown",
        "verdict_message": "",
    }

    if not result["dir_exists"]:
        result["verdict"] = "no_directory"
        result["verdict_message"] = f"Training output directory does not exist: {applio_log_dir}"
        return result

    # Scan .pth files
    for f in sorted(log_path.glob("*.pth")):
        stat = f.stat()
        size_mb = stat.st_size / (1024 * 1024)
        is_checkpoint = f.name.startswith("G_") or f.name.startswith("D_")
        is_mock = _is_mock_content(f) if stat.st_size > 0 else True
        entry = {
            "name": f.name,
            "path": str(f),
            "size_bytes": stat.st_size,
            "size_mb": round(size_mb, 3),
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "is_checkpoint": is_checkpoint,
            "is_valid": size_mb >= 1.0 and not is_mock,
            "is_mock": is_mock,
        }
        if is_checkpoint:
            result["checkpoint_files"].append(entry)
        else:
            result["pth_files"].append(entry)

    # Scan .index files
    for f in sorted(log_path.glob("*.index")):
        stat = f.stat()
        result["index_files"].append({
            "name": f.name,
            "path": str(f),
            "size_bytes": stat.st_size,
            "size_kb": round(stat.st_size / 1024, 1),
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        })

    # Scan TensorBoard events
    eval_dir = log_path / "eval"
    if eval_dir.exists():
        for f in sorted(eval_dir.glob("events.out.tfevents.*")):
            stat = f.stat()
            result["tensorboard_events"].append({
                "name": f.name,
                "size_bytes": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "has_training_data": stat.st_size > 200,  # 88 bytes = header only
            })

    # Load config.json
    config_path = log_path / "config.json"
    if config_path.exists():
        try:
            result["config"] = json.loads(config_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    # Load model_info.json
    model_info_path = log_path / "model_info.json"
    if model_info_path.exists():
        try:
            result["model_info"] = json.loads(model_info_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    # Phase status
    result["phases"] = get_training_phase_status(applio_log_dir)

    # Determine verdict
    valid_models = [f for f in result["pth_files"] if f["is_valid"]]
    has_checkpoints = len(result["checkpoint_files"]) > 0
    has_index = len(result["index_files"]) > 0
    all_events_empty = all(
        not e["has_training_data"] for e in result["tensorboard_events"]
    )

    if valid_models:
        best = max(valid_models, key=lambda f: f["size_bytes"])
        result["verdict"] = "model_ready"
        result["verdict_message"] = (
            f"Trained model found: {best['name']} ({best['size_mb']} MB). "
            f"Ready to import."
        )
        result["best_model_path"] = best["path"]
        result["best_index_path"] = (
            result["index_files"][0]["path"] if result["index_files"] else None
        )
    elif has_checkpoints and not valid_models:
        result["verdict"] = "checkpoints_only"
        result["verdict_message"] = (
            "Training checkpoints (G_/D_) exist but no final exported model. "
            "Training may still be in progress, or the export step was skipped. "
            "In Applio, ensure 'Save Every Weights' is enabled."
        )
    elif has_index and all_events_empty and not has_checkpoints:
        result["verdict"] = "preprocessing_only"
        result["verdict_message"] = (
            "Training did not produce a model file. "
            "Only preprocessing artifacts exist (index, features, sliced audio). "
            f"The {len(result['tensorboard_events'])} training attempt(s) each "
            f"crashed before completing epoch 1 (TensorBoard files are header-only at 88 bytes). "
            "Check the Applio training console output for errors."
        )
    elif has_index and not all_events_empty:
        result["verdict"] = "training_incomplete"
        result["verdict_message"] = (
            "Training started but did not complete. No model file was exported. "
            "Check training logs and consider re-running with 'Save Every Weights' enabled."
        )
    else:
        result["verdict"] = "empty"
        result["verdict_message"] = (
            f"No training output found in {applio_log_dir}. "
            "Run preprocessing and training in Applio first."
        )

    return result


def validate_training_complete(
    applio_log_dir: str,
    training_start_time: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Strict validation: returns success=True ONLY when a real .pth model exists.

    Checks:
    - A .pth file exists (not G_/D_ checkpoint)
    - It is > 1 MB
    - It is not mock/placeholder content
    - It is readable
    - If training_start_time is provided, it was modified after that time

    Returns:
        {
            "success": bool,
            "model_path": str or None,
            "model_size_mb": float or None,
            "index_path": str or None,
            "error": str or None,
            "phases": dict,
        }
    """
    log_path = Path(applio_log_dir)
    phases = get_training_phase_status(applio_log_dir)

    if not log_path.exists():
        return {
            "success": False,
            "model_path": None,
            "model_size_mb": None,
            "index_path": None,
            "error": f"Output directory does not exist: {applio_log_dir}",
            "phases": phases,
        }

    # Find all candidate model files (not G_/D_ checkpoints)
    all_pth = list(log_path.glob("*.pth"))
    candidates = [
        f for f in all_pth
        if not f.name.startswith("G_")
        and not f.name.startswith("D_")
    ]

    if not candidates:
        return {
            "success": False,
            "model_path": None,
            "model_size_mb": None,
            "index_path": None,
            "error": (
                "Training did not produce a model file. "
                "No .pth file found in the output directory. "
                "Open the Applio training logs to see the error."
            ),
            "phases": phases,
        }

    # Find the best candidate (largest valid file)
    best = None
    for f in candidates:
        stat = f.stat()
        size_mb = stat.st_size / (1024 * 1024)

        if size_mb < 1.0:
            continue
        if _is_mock_content(f):
            continue

        # Check modification time if provided
        if training_start_time:
            try:
                start_dt = datetime.fromisoformat(training_start_time)
                file_dt = datetime.fromtimestamp(stat.st_mtime)
                if file_dt < start_dt:
                    continue
            except (ValueError, OSError):
                pass

        # Readability check
        try:
            with open(f, "rb") as fh:
                fh.read(512)
        except Exception:
            continue

        if best is None or stat.st_size > best.stat().st_size:
            best = f

    if best is None:
        return {
            "success": False,
            "model_path": None,
            "model_size_mb": None,
            "index_path": None,
            "error": (
                "Found .pth file(s) but none are valid trained models "
                "(too small, placeholder content, or created before training started)."
            ),
            "phases": phases,
        }

    # Find matching index
    index_files = list(log_path.glob("*.index"))
    index_path = str(index_files[0]) if index_files else None

    return {
        "success": True,
        "model_path": str(best),
        "model_size_mb": round(best.stat().st_size / (1024 * 1024), 3),
        "index_path": index_path,
        "error": None,
        "phases": phases,
    }
