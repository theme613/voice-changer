# Voice Changer App

A local-first desktop application that lets you upload a video/audio, automatically isolate vocals, preview the result, prepare a dataset for external training (Applio/RVC), and use the trained profile as a real-time voice changer via the W-Okada engine sidecar.

**All processing runs locally on your machine — no data is sent to the cloud.**

---

## Quick Start (Windows)

### Prerequisites

1. **Python 3.12+** — [Download](https://www.python.org/downloads/)
2. **Node.js 18+** — [Download](https://nodejs.org/)
3. **NVIDIA GPU** with CUDA support (GTX 1660 Ti or better recommended)
4. **W-Okada Voice Changer Engine** — Download and extract the MMVCServerSIO windows edition to a directory (configured in settings).
5. **Applio or RVC-Project** — External trainer software (configured in settings).

### Setup

```bash
# 1. Clone or download this project
cd voice-changer-app

# 2. Set up the Python backend
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
cd ..

# 3. Set up the React frontend
cd frontend
npm install
cd ..

# 4. Run the app
start.bat
```

Or run each server manually:

```bash
# Terminal 1: Backend
cd backend
venv\Scripts\activate
python -m uvicorn main:app --reload --port 8000

# Terminal 2: Frontend
cd frontend
npm run dev

# Terminal 3: W-Okada Sidecar
cd /path/to/MMVCServerSIO
.\MMVCServerSIO.exe -p 18888 --https false
```

Then open **http://localhost:5173** in your browser.

---

## How It Works

### Step 1: Upload & Extract
Drop video or audio files into the upload zone. The app uses **ffmpeg** to extract the audio tracks and convert them to standard WAV formats.

### Step 2: Vocal Isolation
The extracted audio is processed by **audio-separator**, which uses AI models (Demucs v4, MDX-Net, or BS-Roformer) to separate your voice from background music, game sounds, and other noise. You can preview the result and re-process with different settings if needed.

### Step 3: Dataset Preparation & External Training
Your cleaned vocal audio is automatically compiled into a formatted dataset folder. You can click a button to launch your configured **Applio** or **RVC** trainer, train the model externally for maximum stability, and then easily **Import** the resulting `.pth` and `.index` files back into the application.

### Step 4: Real-Time Voice Changer
The trained profile is loaded into the **W-Okada (MMVCServerSIO)** sidecar engine. The application communicates with the sidecar to start/stop the voice changer, adjust pitch, similarity (index rate), and audio device settings in real-time.

---

## Architecture

```
┌──────────────────┐       HTTP/REST        ┌──────────────────┐
│                  │ ◄───────────────────►  │                  │
│  React Frontend  │                        │  FastAPI Backend │
│  (localhost:5173)│                        │  (localhost:8000)│
│                  │                        │                  │
└──────────────────┘                        └────────┬─────────┘
                                                     │
                                  ┌──────────────────┼──────────────────┐
                                  │                  │                  │
                          ┌───────▼──────┐   ┌───────▼───────┐   ┌──────▼──────┐
                          │    ffmpeg    │   │audio-separator│   │   W-Okada   │
                          │  (extract/   │   │  (isolate)    │   │   Sidecar   │
                          │   format)    │   │               │   │ (inference) │
                          └──────────────┘   └───────────────┘   └─────────────┘
                                                     │
                                                     ▼
                                              External Trainer
                                                (Applio/RVC)
```

## Project Structure

```
voice-changer-app/
├── README.md                    ← You are here
├── start.bat                    ← One-click Windows launcher
├── backend/
│   ├── requirements.txt         ← Python dependencies
│   ├── main.py                  ← FastAPI app (API endpoints & lifecycle)
│   ├── audio_processor.py       ← ffmpeg + audio-separator pipeline
│   ├── trainer.py               ← Dataset prep & external profile import
│   ├── settings.py              ← Configuration manager
│   ├── diagnostics.py           ← System and health checks
│   └── voice_converter.py       ← W-Okada Sidecar HTTP client
├── frontend/
│   ├── package.json             ← Node dependencies
│   ├── index.html               ← Entry HTML
│   ├── vite.config.ts           ← Vite config (proxy to backend)
│   └── src/
│       ├── main.tsx             ← React entry point
│       ├── App.tsx              ← Dashboard routing
│       ├── index.css            ← Dark theme design system
│       ├── api.ts               ← Backend API client
│       └── components/
│           ├── UploadZone.tsx   ← Screen 1: upload & process
│           ├── PreviewPlayer.tsx ← Waveform audio player
│           ├── RegenerateModal.tsx ← Re-processing options
│           ├── TrainForm.tsx    ← Screen 2: dataset prep & import
│           ├── VoiceChanger.tsx ← Screen 3: real-time changer
│           ├── SettingsPage.tsx ← Config page (Paths, Devices, etc.)
│           ├── DiagnosticsPage.tsx ← System health and logs
│           └── Tooltip.tsx      ← Reusable "?" tooltips
├── models/                      ← Saved voice profiles (.pth + .index)
├── datasets/                    ← Formatted datasets for training
└── uploads/                     ← Temporary upload storage
```

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/upload` | POST | Upload video/audio file |
| `/api/upload_audio` | POST | Upload multiple direct audio clips |
| `/api/status/{job_id}` | GET | Processing status |
| `/api/preview/{job_id}` | GET | Stream isolated vocals |
| `/api/regenerate` | POST | Re-process with different settings |
| `/api/dataset/prepare` | POST | Compile vocals into a dataset folder |
| `/api/profile/import` | POST | Import a trained .pth / .index profile |
| `/api/trainer/open` | POST | Launch configured external trainer |
| `/api/profiles` | GET | List saved profiles |
| `/api/devices` | GET | List audio devices |
| `/api/convert/start` | POST | Start real-time conversion (via W-Okada) |
| `/api/convert/stop` | POST | Stop conversion |
| `/api/convert/status` | GET | Conversion status + levels |
| `/api/convert/settings` | POST | Update settings live |
| `/api/convert/test` | POST | Test with sample clip |
| `/api/settings` | GET/PUT | Read/Update application configuration |
| `/api/diagnostics` | GET | Comprehensive system health check |
| `/api/logs` | GET | Stream backend application logs |
| `/api/health` | GET | Basic liveness check |

Interactive API docs available at **http://localhost:8000/docs** when the backend is running.

---

## Virtual Audio Cable (for Discord/Games)

To use the voice changer with Discord, games, or other apps:

1. Install **VB-CABLE** (free): https://vb-audio.com/Cable/
2. In the Voice Changer app, set **Output** to "CABLE Input (VB-Audio Virtual Cable)"
3. In Discord/game, set your **microphone** to "CABLE Output (VB-Audio Virtual Cable)"

This routes your converted voice through the virtual cable into other apps.

---

## Troubleshooting

| Issue | Solution |
|---|---|
| "No GPU detected" | Install CUDA Toolkit 12.x and restart |
| Audio stream errors | Ensure W-Okada sidecar is running and responding on port 18888 |
| Sidecar Not Connected | Verify `MMVCServerSIO.exe` path in Settings and restart engine |
| Model download hangs | First-time download of audio-separator models (~800 MB). Be patient. |

---

## Tech Stack

- **Frontend**: React + TypeScript + Vite
- **Backend**: Python 3.12 + FastAPI + HTTPX
- **Audio Processing**: ffmpeg, audio-separator (Demucs/MDX-Net)
- **Voice Conversion**: W-Okada MMVCServerSIO (Real-time Inference Sidecar)
- **Voice Training**: External Applio / RVC-Project 
- **UI**: wavesurfer.js, framer-motion, lucide-react
