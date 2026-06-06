# --- build ---
FROM node:20-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages ./packages
RUN apt-get update && apt-get install -y python3 build-essential && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile
RUN VITE_API_BASE="" pnpm --filter @allure-station/web build

# --- runtime ---
FROM node:20-bookworm-slim AS runtime
RUN corepack enable
WORKDIR /app
COPY --from=build /app ./
ENV DATA_DIR=/data WEB_DIST=/app/packages/web/dist PORT=5050
VOLUME /data
EXPOSE 5050
HEALTHCHECK --interval=10s CMD node -e "fetch('http://localhost:5050/version').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@allure-station/server", "start"]
