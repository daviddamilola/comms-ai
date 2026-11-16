// An original music bed, synthesised here so there is nothing to license:
// slow pad chords, a soft bass and a plucked arpeggio, in a seamless loop.
// Use your own track instead with  "music": { "file": "track.mp3" }.
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { ensureDir, sha, UserError } from "./util.mjs"

const RATE = 22050
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12)
export const DEFAULT_SYNTH = {
  // MIDI notes per chord: Am, F, C, G
  chords: [[57, 60, 64, 69], [53, 57, 60, 65], [48, 55, 60, 64], [55, 59, 62, 67]],
  bar: 4,            // seconds per chord
  arpeggio: true,
}

/** Samples (Float32Array, mono, peak 0.8) of one loop. */
export function synthesise(options = {}) {
  const { chords, bar, arpeggio } = { ...DEFAULT_SYNTH, ...options }
  const length = Math.round(RATE * bar * chords.length)
  const buffer = new Float32Array(length)
  const add = (start, seconds, frequency, amplitude, attack, release, harmonics) => {
    const first = Math.round(start * RATE), count = Math.round(seconds * RATE)
    for (const [multiple, level] of harmonics) {
      const w = (2 * Math.PI * frequency * multiple) / RATE
      for (let i = 0; i < count; i++) {
        const t = i / RATE
        const envelope = Math.min(1, t / attack) * Math.min(1, (seconds - t) / release)
        // Wrapping the index makes notes that run past the end fade into the
        // start, which is what makes the loop seamless.
        buffer[(((first + i) % length) + length) % length] += amplitude * level * envelope * Math.sin(w * i)
      }
    }
  }
  chords.forEach((chord, c) => {
    const start = c * bar
    add(start - 0.6, bar + 1.4, hz(chord[0] - 12), 0.2, 1.2, 1.4, [[1, 1], [2, 0.3]])
    for (const note of chord) add(start - 0.6, bar + 1.4, hz(note), 0.085, 1.4, 1.6, [[1, 1], [2, 0.25], [3, 0.08]])
    if (arpeggio) {
      const order = [0, 2, 1, 3, 2, 1, 3, 2]
      const step = bar / order.length
      order.forEach((n, k) => add(start + k * step, 0.9, hz(chord[n % chord.length] + 12), 0.07, 0.01, 0.85, [[1, 1], [2, 0.15]]))
    }
  })
  let peak = 0
  for (const sample of buffer) peak = Math.max(peak, Math.abs(sample))
  for (let i = 0; i < length; i++) buffer[i] = (buffer[i] / peak) * 0.8
  return buffer
}

export function wavBytes(samples, rate = RATE) {
  const data = Buffer.alloc(44 + samples.length * 2)
  data.write("RIFF", 0); data.writeUInt32LE(36 + samples.length * 2, 4); data.write("WAVEfmt ", 8)
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22)
  data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34)
  data.write("data", 36); data.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2)
  return data
}

/** Path of the music source for this project: the user's file or a synthesised loop. */
export function musicSource(project) {
  const music = project.music
  if (!music) return null
  if (music.file) {
    const file = project.at(music.file)
    if (!existsSync(file)) throw new UserError(`music.file ${music.file} does not exist`)
    return { file, loop: music.loop ?? true }
  }
  if (!music.synth) return null
  const options = music.synth === true ? {} : music.synth
  const file = join(ensureDir(join(project.root, ".cache", "music")), `${sha(options, DEFAULT_SYNTH)}.wav`)
  if (!existsSync(file)) writeFileSync(file, wavBytes(synthesise(options)))
  return { file, loop: true }
}
