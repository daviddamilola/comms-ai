// Starts a project from what you already have: a script (one paragraph per
// scene) and a folder of screenshots and screen recordings.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { basename, extname, join, relative, resolve } from "node:path"
import { ensureDir, UserError } from "./util.mjs"

const IMAGES = [".png", ".jpg", ".jpeg", ".webp"]
const VIDEOS = [".mp4", ".mov", ".webm", ".mkv", ".m4v"]

/** Paragraphs of a script. Lines starting with "#" are comments. A paragraph
 *  may start with "[file.png]" or "[clip.mp4 12-20]" to say what is on screen. */
export function parseScript(text) {
  return text.split(/\n\s*\n/).map((block) => block.split("\n").filter((line) => !line.trim().startsWith("#")).join(" ").replace(/\s+/g, " ").trim()).filter(Boolean).map((paragraph) => {
    const tagged = paragraph.match(/^\[([^\]\s]+)(?:\s+([\d.]+)\s*-\s*([\d.]+))?\]\s*(.*)$/)
    if (!tagged) return { text: paragraph }
    return { media: tagged[1], from: tagged[2] ? Number(tagged[2]) : undefined, to: tagged[3] ? Number(tagged[3]) : undefined, text: tagged[4] }
  })
}

const firstSentence = (text) => (text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text).trim()
const sceneFor = (file, extra = {}) => IMAGES.includes(extname(file).toLowerCase()) ? { type: "image", src: file, ...extra } : { type: "clip", src: file, ...extra }

/** Scenes from paragraphs and media. Tagged paragraphs use their file; the
 *  rest take the untagged media in name order; what is left becomes cards. */
export function draftScenes(paragraphs, media = []) {
  const tagged = new Set(paragraphs.map((p) => p.media).filter(Boolean).map((m) => basename(m)))
  const queue = media.filter((file) => !tagged.has(basename(file)))
  const scenes = paragraphs.map((p, n) => {
    if (p.media) {
      const file = media.find((m) => basename(m) === basename(p.media)) ?? p.media
      const range = p.from != null ? { from: p.from, to: p.to } : {}
      return sceneFor(file, { ...range, ...(p.text ? { caption: firstSentence(p.text), say: p.text } : {}) })
    }
    const first = n === 0, last = n === paragraphs.length - 1
    if (!first && !last && queue.length) return sceneFor(queue.shift(), { caption: firstSentence(p.text), say: p.text })
    return { type: "card", title: firstSentence(p.text), say: p.text }
  })
  for (const file of queue) scenes.splice(Math.max(1, scenes.length - 1), 0, sceneFor(file))
  return scenes
}

export function init(dir, { script, media, title, force = false } = {}) {
  const root = resolve(dir)
  const file = join(root, "video.json")
  if (existsSync(file) && !force) throw new UserError(`${file} already exists. Pass --force to replace it.`)
  ensureDir(root)
  let scenes
  if (script || media) {
    const paragraphs = script ? parseScript(readFileSync(resolve(script), "utf8")) : []
    const mediaDir = media ? resolve(media) : null
    if (mediaDir && !existsSync(mediaDir)) throw new UserError(`${mediaDir} does not exist`)
    const files = mediaDir ? readdirSync(mediaDir).filter((f) => [...IMAGES, ...VIDEOS].includes(extname(f).toLowerCase())).sort().map((f) => relative(root, join(mediaDir, f))) : []
    scenes = draftScenes(paragraphs, files)
    if (!scenes.length) throw new UserError("nothing to draft from: the script is empty and the media folder has no images or videos")
  } else {
    scenes = [
      { type: "card", title: "The problem, in one line.", accent: "And why it should be easier.", say: "The problem, in one line. And why it should be easier." },
      { type: "card", brand: true, title: "What your product does.", subtitle: "Who it is for." },
      { type: "clip", src: "clips/tour.mp4", caption: "Show the product doing the thing", say: "Describe what the viewer is seeing." },
      { type: "card", brand: true, title: "One sentence they should remember.", button: "Join the waitlist", note: "example.com/waitlist" },
    ]
  }
  const project = {
    title: title ?? basename(root),
    size: [1440, 860],
    theme: { brand: title ?? basename(root), accent: "#4fcf85" },
    voice: { engine: "say", voice: "Daniel", pronounce: {} },
    music: { synth: true, volume: 0.32 },
    ...(script || media ? {} : {
      recordings: { tour: { url: "http://localhost:3000/", colorScheme: "dark", steps: [{ sleep: 2 }, { click: "Get started" }, { wait: { text: "Welcome" }, timeout: 20 }, { sleep: 2 }] } },
    }),
    scenes,
  }
  writeFileSync(file, JSON.stringify(project, null, 2) + "\n")
  return file
}
