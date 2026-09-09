-- =============================================================================
-- 95_document_qr_verify_lookup.sql -- Let the public QR verification
-- endpoint find a document before its tenant is known
--
-- Same shape of problem as 91_tenant_users_self_lookup.sql, hit while
-- building the document engine's verify flow: document-engine.md §4's
-- public `/verify/{qr_token}` endpoint has no JWT and no tenant context at
-- all -- discovering which tenant a document belongs to *is* the lookup.
-- Under 90_row_level_security.sql's tenant_isolation policy alone, that
-- lookup returns zero rows every time.
--
-- Fix: a second, narrow, SELECT-only policy on `documents`, additional to
-- (not replacing) tenant_isolation. It allows a row to be visible only
-- when its own `qr_token` matches a session variable the caller sets to
-- the exact token it is looking up -- so seeing one document's row
-- requires already possessing that document's own opaque, unguessable
-- token (document-engine.md §4: "a random opaque value... cannot be
-- guessed or enumerated"), the same way tenant_users' self-lookup policy
-- requires already possessing a just-verified user id. It cannot be used
-- to enumerate other tenants' documents, and it is SELECT-only.
-- =============================================================================

create policy qr_verify_lookup on documents
  for select
  using (qr_token = current_setting('app.verify_qr_token', true));
