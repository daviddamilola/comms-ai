import type { Loaded, MediaFile, Project, Report } from "./types"

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data.error ?? `the studio server answered ${response.status}`), { problems: data.problems as string[] | undefined })
  return data as T
}

export const loadProject = () => call<Loaded>("/api/project")
export const saveProject = (project: Project) =>
  call<{ problems: string[] }>("/api/project", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(project) })
export const loadFiles = () => call<{ files: MediaFile[] }>("/api/files").then((r) => r.files)
export const loadReport = () => call<{ report: Report | null }>("/api/report").then((r) => r.report)
export const loadJob = () => call<{ running: boolean; code: number | null; lines: string[] }>("/api/job")
export const startBuild = (voice: boolean) =>
  call<{ started: boolean }>("/api/build", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voice }) })

export const mediaUrl = (path: string, version: number | string = "") => `/api/media?path=${encodeURIComponent(path)}&v=${version}`
export const thumbUrl = (scene: number, version: string) => `/api/thumb?scene=${scene}&v=${encodeURIComponent(version)}`
