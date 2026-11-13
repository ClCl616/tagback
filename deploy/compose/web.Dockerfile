# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS build
ENV CI=true
RUN npm install --global pnpm@11.19.0
WORKDIR /src
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/src/ ./src/
COPY frontend/public/ ./public/
COPY frontend/index.html frontend/tsconfig.json frontend/vite.config.ts ./
RUN pnpm build

FROM nginx:1.30-alpine
COPY deploy/compose/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist/ /usr/share/nginx/html/
EXPOSE 443
