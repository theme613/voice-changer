import os
import json
import logging
import copy
from pathlib import Path
from typing import Any, Dict

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = PROJECT_ROOT / "config.json"

DEFAULT_MODELS_DIR = str(PROJECT_ROOT / "models" / "vocal")

DEFAULT_SETTINGS = {
    "general": {
        "theme": "dark",
        "detailed_logs": True,
        "auto_check_files": True,
    },
    "paths": {
        "models_dir": DEFAULT_MODELS_DIR,
        "profiles_dir": str(PROJECT_ROOT / "models" / "profiles"),
        "datasets_dir": str(PROJECT_ROOT / "datasets"),
        "temp_dir": str(PROJECT_ROOT / "uploads"),
        "logs_dir": str(PROJECT_ROOT / "logs"),
        "engine_dir": str(PROJECT_ROOT / "engine" / "voice-changer" / "MMVCServerSIO"),
        "ffmpeg_path": "",
        "external_trainer_path": "",
    },
    "performance": {
        "device": "auto",  # auto, cuda, cpu
        "quality_preset": "balanced",
        "batch_size": 8,
        "fp16": True,
        "chunk_size": 128,
    },
    "ports": {
        "backend": 8000,
        "sidecar": 18888,
    },
    "audio": {
        "sample_rate": 44100,
        "buffer_size": 1024,
        "input_device": -1,
        "output_device": -1,
    },
    "advanced": {
        "log_level": "INFO",
    }
}

class SettingsManager:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(SettingsManager, cls).__new__(cls)
            cls._instance.config = cls._instance._load()
            cls._instance._ensure_dirs()
        return cls._instance

    def _load(self) -> Dict[str, Any]:
        if not CONFIG_PATH.exists():
            self._save_raw(DEFAULT_SETTINGS)
            return DEFAULT_SETTINGS
        
        try:
            with open(CONFIG_PATH, "r") as f:
                data = json.load(f)
                
            # Deep merge with defaults so missing keys are populated
            merged = self._deep_merge(copy.deepcopy(DEFAULT_SETTINGS), data)
            return merged
        except Exception as e:
            logger.error(f"Failed to load config.json: {e}. Using defaults.")
            return DEFAULT_SETTINGS

    def _deep_merge(self, base: Dict, update: Dict) -> Dict:
        for key, val in update.items():
            if isinstance(val, dict) and key in base and isinstance(base[key], dict):
                base[key] = self._deep_merge(base[key], val)
            else:
                base[key] = val
        return base

    def _save_raw(self, data: Dict[str, Any]):
        try:
            with open(CONFIG_PATH, "w") as f:
                json.dump(data, f, indent=4)
        except Exception as e:
            logger.error(f"Failed to save config.json: {e}")

    def _ensure_dirs(self):
        """Ensure all required directory paths exist. Skip file/external paths."""
        # These keys point to files or user-managed folders — do not auto-create them
        skip_keys = {"external_trainer_path", "ffmpeg_path"}
        for name, path_str in self.config.get("paths", {}).items():
            if name in skip_keys or not path_str:
                continue
            try:
                Path(path_str).mkdir(parents=True, exist_ok=True)
            except Exception as e:
                logger.error(f"Failed to create directory {path_str}: {e}")

    def get_all(self) -> Dict[str, Any]:
        return self.config

    def update(self, category: str, key: str, value: Any):
        if category not in self.config:
            self.config[category] = {}
        self.config[category][key] = value
        self._save_raw(self.config)
        self._ensure_dirs()

    def update_all(self, new_config: Dict[str, Any]):
        self.config = self._deep_merge(self.config, new_config)
        self._save_raw(self.config)
        self._ensure_dirs()

    def get(self, category: str, key: str, default: Any = None) -> Any:
        return self.config.get(category, {}).get(key, default)

    def get_path(self, key: str) -> Path:
        """Helper to safely retrieve a path."""
        path_str = self.config.get("paths", {}).get(key)
        if not path_str:
            path_str = DEFAULT_SETTINGS["paths"].get(key, str(PROJECT_ROOT))
        return Path(path_str)

settings = SettingsManager()
