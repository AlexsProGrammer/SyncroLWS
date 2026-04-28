#!/bin/sh
set -e

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL..."
until pg_isready -h postgres -U syncrohws > /dev/null 2>&1; do
  echo "PostgreSQL is unavailable - sleeping"
  sleep 1
done

echo "PostgreSQL is ready!"

# Run database migrations
echo "Running database migrations..."
cd /app/apps/backend
npm run db:push || true

echo "Starting backend..."
npm run dev
