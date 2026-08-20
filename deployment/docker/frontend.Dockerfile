FROM node:20-bookworm-slim AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.34.5 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json /app/
COPY artifacts/erp-ui/package.json /app/artifacts/erp-ui/package.json
COPY artifacts/api-server/package.json /app/artifacts/api-server/package.json
COPY artifacts/mobile/package.json /app/artifacts/mobile/package.json
COPY artifacts/mockup-sandbox/package.json /app/artifacts/mockup-sandbox/package.json
COPY lib/api-client-react/package.json /app/lib/api-client-react/package.json
COPY lib/api-spec/package.json /app/lib/api-spec/package.json
COPY lib/api-zod/package.json /app/lib/api-zod/package.json
COPY lib/db/package.json /app/lib/db/package.json
COPY scripts/package.json /app/scripts/package.json

RUN pnpm install --frozen-lockfile

COPY . /app

ARG VITE_API_BASE_URL=/
ARG BASE_PATH=/
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV BASE_PATH=${BASE_PATH}

RUN pnpm --filter @workspace/erp-ui run build

FROM nginx:1.27-alpine

COPY deployment/nginx/docker.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/artifacts/erp-ui/dist/public /usr/share/nginx/html

EXPOSE 80
