import type { ReactNode } from "react"
import { mediaUrl } from "../api"
import { retype, withField } from "../scenes"
import { VoiceRecorder } from "./VoiceRecorder"
import type { MediaFile, Scene, SceneType } from "../types"

interface Props {
  scene: Scene
  index: number
  count: number
  files: MediaFile[]
  onChange: (scene: Scene) => void
  onMove: (to: number) => void
  onDuplicate: () => void
  onDelete: () => void
}

function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={wide ? "field wide" : "field"}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  )
}

const number = (value: string) => (value === "" ? undefined : Number(value))

export function SceneEditor({ scene, index, count, files, onChange, onMove, onDuplicate, onDelete }: Props) {
  const set = <K extends keyof Scene>(key: K, value: Scene[K] | "" | undefined) => onChange(withField(scene, key, value))
  const kind = scene.type === "image" ? "image" : "video"
  const choices = files.filter((file) => file.kind === kind)
  const source = files.find((file) => file.path === scene.src)
  const missing = scene.type !== "card" && Boolean(scene.src) && !source

  return (
    <section className="editor" aria-label={`Scene ${index + 1}`}>
      <header className="editor-head">
        <h2>Scene {index + 1}</h2>
        <div className="segmented" role="group" aria-label="Scene type">
          {(["card", "clip", "image"] as SceneType[]).map((type) => (
            <button key={type} type="button" aria-pressed={scene.type === type} onClick={() => scene.type !== type && onChange(retype(scene, type))}>
              {type}
            </button>
          ))}
        </div>
        <div className="editor-actions">
          <button type="button" onClick={() => onMove(index - 1)} disabled={index === 0} aria-label="Move earlier">←</button>
          <button type="button" onClick={() => onMove(index + 1)} disabled={index === count - 1} aria-label="Move later">→</button>
          <button type="button" onClick={onDuplicate}>Duplicate</button>
          <button type="button" className="danger" onClick={onDelete} disabled={count === 1}>Delete</button>
        </div>
      </header>

      <div className="fields">
        {scene.type === "card" ? (
          <>
            <Field label="Title" hint="Press Enter where a long title should break." wide>
              <textarea rows={2} value={scene.title ?? ""} onChange={(event) => set("title", event.target.value)} />
            </Field>
            <Field label="Accent line" hint="Continues the title in the accent colour." wide>
              <textarea rows={1} value={scene.accent ?? ""} onChange={(event) => set("accent", event.target.value)} />
            </Field>
            <Field label="Subtitle" wide>
              <textarea rows={2} value={scene.subtitle ?? ""} onChange={(event) => set("subtitle", event.target.value)} />
            </Field>
            <Field label="Button" hint="A call to action, for an end card.">
              <input value={scene.button ?? ""} onChange={(event) => set("button", event.target.value)} placeholder="Join the waitlist" />
            </Field>
            <Field label="Link under the button">
              <input value={scene.note ?? ""} onChange={(event) => set("note", event.target.value)} placeholder="example.com/waitlist" />
            </Field>
            <Field label="Seconds on screen" hint="Grows by itself to fit the voice line.">
              <input type="number" min={1} step={0.1} value={scene.seconds ?? ""} placeholder="3.5" onChange={(event) => set("seconds", number(event.target.value))} />
            </Field>
            <label className="field check">
              <input type="checkbox" checked={Boolean(scene.brand)} onChange={(event) => set("brand", event.target.checked ? true : undefined)} />
              <span>Show the brand name above the title</span>
            </label>
          </>
        ) : (
          <>
            <Field label={scene.type === "clip" ? "Video" : "Image"} hint={missing ? undefined : source?.seconds ? `${source.seconds} s long` : undefined} wide>
              <select value={scene.src ?? ""} onChange={(event) => set("src", event.target.value)}>
                <option value="">Choose a file…</option>
                {missing && <option value={scene.src}>{scene.src} (not found)</option>}
                {choices.map((file) => (
                  <option key={file.path} value={file.path}>{file.path}{file.seconds ? ` · ${file.seconds} s` : ""}</option>
                ))}
              </select>
              {missing && <span className="hint error">This file is not in the project folder yet. Record it, or copy it in.</span>}
              {!choices.length && !missing && <span className="hint">No {kind === "video" ? "videos" : "images"} in the project folder. Copy some in, or run a recording.</span>}
            </Field>
            {scene.type === "clip" ? (
              <>
                <Field label="From (seconds)">
                  <input type="number" min={0} step={0.1} value={scene.from ?? ""} placeholder="0" onChange={(event) => set("from", number(event.target.value))} />
                </Field>
                <Field label="To (seconds)">
                  <input type="number" min={0} step={0.1} value={scene.to ?? ""} placeholder={source?.seconds ? String(source.seconds) : "end"} onChange={(event) => set("to", number(event.target.value))} />
                </Field>
                <Field label="Speed" hint="2 plays twice as fast.">
                  <input type="number" min={0.1} step={0.1} value={scene.speed ?? ""} placeholder="1" onChange={(event) => set("speed", number(event.target.value))} />
                </Field>
              </>
            ) : (
              <Field label="Seconds on screen">
                <input type="number" min={1} step={0.1} value={scene.seconds ?? ""} placeholder="5" onChange={(event) => set("seconds", number(event.target.value))} />
              </Field>
            )}
            <Field label="Caption" hint="Shown in a box at the bottom of the picture." wide>
              <input value={scene.caption ?? ""} onChange={(event) => set("caption", event.target.value)} />
            </Field>
            {scene.type === "clip" && source && (
              <div className="field wide">
                <span className="field-label">Source</span>
                <video className="source" src={mediaUrl(source.path)} controls muted preload="metadata" />
                <span className="hint">Scrub to find the seconds you want, then type them into From and To.</span>
              </div>
            )}
          </>
        )}
        <Field label="Voiceover" hint="Spoken during this scene. The scene stretches to fit it." wide>
          <textarea rows={2} value={scene.say ?? ""} onChange={(event) => set("say", event.target.value)} placeholder="Leave empty for no voice in this scene." />
        </Field>
        {(scene.say ?? "").trim() || scene.sayFile ? (
          <div className="field wide">
            <span className="field-label">Your recording</span>
            <VoiceRecorder path={scene.sayFile} line={scene.say ?? ""} onChange={(path) => set("sayFile", path)} />
          </div>
        ) : null}
      </div>
    </section>
  )
}
