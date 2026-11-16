# video.json reference

A project is a folder with a `video.json`. Paths in it are relative to that
folder.

```json
{
  "title": "Orbit",
  "size": [1440, 860],
  "fps": 30,
  "output": "out/video.mp4",
  "theme": { "brand": "Orbit", "accent": "#4fcf85" },
  "voice": { "engine": "say", "voice": "Daniel" },
  "music": { "synth": true, "volume": 0.32 },
  "recordings": { "tour": { "url": "http://localhost:3000/", "steps": [] } },
  "scenes": []
}
```

| Field | Default | Meaning |
|---|---|---|
| `size` | `[1440, 860]` | Width and height in pixels. Both must be even. Recordings are filmed at this size unless they set `viewport`. |
| `fps` | `30` | Frames per second of the video. |
| `output` | `out/video.mp4` | Where the video is written. The contact sheet and report go beside it. |
| `theme` | dark, green accent | `background`, `foreground`, `muted`, `accent`, `accentInk` (text on the accent colour), `font`, `brand`. |
| `voice` | `say`, Daniel | See [voice.md](voice.md). |
| `music` | synthesised bed | `false` for none; `{ "file": "track.mp3" }` for your own; `volume` (0–1); `duck: false` to stop it dipping under the voice. |
| `recordings` | none | See [recording.md](recording.md). |

## Scenes

Scenes play in order. Any scene may have:

| Field | Meaning |
|---|---|
| `say` | The voiceover line spoken during this scene. |
| `caption` | Text shown in a box at the bottom (not on cards). |

**The voice sets the pace.** If a line is longer than its scene, a card or
image stays up longer, and a clip is slowed down (to half speed at most) and
then holds its last frame. Nothing is cut. The build tells you which scenes
were retimed.

### `card`: a title card

```json
{ "type": "card", "brand": true,
  "title": "Finding introgressions\nin your own genomes",
  "accent": "shouldn't take a bioinformatics team.",
  "subtitle": "Smaller grey text.",
  "button": "Join the waitlist", "note": "example.com/waitlist",
  "seconds": 3.5 }
```

- `title` is white; `accent` continues it in the accent colour.
- Break long titles yourself with `\n`. Left to wrap, they break in odd places.
- `brand: true` shows `theme.brand` above the title; a string shows that instead.
- `button` and `note` make an end card: a call to action and a link.

### `clip`: part of a video

```json
{ "type": "clip", "src": "clips/tour.mp4", "from": 6, "to": 18, "speed": 1.5,
  "caption": "Every accession against any reference", "say": "..." }
```

- `src` is a recording made by `comms record` or any video file (a screen
  recording from QuickTime, a phone video). Its own sound is not used.
- `from` / `to` are seconds in the source; `speed` 2 plays twice as fast.
- `minSpeed` (default 0.5) limits how far it may be slowed to fit the voice.
- A source of another shape is fitted inside the frame with bars in the
  background colour.

### `image`: a screenshot or picture

```json
{ "type": "image", "src": "shots/dashboard.png", "seconds": 5, "caption": "..." }
```

## What a build writes

| File | What it is |
|---|---|
| `out/video.mp4` | The video (H.264, AAC). |
| `out/contact-sheet.png` | One frame from the middle of every scene, in order. |
| `out/report.json` | Start and length of every scene, voice timings, audio levels, warnings, and which scenes were retimed. |
| `out/voice/01.wav …` | The voiceover lines, to listen to or replace. |
| `.cache/` | Rendered text, voice lines and music. Safe to delete; voice lines will regenerate. |
