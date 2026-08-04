FROM node:26-slim AS build

WORKDIR /src
RUN npm install --global pnpm@10

COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm -C packages/server-core build \
    && pnpm -C packages/web build \
    && pnpm -C packages/server build

FROM node:26-slim AS runtime

WORKDIR /app
RUN npm install --global pnpm@10

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/server/package.json packages/server/
COPY packages/server-core/package.json packages/server-core/
COPY packages/backend/package.json packages/backend/
COPY packages/sdk-core/package.json packages/sdk-core/
COPY packages/sdk-react/package.json packages/sdk-react/
COPY packages/sdk-agent/package.json packages/sdk-agent/
COPY packages/web/package.json packages/web/
COPY packages/desktop/package.json packages/desktop/
COPY init-repo/package.json init-repo/
COPY init-repo/runtime/package.json init-repo/runtime/

RUN pnpm install --frozen-lockfile --prod --filter @localapp/server...

COPY --from=build /src/packages/server/dist/ packages/server/dist/
COPY --from=build /src/packages/server-core/dist/ packages/server-core/dist/
COPY --from=build /src/packages/web/out/ packages/web/out/

RUN mkdir -p /app/data \
    && chown -R node:node /app

USER node
WORKDIR /app/packages/server

EXPOSE 3000

ENV NODE_ENV=production
ENV DATA_DIR=/app/data

CMD ["node", "dist/index.js"]
