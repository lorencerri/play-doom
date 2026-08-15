## doomreplay

A fork of [@ggerganov/doomreplay](https://github.com/ggerganov/doomreplay), with some modifications.

**Changes**

- Input is an argument instead of a file
- Added `-renderNthFrame <number>` option
- Added `.gif` output support
  - You can use `-renderNthFrame <number>` to optimize the .gif filesize
- Added `.png` output support
  - This will only render the last frame
- Remapped strafe left to 'j' and strafe right to 'k'

**Usage** <br> _See [/examples](https://github.com/lorencerri/doomreplay/tree/master/examples)_

```sh
doomreplay
	-iwad <doom1.wad file> # Path for the doom1.wad file (you can find this somewhere else on GitHub)
	-input <keys> # e.g. `-input "x,,e,,e,,e,,"`
	-nrecord <number> # Maximum amount of frames from ending to output e.g. `-nrecord 10` would record the last 10 frames
	-framerate <number> # Amount of frames rendered per second for FFMPEG e.g. `-framerate 30`
	-renderNthFrame <number> # Render every Nth frame e.g. `-renderNthFrame 10` would render every 2nd frame. If you set -nrecord, you can get a static maxmimum filesize e.g. `-nrecord 1000 -renderNthFrame 10` would render the last 1000 frames, but only every 10th frame of the replay.
	-output <path> # Path for the output file. e.g. `-output ./doomreplay.png` or `-output ./doomreplay.gif`
	-render_frame # Required
	-render_input # Required
	-render_username # Required
```

**Build**

```
cd doomgeneric
make -f Makefile.dr
```

**Input**

```
,   - new frame
x   - escape
e   - enter
l   - left
r   - right
u   - up
d   - down
a   - alt
s   - shift
p   - use
f   - fire
t   - tab
y   - yes
n   - no
j   - strafe left
k   - strafe right
2-7 - weapons
```
