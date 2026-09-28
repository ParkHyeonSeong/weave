FROM python:3.13-slim

WORKDIR /app

# System dependencies
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies — exact versions from constraints.txt (its header says how to update them)
COPY pyproject.toml constraints.txt ./
RUN pip install --no-cache-dir -c constraints.txt .

# Copy application code
COPY . .

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]

# Development: uvicorn with hot-reload
# --ws-max-size: WebSocket 프레임 전송계층 하드캡(2MB) — 앱 레벨 WS_MAX_MESSAGE_BYTES와 함께 대형 프레임 DoS 차단(SEC-20)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload", "--ws-max-size", "2097152"]
