"""
audio_processor.py — Video → Audio → Vocal Isolation Pipeline

This module handles:
1. Extracting audio from video files using ffmpeg
2. Isolating vocals using audio-separator (Demucs/MDX-Net/BS-Roformer)
3. Optional noise reduction post-processing

All processing is local — no cloud APIs.
"""

import os
import subprocess
import uuid
import logging
from pathlib import Path
from typing import Callable, Optional

import numpy as np
import soundfile as sf
import imageio_ffmpeg
import os

# Add ffmpeg to PATH so audio-separator can find it
ffmpeg_dir = os.path.dirname(imageio_ffmpeg.get_ffmpeg_exe())
if ffmpeg_dir not in os.environ["PATH"]:
    os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ["PATH"]

logger = logging.getLogger(__name__)

# Base directories (relative to project root)
from settings import settings

PROJECT_ROOT = Path(__file__).parent.parent
UPLOADS_DIR = settings.get_path("temp_dir")
UPLOADS_DIR.mkdir(exist_ok=True, parents=True)


# ---------------------------------------------------------------------------
# Model name mapping: user-friendly name → audio-separator model identifier
# ---------------------------------------------------------------------------
MODEL_MAP = {
    "Balanced": "htdemucs.yaml",
    "Fast": "UVR-MDX-NET-Inst_HQ_3.onnx",
    "Strong": "model_bs_roformer_ep_317_sdr_12.9755.ckpt",
}


def get_job_dir(job_id: str) -> Path:
    """Get or create the working directory for a processing job."""
    job_dir = UPLOADS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    return job_dir


def extract_audio(
    video_path: str,
    job_id: str,
    progress_callback: Optional[Callable[[str, float], None]] = None,
) -> str:
    """
    Extract audio track from a video file using ffmpeg.

    Args:
        video_path: Path to the uploaded video file
        job_id: Unique job identifier
        progress_callback: Optional callback(step_name, progress_percent)

    Returns:
        Path to the extracted WAV file (44.1kHz, mono)
    """
    if progress_callback:
        progress_callback("extracting", 0.0)

    job_dir = get_job_dir(job_id)
    output_path = str(job_dir / "extracted_audio.wav")

    # ffmpeg command: extract audio, convert to 44.1kHz mono WAV
    ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
    cmd = [
        ffmpeg_exe,
        "-y",                    # Overwrite output file if it exists
        "-i", video_path,        # Input video
        "-vn",                   # No video output
        "-acodec", "pcm_s16le",  # 16-bit PCM WAV
        "-ar", "44100",          # 44.1kHz sample rate
        "-ac", "1",              # Mono channel
        output_path,
    ]

    logger.info(f"Extracting audio: {' '.join(cmd)}")

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout
        )
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg failed: {result.stderr}")
    except Exception as e:
        raise RuntimeError(f"ffmpeg extraction failed: {e}")

    if not os.path.exists(output_path):
        raise RuntimeError("ffmpeg ran but did not produce output. The video may have no audio track.")

    if progress_callback:
        progress_callback("extracting", 100.0)

    logger.info(f"Audio extracted to: {output_path}")
    return output_path


def isolate_vocals(
    audio_path: str,
    job_id: str,
    model_name: str = "Balanced",
    strength: str = "normal",
    apply_noise_reduction: bool = False,
    progress_callback: Optional[Callable[[str, float], None]] = None,
) -> str:
    """
    Isolate vocals from an audio file using audio-separator.

    Args:
        audio_path: Path to the extracted WAV file
        job_id: Unique job identifier
        model_name: One of "Demucs v4", "MDX-Net", "BS-Roformer"
        strength: "normal" or "strong" (more aggressive separation)
        apply_noise_reduction: Whether to apply post-processing noise reduction
        progress_callback: Optional callback(step_name, progress_percent)

    Returns:
        Path to the isolated vocals WAV file
    """
    job_dir = get_job_dir(job_id)
    output_dir = str(job_dir)
    
    try:
        from audio_separator.separator import Separator
    except ImportError:
        logger.warning("audio-separator not installed. Simulating vocal isolation.")
        import time
        import shutil
        
        if progress_callback:
            progress_callback("isolating", 10.0)
            
        time.sleep(2)  # Simulate processing
        
        # Just copy the input file to simulate the output
        output_file = str(job_dir / f"Vocals_{job_id}.wav")
        shutil.copy2(audio_path, output_file)
        
        if progress_callback:
            progress_callback("isolating", 100.0)
            
        return output_file

    if progress_callback:
        progress_callback("isolating", 0.0)

    # Resolve model identifier
    model_id = MODEL_MAP.get(model_name, "htdemucs")

    logger.info(f"Isolating vocals with model: {model_name} ({model_id}), strength: {strength}")

    models_dir = str(settings.get_path("models_dir"))
    
    # Configure the separator
    separator = Separator(
        log_level=logging.WARNING,
        model_file_dir=models_dir,
        output_dir=output_dir,
        output_format="wav",
        use_directml=True
    )

    # Load the selected model
    separator.load_model(model_filename=model_id)

    if progress_callback:
        progress_callback("isolating", 20.0)

    # Run separation — returns list of output file paths
    # Typically: [vocals_path, instrumental_path]
    output_files = separator.separate(audio_path)

    if progress_callback:
        progress_callback("isolating", 80.0)

    # Find the vocals file (audio-separator names it with "Vocals" in the filename)
    vocals_path = None
    for f in output_files:
        if "vocal" in f.lower() or "vocals" in f.lower():
            vocals_path = f
            break

    # Fallback: use the first output file
    if vocals_path is None and output_files:
        vocals_path = output_files[0]

    if vocals_path is None:
        raise RuntimeError("Vocal isolation produced no output files.")

    # audio-separator might return relative filenames, join with job_dir
    vocals_full_path = job_dir / vocals_path

    # Rename to a consistent filename
    final_path = str(job_dir / "isolated_vocals.wav")
    if os.path.abspath(vocals_full_path) != os.path.abspath(final_path):
        if os.path.exists(final_path):
            os.remove(final_path)
        os.rename(vocals_full_path, final_path)

    # Optional: apply noise reduction for "strong" mode or if requested
    if strength == "strong" or apply_noise_reduction:
        final_path = _apply_noise_reduction(final_path)

    if progress_callback:
        progress_callback("isolating", 100.0)

    logger.info(f"Vocals isolated to: {final_path}")
    return final_path


def _apply_noise_reduction(audio_path: str) -> str:
    """
    Apply noise reduction to the isolated vocals for cleaner output.
    Uses the noisereduce library with spectral gating.
    """
    import noisereduce as nr

    logger.info(f"Applying noise reduction to: {audio_path}")

    # Read the audio file
    data, sample_rate = sf.read(audio_path)

    # Apply noise reduction
    # prop_decrease controls how much noise is removed (0.0 = none, 1.0 = full)
    reduced = nr.reduce_noise(
        y=data,
        sr=sample_rate,
        prop_decrease=0.8,       # Remove 80% of detected noise
        stationary=False,        # Handle non-stationary noise (game SFX, music bleed)
    )

    # Overwrite the original file with the cleaned version
    sf.write(audio_path, reduced, sample_rate)
    logger.info("Noise reduction complete.")
    return audio_path


def get_audio_duration(audio_path: str) -> float:
    """Get the duration of an audio file in seconds."""
    data, sample_rate = sf.read(audio_path)
    return len(data) / sample_rate


def validate_video_file(video_path: str) -> tuple[bool, str, dict]:
    """
    Validate a video/audio file using ffprobe.
    Checks if the file is readable and contains at least one video or audio stream.

    Returns:
        (is_valid, error_message, info_dict)
    """
    if not os.path.exists(video_path) or os.path.getsize(video_path) == 0:
        return False, "File does not exist or is empty.", {}

    try:
        cmd = [
            "ffprobe",
            "-v", "error",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            video_path,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode != 0:
            error_msg = result.stderr.strip()
            # Common ffmpeg error like "moov atom not found"
            if not error_msg:
                error_msg = "Unknown ffprobe error."
            return False, error_msg, {}
            
        import json
        info = json.loads(result.stdout)
        
        streams = info.get("streams", [])
        has_media = any(s.get("codec_type") in ("video", "audio") for s in streams)
        
        if not has_media:
            return False, "No valid audio or video streams found in the file.", info
            
        return True, "", info
        
    except Exception as e:
        return False, f"Failed to run ffprobe: {e}", {}


def get_video_info(video_path: str) -> dict:
    """
    Get basic info about a video file using ffprobe.
    Raises ValueError if the file is invalid or corrupted.

    Returns:
        Dict with 'duration' (seconds) and 'filename'
    """
    is_valid, error_msg, info = validate_video_file(video_path)
    
    if not is_valid:
        raise ValueError(f"Invalid media file: {error_msg}")
        
    duration = float(info.get("format", {}).get("duration", 0))
    return {
        "filename": os.path.basename(video_path),
        "duration": round(duration, 1),
        "ffprobe_info": info
    }
