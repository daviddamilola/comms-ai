// Starts the local VoiceStudio backend alongside the Studio, and stops it
// again afterwards if this run was the one that started it. The work is done
// by scripts/voicestudio.sh, so the two never disagree about ports or flags.
import { spawn, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

const SCRIPT = fileURLToPath(new URL("../../../scripts/voicestudio.sh", import.meta.url))

// Returns at once; `log` hears how it went. The returned function stops the
// backend, but only one this call launched: a backend that was already
// running belongs to whoever started it.
export function startVoiceStudio(log, { script = SCRIPT } = {}) {
  if (!existsSync(script)) { log("  VoiceStudio was not started: scripts/voicestudio.sh is missing"); return () => false }
  let output = ""
  const child = spawn("sh", [script, "start"], { stdio: ["ignore", "pipe", "pipe"] })
  child.stdout.on("data", (chunk) => { output += chunk })
  child.stderr.on("data", (chunk) => { output += chunk })
  child.on("error", (error) => log(`  VoiceStudio was not started: ${error.message}`))
  child.on("close", (code) => {
    const last = (output.trim().split("\n").pop() ?? "").replace(/^starting\.*\s*/, "").replace(/^error: /, "")
    log(code === 0 ? `  VoiceStudio ${last}` : `  VoiceStudio was not started: ${last || `exit ${code}`}`)
  })
  // The script prints "starting" only after it has launched the backend.
  const ours = () => output.startsWith("starting")
  return () => {
    if (child.exitCode === null) child.kill()
    if (!ours()) return false
    spawnSync("sh", [script, "stop"], { stdio: "ignore" })
    return true
  }
}
