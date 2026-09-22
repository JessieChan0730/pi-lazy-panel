# Default key bindings

Source of truth: `src/config/keymap.ts`. Override any binding in
`~/.pi/agent/lazy-panel.json` under `keymap.<scope>.<action-id>` (scopes:
`global`, `sessions`, `tree`, `content`). Action ids are the `ActionId` union in
`src/types.ts`.

## Customising keys

```json
{
  "keymap": {
    "global":   { "help": "F1", "scope-all": ["A", "ctrl+space"], "focus-sessions": "F5" },
    "sessions": { "session-delete": "ctrl+d", "session-share": null }
  }
}
```

- A value is one chord or an array of chords. It **replaces** the default for
  that action (it does not add to it). `null` unbinds the action.
- Chord syntax (`src/config/keys.ts`):
  - single key: `j`, `?`, `/`, `1`, `tab`, `enter`, `escape`, `space`, `up`, `pageDown`, `f1`
  - modifiers: `ctrl+d`, `shift+tab`, `alt+x`, `ctrl+shift+p` (any order)
  - an uppercase letter is shorthand for shift: `G` = `shift+g`
  - multi-key sequence: `gg`, `yy` (verbatim), or space separated `ctrl+w h`
- Pane bindings shadow global ones for the same key (e.g. `n` is *new session*
  in the sessions pane but *next match* elsewhere). `h` / `l` are not shadowed
  by any default pane binding, so pane switching works the same everywhere.
- Invalid chords or unknown scopes are skipped and reported in the footer when
  the panel opens.
- Multi-key sequences wait up to 1 s for the next key; `Esc` discards a
  half-typed sequence.
- The pane header shows the jump key bound to `focus-<pane>` (`[1] SESSIONS`),
  so rebinding it updates the title too.

## Global

| Key         | Action                                     |
| ----------- | ------------------------------------------ |
| ~~`l` / `Tab`~~ | ~~Focus next pane~~                        |
| ~~`h`~~         | ~~Focus previous pane~~                    |
| ~~`1` `2` `3`~~ | ~~Focus SESSIONS / TREE / CONTENT directly~~ |
| ~~`C`~~         | ~~List scope: Current folder~~             |
| ~~`A`~~         | ~~List scope: All~~                        |
| ~~`?`~~         | ~~Help overlay for the focused pane (`?`/`Esc`/`q` close, `j`/`k` scroll)~~ |
| ~~`q` / `Ctrl+c`~~ | ~~Quit the panel~~                      |
| ~~`Esc`~~       | ~~Discard pending keys → clear search → quit~~ |
| `/`         | Search bar for the focused pane (`Enter` run, `Esc` cancel) |
| `n` / `N`   | Next / previous search match               |

`C` and `A` are one-way: pressing `A` while already on *All* does nothing.

## Sessions pane

| Key           | Action                                          |
| ------------- | ----------------------------------------------- |
| ~~`j` `k` `↑` `↓`~~ | ~~Move cursor~~                           |
| ~~`gg` / `G`~~ | ~~Top / bottom~~                               |
| ~~`J` / `K`~~ | ~~Scroll the content pane~~                     |
| ~~`Enter`~~   | ~~Resume session: pi switches to it and the panel closes; a failure (file missing, switch cancelled) stays in the footer~~ |
| `d`           | Delete (confirm y/n; works on multi-select)     |
| `r`           | Rename                                          |
| `o`           | Fork and open the fork (confirm y/n)            |
| `Space`       | Toggle multi-select                             |
| `e`           | Export (prompts for output directory)           |
| `I`           | Import (prompts for JSONL path)                 |
| `S`           | Share as private GitHub Gist                    |
| `y`           | Clone active branch to a new session            |
| `Y`           | Copy last assistant reply                       |
| `s`           | Cycle sort: Threaded / Recent / Fuzzy           |
| `n`           | New session (prompts for name)                  |
| `i`           | Session info dialog (`y` inside copies it)      |

## Tree pane

| Key             | Action                                              |
| --------------- | --------------------------------------------------- |
| ~~`j` `k` `↑` `↓`~~ | ~~Move cursor~~                                 |
| ~~`gg` / `G`~~  | ~~Top / bottom~~                                    |
| ~~`Enter`~~     | ~~Restore to node, like `/tree`: a centered menu asks *No summary / Summarize / Summarize with custom prompt* (`j`/`k`/`↑`/`↓` move, `Enter` pick, `Esc` back to the tree); the custom prompt is a one-line input (`Enter` summarize, `Esc` back to the menu). Switches to that session first when needed. No menu when the node already is the leaf (Enter just closes the panel) or pi's `branchSummary.skipPrompt` is on~~ |
| ~~`y`~~         | ~~Copy node text (full text, like `Ctrl+x` in `/tree`)~~ |
| ~~`T`~~         | ~~Add / edit label in a centered dialog, like lazygit's commit popup (`Enter` save, `Esc` cancel, empty removes; same as `Shift+T` in `/tree`)~~ |
| `d` `t` `u` `L` `a` | Filter: default / tools / user-only / labeled / all |

## Content pane (read-only)

Only scrolling; copying a message is done from the tree pane (`y`).

| Key             | Action                |
| --------------- | --------------------- |
| ~~`j` `k` `↑` `↓`~~ | ~~Scroll~~        |
| ~~`gg` / `G`~~  | ~~Top / bottom~~      |
