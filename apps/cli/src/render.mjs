// Renders the video: every scene to a segment with identical encoding, the
// segments joined without re-encoding, then voice and music mixed underneath.
// Finishes with a contact sheet and a report, because a render you have not
// looked at is not checked.
import { existsSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { validate } from "./config.mjs"
import { musicSource } from "./music.mjs"
import { plan, totalSeconds } from "./plan.mjs"
import { captionHtml, cardHtml, renderPng } from "./text.mjs"
import { buildVoice, exportLines } from "./voice.mjs"
import { duration, ensureDir, ensureParent, ffmpeg, levels, log, round, UserError, warn } from "./util.mjs"

export async function render(project, { redo = [], noVoice = false } = {}) {
  const problems = validate(project, { checkFiles: true })
  if (problems.length) throw new UserError(`cannot render:\n` + problems.map((p) => `  - ${p}`).join("\n"))
  const [width, height] = project.size
  const fps = project.fps
  const work = ensureDir(join(project.root, ".cache", "render"))
  const encode = ["-r", String(fps), "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-an"]
  const fit = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${project.theme.background.replace("#", "0x")},setsar=1`

  /* 1. voice first: its lengths decide the timing */
  const lines = noVoice ? [] : await buildVoice(project, { redo })
  const voiceSeconds = new Map(lines.map((line) => [line.index, line.seconds]))
  const timeline = plan(project.scenes, {
    clipSeconds: (scene) => duration(project.at(scene.src)),
    voiceSeconds, lead: project.voice.lead, tail: project.voice.tail,
  })

  /* 2. one segment per scene */
  const segments = []
  for (const scene of timeline) {
    const out = join(work, `seg${String(scene.index).padStart(3, "0")}.mp4`)
    const d = scene.seconds
    const caption = scene.caption ? renderPng(project, captionHtml(project, scene.caption), { transparent: true }) : null
    const overlay = (video) => caption
      ? `${video};[1:v]format=rgba,fade=in:st=0.3:d=0.3:alpha=1,fade=out:st=${Math.max(0.6, d - 0.5).toFixed(2)}:d=0.3:alpha=1[c];[v][c]overlay=shortest=1,format=yuv420p[o]`
      : `${video};[v]format=yuv420p[o]`
    const captionInput = caption ? ["-loop", "1", "-t", d.toFixed(3), "-i", caption] : []
    if (scene.type === "card") {
      const png = renderPng(project, cardHtml(project, scene))
      ffmpeg(["-loop", "1", "-t", d.toFixed(3), "-i", png, "-vf", `fps=${fps},fade=in:st=0:d=0.4,fade=out:st=${(d - 0.4).toFixed(2)}:d=0.4,format=yuv420p`, ...encode, out])
    } else if (scene.type === "image") {
      ffmpeg(["-loop", "1", "-t", d.toFixed(3), "-i", project.at(scene.src), ...captionInput,
        "-filter_complex", overlay(`[0:v]${fit},fps=${fps},fade=in:st=0:d=0.3[v]`), "-map", "[o]", "-t", d.toFixed(3), ...encode, out])
    } else {
      const hold = scene.hold > 0 ? `,tpad=stop_mode=clone:stop_duration=${scene.hold.toFixed(3)}` : ""
      ffmpeg(["-ss", String(scene.from), "-to", String(scene.to), "-i", project.at(scene.src), ...captionInput,
        "-filter_complex", overlay(`[0:v]setpts=(PTS-STARTPTS)/${scene.speed.toFixed(4)},${fit},fps=${fps}${hold},fade=in:st=0:d=0.2[v]`),
        "-map", "[o]", "-t", d.toFixed(3), ...encode, out])
    }
    scene.rendered = duration(out)
    segments.push(out)
    log(`  scene ${scene.index + 1}/${timeline.length} ${scene.type.padEnd(5)} ${round(scene.rendered, 1)} s` + (scene.notes.length ? `  (${scene.notes.join("; ")})` : ""))
  }

  /* 3. join; the true start of each scene comes from the rendered lengths */
  let clock = 0
  for (const scene of timeline) { scene.start = clock; if (scene.voiceAt != null) scene.voiceAt = clock + project.voice.lead; clock += scene.rendered }
  const total = clock
  const list = join(work, "segments.txt")
  writeFileSync(list, segments.map((s) => `file '${s}'\n`).join(""))
  const silent = join(work, "silent.mp4")
  ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", silent])

  /* 4. sound */
  const output = ensureParent(project.output)
  const music = musicSource(project)
  const voiced = timeline.filter((scene) => scene.voiceAt != null)
  const audio = join(work, "audio.wav")
  let voiceTrack = null
  if (voiced.length) {
    voiceTrack = join(work, "voice.wav")
    const inputs = [], filters = []
    voiced.forEach((scene, n) => {
      inputs.push("-i", lines.find((line) => line.index === scene.index).file)
      filters.push(`[${n}:a]aresample=44100,adelay=${Math.round(scene.voiceAt * 1000)}:all=1[v${n}]`)
    })
    filters.push(`${voiced.map((_, n) => `[v${n}]`).join("")}amix=inputs=${voiced.length}:normalize=0,apad=whole_dur=${total.toFixed(3)},pan=stereo|c0=c0|c1=c0[vo]`)
    ffmpeg([...inputs, "-filter_complex", filters.join(";"), "-map", "[vo]", "-t", total.toFixed(3), voiceTrack])
  }
  if (voiceTrack || music) {
    const inputs = [], chain = []
    if (voiceTrack) inputs.push("-i", voiceTrack)
    if (music) inputs.push(...(music.loop ? ["-stream_loop", "-1"] : []), "-i", music.file)
    const m = voiceTrack ? 1 : 0
    const fadeOut = Math.max(0, total - 4).toFixed(2)
    if (music) chain.push(`[${m}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${total.toFixed(3)},lowpass=f=${project.music.lowpass ?? 3800},aecho=0.8:0.6:90|180:0.35|0.25,afade=in:st=0:d=2.5,afade=out:st=${fadeOut}:d=4,volume=${voiceTrack ? project.music.volume : Math.min(1, project.music.volume * 2)}[m]`)
    if (voiceTrack && music) {
      // The music ducks under the voice, then a limiter guarantees no clipping.
      chain.push(`[0:a]volume=${project.voice.volume},asplit[vm][vs]`)
      chain.push(project.music.duck ? `[m][vs]sidechaincompress=threshold=0.02:ratio=5:attack=40:release=700[md]` : `[vs]anullsink;[m]anull[md]`)
      chain.push(`[vm][md]amix=inputs=2:normalize=0,alimiter=limit=0.9[a]`)
    } else if (voiceTrack) chain.push(`[0:a]volume=${project.voice.volume},alimiter=limit=0.9[a]`)
    else chain.push(`[m]alimiter=limit=0.9[a]`)
    ffmpeg([...inputs, "-filter_complex", chain.join(";"), "-map", "[a]", "-t", total.toFixed(3), audio])
    ffmpeg(["-i", silent, "-i", audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", output])
  } else {
    ffmpeg(["-i", silent, "-c", "copy", "-movflags", "+faststart", output])
  }

  /* 5. check it */
  const report = review(project, timeline, { output, total, voiceTrack, hasAudio: Boolean(voiceTrack || music), lines })
  for (const segment of segments) rmSync(segment, { force: true })
  rmSync(silent, { force: true })
  return report
}

function review(project, timeline, { output, total, voiceTrack, hasAudio, lines }) {
  const outDir = dirname(output)
  const warnings = []
  // One frame from the middle of every scene. (Sampling at a fixed interval
  // misses short cards and shows fades instead.)
  const sheetDir = join(project.root, ".cache", "render", "sheet")
  rmSync(sheetDir, { recursive: true, force: true }); ensureDir(sheetDir)
  timeline.forEach((scene, n) => ffmpeg(["-ss", (scene.start + scene.rendered / 2).toFixed(2), "-i", output, "-frames:v", "1", "-vf", "scale=480:-2", join(sheetDir, `${String(n + 1).padStart(3, "0")}.png`)]))
  const columns = Math.min(5, timeline.length)
  const sheet = join(outDir, "contact-sheet.png")
  ffmpeg(["-framerate", "1", "-i", join(sheetDir, "%03d.png"), "-vf", `tile=${columns}x${Math.ceil(timeline.length / columns)}:padding=6:color=black`, "-frames:v", "1", sheet])

  const actual = duration(output)
  if (Math.abs(actual - total) > 0.5) warnings.push(`the video is ${round(actual, 1)} s but the scenes add up to ${round(total, 1)} s`)
  const sound = hasAudio ? levels(output) : null
  if (sound && sound.max > -0.5) warnings.push(`audio peaks at ${sound.max} dB: it may clip`)
  if (sound && sound.mean < -30) warnings.push(`audio is quiet (mean ${sound.mean} dB)`)
  const voice = voiceTrack ? levels(voiceTrack) : null
  // Timing changes made to fit the voice are expected, not problems.
  const adjustments = timeline.flatMap((scene) => scene.notes.map((note) => `scene ${scene.index + 1}: ${note}`))

  const report = {
    output, seconds: round(actual, 2), size: project.size, contactSheet: sheet, audio: sound, voice,
    voiceLines: lines.length, warnings, adjustments,
    scenes: timeline.map((scene) => ({
      scene: scene.index + 1, type: scene.type, start: round(scene.start), seconds: round(scene.rendered),
      ...(scene.type === "clip" ? { src: scene.src, from: round(scene.from), to: round(scene.to), speed: round(scene.speed) } : {}),
      ...(scene.caption ? { caption: scene.caption } : {}),
      ...(scene.say ? { say: scene.say, voiceAt: round(scene.voiceAt ?? 0), voiceSeconds: round(scene.voiceSeconds) } : {}),
    })),
  }
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n")
  if (lines.length) exportLines(project, lines)
  for (const warning of warnings) warn(warning)
  return report
}

export { totalSeconds }
