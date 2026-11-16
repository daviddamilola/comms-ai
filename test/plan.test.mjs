import assert from "node:assert/strict"
import { test } from "node:test"
import { plan, totalSeconds } from "../src/plan.mjs"

const clipSeconds = () => 20
const scene = (extra, index = 0) => ({ index, ...extra })

test("a card keeps its default length without a voice line", () => {
  const [card] = plan([scene({ type: "card" })], { clipSeconds })
  assert.equal(card.seconds, 3.5)
  assert.equal(card.voiceAt, null)
})

test("a card is lengthened to fit its voice line, never cut", () => {
  const [card] = plan([scene({ type: "card" })], { clipSeconds, voiceSeconds: new Map([[0, 6]]), lead: 0.3, tail: 0.4 })
  assert.equal(card.seconds, 6.7)
  assert.equal(card.voiceAt, 0.3)
  assert.match(card.notes[0], /lengthened/)
})

test("a clip is slowed to fit, and no further than minSpeed", () => {
  const [clip] = plan([scene({ type: "clip", src: "a.mp4", from: 0, to: 10, speed: 2 })], { clipSeconds, voiceSeconds: new Map([[0, 7.3]]), lead: 0.3, tail: 0.4 })
  assert.equal(clip.seconds, 8)                 // 10 s of footage / 1.25
  assert.equal(clip.speed, 1.25)
  assert.equal(clip.hold, 0)
})

test("when slowing is not enough the last frame is held", () => {
  const [clip] = plan([scene({ type: "clip", src: "a.mp4", from: 0, to: 2, speed: 1 })], { clipSeconds, voiceSeconds: new Map([[0, 9.3]]), lead: 0.3, tail: 0.4 })
  assert.equal(clip.speed, 0.5)
  assert.ok(Math.abs(clip.seconds - 10) < 1e-9)
  assert.ok(Math.abs(clip.hold - 6) < 1e-9)
})

test("a clip that already fits is left alone", () => {
  const [clip] = plan([scene({ type: "clip", src: "a.mp4", from: 5, to: 15, speed: 2 })], { clipSeconds, voiceSeconds: new Map([[0, 3]]) })
  assert.equal(clip.speed, 2)
  assert.equal(clip.seconds, 5)
  assert.deepEqual(clip.notes, [])
})

test('"to" past the end of the clip uses the end and says so', () => {
  const [clip] = plan([scene({ type: "clip", src: "a.mp4", from: 0, to: 99 })], { clipSeconds })
  assert.equal(clip.to, 20)
  assert.match(clip.notes[0], /past the end/)
})

test("scenes start where the previous one ends, and voice lines never overlap", () => {
  const scenes = [scene({ type: "card" }, 0), scene({ type: "clip", src: "a.mp4", from: 0, to: 4 }, 1), scene({ type: "image", src: "a.png" }, 2)]
  const timeline = plan(scenes, { clipSeconds, voiceSeconds: new Map([[0, 5], [1, 5], [2, 5]]) })
  assert.equal(timeline[1].start, timeline[0].seconds)
  for (let i = 0; i + 1 < timeline.length; i++) assert.ok(timeline[i].voiceAt + timeline[i].voiceSeconds < timeline[i + 1].voiceAt)
  assert.equal(totalSeconds(timeline), timeline.reduce((s, x) => s + x.seconds, 0))
})
