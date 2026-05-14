# Scriberr Architecture

Upstream: https://github.com/rishikanthc/scriberr — branch `homelab` tracks `upstream/main`.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Go 1.24, Gin HTTP framework |
| ORM / DB | GORM + SQLite |
| Frontend | React + TypeScript (Vite), embedded in binary |
| ML runtime | Python 3.11 via `uv`, invoked as subprocesses |
| Container | Multi-stage Docker (Node → Go → Python slim) |

## Repository Layout

```
cmd/
  server/main.go         — binary entrypoint, wires everything together
  scriberr-cli/main.go   — companion CLI (watch-mode, upload, etc.)
internal/
  api/                   — Gin handlers (handlers.go) + router.go
  auth/                  — JWT + bcrypt user auth
  audio/                 — .aup parser, audio merger
  cli/                   — CLI client/service/login logic
  config/config.go       — env-var config (no files other than .env)
  database/database.go   — GORM init, migrations
  dropzone/dropzone.go   — fsnotify watcher; auto-ingests files dropped into data/dropzone/
  interfaces/            — Go interfaces for processor, queue, auth
  llm/                   — Ollama + OpenAI LLM clients
  models/                — GORM models (see Data Models below)
  processing/            — multi-track merger
  queue/queue.go         — in-process background task queue (2 workers)
  repository/            — data access layer (JobRepo, UserRepo, APIKeyRepo, …)
  service/               — FileService (file I/O), UserService
  sse/broadcaster.go     — Server-Sent Events hub for real-time job status
  transcription/         — unified processor + adapter registry
    adapters/            — WhisperX, Parakeet, Canary, Voxtral, OpenAI, PyAnnote, Sortformer
    pipeline/            — pipeline orchestration
    registry/            — adapter registration (called at startup)
  web/static.go          — serves embedded React dist
pkg/
  downloader/            — yt-dlp wrapper (YouTube ingestion)
  logger/                — structured logger + Gin middleware
  middleware/            — auth (JWT/API-key), compression, no-compression
web/frontend/            — React source (built into internal/web/dist at Docker build time)
```

## Data Models (SQLite via GORM)

| Model | Purpose |
|-------|---------|
| `TranscriptionJob` | Central record; ID = primary key (was UUID, see CHANGES.md) |
| `WhisperXParams` | Embedded struct inside TranscriptionJob; all transcription tuning knobs |
| `User` | Auth; stores bcrypt password, default profile ID, auto-transcription flag |
| `APIKey` | External API access tokens |
| `TranscriptionProfile` | Named presets of WhisperXParams |
| `LLMConfig` | Ollama/OpenAI endpoint + API key |
| `ChatSession` / `ChatMessage` | Per-transcript chat history |
| `SpeakerMapping` | Custom display names for diarization speakers |
| `MultiTrackFile` | Individual tracks in a multi-track recording |
| `TranscriptionJobExecution` | Timing metadata per execution run |

## Job Lifecycle

```
Upload (POST /api/v1/transcription/upload)
  └─ fileService.SaveUpload() → saves audio file to UPLOAD_DIR
  └─ derives jobID from filename (no extension)
  └─ creates TranscriptionJob{status: "uploaded"} in SQLite

Submit (POST /api/v1/transcription/:id/start  OR  auto via profile)
  └─ sets status → "pending"
  └─ enqueues jobID into TaskQueue

TaskQueue (2 goroutine workers)
  └─ UnifiedJobProcessor.ProcessJob(jobID)
     └─ looks up job → picks adapter from registry
     └─ spawns Python subprocess via uv
     └─ streams logs → SSE broadcaster
     └─ writes transcript JSON to TRANSCRIPTS_DIR
     └─ sets status → "completed" / "failed"

Client
  └─ SSE (GET /api/v1/events/) for live status
  └─ GET /api/v1/transcription/:id/transcript for result
```

## Transcription Adapters

Registered at startup in `cmd/server/main.go::registerAdapters()`:

| Adapter | Model | Hardware | Env path |
|---------|-------|----------|----------|
| `whisperx` | WhisperX (configurable size) | CPU | `WHISPERX_ENV/` |
| `parakeet` | NVIDIA Parakeet | GPU (CUDA) | `WHISPERX_ENV/parakeet/` |
| `canary` | NVIDIA Canary | GPU (CUDA) | `WHISPERX_ENV/parakeet/` (shared) |
| `voxtral` | Mistral Voxtral | GPU | `WHISPERX_ENV/voxtral/` |
| `openai_whisper` | OpenAI Whisper API | Cloud | n/a |
| `pyannote` | PyAnnote diarization | CPU/GPU | `WHISPERX_ENV/pyannote/` |
| `sortformer` | NVIDIA Sortformer diarization | GPU | `WHISPERX_ENV/parakeet/` (shared) |

## Configuration (Environment Variables)

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8080` | HTTP listen port |
| `HOST` | `0.0.0.0` | HTTP listen address |
| `APP_ENV` | `development` | Controls CORS, secure cookies |
| `DATABASE_PATH` | `data/scriberr.db` | SQLite file |
| `JWT_SECRET` | auto-generated | JWT signing key |
| `UPLOAD_DIR` | `data/uploads` | Where audio files land |
| `TRANSCRIPTS_DIR` | `data/transcripts` | WhisperX output |
| `TEMP_DIR` | `data/temp` | Scratch space |
| `WHISPERX_ENV` | `data/whisperx-env` | Python venv + model cache |
| `SECURE_COOKIES` | `true` in prod | httponly cookie Secure flag |
| `OPENAI_API_KEY` | — | For OpenAI Whisper / chat |
| `HF_TOKEN` | — | Hugging Face token (PyAnnote) |

## Authentication

Two methods, both accepted on protected routes via `middleware.AuthMiddleware`:
- **JWT** (httponly cookie or `Authorization: Bearer …`): issued on `/api/v1/auth/login`, refreshed via `/api/v1/auth/refresh`
- **API Key** (`X-API-Key` header): managed at `/api/v1/api-keys/`

Account management routes (password/username change, CLI auth) require JWT only (`JWTOnlyMiddleware`).

## Docker Build

Three stages:
1. **ui-builder** (`node:20-alpine`) — `npm ci && npm run build` in `web/frontend/`
2. **go-builder** (`golang:1.24-bookworm`) — `go build -o /out/scriberr cmd/server/main.go`, copies React dist into `internal/web/dist` before build (embedded via `//go:embed`)
3. **runtime** (`python:3.11-slim`) — copies binary + entrypoint; installs `uv`, `ffmpeg`, `yt-dlp`, `deno`

Go binary is statically compiled (`CGO_ENABLED=0`), so the runtime stage only needs Python/system deps.

## Dropzone

`internal/dropzone/dropzone.go` watches `data/dropzone/` with fsnotify.
- New audio file detected → calls same `uploadFile()` logic as HTTP handler
- After successful ingest, deletes the original from the dropzone folder
- If auto-transcription is enabled for any user, immediately enqueues the job

## Homelab Notes

See `scriberr-fork.md` for deployment context (ellington server, NAS volumes, NFS quirks).
See `CHANGES.md` for all modifications made in this fork.
