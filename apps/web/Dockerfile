# syntax=docker/dockerfile:1

# Produces the static bundle. Nothing runs from this image at runtime — Caddy
# copies the built files out of it in the final stage below.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace=@flowdesk/web --workspace=@flowdesk/contracts --include-workspace-root

# Every workspace tsconfig extends the base; without it the compiler silently
# falls back to defaults and the build fails on options it should have had.
COPY tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY apps/web ./apps/web
RUN npm run build --workspace=@flowdesk/web

# Caddy serves the bundle and terminates TLS. The API is reached through it on
# the same origin, which is what keeps the session cookie and the origin check
# working exactly as they do in development.
FROM caddy:2-alpine
COPY --from=build /app/apps/web/dist /srv
# Source maps are not published. They carry the original, unminified source —
# including anything the bundler dropped from the shipped code, such as the
# development-only demo credentials — and would be fetchable by anyone who
# guesses the filename. Nothing consumes them here; a local `npm run build`
# still produces them for debugging.
RUN find /srv -name '*.map' -delete
COPY Caddyfile /etc/caddy/Caddyfile
