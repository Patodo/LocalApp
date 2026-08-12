FROM node:24-slim AS build

WORKDIR /src
RUN apt-get update \
    && apt-get install --yes --no-install-recommends build-essential ca-certificates curl pkg-config \
    && rm -rf /var/lib/apt/lists/* \
    && curl --proto '=https' --tlsv1.2 --fail --silent --show-error https://sh.rustup.rs \
      | sh -s -- -y --profile minimal --default-toolchain 1.91.1 \
    && npm install --global pnpm@10

ENV PATH="/root/.cargo/bin:${PATH}"

COPY . .
RUN pnpm install --frozen-lockfile
RUN mkdir -p /src/tmp/localapp-package \
    && pnpm -C packages/localapp pack --pack-destination /src/tmp/localapp-package

FROM node:24-slim AS runtime

WORKDIR /app
COPY --from=build /src/tmp/localapp-package/localapp-*.tgz /dist/
RUN npm install --global /dist/localapp-*.tgz \
    && rm -rf /dist \
    && mkdir -p /app/data \
    && chown -R node:node /app

USER node
EXPOSE 3000

ENV NODE_ENV=production

CMD ["localapp", "server", "run", "--host", "0.0.0.0", "--port", "3000", "--data-dir", "/app/data"]
