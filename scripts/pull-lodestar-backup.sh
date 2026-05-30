#!/usr/bin/env bash
#
# Lodestar Postgres backup — PULL model.
# Runs on the BACKUP box (89.167.109.4, Helsinki). Pulls a compressed pg_dump
# from the primary (167.235.29.213, Nuremberg) over a forced-command SSH key,
# verifies it, then files it into daily/weekly/monthly retention.
#
# The primary cannot reach this box; this box can only trigger a dump on the
# primary (forced command). That asymmetry is the point.
#
# Cron (daily 03:17 UTC):
#   17 3 * * * /root/scripts/pull-lodestar-backup.sh >> /var/log/lodestar-backup.log 2>&1
#
set -euo pipefail
export LC_ALL=C

PRIMARY="root@167.235.29.213"
PULL_KEY="/root/.ssh/lodestar_pull"
ROOT="/root/backups/lodestar"
DAILY="$ROOT/daily"; WEEKLY="$ROOT/weekly"; MONTHLY="$ROOT/monthly"
RETAIN_DAILY=7; RETAIN_WEEKLY=4; RETAIN_MONTHLY=6

TS="$(date -u +%Y%m%dT%H%M%SZ)"
DOW="$(date -u +%u)"      # 7 = Sunday
DOM="$(date -u +%d)"      # 01 = first of month
mkdir -p "$DAILY" "$WEEKLY" "$MONTHLY"

TMP="$(mktemp "$ROOT/.inflight.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

echo "[$TS] pulling dump from primary..."
ssh -o BatchMode=yes -o ConnectTimeout=30 -i "$PULL_KEY" "$PRIMARY" > "$TMP"

# A dump we can't read is not a backup. Verify before we keep it.
SIZE=$(stat -c %s "$TMP")
if [ "$SIZE" -lt 1000000 ]; then echo "FATAL: dump only $SIZE bytes, refusing"; exit 1; fi
if ! head -c5 "$TMP" | grep -q 'PGDMP'; then echo "FATAL: not a pg_dump archive"; exit 1; fi
TABLES=$(pg_restore --list "$TMP" 2>/dev/null | grep -c 'TABLE DATA' || true)
if [ "$TABLES" -lt 1 ]; then echo "FATAL: pg_restore found no tables"; exit 1; fi

DEST="$DAILY/lodestar-$TS.dump"
mv "$TMP" "$DEST"; trap - EXIT
echo "[$TS] daily ok: $DEST ($(du -h "$DEST" | cut -f1), $TABLES tables)"

# Promote: Sunday -> weekly, 1st of month -> monthly (hardlink, no re-copy).
if [ "$DOW" = "7" ];  then ln -f "$DEST" "$WEEKLY/lodestar-$TS.dump";  echo "  promoted to weekly";  fi
if [ "$DOM" = "01" ]; then ln -f "$DEST" "$MONTHLY/lodestar-$TS.dump"; echo "  promoted to monthly"; fi

# Retention: keep newest N in each tier.
prune() {
  local dir="$1" keep="$2"
  shopt -s nullglob
  local files=("$dir"/lodestar-*.dump)
  shopt -u nullglob
  (( ${#files[@]} <= keep )) && return 0
  # sort newest-first by mtime, drop the first $keep, delete the rest
  local sorted; sorted=$(ls -1t "${files[@]}")
  echo "$sorted" | tail -n +$((keep+1)) | while read -r f; do rm -f "$f"; done
  return 0
}
prune "$DAILY"   "$RETAIN_DAILY"
prune "$WEEKLY"  "$RETAIN_WEEKLY"
prune "$MONTHLY" "$RETAIN_MONTHLY"

echo "[$TS] retention: $(ls -1 "$DAILY"|wc -l) daily, $(ls -1 "$WEEKLY"|wc -l) weekly, $(ls -1 "$MONTHLY"|wc -l) monthly"
echo "[$TS] done."
