// Records a walkthrough of a web app: drives the real page in headless Chrome
// from a list of steps and saves what the screen showed as a clip.
//
// Waits are sped up in the finished clip, so a three-minute build plays in a
// few seconds. See docs/recording.md for the step reference.
import { appendFileSync, existsSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { launch } from "./chrome.mjs"
import { describe, locator, stateOf } from "./locator.mjs"
import { diskFreeGb, duration, ensureDir, ffmpeg, log, round, sleep, UserError } from "./util.mjs"

const J = JSON.stringify
const CURSOR_JS = `(() => {
  if (window.__commsCursor) return
  const make = () => {
    if (document.getElementById("__comms_cursor")) return
    const c = document.createElement("div"); c.id = "__comms_cursor"
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 3l14 8-6 2-2 6z" fill="#fff" stroke="#000" stroke-width="1.4" stroke-linejoin="round"/></svg>'
    c.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-200px,-200px);transition:transform .08s linear;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))"
    document.documentElement.appendChild(c)
  }
  window.__commsCursor = (x, y) => { make(); document.getElementById("__comms_cursor").style.transform = "translate(" + (x - 4) + "px," + (y - 3) + "px)" }
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", make); else make()
})()`

export async function record(project, name, { keepFrames = false } = {}) {
  const spec = project.recordings[name]
  if (!spec) throw new UserError(`no recording named "${name}". Defined: ${Object.keys(project.recordings).join(", ") || "none"}`)
  const [width, height] = spec.viewport ?? project.size
  const clips = ensureDir(join(project.root, "clips"))
  const work = join(project.root, ".cache", "record", name)
  rmSync(work, { recursive: true, force: true })
  const framesDir = ensureDir(join(work, "frames"))
  const logFile = join(clips, `${name}.log`)
  writeFileSync(logFile, "")
  const note = (...parts) => { const line = `${new Date().toISOString().slice(11, 19)} ${parts.join(" ")}`; log(`  ${line}`); appendFileSync(logFile, line + "\n") }

  // Screencast frames are JPEGs on disk until the clip is encoded.
  const free = diskFreeGb(project.root)
  if (free != null && free < 2) throw new UserError(`only ${free.toFixed(1)} GB of disk is free; recording needs at least 2 GB`)

  const url = /^[a-z]+:\/\//.test(spec.url) ? spec.url : pathToFileURL(project.at(spec.url)).href
  const chrome = await launch({ width, height })
  const { send, evaluate } = chrome
  const frames = []                // { file, t }
  const speeds = [{ t: 0, speed: 1 }]
  const now = () => Date.now() / 1000
  let recording = false, lastFrameAt = 0, cursor = [width / 2, height / 2]
  const speedNow = () => speeds[speeds.length - 1].speed
  const setSpeed = (speed) => { if (speed !== speedNow()) { speeds.push({ t: now(), speed }); note(`speed x${speed}`) } }

  chrome.on("Page.screencastFrame", (params) => {
    // Keep about 12 frames per second *of finished video*. Saving every frame
    // of a spinner during a long wait writes ~100 MB a minute.
    const t = now()
    if (recording && t - lastFrameAt >= speedNow() / 12) {
      lastFrameAt = t
      const file = join(framesDir, `${String(frames.length + 1).padStart(6, "0")}.jpg`)
      writeFileSync(file, Buffer.from(params.data, "base64"))
      frames.push({ file, t })
    }
    chrome.sendRaw({ method: "Page.screencastFrameAck", params: { sessionId: params.sessionId } })
  })

  const waitFor = async (expression, timeoutMs, what) => {
    const end = Date.now() + timeoutMs
    while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(200) }
    throw new Error(`timed out after ${timeoutMs / 1000} s waiting for ${what}`)
  }
  const moveTo = async (x, y, ms = 600) => {
    const [x0, y0] = cursor, n = Math.max(2, Math.round(ms / 40))
    for (let i = 1; i <= n; i++) {
      const k = i / n, e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2
      const px = x0 + (x - x0) * e, py = y0 + (y - y0) * e
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: px, y: py })
      if (spec.cursor !== false) await evaluate(`window.__commsCursor && window.__commsCursor(${px}, ${py})`)
      await sleep(40)
    }
    cursor = [x, y]
  }
  const find = async (target, timeoutMs) => {
    const end = Date.now() + timeoutMs
    let state = "missing"
    while (Date.now() < end) { state = await evaluate(stateOf(target)); if (state === "ok") break; await sleep(200) }
    if (state === "missing") throw new Error(`nothing on the page matches ${describe(target)} (waited ${timeoutMs / 1000} s)`)
    if (state === "disabled") throw new Error(`${describe(target)} is on the page but disabled (waited ${timeoutMs / 1000} s). Does an earlier step still need to finish?`)
    await evaluate(`${locator(target)}.scrollIntoView({ block: "center", inline: "nearest" })`)
    await sleep(350)
    return evaluate(`(() => { const b = ${locator(target)}.getBoundingClientRect(); return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)] })()`)
  }
  const click = async (target, timeoutMs) => {
    const [x, y] = await find(target, timeoutMs)
    await moveTo(x, y)
    note(`click ${describe(target)} @${x},${y}`)
    for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 })
  }

  const runStep = async (step) => {
    const timeout = (step.timeout ?? 30) * 1000
    if (step.speed != null && step.wait == null) return setSpeed(step.speed)
    if (step.goto != null) {
      const target = /^[a-z]+:\/\//.test(step.goto) ? step.goto : new URL(step.goto, url).href
      note(`goto ${target}`); await send("Page.navigate", { url: target }); await sleep(step.settle ?? 1200); return
    }
    if (step.sleep != null) return sleep(step.sleep * 1000)
    if (step.click != null) { await click(step.click, timeout); return sleep((step.pause ?? 0.8) * 1000) }
    if (step.hover != null) { const [x, y] = await find(step.hover, timeout); await moveTo(x, y); return sleep((step.pause ?? 0.8) * 1000) }
    if (step.move != null) { await moveTo(step.move[0], step.move[1], step.ms ?? 800); return sleep((step.pause ?? 0.5) * 1000) }
    if (step.type != null) {
      if (step.into) await click(step.into, timeout)
      for (const ch of String(step.type)) { await send("Input.insertText", { text: ch }); await sleep(step.delay ?? 35) }
      return sleep((step.pause ?? 0.6) * 1000)
    }
    if (step.paste != null) {
      // Set the value the way a paste does, so frameworks (React) see it.
      await click(step.into, timeout)
      const ok = await evaluate(`(() => { const el = ${locator(step.into)}; if (!el) return false
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
        el.focus(); Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${J(String(step.paste))})
        el.dispatchEvent(new Event("input", { bubbles: true })); return true })()`)
      if (!ok) throw new Error(`could not paste into ${describe(step.into)}`)
      note(`paste ${String(step.paste).length} characters`); return sleep((step.pause ?? 1) * 1000)
    }
    if (step.key != null) {
      const code = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8 }[step.key] ?? 0
      for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: step.key, code: step.key, windowsVirtualKeyCode: code, ...(type === "keyDown" && step.key === "Enter" ? { text: "\r" } : {}) })
      return sleep((step.pause ?? 0.6) * 1000)
    }
    if (step.scroll != null) {
      const s = step.scroll
      await evaluate(`(() => { const el = ${s.in ? locator(s.in) : "document.scrollingElement"}; el.scrollTo({ top: ${s.to === "bottom" ? "el.scrollHeight" : Number(s.to ?? 0)}, behavior: "smooth" }); return true })()`)
      return sleep((step.pause ?? 1.2) * 1000)
    }
    if (step.eval != null) { await evaluate(`(async () => { ${step.eval} })()`); return sleep((step.pause ?? 0) * 1000) }
    if (step.wait != null) {
      const w = step.wait
      // Wait for something specific. Never "the page says failed": logs and
      // tables contain such words while everything is fine.
      const [expression, what] =
        w.for != null ? [`${stateOf(w.for)} !== "missing"`, describe(w.for)] :
        w.enabled != null ? [`${stateOf(w.enabled)} === "ok"`, `${describe(w.enabled)} to be enabled`] :
        w.gone != null ? [`${stateOf(w.gone)} === "missing"`, `${describe(w.gone)} to go away`] :
        w.url != null ? [`location.href.includes(${J(w.url)})`, `the address to contain "${w.url}"`] :
        w.text != null ? [`${w.in ? `(document.querySelector(${J(w.in)})?.innerText ?? "")` : "document.body.innerText"}.includes(${J(w.text)})`, `the text "${w.text}"`] :
        w.js != null ? [w.js, `the condition ${w.js}`] : [null, null]
      if (!expression) throw new UserError(`a wait needs one of: for, enabled, gone, url, text, js. Got ${J(w)}`)
      const before = speedNow()
      if (step.speed != null) setSpeed(step.speed)
      try { await waitFor(expression, timeout, what) } finally { setSpeed(before) }
      return sleep((step.pause ?? 0.8) * 1000)
    }
    throw new UserError(`unknown step ${J(step)}. See docs/recording.md.`)
  }

  let failed = null
  try {
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: spec.colorScheme ?? "dark" }] })
    await send("Page.addScriptToEvaluateOnNewDocument", { source: CURSOR_JS })
    await send("Page.navigate", { url }); await sleep(1500)
    if (spec.localStorage) {
      await evaluate(`(() => { for (const [k, v] of Object.entries(${J(spec.localStorage)})) localStorage.setItem(k, v); return true })()`)
      await send("Page.navigate", { url }); await sleep(1500)
    }
    for (const step of spec.prepare ?? []) await runStep(step)      // not filmed
    speeds[0].t = now()
    await send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: width, maxHeight: height, everyNthFrame: 1 })
    recording = true
    note(`recording "${name}" at ${width}x${height}`)
    await sleep(1000)
    for (const step of spec.steps) await runStep(step)
    await sleep((spec.hold ?? 1.5) * 1000)
  } catch (error) {
    failed = error
    note(`FAILED: ${error.message}`)
    try { const shot = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(join(clips, `${name}.failure.png`), Buffer.from(shot.data, "base64")); note(`screenshot: clips/${name}.failure.png`) } catch {}
  }
  const end = now()
  recording = false
  try { await send("Page.stopScreencast") } catch {}
  chrome.close()

  let output = null
  if (frames.length >= 2) {
    const list = join(work, "frames.txt")
    writeFileSync(list, concatList(frames, speeds, end, spec.maxStill ?? 3.5))
    // A failed take is still encoded, under another name, so you can watch
    // what happened; it never replaces a good clip.
    output = join(clips, failed ? `${name}.failed.mp4` : `${name}.mp4`)
    ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-vf", `fps=${project.fps},format=yuv420p`, "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-movflags", "+faststart", output])
    note(`${failed ? "partial clip" : "clip"}: ${output} (${round(duration(output), 1)} s from ${frames.length} frames)`)
  }
  if (!keepFrames) rmSync(work, { recursive: true, force: true })
  if (failed) {
    if (failed instanceof UserError) throw failed
    throw new UserError(`recording "${name}" failed: ${failed.message}\n  screenshot of the page at that moment: clips/${name}.failure.png` + (output ? `\n  what was filmed up to then: clips/${name}.failed.mp4` : "") + `\n  log: clips/${name}.log`)
  }
  if (existsSync(join(clips, `${name}.failure.png`))) rmSync(join(clips, `${name}.failure.png`))
  if (existsSync(join(clips, `${name}.failed.mp4`))) rmSync(join(clips, `${name}.failed.mp4`))
  return output
}

/** ffmpeg concat list: each frame lasts until the next one, divided by the
 *  speed in force, and capped so a still screen never drags. */
export function concatList(frames, speeds, end, maxStill = 3.5) {
  const speedAt = (t) => { let s = 1; for (const mark of speeds) if (mark.t <= t) s = mark.speed; return s }
  const lines = []
  frames.forEach((frame, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : end
    const seconds = Math.min(maxStill, Math.max(1 / 60, (next - frame.t) / speedAt(frame.t)))
    lines.push(`file '${frame.file}'`, `duration ${seconds.toFixed(4)}`)
  })
  lines.push(`file '${frames[frames.length - 1].file}'`)   // concat needs the last frame twice
  return lines.join("\n") + "\n"
}

export const recordingNames = (project) => Object.keys(project.recordings)
export const leftovers = (project) => { const dir = join(project.root, "clips"); return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".failed.mp4")) : [] }
