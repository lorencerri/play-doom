## play-doom

An API wrapper for [@lorencerri/doomreplay](https://github.com/lorencerri/doomreplay), enter the submodule for more information.

**Endpoints**

```sh
GET /raw/:file # Storage for raw replay data (videos, gifs, etc.)

GET /frame/:namespace # Returns the current game frame

GET /video/:namespace/full # Returns the full video (all runs concatenated)
GET /video/:namespace/current # Returns a video of the current run

GET /input/:namespace?img=true # Returns an image or text
GET /input/:namespace/reset?callback="" # Resets the input buffer
GET /input/:namespace/append?keys=""&callback="" # Appends keys to the input buffer
GET /input/:namespace/rewind?amount=0&callback="" # Rewinds the input buffer by N keys
```

**Notes**

- Use `git clone --recursive https://github.com/lorencerri/play-doom.git` to clone play-doom & doomreplay
- Use [vscode-drawio](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio) to open `play-doom.drawio` in vscode
