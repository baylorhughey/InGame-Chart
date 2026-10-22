# Tests

Four suites. They run against `index.html` itself — the same single file that
goes on the USB drive — so nothing here can pass against a build that isn't
the one being shipped.

```
node test/run.js
```

Needs Playwright and a Chromium. If Chromium isn't where Playwright normally
puts it, set `CHROME` to the binary.

## What each one is for

**`selftest.js`** runs the engine's own tests, the ones that live inside
`index.html` and ship with the app. Open the app and append `#selftest` to do
the same thing by hand.

**`fuzz.js`** is the one that matters most. Every bug found in a live game so
far got past a test whose expected answer had been read off the same code it
was testing — a test can only encode the bug when it's written that way.
So `reference.js` simulates a game from the rules of football and the stat
conventions in the main README, keeps its own truth as it invents the game,
and emits only the play list a coach would have typed. The engine then has to
rediscover that truth from the play list alone. Any disagreement is a bug in
one of the two, and only one of them was written from the rules.

**`mutate.js`** checks what a change does *not* touch. The README promises
that editing a play recalculates downstream and never crosses a drive
boundary. That isn't checkable by knowing the right answer for any game, so
instead: chart one, snapshot it, change a play, and require every other drive
to be identical to the byte. Same for deleting, and for adding a play and
taking it back.

**`totals.js`** reconciles the team line — plays, total offence, yards per
play — against the box score it has to agree with. That line goes to the
paper on Friday night, and it was wrong in 187 of 200 generated games before
this suite existed, by as much as 50 yards and three yards a carry.

## Adding to the fuzzer

`reference.js` is a second implementation, and it is only worth having while
it stays independent. When the engine changes, work out what football says
should happen and write that — never copy the engine's answer across to make
a disagreement go away. A disagreement is the whole point of the file.
