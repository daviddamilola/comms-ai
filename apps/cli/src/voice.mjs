// Voiceover: one audio file per scene that has a "say" line.
//
// Engines
//   say          macOS built-in voices. Instant, clearly synthetic.
//   voicestudio  a cloned voice from a local VoiceStudio backend. Slow
//                (1-2 minutes a line on a 16 GB Mac), so lines are cached.
//   recorded     your own recording: one file per line, or one take that is
//                split on the pauses between lines.
//   command      any text-to-speech command, e.g. "espeak-ng -w {out} {text}".
//   none         no voiceover.
//
// Every line is cached by its text and voice settings: changing one line
// regenerates one line.
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { request as httpRequest } from "node:http"
import { basename, join } from "node:path"
import { duration, ensureDir, ffmpeg, ffmpegPath, log, memory, round, run, sha, UserError, warn, which } from "./util.mjs"

export const spoken = (project) => project.scenes.filter((scene) => scene.say && String(scene.say).trim())

/** Text as the engine should read it: "DOI" -> "D O I". Captions keep the original. */
export function pronounce(text, map = {}) {
  let out = String(text)
  for (const [from, to] of Object.entries(map)) out = out.replace(new RegExp(`\\b${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), to)
  return out
}

const settingsKey = (voice) => {
  const { engine, voice: name, rate, url, profile, reference, referenceText, engineId, seed, command, pronounce: p } = voice
  const ref = reference && existsSync(reference) ? sha(readFileSync(reference)) : reference
  return { engine, name, rate, url, profile, ref, referenceText, engineId, seed, command, p }
}

/** Generate (or reuse) every line. Returns [{ index, text, file, seconds }]. */
export async function buildVoice(project, { redo = [] } = {}) {
  const voice = { ...project.voice, reference: project.voice.reference ? project.at(project.voice.reference) : undefined }
  const lines = spoken(project)
  if (voice.engine === "none" || !lines.length) return []
  const dir = ensureDir(join(project.root, ".cache", "voice"))
  const key = settingsKey(voice)

  if (voice.engine === "recorded") return recorded(project, voice, lines, dir)

  const jobs = lines.map((scene, n) => {
    const text = pronounce(scene.say, voice.pronounce)
    return { scene, n, text, file: join(dir, `${sha(text, key)}.wav`) }
  })
  for (const number of redo) { const job = jobs[number - 1]; if (job && existsSync(job.file)) rmSync(job.file) }
  const todo = jobs.filter((job) => !existsSync(job.file))
  log(`voice: ${jobs.length} lines, ${jobs.length - todo.length} cached, ${todo.length} to generate (${voice.engine})`)

  let session = null
  if (todo.length && voice.engine === "voicestudio") session = await voiceStudio(project, voice)
  for (const job of todo) {
    const started = Date.now()
    const raw = join(dir, `raw-${basename(job.file)}`)
    if (voice.engine === "say") sayLine(voice, job.text, raw)
    else if (voice.engine === "command") commandLine(voice, job.text, raw)
    else await session.generate(job.text, raw)
    finish(raw, job.file)
    rmSync(raw, { force: true }); rmSync(raw.replace(/\.wav$/, ".aiff"), { force: true })
    log(`  line ${job.n + 1}/${jobs.length}: ${round(duration(job.file), 1)} s of audio in ${round((Date.now() - started) / 1000, 0)} s  "${job.scene.say.slice(0, 50)}"`)
  }
  return jobs.map((job) => ({ index: job.scene.index, text: job.scene.say, file: job.file, seconds: duration(job.file) }))
}

/** Trim silence at the edges and bring every line to the same loudness, so
 *  a quiet recording and a hot synthetic voice mix alike. */
function finish(input, output) {
  duration(input)          // throws if the engine wrote something that is not audio
  ffmpeg(["-i", input, "-af",
    "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12,areverse,loudnorm=I=-18:TP=-2:LRA=11",
    "-ar", "44100", "-ac", "1", output])
}

function sayLine(voice, text, out) {
  if (!which("say")) throw new UserError('voice.engine "say" needs macOS. Use "command", "voicestudio" or "recorded" instead.')
  const aiff = out.replace(/\.wav$/, ".aiff")
  run("say", ["-v", voice.voice, "-r", String(voice.rate), "-o", aiff, text])
  ffmpeg(["-i", aiff, out])
}

function commandLine(voice, text, out) {
  const parts = voice.command.split(/\s+/).map((part) => part.replace("{out}", out).replace("{text}", text))
  run(parts[0], parts.slice(1))
}

/* ------------------------------------------------------------ recorded -- */
function recorded(project, voice, lines, dir) {
  const folder = project.at(voice.folder ?? "voice")
  let files = existsSync(folder) ? readdirSync(folder).filter((f) => /^\d+.*\.(wav|m4a|mp3|aiff|flac)$/i.test(f)).sort((a, b) => parseInt(a) - parseInt(b)).map((f) => join(folder, f)) : []
  if (voice.take) files = splitTake(project.at(voice.take), lines.length, ensureDir(join(dir, "take")))
  if (files.length !== lines.length) {
    throw new UserError(`the script has ${lines.length} spoken lines but ${files.length} recording${files.length === 1 ? "" : "s"} were found in ${folder}.\n` +
      `Name them 01.wav, 02.wav ... in script order, or set voice.take to one recording of all lines with a pause between them.\n` +
      `Print the script with \`comms script\`.`)
  }
  return lines.map((scene, n) => {
    const file = join(dir, `${sha(readFileSync(files[n]))}.wav`)
    if (!existsSync(file)) finish(files[n], file)
    return { index: scene.index, text: scene.say, file, seconds: duration(file) }
  })
}

/** Parse ffmpeg silencedetect output into the spoken segments between pauses. */
export function segmentsFromSilence(stderr, total) {
  const starts = [...stderr.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Math.max(0, Number(m[1])))
  const ends = [...stderr.matchAll(/silence_end: (-?[\d.]+)/g)].map((m) => Number(m[1]))
  const segments = []
  let cursor = 0
  starts.forEach((start, i) => {
    if (start - cursor > 0.25) segments.push([cursor, start])
    cursor = ends[i] ?? total
  })
  if (total - cursor > 0.25) segments.push([cursor, total])
  return segments
}

function splitTake(take, count, dir) {
  if (!existsSync(take)) throw new UserError(`voice.take ${take} does not exist`)
  const total = duration(take)
  // Pauses between lines are longer than pauses inside one: try long gaps first.
  for (const gap of [1.2, 0.9, 0.7, 0.5]) {
    const result = run(ffmpegPath(), ["-hide_banner", "-i", take, "-af", `silencedetect=noise=-35dB:d=${gap}`, "-f", "null", "-"], { allowFail: true })
    const segments = segmentsFromSilence(result.stderr, total)
    if (segments.length === count) {
      return segments.map(([from, to], n) => {
        const out = join(dir, `${String(n + 1).padStart(2, "0")}.wav`)
        ffmpeg(["-ss", String(Math.max(0, from - 0.08)), "-to", String(to + 0.12), "-i", take, out])
        return out
      })
    }
  }
  throw new UserError(`could not split ${take} into ${count} lines by its pauses. Leave a clear one-second pause between lines, or save each line as its own file (01.wav, 02.wav ...).`)
}

/* --------------------------------------------------------- voicestudio -- */
async function voiceStudio(project, voice) {
  const url = (voice.url ?? "http://localhost:3900").replace(/\/$/, "")
  let health
  try { health = await (await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) })).json() } catch {
    throw new UserError(`VoiceStudio is not running at ${url}. Start it (see docs/voice.md), or use another voice.engine.`)
  }
  if (health.status !== "ok") throw new UserError(`VoiceStudio is still starting (${health.label ?? health.status}). Try again in a minute.`)
  const mem = memory()
  // A 5 GB speech model on a 16 GB machine swaps badly next to Docker or a
  // local LLM: the first warm-up step took 100 s instead of 4.
  if (mem.totalGb <= 16.5) {
    // Name what is actually running: "quit heavy apps" is easy to skip, and a
    // Docker Desktop that was asked to quit may still be there.
    const hogs = [["com.docker.backend", "Docker Desktop"], ["ollama runner", "an Ollama model"]].filter(([name]) => run("pgrep", ["-f", name], { allowFail: true }).status === 0).map(([, label]) => label)
    warn(`this machine has ${Math.round(mem.totalGb)} GB of memory, and a cloning model needs most of it.` +
      (hogs.length ? ` ${hogs.join(" and ")} ${hogs.length === 1 ? "is" : "are"} running: quit ${hogs.length === 1 ? "it" : "them"} first, or each line can take many minutes.` : " Keep other heavy apps closed while lines generate."))
  }

  let profile = voice.profile
  if (!profile) {
    const name = `comms-${sha(readFileSync(voice.reference), voice.referenceText ?? "")}`
    const existing = await (await fetch(`${url}/profiles`)).json()
    const list = Array.isArray(existing) ? existing : existing.profiles ?? []
    profile = list.find((p) => p.name === name)?.id
    if (!profile) {
      // References are often quiet phone recordings: level them first.
      const levelled = join(ensureDir(join(project.root, ".cache", "voice")), `${name}.wav`)
      ffmpeg(["-i", voice.reference, "-af", "highpass=f=70,loudnorm=I=-18:TP=-2", "-ar", "48000", "-ac", "1", levelled])
      const seconds = duration(levelled)
      if (seconds < 5 || seconds > 60) warn(`the voice reference is ${round(seconds, 1)} s long; 10-20 s of clean speech clones best`)
      const form = new FormData()
      form.set("name", name); form.set("kind", "clone"); form.set("language", voice.language ?? "English")
      form.set("ref_text", voice.referenceText ?? "")
      form.set("ref_audio", new Blob([readFileSync(levelled)], { type: "audio/wav" }), "reference.wav")
      const created = await fetch(`${url}/profiles`, { method: "POST", body: form })
      if (!created.ok) throw new Error(`VoiceStudio could not create the voice profile: ${created.status} ${(await created.text()).slice(0, 300)}`)
      profile = (await created.json()).id
      log(`  created voice profile ${profile} from ${basename(voice.reference)}`)
    }
  }
  return {
    async generate(text, out) {
      const form = new FormData()
      form.set("text", text); form.set("profile_id", profile); form.set("language", voice.language ?? "English")
      if (voice.engineId) form.set("engine", voice.engineId)
      if (voice.seed != null) form.set("seed", String(voice.seed))
      const response = await postForm(`${url}/generate`, form, (voice.timeout ?? 1800) * 1000)
      // Check the status before saving: an error body saved as .wav is not audio.
      if (response.status !== 200) {
        let detail = response.body.toString("utf8")
        try { detail = JSON.parse(detail).detail ?? detail } catch {}
        const slow = /abandoned|compute time/.test(detail)
        throw new UserError(`VoiceStudio could not generate "${text.slice(0, 40)}..." (HTTP ${response.status}): ${String(detail).slice(0, 400)}` +
          (slow ? `\n  The machine is too short of memory for this model right now. Restart the backend (scripts/voicestudio.sh stop, then start: it allows 30 minutes a line), close other apps and try again; finished lines are cached.` : ""))
      }
      writeFileSync(out, response.body)
    },
  }
}

/** POST a form and wait as long as it takes. Not fetch(): Node's fetch gives
 *  up after five minutes without response headers ("fetch failed"), and the
 *  first line from a cold speech model takes longer than that. */
export async function postForm(url, form, timeoutMs) {
  const encoded = new Response(form)
  const body = Buffer.from(await encoded.arrayBuffer())
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method: "POST", headers: { "content-type": encoded.headers.get("content-type"), "content-length": body.length } }, (response) => {
      const chunks = []
      response.on("data", (chunk) => chunks.push(chunk))
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks) }))
      response.on("error", reject)
    })
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`no answer from ${url} after ${Math.round(timeoutMs / 60000)} minutes`)))
    request.on("error", reject)
    request.end(body)
  })
}

/** Copy the finished lines somewhere readable (out/voice/01.wav ...). */
export function exportLines(project, lines) {
  const dir = ensureDir(join(project.root, "out", "voice"))
  lines.forEach((line, n) => copyFileSync(line.file, join(dir, `${String(n + 1).padStart(2, "0")}.wav`)))
  return dir
}
