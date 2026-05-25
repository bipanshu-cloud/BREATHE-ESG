# Breathe ESG — Emissions Intelligence Platform

A Django REST + React application for ingesting, normalising, and reviewing carbon emissions data from enterprise sources.

## Live Demo

- **App:** [Deploy to Railway/Render — see below]
- **Login:** `analyst` / `breathe123`

## Quick Start (Local)

```bash
# 1. Backend
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_data        # creates demo users + 17 sample records
python manage.py runserver        # http://localhost:8000

# 2. Frontend (separate terminal)
cd frontend
npm install --legacy-peer-deps
npm start                         # http://localhost:3000
```

The frontend proxies `/api/*` to Django during development. Set `REACT_APP_API_URL=http://localhost:8000` if needed.

## Deploy to Railway (Recommended)

```bash
# 1. Install Railway CLI
npm i -g @railway/cli

# 2. Deploy
railway login
railway init
railway up

# 3. Set env vars in Railway dashboard
SECRET_KEY=<generate>
DEBUG=False
DATABASE_URL=<Railway PostgreSQL add-on>
```

Railway will run the `release` command in Procfile (migrate + seed + collectstatic) automatically.

## Deploy to Render

1. Connect your GitHub repo in Render dashboard
2. Select `render.yaml` — it configures everything
3. Add a PostgreSQL database and set `DATABASE_URL`

## Architecture

```
breathe/
├── config/           Django project settings + URLs
├── emissions/        Core app
│   ├── models.py     Tenant, IngestionBatch, EmissionRecord, AuditEvent
│   ├── ingestion.py  Three parsers + normalization pipeline
│   ├── views.py      DRF viewsets + ingestion endpoint
│   ├── serializers.py
│   └── urls.py
├── frontend/         React SPA (Create React App)
│   └── src/
│       ├── pages/    Dashboard, IngestPage, ReviewPage, AuditPage, DocsPage
│       └── api.js    Axios client
├── requirements.txt
├── Procfile
└── MODEL.md / DECISIONS.md / TRADEOFFS.md / SOURCES.md
```

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/auth/login/` | POST | Login → returns token |
| `/api/auth/me/` | GET | Current user info |
| `/api/dashboard/` | GET | Aggregate stats |
| `/api/ingest/` | POST | Upload file or paste raw data |
| `/api/records/` | GET | List/filter emission records |
| `/api/records/{id}/approve/` | POST | Approve a record |
| `/api/records/{id}/flag/` | POST | Flag a record |
| `/api/batches/` | GET | Ingestion batch history |
| `/api/audit/` | GET | Audit event log |
