# comms-ai

Content creation pipeline for software makers. Point it at your running app,
a script and whatever screenshots or recordings you have, and it produces a
finished product video: title cards, filmed walkthroughs with captions,
voiceover, music and an end card.

```
video.json ──► comms record ──► clips/*.mp4     (films your web app in headless Chrome)
           └─► comms build  ──► out/video.mp4   (cards + clips + captions + voice + music)
                                out/contact-sheet.png, out/report.json
```

Everything runs on your machine and nothing is uploaded.

The repository holds two apps:

| App | What it is |
|---|---|
| [`apps/cli`](apps/cli) | The `comms` command line. Does all the work; has no npm dependencies. |
| [`apps/studio`](apps/studio) | The Studio: a local web page (React) for editing a video's storyboard, building it and watching the result. Opened with `comms ui`. |

## Install

You need Node 22+, ffmpeg and Chrome.

```sh
git clone https://github.com/daviddamilola/comms-ai && cd comms-ai
brew bundle            # macOS: node, ffmpeg, Google Chrome
npm install            # only needed for the Studio
npm run build          # builds the Studio's page
npm link               # puts `comms` on your PATH (or run `node apps/cli/bin/comms.mjs`)
comms doctor           # checks every dependency and says how to fix what is missing
```

On Linux install `nodejs`, `ffmpeg` and `chromium` with your package manager,
then run `comms doctor`.

## Try it

The repository contains a small made-up app to film:

```sh
comms record examples/demo     # films examples/demo/site in headless Chrome
comms build examples/demo      # writes examples/demo/out/video.mp4
```

## Make a video for your project

Three ways to start, from least to most material in hand:

```sh
# 1. A starter project to edit
comms init videos/launch

# 2. From a script: one paragraph per scene
comms init videos/launch --script script.txt

# 3. From a script plus screenshots and screen recordings you already have
comms init videos/launch --script script.txt --media ~/Desktop/shots
```

In a script, a paragraph can say what is on screen while it is spoken:

```
Finding what changed should not take all morning.

[dashboard.png] Orbit puts the week on one page.

[demo.mov 12-20] Name a project and it reads the activity for you.

Join the waitlist.
```

Then edit `video.json` ([reference](docs/project.md)) and build:

```sh
comms record videos/launch     # only if the project films a web app
comms build videos/launch
```

`build` prints where the video is and writes a contact sheet with one frame
per scene. Look at the sheet and listen to the video before sharing it.

## The Studio

```sh
comms ui videos/launch
```

opens a page in your browser for that project:

- **Storyboard**: every scene as a tile with a thumbnail. Reorder with the
  arrows or by dragging, add cards, clips and images, duplicate, delete, undo.
- **Scene editor**: titles, captions, voice lines, which file a clip uses and
  which part of it. Changes are saved to `video.json` as you type.
- **Build and preview**: one button builds the video (untick "With voiceover"
  for a quick draft), shows the log while it runs, then plays the result
  beside its warnings and contact sheet. Problems that would stop a build are
  listed, and the button stays off until they are fixed.
- **Video settings**: title, brand, accent colour, voice and music.

The Studio edits the same `video.json` and runs the same commands as the
command line, so you can switch between them freely. It listens on your own
machine only (`127.0.0.1`). Recording your app and re-doing single voice
lines are still done from the command line.

## Commands

| Command | What it does |
|---|---|
| `comms doctor [project]` | Checks Node, ffmpeg, Chrome, voices, memory and disk |
| `comms init <folder>` | Starts a project; `--script`, `--media`, `--title`, `--force` |
| `comms record <project> [name ...]` | Films the recordings defined in `video.json` |
| `comms script <project>` | Prints the voiceover lines, numbered |
| `comms voice <project>` | Generates the voiceover only; `--redo 3,5` regenerates lines |
| `comms build <project>` | Voice, music and render; `--redo 3,5`, `--no-voice` |
| `comms sheet <video>` | Contact sheet of any video; `--every 5` |
| `comms ui <project>` | Opens the Studio and starts VoiceStudio if it is installed (stopping it again on exit if it was not already running); `--port 4400`, `--no-open`, `--no-voicestudio` |

Every command exits non-zero when it fails.

## Voices

| `voice.engine` | Sounds like | Speed | Needs |
|---|---|---|---|
| `say` | A built-in macOS voice | Instant | macOS |
| `voicestudio` | Your own voice, cloned | 1–2 min a line on a 16 GB Mac | [VoiceStudio](docs/voice.md) running locally |
| `recorded` | You | As fast as you read | A recording of the script |
| `command` | Any TTS program | Varies | e.g. `espeak-ng` |
| `none` | Silence | | |

Lines are cached, so changing one sentence regenerates one sentence. See
[docs/voice.md](docs/voice.md), including the licence of each cloning model.

## Documentation

- [docs/project.md](docs/project.md): every field of `video.json`
- [docs/recording.md](docs/recording.md): filming a web app, step by step
- [docs/voice.md](docs/voice.md): voices, cloning your own, recording yourself
- [docs/lessons.md](docs/lessons.md): what went wrong making the first videos and how the tool now prevents it

## Development

```sh
npm install
npm test                         # both apps
npm run dev -w @comms-ai/studio  # the Studio's page with live reload on :4401
comms ui examples/demo --no-open # ...and its server on :4400, which the page talks to
```
