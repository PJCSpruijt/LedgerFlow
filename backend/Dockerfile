FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

# Install deps separately for cache
FROM base AS deps
COPY package.json ./
RUN npm install --no-audit --no-fund

# Dev image — used by docker-compose with bind mount
FROM deps AS dev
COPY . .
RUN npx prisma generate || true
EXPOSE 4000
CMD ["npm", "run", "dev"]

# Production build
FROM deps AS build
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS prod
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
EXPOSE 4000
CMD ["node", "dist/index.js"]
