FROM node:20-alpine AS builder
WORKDIR /app

# Copy package configuration
COPY package*.json ./
COPY server/package*.json ./server/

# Install build dependencies
RUN npm ci
RUN cd server && npm ci

# Copy full source
COPY . .

# Run build
RUN npm run build

# Production runner image
FROM node:20-alpine AS runner
WORKDIR /app

# Copy production packages and files
COPY server/package*.json ./server/
RUN cd server && npm ci --only=production

# Copy build outputs
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/server/eng.traineddata ./server/eng.traineddata
COPY --from=builder /app/server/ara.traineddata ./server/ara.traineddata

ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000

WORKDIR /app/server
CMD ["node", "dist/main.js"]
