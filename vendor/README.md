# vendor/

Third-party source built into this repo rather than pulled in at build time.

## doomreplay

`doomreplay/doomgeneric` is the C source of [lorencerri/doomreplay](https://github.com/lorencerri/doomreplay),
a fork of [ozkl/doomgeneric](https://github.com/ozkl/doomgeneric) that replays a
recorded key sequence and pipes rendered frames to ffmpeg. It was a git submodule
until the phase 3 rebuild.

**Why vendored.** The encoder fix (plan §1.3/§1.4) changes `doomgeneric_dr.c` *and*
the API code that drives it. As a submodule those two halves land in different
repositories, so a checkout could carry an API that sets `DR_FFMPEG_ARGS_*` against
a binary that ignores them, or the reverse. Vendoring makes the pair atomic.

**Local modifications.** Only `doomgeneric_dr.c` differs from upstream — the ffmpeg
command line it builds is now assembled from environment variables, with defaults
that reproduce the previous hardcoded strings exactly. Every change is marked with
a `play-doom:` comment. Keep it that way, so a future rebase onto upstream can find
them.

`examples/` (12.8MB of sample gifs and mp4s) was not vendored; it is not a build
input. The full upstream tree is still at the URL above.

**Building.** `docker/Dockerfile` stage 1 runs
`make -C doomgeneric -f Makefile.dr LDFLAGS="-Wl,--gc-sections"`. The override
matters: `Makefile.dr` hardcodes `-Wl,-dead_strip`, an Apple ld64 flag that GNU/lld
rejects.

`doom1.wad` is not here — it is shareware and mounted at runtime.

Licensed under the GPL; see `doomreplay/LICENSE`.
