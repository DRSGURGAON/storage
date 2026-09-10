#!/bin/sh
# Schema first, then the system seed, then the app.
#
# Both steps are idempotent -- the migration runner skips what it has
# applied, and the seed upserts -- so this runs on every start rather than
# being a one-off somebody has to remember after a deploy. A schema file
# added in a release is applied by the release, which is the only way a
# migration ever actually gets run.
#
# It is deliberately in front of the process rather than a separate job: a
# container that starts serving against a database it has not migrated is a
# 500 on whichever endpoint touches the new column first.
set -e

if [ "${SKIP_MIGRATIONS:-0}" != "1" ]; then
  echo "==> applying schema"
  npm run --workspace @warehouse-saas/api migrate
  echo "==> seeding system rows (roles, permissions, plans, catalogues)"
  npm run --workspace @warehouse-saas/api seed
fi

echo "==> starting"
exec "$@"
