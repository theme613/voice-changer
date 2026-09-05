import json
import logging
import os
from pathlib import Path

import requests
from tqdm import tqdm

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).parent.parent
CONFIG_PATH = Path(__file__).parent / "required_files.json"

def download_file(url: str, dest_path: str | Path, size_mb: float = None):
    """
    Download a file with progress bar.
    Retry up to 3 times if download fails.
    """
    dest_path = Path(dest_path)
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    
    for attempt in range(3):
        try:
            response = requests.get(url, stream=True)
            response.raise_for_status()
            
            total_size = int(response.headers.get('content-length', 0))
            chunk_size = 8192
            
            with open(dest_path, 'wb') as f, tqdm(
                desc=os.path.basename(dest_path),
                total=total_size,
                unit='B',
                unit_scale=True,
                unit_divisor=1024,
            ) as bar:
                for chunk in response.iter_content(chunk_size):
                    if chunk:
                        f.write(chunk)
                        bar.update(len(chunk))
            
            print(f"✓ Downloaded {os.path.basename(dest_path)}")
            return  # Success, exit retry loop
            
        except Exception as e:
            print(f"Download failed (attempt {attempt + 1}/3): {e}")
            if attempt == 2:
                print(f"\n❌ Failed to download: {os.path.basename(dest_path)}")
                print("\nPossible fixes:")
                print("1. Check your internet connection")
                print("2. Disable firewall/antivirus temporarily")
                print(f"3. Download manually from: {url}")
                print(f"   Then place it in: {dest_path}\n")
                raise Exception(f"Failed to download {dest_path} after 3 attempts")


def ensure_all_files_exist():
    """
    Check all required files. If missing, download and install them.
    Show progress bar for each download.
    """
    if not CONFIG_PATH.exists():
        logger.warning(f"Configuration file not found at {CONFIG_PATH}. Skipping download check.")
        return

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config = json.load(f)

    all_files = []
    for category, files in config.items():
        all_files.extend(files)

    for file_info in all_files:
        if not file_info.get("required", True):
            continue
            
        # Resolve path relative to project root
        dest_path = PROJECT_ROOT / file_info["path"]
        
        if not dest_path.exists():
            print(f"Downloading {file_info['name']}...")
            download_file(file_info["url"], dest_path, file_info.get("size_mb"))
        else:
            print(f"✓ {file_info['name']} already exists")


def get_voice_model(model_name: str, url: str) -> Path:
    """
    Load voice model. If missing, download on-demand.
    """
    model_path = PROJECT_ROOT / "models" / "voices" / f"{model_name}.pth"
    
    if not model_path.exists():
        print(f"Voice model '{model_name}' not found. Downloading...")
        download_file(url, model_path)
    
    return model_path
