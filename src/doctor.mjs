// `comms doctor`: is everything this tool needs installed, and is the machine
// in a state to run it? Says what to do about each thing that is not.
import { spawnSync } from "node:child_process"
import { chromePath, diskFreeGb, ffmpegPath, ffprobePath, memory, which } from "./util.mjs"

export async function doctor(project) {
  const rows = []
  const add = (status, name, detail, fix) => rows.push({ status, name, detail, fix })
  const major = Number(process.versions.node.split(".")[0])
  add(major >= 22 ? "ok" : "fail", "Node.js", `v${process.versions.node}`, "Install Node 22 or newer (built-in WebSocket and fetch are required).")

  const ffmpeg = ffmpegPath()
  if (!ffmpeg) add("fail", "ffmpeg", "not found", "macOS: `brew install ffmpeg`. Debian/Ubuntu: `sudo apt install ffmpeg`.")
  else {
    const version = spawnSync(ffmpeg, ["-version"], { encoding: "utf8" }).stdout.split("\n")[0].replace("ffmpeg version ", "").split(" ")[0]
    const encoders = spawnSync(ffmpeg, ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout
    add(encoders.includes("libx264") ? "ok" : "fail", "ffmpeg", `${version}${encoders.includes("libx264") ? "" : " without libx264"}`, "Install an ffmpeg build with libx264 (Homebrew's has it).")
  }
  add(ffprobePath() ? "ok" : "fail", "ffprobe", ffprobePath() ?? "not found", "It ships with ffmpeg.")
  const chrome = chromePath()
  add(chrome ? "ok" : "fail", "Chrome", chrome ?? "not found", "Install Google Chrome (`brew install --cask google-chrome`) or set COMMS_CHROME to a Chromium-based browser. Needed for cards, captions and recording.")

  add(which("say") ? "ok" : "info", "say (built-in voice)", which("say") ? "available" : "not on this system", 'Only macOS has it. Elsewhere use voice.engine "command", "voicestudio" or "recorded".')
  const url = (project?.voice?.url ?? process.env.COMMS_VOICESTUDIO_URL ?? "http://localhost:3900").replace(/\/$/, "")
  try {
    const health = await (await fetch(`${url}/health`, { signal: AbortSignal.timeout(2500) })).json()
    add("ok", "VoiceStudio (cloned voice)", `${health.status} on ${health.device ?? "?"} at ${url}`)
  } catch {
    add("info", "VoiceStudio (cloned voice)", `not running at ${url}`, "Optional. See docs/voice.md to install and start it.")
  }

  const mem = memory()
  add(mem.totalGb > 16.5 ? "ok" : "info", "Memory", `${Math.round(mem.totalGb)} GB`, "Enough for everything except voice cloning next to other heavy apps: quit Docker Desktop and local LLMs before generating cloned voice lines.")
  const free = diskFreeGb(project?.root ?? process.cwd())
  if (free != null) add(free >= 5 ? "ok" : free >= 2 ? "info" : "fail", "Free disk", `${free.toFixed(1)} GB`, "Recording needs 2 GB of headroom; a voice-cloning model needs about 10 GB.")

  const mark = { ok: "ok  ", info: "note", fail: "FAIL" }
  for (const row of rows) {
    console.log(`${mark[row.status]}  ${row.name.padEnd(28)} ${row.detail}`)
    if (row.status !== "ok" && row.fix) console.log(`      ${row.fix}`)
  }
  const failed = rows.filter((row) => row.status === "fail").length
  console.log(failed ? `\n${failed} thing${failed === 1 ? "" : "s"} to fix before comms can run.` : "\nReady.")
  return failed === 0
}
