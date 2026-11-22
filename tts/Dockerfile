# OmniVoice TTS Multi-Stage Dockerfile
# Stage 1: Build React TypeScript Frontend
FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Python Backend with CUDA & CPU fallback support
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Install system audio and build utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libsndfile1 \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install PyTorch and Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cu121 || \
    pip install --no-cache-dir torch torchaudio && \
    pip install --no-cache-dir -r requirements.txt

# Copy Backend Source
COPY backend/ ./backend

# Copy Built Frontend Assets
COPY --from=frontend-builder /app/frontend/dist ./frontend_dist

WORKDIR /app/backend
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
