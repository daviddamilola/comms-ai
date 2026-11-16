# Notes for coding agents

`comms` turns a `video.json` into a product video. Read `README.md` first,
then `docs/project.md` and `docs/recording.md` for the file format.

Working rules, each learned the hard way (see `docs/lessons.md`):

- Run `comms doctor` before anything else, and trust exit codes: every
  command exits non-zero on failure.
- Film in small named recordings. Some steps change the user's app and can
  only be filmed once: confirm before recording anything that deletes or
  builds, and never delete the user's data to get a retake without asking.
- Wait on specific conditions (`for`, `enabled`, `gone`, `url`). Never on a
  word appearing anywhere on the page.
- After every build, open `out/contact-sheet.png` and read `out/report.json`.
  Report what you checked and what you could not: you can measure audio
  levels, you cannot hear the result.
- Voice cloning is slow and memory-hungry. Check free memory, do not run it
  beside Docker or a local LLM, and ask before downloading a model: state its
  size and licence. Clone only the user's own voice or one they may use.
- Reference recordings are personal data. Never commit or upload them.
- Do not put the user's private details into a video, a commit or a request
  to an outside service.

Code layout: `bin/comms.mjs` (commands), `src/record.mjs` + `src/locator.mjs`
+ `src/chrome.mjs` (filming), `src/voice.mjs`, `src/music.mjs`,
`src/plan.mjs` (timing), `src/render.mjs`, `src/text.mjs` (cards, captions),
`src/draft.mjs` (`init`), `src/doctor.mjs`. No npm dependencies; tests are
`npm test`.
