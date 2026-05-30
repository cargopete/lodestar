#!/usr/bin/env bash
# Forced-command target for the backup-box pull key.
# Emits a compressed pg_dump of lodestar to stdout. Nothing else.
set -euo pipefail
export LC_ALL=C
exec sudo -u postgres pg_dump -p 5433 -Fc lodestar
