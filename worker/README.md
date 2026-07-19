# OKFLIX Netflix Worker

Thin FastAPI wrapper around the Telegram-bot's Netflix modules
(`netflix_session.py`, `fast_checker.py`, `netflix_adapter.py`). The website
calls this worker over HTTPS for every cookie check, TV activation, and proxy
check.

## Endpoints

All require header `X-Worker-Token: <shared secret>`.

- `POST /check` — check one cookie. Body: `{ cookies: [{name,value,domain?}], proxy? }`
- `POST /activate` — run the 8-digit `/tv8` activation. Body: `{ code, cookies, proxy? }`
- `POST /check-proxy` — sanity-check a proxy. Body: `{ proxy: {…} }`
- `GET /health` — public liveness.

## Environment variables

| Name | Purpose |
| ---- | ------- |
| `WORKER_TOKEN` | Shared secret; must match `NETFLIX_WORKER_TOKEN` in the website secrets. |
| `PORT` | Optional; defaults to 8080. |

## Deploy on Railway

1. Create a **separate Railway service** for the worker. Do not reuse the
   website service.
2. If deploying this full repo, set Railway **Root Directory** to `worker`.
3. If Railway has **Config-as-code → Railway Config File**, set it to
   `worker/railway.json`.
4. Set **Healthcheck Path** to `/health`.
5. Set the env var `WORKER_TOKEN` to a long random string.
6. Once deployed, copy the public URL (e.g. `https://foo.up.railway.app`).
7. In the Lovable project set:
   - `NETFLIX_WORKER_URL` = that URL (no trailing slash)
   - `NETFLIX_WORKER_TOKEN` = the same `WORKER_TOKEN`

If the deploy says `bun` is missing, Railway is still building the website
instead of this Python worker. Re-check the service's **Root Directory** and
**Railway Config File** settings above.

## Deploy anywhere else

Any host that runs a Python 3.11 container works:

```bash
docker build -t okflix-worker .
docker run -e WORKER_TOKEN=$(openssl rand -hex 32) -p 8080:8080 okflix-worker
```

## Notes

- The core Netflix code is untouched; only `server.py` and this README were
  added. When you want to update the Netflix logic later, replace the `.py`
  files in this folder and redeploy.
- `curl-cffi` provides the Chrome-120 TLS/JA3 fingerprint used by
  `fast_checker.py`; do not swap it for `httpx` alone.
