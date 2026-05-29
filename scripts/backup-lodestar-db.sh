#!/usr/bin/env bash
#
# Lodestar Postgres backup — pg_dump (custom format) → local rotation → optional
# offsite (S3-compatible object storage). Intended to run via cron on the VPS.
#
# RFC-004: a working, tested backup is a HARD GATE before Phase 1 (the GRT money
# ledger). Right now the box has zero backups.
#
# Credentials: set PGPASSWORD in the environment or use ~/.pgpass on the VPS.
# Do NOT hardcode the password here.
#
# Cron (daily 03:00 UTC, offsite to a private bucket):
#   0 3 * * *  S3_BUCKET=s3://lodestar-backups PGPASSWORD=... /root/scripts/backup-lodestar-db.sh >> /var/log/lodestar-backup.log 2>&1
#
# Once Phase 1 is live, move to hourly (the billing ledger changes constantly) and
# add pgbackrest WAL archiving for point-in-time recovery.

set -euo pipefail

DB_NAME="${PGDATABASE:-lodestar}"
DB_USER="${PGUSER:-lodestar}"
DB_HOST="${PGHOST:-127.0.0.1}"
DB_PORT="${PGPORT:-5433}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups/lodestar}"
RETAIN_DAYS="${RETAIN_DAYS:-14}"
S3_BUCKET="${S3_BUCKET:-}"   # e.g. s3://lodestar-backups  (empty = local only)

TS="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_DIR"
FILE="$BACKUP_DIR/lodestar-$TS.dump"

# Custom format (-Fc): compressed, supports selective/parallel restore.
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -Fc -f "$FILE"

# Integrity check — a dump we can't list is not a backup.
pg_restore --list "$FILE" > /dev/null

# Local rotation.
find "$BACKUP_DIR" -name 'lodestar-*.dump' -mtime +"$RETAIN_DAYS" -delete

# Offsite, if configured (s3cmd reads its own ~/.s3cfg).
if [[ -n "$S3_BUCKET" ]]; then
  s3cmd put "$FILE" "$S3_BUCKET/" > /dev/null
  echo "offsite ok: $S3_BUCKET/$(basename "$FILE")"
fi

echo "backup ok: $FILE ($(du -h "$FILE" | cut -f1))"
