import { useEffect, useRef, useState } from "react"
import { mediaUrl, uploadVoice } from "../api"

interface Props {
  /** The scene's saved recording, if it has one. */
  path: string | undefined
  /** The line to read, shown while recording. */
  line: string
  onChange: (path: string | undefined) => void
}

type Stage = "idle" | "starting" | "recording" | "saving"

/** Record one voiceover line with the microphone, listen back, redo or remove it. */
export function VoiceRecorder({ path, line, onChange }: Props) {
  const [stage, setStage] = useState<Stage>("idle")
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const cancelled = useRef(false)

  const release = () => { stream.current?.getTracks().forEach((track) => track.stop()); stream.current = null; recorder.current = null }
  // Leaving the scene mid-recording drops the take and frees the microphone.
  useEffect(() => () => { cancelled.current = true; if (recorder.current?.state === "recording") recorder.current.stop(); release() }, [])
  useEffect(() => {
    if (stage !== "recording") return
    const started = Date.now()
    const timer = setInterval(() => setSeconds((Date.now() - started) / 1000), 200)
    return () => clearInterval(timer)
  }, [stage])

  const start = async () => {
    setError(null); setSeconds(0); setStage("starting"); cancelled.current = false
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") throw new Error("This browser cannot record audio.")
      const input = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false } })
      stream.current = input
      const chunks: Blob[] = []
      const made = new MediaRecorder(input)
      recorder.current = made
      made.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      made.onstop = async () => {
        release()
        if (cancelled.current) return
        setStage("saving")
        try {
          const saved = await uploadVoice(new Blob(chunks, { type: made.mimeType || "audio/webm" }))
          onChange(saved.path)
        } catch (failure) { setError((failure as Error).message) }
        setStage("idle")
      }
      made.start()
      setStage("recording")
    } catch (failure) {
      release(); setStage("idle")
      const name = (failure as DOMException).name
      setError(name === "NotAllowedError" ? "The microphone is blocked for this page. Allow it in the browser's address bar, then try again."
        : name === "NotFoundError" ? "No microphone was found."
        : (failure as Error).message)
    }
  }
  const stop = () => recorder.current?.stop()
  const busy = stage !== "idle"

  return (
    <div className="recorder">
      {stage === "recording" ? (
        <>
          <p className="recorder-line" aria-live="polite"><span className="rec-dot" aria-hidden="true" /> Recording {seconds.toFixed(1)} s{line ? <> · read: <em>{line}</em></> : null}</p>
          <button type="button" className="primary" onClick={stop}>Stop and keep</button>
        </>
      ) : (
        <>
          {path ? <audio key={path} className="take" src={mediaUrl(path)} controls preload="metadata" /> : null}
          <div className="recorder-actions">
            <button type="button" onClick={start} disabled={busy}>
              {stage === "starting" ? "Waiting for the microphone…" : stage === "saving" ? "Saving…" : path ? "Record again" : "Record this line"}
            </button>
            {path ? <button type="button" onClick={() => onChange(undefined)} disabled={busy}>Remove recording</button> : null}
          </div>
          <span className="hint">
            {path ? "This scene uses your recording instead of the generated voice. Build to hear it in the video."
              : "Use your own voice for this line. Without a recording, the video's voice setting is used."}
          </span>
        </>
      )}
      {error ? <span className="hint error" role="alert">{error}</span> : null}
    </div>
  )
}
