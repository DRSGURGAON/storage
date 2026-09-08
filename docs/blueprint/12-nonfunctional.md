# Sections 69–70 — Security, Backup / Reliability

## 69. Security

Implement: tenant isolation; server-side authorization; role permissions;
secure authentication; secure file access; signed/controlled document URLs;
audit logging; input validation; rate limiting where appropriate; protection
against unauthorized document access.

The customer portal must enforce tenant/customer ownership server-side.

## 70. Backup / Reliability

Production SaaS requirements: database backups; file backups; error logging;
API error handling; transaction rollback where required; idempotency for
critical operations; safe retry mechanisms; no duplicate stock posting.

Stock-affecting operations must be atomic.
