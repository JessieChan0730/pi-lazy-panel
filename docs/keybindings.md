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
| ~~`@`~~         | ~~pi's changelog (`/changelog`) in a big box: `j` `k` `↑` `↓` scroll, `Ctrl+d` / `Ctrl+u` half a page, `g` / `G` top / bottom, `Esc` / `q` / `@` close. Rendering the whole file is slow, so the box first shows a rotating-square `◰ Loading changelog…` line centered in the middle, then the content (cached, so a second `@` is instant). Newest version first (pi's own `/changelog` puts it last). Not available inside the tree dialog~~ |
| ~~`Esc`~~       | ~~Discard pending keys → clear the focused pane's search → clear the SESSIONS multi-selection → quit~~ |
| ~~`/`~~         | ~~Search the focused pane (see below): the bar at the bottom searches as you type, `Enter` keeps the query, `Esc` cancels~~ |
| ~~`n` / `N`~~   | ~~Next / previous match of the focused pane's search, wrapping around. While a search is active they win over a pane binding of the same key (`n` is *new session* in SESSIONS only without a search)~~ |

`C` and `A` are one-way: pressing `A` while already on *All* does nothing.

The `?` overlay lists every binding, ordered by how often it is used (most
common first, e.g. `Enter` before the vim navigation). The footer at the
bottom only hints the handful of key shortcuts per pane; the long tail (sort /
info / compact / fork / clone / export / import / share / changelog) lives in
`?` only.

## Search (`/`)

lazygit-style, per pane: the rows are never filtered, the cursor jumps between
the matches. `/` opens `搜索:` at the bottom for the focused pane; every
keystroke jumps to the first match at or after where the cursor was (wrapping
to the first one), and puts the cursor back when nothing matches. `Enter`
keeps the query and hands the keys back to the pane, `Esc` in the bar drops
it and restores the cursor (and, in TREE, the folds). Afterwards the pane
header shows `2/7 matches` (`7 matches` while the cursor is off them, `no
matches` for none), the footer shows the query with `n next  N prev  Esc
clear`, and `n` / `N` step through the matches wrapping at both ends. `Esc`
in the pane ends its search. Each pane keeps its own query, so switching panes
does not lose it; only the focused pane's search is stepped through, though
the other panes keep their hits painted. Matching text is highlighted; the
current match (the one the cursor is on) is inverted so it stands apart from
the other hits.

Words are matched case-insensitively and all must appear, and a bare word only
looks at what names a row (session name / preview, tree label / text, content
text); the model, path, role and dates need their `key:value` qualifier (the
last one of a kind wins, unknown keys and unparsable dates are searched as
words, a qualifier a pane has no field for is ignored):

| Pane     | Words are looked for in                                   | Qualifiers                                                                  |
| -------- | --------------------------------------------------------- | --------------------------------------------------------------------------- |
| SESSIONS | name and first-message preview (the row's title); the model and the working directory never match a bare word | `name:` (name only), `model:` (model only), `path:` (working directory, full path or the `~/…` form), `after:` / `before:` (last update, `YYYY-MM-DD`); `tag:` is ignored |
| TREE     | label and text; folded rows count too. The role never matches a bare word (unlike `/tree`) | `tag:` (labels only), `role:` (`user` / `assistant` / `system` / `tool`), `after:` / `before:` (entry time); `name:` `model:` `path:` are ignored |
| CONTENT  | the rendered text lines of the messages (box headers are skipped); the hit is scrolled to the top of the pane | none (qualifiers are dropped, only the words are searched) |

Jumping to a TREE match inside a folded branch unfolds it, and the content
pane follows the cursor as usual. The tree dialog (`a`) has its own search
row that *filters* the tree instead; the two do not interact.

## Sessions pane

The panel opens with the cursor on the session pi currently has open (so
TREE / CONTENT show the current conversation); a brand-new session that is
not listed yet leaves the cursor on the first row. `C` / `A` still start at
the top after switching scope. `/` searches the name and the first-message
preview, `model:` / `path:` reach the model and the working directory
(see *Search* above); while that search is active `n` / `N` step through the
matches instead of `n` starting a new session.

| Key           | Action                                          |
| ------------- | ----------------------------------------------- |
| ~~`j` `k` `↑` `↓`~~ | ~~Move cursor~~                           |
| ~~`gg` / `G`~~ | ~~Top / bottom~~                               |
| ~~`J` / `K`~~ | ~~Scroll the content pane~~                     |
| ~~`Enter`~~   | ~~Resume session: pi switches to it and the panel closes; a failure (file missing, switch cancelled) stays in the footer~~ |
| ~~`d`~~       | ~~Delete: a centered *Delete session?* box asks Yes / No (cursor on No, `y` / `n` pick directly, `Enter` confirms the highlighted entry, `Esc` cancels). Like pi's `/resume` the file goes to the system trash via the `trash` CLI when available, else it is unlinked (the footer says which); the session pi currently has open is refused without asking. The list reloads, the cursor is clamped and TREE / CONTENT follow~~ |
| ~~`r`~~       | ~~Rename in a centered box pre-filled with the current name (`Enter` save, `Esc` cancel, empty removes the name; same as `/name` / ctrl+r in `/resume`). The list reloads with the cursor still on the session~~ |
| ~~`n`~~       | ~~New session (`/new`): a centered *New session* box asks for a name (`Enter` create, `Esc` cancel, **empty starts it unnamed** — the `[name]` argument of `/name` is simply left unset). pi switches to the new session and the panel closes~~ |
| ~~`o`~~       | ~~Fork (`/fork`): a centered selector lists the session's user messages (cursor on the last one, like pi's own `/fork`; `j` / `k` move, long lists scroll), `Enter` picks one and a *Fork session?* Yes / No box confirms (`Esc` / No goes back to the selector). The fork starts **before** that message and pi restores its text into the editor. Sessions other than the open one are switched to first; a session with no user message reports *No messages to fork from*~~ |
| ~~`y`~~       | ~~Clone (`/clone`): a *Clone session?* Yes / No box confirms (cursor on No), then the active branch is copied to a new session file and pi opens it~~ |
| ~~`Y`~~       | ~~Copy the last assistant reply to the clipboard (`/copy`): only its text parts, skipping thinking and tool calls; the panel stays open and the footer reports it (*copied last reply*, or *no assistant reply to copy*)~~ |
| ~~`Space`~~   | ~~Toggle multi-select: no marker glyph — the selected row's title is tinted (accent) so it stands out in a long list — and the header starts with `3 selected`. With a selection `d` deletes all of them after one *Delete N sessions?* confirmation (the session pi has open is skipped; the ones that fail stay listed and selected, the first error goes to the footer), while `r` `o` `y` `e` `S` refuse (*cannot act on multiple sessions*). `Esc` clears the selection before it quits~~ |
| ~~`e`~~       | ~~Export (`/export`): a centered *Export as* menu picks **HTML** (the whole tree, rendered by pi's own `pi --export`) or **JSONL** (the active branch, re-importable), then an *Export to* box is pre-filled with pi's default path (`pi-session-<file>.html` / `session-<time>.jsonl` in pi's working directory). Relative paths and `~` work on every platform; a folder (existing, or typed with a trailing `/`) gets the default file name inside. `Esc` in the box goes back to the menu; an existing file asks *Overwrite file?* first. Works for any session, not only the open one; the panel stays open and the footer says where the file went~~ |
| ~~`I`~~       | ~~Import (`/import`): a centered box asks for a session `.jsonl` (relative to pi's working directory, `~` allowed), an *Import and switch to it?* Yes / No box confirms, then the file is copied into the current session folder (a `-1` suffix on a name clash) and pi switches to it; the panel closes. A missing / empty / non-pi file is reported in the footer and nothing is copied~~ |
| ~~`S`~~       | ~~Share (`/share`): an *Upload as secret gist?* Yes / No box confirms (cursor on No), then the session is rendered to HTML and uploaded with `gh gist create --public=false`; the pi.dev viewer link is copied to the clipboard and shown in the footer. Needs the GitHub CLI logged in (pi's wording otherwise); pi's Radius upload is not available to extensions~~ |
| ~~`s`~~       | ~~Cycle sort: recent (last update) → created → title (by the title shown — name, else first-message preview — A–Z, empty sessions last) → threaded (forks indented under their parent) → …; the header shows the current one, the cursor follows its session~~ |
| ~~`i`~~       | ~~Session info in a centered box (what `/session` shows: name, model, messages, tokens, cost, created / updated, path, id); `y` copies the whole text, `Esc` / `q` close~~ |
| ~~`c`~~       | ~~Compact (`/compact`): a centered *Compact* box asks for optional focus instructions (`Enter` compact, `Esc` cancel, empty uses pi's default). The cursor session's active branch is compacted, then pi opens it — sessions other than the one already open are switched to first (that is the *enter the conversation* part). pi's own footer shows a rotating spinner while the model summarizes; the panel closes on success, and a failure (no model, session too small, already compacted) stays in the footer. `c` refuses while several sessions are selected~~ |

## Tree pane

The pane shows the tree as a folded outline: `▸` a folded side branch, `▾` an
open one, `─` an alternative that was never continued; rows inside a branch
are indented two columns per level (four levels at most, `… ` beyond). Side
branches start folded, the active branch open. The filters live in the tree
dialog (`a`), which draws the same rows with pi-style guide lines and has its
own live search row that narrows the list. `/` in the pane is the jumping
search of *Search* above (label / text, `tag:` for labels, `role:` for the role; a match
inside a folded branch is unfolded). A filter chosen in
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
`Tab` `1`..`3`), the list scope (`C` `A`), `n` `N`, `?`, `@` and quitting the panel
(`Ctrl+c`) do nothing here.

| Key             | Action                                              |
| --------------- | --------------------------------------------------- |
| ~~`j` `k` `↑` `↓`~~ | ~~Move the dialog's cursor~~                    |
| ~~`gg` / `G`~~  | ~~Top / bottom~~                                    |
| ~~`/`~~         | ~~Focus the search row; typing filters the rows live, like `/tree`: every word must appear in the row's label / text (case-insensitive), `tag:x` narrows to labels, `role:user` to the role, `after:2026-09-01` / `before:2026-09-20` to dates. `Esc` hands the keys back to the list and keeps the query (the rows stay narrowed); `/` again edits it, deleting the text clears it. `Enter` means nothing in the search row. While a query is active every match is shown (folds are cleared, like `/tree`); the folds come back once the query is empty or the dialog closes~~ |
| ~~`Enter`~~     | ~~Restore to the row, exactly like the pane (summary menu included)~~ |
| ~~`y`~~         | ~~Copy the row's text~~                             |
| ~~`T`~~         | ~~Add / edit the row's label (the Label dialog opens over the tree dialog)~~ |
| ~~`z`~~         | ~~Fold / unfold the branch under the cursor (same rule and same fold state as the pane)~~ |
| ~~`d` `t` `u` `l` `a`~~ | ~~Filter: default (hide bookkeeping) / no tool results / user only / labeled only / all; `t` `u` `l` `a` toggle back to default when pressed again (pi's `Ctrl+d/t/u/l/a`). The tree is reloaded, folds are cleared, and the pane shows the same filter afterwards~~ |
| ~~`Esc` / `q`~~ | ~~Close (on the list): the pane's cursor lands on the dialog's row (unfolding what hides it) and the content pane follows. In the search row `Esc` only leaves the row and `q` is just a letter~~ |

## Content pane (read-only)

Only scrolling and searching; copying a message is done from the tree pane (`y`).

| Key             | Action                |
| --------------- | --------------------- |
| ~~`j` `k` `↑` `↓`~~ | ~~Scroll~~        |
| ~~`gg` / `G`~~  | ~~Top / bottom~~      |
| ~~`/`~~         | ~~Search the rendered message text (words only, no qualifiers); the matching line is scrolled to the top, `n` / `N` step through the hits~~ |

## 鼠标

核心仍是键盘，鼠标只做轻量适配。regular（默认）和 fullscreen 两种 TUI 模式都支持：fullscreen
由 pi 把事件派给面板，regular 模式插件自己打开 SGR 鼠标上报（需要终端支持 SGR，现代终端基本都行；
面板打开期间终端自己的选中 / 滚动被接管，关闭后恢复）。见 `docs/issues.md`。

| 操作                | 行为                                                       |
| ------------------- | ---------------------------------------------------------- |
| 滚轮 / 三指上下      | 滚动指针所在的面板（列表移动光标、CONTENT 按行滚动），不改变焦点 |
| 单击                | 焦点切到指针所在面板；点在列表项上时同时把光标移到该项           |
| 双击 SESSIONS       | 进入该会话（等价于 `Enter` / resume）                      |
| 双击 TREE           | 折叠 / 展开光标所在分支（等价于 `z`）                       |
