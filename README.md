# In-Game Chart — offensive play chart

A sideline replacement for the handwritten offensive chart (Down, Distance, Yard Line,
Formation, Motion, Play, #, Yards +/-) that produces a full box score the moment the game
ends. One coach, charting alone, in real time — so the whole thing is built around
"type fast, don't stop to do math."

## Running it

Open `index.html`. That's it.

**The whole app is that one file.** All the CSS and all the JavaScript are inlined in it —
no `js/` folder, no `css/` folder, no external references of anything. Copy the single
file wherever you like and it works; there is nothing beside it to lose, and copying it
alone cannot leave you with a half-working page.

- No install, no build step, no account, no network — ever. Opening the page makes exactly
  one request: the page itself.
- Runs **directly from a USB drive** (`file://`). No ES modules, no CDN, no fetches — the
  things that break a page opened off a thumb drive.
- Works in Chrome, Edge, Firefox and Safari, on a laptop or a phone.

**Check a laptop in five seconds:** open the app, click **?**, then **Run self-test**. It
should say *35 passed, 0 failed*. Adding `#selftest` to the address does the same thing.

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
| **Yard lines** | A bare number is **their** side: `40` is their 40. A minus makes it ours: `-25` is our own 25. `50` is midfield either way. `+40`, `o25` and `opp40` still work. Only one half of the field needs a keystroke, and it's the one you say out loud anyway. |
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

Tab order is the order you fill the form in: formation → motion → play call → snap spot →
play type → player numbers → TD → log. **Enter logs the play from any field.**

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
- **A flag not walked off from the snap** — holding downfield on a run, enforced from the
  spot of the foul — takes a **Ball ended at** yard line, and the chart follows the ball
  instead of the arithmetic. Without it the line to gain would stay wrong for the rest of
  the series.
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

## Ending the game

**End game** does what it says: it closes the drive, marks the game final, and puts the
wrap-up in front of you — final score, plays, yards, first downs, drives, touchdowns, the
full box score by jersey number, and **Export** at the top, because that is the moment the
data is worth the most and easiest to lose. If a play is still open it asks you to resolve
it first, then shows the summary.

The status strip reads **Final** afterwards. Nothing is locked: **Game summary** in the
Games tab brings it back any time, and **Reopen this game** undoes the mark if you hit it
by mistake or need to add a play you missed.

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

## Look and feel

Black, Vegas gold and white. The neutrals are pulled a few degrees warm so they sit with
the gold instead of fighting it, and gold never carries small text on white, where it
would not hold contrast — it marks first downs, selected states, the primary action and
the focus ring, all with near-black text on it.

Display type is **Teko**, embedded as a 15KB data URI: no network, no fallback flash,
parsed once. It carries the scoreboard numbers, headings, tabs and yard lines. Form fields
and play text stay on the system sans, which is faster to scan while typing. (A serif was
considered and set aside — at small UI sizes it costs reading speed, and this is a tool you
read at a glance between snaps.)

Single theme on purpose: this is charted from a lit press box, not a dark sideline.

## Browser support

Plain ES5, no modules, no build. `<dialog>` is the one modern thing it leans on, and where
it is missing — Safari before 15.4, Firefox before 98 — a built-in fallback stands in, so
every panel still opens and closes and nothing dumps inline. Verified with dialog support
removed entirely.

## Inside the file

`index.html` is one `<style>` block and one `<script>` block. The script is still organised
in the sections it grew up as, each marked with a banner comment, in load order:

```
dom.js        small DOM helpers, incl. the keyed dropdown and segmented controls
model.js      record shapes and factories
engine.js     all the football logic. Pure: no DOM, no storage. The source of truth.
store.js      localStorage, with an in-memory fallback and no silent data loss
io.js         JSON/CSV export, import, Save As
app.js        state and actions — the application, shared by both input surfaces
playform.js   the one play form, used by both live entry and the edit dialog
ui.js         rendering, keyboard flow, dialogs, tabs
tests.js      the 35-test suite, runnable from the Help dialog
```

The `engine` section holds every rule. The two input surfaces are only input surfaces:
they read `App.computed` and call `App` actions, and hold no state of their own. To find
a section, search the file for its banner (`* engine.js`).

## Data model

One play record carries: game and drive ID, down, distance, snap spot, formation, motion,
play call, play type, player numbers, resolved yards (or null while pending), TD flag,
penalty details including the beyond-the-LOS flag, turnover details, overrides, and a
timestamp. A `backfield` string is still on the record — the form dropped it as an extra
step per snap, but anything already charted in it survives an export and import, and still
shows on the play row. Down, distance and yards are written back onto the record
after each recalculation so exports carry them, but the play log remains the only source
of truth.

Formation, motion and play call are **plain strings** on the record. The Phase 2
autocomplete library and spreadsheet import can be layered on top without migrating a
single stored game.

## Scoreboard

The offence scores itself off the chart: 6 for a touchdown, the conversion, and 3 for a
made field goal (**FG good**, a drive action). Everything else is entered by hand — click
the scoreboard in the top bar for defensive and return touchdowns, safeties, and the whole
opponent side. Manual entries are listed there and can be removed.

## Report and goals

**Report** grades every game against the offensive goal sheet, each row marked hit or miss,
and nothing graded where nothing has happened yet:

| Goal | Default |
|---|---|
| First downs | 10+ |
| Rushing yards | 125+ |
| Passing yards | 150+ |
| Runs of 15+ yards | 2+ |
| Passes of 25+ yards | 2+ |
| Turnovers | 0 |
| TFL of 5+ yards | at most 1 |
| 3rd down conversion | 70%+ |
| Points | 21+ |
| Win | — |

Every number, and every threshold behind one (what counts as a long run, a long pass, a
tackle for loss), is editable in **Edit season goals** and travels with your data.

**Win** is graded from the scoreboard, so it needs the opponent's points kept there.
**TFL** counts any run, scramble or sack that lost 5 or more — a play a flag wiped credits
no yardage, so it never lands here.

Underneath the goals: 3rd and 4th down, explosive runs and passes, red zone trips and
touchdowns, scoring drives, three-and-outs, turnovers, TFL taken, rushing and passing
yards, yards per play. With more than one game charted, season totals sit below the game.

A red zone *trip* means a snap inside their 20 — the situation the number is actually
asking about. A 40-yard touchdown run passes through the red zone without testing it.

## Formation, motion and play call

**The library ships loaded** with the team's own vocabulary, read off their charts: 22
formations, 5 motions and 55 play calls, ready from the first snap.

Beyond that, suggestions are drawn from **everything you have already charted**, most-used
first. Arrow keys move through the list, `Enter` takes the highlighted one — and `Enter`
with nothing highlighted still logs the play, so the list can never cost you a snap.

**Term library** in the Games tab adds your own: type them, or paste a column straight out
of a spreadsheet — one per line or comma separated. Bare numbers are skipped. Terms already
used on a play are always suggested whether or not they are saved.

## Not built, by design

No defensive or opponent-offense charting, no play diagrams, no cloud sync or accounts.
