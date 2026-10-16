# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @wealthpilot/shared && npm run build -w @wealthpilot/api && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages/shared/package.json packages/shared/
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json apps/api/
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/migrations apps/api/migrations
WORKDIR /app/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --retries=10 CMD wget -qO- http://127.0.0.1:3000/api/ready || exit 1
CMD ["node", "dist/server.js"]
