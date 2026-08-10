# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM golang:1.24-bookworm AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config \
    libopus-dev \
    libopusfile-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /out/server .

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libopus0 \
    libopusfile0 \
    wget \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --no-create-home --shell /usr/sbin/nologin captionlive

WORKDIR /app
COPY --from=builder /out/server ./server

ENV HOST=0.0.0.0
ENV PORT=3000

USER captionlive
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["./server"]
