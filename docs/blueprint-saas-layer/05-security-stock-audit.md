# Sections 37–39 — Security, Stock Integrity, Audit Log

## 37. Security

Mandatory: tenant isolation, server-side authorization, role-based
permissions, secure document access, secure file storage, audit logs, input
validation, rate limiting where appropriate, protected APIs, protected QR
verification, no cross-tenant leakage. **Test authorization independently
from UI visibility** — a hidden button is not a security control.

## 38. Stock Integrity

Stock is business-critical. Use transactional operations. Never allow:
duplicate posting, negative stock accidentally, duplicate dispatch,
duplicate reservation, stock corruption on retry, unauthorized adjustment.
Every stock movement must reference a source transaction.

## 39. Audit Log

Record: create, update, approve, reject, cancel, stock adjustment, document
generation, payment, **subscription change**, **permission change**. Audit
information must be immutable to normal users.
