// Works out how long each scene lasts so that its voiceover line fits.
//
// A card or an image simply stays up longer. A clip is slowed down (never
// below `minSpeed`), and if that is not enough its last frame is held.
// Nothing is ever cut to fit: the voice sets the pace.
import { round } from "./util.mjs"

export const CARD_SECONDS = 3.5
export const IMAGE_SECONDS = 5
export const MIN_SPEED = 0.5

/**
 * scenes: project scenes. clipSeconds(scene) -> length of the source file.
 * voiceSeconds: Map(scene.index -> seconds of its voice line).
 * Returns [{ ...scene, start, seconds, speed, from, to, hold, voiceAt, notes }].
 */
export function plan(scenes, { clipSeconds, voiceSeconds = new Map(), lead = 0.3, tail = 0.4 }) {
  let clock = 0
  return scenes.map((scene) => {
    const voice = voiceSeconds.get(scene.index) ?? 0
    const need = voice ? lead + voice + tail : 0
    const notes = []
    let seconds, speed = 1, from = 0, to = 0, hold = 0
    if (scene.type === "clip") {
      const source = clipSeconds(scene)
      from = Math.max(0, scene.from ?? 0)
      to = Math.min(source, scene.to ?? source)
      if (scene.to != null && scene.to > source + 0.05) notes.push(`"to" (${scene.to} s) is past the end of the clip (${round(source, 1)} s); using the end`)
      speed = scene.speed ?? 1
      seconds = (to - from) / speed
      if (need > seconds + 0.01) {
        const minSpeed = Math.min(speed, scene.minSpeed ?? MIN_SPEED)
        const fitted = Math.max(minSpeed, (to - from) / need)
        if (fitted < speed) { notes.push(`slowed from x${round(speed)} to x${round(fitted)} to fit the voice line`); speed = fitted; seconds = (to - from) / speed }
        if (need > seconds + 0.01) { hold = need - seconds; notes.push(`last frame held ${round(hold, 1)} s to fit the voice line`); seconds = need }
      }
    } else {
      seconds = scene.seconds ?? (scene.type === "card" ? CARD_SECONDS : IMAGE_SECONDS)
      if (need > seconds) { notes.push(`lengthened from ${round(seconds, 1)} s to ${round(need, 1)} s to fit the voice line`); seconds = need }
    }
    const item = { ...scene, start: clock, seconds, speed, from, to, hold, voiceAt: voice ? clock + lead : null, voiceSeconds: voice, notes }
    clock += seconds
    return item
  })
}

export const totalSeconds = (timeline) => timeline.reduce((sum, scene) => sum + scene.seconds, 0)
