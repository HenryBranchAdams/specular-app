# syntax=docker/dockerfile:1.7
FROM node:22.23.1-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM dependencies AS verification
COPY . .
RUN npm run validate \
  && npm run eval \
  && npm run build \
  && npm run build:server \
  && npm run audit \
  && node scripts/verify-production.mjs

FROM dependencies AS development
COPY . .
ENV NODE_ENV=development
EXPOSE 5177 8788
CMD ["npm", "run", "dev"]

FROM node:22.23.1-bookworm-slim AS runtime-dependencies
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force

FROM node:22.23.1-bookworm-slim AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --from=runtime-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=verification --chown=node:node /app/package.json ./package.json
COPY --from=verification --chown=node:node /app/dist ./dist
COPY --from=verification --chown=node:node /app/dist-server ./dist-server
USER node
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8788/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "dist-server/index.js"]
