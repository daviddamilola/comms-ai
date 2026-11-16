import type { Scene, SceneType } from "./types"

/** A new scene of a type, with just enough in it to be valid once filled in. */
export function blank(type: SceneType): Scene {
  return type === "card" ? { type, title: "A new card" } : { type, src: "" }
}

export function move<T>(items: T[], from: number, to: number): T[] {
  const next = [...items]
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}

const SHARED = ["say", "sayFile", "caption"] as const
const OWN: Record<SceneType, (keyof Scene)[]> = {
  card: ["title", "accent", "subtitle", "brand", "button", "note", "seconds"],
  clip: ["src", "from", "to", "speed"],
  image: ["src", "seconds"],
}

/** Change a scene's type, keeping only what the new type understands. A
 *  caption becomes a card's title and back, so the words are not lost. */
export function retype(scene: Scene, type: SceneType): Scene {
  const next: Scene = { type }
  for (const key of [...SHARED, ...OWN[type]]) if (scene[key] !== undefined) Object.assign(next, { [key]: scene[key] })
  if (type === "card") { delete next.caption; if (!next.title) next.title = scene.caption ?? "A new card" }
  else { if (!next.caption && scene.title) next.caption = scene.title.replace(/\n/g, " "); if (next.src === undefined) next.src = "" }
  if (type === "clip") delete next.seconds
  return next
}

/** Set a field, or remove it when the value is empty, so video.json stays tidy. */
export function withField<K extends keyof Scene>(scene: Scene, key: K, value: Scene[K] | "" | undefined): Scene {
  const next: Scene = { ...scene }
  if (value === undefined || value === "" || value === false || (typeof value === "number" && Number.isNaN(value))) delete next[key]
  else next[key] = value as Scene[K]
  return next
}

/** One line that says what a scene is, for the storyboard. */
export function label(scene: Scene): string {
  if (scene.type === "card") return [scene.title, scene.accent].filter(Boolean).join(" ").replace(/\n/g, " ") || scene.button || "Empty card"
  return scene.caption || scene.src || "No file chosen"
}

export const clock = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`
}
