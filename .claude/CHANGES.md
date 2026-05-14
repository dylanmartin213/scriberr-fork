# Homelab Changes

All modifications from the upstream Scriberr codebase.
Upstream: https://github.com/rishikanthc/scriberr

---

## How to merge upstream updates

```bash
git fetch upstream
git checkout readability-and-tags
git merge upstream/main
# resolve any conflicts, then:
git commit && git push origin readability-and-tags
```

The patches in this file document what to watch for when merging:
- `internal/service/file_service.go` — SaveUpload filename logic
- `internal/dropzone/dropzone.go` — uploadFile filename logic
- `internal/transcription/adapters/whisperx_adapter.go` — WhisperX clone guard
- `cmd/server/main.go` — registerAdapters: only openai_whisper registered (no local adapters)
- `Dockerfile` — runtime is debian:bookworm-slim, no Python/uv/ML build deps
- `internal/transcription/unified_service.go` — default model is openai_whisper; diarization failure is non-fatal
- `web/frontend/src/components/transcription/TranscriptionConfigDialog.tsx` — OpenAI-only UI, no local model options

---

## [deployed] Fix WhisperX init on NFS-backed mounts

**Problem**: On container restart, `PrepareEnvironment` called `git clone` into
`whisperx-env/WhisperX` even though the directory already existed on the NAS from the
previous run. Git exited 128 and WhisperX failed to initialize.

**Files changed**: `internal/transcription/adapters/whisperx_adapter.go`

**Fix**: Skip `cloneWhisperX()` if the directory already exists; `uvSync` still runs
to set up the venv if needed.

---

## [pending deploy] External-only transcription mode (OpenAI only)

**Problem**: Upstream registers 7 adapters (whisperx, parakeet, canary, voxtral, openai_whisper,
pyannote, sortformer). Local adapters require a Python runtime, model downloads (~GB), and
GPU/CPU resources not suitable for the homelab NAS.

**Files changed**:
- `cmd/server/main.go` — `registerAdapters()` now registers only `openai_whisper`; removed
  all local adapter registrations + associated env path variables; removed unused `path/filepath` import
- `Dockerfile` — runtime stage changed from `python:3.11-slim` to `debian:bookworm-slim`;
  removed Python, uv, build-essential, gcc, g++, make, python3-dev, git; kept ffmpeg, ca-certs,
  curl, gosu, unzip, yt-dlp, deno; removed `PYTHONUNBUFFERED` and `WHISPERX_ENV` env vars
- `internal/transcription/unified_service.go` — `selectModels()` default fallback changed
  from `ModelWhisperX` to `ModelOpenAI`; diarization adapter failure changed from fatal error
  to warning log + skip (graceful degradation when no diarization adapter registered)
- `internal/models/transcription.go` — `ModelFamily` GORM default changed from `'whisper'`
  to `'openai'`; `Model` default changed from `'small'` to `'whisper-1'`
- `web/frontend/src/components/transcription/TranscriptionConfigDialog.tsx` — default params
  updated; model family selector removed (only OpenAI shown directly); removed `WhisperConfig`,
  `ParakeetConfig`, `CanaryConfig`, `VoxtralConfig`, `DiarizationSection` components and
  their associated constants (`WHISPER_MODELS`, `CANARY_LANGUAGES`, `PARAM_DESCRIPTIONS`)

**Note**: If user enables diarization in the UI and submits, the backend will log a warning
and skip diarization rather than failing the job. Diarization is unavailable in external-only mode.

---

## [pending deploy] Tag filter fix, z-index fix, tags in Record Audio dialog

### Tag filter subquery fix
`internal/repository/implementations.go` (`ListWithParams`): replaced the manual
`JOIN job_tags JOIN tags` with a `WHERE id IN (subquery)` approach. The old JOIN
could produce ambiguous `ORDER BY created_at` in SQLite and conflicted with `Preload("Tags")`.
The subquery approach is unambiguous and definitely correct.

### Tag popover z-index fix
`web/frontend/src/features/transcription/components/AudioDetailView.tsx`: added `relative z-[1]`
to the title card div. The title card and audio player are siblings inside a sticky `z-10` container.
Both create stacking contexts via `backdrop-blur-lg`. The audio player (later in DOM) was painting
on top of the title card's popover. `z-[1]` on the title card raises its stacking context above the
audio player's stacking context (which has no explicit z-index = auto = 0).

### Tags in Record Audio dialog
`web/frontend/src/components/AudioRecorder.tsx`: added tag multi-select UI (pills) before
the mic selector. Selected tags are passed to `onRecordingComplete`.

`web/frontend/src/components/Header.tsx`: forwarded `tagIds: number[]` from AudioRecorder
to `effectiveRecordingComplete`.

`web/frontend/src/contexts/GlobalUploadContext.tsx`: `handleRecordingComplete` now accepts
optional `tagIds?: number[]`. When tags are provided, the recording is uploaded directly
(bypassing `handleFileSelect`'s progress UI) to get back the job ID, then tags are applied
via POST to `/api/v1/transcription/{id}/tags`.

---

## [pending deploy] Tags, YYMMDD filenames, PWA black bar, rename-syncs-file

### PWA theme color
`web/frontend/vite.config.ts`: `theme_color` and `background_color` changed from purple
(`#8936FF`) / teal (`#2EC6FE`) to black (`#000000`). Fixes the purple Android PWA top bar.

### YYMMDD date prefix on uploaded filenames
`internal/service/file_service.go` (`SaveUpload`) and `internal/dropzone/dropzone.go`
(`uploadFile`): new files are now stored as `260514_-_originalname.ext` on the NAS.
The date prefix is `time.Now().Format("060102")`. Merge conflict area: same two functions.

### Rename in UI renames the file on disk
`internal/api/handlers.go` (`UpdateTranscriptionTitle`): after updating the `Title` field
in DB, the handler also renames the audio file to `YYMMDD_-_{sanitizedTitle}.ext` using
`job.CreatedAt` for the date prefix. `audio_path` is updated in DB too. Rename is
best-effort (non-fatal if file is missing). Added `sanitizeFilenameForPath()` helper
(identical rules to `sanitizeFilename` in file_service).

### Tags feature
Full many-to-many tag system. Watch these files on upstream merge:

**Backend** (all new, low conflict risk):
- `internal/models/transcription.go` — `Tag` struct + `Tags []Tag` on `TranscriptionJob`
- `internal/database/database.go` — `&models.Tag{}` in AutoMigrate list
- `internal/repository/implementations.go` — `TagRepository` interface + impl;
  `ListWithParams` and `FindWithAssociations` now preload `Tags`; `ListWithParams`
  signature has a new `tagFilter string` trailing param (update mocks in tests too)
- `internal/api/handlers.go` — `tagRepo` field on `Handler`; `ListTags`, `CreateTag`,
  `DeleteTag`, `GetJobTags`, `AddTagToJob`, `RemoveTagFromJob` handlers;
  `ListTranscriptionJobs` reads `?tag=` query param
- `internal/api/router.go` — `/api/v1/tags/` routes + `/:id/tags` sub-routes
- `cmd/server/main.go` — `tagRepo` wired into `NewHandler`

**Frontend** (all new):
- `useAudioFiles.ts` — `Tag` type, `tags` on `AudioFile`, `useAudioListInfinite` passes
  `tag` param; `useTags`, `useCreateTag`, `useDeleteTag`, `useAddTagToJob`,
  `useRemoveTagFromJob` hooks
- `useAudioDetail.ts` — `tags` field on `AudioFile` detail type; imports `Tag` from
  `useAudioFiles`
- `AudioFilesTable.tsx` — tag filter chips in toolbar; tag pills on each recording card
- `AudioDetailView.tsx` — inline tag management (add/remove with popover + create new)

---

## [deployed] Preserve original filenames on upload

**Problem**: Scriberr renames every uploaded file to a UUID on disk
(`8bfddc16-9021-40bc-b14d-6017c4589783.webm`). The original filename is stored only in
SQLite. The NAS Recordings folder shows unreadable UUID names.

**Files changed**:
- `internal/service/file_service.go` — `SaveUpload()`
- `internal/dropzone/dropzone.go` — `uploadFile()`

**Approach**: Replace UUID generation with original-filename preservation.
Sanitize the name (spaces → underscores), then use a counter suffix (`name-1.mp3`,
`name-2.mp3`) for collisions. The `jobID` in all callers is derived from the final
filename by stripping the extension — this continues to work correctly because all
handlers use `filepath.Base(filePath)` minus extension as the job ID.

**jobID length note**: The `TranscriptionJob.ID` column is annotated `type:varchar(36)`
(UUID length), but SQLite does not enforce VARCHAR length limits, so longer
filename-derived IDs are stored without truncation.

**Multi-track upload** (`UploadMultiTrack` handler) generates its own UUID for the
parent job (unchanged). Individual track files saved via `fileService.SaveUpload()` into
a job-specific subdirectory will now use original track filenames — that is correct
behavior since the track's `FileName` field is used as the speaker label.

---

## Build / deployment

See `scriberr-fork.md` for the full Dockerfile and Gitea registry push workflow.
Image is pushed to `git.dylanamadeus.com/dylan/scriberr:patched` and used by the
Portainer stack on ellington (192.168.2.152).
