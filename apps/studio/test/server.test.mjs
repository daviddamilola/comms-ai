import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { inside, listMedia, localHost, sameOrigin, startStudio } from "../server/index.mjs"

test("inside() refuses paths that leave the project", () => {
  assert.equal(inside("/p", "clips/a.mp4"), "/p/clips/a.mp4")
  assert.equal(inside("/p", "../secret"), null)
  assert.equal(inside("/p", "/etc/passwd"), null)
  assert.equal(inside("/p", "../p2/x"), null)
})

test("only local addresses are accepted as Host and Origin", () => {
  assert.ok(localHost("localhost:4400") && localHost("127.0.0.1:4400"))
  assert.ok(!localHost("evil.example:4400") && !localHost("localhost.evil.example") && !localHost(undefined))
  assert.ok(sameOrigin({ headers: {} }))
  assert.ok(sameOrigin({ headers: { origin: "http://localhost:4401" } }))
  assert.ok(!sameOrigin({ headers: { origin: "https://evil.example" } }))
  assert.ok(!sameOrigin({ headers: { origin: "null" } }))
})

function project() {
  const root = mkdtempSync(join(tmpdir(), "comms-studio-"))
  for (const dir of ["clips", "shots", "out", ".cache"]) mkdirSync(join(root, dir))
  for (const file of ["clips/tour.mp4", "shots/a.png", "out/video.mp4", ".cache/x.png", "notes.txt"]) writeFileSync(join(root, file), "")
  writeFileSync(join(root, "video.json"), JSON.stringify({ title: "T", voice: { engine: "none" }, music: false, scenes: [{ type: "card", title: "Hello" }] }))
  return root
}

test("listMedia() finds the project's images and videos, not build output", () => {
  assert.deepEqual(listMedia(project()).map((f) => [f.path, f.kind]), [["clips/tour.mp4", "video"], ["shots/a.png", "image"]])
})

test("the server reads and saves the project, and refuses other sites", async () => {
  const root = project()
  const studio = await startStudio(root, { port: 0 })
  const base = studio.url.replace(/\/$/, "")
  try {
    const loaded = await (await fetch(`${base}/api/project`)).json()
    assert.equal(loaded.project.title, "T")
    assert.deepEqual(loaded.problems, [])

    const put = (body, headers = {}) => fetch(`${base}/api/project`, { method: "PUT", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) })
    const saved = await (await put({ title: "T2", scenes: [{ type: "clip" }] })).json()
    assert.equal(JSON.parse(readFileSync(join(root, "video.json"), "utf8")).title, "T2")
    assert.ok(saved.problems.some((p) => p.includes('"src"')))

    assert.equal((await put({ title: "no scenes" })).status, 400)
    assert.equal((await put({ title: "T3", scenes: [] }, { origin: "https://evil.example" })).status, 403)
    assert.equal(JSON.parse(readFileSync(join(root, "video.json"), "utf8")).title, "T2")

    assert.equal((await fetch(`${base}/api/media?path=${encodeURIComponent("../../etc/hosts")}`)).status, 404)
    const blocked = await fetch(`${base}/api/build`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    assert.equal(blocked.status, 400, "a project with problems is not built")
  } finally { studio.server.closeAllConnections(); studio.server.close() }
})
