## play-doom

An API wrapper for [@lorencerri/doomreplay](https://github.com/lorencerri/doomreplay), enter the submodule for more information.

**Endpoints**

```sh
GET /frame/:namespace # Returns the current game frame

GET /video/:namespace/full # Returns the full video (all runs concatenated)
GET /video/:namespace/current

GET /input/:namespace/reset?callback=""
GET /input/:namespace/append?keys=""&callback=""
GET /input/:namespace/rewind?amount=0&callback=""
```

**Notes**

- Use `git clone --recursive https://github.com/lorencerri/play-doom.git` to clone play-doom & doomreplay
- Use [vscode-drawio](https://marketplace.visualstudio.com/items?itemName=hediet.vscode-drawio) to open `play-doom.drawio` in vscode
