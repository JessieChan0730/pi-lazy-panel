**English** | [中文](./keybindings.zh.md)

# Keybindings & configuration

The single source of truth for the default keys is `src/config/keymap.ts`. You can override any binding under `keymap.<scope>.<action-id>` in `~/.pi/agent/lazy-panel.json` (scopes: `global`, `sessions`, `tree`, `content`, `tree-dialog`). An action id is exactly a member of the `ActionId` union in `src/types.ts`.

## Configuration

The config file lives at `~/.pi/agent/lazy-panel.json`. Every field is optional and falls back to a built-in default when omitted:

```json
{
  "locale": "zh",
  "defaultScope": "all",
  "defaultSort": "recent",
  "leftColumnRatio": 0.25,
  "keymap": {
    "global":   { "help": "F1", "scope-all": ["A", "ctrl+space"] },
    "sessions": { "session-delete": "ctrl+d", "session-share": null }
  }
}
```

| Field | Description | Values / range | Default |
| --- | --- | --- | --- |
| `locale` | UI language | `"en"` / `"zh"` | follows system language |
| `defaultScope` | session scope on open | `"current-folder"` / `"all"` | `"current-folder"` |
| `defaultSort` | session list ordering | `"recent"` / `"created"` / `"title"` / `"threaded"` | `"recent"` |
| `leftColumnRatio` | left column width ratio | `0.15` ~ `0.6` | `0.25` |
| `keymap` | custom keybindings (see below) | grouped by scope | built-in keys |

- Invalid `locale` / `defaultScope` / `defaultSort` fall back to the default, an out-of-range `leftColumnRatio` is ignored too, and the panel reports it in the footer when it opens.
- When `locale` is omitted it is auto-detected from the system language (see `src/i18n/index.ts`).

## Custom keybindings

```json
{
  "keymap": {
    "global":   { "help": "F1", "scope-all": ["A", "ctrl+space"], "focus-sessions": "F5" },
    "sessions": { "session-delete": "ctrl+d", "session-share": null }
  }
}
```

- A value is **one chord** or an **array of chords**. It **replaces** the action's default binding (it does not append), and `null` unbinds the action.
- **The config name is the action id** (the middle column in each table below); just place it under the matching scope — e.g. to change SESSIONS delete to `ctrl+d`: `{ "keymap": { "sessions": { "session-delete": "ctrl+d" } } }`. Each pane section's scope is in its heading: global → `global`, SESSIONS → `sessions`, TREE → `tree`, CONTENT → `content`, tree dialog → `tree-dialog` (the tables note the exceptions that belong to another scope).

- Chord syntax (`src/config/keys.ts`):
  - Single key: `j`, `?`, `/`, `1`, `tab`, `enter`, `escape`, `space`, `up`, `pageDown`, `f1`
  - Modifiers: `ctrl+d`, `shift+tab`, `alt+x`, `ctrl+shift+p` (any order)
  - An uppercase letter is shorthand for shift: `G` = `shift+g`
  - Multi-key sequences: `gg`, `yy` (written back-to-back), or space-separated `ctrl+w h`
- Pane bindings shadow the global binding of the same key (e.g. `n` is "new session" in the SESSIONS pane and "next match" elsewhere). `h` / `l` are not shadowed by any default pane binding, so switching panes works the same everywhere.
- The tree dialog resolves in the order `tree-dialog` → `tree` → `global`: its own keys (`d` `t` `u` `l` `a` `q`) shadow the pane and global bindings (`a` becomes filter instead of open-dialog, `l` becomes the "labeled-only" filter instead of "next pane", `q` becomes close-dialog instead of quit); everything else follows the tree pane's bindings.
- An invalid chord or unknown scope is skipped and shown in the footer when the panel opens.
- A multi-key sequence waits at most 1 second for the next key; `Esc` discards a half-typed sequence.
- The pane title shows the jump key bound to `focus-<pane>` (`[1] SESSIONS`), so rebinding it changes the title too.

## Global keybindings

| Key | Config name | Action |
| --- | --- | --- |
| `l` / `Tab` | `focus-next` | Focus the next pane |
| `h` | `focus-prev` | Focus the previous pane |
| `1` `2` `3` | `focus-sessions` / `focus-tree` / `focus-content` | Focus SESSIONS / TREE / CONTENT directly |
| `C` | `scope-current` | List scope: current folder |
| `A` | `scope-all` | List scope: all |
| `?` | `help` | Commands for the current pane: `j` / `k` / `↑` / `↓` select, `Enter` closes help and runs the selected command; `?` / `Esc` / `q` closes without running |
| `q` / `Ctrl+c` | `quit` | Quit the panel |
| `@` | `changelog` | pi's changelog (`/changelog`) as a large popup: `j` `k` `↑` `↓` scroll, `Ctrl+d` / `Ctrl+u` half-page, `g` / `G` top / bottom, `Esc` / `q` / `@` close. The whole file renders slowly, so the popup first shows a spinning square `◰ Loading changelog…` in the center, then the content (cached, so a second `@` opens instantly). The newest version is on top (pi's own `/changelog` puts it last). Not available inside the tree dialog |
| `Esc` | — (built-in, not configurable) | In order: discard an unfinished keystroke → clear the current pane's search → clear the SESSIONS multi-selection → quit |
| `/` | `search` | Search the current pane (see below): the bottom search bar searches as you type, `Enter` keeps the keyword, `Esc` cancels |
| `n` / `N` | `search-next` / `search-prev` | Next / previous match of the current pane's search, wrapping around. While a search is active they take priority over the pane binding of the same key (`n` is "new session" only in SESSIONS when there is no search) |

`C` and `A` are one-way: pressing `A` again when already in *All* does nothing.

The `?` help popup lists every command, sorted by frequency of use (the most common first, e.g. `Enter` before the vim movement keys). Each action has its own selectable entry; aliases for the same action stay together. Selection skips section headings and wrapped continuation lines, stops at either end, and scrolls into view automatically. Opening help starts at the first command. Enter runs the selected action in the current pane, including with custom or multi-key bindings; delete / fork / clone and other guarded operations still go through their normal confirmation flows. A configured single-key help binding also closes the popup. The footer only hints at a few keys per pane; the long tail (sort / info / compact / fork / clone / export / import / share / changelog) is only visible in `?`.

## Search (`/`)

lazygit-style, tracked per pane: list rows are never filtered, the cursor jumps between matches. `/` opens the current pane's `Search:` bar at the bottom; every keystroke jumps to "the first match at or after the cursor" (wrapping to the first when it hits the end), and puts the cursor back where it was when there is no match. `Enter` keeps the keyword and hands keystrokes back to the pane; `Esc` in the search bar discards the keyword and restores the cursor (also restoring the fold state in TREE). Afterwards the pane title shows `2/7 matches` (`7 matches` when the cursor is not on a match, `no matches` when there is none), the footer shows the keyword and `n next  N prev  Esc clear`, and `n` / `N` step through matches, wrapping at both ends. `Esc` in the pane ends that pane's search. Each pane keeps its own keyword, so switching panes does not lose it; only the currently focused pane's search is stepped by `n` / `N`, while the other panes' hits stay highlighted. Matched text is highlighted; the current match (the one under the cursor) is inverted to distinguish it from the other hits.

Keywords are case-insensitive and every word must appear. A bare word (with no qualifier) only matches "what names a row" (session name / preview, tree node label / body, content body); model, path, role and date all need a `key:value` qualifier (the last of a duplicate qualifier wins, an unknown key and an unparseable date are searched as bare words, and a qualifier for a field a pane does not have is ignored):

| Pane | Fields a bare word matches | Qualifiers |
| --- | --- | --- |
| SESSIONS | Session name and first-message preview (the row's title); model and working directory do not participate in bare-word matching | `name:` (name only), `model:` (model only), `path:` (working directory, full path or `~/…` form), `after:` / `before:` (last updated, `YYYY-MM-DD`); `tag:` is ignored |
| TREE | Label and body; folded rows count too. Role does not participate in bare-word matching (unlike `/tree`) | `tag:` (label only), `role:` (`user` / `assistant` / `system` / `tool`), `after:` / `before:` (node time); `name:` `model:` `path:` are ignored |
| CONTENT | The rendered message body lines (skipping the message-box header); a hit is scrolled to the top of the pane | none (qualifiers are dropped, only bare words are searched) |

Jumping to a TREE match inside a folded branch expands it, and CONTENT on the right follows the cursor as usual. The tree dialog (`a`) has its own search row, which **filters** rather than jumps; the two are independent.

## SESSIONS pane

When the panel opens, the cursor lands on the session pi currently has open (so TREE / CONTENT show the current conversation); a brand-new session that is not listed yet leaves the cursor on the first row. After toggling scope with `C` / `A` it still starts from the top. `/` searches the session name and the first-message preview, while `model:` / `path:` reach the model and working directory (see *Search* above); while that search is active `n` / `N` step through matches rather than `n` creating a new session.

| Key | Config name | Action |
| --- | --- | --- |
| `j` `k` `↑` `↓` | `move-down` / `move-up` | Move the cursor |
| `gg` / `G` | `go-top` / `go-bottom` | Top / bottom |
| `J` / `K` | `scroll-content-down` / `scroll-content-up` | Scroll the CONTENT pane on the right |
| `Enter` | `session-resume` | Resume the session: pi switches to it and the panel closes; on failure (missing file, switch cancelled) it stays with a footer message |
| `d` | `session-delete` | Delete: a centered *Delete session?* box asks Yes / No (cursor on No, `y` / `n` selects directly, `Enter` confirms the highlighted item, `Esc` cancels). Like pi's `/resume`, it moves to the system trash when the `trash` CLI exists, otherwise it unlinks directly (the footer says which); the session pi has open is refused without asking. The list reloads, the cursor is clamped back into range, and TREE / CONTENT follow |
| `r` | `session-rename` | Rename in a centered box prefilled with the current name (`Enter` saves, `Esc` cancels, an empty value clears the name; equivalent to `/name` or ctrl+r in `/resume`). The list reloads and the cursor stays on that session |
| `n` | `session-new` | New session (`/new`): a centered *New session* box asks for a name (`Enter` creates, `Esc` cancels, **leaving it empty starts an unnamed session** — the `[name]` argument of `/name` is not set). pi switches to the new session and the panel closes |
| `o` | `session-fork` | Fork (`/fork`): a centered picker lists the session's user messages (cursor on the last one, matching pi's own `/fork`; `j` / `k` move, long lists scroll), and after `Enter` a *Fork session?* Yes / No box confirms (`Esc` / No returns to the picker). The fork starts **before** that message, and pi refills its text into the editor. A non-current session is switched to first; when there is no user message it reports *No messages to fork from* |
| `y` | `session-clone` | Clone (`/clone`): a *Clone session?* Yes / No box confirms (cursor on No), then the active branch is copied to a new session file and pi opens it |
| `Y` | `session-copy-last-reply` | Copy the last assistant reply to the clipboard (`/copy`): only its text fragments, skipping thinking and tool calls; the panel stays open and the footer reports the result (*copied last reply* or *no assistant reply to copy*) |
| `Space` | `session-toggle-select` | Toggle multi-select: no marker glyph is drawn — a selected row's title is colored (accent) to stand out in a long list — and the title starts with `3 selected`. With a selection, `d` deletes them all after a single *Delete N sessions?* confirmation (skipping the session pi has open; failures stay listed and selected, the first error goes to the footer), while `r` `o` `y` `e` `S` refuse (*cannot act on multiple sessions*). `Esc` clears the selection first and only quits on the next press |
| `p` | `session-pin` | Pin / unpin the session under the cursor (or, with a multi-selection, all selected ones): pin when any target is still unpinned, otherwise unpin. Pinned sessions are grouped at the very top of the list under a dim `── PINNED ──` rule (the rest under `── OTHERS ──`) regardless of the sort — the most recent pin sits above the earlier ones; sorting and searching still reach them, but the `C` / `A` scope filter can hide a pin from another folder (its pin is kept). The pin list persists in `~/.pi/agent/lazy-panel-pins.json` and is pruned of sessions deleted elsewhere the next time the panel opens |
| `e` | `session-export` | Export (`/export`): a centered *Export as* menu picks **HTML** (the whole tree, rendered by pi's own `pi --export`) or **JSONL** (the active branch, re-importable), then an *Export to* box prefilled with pi's default path (`pi-session-<file>.html` / `session-<time>.jsonl` under pi's working directory). Relative paths and `~` work on all platforms; a directory (existing, or an input ending in `/`) uses the default filename inside it. `Esc` in the box returns to the menu; an existing file first asks *Overwrite file?*. Any session can be exported, not just the current one; the panel stays open and the footer says where the file went |
| `I` | `session-import` | Import (`/import`): a centered box asks for a session `.jsonl` (relative to pi's working directory, `~` allowed), an *Import and switch to it?* Yes / No box confirms, then the file is copied into the current session directory (a name clash gets a `-1` suffix), pi switches to it, and the panel closes. A missing / empty / non-pi file is reported in the footer and nothing is copied |
| `S` | `session-share` | Share (`/share`): an *Upload as secret gist?* Yes / No box confirms (cursor on No), then the session is rendered to HTML and uploaded with `gh gist create --public=false`; the pi.dev view link is copied to the clipboard and shown in the footer. Requires a logged-in GitHub CLI (otherwise it warns in pi's wording); pi's Radius upload is not available to extensions |
| `s` | `session-sort` | Cycle the sort: recent (last updated) → created (creation time) → title (by the displayed title — the name if present, otherwise the first-message preview — A–Z, empty sessions last) → threaded (forks indented under their parent) → …; the title shows the current sort and the cursor follows its session |
| `i` | `session-info` | The centered session-info box (what `/session` shows: name, model, message count, tokens, cost, created / updated, path, id); `y` copies all the text, `Esc` / `q` closes |
| `u` | `session-context-usage` | The centered context-usage box: how full the model's context window is (the number pi shows in its footer), broken down like pi-cc's `/context`. A `used / window · percent` line, a stacked color bar, then one row per category as a share of the whole window — **System prompt / Memory / Skills / Tools definition / Tool results / Context / Other / Free space** — plus a model / messages / cost summary. The current session shows the full breakdown (the prompt side comes from pi's live runtime); another session can only itemize Tool results and Context from the file, so the rest of the real request folds into *Other* (the window is looked up by model id; token-only when unknown). `j` / `k` / `↑` / `↓` selects a category; `Enter` opens its prompt in a scrollable Markdown dialog (statistics-only Other / Free space are skipped). In the prompt dialog, `j` / `k` / arrows scroll, `d` / `u` / PageDown / PageUp scroll by half a page, `g` / `G` jump to top/bottom, `y` copies the prompt, and `Esc` / `q` returns to the usage list with the selection preserved. Both dialogs show their shortcuts below a divider inside the box, wrapping in narrow windows and staying visible while scrolling. In the usage list, `y` copies the summary and `Esc` / `q` closes; refuses with a multi-selection |
| `c` | `session-compact` | Compact (`/compact`): a centered *Compact* box asks for an optional focus instruction (`Enter` compacts, `Esc` cancels, empty uses pi's default). After compacting the active branch of the session under the cursor, pi opens it — a non-current session is switched to first (that is "entering the conversation"). During compaction pi's own footer shows a spinner; on success the panel closes, on failure (no model, session too small, already compacted) it stays with a footer message. `c` refuses when multiple sessions are selected |

## TREE pane

The pane shows the tree as a collapsible outline: `▸` a folded side branch, `▾` an expanded side branch, `─` a side branch that was never continued; rows within a branch indent two columns per level (up to four levels, deeper ones replaced by `… `). Side branches are folded by default and the active branch is expanded. Filtering lives in the tree dialog (`a`), which draws the same rows with pi-style guide lines and has its own live search row to narrow the list. `/` in the pane is the jump-style search from *Search* above (label / body, `tag:` matches the label, `role:` matches the role; a match inside a folded branch is expanded). A filter chosen in the dialog is kept: the pane lists the same filtered tree and marks it in the title (`2/12 · user-only`); when the panel opens it adopts pi's own `treeFilterMode` setting (the filter `/tree` starts with).

| Key | Config name | Action |
| --- | --- | --- |
| `j` `k` `↑` `↓` | `move-down` / `move-up` | Move the cursor |
| `gg` / `G` | `go-top` / `go-bottom` | Top / bottom |
| `Enter` | `tree-restore` | Restore to the node, like `/tree`: a centered menu asks *No summary / Summarize / Summarize with custom prompt* (`j`/`k`/`↑`/`↓` move, `Enter` selects, `Esc` returns to the tree); the custom prompt is a single-line input (`Enter` summarizes, `Esc` returns to the menu). Switches to the session first if needed. No menu appears when the node is itself a leaf (`Enter` just closes the panel) or when pi's `branchSummary.skipPrompt` is on |
| `z` | `tree-fold` | Fold / unfold the branch under the cursor: toggles on a `▸` / `▾` row, and on any row inside a branch folds that branch and jumps to its head (vim's `zc`); the trunk of a linear conversation has no foldable section |
| `y` | `tree-copy` | Copy the node text (the full text, equivalent to `Ctrl+x` in `/tree`) |
| `T` | `tree-label` | Add / edit a label in a centered dialog, like lazygit's commit popup (`Enter` saves, `Esc` cancels, an empty value deletes it; equivalent to `Shift+T` in `/tree`) |
| `f` | `tree-filter-menu` | Open a five-row filter menu: `d` default / `t` no tool results / `u` user only / `l` labeled only / `a` all. The current filter is selected initially; `j` / `k` / arrows move, `Enter` selects, `Esc` cancels, and the five letter keys select directly. Selecting the current mode keeps it (no toggle) |
| `a` | `tree-open` | Open the tree dialog: a large popup (search row on top, key hints at the bottom) that shares filter and fold state with the pane; keys below |

The filter is synchronized in both directions: choosing `u` in the pane's `f` menu opens the large dialog in user-only mode; changing filters there also changes the pane when you return. `a` opens a larger view, not an unfiltered view. Filter changes clear folds, keep the selected node or its nearest visible ancestor, and update CONTENT. The two search queries remain independent.

## Tree dialog (press `a` in the TREE pane)

A large popup of the whole tree: a search row on top, rows in the middle (pi-style guide lines, a folded row shows `⊞` at the junction), key hints at the bottom (the footer repeats them, so there is no `?` help inside the dialog). The dialog has its own cursor; on close the pane cursor moves onto it. Keys resolve `tree-dialog` scope first, then the tree pane's, then global, so `j` `k`, `gg` `G`, `Enter`, `y`, `T`, `z` and `/` are the pane's keys (and follow their rebindings), while the dialog's own keys are under `keymap."tree-dialog"`. Switching panes (`h` `Tab` `1`..`3`), list scope (`C` `A`), `n` `N`, `?`, `@` and quitting the panel (`Ctrl+c`) all do nothing here.

In the table below the parenthesis after "Config name" marks which scope it belongs to (change these keys under that scope): the filter keys and the close key are in `tree-dialog`, while move / restore / copy / label / fold follow `tree` and search follows `global`.

| Key | Config name (scope) | Action |
| --- | --- | --- |
| `j` `k` `↑` `↓` | `move-down` / `move-up` (tree) | Move the dialog's cursor |
| `gg` / `G` | `go-top` / `go-bottom` (tree) | Top / bottom |
| `/` | `search` (global) | Focus the search row; typing filters rows live, like `/tree`: every word must appear in the row's label / body (case-insensitive), `tag:x` narrows to the label, `role:user` to the role, `after:2026-09-01` / `before:2026-09-20` to the date. `Esc` hands keystrokes back to the list and keeps the keyword (rows stay narrowed); press `/` again to edit it, and deleting all the text clears it. `Enter` in the search row has no meaning. While a keyword is active all matches are shown (folds are cleared, like `/tree`); once the keyword is cleared or the dialog is closed the fold state is restored |
| `Enter` | `tree-restore` (tree) | Restore to that row, exactly like the pane (including the summary menu) |
| `y` | `tree-copy` (tree) | Copy that row's text |
| `T` | `tree-label` (tree) | Add / edit that row's label (the Label dialog stacks over the tree dialog) |
| `z` | `tree-fold` (tree) | Fold / unfold the branch under the cursor (same rules and fold state as the pane) |
| `d` `t` `u` `l` `a` | `tree-filter-default` / `tree-filter-no-tools` / `tree-filter-user` / `tree-filter-labeled` / `tree-filter-all` (tree-dialog) | Filter: default (hide accounting info) / no tool results / user only / labeled only / all; pressing `t` `u` `l` `a` again returns to default (matching pi's `Ctrl+d/t/u/l/a`). The tree is reloaded and folds are cleared, and the pane then shows the same filter |
| `Esc` / `q` | `tree-dialog-close` (tree-dialog; `Esc` is built-in and not configurable) | Close (while on the list): the pane cursor lands on the dialog's row (expanding the fold that hides it), and CONTENT follows. In the search row `Esc` only leaves the search row, and `q` is just a letter |

## CONTENT pane (read-only)

Scrolling, search, plus centering and copying the selected message (the one the TREE cursor highlights, drawn with a `›` marker).

| Key | Config name | Action |
| --- | --- | --- |
| `j` `k` `↑` `↓` | `move-down` / `move-up` | Scroll |
| `gg` / `G` | `go-top` / `go-bottom` | Top / bottom |
| `zz` | `content-center` | Scroll the selected message to the middle of the pane (vim's `zz`); a no-op when the content already fits without scrolling |
| `y` | `content-copy` | Copy the selected message's full text to the clipboard (same as `y` in the TREE pane) |
| `/` | `search` (global) | Search the rendered message body (bare words only, no qualifiers); a matching line is scrolled to the top and `n` / `N` step through hits |

## Mouse

The core is still the keyboard; the mouse is only lightly supported. Both regular (default) and fullscreen TUI modes are supported: in fullscreen pi dispatches events to the panel, while in regular mode the plugin turns on SGR mouse reporting itself (needs a terminal that supports SGR, which virtually all modern terminals do; while the panel is open the terminal's own selection / scrolling is taken over, and restored on close). See `docs/issues.md`.

| Action | Behavior |
| --- | --- |
| Wheel / three-finger up-down | Scroll the view of the pane under the pointer (a list only scrolls, it does not move the selection; CONTENT scrolls by line), without changing focus |
| Single click | Focus moves to the pane under the pointer; clicking a list item also moves the cursor to it |
| Double-click SESSIONS | Enter that session (equivalent to `Enter` / resume) |
| Double-click TREE | Fold / unfold the branch under the cursor (equivalent to `z`) |



