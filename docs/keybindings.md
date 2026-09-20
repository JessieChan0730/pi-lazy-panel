# Default key bindings

Source of truth: `src/config/keymap.ts`. Override any binding in
`~/.pi/agent/lazy-panel.json` under `keymap.<scope>.<action-id>`.

## Global

| Key         | Action                                     |
| ----------- | ------------------------------------------ |
| `Tab`       | Focus next pane                            |
| `Shift+Tab` | Focus previous pane                        |
| `C` / `A`   | Toggle list scope: Current folder ↔ All    |
| `?`         | Help for the focused pane                  |
| `q`         | Quit the panel                             |
| `/`         | Search in the focused pane (Enter to run)  |
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
