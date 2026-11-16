# Lessons from the first videos

This tool was extracted from making a product walkthrough and an advert by
hand. Each row is something that went wrong then, and what the tool does so
it does not happen again.

## Recording

| What went wrong | What the tool does |
|---|---|
| The recorder decided a build had failed because the word "failed" appeared in the build's log, and stopped filming a build that was fine. | Waits take a specific condition (`for`, `enabled`, `gone`, `url`, `text` inside one element). There is no "page mentions X" failure check, and the docs say why. |
| A click on a step marker failed because its text was "4Review", not "Review". | Text matches by containment by default; `exact` and `starts` are opt-in. |
| A wait on a button that was correctly disabled ran forever. | `click` waits for the element to be enabled and reports "on the page but disabled" separately from "not on the page". |
| That same wait saved every frame of a spinner: 763 MB in minutes, on a nearly full disk. | Frames are kept at about 12 per second of *finished video*, whatever the fast-forward speed. Recording refuses to start with less than 2 GB free, and raw frames are deleted after encoding. |
| A page stopped answering and the recorder hung for ten minutes with no error. | Every browser call has a deadline, and every step has a timeout. |
| The recording script printed "exit 0" although its log said FAILED. | Every command exits non-zero on failure; a failed take is saved under another name (`.failed.mp4`) with a screenshot, and never replaces a good clip. |
| Two recorders fought over one debugging port, and stopping one meant killing Chrome by port number. | Chrome is started on a free port chosen by the system, with its own temporary profile, and is always shut down. |
| One long take failed near the end and everything before it had to be filmed again, including steps that change the app. | Recordings are named and filmed one at a time (`comms record project tour`). The docs recommend splitting, and note which steps can only be filmed once. |

## Rendering

| What went wrong | What the tool does |
|---|---|
| ffmpeg's `drawtext` filter was missing from the installed build. | Cards and captions are HTML rendered to PNG by Chrome. |
| Long card titles wrapped in ugly places. | `\n` in a title is a line break; the docs say to break long titles yourself. |
| A contact sheet sampled at fixed intervals skipped the short cards and showed fade frames, so the cards looked missing. | The contact sheet takes one frame from the middle of every scene. |
| "It rendered" was reported before anyone had looked at it. | Every build writes a contact sheet and a report, and says to look and listen. |
| `ffmpeg` was not found in shells that had not loaded Homebrew's path. | Tools are also looked for in `/opt/homebrew/bin` and `/usr/local/bin`; `comms doctor` reports what it found. |

## Voice and sound

| What went wrong | What the tool does |
|---|---|
| Voice lines were timed by hand against scenes, and one nearly overlapped the next. | The voice sets the pace: scenes stretch to fit their line, and the report lists every retimed scene. |
| The first mix clipped, and the music was too loud under the voice. | Lines are normalised to one loudness, the music ducks under the voice, a limiter caps the mix, and the build warns if peaks are near 0 dB. |
| The voice-clone reference was a very quiet phone recording. | References are levelled before cloning, with a warning if they are too short or long. |
| The default cloning model turned out to be non-commercial, discovered just before generating an advert. | The voice guide lists each engine's licence; examples use the Apache-2.0 engine. |
| The cloning model crawled (100 s per step) because Docker held the memory. | The voice step warns on machines with 16 GB or less; the guide says what to quit. |
| Regenerating one bad line meant regenerating all of them. | Lines are cached by text and voice settings; `--redo 3,5` regenerates chosen lines. |
| The first cloned line through this tool died with "fetch failed" after exactly five minutes: Node's `fetch` gives up when a server takes that long to answer, and a cold model does. | Voice requests use a plain HTTP request that waits as long as `voice.timeout` allows (30 minutes by default). |
| Docker Desktop was asked to quit but was still running, and the model crawled again. | The memory warning names what is actually running ("Docker Desktop is running: quit it first"). |
| Stopping the voice backend left the old one alive, finishing a job; the next start found it "ready" and two copies of the model were loaded. | `scripts/voicestudio.sh stop` asks, waits, then force-stops, and clears whatever still holds the port. |
| The backend itself abandoned a line after 300 seconds of compute while the model was still warming up. | `scripts/voicestudio.sh start` allows 30 minutes a line, and the error explains what to do instead of printing a stack trace. |
| An HTTP error body could have been saved as "audio.wav". | Responses are checked before saving, and every audio file is probed before use. |
| Acronyms were read as words. | `voice.pronounce` rewrites words for the voice only. |

## Still manual

- Listening. The tool measures loudness; it cannot hear whether a cloned
  voice sounds like you or mispronounces a name.
- Getting your app into the right state before filming.
- Claims in the script. Check anything that compares you with others.
