# syntax=docker/dockerfile:1

# Build context is the repository root: the API depends on the @flowdesk/contracts
# workspace, so the image needs the whole npm workspace graph, not just apps/api.
FROM node:22-alpine AS deps
WORKDIR /app
# Prisma's query engine links against OpenSSL; Alpine ships without it.
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# The web workspace is not installed — it is built by its own image — but npm
# needs its manifest present to resolve the lockfile.
RUN npm ci --omit-optional --workspace=@flowdesk/api --workspace=@flowdesk/contracts --include-workspace-root

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production

# npm workspaces hoist everything to the root, including the symlink that
# resolves @flowdesk/contracts to packages/contracts — copied just below.
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.base.json ./
COPY packages/contracts ./packages/contracts
COPY apps/api ./apps/api

# Generated at build time so the container starts without network access.
RUN cd apps/api && npx prisma generate

# Uploads live on a mounted volume; the directory must exist and be writable by
# the unprivileged user the process runs as.
RUN mkdir -p /app/apps/api/uploads && chown -R node:node /app/apps/api/uploads
USER node

WORKDIR /app/apps/api
EXPOSE 4000
ENV HOST=0.0.0.0 PORT=4000

# Migrations are applied on start, then the server boots. `migrate deploy` only
# replays committed migrations — it never generates or resets, so it is safe to
# run on every container start, including a rolling restart.
CMD ["sh", "-c", "npx prisma migrate deploy && exec npx tsx src/main.ts"]
