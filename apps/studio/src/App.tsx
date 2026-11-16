import { useCallback, useEffect, useRef, useState } from "react"
import { loadFiles, loadJob, loadProject, loadReport, saveProject, startBuild } from "./api"
import { Preview } from "./components/Preview"
import { SceneEditor } from "./components/SceneEditor"
import { Settings } from "./components/Settings"
import { Storyboard } from "./components/Storyboard"
import { blank, move } from "./scenes"
import type { Loaded, MediaFile, Project, Report, Scene, SceneType } from "./types"

type SaveState = "saved" | "saving" | "unsaved" | "error" | "conflict"

export function App() {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [saved, setSaved] = useState<Project | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [saveState, setSaveState] = useState<SaveState>("saved")
  const [fatal, setFatal] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)
  const [files, setFiles] = useState<MediaFile[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [building, setBuilding] = useState(false)
  const [failed, setFailed] = useState(false)
  const [log, setLog] = useState<string[]>([])
  const [withVoice, setWithVoice] = useState(true)
  const [seek, setSeek] = useState<{ at: number; tick: number } | null>(null)
  const history = useRef<Project[]>([])
  const version = useRef("")
  const [canUndo, setCanUndo] = useState(false)

  /* load */
  useEffect(() => {
    loadProject().then((data) => { version.current = data.version; setLoaded(data); setProject(data.project); setSaved(data.project); setProblems(data.problems) }).catch((error: Error) => setFatal(error.message))
    loadFiles().then(setFiles).catch(() => {})
    loadReport().then(setReport).catch(() => {})
    // A build started before this page was opened (or reloaded) is picked up.
    loadJob().then((job) => { if (job.running) { setBuilding(true); setLog(job.lines) } }).catch(() => {})
  }, [])

  /* save a moment after the last change */
  useEffect(() => {
    if (!project || project === saved || saveState === "conflict") return
    setSaveState("unsaved")
    const timer = setTimeout(() => {
      setSaveState("saving")
      saveProject(project, version.current)
        .then((result) => { version.current = result.version; setSaved(project); setProblems(result.problems); setSaveState("saved"); loadReport().then(setReport).catch(() => {}) })
        .catch((error: Error & { conflict?: boolean }) => setSaveState(error.conflict ? "conflict" : "error"))
    }, 500)
    return () => clearTimeout(timer)
    // saveState is left out on purpose: this runs when the project changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, saved])

  /* follow a running build */
  useEffect(() => {
    if (!building) return
    const events = new EventSource("/api/job/events")
    const lines: string[] = []
    events.addEventListener("log", (event) => { lines.push(JSON.parse((event as MessageEvent).data)); setLog([...lines]) })
    events.addEventListener("done", (event) => {
      const { code } = JSON.parse((event as MessageEvent).data) as { code: number }
      events.close(); setBuilding(false); setFailed(code !== 0)
      loadReport().then(setReport).catch(() => {})
      loadFiles().then(setFiles).catch(() => {})
    })
    return () => events.close()
  }, [building])

  const change = useCallback((next: Project) => {
    setProject((current) => {
      if (current) { history.current.push(current); if (history.current.length > 100) history.current.shift(); setCanUndo(true) }
      return next
    })
  }, [])
  const undo = useCallback(() => {
    const previous = history.current.pop()
    setCanUndo(history.current.length > 0)
    if (previous) { setProject(previous); setSelected((index) => Math.min(index, previous.scenes.length - 1)) }
  }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName)
      if ((event.metaKey || event.ctrlKey) && event.key === "z" && !typing) { event.preventDefault(); undo() }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [undo])

  if (fatal) return <main className="center"><h1>comms studio</h1><p className="notice warning">The project could not be opened: {fatal}</p></main>
  if (!project || !loaded || !saved) return <main className="center"><p>Opening the project…</p></main>

  const scenes = project.scenes
  const setScenes = (next: Scene[]) => change({ ...project, scenes: next })
  const index = Math.min(selected, scenes.length - 1)
  const scene = scenes[index]
  const timings = report && !report.stale && report.scenes.length === scenes.length ? report.scenes : null

  const select = (target: number) => {
    setSelected(target)
    const timing = timings?.[target]
    if (timing) setSeek({ at: timing.start + 0.05, tick: Date.now() })
  }
  const reorder = (from: number, to: number) => {
    if (to < 0 || to >= scenes.length || from === to) return
    setScenes(move(scenes, from, to)); setSelected(to)
  }
  const add = (type: SceneType) => { const at = scenes.length ? index + 1 : 0; setScenes([...scenes.slice(0, at), blank(type), ...scenes.slice(at)]); setSelected(at) }
  const build = () => {
    setLog([]); setFailed(false)
    startBuild(withVoice).then(() => setBuilding(true)).catch((error: Error & { problems?: string[] }) => { setFailed(true); setLog([error.message, ...(error.problems ?? [])]) })
  }

  const blocked = saveState !== "saved" || problems.length > 0
  const status = { saved: "Saved", saving: "Saving…", unsaved: "Saving…", error: "Not saved: the studio server is not answering", conflict: "Not saved" }[saveState]

  return (
    <div className="app">
      <header className="bar">
        <div className="bar-title">
          <h1>{project.title || "Untitled"}</h1>
          <span className="path" title={loaded.file}>{loaded.file}</span>
        </div>
        <span className={`save ${saveState}`} role="status">{status}</span>
        <button type="button" onClick={undo} disabled={!canUndo}>Undo</button>
        <label className="toggle">
          <input type="checkbox" checked={withVoice} onChange={(event) => setWithVoice(event.target.checked)} />
          <span>With voiceover</span>
        </label>
        <button type="button" className="primary" onClick={build} disabled={building || blocked} title={problems.length ? "Fix the problems listed below first" : undefined}>
          {building ? "Building…" : "Build video"}
        </button>
      </header>

      {saveState === "conflict" && (
        <div className="notice warning" role="alert">
          <strong>This page is out of date.</strong> The project file was changed somewhere else (another tab, the command line or an editor), so your last change here was not saved. Reload to continue from the current version.{" "}
          <button type="button" onClick={() => window.location.reload()}>Reload the project</button>
        </div>
      )}

      {problems.length > 0 && (
        <div className="notice warning problems" role="alert">
          <strong>{problems.length === 1 ? "1 problem to fix before building" : `${problems.length} problems to fix before building`}</strong>
          <ul>{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
        </div>
      )}

      <Storyboard scenes={scenes} saved={saved.scenes} themeKey={JSON.stringify(saved.theme ?? {}) + (saved.title ?? "")} selected={index} timings={timings} onSelect={select} onMove={reorder} onAdd={add} />

      <div className="work">
        <div className="left">
          {scene ? (
            <SceneEditor
              scene={scene} index={index} count={scenes.length} files={files}
              onChange={(next) => setScenes(scenes.map((item, i) => (i === index ? next : item)))}
              onMove={(to) => reorder(index, to)}
              onDuplicate={() => { setScenes([...scenes.slice(0, index + 1), { ...scene }, ...scenes.slice(index + 1)]); setSelected(index + 1) }}
              onDelete={() => { setScenes(scenes.filter((_, i) => i !== index)); setSelected(Math.max(0, index - 1)) }}
            />
          ) : (
            <p className="empty">This video has no scenes yet. Add one above.</p>
          )}
          <Settings project={project} engines={loaded.defaults.voiceEngines} onChange={change} />
        </div>
        <Preview report={report} building={building} log={log} failed={failed} seek={seek} />
      </div>
    </div>
  )
}
