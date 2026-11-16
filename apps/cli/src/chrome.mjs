// Headless Chrome over the DevTools protocol, with no npm dependency
// (Node 22 has WebSocket and fetch built in).
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { chromePath, sleep, UserError } from "./util.mjs"

export async function launch({ width, height }) {
  const bin = chromePath()
  if (!bin) throw new UserError("Chrome was not found. Install Google Chrome or set COMMS_CHROME. Run `comms doctor`.")
  const profile = mkdtempSync(join(tmpdir(), "comms-chrome-"))
  // Port 0: Chrome picks a free port, so two recordings never collide and
  // nothing has to be killed by port number.
  const child = spawn(bin, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, "--hide-scrollbars", "--no-first-run",
    "--force-device-scale-factor=1", "--disable-background-timer-throttling", "about:blank",
  ], { stdio: "ignore" })
  const close = () => { try { child.kill("SIGKILL") } catch {} ; try { rmSync(profile, { recursive: true, force: true }) } catch {} }
  process.once("exit", close)

  let port
  for (let i = 0; i < 100 && !port; i++) {
    const file = join(profile, "DevToolsActivePort")
    if (existsSync(file)) port = Number(readFileSync(file, "utf8").split("\n")[0])
    else await sleep(100)
  }
  if (!port) { close(); throw new Error("Chrome did not start") }
  let targets
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); if (targets.some((t) => t.type === "page")) break } catch {}
    await sleep(100)
  }
  const page = targets?.find((t) => t.type === "page")
  if (!page) { close(); throw new Error("Chrome has no page to drive") }

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }) })
  let seq = 0
  const pending = new Map()
  const listeners = new Map()
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); return }
    for (const handler of listeners.get(message.method) ?? []) handler(message.params)
  })

  /** One protocol call. Every call has a deadline: a page that stops
   *  answering must fail the recording, not hang it for an hour. */
  const send = (method, params = {}, timeoutMs = 30000) => new Promise((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Chrome did not answer ${method} within ${timeoutMs / 1000} s`)) }, timeoutMs)
    pending.set(id, (message) => { clearTimeout(timer); message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result) })
    ws.send(JSON.stringify({ id, method, params }))
  })
  const on = (method, handler) => { listeners.set(method, [...(listeners.get(method) ?? []), handler]) }
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
  const sendRaw = (payload) => ws.send(JSON.stringify({ id: ++seq, ...payload }))

  await send("Page.enable"); await send("Runtime.enable")
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false })
  return { send, sendRaw, on, evaluate, close: () => { try { ws.close() } catch {} ; close() } }
}
