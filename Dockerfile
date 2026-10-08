FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY shared ./shared
COPY proto ./proto
COPY scripts ./scripts
ARG SERVICE
ENV SERVICE=${SERVICE}
WORKDIR /app/services/${SERVICE}
COPY services/${SERVICE}/package.json services/${SERVICE}/package-lock.json ./
RUN npm ci
COPY services/${SERVICE}/ ./
RUN if [ -f prisma/schema.prisma ]; then DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate; fi
CMD ["sh", "/app/scripts/start-service.sh"]
