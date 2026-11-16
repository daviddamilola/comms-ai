# Example: a 90-second product advert

The `video.json` here is the real project behind the first video made with
this pipeline: an advert for Tersect Browser, a genome comparison tool. Use
it as a reference for a full-length video: 15 scenes, 13 voice lines, one
recording definition, captions over sped-up footage, and an end card.

It is not runnable from a fresh clone, because its inputs are not in the
repository:

| Input | What it is | How it was made |
|---|---|---|
| `clips/plot.mp4` | The plot, tree, gene track and variant search | `comms record examples/tersect-ad plot`, with the app running locally |
| `footage/assistant.mp4`, `footage/build.mp4` | Adding a dataset with the assistant, then building it | Filmed earlier; they change the app, so they were recorded once |
| `voice/01.wav … 13.wav` | The voiceover | A cloned voice (VoiceStudio, VoxCPM2), used here through the `recorded` engine |

Things to copy from it:

- One long recording is cut into several `clip` scenes with `from` / `to`,
  each with its own caption and line, at speeds from 1.3× to 4.5×.
- Two consecutive scenes share a caption while the footage changes source.
- Card titles are broken by hand with `\n`.
- `pronounce` makes the voice say "D O I" while the caption shows "DOI".
