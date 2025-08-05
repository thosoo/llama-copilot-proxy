# syntax=docker/dockerfile:1
FROM node:18-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm install --production

FROM node:18-alpine AS dev
WORKDIR /app
COPY . .
RUN npm install --legacy-peer-deps

FROM base AS prod
COPY . .
ENV NODE_ENV=production
EXPOSE 11434
CMD ["node", "inject-capabilities.js"]

# For development, use the 'dev' stage
# docker build --target dev -t llama-copilot-proxy:dev .
# For production, use the default 'prod' stage
# docker build -t llama-copilot-proxy:latest .
