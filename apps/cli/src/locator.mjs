// Turns a step's target into JavaScript that finds the element in the page.
//
//   "Build dataset"                      text contained in a button or link
//   { "text": "Home", "exact": true }    the whole text, nothing more
//   { "label": "Close the assistant" }   aria-label
//   { "selector": "#prompt" }            CSS
//   { "text": "Delete", "within": "[role=alertdialog]" }
//
// Text matching is "contains" by default: real buttons carry icons and
// counters ("4Review", "Accessions 28"), so "starts with" and "equals" miss.
const J = JSON.stringify
export const CLICKABLE = "button, a, [role=button], [role=menuitem], [role=tab], [role=option], summary, label, input, textarea, select"

export function locator(target) {
  const t = typeof target === "string" ? { text: target } : target ?? {}
  const match = t.exact ? `norm(e.textContent) === ${J(t.text)}` : t.starts ? `norm(e.textContent).startsWith(${J(t.text)})` : `norm(e.textContent).includes(${J(t.text)})`
  return `(() => {
    const norm = (s) => (s || "").replace(/\\s+/g, " ").trim()
    const scope = ${t.within ? `document.querySelector(${J(t.within)})` : "document"}
    if (!scope) return null
    let els = [...scope.querySelectorAll(${J(t.selector ?? CLICKABLE)})].filter((e) => {
      const r = e.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"
    })
    ${t.label != null ? `els = els.filter((e) => e.getAttribute("aria-label") === ${J(t.label)})` : ""}
    ${t.text != null ? `els = els.filter((e) => ${match}).sort((a, b) => a.textContent.length - b.textContent.length)` : ""}
    return els[${Number(t.nth ?? 0)}] || null
  })()`
}

/** "ok", "missing" or "disabled": a button that is correctly disabled is a
 *  different problem from one that is not there, and the error should say so. */
export const stateOf = (target) => `(() => { const e = ${locator(target)}; if (!e) return "missing"; return e.disabled || e.getAttribute("aria-disabled") === "true" ? "disabled" : "ok" })()`

export const describe = (target) => (typeof target === "string" ? `"${target}"` : J(target))
