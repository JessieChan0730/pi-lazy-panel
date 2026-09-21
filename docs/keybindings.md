# Default key bindings

Source of truth: `src/config/keymap.ts`. Override any binding in
`~/.pi/agent/lazy-panel.json` under `keymap.<scope>.<action-id>` (scopes:
`global`, `sessions`, `tree`, `content`). Action ids are the `ActionId` union in
`src/types.ts`.

## Customising keys

```json
{
  "keymap": {
    "global":   { "help": "F1", "toggle-scope": ["C", "A", "ctrl+space"] },
    "sessions": { "session-delete": "ctrl+d", "session-share": null }
  }
}
```

- A value is one chord or an array of chords. It **replaces** the default for
  that action (it does not add to it). `null` unbinds the action.
- Chord syntax (`src/config/keys.ts`):
  - single key: `j`, `?`, `/`, `tab`, `enter`, `escape`, `space`, `up`, `pageDown`, `f1`
  - modifiers: `ctrl+d`, `shift+tab`, `alt+x`, `ctrl+shift+p` (any order)
  - an uppercase letter is shorthand for shift: `G` = `shift+g`
  - multi-key sequence: `gg`, `yy` (verbatim), or space separated `ctrl+w h`
- Pane bindings shadow global ones for the same key (e.g. `n` is *new session*
  in the sessions pane but *next match* elsewhere).
- Invalid chords or unknown scopes are skipped and reported in the footer when
  the panel opens.
- Multi-key sequences wait up to 1 s for the next key; `Esc` discards a
  half-typed sequence.

## Global

| Key         | Action                                     |
| ----------- | ------------------------------------------ |
| `Tab`       | Focus next pane                            |
| `Shift+Tab` | Focus previous pane                        |
| `C` / `A`   | Toggle list scope: Current folder ↔ All    |
| `?`         | Help overlay for the focused pane (`?`/`Esc`/`q` close, `j`/`k` scroll) |
| `q` / `Ctrl+c` | Quit the panel                          |
| `Esc`       | Discard pending keys → clear search → quit |
| `/`         | Search bar for the focused pane (`Enter` run, `Esc` cancel) |
| `n` / `N`   | Next / previous search match               |

## Sessions pane

| Key           | Action                                          |
| ------------- | ----------------------------------------------- |
| `j` `k` `↑` `↓` | Move cursor                                   |
| `gg` / `G`    | Top / bottom                                    |
| `J` / `K`     | Scroll the content pane                         |
| `Enter`       | Resume session                                  |
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
| `j` `k` `↑` `↓` | Move cursor                                         |
| `gg` / `G`      | Top / bottom                                        |
| `Enter`         | Restore to node: No summary / Summarize / Custom    |
| `y`             | Copy node text                                      |
| `l`             | Add / edit label                                    |
| `d` `t` `u` `L` `a` | Filter: default / tools / user-only / labeled / all |

## Content pane (read-only, vim-like)

| Key             | Action                |
| --------------- | --------------------- |
| `h` `j` `k` `l` | Move cursor           |
| `b` / `e`       | Word backward/forward |
| `gg` / `G`      | Top / bottom          |
| `zz`            | Center cursor line    |
| `v`             | Preview mode          |
| `y` / `yy`      | Yank selection / line |
