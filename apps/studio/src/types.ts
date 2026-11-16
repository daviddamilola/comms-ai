export type SceneType = "card" | "clip" | "image"

/** A scene exactly as it is stored in video.json. */
export interface Scene {
  type: SceneType
  say?: string
  caption?: string
  // card
  title?: string
  accent?: string
  subtitle?: string
  brand?: boolean | string
  button?: string
  note?: string
  seconds?: number
  // clip, image
  src?: string
  from?: number
  to?: number
  speed?: number
}

export interface Project {
  title?: string
  size?: [number, number]
  theme?: { brand?: string; accent?: string; [key: string]: string | undefined }
  voice?: { engine?: string; voice?: string; [key: string]: unknown }
  music?: false | { synth?: unknown; file?: string; volume?: number; [key: string]: unknown }
  scenes: Scene[]
  [key: string]: unknown
}

export interface MediaFile { path: string; kind: "image" | "video"; seconds: number | null }

export interface ReportScene { scene: number; type: SceneType; start: number; seconds: number }
export interface Report {
  output: string | null
  contactSheet: string | null
  seconds: number
  voiceLines: number
  audio: { mean: number; max: number } | null
  warnings: string[]
  adjustments: string[]
  scenes: ReportScene[]
  builtAt: number
  stale: boolean
}

export interface Loaded {
  file: string
  root: string
  project: Project
  problems: string[]
  defaults: { voiceEngines: string[]; theme: Record<string, string>; voice: Record<string, unknown>; music: Record<string, unknown> }
}
