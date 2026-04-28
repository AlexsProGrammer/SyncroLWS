#!/bin/sh
set -e

# Run all migration SQL files in order
MIGRATIONS_DIR="/app/apps/backend/drizzle"

# Execute each migration file in order
psql "$DATABASE_URL" -f "$MIGRATIONS_DIR/0000_phase_h_auth.sql" 2>/dev/null || echo "Migration 0000 already applied or errored (continuing...)"
psql "$DATABASE_URL" -f "$MIGRATIONS_DIR/0001_phase_i_sync.sql" 2>/dev/null || echo "Migration 0001 already applied or errored (continuing...)"
psql "$DATABASE_URL" -f "$MIGRATIONS_DIR/0002_phase_m_share_scope.sql" 2>/dev/null || echo "Migration 0002 already applied or errored (continuing...)"

echo "Migrations complete!"
