#!/bin/sh
# Nightly database dump with retention, run by the `backup` service.
#
# A dump you have never restored is not a backup, so this writes plain custom
# format that `pg_restore` reads directly, and the README documents the restore
# command next to the backup one.
set -eu

DIR=/backups
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"

mkdir -p "$DIR"

dump() {
  stamp=$(date -u '+%Y-%m-%dT%H-%M-%SZ')
  target="$DIR/flowdesk-$stamp.dump"

  # Write to a temporary name first: a half-finished file that looks like a
  # backup is worse than no file at all.
  if pg_dump --format=custom --file="$target.partial" \
      --host=db --username="$POSTGRES_USER" "$POSTGRES_DB"; then
    mv "$target.partial" "$target"
    echo "backup ok: $target ($(du -h "$target" | cut -f1))"
  else
    rm -f "$target.partial"
    echo "backup FAILED at $stamp" >&2
    return 1
  fi

  # Retention runs only after a successful dump, so a run of failures can never
  # delete the last good copy.
  find "$DIR" -name 'flowdesk-*.dump' -type f -mtime "+$KEEP_DAYS" -delete
}

echo "backup service started: every ${INTERVAL}s, keeping ${KEEP_DAYS} days in $DIR"
while true; do
  dump || true
  sleep "$INTERVAL"
done
