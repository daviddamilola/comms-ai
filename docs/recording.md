# Filming a web app

`comms record` opens your app in headless Chrome, follows a list of steps, and
saves what the page showed as `clips/<name>.mp4`. A cursor is drawn so viewers
can follow the clicks. Waiting is sped up, so a three-minute job plays in
seconds.

```json
"recordings": {
  "tour": {
    "url": "http://localhost:3000/",
    "colorScheme": "dark",
    "localStorage": { "theme": "dark" },
    "prepare": [ { "click": "Accept cookies" } ],
    "steps": [
      { "click": "New dataset" },
      { "paste": "A long prompt...", "into": { "selector": "#prompt" } },
      { "key": "Enter" },
      { "wait": { "gone": "Stop" }, "speed": 7, "timeout": 720 },
      { "click": "Build dataset" },
      { "wait": { "url": "/builds/" }, "timeout": 300 },
      { "wait": { "for": "Open in browser" }, "speed": 36, "timeout": 3600 },
      { "click": "Open in browser" },
      { "wait": { "for": { "selector": "canvas" } }, "timeout": 120 },
      { "sleep": 4 }
    ]
  }
}
```

| Field | Meaning |
|---|---|
| `url` | Where to start: an address, or a file in the project (`site/index.html`). |
| `viewport` | `[width, height]`; defaults to the project's `size`. |
| `colorScheme` | `dark` (default) or `light`. |
| `localStorage` | Values set before filming (a theme, a dismissed banner). |
| `prepare` | Steps run before the camera starts. |
| `steps` | Steps that are filmed. |
| `hold` | Seconds to linger on the last screen (default 1.5). |
| `maxStill` | Longest a motionless screen may last in the clip (default 3.5 s). |
| `cursor` | `false` hides the drawn cursor. |

## Steps

| Step | Does |
|---|---|
| `{ "click": target }` | Moves the cursor to the element and clicks. Waits until it exists and is enabled. |
| `{ "hover": target }` | Moves the cursor onto it. |
| `{ "move": [x, y] }` | Moves the cursor to a point. |
| `{ "type": "text", "into": target }` | Types, one character at a time. |
| `{ "paste": "text", "into": target }` | Sets a field's value at once, as a paste does. Use for long prompts. |
| `{ "key": "Enter" }` | Presses Enter, Escape, Tab or Backspace. |
| `{ "scroll": { "to": "bottom", "in": target } }` | Scrolls the page or an element; `to` is `"bottom"` or pixels. |
| `{ "wait": condition }` | Waits (see below). Add `"speed": 12` to fast-forward the wait. |
| `{ "sleep": 2 }` | Lets the viewer look for 2 seconds. |
| `{ "speed": 4 }` | Fast-forwards everything until set back to 1. |
| `{ "goto": "/settings" }` | Opens another page. |
| `{ "eval": "window.scrollTo(0, 0)" }` | Runs JavaScript in the page. |

`timeout` (seconds, default 30) and `pause` (seconds to rest afterwards) work
on every step.

## Targets

| Target | Finds |
|---|---|
| `"Build dataset"` | A button, link, tab or field whose text **contains** this. |
| `{ "text": "Home", "exact": true }` | Text that is exactly this. |
| `{ "label": "Close the assistant" }` | An `aria-label`. |
| `{ "selector": "#prompt" }` | A CSS selector. |
| `{ "text": "Delete", "within": "[role=alertdialog]" }` | Only inside another element. |
| `{ "selector": "li", "nth": 1 }` | The second match. |

When several elements contain the text, the one with the least other text wins.

## Wait conditions

| Condition | True when |
|---|---|
| `{ "for": target }` | The element is on the page. |
| `{ "enabled": target }` | It is on the page and not disabled. |
| `{ "gone": target }` | It is no longer on the page. |
| `{ "url": "/builds/" }` | The address contains this. |
| `{ "text": "Summary ready", "in": "#status" }` | The page (or one element) shows this text. |
| `{ "js": "window.done === true" }` | The expression is true. |

Wait for the thing that means success: a button that only appears when the
job is done, an address, a status element. Do not wait on a word such as
"failed" or "done" anywhere on the page: logs and tables contain those words
while everything is fine.

## When a recording fails

The command exits non-zero and says why in one sentence, for example:

```
error: recording "tour" failed: "Build dataset" is on the page but disabled (waited 30 s). Does an earlier step still need to finish?
  screenshot of the page at that moment: clips/tour.failure.png
  what was filmed up to then: clips/tour.failed.mp4
  log: clips/tour.log
```

A failed take never replaces a good `clips/tour.mp4`.

## Things worth knowing before you film

- **Some recordings can only be made once.** Deleting a record or starting a
  build changes your app. Put the app in the right state first, and split a
  long walkthrough into several recordings so one failure does not cost the
  rest.
- **Rehearse with short timeouts**, then raise them for the real take.
- **Long waits need long timeouts.** A build that takes four minutes needs
  `"timeout": 600`, and `"speed": 36` so it plays in seconds.
- **Free memory first.** A recording that drives a local model or a build is
  competing with it. Close what you do not need.
