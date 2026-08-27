# Fresh host for OKFLIX + GitHub repo + worker token

## What the uploaded archive is

`okflix-source-clean-3.zip` contains 205 files under `okflix-source/` — the same app that already lives in this project (`src/`, `public/`, `worker/`, `supabase/`, plus `package.json`, `vite.config.ts`, `railway.json`, `nixpacks.toml`). It has no `.git` folder and no `node_modules`, so it is safe to use as source material.

Two files in it are newer than the copy in the project: `nixpacks.toml`, `railway.json` (Railway build config) and `worker/server.py`.

## Plan

### 1. Sync the project to the archive (build mode)
- Extract the zip to a temp folder and compare it file-by-file with the project.
- Overwrite project files with the archive versions where they differ, and delete project files that no longer exist in the archive (excluding `node_modules`, lockfiles, `.git`, and Lovable-generated integration files).
- Leave auto-generated backend integration files and `.env` untouched — they are tied to this project's backend and must not be replaced by the archive copies.
- Run a build check afterwards and fix anything the sync breaks.

### 2. Publish to `okflix.lovable.app`
- Run a security scan, then publish with the slug `okflix`, which produces `https://okflix.lovable.app`.
- The old preview URL keeps working; publishing simply repoints the live site to the current code. Fully removing an existing published site is done with the Unpublish button in Project settings — I cannot do that from chat.

### 3. GitHub repository
Creating the repo has to be done by you, from the Lovable UI — the agent cannot create or connect a Git remote:
- Project settings > GitHub > Connect to GitHub, then "Create repository".
- That makes a fresh repo owned by your GitHub account and two-way syncs this project into it.
Tell me once it exists if you want the repo contents adjusted (README, deploy docs, etc.).

### 4. Worker token — what to set

The website talks to the Python worker with a shared secret. Three values, two places:

| Where | Variable | Value |
|---|---|---|
| Railway (worker service) | `WORKER_TOKEN` | a long random string you generate |
| Website (Lovable secrets) | `NETFLIX_WORKER_TOKEN` | the exact same string |
| Website (Lovable secrets) | `NETFLIX_WORKER_URL` | your Railway public URL, no trailing slash |

Generate the token with `openssl rand -hex 32` (64 hex chars). The worker rejects any request whose `X-Worker-Token` header does not match `WORKER_TOKEN`, and it refuses to serve at all if the variable is empty.

When you send the Railway URL, I will store both secrets and run the built-in worker health check from Admin > Settings to confirm the website reaches it.

## Technical notes

- Railway deploy config in the archive: Nixpacks with `bun install --frozen-lockfile`, `bun run build`, start `bun run start`, healthcheck `/` with a 300s timeout.
- The website itself is hosted on Lovable; only the Python worker (`worker/server.py`, FastAPI) belongs on Railway.
- Backend data (cookies, proxies, settings, admin accounts) lives in the project backend and is not affected by re-hosting the code.
