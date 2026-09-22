# Default key bindings

Source of truth: `src/config/keymap.ts`. Override any binding in
`~/.pi/agent/lazy-panel.json` under `keymap.<scope>.<action-id>` (scopes:
`global`, `sessions`, `tree`, `content`, `tree-dialog`). Action ids are the
`ActionId` union in `src/types.ts`.

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
- The tree dialog resolves `tree-dialog` first, then `tree`, then `global`: its
  own keys (`d` `t` `u` `l` `a` `q`) shadow the pane's and the global ones
  (`a` filters instead of opening, `l` is the labeled filter instead of *next
  pane*, `q` closes the dialog instead of quitting), everything else is the
  tree pane's binding.
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
| `/`         | Search bar for the focused pane (`Enter` run, `Esc` cancel); matching is still TODO |
| `n` / `N`   | Next / previous search match |

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

The pane shows the tree as a folded outline: `▸` a folded side branch, `▾` an
open one, `─` an alternative that was never continued; rows inside a branch
are indented two columns per level (four levels at most, `… ` beyond). Side
branches start folded, the active branch open. The filters live in the tree
dialog (`a`), which draws the same rows with pi-style guide lines and has its
own live search row. `/` in the pane opens the usual search bar (matching is
still TODO). A filter chosen in
the dialog stays on: the pane lists the same filtered tree and its header says
so (`2/12 · user-only`); the panel opens with pi's own `treeFilterMode`
setting (the filter `/tree` starts with).

| Key             | Action                                              |
| --------------- | --------------------------------------------------- |
| ~~`j` `k` `↑` `↓`~~ | ~~Move cursor~~                                 |
| ~~`gg` / `G`~~  | ~~Top / bottom~~                                    |
| ~~`Enter`~~     | ~~Restore to node, like `/tree`: a centered menu asks *No summary / Summarize / Summarize with custom prompt* (`j`/`k`/`↑`/`↓` move, `Enter` pick, `Esc` back to the tree); the custom prompt is a one-line input (`Enter` summarize, `Esc` back to the menu). Switches to that session first when needed. No menu when the node already is the leaf (Enter just closes the panel) or pi's `branchSummary.skipPrompt` is on~~ |
| ~~`z`~~         | ~~Fold / unfold the branch under the cursor: on a `▸` / `▾` row it toggles, anywhere inside a branch it folds that branch and jumps to its head (vim's `zc`); the trunk of a linear conversation has nothing to fold~~ |
| ~~`y`~~         | ~~Copy node text (full text, like `Ctrl+x` in `/tree`)~~ |
| ~~`T`~~         | ~~Add / edit label in a centered dialog, like lazygit's commit popup (`Enter` save, `Esc` cancel, empty removes; same as `Shift+T` in `/tree`)~~ |
| ~~`a`~~         | ~~Open the tree dialog: the whole tree in a big box (search row on top, key hints at the bottom), same fold state as the pane; see below for its keys~~ |

## Tree dialog (`a` from the tree pane)

The whole tree in a big box: a search row on top, the rows in the middle
(pi-style guide lines, a folded row shows `⊞` on its connector), key hints at
the bottom (the footer repeats them, so there is no `?` help inside). The
dialog has its own cursor; the pane's cursor moves to it when the dialog
closes. Keys are resolved with the `tree-dialog` scope first, then the tree
pane's bindings, then the global ones, so `j` `k`, `gg` `G`, `Enter`, `y`,
`T`, `z` and `/` are the pane's keys (and follow a rebinding of those) while
the dialog's own keys live under `keymap."tree-dialog"`. Pane switching (`h`
`Tab` `1`..`3`), the list scope (`C` `A`), `n` `N`, `?` and quitting the panel
(`Ctrl+c`) do nothing here.

| Key             | Action                                              |
| --------------- | --------------------------------------------------- |
| ~~`j` `k` `↑` `↓`~~ | ~~Move the dialog's cursor~~                    |
| ~~`gg` / `G`~~  | ~~Top / bottom~~                                    |
| ~~`/`~~         | ~~Focus the search row; typing filters the rows live, like `/tree`: every word must appear in the row's label / role / text (case-insensitive), `tag:x` narrows to labels, `after:2026-09-01` / `before:2026-09-20` to dates. `Esc` hands the keys back to the list and keeps the query (the rows stay narrowed); `/` again edits it, deleting the text clears it. `Enter` means nothing in the search row. While a query is active every match is shown (folds are cleared, like `/tree`); the folds come back once the query is empty or the dialog closes~~ |
| ~~`Enter`~~     | ~~Restore to the row, exactly like the pane (summary menu included)~~ |
| ~~`y`~~         | ~~Copy the row's text~~                             |
| ~~`T`~~         | ~~Add / edit the row's label (the Label dialog opens over the tree dialog)~~ |
| ~~`z`~~         | ~~Fold / unfold the branch under the cursor (same rule and same fold state as the pane)~~ |
| ~~`d` `t` `u` `l` `a`~~ | ~~Filter: default (hide bookkeeping) / no tool results / user only / labeled only / all; `t` `u` `l` `a` toggle back to default when pressed again (pi's `Ctrl+d/t/u/l/a`). The tree is reloaded, folds are cleared, and the pane shows the same filter afterwards~~ |
| ~~`Esc` / `q`~~ | ~~Close (on the list): the pane's cursor lands on the dialog's row (unfolding what hides it) and the content pane follows. In the search row `Esc` only leaves the row and `q` is just a letter~~ |

## Content pane (read-only)

Only scrolling; copying a message is done from the tree pane (`y`).

| Key             | Action                |
| --------------- | --------------------- |
| ~~`j` `k` `↑` `↓`~~ | ~~Scroll~~        |
| ~~`gg` / `G`~~  | ~~Top / bottom~~      |
