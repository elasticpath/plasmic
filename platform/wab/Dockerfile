# See https://hub.docker.com/_/node/
FROM node:24-alpine AS builder

RUN apk add --no-cache make~=4 bubblewrap~=0.11 python3 build-base bash
# Switch workdir back to wab
WORKDIR /app/wab
COPY wab/package.json wab/yarn.lock ./
COPY wab/patches/ ./patches/
RUN yarn install --frozen-lockfile && yarn cache clean
COPY wab/ .
RUN mkdir -p src/wab/gen && make
RUN rm -rf node_modules/

# Build canvas-packages for publish-hostless support
FROM node:24-alpine AS canvas-builder

RUN apk add --no-cache python3 build-base bash

# Copy the register-library local dependency first
WORKDIR /app
COPY wab/src/wab/shared/register-library/ /app/wab/src/wab/shared/register-library/

# Install and build canvas-packages
WORKDIR /app/canvas-packages
COPY canvas-packages/package.json canvas-packages/yarn.lock canvas-packages/makePkgTypes.js canvas-packages/typedPkgsList.json ./
COPY canvas-packages/internal_pkgs/ ./internal_pkgs/
RUN yarn install --frozen-lockfile && yarn cache clean
COPY canvas-packages/ .
RUN yarn build

FROM node:24-alpine AS runner
# System setup
RUN apk add --no-cache make~=4 bubblewrap~=0.11 python3 build-base bash

# loader-bundle-env is expected to be a peer folder to wab, so we copy it there
WORKDIR /app/loader-bundle-env
COPY loader-bundle-env/package.json loader-bundle-env/yarn.lock ./
COPY loader-bundle-env/patches/ ./patches/
RUN yarn install --frozen-lockfile && yarn cache clean

# loader-html-hydrate is expected to be a peer folder to wab, so we copy it there
WORKDIR /app/loader-html-hydrate
COPY loader-html-hydrate/package.json loader-html-hydrate/yarn.lock ./
RUN yarn install --frozen-lockfile && yarn cache clean

WORKDIR /app/loader-bundle-env
COPY loader-bundle-env/ .
RUN ./yarn-install-internal-pkgs.sh
RUN ./yarn-build-internal-pkgs.sh

WORKDIR /app/loader-html-hydrate
COPY loader-html-hydrate/ .
RUN yarn build

# Expose main server port
EXPOSE 3004

# Switch workdir back to wab
WORKDIR /app/wab
COPY wab/package.json wab/yarn.lock ./
COPY wab/patches/ ./patches/
RUN yarn install --production --frozen-lockfile && yarn cache clean
COPY wab/ .
COPY --from=builder /app/wab/ .

# Include canvas-packages build output for publish-hostless task
COPY --from=canvas-builder /app/canvas-packages/build-server/ /app/canvas-packages/build-server/

USER node

CMD ["node", "-r", "esbuild-register", "src/wab/server/main.ts"]