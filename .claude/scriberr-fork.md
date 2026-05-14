# Scriberr Custom Build — Handoff Notes

## Goal

Build a custom Docker image of Scriberr that preserves original filenames for uploaded audio
files instead of renaming them to UUIDs. Push it to the Gitea container registry and update
the Portainer stack to use it.

---

## Wishlist

- Add a tagging feature when uploading audio notes

---

## Current Scriberr Setup (patched fork, as of 2026-05-14)

### What Scriberr Is

Scriberr (https://github.com/rishikanthc/scriberr) is a self-hosted audio transcription app.
It uses WhisperX, PyAnnote, and NVIDIA NeMo models for transcription and speaker diarization.

### Where It Runs

- **Server**: ellington (192.168.2.152), Ubuntu 24.04
- **Image**: `scriberr-fork:latest` (built locally on ellington from this repo)
- **External URL**: https://recorder.dylanamadeus.com (via Cloudflare Tunnel → cloudflared container on tunnelnet)
- **Internal URL**: http://192.168.2.152:8080

### Working docker run command

```bash
docker run -d --name scriberr \
  -p 8080:8080 \
  --network tunnelnet \
  --entrypoint /bin/sh \
  -v /nas/media/Scriberr/Recordings:/app/uploads \
  -v /nas/media/Scriberr/Models:/app/whisperx-env \
  -v scriberr_data:/app/data \
  -e DATABASE_PATH=/app/data/scriberr.db \
  -e UPLOAD_DIR=/app/uploads \
  scriberr-fork:latest \
  -c 'mkdir -p /app/data/transcripts /app/data/temp && exec /app/scriberr'
```

**Critical**: no `--user` flag. Container runs as root (process UID=0). Required because
Synology NFS ACLs block writes from non-root UIDs even on 777-permissioned directories.
Running as root lets the Go server write audio files to `/app/uploads` (NAS).

### Volume Layout

| Container path       | Host path                        | Type                | Purpose                        |
|----------------------|----------------------------------|---------------------|--------------------------------|
| `/app/data`          | `scriberr_data` Docker volume    | named volume        | SQLite DB, transcripts, temp   |
| `/app/whisperx-env`  | `/nas/media/Scriberr/Models`     | NFS bind mount      | ML model cache (~30-40 GB)     |
| `/app/uploads`       | `/nas/media/Scriberr/Recordings` | NFS bind mount      | Uploaded/recorded audio files  |

**Important**: mount models at `/app/whisperx-env` (not `/data/models`). That's the path
the Go server passes to all model adapters. Wrong path → full re-download on each container.

### Why the entrypoint is overridden

The stock `docker-entrypoint.sh` tries to `chown /app/whisperx-env` (the NFS models mount),
which fails with "Operation not permitted" (NFS root squash). The custom one-liner entrypoint
bypasses that entirely and runs the binary directly as root.

### Why root is required

Synology ACLs override POSIX 777 permissions for non-root UID processes accessing NFS.
Even `rwxrwxrwx 1026 users` directories block writes from UID 1000. Root (UID=0) is also
squashed to `nobody` on NFS by default, but Synology's own ACL layer still allows it.
Bottom line: only root can write recordings to the NAS from the Docker container.

### Volume Layout

| Container path       | Host path                        | Type            | Purpose                        |
|----------------------|----------------------------------|-----------------|--------------------------------|
| `/app/data`          | `/opt/docker/scriberr/data`      | local bind mount| SQLite DB, transcripts         |
| `/app/whisperx-env`  | `/nas/media/Scriberr/Models`     | NFS bind mount  | ML model cache (~30-40 GB)     |
| `/app/uploads`       | `/nas/media/Scriberr/Recordings` | NFS bind mount  | Uploaded/recorded audio files  |

### NAS Details

- **NAS**: Synology DS225+ (monk), IP 192.168.2.192
- **NFS share**: `/volume1/media` exported as NFS, mounted on ellington at `/nas/media`
- **Mount type**: NFSv3, `sec=sys`, `local_lock=none`, read-write
- **Scriberr folders on NAS**:
  - `/volume1/media/Scriberr/Models` — ML models (large, ~30-40 GB once fully downloaded)
  - `/volume1/media/Scriberr/Recordings` — audio recordings
- **Why models are on NAS**: ellington's local disk is only 96 GB. Scriberr downloads every
  model at startup regardless of hardware (including NVIDIA GPU models that won't run on
  ellington since it has no GPU). Total model size is 30-40 GB, which exhausted local disk.
  The NAS has 2.6 TB free.
- **Why SQLite DB is local**: SQLite cannot do proper file locking over NFS (SQLITE_IOERR_LOCK,
  error 4874). The database stays on ellington's local disk at `/opt/docker/scriberr/data/`.

### First-Boot Model Download

On first start, Scriberr downloads ALL models in parallel:
- WhisperX (CPU transcription, works on ellington)
- PyAnnote (speaker diarization)
- Sortformer (NVIDIA NeMo diarization, ~450 MB)
- Canary (NVIDIA NeMo transcription, ~5.9 GB)
- Parakeet + full PyTorch CUDA runtime (~5-10 GB, NVIDIA GPU only — won't run on ellington)

Total first-boot time: ~24 minutes. After that, all models are cached in the NAS Models
folder and subsequent restarts are fast.

---

## The Filename Problem

Scriberr renames every uploaded audio file to a UUID on disk:

```
8bfddc16-9021-40bc-b14d-6017c4589783.webm
```

The original filename is stored only in the SQLite database as the job's `Title`. The NAS
Recordings folder therefore shows unreadable UUID names. No config option exists to change
this — it is hardcoded in the Go source.

No existing forks or PRs address this. This would be a new patch.

---

## Code Changes Required

Scriberr is a Go application. The binary is compiled and baked into the Docker image.
Two source files need patching:

### 1. `internal/service/file_service.go`

The `SaveUpload()` method currently does:
```go
id := uuid.New().String()
ext := filepath.Ext(fileHeader.Filename)
filename := fmt.Sprintf("%s%s", id, ext)
```

Change it to use the original filename, with collision handling:
```go
originalName := filepath.Base(fileHeader.Filename)
// Sanitize: remove path separators, replace spaces
originalName = strings.ReplaceAll(originalName, " ", "_")
ext := filepath.Ext(originalName)
base := strings.TrimSuffix(originalName, ext)

filename := originalName
destPath := filepath.Join(uploadDir, filename)
counter := 1
for {
    if _, err := os.Stat(destPath); os.IsNotExist(err) {
        break
    }
    filename = fmt.Sprintf("%s-%d%s", base, counter, ext)
    destPath = filepath.Join(uploadDir, filename)
    counter++
}
```

The UUID `id` is also used as the `jobID` in the handler. After this change, the jobID
must be derived from the filename (strip extension from final filename). The rest of the
function and its callers should work unchanged since the jobID is just a unique string key.

### 2. `internal/dropzone/dropzone.go`

The `uploadFile()` function currently does:
```go
jobID := uuid.New().String()
ext := filepath.Ext(originalFilename)
filename := fmt.Sprintf("%s%s", jobID, ext)
destPath := filepath.Join(uploadDir, filename)
```

Apply the same collision-safe original-filename logic as above. Derive `jobID` from the
final filename (strip extension).

---

## Build Plan

### Step 1 — Set up the build directory

Create `docker/ellington/scriberr/build/` in this repo. This folder will contain:
- `Dockerfile` — multi-stage build: clone source, apply patch, compile, package
- `filename.patch` — the unified diff for the two file changes above

### Step 2 — Write the Dockerfile

Use a multi-stage build:
```dockerfile
# Stage 1: build
FROM golang:1.23-alpine AS builder
RUN apk add --no-cache git patch
WORKDIR /src
# Clone at the same tag/commit as the upstream image being replaced
RUN git clone --depth 1 --branch v1.2.0 https://github.com/rishikanthc/scriberr.git .
COPY filename.patch .
RUN patch -p1 < filename.patch
RUN go build -o scriberr ./cmd/scriberr   # adjust entrypoint path as needed

# Stage 2: runtime — copy everything from upstream image, swap binary
FROM ghcr.io/rishikanthc/scriberr:v1.2.0
COPY --from=builder /src/scriberr /app/scriberr
```

Note: the exact `go build` command and entry point path need to be confirmed by reading
the upstream repo's `Makefile` or `cmd/` directory structure.

### Step 3 — Push to Gitea container registry

ellington runs Gitea at `git.dylanamadeus.com` (internal: port 2222 for SSH, HTTP via
Cloudflare Tunnel). Gitea has a built-in container registry (packages feature).

On ellington:
```bash
# Log in to Gitea's container registry
docker login git.dylanamadeus.com

# Build the image
cd /path/to/homelab/docker/ellington/scriberr/build
docker build -t git.dylanamadeus.com/dylan/scriberr:patched .

# Push
docker push git.dylanamadeus.com/dylan/scriberr:patched
```

The Gitea registry endpoint is `git.dylanamadeus.com` (same domain, uses Gitea's packages API).
You may need to enable "Packages" in Gitea admin settings if not already enabled.

### Step 4 — Update the compose file

Change the image line in `docker/ellington/scriberr/docker-compose.yml`:
```yaml
image: git.dylanamadeus.com/dylan/scriberr:patched
```

Everything else in the compose stays the same. Redeploy in Portainer.

---

## Rebuild Process (for future upstream updates)

When a new Scriberr version is released:
1. Update the `git clone --branch` tag in the Dockerfile
2. Update the `FROM ghcr.io/rishikanthc/scriberr:` tag to match
3. Verify the patch still applies cleanly (the two changed files are unlikely to move)
4. Rebuild and push on ellington:
   ```bash
   docker build -t git.dylanamadeus.com/dylan/scriberr:patched . && \
   docker push git.dylanamadeus.com/dylan/scriberr:patched
   ```
5. In Portainer, pull latest and redeploy the scriberr stack

---

## Things to Verify Before Starting

- [ ] Confirm Gitea packages/container registry is enabled (Admin Panel → Configuration →
      check "Enable Packages")
- [ ] Confirm the exact Go build command by reading the upstream Makefile or `cmd/` layout
- [ ] Confirm the upstream image tag to use for the runtime stage (v1.2.0 or latest commit)
- [ ] Read the full `file_service.go` and `dropzone.go` to write an accurate patch file
- [ ] Verify the jobID is used only as a lookup key (not returned to the user or used as
      a display name), so switching from UUID to filename-derived ID is safe

## Useful Reference Paths

- Compose file: `docker/ellington/scriberr/docker-compose.yml`
- Build files (to be created): `docker/ellington/scriberr/build/`
- NAS recordings on ellington: `/nas/media/Scriberr/Recordings`
- NAS models on ellington: `/nas/media/Scriberr/Models`
- Local data dir on ellington: `/opt/docker/scriberr/data/`
- Upstream repo: https://github.com/rishikanthc/scriberr
