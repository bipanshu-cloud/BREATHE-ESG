# Deploy to Render (Free — No Credit Card)

## Step 1 — Push to GitHub

```bash
# Unzip the project
unzip breathe-esg-full.zip
cd breathe

# Create a new GitHub repo at github.com/new (name it breathe-esg)
# Then run:
git init
git add .
git commit -m "Initial commit — Breathe ESG"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/breathe-esg.git
git push -u origin main
```

## Step 2 — Deploy on Render

1. Go to **https://render.com** → Sign up free (GitHub login works)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub account → select your **breathe-esg** repo
4. Render auto-detects `render.yaml` — click **"Apply"**
5. Settings auto-fill from render.yaml:
   - Build Command: `./build.sh`
   - Start Command: `gunicorn config.wsgi --bind 0.0.0.0:$PORT --workers 1 --timeout 120`
6. Click **"Create Web Service"**
7. Wait ~5 minutes for the build to complete

## Step 3 — Get your live URL

Render gives you a URL like: `https://breathe-esg.onrender.com`

That's your submission URL.

## Login credentials

```
Username: analyst
Password: breathe123
```

## What the build does automatically

The `build.sh` script runs on every deploy:
1. `pip install -r requirements.txt`
2. `cd frontend && npm install && npm run build` (builds React)
3. `python manage.py collectstatic` (serves React via Django/Whitenoise)
4. `python manage.py migrate` (creates DB tables)
5. `python manage.py seed_data` (loads 17 realistic records)

## Troubleshooting

**Build fails on npm:** Render's free tier has 512MB RAM. If npm OOM crashes, add this to render.yaml envVars:
```yaml
- key: NODE_OPTIONS
  value: "--max-old-space-size=400"
```

**"Application error" on first visit:** Free tier spins down after 15 min inactivity. First request takes ~30s to wake up. Normal behaviour.

**DB is empty after redeploy:** SQLite on Render free tier uses ephemeral storage — data resets on each deploy. This is expected for a demo. For persistence, add a Render PostgreSQL database (also free tier available) and set DATABASE_URL.
