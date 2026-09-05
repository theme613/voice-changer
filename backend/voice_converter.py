"""
voice_converter.py — Real-Time Voice Conversion Engine

This module handles:
1. Loading a trained RVC voice profile into GPU memory
2. Running a real-time audio stream (mic → RVC → speakers)
3. Adjusting pitch, index rate, and gain on the fly
4. Providing level meters for the UI

Uses sounddevice for low-latency audio I/O and rvc-python for inference.
"""

import logging
import threading
import httpx
from typing import Optional, Dict, Any, List
from dataclasses import dataclass

logger = logging.getLogger(__name__)

SIDECAR_URL = "http://127.0.0.1:18888"

@dataclass
class ConversionSettings:
    profile_name: str = ""
    model_path: str = ""
    index_path: str = ""
    input_device: Optional[int] = None
    output_device: Optional[int] = None
    input_gain: float = 1.0
    output_gain: float = 1.0
    pitch_shift: int = 0
    index_rate: float = 0.75
    enabled: bool = True

class VoiceConverter:
    def __init__(self):
        self._settings = ConversionSettings()
        self._is_running = False
        self._lock = threading.Lock()

    def _check_sidecar(self):
        """Ensure sidecar is reachable and is the correct service."""
        try:
            resp = httpx.get(f"{SIDECAR_URL}/info", timeout=2.0)
            
            if resp.status_code == 404:
                logger.error(f"Sidecar returned 404 for /info. Port is occupied by an incompatible service.")
                raise RuntimeError("Port 18888 is occupied by an incompatible service.")
                
            resp.raise_for_status()
            data = resp.json()
            
            if "status" not in data or "modelSlotIndex" not in data:
                logger.error("Sidecar /info returned unexpected data format. Incompatible service.")
                raise RuntimeError("Port 18888 is occupied by an incompatible service.")
                
            return data
        except httpx.RequestError as e:
            logger.error(f"Sidecar unreachable: {e}")
            raise RuntimeError("Voice conversion engine is not running.")
        except httpx.HTTPStatusError as e:
            logger.error(f"Sidecar HTTP error: {e}")
            raise RuntimeError("Voice conversion engine is not running.")

    def _upload_file_to_engine(self, file_path: str) -> str:
        """Uploads a single file to the engine via chunking and concat."""
        import os
        filename = os.path.basename(file_path)
        with open(file_path, "rb") as f:
            data = f.read()
            
        chunk_size = 1048576
        chunks = [data[i:i+chunk_size] for i in range(0, len(data), chunk_size)]
        
        logger.info(f"Uploading {filename} to sidecar in {len(chunks)} chunks...")
        for i, chunk in enumerate(chunks):
            files = {'file': ('blob', chunk, 'application/octet-stream')}
            data_params = {'filename': f'{filename}_{i}'}
            resp = httpx.post(f"{SIDECAR_URL}/upload_file", data=data_params, files=files, timeout=10.0)
            resp.raise_for_status()

        resp = httpx.post(
            f"{SIDECAR_URL}/concat_uploaded_file", 
            data={'filename': filename, 'filenameChunkNum': str(len(chunks))},
            timeout=10.0
        )
        resp.raise_for_status()
        return filename

    def upload_profile_to_engine(self, model_path: str, index_path: str = "", slot: int = 1) -> bool:
        """Uploads .pth and .index files to the engine and configures them in a slot."""
        self._check_sidecar()
        import os
        import json
        
        try:
            # Upload .pth
            if not model_path or not os.path.exists(model_path):
                raise FileNotFoundError(f"Model file not found: {model_path}")
                
            model_filename = self._upload_file_to_engine(model_path)
            
            # Upload .index if available
            index_filename = ""
            if index_path and os.path.exists(index_path):
                index_filename = self._upload_file_to_engine(index_path)

            # Register to slot
            files_list = [{'name': model_filename, 'kind': 'rvcModel', 'dir': ''}]
            if index_filename:
                files_list.append({'name': index_filename, 'kind': 'rvcIndex', 'dir': ''})
                
            load_params = {
                'voiceChangerType': 'RVC',
                'slot': slot,
                'isSampleMode': False,
                'sampleId': '',
                'files': files_list,
                'params': {}
            }
            
            resp = httpx.post(
                f"{SIDECAR_URL}/load_model", 
                data={'slot': slot, 'isHalf': 'false', 'params': json.dumps(load_params)},
                timeout=15.0
            )
            resp.raise_for_status()
            logger.info(f"Successfully loaded profile into engine slot {slot}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to upload profile to engine: {e}")
            raise RuntimeError(f"Failed to register profile on engine: {e}")

    def load_profile(self, model_path: str, index_path: str = "") -> bool:
        """Uploads profile to slot 1 and sets the active model to slot 1."""
        self._settings.model_path = model_path
        self._settings.index_path = index_path
        
        # 1. Upload to Slot 1
        self.upload_profile_to_engine(model_path, index_path, slot=1)
        
        # 2. Set active slot to 1
        import urllib.parse
        try:
            data = urllib.parse.urlencode({'key': 'modelSlotIndex', 'val': '1'})
            headers = {'Content-Type': 'application/x-www-form-urlencoded'}
            resp = httpx.post(f"{SIDECAR_URL}/update_settings", content=data, headers=headers, timeout=5.0)
            resp.raise_for_status()
            return True
        except Exception as e:
            logger.error(f"Failed to activate slot 1: {e}")
            raise RuntimeError(f"Engine rejected slot activation: {e}")

    def start(
        self,
        input_device: Optional[int] = None,
        output_device: Optional[int] = None,
        settings: Optional[Dict[str, Any]] = None,
    ) -> bool:
        self._check_sidecar()
        
        if settings:
            self.update_settings(settings)
            
        try:
            import urllib.parse
            headers = {'Content-Type': 'application/x-www-form-urlencoded'}

            if input_device is not None:
                d = urllib.parse.urlencode({'key': 'serverInputDeviceId', 'val': str(input_device)})
                httpx.post(f"{SIDECAR_URL}/update_settings", content=d, headers=headers, timeout=3.0)
            if output_device is not None:
                d = urllib.parse.urlencode({'key': 'serverOutputDeviceId', 'val': str(output_device)})
                httpx.post(f"{SIDECAR_URL}/update_settings", content=d, headers=headers, timeout=3.0)

            # Request sidecar to start audio processing
            data = urllib.parse.urlencode({'key': 'serverAudioStated', 'val': '1'})
            resp = httpx.post(f"{SIDECAR_URL}/update_settings", content=data, headers=headers, timeout=3.0)
            
            if resp.status_code >= 400:
                logger.warning(f"Failed to start conversion on sidecar (Status {resp.status_code}): {resp.text}")
                raise RuntimeError(f"Failed to start conversion. Engine status: {resp.status_code}")
                
            self._is_running = True
            return True
        except httpx.RequestError as e:
            logger.error(f"Failed to start conversion: {e}")
            raise RuntimeError("Voice conversion engine is not running.")

    def stop(self):
        try:
            import urllib.parse
            headers = {'Content-Type': 'application/x-www-form-urlencoded'}
            data = urllib.parse.urlencode({'key': 'serverAudioStated', 'val': '0'})
            resp = httpx.post(f"{SIDECAR_URL}/update_settings", content=data, headers=headers, timeout=3.0)
            if resp.status_code >= 400:
                 logger.warning(f"Error stopping sidecar conversion (Status {resp.status_code}): {resp.text}")
        except httpx.RequestError as e:
            logger.warning(f"Error stopping sidecar conversion: {e}")
        self._is_running = False

    def update_settings(self, settings: Dict[str, Any]):
        with self._lock:
            import urllib.parse
            headers = {'Content-Type': 'application/x-www-form-urlencoded'}
            payloads = []
            
            if "pitch_shift" in settings:
                self._settings.pitch_shift = int(settings["pitch_shift"])
                payloads.append({'key': 'tune', 'val': str(self._settings.pitch_shift)})
            if "index_rate" in settings:
                self._settings.index_rate = float(settings["index_rate"])
                payloads.append({'key': 'indexRatio', 'val': str(self._settings.index_rate)})
            if "input_device" in settings:
                payloads.append({'key': 'serverInputDeviceId', 'val': str(settings["input_device"])})
            if "output_device" in settings:
                payloads.append({'key': 'serverOutputDeviceId', 'val': str(settings["output_device"])})
                
            for p in payloads:
                try:
                    data = urllib.parse.urlencode(p)
                    httpx.post(f"{SIDECAR_URL}/update_settings", content=data, headers=headers, timeout=2.0)
                except httpx.RequestError as e:
                    logger.warning(f"Failed to push settings to sidecar: {e}")

    def get_status(self) -> Dict[str, Any]:
        return {
            "is_running": self._is_running,
            "input_level": 0.0,
            "output_level": 0.0,
            "settings": {
                "profile_name": self._settings.profile_name,
                "input_gain": self._settings.input_gain,
                "output_gain": self._settings.output_gain,
                "pitch_shift": self._settings.pitch_shift,
                "index_rate": self._settings.index_rate,
                "enabled": self._settings.enabled,
            },
        }

    def test_with_sample(self, sample_path: str, output_path: str) -> str:
        raise RuntimeError("Sample testing is currently unsupported with the sidecar API.")

def list_audio_devices() -> Dict[str, List[Dict[str, Any]]]:
    # Query devices from sounddevice locally
    try:
        import sounddevice as sd
        devices = sd.query_devices()
        default_input = sd.default.device[0]
        default_output = sd.default.device[1]
        
        result = {"input": [], "output": []}
        for dev in devices:
            # We want to use the index given by sounddevice
            idx = dev.get("index", devices.index(dev))
            is_default_in = (idx == default_input)
            is_default_out = (idx == default_output)
            
            if dev.get("max_input_channels", 0) > 0:
                result["input"].append({
                    "id": idx,
                    "name": dev["name"],
                    "channels": dev.get("max_input_channels", 1),
                    "sample_rate": dev.get("default_samplerate", 44100.0),
                    "is_default": is_default_in
                })
            
            if dev.get("max_output_channels", 0) > 0:
                result["output"].append({
                    "id": idx,
                    "name": dev["name"],
                    "channels": dev.get("max_output_channels", 2),
                    "sample_rate": dev.get("default_samplerate", 44100.0),
                    "is_default": is_default_out
                })
        return result
    except Exception as e:
        logger.error(f"Failed to fetch devices locally: {e}")
        return {"input": [], "output": []}

_converter = VoiceConverter()

def get_converter() -> VoiceConverter:
    return _converter
