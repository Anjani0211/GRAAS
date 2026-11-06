# ── GRASS API Dockerfile ──────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
# Full install (includes devDeps) so tsc has @types/* available
RUN npm ci
COPY . .
RUN npm run build

# Separate prod-only deps layer to keep runner image small
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# Install Chromium for Puppeteer
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_DOWNLOAD=true
COPY --from=deps    /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
RUN mkdir -p uploads/evidence
EXPOSE 8000
CMD ["node", "dist/app.js"]
