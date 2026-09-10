# =============================================================================
# The API, with the browser it needs.
#
# The awkward part of this image is not Node, it is Chromium: the document
# engine renders every PDF through headless Chrome (DECISIONS.md §0), so an
# image without a browser builds fine, starts fine, serves every read
# endpoint fine -- and fails the first time somebody clicks "Generate
# document". The browser is installed from Debian's own package rather than
# downloaded by puppeteer at install time, so the version is pinned by the
# base image and no build step reaches the network for a 150 MB binary.
# =============================================================================

# ---- build ------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /repo

# `argon2` builds a native addon, so the toolchain has to be present here --
# and only here: it is left behind with the rest of the build stage.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# The lockfile is the whole workspace's, so the install is done from the
# repo root. Copied before the sources so a code change does not re-run it.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN npm ci --workspace @warehouse-saas/api --include-workspace-root

COPY apps/api apps/api
COPY docs/architecture/schema docs/architecture/schema
RUN npm run build --workspace @warehouse-saas/api

# ---- runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /repo

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ca-certificates fonts-liberation fonts-noto-core fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

# Fonts, not decoration: a document with an Indian address or a ₹ renders as
# boxes without them, and a PDF is the one artefact a customer keeps.
ENV PUPPETEER_CHROMIUM_EXECUTABLE=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    NODE_ENV=production \
    ATTACHMENTS_DIR=/var/lib/warehouse/attachments

COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/apps/api/node_modules apps/api/node_modules
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/package.json apps/api/package.json
COPY --from=build /repo/package.json package.json
# The schema files are read at runtime by `npm run migrate`, not compiled in.
COPY --from=build /repo/docs/architecture/schema docs/architecture/schema
COPY apps/api/src apps/api/src
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Chromium is run without a sandbox (the renderer passes `--no-sandbox`),
# which is only acceptable because it renders HTML this application built
# itself. Running as a non-root user is the other half of that bargain.
RUN mkdir -p /var/lib/warehouse/attachments && chown -R node:node /var/lib/warehouse
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "apps/api/dist/main.js"]
