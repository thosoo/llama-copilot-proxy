# syntax=docker/dockerfile:1
FROM python:3.11-slim AS base
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

FROM base AS dev
WORKDIR /app
COPY . .
RUN pip install --no-cache-dir -r requirements.txt

FROM base AS prod
WORKDIR /app
COPY . .
ENV UPSTREAM=http://127.0.0.1:8080
ENV LISTEN_HOST=0.0.0.0
ENV LISTEN_PORT=11434
ENV THINKING_MODE=default
ENV THINKING_DEBUG=false
ENV VERBOSE=false
EXPOSE 11434
CMD ["python3", "proxy_server.py"]
