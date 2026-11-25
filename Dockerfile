# flarealoy: the `flarealoy run` service. Dokploy builds this image from the repo (compose.example.yaml).
# The owner runs every other command in the same container: docker exec -it <container> flarealoy <command>.

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
RUN pnpm build && pnpm prune --prod

FROM node:22-alpine
# node:sqlite without a flag needs Node 22.13 or later; stop the build on an older base.
RUN node -e 'const [a,b]=process.versions.node.split(".").map(Number); if (a===22 && b<13) { console.error("Node 22.13 or later needed, got " + process.version); process.exit(1); }'
ENV NODE_ENV=production \
    FLAREALOY_DB=/data/flarealoy.sqlite \
    EDITOR=vi
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# `flarealoy` on the PATH for docker exec; busybox vi (/bin/vi) for `flarealoy security edit`.
RUN ln -s /app/dist/cli/main.js /usr/local/bin/flarealoy \
    && chmod 0755 /app/dist/cli/main.js \
    && mkdir -p /data && chown node:node /data && chmod 0700 /data
USER node
CMD ["node", "/app/dist/cli/main.js", "run"]
