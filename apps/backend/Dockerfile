FROM node:20-alpine

WORKDIR /app

# Install postgresql-client for pg_isready and psql
RUN apk add --no-cache postgresql-client

# Copy root config files
COPY tsconfig.base.json ./

# Copy root package files (monorepo)
COPY package.json package-lock.json ./
COPY packages ./packages

WORKDIR /app/apps/backend

# Copy backend package and source
COPY apps/backend/package.json apps/backend/tsconfig.json ./
COPY apps/backend/src ./src
COPY apps/backend/drizzle.config.ts ./
COPY apps/backend/drizzle ./drizzle
COPY apps/backend/entrypoint.sh ./
COPY apps/backend/run-migrations.sh ./

WORKDIR /app

# Install dependencies and build shared-types
RUN npm install --legacy-peer-deps

# Ensure shared-types dist folder exists by building it
RUN cd /app/packages/shared-types && npx tsc

WORKDIR /app/apps/backend

# Make scripts executable
RUN chmod +x entrypoint.sh && chmod +x run-migrations.sh

EXPOSE 3000

ENTRYPOINT ["./entrypoint.sh"]
