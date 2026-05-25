#!/usr/bin/env bash
set -e

echo "=== Installing Python dependencies ==="
pip install -r requirements.txt

echo "=== Building React frontend ==="
cd frontend
npm install --legacy-peer-deps
CI=false npm run build
cd ..

echo "=== Collecting static files ==="
python manage.py collectstatic --noinput

echo "=== Running migrations ==="
python manage.py migrate --noinput

echo "=== Seeding demo data ==="
python manage.py seed_data

echo "=== Build complete ==="
