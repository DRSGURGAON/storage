#!/usr/bin/env bash
#
# Take a backup: the database, and the attachment bytes that go with it.
#
#   ops/backup.sh [destination-directory]
#
# Reads DATABASE_URL, and either ATTACHMENTS_DIR or the S3_* variables --
# the same environment the API runs with, so a backup is taken with the
# deployment's own configuration rather than a second copy of it that can
# drift.
#
# ---------------------------------------------------------------------------
# The database is dumped FIRST and the files SECOND, and that order is the
# only interesting decision in this script.
#
# The two halves cannot be captured at the same instant, so one of them is
# always slightly older. Files first would mean the database can name an
# attachment written after the file snapshot: a row pointing at bytes the
# backup does not contain, which restores as an invoice that cannot be
# opened. Database first means the file snapshot can contain bytes no row
# names: an orphan, which costs a few kilobytes and nothing else.
#
# One direction loses documents. The other wastes disk. That is not a
# close call.
# ---------------------------------------------------------------------------
set -euo pipefail

DEST_ROOT="${1:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${DEST_ROOT}/${STAMP}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set. Source the deployment's environment first." >&2
  exit 1
fi

mkdir -p "${DEST}"
echo "==> backing up into ${DEST}"

# --- 0. can this role actually read everything? ------------------------------
#
# Every tenant table is under FORCE ROW LEVEL SECURITY, which applies to
# the table's owner too. `pg_dump` as the application's own role therefore
# fails partway through with
#
#   ERROR: query would be affected by row-level security policy for table ...
#
# -- which is the correct behaviour and a terrible thing to discover during
# an incident. Backups need a role that bypasses RLS. Checked here, before
# a single byte is written, so the message names the fix instead of leaving
# pg_dump's to be interpreted.
BYPASSES=$(psql "${DATABASE_URL}" -At -c \
  "select rolsuper or rolbypassrls from pg_roles where rolname = current_user" 2>/dev/null || echo "f")
if [ "${BYPASSES}" != "t" ]; then
  cat >&2 <<'EOF'
This database role cannot read past row-level security, so pg_dump will
fail partway through: every tenant table is under FORCE ROW LEVEL SECURITY,
which applies to the owner as well.

Give backups their own role, once:

  create role warehouse_backup login password '...' bypassrls;
  grant connect on database <db> to warehouse_backup;
  grant usage on schema public to warehouse_backup;
  grant select on all tables in schema public to warehouse_backup;
  alter default privileges in schema public grant select on tables to warehouse_backup;

Then run this script with DATABASE_URL pointing at that role. It needs no
write access anywhere -- which is the other reason not to reuse the
application's.
EOF
  exit 1
fi

# --- 1. the database ---------------------------------------------------------
#
# Custom format (-Fc): compressed, and restorable with pg_restore into a
# database that does not exist yet, which is what a real restore looks
# like. --no-owner so it can be restored by whichever role the new host
# uses rather than requiring the original one to exist.
echo "--> database"
pg_dump --format=custom --no-owner --file="${DEST}/database.dump" "${DATABASE_URL}"

# The schema version this dump was taken at, so a restore can tell whether
# the code it is being restored under is older than the data.
psql "${DATABASE_URL}" -At -c \
  "select filename from _migrations order by applied_at desc limit 1" \
  > "${DEST}/schema-version.txt" 2>/dev/null || echo "unknown" > "${DEST}/schema-version.txt"

# Row counts for the tables a warehouse cannot reconstruct. `verify.sh`
# compares these after a restore: a dump that restores without error but
# arrives short is the failure this catches.
psql "${DATABASE_URL}" -At -F, -c "
  select 'tenants', count(*) from tenants
  union all select 'stock_ledger', count(*) from stock_ledger
  union all select 'documents', count(*) from documents
  union all select 'invoices', count(*) from invoices
  union all select 'attachments', count(*) from attachments
  union all select 'audit_logs', count(*) from audit_logs
  order by 1
" > "${DEST}/row-counts.csv"

# --- 2. the attachments ------------------------------------------------------
#
# Every generated PDF, KYC document, gate photograph and captured
# signature. A database restored without these is a set of records that
# name documents nobody can open.
echo "--> attachments"
if [ -n "${S3_BUCKET:-}" ] && [ "${ATTACHMENT_STORAGE:-}" != "local" ]; then
  # On object storage the bucket is the backup target's business, not this
  # script's: `aws s3 sync` (or `rclone`, or the provider's own versioning
  # and replication) does it better than a shell loop, and pulling a whole
  # bucket through this machine to write it out again is the wrong shape.
  # What is recorded here is where the bytes were, so a restore knows.
  cat > "${DEST}/attachments-location.txt" <<EOF
storage=s3
bucket=${S3_BUCKET}
prefix=${S3_PREFIX:-}
endpoint=${S3_ENDPOINT:-aws}
region=${S3_REGION:-us-east-1}

The bytes are NOT in this backup directory. Object storage is backed up on
its own terms -- versioning, lifecycle rules, or a scheduled

  aws s3 sync s3://${S3_BUCKET}/${S3_PREFIX:-} s3://<your-backup-bucket>/${STAMP}/

-- and the database dump beside this file is only useful together with the
objects as they were at ${STAMP} or later. Later is fine; earlier is not.
EOF
  echo "    s3://${S3_BUCKET}/${S3_PREFIX:-} -- recorded, not copied (see attachments-location.txt)"
else
  ATTACHMENTS="${ATTACHMENTS_DIR:-./storage/attachments}"
  if [ -d "${ATTACHMENTS}" ]; then
    tar --create --gzip --file "${DEST}/attachments.tar.gz" --directory "${ATTACHMENTS}" .
    echo "storage=local" > "${DEST}/attachments-location.txt"
    echo "    $(du -h "${DEST}/attachments.tar.gz" | cut -f1) from ${ATTACHMENTS}"
  else
    echo "    ${ATTACHMENTS} does not exist -- nothing to archive" >&2
    echo "storage=local (directory missing at backup time)" > "${DEST}/attachments-location.txt"
  fi
fi

# --- 3. the manifest ---------------------------------------------------------
#
# Checksums, so a corrupted transfer is caught before a restore is
# attempted rather than during one.
( cd "${DEST}" && sha256sum ./* > SHA256SUMS 2>/dev/null || true )

cat > "${DEST}/manifest.txt" <<EOF
taken_at=${STAMP}
schema_version=$(cat "${DEST}/schema-version.txt")
database_bytes=$(stat -c %s "${DEST}/database.dump")
host=$(hostname)
EOF

echo "==> done"
cat "${DEST}/manifest.txt"
echo
echo "Row counts captured:"
sed 's/^/  /' "${DEST}/row-counts.csv"
echo
echo "Restore it into an empty database with:  ops/restore.sh ${DEST} <target-database-url>"
echo "And do that on a schedule, not only after an incident: a backup nobody has restored is a hope."
