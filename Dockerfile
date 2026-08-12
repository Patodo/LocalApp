FROM node:24-slim AS runtime

WORKDIR /app
COPY tmp/localapp-package/localapp-*.tgz /dist/localapp.tgz
RUN npm install --global /dist/localapp.tgz \
    && rm -rf /dist \
    && mkdir -p /app/data \
    && chown -R node:node /app

USER node
EXPOSE 3000

ENV NODE_ENV=production

CMD ["localapp", "server", "run", "--host", "0.0.0.0", "--port", "3000", "--data-dir", "/app/data"]
