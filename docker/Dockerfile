# syntax=docker/dockerfile:1

# --- Stage 1: build doomgeneric from the doomreplay submodule -------------
FROM debian:bookworm-slim AS doom-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
	clang make \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY doomreplay/doomgeneric ./doomgeneric

# Makefile.dr hardcodes `LDFLAGS+=-Wl,-dead_strip`, an Apple ld64 flag that GNU/lld
# linkers on Linux reject outright. Command-line variables take precedence over the
# makefile's own `+=` assignment, so this override — not a submodule patch — is what
# makes it link here. Verify this still holds if Makefile.dr changes upstream.
RUN make -C doomgeneric -f Makefile.dr LDFLAGS="-Wl,--gc-sections"

# --- Stage 2: runtime -------------------------------------------------------
FROM oven/bun:1-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
	ffmpeg \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY tsconfig.json ./
COPY --from=doom-builder /build/doomgeneric/doomgeneric ./doomreplay/doomgeneric/doomgeneric

# doom1.wad is not in the repo (shareware, licensing) and data/ is a live volume —
# both are mounted at runtime via compose, not baked into the image.

ENV DOOMGENERIC_BIN=/app/doomreplay/doomgeneric/doomgeneric
ENV DOOM1_WAD=/app/doomreplay/doom1.wad
ENV DATA_DIR=/app/data
ENV PORT=6677

EXPOSE 6677

CMD ["bun", "run", "src/index.ts"]
