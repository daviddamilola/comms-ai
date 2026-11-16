// Loads a project's video.json, fills defaults and reports every problem at once.
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { UserError } from "./util.mjs"

export const DEFAULTS = {
  size: [1440, 860],
  fps: 30,
  theme: {
    background: "#0d1210", foreground: "#f4f5f4", muted: "#a8b0aa", accent: "#4fcf85",
    accentInk: "#07130c", font: "-apple-system, 'Helvetica Neue', 'Segoe UI', sans-serif", brand: "",
  },
  voice: { engine: "say", voice: "Daniel", rate: 172, lead: 0.3, tail: 0.4, volume: 0.95, pronounce: {} },
  music: { synth: true, volume: 0.32, duck: true },
}
export const SCENE_TYPES = ["card", "clip", "image"]
export const VOICE_ENGINES = ["none", "say", "voicestudio", "recorded", "command"]

export function projectPath(arg = ".") {
  const path = resolve(arg)
  if (existsSync(path) && statSync(path).isDirectory()) return join(path, "video.json")
  return path
}

export function loadProject(arg) {
  const file = projectPath(arg)
  if (!existsSync(file)) throw new UserError(`no project at ${file}. Create one with \`comms init <folder>\`.`)
  let raw
  try { raw = JSON.parse(readFileSync(file, "utf8")) } catch (error) { throw new UserError(`${file} is not valid JSON: ${error.message}`) }
  const root = dirname(file)
  const project = normalise(raw, root)
  const problems = validate(project)
  if (problems.length) throw new UserError(`${file} has ${problems.length} problem${problems.length === 1 ? "" : "s"}:\n` + problems.map((p) => `  - ${p}`).join("\n"))
  return project
}

export function normalise(raw, root) {
  const at = (path) => (path == null ? path : isAbsolute(path) ? path : join(root, path))
  return {
    root, at,
    title: raw.title ?? "Untitled",
    size: raw.size ?? DEFAULTS.size,
    fps: raw.fps ?? DEFAULTS.fps,
    output: at(raw.output ?? "out/video.mp4"),
    theme: { ...DEFAULTS.theme, ...(raw.theme ?? {}) },
    voice: { ...DEFAULTS.voice, ...(raw.voice ?? {}) },
    music: raw.music === false ? null : { ...DEFAULTS.music, ...(raw.music ?? {}) },
    recordings: raw.recordings ?? {},
    scenes: (raw.scenes ?? []).map((scene, index) => ({ ...scene, index })),
  }
}

/** Every problem found, as sentences. `checkFiles: false` skips media that a
 *  later step produces (clips not recorded yet). */
export function validate(project, { checkFiles = false } = {}) {
  const problems = []
  const [width, height] = project.size ?? []
  if (!(width > 0 && height > 0) || width % 2 || height % 2) problems.push(`"size" must be two even numbers, e.g. [1440, 860]`)
  if (!project.scenes.length) problems.push(`"scenes" is empty: add at least one scene`)
  if (!VOICE_ENGINES.includes(project.voice.engine)) problems.push(`voice.engine "${project.voice.engine}" is not one of ${VOICE_ENGINES.join(", ")}`)
  if (project.voice.engine === "voicestudio" && !project.voice.profile && !project.voice.reference) problems.push(`voice.engine "voicestudio" needs voice.profile (an id) or voice.reference (a recording)`)
  if (project.voice.engine === "command" && !project.voice.command) problems.push(`voice.engine "command" needs voice.command, e.g. "espeak-ng -w {out} {text}"`)
  for (const scene of project.scenes) {
    const where = `scene ${scene.index + 1}`
    if (!SCENE_TYPES.includes(scene.type)) { problems.push(`${where}: type "${scene.type}" is not one of ${SCENE_TYPES.join(", ")}`); continue }
    if (scene.type === "card" && !scene.title && !scene.subtitle && !scene.button) problems.push(`${where}: a card needs a title, subtitle or button`)
    if (scene.type !== "card") {
      if (!scene.src) problems.push(`${where}: a ${scene.type} needs "src"`)
      else if (checkFiles && !existsSync(project.at(scene.src))) problems.push(`${where}: ${scene.src} does not exist` + (scene.type === "clip" ? " (record it with `comms record`?)" : ""))
    }
    if (scene.sayFile && checkFiles && !existsSync(project.at(scene.sayFile))) problems.push(`${where}: its voice recording ${scene.sayFile} does not exist`)
    if (scene.type === "clip") {
      if (scene.from != null && scene.to != null && !(scene.to > scene.from)) problems.push(`${where}: "to" must be after "from"`)
      if (scene.speed != null && !(scene.speed > 0)) problems.push(`${where}: "speed" must be positive`)
    }
  }
  for (const [name, recording] of Object.entries(project.recordings)) {
    if (!recording.url) problems.push(`recording "${name}": needs "url"`)
    if (!Array.isArray(recording.steps) || !recording.steps.length) problems.push(`recording "${name}": needs "steps"`)
  }
  return problems
}
