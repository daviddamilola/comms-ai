import { useState } from "react"
import { thumbUrl } from "../api"
import { clock, label } from "../scenes"
import type { ReportScene, Scene, SceneType } from "../types"

interface Props {
  scenes: Scene[]
  /** The scenes as last saved: thumbnails are made by the server from the file. */
  saved: Scene[]
  themeKey: string
  selected: number
  timings: ReportScene[] | null
  onSelect: (index: number) => void
  onMove: (from: number, to: number) => void
  onAdd: (type: SceneType) => void
}

export function Storyboard({ scenes, saved, themeKey, selected, timings, onSelect, onMove, onAdd }: Props) {
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)

  return (
    <section className="storyboard" aria-label="Storyboard">
      <ol className="tiles">
        {scenes.map((scene, index) => {
          const timing = timings?.[index]
          // Ask for a new thumbnail only once the change is in the file.
          const savedScene = saved[index]
          const version = savedScene ? JSON.stringify(savedScene) + themeKey : ""
          return (
            <li
              key={index}
              className={["tile", index === selected ? "selected" : "", over === index && dragging !== index ? "over" : ""].join(" ")}
              draggable
              onDragStart={(event) => { setDragging(index); event.dataTransfer.effectAllowed = "move" }}
              onDragOver={(event) => { event.preventDefault(); setOver(index) }}
              onDragLeave={() => setOver((current) => (current === index ? null : current))}
              onDrop={(event) => { event.preventDefault(); if (dragging !== null && dragging !== index) onMove(dragging, index); setDragging(null); setOver(null) }}
              onDragEnd={() => { setDragging(null); setOver(null) }}
            >
              <button type="button" className="tile-button" onClick={() => onSelect(index)} aria-current={index === selected}>
                <span className="thumb">
                  {savedScene && <img key={version} src={thumbUrl(index, version)} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.visibility = "hidden" }} />}
                  <span className={`badge ${scene.type}`}>{scene.type}</span>
                  {scene.say && <span className="badge voice" title="Has a voiceover line">voice</span>}
                </span>
                <span className="tile-text">
                  <span className="tile-number">{index + 1}</span>
                  <span className="tile-label">{label(scene)}</span>
                </span>
                <span className="tile-time">{timing ? `${clock(timing.start)} · ${timing.seconds.toFixed(1)} s` : "not built"}</span>
              </button>
            </li>
          )
        })}
        <li className="tile add">
          <span className="add-title">Add a scene</span>
          <button type="button" onClick={() => onAdd("card")}>Card</button>
          <button type="button" onClick={() => onAdd("clip")}>Clip</button>
          <button type="button" onClick={() => onAdd("image")}>Image</button>
        </li>
      </ol>
    </section>
  )
}
