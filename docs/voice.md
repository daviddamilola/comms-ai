# Voiceover

Give a scene a `say` line and it is spoken during that scene. Print the whole
script with `comms script <project>`.

```json
"voice": { "engine": "say", "voice": "Daniel", "rate": 172,
           "pronounce": { "DOI": "D O I", "Tersect": "Ter-sect" } }
```

`pronounce` changes how words are *spoken* without changing captions. Use it
for acronyms and product names the voice gets wrong.

Shared settings: `lead` (seconds of scene before the voice starts, default
0.3), `tail` (seconds after it ends, 0.4), `volume` (0.95).

Every line is trimmed, brought to the same loudness and cached. Changing one
line regenerates one line. `comms voice <project> --redo 3,5` regenerates
lines 3 and 5 when a take sounds wrong.

## `say`: built-in macOS voices

Instant and free, and clearly synthetic. `say -v '?'` lists the voices.
`rate` is words per minute.

## `recorded`: read it yourself

The best-sounding option, and the fastest.

One file per line, named in script order:

```
voice/01.wav  voice/02.wav  voice/03.wav ...
```
```json
"voice": { "engine": "recorded" }
```

Or one take of the whole script, with a clear one-second pause between lines:

```json
"voice": { "engine": "recorded", "take": "voice/take.m4a" }
```

The take is split on its pauses. If the number of parts does not match the
number of lines, the build stops and says so.

## Recording single lines (any engine)

Any scene can carry its own recording, which is used instead of the
generated voice for that line:

```json
{ "type": "card", "title": "...", "say": "The line as written.", "sayFile": "voice/recordings/take.webm" }
```

The easy way to make one is the Studio (`comms ui <project>`): select the
scene, press **Record this line**, read the line, press **Stop and keep**.
Listen back, record again or remove it; then build. The browser asks for the
microphone the first time. Takes are saved in the project's
`voice/recordings/` folder, which is git-ignored.

This works with every engine, so you can draft with `say`, then re-record
only the lines that matter, or fix one line of a finished video without
touching the others. With the `recorded` engine, numbered files (`01.wav` …)
cover either every line or just the lines that have no recording of their own.

## `voicestudio`: your voice, cloned

Uses [VoiceStudio](https://github.com/daviddamilola/VoiceStudio) running on
your machine. Nothing is uploaded.

```json
"voice": {
  "engine": "voicestudio",
  "reference": "voice/reference.m4a",
  "referenceText": "Exactly what you said in the reference recording.",
  "engineId": "voxcpm2",
  "seed": 7
}
```

Or, once a profile exists, `"profile": "78df04ca"` instead of `reference`.

**Set up once**

```sh
scripts/voicestudio.sh install     # clones VoiceStudio, installs Python deps and VoxCPM
scripts/voicestudio.sh start       # serves http://localhost:3900 with the VoxCPM2 engine
comms doctor                       # should now report VoiceStudio as ok
scripts/voicestudio.sh stop        # when you are done: it holds several GB of memory
```

The first generated line downloads the model (about 5 GB for VoxCPM2).

**Record the reference**

10–20 seconds of you speaking in the tone you want, in a quiet room, the
microphone a hand's width away, with half a second of silence at each end.
Read sentences from your own script, and say product names the way you want
them heard: the clone copies your pronunciation. Quiet recordings are
levelled automatically. Reference recordings are personal data and are
git-ignored by default (`voice/reference.*`).

**Licences: check before you publish**

| Engine | Licence | Fine for an advert? |
|---|---|---|
| `voxcpm2` (VoxCPM2) | Apache-2.0 | Yes |
| `omnivoice` (VoiceStudio's default) | CC-BY-NC weights | No: non-commercial only |

VoiceStudio lists each model's licence in its Model Catalogue. Clone only
voices you have the right to use. Generated audio carries an inaudible
AudioSeal watermark marking it as AI-generated.

**Speed and memory**

VoxCPM2 holds about 12 GB of memory on Apple Silicon. On a 16 GB Mac that
leaves almost nothing, so expect 1–2 minutes per line once the model is warm
and several minutes for the first, and close everything you can: with Docker
Desktop running, warm-up steps took 100 seconds each instead of 4. Check
that Docker has really quit (`pgrep -f com.docker.backend` prints nothing),
and that only one backend is running (`scripts/voicestudio.sh status`).
On a machine with 32 GB or more none of this matters.
A 13-line script took about 20 minutes; because lines are cached, later
builds are instant unless you change a line.

Measured on a 16 GB M2 Pro: on a quiet machine, 13 lines in about 20 minutes
(40–130 s each); with an editor, a browser and two other tools open, one
cold line took 22 minutes, nearly all of it warm-up. Draft with `say` and
switch to the cloned voice for the final build only.

## `command`: any other text-to-speech

```json
"voice": { "engine": "command", "command": "espeak-ng -w {out} {text}" }
```

`{text}` and `{out}` (a `.wav` path) are filled in for each line.
