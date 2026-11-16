import type { Project } from "../types"

interface Props {
  project: Project
  engines: string[]
  onChange: (project: Project) => void
}

const ENGINE_NAMES: Record<string, string> = {
  say: "Built-in voice (fast, synthetic)",
  voicestudio: "Cloned voice (VoiceStudio, slow)",
  recorded: "My own recording",
  command: "Another speech program",
  none: "No voiceover",
}

export function Settings({ project, engines, onChange }: Props) {
  const voice = project.voice ?? {}
  const music = project.music === false ? null : project.music ?? {}
  const theme = project.theme ?? {}
  return (
    <details className="settings">
      <summary>Video settings</summary>
      <div className="fields">
        <label className="field">
          <span className="field-label">Title</span>
          <input value={project.title ?? ""} onChange={(event) => onChange({ ...project, title: event.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Brand name</span>
          <input value={theme.brand ?? ""} onChange={(event) => onChange({ ...project, theme: { ...theme, brand: event.target.value } })} />
        </label>
        <label className="field">
          <span className="field-label">Accent colour</span>
          <input type="color" value={theme.accent ?? "#4fcf85"} onChange={(event) => onChange({ ...project, theme: { ...theme, accent: event.target.value } })} />
        </label>
        <label className="field">
          <span className="field-label">Voice</span>
          <select value={voice.engine ?? "say"} onChange={(event) => onChange({ ...project, voice: { ...voice, engine: event.target.value } })}>
            {engines.map((engine) => <option key={engine} value={engine}>{ENGINE_NAMES[engine] ?? engine}</option>)}
          </select>
        </label>
        {(voice.engine ?? "say") === "say" && (
          <label className="field">
            <span className="field-label">Voice name</span>
            <input value={(voice.voice as string) ?? ""} placeholder="Daniel" onChange={(event) => onChange({ ...project, voice: { ...voice, voice: event.target.value || undefined } })} />
          </label>
        )}
        <label className="field check">
          <input type="checkbox" checked={music !== null} onChange={(event) => onChange({ ...project, music: event.target.checked ? { synth: true, volume: 0.32 } : false })} />
          <span>Background music</span>
        </label>
        {music !== null && (
          <label className="field">
            <span className="field-label">Music volume ({Math.round((music.volume ?? 0.32) * 100)}%)</span>
            <input type="range" min={0.05} max={0.8} step={0.01} value={music.volume ?? 0.32} onChange={(event) => onChange({ ...project, music: { ...music, volume: Number(event.target.value) } })} />
          </label>
        )}
      </div>
      <p className="hint">Recordings, cloned-voice details and pronunciations are edited in video.json for now.</p>
    </details>
  )
}
