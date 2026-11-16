// The studio's local server: reads and writes one project's video.json, makes
// thumbnails, runs builds with the command line and streams their progress.
//
// It listens on 127.0.0.1 only and has no accounts: it can read the project
// folder and run builds, so it must never be reachable from another machine.
import { spawn } from "node:child_process"
import { createReadStream, existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, extname, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { DEFAULTS, normalise, projectPath, validate, VOICE_ENGINES } from "../../cli/src/config.mjs"
import { cardHtml, renderPng } from "../../cli/src/text.mjs"
import { duration, ensureDir, ffmpeg, sha, UserError } from "../../cli/src/util.mjs"

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, "..", "dist")
const CLI = join(HERE, "..", "..", "cli", "bin", "comms.mjs")
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm", ".m4v": "video/mp4",
  ".wav": "audio/wav", ".m4a": "audio/mp4", ".mp3": "audio/mpeg",
}
const MEDIA = { image: [".png", ".jpg", ".jpeg", ".webp"], video: [".mp4", ".mov", ".webm", ".mkv", ".m4v"] }
const SKIP = new Set([".cache", "out", "node_modules", ".git", "voice"])

/** The absolute path of `path` if it is inside `root`, else null. */
export function inside(root, path) {
  const full = resolve(root, path)
  return full === root || full.startsWith(root + sep) ? full : null
}

/** Requests must come from this machine's own address: a web page elsewhere
 *  cannot reach the server by pointing a domain name at 127.0.0.1. */
export const localHost = (host) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host ?? "")

/** A browser sends Origin with every request that changes something. It must
 *  be a local address; tools without one (curl, tests) are allowed. */
export function sameOrigin(request) {
  const origin = request.headers.origin
  if (!origin) return true
  try { return localHost(new URL(origin).host) } catch { return false }
}

export function listMedia(root) {
  const found = []
  const walk = (dir, depth) => {
    if (depth > 3) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full, depth + 1); continue }
      const ext = extname(entry.name).toLowerCase()
      const kind = MEDIA.image.includes(ext) ? "image" : MEDIA.video.includes(ext) ? "video" : null
      if (!kind || /\.(failed|failure)\./.test(entry.name)) continue
      let seconds = null
      if (kind === "video") { try { seconds = Math.round(duration(full) * 100) / 100 } catch {} }
      found.push({ path: relative(root, full).split(sep).join("/"), kind, seconds })
    }
  }
  walk(root, 0)
  return found.sort((a, b) => a.path.localeCompare(b.path))
}

export function createStudio(projectArg) {
  const file = projectPath(projectArg)
  if (!existsSync(file)) throw new UserError(`no project at ${file}. Create one with \`comms init <folder>\`.`)
  const root = dirname(file)
  const readRaw = () => JSON.parse(readFileSync(file, "utf8"))
  // What the file holds right now, as a short fingerprint. A page sends back
  // the one it loaded, so a save from a page that is out of date is refused
  // instead of silently undoing changes made elsewhere.
  const version = () => sha(readFileSync(file))
  const AUDIO = { "audio/webm": ".webm", "audio/mp4": ".m4a", "audio/ogg": ".ogg", "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/mpeg": ".mp3" }
  const bytes = (request, limit) => new Promise((resolveBytes, reject) => {
    const chunks = []; let size = 0
    request.on("data", (chunk) => { size += chunk.length; if (size > limit) { reject(new UserError("the recording is too large")); request.destroy() } else chunks.push(chunk) })
    request.on("end", () => resolveBytes(Buffer.concat(chunks)))
    request.on("error", reject)
  })
  const problemsOf = (raw) => { try { return validate(normalise(raw, root)) } catch (error) { return [error.message] } }
  const job = { running: false, lines: [], code: null, startedAt: null, listeners: new Set() }

  const json = (response, status, body) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(body)) }
  const body = (request) => new Promise((resolveBody, reject) => {
    const chunks = []; let size = 0
    request.on("data", (chunk) => { size += chunk.length; if (size > 2e6) { reject(new UserError("request too large")); request.destroy() } else chunks.push(chunk) })
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")))
    request.on("error", reject)
  })

  function sendFile(request, response, path) {
    const stat = statSync(path)
    const type = TYPES[extname(path).toLowerCase()] ?? "application/octet-stream"
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "")
    // Range requests let the browser seek in a video without downloading it all.
    if (range) {
      const start = range[1] ? Number(range[1]) : 0
      const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1
      if (start > end || start >= stat.size) { response.writeHead(416, { "content-range": `bytes */${stat.size}` }); return response.end() }
      response.writeHead(206, { "content-type": type, "content-range": `bytes ${start}-${end}/${stat.size}`, "content-length": end - start + 1, "accept-ranges": "bytes", "cache-control": "no-store" })
      return createReadStream(path, { start, end }).pipe(response)
    }
    response.writeHead(200, { "content-type": type, "content-length": stat.size, "accept-ranges": "bytes", "cache-control": "no-store" })
    createReadStream(path).pipe(response)
  }

  function thumbnail(index) {
    const project = normalise(readRaw(), root)
    const scene = project.scenes[index]
    if (!scene) return null
    if (scene.type === "card") return renderPng(project, cardHtml(project, scene))
    const source = scene.src ? inside(root, scene.src) : null
    if (!source || !existsSync(source)) return null
    if (scene.type === "image") return source
    const total = duration(source)
    const from = Math.min(scene.from ?? 0, total), to = Math.min(scene.to ?? total, total)
    const at = Math.max(0, Math.min(total - 0.05, (from + to) / 2))
    const out = join(ensureDir(join(root, ".cache", "thumbs")), `${sha(source, statSync(source).mtimeMs, at)}.jpg`)
    if (!existsSync(out)) ffmpeg(["-ss", at.toFixed(2), "-i", source, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", out])
    return out
  }

  function startBuild({ voice = true } = {}) {
    // One build at a time: two would fight over the same cache and output.
    if (job.running) return false
    Object.assign(job, { running: true, lines: [], code: null, startedAt: Date.now() })
    const child = spawn(process.execPath, [CLI, "build", file, ...(voice ? [] : ["--no-voice"])], { cwd: root })
    const emit = (event, data) => { for (const listener of job.listeners) listener(event, data) }
    const onData = (chunk) => {
      for (const line of chunk.toString("utf8").split(/\r?\n/)) {
        if (!line.trim()) continue
        job.lines.push(line); emit("log", line)
      }
    }
    child.stdout.on("data", onData); child.stderr.on("data", onData)
    child.on("close", (code) => { job.running = false; job.code = code ?? 1; emit("done", { code: job.code }) })
    child.on("error", (error) => { job.lines.push(String(error)); job.running = false; job.code = 1; emit("done", { code: 1 }) })
    return true
  }

  const report = () => {
    const path = join(root, "out", "report.json")
    if (!existsSync(path)) return null
    try {
      const data = JSON.parse(readFileSync(path, "utf8"))
      // The report records absolute paths from when it was built. A project
      // folder that was copied or moved still has its files beside the
      // report, so look there; never hand the page a path outside the project.
      const beside = (p) => {
        if (!p) return null
        const here = join(root, "out", p.split(/[\\/]/).pop())
        const full = inside(root, p) && existsSync(p) ? p : existsSync(here) ? here : null
        return full ? relative(root, full).split(sep).join("/") : null
      }
      // Reports written by older versions lack some lists.
      return { ...data, warnings: data.warnings ?? [], adjustments: data.adjustments ?? [], scenes: data.scenes ?? [],
        output: beside(data.output), contactSheet: beside(data.contactSheet), builtAt: statSync(path).mtimeMs, stale: statSync(file).mtimeMs > statSync(path).mtimeMs }
    } catch { return null }
  }

  async function handle(request, response) {
    if (!localHost(request.headers.host)) { response.writeHead(403); return response.end("forbidden") }
    // Changes must come from the studio's own page: without this, any web
    // page open in the browser could post to this port and start a build.
    if (!["GET", "HEAD"].includes(request.method) && !sameOrigin(request)) { response.writeHead(403); return response.end("forbidden") }
    const url = new URL(request.url, "http://localhost")
    const path = url.pathname
    if (path === "/api/project" && request.method === "GET") {
      const raw = readRaw()
      return json(response, 200, { file, root, project: raw, version: version(), problems: problemsOf(raw), defaults: { size: DEFAULTS.size, theme: DEFAULTS.theme, voice: DEFAULTS.voice, music: DEFAULTS.music, voiceEngines: VOICE_ENGINES } })
    }
    if (path === "/api/project" && request.method === "PUT") {
      let raw
      try { raw = JSON.parse(await body(request)) } catch { return json(response, 400, { error: "the project could not be read as JSON" }) }
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.scenes)) return json(response, 400, { error: "a project needs a list of scenes" })
      const base = request.headers["x-base-version"]
      // A browser always sends Origin with a save. One that sends no version
      // is a tab still running an older copy of the page: refuse it too.
      if ((base || request.headers.origin) && base !== version()) return json(response, 409, { error: "the project was changed outside this page since it was loaded", conflict: true })
      // Write beside the file, then swap: a crash never leaves half a project.
      writeFileSync(`${file}.tmp`, JSON.stringify(raw, null, 2) + "\n")
      renameSync(`${file}.tmp`, file)
      return json(response, 200, { problems: problemsOf(raw), version: version() })
    }
    if (path === "/api/voice" && request.method === "POST") {
      // One spoken line recorded in the page. Kept as recorded; the build
      // trims and levels it like any other voice line.
      const extension = AUDIO[(request.headers["content-type"] ?? "").split(";")[0].trim()]
      if (!extension) return json(response, 415, { error: "that is not an audio recording this server understands" })
      const data = await bytes(request, 60e6)
      if (data.length < 200) return json(response, 400, { error: "the recording is empty" })
      const folder = ensureDir(join(root, "voice", "recordings"))
      const name = `${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}-${sha(data).slice(0, 6)}${extension}`
      const target = join(folder, name)
      writeFileSync(target, data)
      let seconds
      try { seconds = duration(target) } catch { rmSync(target, { force: true }); return json(response, 400, { error: "the recording could not be read as audio" }) }
      return json(response, 200, { path: `voice/recordings/${name}`, seconds })
    }
    if (path === "/api/files") return json(response, 200, { files: listMedia(root) })
    if (path === "/api/report") return json(response, 200, { report: report() })
    if (path === "/api/thumb") {
      let thumb = null
      try { thumb = thumbnail(Number(url.searchParams.get("scene"))) } catch {}
      if (!thumb) { response.writeHead(404); return response.end() }
      return sendFile(request, response, thumb)
    }
    if (path === "/api/media") {
      const target = inside(root, url.searchParams.get("path") ?? "")
      if (!target || !existsSync(target) || !statSync(target).isFile()) { response.writeHead(404); return response.end() }
      return sendFile(request, response, target)
    }
    if (path === "/api/build" && request.method === "POST") {
      let options = {}
      try { options = JSON.parse((await body(request)) || "{}") } catch {}
      const problems = problemsOf(readRaw())
      if (problems.length) return json(response, 400, { error: "fix the project's problems before building", problems })
      return startBuild(options) ? json(response, 202, { started: true }) : json(response, 409, { error: "a build is already running" })
    }
    if (path === "/api/job") return json(response, 200, { running: job.running, code: job.code, lines: job.lines, startedAt: job.startedAt })
    if (path === "/api/job/events") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" })
      const send = (event, data) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      for (const line of job.lines) send("log", line)
      if (!job.running && job.code != null) send("done", { code: job.code })
      job.listeners.add(send)
      const beat = setInterval(() => response.write(": beat\n\n"), 15000)
      request.on("close", () => { clearInterval(beat); job.listeners.delete(send) })
      return
    }
    if (path.startsWith("/api/")) return json(response, 404, { error: "not found" })

    // The built front end.
    if (!existsSync(join(DIST, "index.html"))) {
      response.writeHead(503, { "content-type": "text/plain; charset=utf-8" })
      return response.end("The studio's front end is not built yet. In the comms-ai folder run:  npm install && npm run build")
    }
    const asset = inside(DIST, path === "/" ? "index.html" : path.slice(1))
    return sendFile(request, response, asset && existsSync(asset) && statSync(asset).isFile() ? asset : join(DIST, "index.html"))
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      if (!response.headersSent) json(response, error instanceof UserError ? 400 : 500, { error: error.message })
      else response.end()
    })
  })
  return { server, file, root, job }
}

export function startStudio(projectArg, { port = 4400 } = {}) {
  const studio = createStudio(projectArg)
  return new Promise((resolveStart, reject) => {
    studio.server.once("error", (error) => reject(error.code === "EADDRINUSE" ? new UserError(`port ${port} is in use. Is the studio already open? Try --port ${port + 1}.`) : error))
    studio.server.listen(port, "127.0.0.1", () => resolveStart({ ...studio, url: `http://localhost:${studio.server.address().port}/` }))
  })
}
