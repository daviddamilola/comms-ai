// Title cards and captions are HTML rendered to PNG by headless Chrome.
// (Not ffmpeg's drawtext: many ffmpeg builds, Homebrew's included, lack it.)
import { existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { chromePath, ensureDir, run, sha, UserError } from "./util.mjs"

const escape = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
/** Line breaks in the JSON ("\n") are honoured: long titles wrap badly on
 *  their own, so break them where they should break. */
const lines = (text) => escape(text).replace(/\n/g, "<br>")

function page(project, body, transparent) {
  const [width, height] = project.size
  const t = project.theme
  const k = width / 1440            // sizes below are tuned at 1440 px wide
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:${transparent ? "transparent" : t.background};font-family:${t.font};color:${t.foreground}}
.c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 ${140 * k}px}
h1{font-size:${60 * k}px;line-height:1.14;font-weight:700;letter-spacing:${-1.4 * k}px;margin:0}
h2{font-size:${30 * k}px;font-weight:400;color:${t.muted};margin:${26 * k}px 0 0;line-height:1.35}
.a{color:${t.accent}}
.brand{font-size:${44 * k}px;font-weight:700;letter-spacing:${-0.8 * k}px;margin-bottom:${34 * k}px;display:flex;align-items:center;gap:${18 * k}px}
.dot{width:${22 * k}px;height:${22 * k}px;border-radius:50%;background:${t.accent}}
.btn{margin-top:${44 * k}px;background:${t.accent};color:${t.accentInk};font-size:${32 * k}px;font-weight:700;padding:${18 * k}px ${44 * k}px;border-radius:${14 * k}px}
.note{margin-top:${22 * k}px;font-size:${26 * k}px;color:${t.muted}}
.cap{position:absolute;left:0;right:0;bottom:${54 * k}px;display:flex;justify-content:center;padding:0 ${60 * k}px}
.cap span{background:rgba(8,12,10,.90);border:1px solid ${t.accent}8c;border-radius:${14 * k}px;padding:${16 * k}px ${30 * k}px;font-size:${31 * k}px;font-weight:600;letter-spacing:${-0.3 * k}px;box-shadow:0 10px 40px rgba(0,0,0,.6);text-align:center}
</style></head><body>${body}</body></html>`
}

export function cardHtml(project, scene) {
  const parts = []
  if (scene.brand ?? false) parts.push(`<div class="brand"><span class="dot"></span>${escape(scene.brand === true ? project.theme.brand || project.title : scene.brand)}</div>`)
  if (scene.title || scene.accent) parts.push(`<h1>${scene.title ? lines(scene.title) : ""}${scene.title && scene.accent ? "<br>" : ""}${scene.accent ? `<span class="a">${lines(scene.accent)}</span>` : ""}</h1>`)
  if (scene.subtitle) parts.push(`<h2>${lines(scene.subtitle)}</h2>`)
  if (scene.button) parts.push(`<div class="btn">${escape(scene.button)}</div>`)
  if (scene.note) parts.push(`<div class="note">${escape(scene.note)}</div>`)
  return page(project, `<div class="c">${parts.join("")}</div>`, false)
}
export const captionHtml = (project, text) => page(project, `<div class="cap"><span>${lines(text)}</span></div>`, true)

/** Render HTML to a PNG, cached by content. Returns the PNG path. */
export function renderPng(project, html, { transparent = false } = {}) {
  const dir = ensureDir(join(project.root, ".cache", "text"))
  const name = sha(html, transparent, project.size)
  const png = join(dir, `${name}.png`)
  if (existsSync(png)) return png
  const bin = chromePath()
  if (!bin) throw new UserError("Chrome was not found. Run `comms doctor`.")
  const source = join(dir, `${name}.html`)
  writeFileSync(source, html)
  const [width, height] = project.size
  run(bin, ["--headless=new", "--hide-scrollbars", "--force-device-scale-factor=1", `--window-size=${width},${height}`,
    `--screenshot=${png}`, ...(transparent ? ["--default-background-color=00000000"] : []), `file://${source}`])
  if (!existsSync(png)) throw new Error(`Chrome did not write ${png}`)
  return png
}
