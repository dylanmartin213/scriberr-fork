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

---

## [deployed] Fix WhisperX init on NFS-backed mounts

**Problem**: On container restart, `PrepareEnvironment` called `git clone` into
`whisperx-env/WhisperX` even though the directory already existed on the NAS from the
previous run. Git exited 128 and WhisperX failed to initialize.

**Files changed**: `internal/transcription/adapters/whisperx_adapter.go`

**Fix**: Skip `cloneWhisperX()` if the directory already exists; `uvSync` still runs
to set up the venv if needed.

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
