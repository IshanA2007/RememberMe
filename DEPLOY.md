# Deployment Guide

Three services, three platforms:

| Service | Platform | Source dir |
|---------|----------|------------|
| Dashboard SPA | Vercel | `dashboard/` |
| Vision SPA | Vercel | `RememberMeInterface/` |
| Backend API | Railway | `backend/` |

---

## 1. Backend (Railway)

### Create the service

1. Go to [railway.app](https://railway.app), create a new project
2. **New Service → Deploy from GitHub repo** → select `IshanA2007/RememberMe`
3. In service settings, set **Root Directory** to `backend`
4. Railway auto-detects Python via nixpacks. The `railway.toml` handles the rest.

### Add a persistent volume

Railway's filesystem is ephemeral. SQLite needs a volume:

1. In the service, **Add Volume**
2. Mount path: `/data`
3. Set env var: `SQLITE_PATH=/data/rememberme.db`

### Set environment variables

In Railway's service **Variables** tab:

```
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://rememberme.app/api

ELEVENLABS_API_KEY=sk_...
ELEVENLABS_DEFAULT_VOICE_ID=nPczCjzI2devNBz1zQrb

LLM_API_KEY=sk-ant-api03-...
LLM_MODEL=claude-sonnet-4-5

SQLITE_PATH=/data/rememberme.db
REMEMBERME_MODEL_DIR=/data/models
SEED_ON_STARTUP=true
BACKEND_DEV_AUTH_BYPASS=true

CORS_ALLOWED_ORIGINS=https://your-dashboard.vercel.app,https://your-vision.vercel.app
```

> **After deploying both Vercel apps**, come back and update `CORS_ALLOWED_ORIGINS` with the actual Vercel URLs.

### Note the public URL

Railway gives you a URL like `https://rememberme-backend-production-XXXX.up.railway.app`. Copy this — the frontends need it.

---

## 2. Dashboard SPA (Vercel)

1. Go to [vercel.com](https://vercel.com), **Add New Project**
2. Import `IshanA2007/RememberMe`
3. Set **Root Directory** to `dashboard`
4. Framework preset: **Vite** (auto-detected)
5. Add environment variables:

```
VITE_BACKEND_HTTP=https://your-railway-url.up.railway.app
VITE_AUTH0_DOMAIN=your-tenant.auth0.com
VITE_AUTH0_CLIENT_ID=your-auth0-client-id
VITE_AUTH0_AUDIENCE=https://rememberme.app/api
VITE_VISION_URL=https://your-vision.vercel.app
VITE_DEV_AUTH_BYPASS=true
```

6. Deploy

---

## 3. Vision SPA (Vercel)

1. **Add New Project** again from the same repo
2. Set **Root Directory** to `RememberMeInterface`
3. Framework preset: **Vite**
4. Add environment variables:

```
VITE_BACKEND_HTTP=https://your-railway-url.up.railway.app
VITE_BACKEND_WS=wss://your-railway-url.up.railway.app
```

5. Deploy

---

## 4. Post-deploy wiring

Once all three are up:

1. **Update Railway CORS**: set `CORS_ALLOWED_ORIGINS` to the actual Vercel URLs (comma-separated, no trailing slash)
2. **Update Dashboard `VITE_VISION_URL`**: set to the actual Vision Vercel URL
3. Redeploy both Vercel apps (trigger from dashboard or push a commit)

---

## Local development

Everything still works locally with `.env` files:

- `dashboard/.env` → `VITE_BACKEND_HTTP=http://localhost:5001`
- `RememberMeInterface/.env` → `VITE_BACKEND_HTTP=http://localhost:5001`, `VITE_BACKEND_WS=ws://localhost:5001`
- `backend/.env` → `CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001`
