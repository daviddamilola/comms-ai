import assert from "node:assert/strict"
import { test } from "node:test"
import { normalise, validate } from "../src/config.mjs"
import { draftScenes, parseScript } from "../src/draft.mjs"
import { locator, stateOf } from "../src/locator.mjs"
import { synthesise, wavBytes } from "../src/music.mjs"
import { concatList } from "../src/record.mjs"
import { pronounce, segmentsFromSilence } from "../src/voice.mjs"

test("validation reports every problem at once, in words", () => {
  const project = normalise({ size: [1441, 860], voice: { engine: "robot" }, scenes: [{ type: "gif" }, { type: "clip" }, { type: "card" }] }, "/tmp/x")
  const problems = validate(project)
  assert.equal(problems.length, 5)
  assert.ok(problems.some((p) => p.includes("even numbers")))
  assert.ok(problems.some((p) => p.includes('"robot"')))
  assert.ok(problems.some((p) => p.includes("scene 2") && p.includes('"src"')))
})

test("a missing clip is only a problem at render time, with a hint", () => {
  const project = normalise({ scenes: [{ type: "clip", src: "clips/nope.mp4" }] }, "/tmp/x")
  assert.deepEqual(validate(project), [])
  assert.match(validate(project, { checkFiles: true })[0], /comms record/)
})

test("pronunciations replace whole words only", () => {
  assert.equal(pronounce("Paste a DOI, not a DOIX.", { DOI: "D O I" }), "Paste a D O I, not a DOIX.")
})

test("silence detection output becomes spoken segments", () => {
  const stderr = "silence_start: 0\nsilence_end: 0.4 | d\nsilence_start: 3.1\nsilence_end: 4.3 | d\nsilence_start: 7.9\nsilence_end: 9.0"
  assert.deepEqual(segmentsFromSilence(stderr, 12), [[0.4, 3.1], [4.3, 7.9], [9, 12]])
})

test("the script parser reads paragraphs, comments and media tags", () => {
  const parsed = parseScript("# intro\nFirst line\nwrapped.\n\n[shot.png] Look at this.\n\n[demo.mp4 12-20.5] Then this.\n\nThe end.")
  assert.deepEqual(parsed, [
    { text: "First line wrapped." },
    { media: "shot.png", from: undefined, to: undefined, text: "Look at this." },
    { media: "demo.mp4", from: 12, to: 20.5, text: "Then this." },
    { text: "The end." },
  ])
})

test("drafting puts tagged media where the script says and opens and closes on cards", () => {
  const scenes = draftScenes(parseScript("Hook.\n\nSee the list.\n\n[b.mp4 2-6] Watch it run.\n\nJoin us."), ["media/a.png", "media/b.mp4"])
  assert.deepEqual(scenes.map((s) => s.type), ["card", "image", "clip", "card"])
  assert.equal(scenes[1].src, "media/a.png")
  assert.deepEqual([scenes[2].src, scenes[2].from, scenes[2].to], ["media/b.mp4", 2, 6])
})

test("the concat list divides waits by the speed in force and caps stills", () => {
  const frames = [{ file: "a.jpg", t: 0 }, { file: "b.jpg", t: 1 }, { file: "c.jpg", t: 37 }, { file: "d.jpg", t: 38 }]
  const speeds = [{ t: 0, speed: 1 }, { t: 1, speed: 36 }, { t: 37, speed: 1 }]
  const list = concatList(frames, speeds, 60, 3.5).trim().split("\n")
  assert.deepEqual(list.filter((l) => l.startsWith("duration")), ["duration 1.0000", "duration 1.0000", "duration 1.0000", "duration 3.5000"])
  assert.equal(list.at(-1), "file 'd.jpg'")
})

test("locators match text by containment by default", () => {
  assert.match(locator("Review"), /includes\("Review"\)/)
  assert.match(locator({ text: "Home", exact: true }), /=== "Home"/)
  assert.match(locator({ label: "Close" }), /aria-label/)
  assert.match(stateOf("Build"), /"disabled"/)
})

test("the music loop is seamless, normalised and a valid WAV", () => {
  const samples = synthesise({ bar: 0.5 })
  let peak = 0
  for (const s of samples) peak = Math.max(peak, Math.abs(s))
  assert.ok(Math.abs(peak - 0.8) < 1e-4)
  // No click at the loop point: the jump from the last sample back to the
  // first is no bigger than the jumps between neighbours elsewhere.
  let step = 0
  for (let i = 1; i < samples.length; i++) step = Math.max(step, Math.abs(samples[i] - samples[i - 1]))
  assert.ok(Math.abs(samples[0] - samples.at(-1)) <= step)
  const wav = wavBytes(samples)
  assert.equal(wav.toString("ascii", 0, 4), "RIFF")
  assert.equal(wav.length, 44 + samples.length * 2)
})

test("postForm waits past fetch's five-minute limit and returns status and bytes", async () => {
  const { createServer } = await import("node:http")
  const { postForm } = await import("../src/voice.mjs")
  const server = createServer((request, response) => {
    let size = 0
    request.on("data", (chunk) => { size += chunk.length })
    request.on("end", () => { response.writeHead(request.headers["content-type"].startsWith("multipart/form-data") ? 200 : 400); response.end(`got ${size > 0}`) })
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const form = new FormData(); form.set("text", "hello"); form.set("file", new Blob(["abc"]), "a.wav")
  const answer = await postForm(`http://127.0.0.1:${server.address().port}/generate`, form, 5000)
  server.close()
  assert.equal(answer.status, 200)
  assert.equal(answer.body.toString(), "got true")
})

test("a missing per-scene recording is a problem at build time", () => {
  const project = normalise({ scenes: [{ type: "card", title: "x", say: "Hello", sayFile: "voice/recordings/nope.webm" }] }, "/tmp/x")
  assert.deepEqual(validate(project), [])
  assert.match(validate(project, { checkFiles: true })[0], /voice recording/)
})
