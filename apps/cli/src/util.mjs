// Small helpers shared by every step: running tools, probing media, hashing.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, statfsSync } from "node:fs"
import { freemem, totalmem } from "node:os"
import { dirname } from "node:path"

export class UserError extends Error {}

export const log = (...parts) => console.log(parts.join(" "))
export const warn = (...parts) => console.warn("warning:", parts.join(" "))

export function which(...names) {
  for (const name of names) {
    if (!name) continue
    if (name.includes("/")) { if (existsSync(name)) return name; continue }
    const found = spawnSync("which", [name], { encoding: "utf8" })
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim()
    // Homebrew's folders are often missing from PATH in non-login shells
    // (editors, CI, agents), where `which ffmpeg` then finds nothing.
    for (const dir of ["/opt/homebrew/bin", "/usr/local/bin"]) if (existsSync(`${dir}/${name}`)) return `${dir}/${name}`
  }
  return null
}

export const ffmpegPath = () => which(process.env.COMMS_FFMPEG, "ffmpeg")
export const ffprobePath = () => which(process.env.COMMS_FFPROBE, "ffprobe")

const CHROMES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
]
export const chromePath = () => which(process.env.COMMS_CHROME, ...CHROMES)

/** Run a tool; throw with its stderr when it fails. Returns stdout. */
export function run(command, args, { allowFail = false, input } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024 })
  if (result.error) throw new UserError(`could not run ${command}: ${result.error.message}`)
  if (result.status !== 0 && !allowFail) {
    const tail = (result.stderr || result.stdout || "").trim().split("\n").slice(-12).join("\n")
    throw new Error(`${command} failed (exit ${result.status}):\n${tail}`)
  }
  return result
}

export function ffmpeg(args) {
  const bin = ffmpegPath()
  if (!bin) throw new UserError("ffmpeg is not installed. Run `comms doctor`.")
  return run(bin, ["-y", "-hide_banner", "-loglevel", "error", ...args])
}

/** Duration of a media file in seconds. Throws if it is not decodable media:
 *  an HTTP error body saved as "audio.wav" must not pass for audio. */
export function duration(file) {
  const bin = ffprobePath()
  if (!bin) throw new UserError("ffprobe is not installed. Run `comms doctor`.")
  const result = run(bin, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { allowFail: true })
  const seconds = Number.parseFloat(result.stdout)
  if (result.status !== 0 || !Number.isFinite(seconds) || seconds <= 0) throw new Error(`${file} is not readable media`)
  return seconds
}

/** { mean, max } volume in dB, measured by ffmpeg. */
export function levels(file) {
  const result = run(ffmpegPath(), ["-hide_banner", "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"], { allowFail: true })
  const pick = (name) => Number.parseFloat((result.stderr.match(new RegExp(`${name}: (-?[\\d.]+) dB`)) || [])[1])
  return { mean: pick("mean_volume"), max: pick("max_volume") }
}

export const sha = (...parts) => createHash("sha256").update(parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join("\u0000")).digest("hex").slice(0, 16)

export const ensureDir = (dir) => { mkdirSync(dir, { recursive: true }); return dir }
export const ensureParent = (file) => { mkdirSync(dirname(file), { recursive: true }); return file }

export function diskFreeGb(path) {
  try { const s = statfsSync(path); return (s.bavail * s.bsize) / 1e9 } catch { return null }
}
export const memory = () => ({ freeGb: freemem() / 2 ** 30, totalGb: totalmem() / 2 ** 30 })

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
export const round = (n, digits = 2) => Number(n.toFixed(digits))
