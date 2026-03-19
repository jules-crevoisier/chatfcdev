# ── Stage 1: build ────────────────────────────────────────────────
FROM rust:1-slim-bookworm AS builder

WORKDIR /build

# Cache dependencies in a separate layer.
# Copy manifests first, build a dummy binary, then replace with real source.
COPY backend/Cargo.toml backend/Cargo.lock ./
RUN mkdir src \
 && echo 'fn main() {}' > src/main.rs \
 && cargo build --release \
 && rm -rf src target/release/deps/chatserver*

# Build the real binary
COPY backend/src ./src
RUN cargo build --release

# ── Stage 2: runtime ──────────────────────────────────────────────
FROM debian:bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Binary
COPY --from=builder /build/target/release/chatserver .

# Frontend static files (baked into the image — rebuild to update)
COPY frontend ./frontend

# Persistent directories created at runtime via data/ and uploads/ volumes
RUN mkdir -p data uploads

EXPOSE 3000
ENV PORT=3000

CMD ["./chatserver"]
