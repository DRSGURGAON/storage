#!/usr/bin/env bash
#
# Restore a backup, and check that what came back is what went in.
#
#   ops/restore.sh <backup-directory> <target-database-url> [attachments-dir]
#
# The target database must not already hold this application's data: this
# restores into it, it does not merge. Point it at a fresh database -- which
# is also how you rehearse a restore without touching production.
set -euo pipefail

BACKUP="${1:?usage: ops/restore.sh <backup-directory> <target-database-url> [attachments-dir]}"
TARGET_URL="${2:?target database url required}"
ATTACHMENTS_TARGET="${3:-}"

if [ ! -f "${BACKUP}/database.dump" ]; then
  echo "No database.dump in ${BACKUP}" >&2
  exit 1
fi

echo "==> restoring ${BACKUP}"
cat "${BACKUP}/manifest.txt" 2>/dev/null | sed 's/^/    /' || true

# --- checksums first ---------------------------------------------------------
# A truncated transfer restores partially and silently on some formats.
# Catching it here costs a second; catching it later costs the restore.
if [ -f "${BACKUP}/SHA256SUMS" ]; then
  echo "--> checksums"
  ( cd "${BACKUP}" && sha256sum --quiet --check SHA256SUMS ) || {
    echo "Checksums do not match. Do not restore this copy." >&2
    exit 1
  }
fi

# --- the database ------------------------------------------------------------
#
# `--no-owner` pairs with the dump's: the roles on the new host are its
# own. `--single-transaction` means a failure leaves nothing behind rather
# than a half-restored database somebody has to notice.
echo "--> database"
pg_restore --no-owner --single-transaction --dbname="${TARGET_URL}" "${BACKUP}/database.dump"

# --- the attachments ---------------------------------------------------------
if [ -f "${BACKUP}/attachments.tar.gz" ]; then
  if [ -z "${ATTACHMENTS_TARGET}" ]; then
    echo "    attachments.tar.gz is present but no attachments directory was given -- skipping." >&2
    echo "    The records will restore; the documents they name will not open." >&2
  else
    echo "--> attachments into ${ATTACHMENTS_TARGET}"
    mkdir -p "${ATTACHMENTS_TARGET}"
    tar --extract --gzip --file "${BACKUP}/attachments.tar.gz" --directory "${ATTACHMENTS_TARGET}"
  fi
elif [ -f "${BACKUP}/attachments-location.txt" ]; then
  echo "--> attachments are on object storage:"
  sed 's/^/    /' "${BACKUP}/attachments-location.txt"
fi

# --- verify ------------------------------------------------------------------
#
# The half of a restore procedure people skip, which is why they find out
# whether it worked during the incident rather than before one.
echo "--> verifying"
FAILED=0

# The verification has the same problem the backup does, in the other
# direction: counted under row-level security, with no `app.tenant_id` set,
# every tenant-scoped table answers zero. A perfect restore then reports
# five zeroes and looks like a disaster -- which is what happened the first
# time this ran, mid-way through writing it.
#
# Worse is the shape it does not take: if the *backup* had also counted
# blind, both sides would read zero and "match". `backup.sh` refuses to run
# without a bypassing role for exactly that reason, and this refuses to
# claim a verification it cannot actually perform.
TARGET_BYPASSES=$(psql "${TARGET_URL}" -At -c \
  "select rolsuper or rolbypassrls from pg_roles where rolname = current_user" 2>/dev/null || echo "f")

if [ "${TARGET_BYPASSES}" != "t" ]; then
  echo "    cannot verify: this role does not bypass row-level security, so every" >&2
  echo "    tenant table would count as empty whether the restore worked or not." >&2
  echo "    Re-run the verification with the backup role (see ops/backup.sh)." >&2
  FAILED=1
elif [ -f "${BACKUP}/row-counts.csv" ]; then
  RESTORED=$(psql "${TARGET_URL}" -At -F, -c "
    select 'tenants', count(*) from tenants
    union all select 'stock_ledger', count(*) from stock_ledger
    union all select 'documents', count(*) from documents
    union all select 'invoices', count(*) from invoices
    union all select 'attachments', count(*) from attachments
    union all select 'audit_logs', count(*) from audit_logs
    order by 1
  ")
  if [ "${RESTORED}" = "$(cat "${BACKUP}/row-counts.csv")" ]; then
    echo "    row counts match:"
    echo "${RESTORED}" | sed 's/^/      /'
  else
    echo "    ROW COUNTS DIFFER" >&2
    diff <(cat "${BACKUP}/row-counts.csv") <(echo "${RESTORED}") | sed 's/^/      /' >&2 || true
    FAILED=1
  fi
fi

# Every attachment row must have its bytes. This is the check that catches
# the mistake `backup.sh` is ordered to avoid -- a record naming a document
# the backup does not contain -- and it is worth running even when the
# order was right, because the order is only right if somebody kept it that way.
if [ "${TARGET_BYPASSES}" = "t" ] && [ -n "${ATTACHMENTS_TARGET}" ] && [ -d "${ATTACHMENTS_TARGET}" ]; then
  MISSING=0
  TOTAL=0
  while IFS= read -r key; do
    [ -z "${key}" ] && continue
    TOTAL=$((TOTAL + 1))
    [ -f "${ATTACHMENTS_TARGET}/${key}" ] || { MISSING=$((MISSING + 1)); echo "      missing: ${key}" >&2; }
  done < <(psql "${TARGET_URL}" -At -c "select storage_key from attachments")
  if [ "${MISSING}" -eq 0 ]; then
    echo "    all ${TOTAL} attachment rows have their bytes"
  else
    echo "    ${MISSING} of ${TOTAL} attachments have no bytes" >&2
    FAILED=1
  fi
fi

if [ "${FAILED}" -ne 0 ]; then
  echo "==> restore completed WITH PROBLEMS -- read the lines above before trusting it" >&2
  exit 1
fi
echo "==> restore verified"
