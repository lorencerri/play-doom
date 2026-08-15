# syntax=docker/dockerfile:1

# --- Stage 1: build doomgeneric from the vendored doomreplay source -------
FROM debian:bookworm-slim AS doom-builder

RUN apt-get update && apt-get install -y --no-install-recommends \
	clang make \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /build
# Vendored rather than a submodule: the encoder patch in doomgeneric_dr.c has to
# ship with the API that sets DR_FFMPEG_ARGS_*, and a submodule would split that
# one change across two repositories.
COPY vendor/doomreplay/doomgeneric ./doomgeneric

# Makefile.dr hardcodes `LDFLAGS+=-Wl,-dead_strip`, an Apple ld64 flag that GNU/lld
# linkers on Linux reject outright. Command-line variables take precedence over the
# makefile's own `+=` assignment, so this override — not a submodule patch — is what
# makes it link here. Verify this still holds if Makefile.dr changes upstream.
RUN make -C doomgeneric -f Makefile.dr LDFLAGS="-Wl,--gc-sections"

# --- Stage 2: runtime -------------------------------------------------------
FROM oven/bun:1-slim AS runtime

# fonts-dejavu-core is not optional: sharp renders the input-history and stats
# images from an SVG, and with no font installed fontconfig resolves nothing and
# the text comes out blank on an otherwise valid PNG. The layout in
# render/text-image.ts assumes DejaVu Sans Mono's advance width specifically.
RUN apt-get update && apt-get install -y --no-install-recommends \
	ffmpeg fonts-dejavu-core \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src
# The quick.db migration runs against the mounted data volume, so it has to be
# reachable from inside the container: `docker compose exec play-doom bun run
# scripts/migrate-quickdb.ts /app/data/json.sqlite`.
COPY scripts ./scripts
COPY tsconfig.json ./
COPY --from=doom-builder /build/doomgeneric/doomgeneric ./vendor/doomreplay/doomgeneric/doomgeneric

# doom1.wad is not in the repo (shareware, licensing) and data/ is a live volume —
# both are mounted at runtime via compose, not baked into the image.

ENV DOOMGENERIC_BIN=/app/vendor/doomreplay/doomgeneric/doomgeneric
ENV DOOM1_WAD=/app/vendor/doomreplay/doom1.wad
ENV DATA_DIR=/app/data
ENV PORT=6677

EXPOSE 6677

CMD ["bun", "run", "src/index.ts"]
