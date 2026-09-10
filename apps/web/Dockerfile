# =============================================================================
# The web app, as static files behind nginx -- which also proxies /api.
#
# That proxy is the reason this is one container rather than a bucket: it
# keeps the browser's requests same-origin, which means no CORS on the API
# and no API address compiled into the bundle. The same shape the dev
# server has, so what is tested in development is what ships.
# =============================================================================

FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
ENV PUPPETEER_SKIP_DOWNLOAD=1
RUN npm ci --workspace @warehouse/web --include-workspace-root
COPY apps/web apps/web
RUN npm run build --workspace @warehouse/web

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
# nginx's own entrypoint renders anything in templates/ with envsubst, so
# API_PROXY_TARGET is a deployment setting rather than a rebuild.
ENV API_PROXY_TARGET=http://api:3000 \
    # nginx's entrypoint substitutes only the env vars it is told about, so
    # this filter is what keeps `$host`, `$remote_addr` and friends out of
    # envsubst's reach. Without it, an unrelated environment variable named
    # `host` would silently blank a directive in the rendered config.
    NGINX_ENVSUBST_FILTER=^API_
EXPOSE 80
