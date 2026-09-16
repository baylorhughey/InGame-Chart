# In-Game Chart — offensive play chart (Phase 1)

A sideline replacement for the handwritten offensive chart (Down, Distance, Yard Line,
Formation, Motion, Play, #, Yards +/-) that produces a full box score the moment the game
ends. One coach, charting alone, in real time — so the whole thing is built around
"type fast, don't stop to do math."

## Running it

Open `index.html`. That's it.

- No install, no build step, no account, no network — ever, after the first copy.
- Runs **directly from a USB drive** (`file://`). There are no ES modules, no CDN
  requests and no fetches of any kind, which is exactly what would break a page opened
  off a thumb drive.
- Works in Chrome, Edge, Firefox and Safari, on a laptop or a phone.

Open `tests.html` to run the self-test suite in the browser; `node js/tests.js` runs the
same suite from a terminal.

### Where the data lives — read this once

Saved games live in **`localStorage`, in the browser on the machine you are using**. They
do *not* travel on the USB drive, because a web page cannot write to the drive it was
opened from. So:

> **Export after every game and save the JSON onto the USB drive.** On the next laptop,
> open the app and **Import** it.

Export offers a normal Save As dialog where the browser supports one, so the file can go
straight onto the drive. If the dialog is cancelled or unavailable, the app says so and
offers a plain download instead — an export never fails silently. If a browser refuses
local storage altogether (some private-window modes), a red banner says so and the app
keeps working from memory for the session.

## Charting a play

| | |
|---|---|
| **Yard lines** | Signed, exactly like the paper chart: `-25` is our own 25, `+40` is their 40, `50` is midfield. `o25` / `opp40` also work. A bare number other than 50 is **refused** — guessing the side would silently corrupt every yardage number after it. |
| **What you type** | The starting spot of each drive, and the snap spot of each play. Nothing else about field position. |
| **Yards gained** | `fieldPos(next snap spot) − fieldPos(this snap spot)`, computed when the next play is entered. A play shows as **pending** until then. |
| **Down & distance** | Always computed, never typed. |

Internally a signed yard line becomes one 0–100 scale measuring distance from our own
goal line: `fieldPos(v) = v < 0 ? -v : (100 - v)`. Yardage is then plain subtraction.

Resolved immediately instead of pending: a touchdown (`100 − fieldPos(snap)`), an
incompletion or a spike (0 yards, and the next snap spot pre-fills with the same spot), an
interception (0 by convention), and any penalty. Anything else — run, completed pass,
scramble, sack, kneel — waits for the next snap spot, or for the **Resolve last play**
control when there is no next snap: end of half, end of game, a turnover, a final kneel.

### Keyboard (desktop)

Tab order is the order you fill the form in: formation → backfield → motion → play call →
snap spot → play type → player numbers → TD → log. **Enter logs the play from any field.**

Play type is a dropdown. Arrow keys move through it, or press a single letter to jump
straight to a type — **R**un, **P**ass, **S**ack, penalty **F**lag, **T**urnover,
safet**Y**. (The letters are ours, not the browser's type-ahead, so `F` gets you Penalty
without colliding with Pass.) Picking one by letter jumps straight to the number that play
needs, so a whole game can be charted without touching the mouse.

Drive actions use browser access keys — `Alt`+`D` start drive, `Alt`+`P` punt, `Alt`+`K`
kneel, `Alt`+`S` spike, `Alt`+`H` end half, `Alt`+`Z` undo, `Alt`+`E` export, plus
`Alt`+`R` resolve last play and `Alt`+`T` toggle TD. (Firefox uses `Alt`+`Shift`; macOS
uses `Ctrl`+`Alt`.) `Esc` clears the form without logging.

### Phone

Same data, same logic, different surface: the snap spot and play type come first, the
optional wording fields drop below them, targets are finger-sized, and a fixed
**TD / Resolve / Log play** bar sits at the bottom. The layout picks itself, and the
Layout menu overrides it.

## Rules the engine enforces

- **Goal to go.** The line to gain is capped at the goal line, so a new set inside the 10
  is `1st & Goal` with the real distance (1st & 1 at their 1), not a flat 10.
- **A standalone penalty repeats the down.** Only a real play — or an automatic first down —
  consumes one. A penalty that carries the ball past the line to gain is still a first down.
- **Half the distance to the goal** is applied automatically, from the spot the flag is
  walked off from.
- **Turnover on downs is detected, never selected.** A 4th-down play that comes up short and
  isn't a score ends the drive by itself once it resolves.
- **Penalties wipe the play by default** — no carry, catch, yardage or TD credited to anyone,
  which is right for a foul at or behind the line. **Beyond the LOS** charts the real play
  underneath (with the yards you type) and applies the flag on top as a separate field
  position adjustment.
- **A 2-point try** is charted like any other snap and never touches the box score. Only the
  drive record and the score know about it.

### Stat conventions

These follow the high-school / NCAA scoring a sideline chart is actually keeping:

- A **sack** is a rush attempt for the QB at a loss, plus a sack in the passing line. It is
  **not** a pass attempt. **Chart intentional grounding as a sack** — that is precisely why
  it is scored this way.
- A **scramble** is a rush for the QB, never a pass attempt.
- An **interception** is an attempt with no completion and no yardage.
- A **lost fumble** keeps every yard the play actually gained, then ends the drive.
- Stats are credited by jersey number. **No number means nobody is credited** — the play
  still counts for the team's yardage and for down and distance.

Our score comes straight off the chart: 6 for a touchdown, then 1 or 2 for the conversion.
Opponent scoring and defensive/special-teams scores are Phase 2.

The form is always on screen. Until a drive has been started it sits greyed out with the
reason on it and a button that takes you to the starting-spot field — the one input that
has to come first.

## Fixing mistakes mid-game

Tap any play in the list — from the running log or the drive-scoped review — and every
field on it is editable. Everything downstream recomputes live, because down, distance and
yards are all derived from the chain of snap spots.

- The recalculation **never crosses a drive boundary**. Each drive starts clean.
- It **stops at any play you corrected by hand**. Typing a down, distance or yardage stores
  an override that the automatic logic respects, then picks back up from there.
- Corrections are silent. No "edited" badge, no history trail — the chart just shows the
  corrected truth.

Three things that aren't plays are correctable too, because each of them can otherwise
put a wrong number on the board with no way back to it:

- **A drive's starting spot.** Click `from -25` in the drive header. The whole drive's down
  and distance re-run off the corrected start; nothing outside that drive moves.
- **A missed extra point.** If you start the next drive without recording the kick, the
  score would be a point short for the rest of the game. The drive review flags any
  touchdown with no conversion on it and lets you record it then — PAT good, no good, or a
  2-point result — against the drive that actually scored. Entering one again corrects it
  rather than scoring twice.
- **Undo** (`Alt`+`Z`) takes back the last thing you entered. On a drive you've just started
  and not yet charted, that thing was the drive, so the drive comes back off.

## Files

```
index.html      the shell: status strip, entry panel, drive actions, tabs, dialogs
tests.html      the self-test suite, in the browser
css/app.css     one stylesheet; body.mode-desktop / body.mode-touch switch layouts
js/engine.js    all the football logic. Pure: no DOM, no storage. The source of truth.
js/model.js     record shapes and factories
js/store.js     localStorage, with an in-memory fallback and no silent data loss
js/io.js        JSON/CSV export, import, Save As
js/app.js       state and actions — the application, shared by both input surfaces
js/dom.js       small DOM helpers, incl. the keyboard-driven segmented control
js/playform.js  the one play form, used by both live entry and the edit dialog
js/ui.js        rendering, keyboard flow, dialogs, tabs
js/tests.js     the suite itself; runs in node and in the browser
```

`engine.js` holds every rule. The two input surfaces are only input surfaces: they read
`App.computed` and call `App` actions, and hold no state of their own.

## Data model

One play record carries: game and drive ID, down, distance, snap spot, formation,
backfield, motion, play call, play type, player numbers, resolved yards (or null while
pending), TD flag, penalty details including the beyond-the-LOS flag, turnover details,
overrides, and a timestamp. Down, distance and yards are written back onto the record
after each recalculation so exports carry them, but the play log remains the only source
of truth.

Formation, backfield, motion and play call are **plain strings** on the record. The Phase 2
autocomplete library and spreadsheet import can be layered on top without migrating a
single stored game.

## Not in Phase 1, by design

No defensive or opponent-offense charting, no play diagrams, no cloud sync or accounts, no
formation/play autocomplete or spreadsheet import, no goals/report feature (3rd down %,
yardage thresholds), no opponent score, and no polish beyond the Export/Import above.
