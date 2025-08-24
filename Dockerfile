
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
WORKDIR /app
COPY . .
ENV NODE_ENV=production
ENV UPSTREAM=http://127.0.0.1:8080
EXPOSE 11434
CMD node proxy-server.js
