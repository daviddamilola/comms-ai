import { useEffect, useRef } from "react"
import { mediaUrl } from "../api"
import { clock } from "../scenes"
import type { Report } from "../types"

interface Props {
  report: Report | null
  building: boolean
  log: string[]
  failed: boolean
  /** Seconds to jump the player to, with a counter so the same scene can be picked twice. */
  seek: { at: number; tick: number } | null
}

export function Preview({ report, building, log, failed, seek }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const logBox = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (seek && video.current) video.current.currentTime = seek.at
  }, [seek])
  useEffect(() => {
    if (logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight
  }, [log])

  const showLog = building || failed
  return (
    <aside className="preview" aria-label="Preview">
      {report?.output && !building ? (
        <>
          <video ref={video} className="player" key={report.builtAt} src={mediaUrl(report.output, report.builtAt)} controls preload="metadata" />
          <p className="facts">
            {clock(report.seconds)} · {report.scenes.length} scenes · {report.voiceLines} voice lines
            {report.audio ? ` · sound ${report.audio.mean} dB average, ${report.audio.max} dB peak` : " · silent"}
          </p>
          {report.stale && <p className="notice">The project has changed since this was built. Build again to see the changes.</p>}
          {report.warnings.length > 0 && (
            <div className="notice warning">
              <strong>{report.warnings.length === 1 ? "1 warning" : `${report.warnings.length} warnings`}</strong>
              <ul>{report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </div>
          )}
          {report.adjustments.length > 0 && (
            <details className="notice">
              <summary>{report.adjustments.length === 1 ? "1 scene was retimed" : `${report.adjustments.length} scenes were retimed`} to fit the voice</summary>
              <ul>{report.adjustments.map((line) => <li key={line}>{line}</li>)}</ul>
            </details>
          )}
          {report.contactSheet && (
            <details className="sheet">
              <summary>Contact sheet: one frame per scene</summary>
              <img src={mediaUrl(report.contactSheet, report.builtAt)} alt="One frame from the middle of every scene, in order" />
            </details>
          )}
        </>
      ) : (
        !building && <p className="empty">Nothing built yet. Press <strong>Build video</strong> to render the scenes into a video.</p>
      )}
      {showLog && (
        <div className="log-wrap">
          <p className={failed ? "notice warning" : "notice"}>{building ? "Building… this page can stay open; the build runs on your machine." : "The build failed. The last lines say why."}</p>
          <pre ref={logBox} className="log" aria-live="polite">{log.join("\n") || "Starting…"}</pre>
        </div>
      )}
    </aside>
  )
}
