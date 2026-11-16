#!/usr/bin/env node
import { existsSync } from "node:fs"
import { join } from "node:path"
import { loadProject, projectPath } from "../src/config.mjs"
import { doctor } from "../src/doctor.mjs"
import { init } from "../src/draft.mjs"
import { musicSource } from "../src/music.mjs"
import { record, recordingNames } from "../src/record.mjs"
import { render } from "../src/render.mjs"
import { duration, ffmpeg, log, round, UserError } from "../src/util.mjs"
import { buildVoice, exportLines, spoken } from "../src/voice.mjs"

const HELP = `comms: make product videos from recordings, screenshots and a script.

  comms doctor [project]              check that everything needed is installed
  comms init <folder>                 start a project (a video.json to edit)
      --script script.txt             one paragraph per scene
      --media folder                  screenshots and screen recordings to use
      --title "Name"   --force
  comms record <project> [name ...]   film the web recordings defined in video.json
      --keep-frames                   keep the raw frames (for debugging)
  comms script <project>              print the voiceover lines, numbered
  comms voice <project>               generate the voiceover lines (cached)
      --redo 3,5                      regenerate lines 3 and 5
  comms render <project>              build the video
      --redo 3,5   --no-voice
  comms build <project>               voice + render (the usual command)
  comms sheet <video> [--every 5]     contact sheet of any video
  comms ui <project> [--port 4400]    open the studio: storyboard, editor, build, preview

<project> is a folder containing video.json (default: the current folder).
Docs: README.md, docs/project.md, docs/recording.md, docs/voice.md`

function parse(argv) {
  const flags = {}, rest = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith("--")) { rest.push(arg); continue }
    const name = arg.slice(2)
    if (["force", "keep-frames", "no-voice", "no-open", "no-voicestudio", "help"].includes(name)) flags[name] = true
    else flags[name] = argv[++i]
  }
  return { flags, rest }
}
const numbers = (value) => (value ? String(value).split(",").map((n) => Number(n.trim())).filter((n) => n > 0) : [])

function summary(report) {
  log(`\n${report.output}`)
  log(`  ${report.seconds} s, ${report.scenes.length} scenes, ${report.voiceLines} voice lines` + (report.audio ? `, audio mean ${report.audio.mean} dB / peak ${report.audio.max} dB` : ", silent"))
  log(`  look at ${report.contactSheet} (one frame per scene) and listen before you share it`)
  if (report.adjustments.length) log(`  ${report.adjustments.length} scene${report.adjustments.length === 1 ? "" : "s"} retimed to fit the voice (see report.json)`)
  log(report.warnings.length ? `  ${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"} above` : "  no warnings")
}

async function main() {
  const [command, ...argv] = process.argv.slice(2)
  const { flags, rest } = parse(argv)
  if (!command || command === "help" || flags.help) return log(HELP)

  if (command === "doctor") {
    const project = existsSync(projectPath(rest[0])) ? loadProject(rest[0]) : null
    if (!(await doctor(project))) process.exitCode = 1
    return
  }
  if (command === "init") {
    if (!rest[0]) throw new UserError("usage: comms init <folder> [--script file] [--media folder]")
    const file = init(rest[0], { script: flags.script, media: flags.media, title: flags.title, force: flags.force })
    log(`wrote ${file}`)
    return log(`next: edit it, then \`comms build ${rest[0]}\``)
  }
  if (command === "sheet") {
    if (!rest[0]) throw new UserError("usage: comms sheet <video> [--every seconds]")
    const every = Number(flags.every ?? 5), seconds = duration(rest[0]), count = Math.max(1, Math.floor(seconds / every))
    const out = rest[0].replace(/\.[^.]+$/, "") + ".sheet.png"
    ffmpeg(["-i", rest[0], "-vf", `fps=1/${every},scale=480:-2,tile=5x${Math.ceil(count / 5)}:padding=6`, "-frames:v", "1", out])
    return log(`${out}: one frame every ${every} s, left to right, top to bottom`)
  }

  if (command === "ui") {
    // The studio is a separate app in this repository; load it only when asked.
    let studio
    try { studio = await import("../../studio/server/index.mjs") } catch (error) {
      throw new UserError(`the studio app could not be loaded (${error.message}). It lives in apps/studio of the comms-ai repository.`)
    }
    const { url, file } = await studio.startStudio(rest[0], { port: Number(flags.port ?? 4400) })
    log(`studio for ${file}`)
    log(`  ${url}   (Ctrl+C to stop)`)
    if (!flags["no-open"] && process.platform === "darwin") (await import("node:child_process")).spawn("open", [url], { stdio: "ignore", detached: true }).unref()
    // The cloned-voice backend comes up with the Studio and goes down with it
    // (it holds several GB), unless it was already running before.
    if (!flags["no-voicestudio"]) {
      const stop = (await import("../src/voicestudio.mjs")).startVoiceStudio(log)
      for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
        if (stop()) log("  VoiceStudio stopped")
        process.exit(signal === "SIGINT" ? 130 : 143)
      })
    }
    return
  }

  const project = loadProject(rest[0])
  if (command === "record") {
    const names = rest.slice(1).length ? rest.slice(1) : recordingNames(project)
    if (!names.length) throw new UserError('this project has no "recordings". See docs/recording.md.')
    for (const name of names) { log(`recording ${name}`); await record(project, name, { keepFrames: flags["keep-frames"] }) }
    return
  }
  if (command === "script") {
    const lines = spoken(project)
    if (!lines.length) return log('no scene has a "say" line')
    return lines.forEach((scene, n) => log(`${String(n + 1).padStart(2)}. ${scene.say}`))
  }
  if (command === "voice") {
    const lines = await buildVoice(project, { redo: numbers(flags.redo) })
    if (!lines.length) return log("no voice lines (voice.engine is \"none\" or no scene has \"say\")")
    const dir = exportLines(project, lines)
    return log(`${lines.length} lines, ${round(lines.reduce((s, l) => s + l.seconds, 0), 1)} s of speech, in ${dir}`)
  }
  if (command === "music") { const music = musicSource(project); return log(music ? music.file : "music is off") }
  if (command === "render" || command === "build") {
    log(`rendering ${project.title}`)
    return summary(await render(project, { redo: numbers(flags.redo), noVoice: flags["no-voice"] }))
  }
  throw new UserError(`unknown command "${command}". Run \`comms help\`.`)
}

// Exit non-zero on any failure, so scripts and CI can trust the exit code.
main().catch((error) => {
  console.error(error instanceof UserError ? `error: ${error.message}` : error.stack ?? String(error))
  process.exit(1)
})
