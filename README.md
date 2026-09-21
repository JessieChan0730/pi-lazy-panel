# pi-lazy-panel

A lazygit-style TUI for [pi](https://pi.dev) sessions. One command, `/lazy-history`, opens a
three-pane panel: sessions on the left, the selected session's tree below it, and the
conversation content on the right. Everything is driven by vim-like keys.

> Status: **scaffold only**. The directory structure and stubs are in place; no feature is
> implemented yet. See [docs/design.md](./docs/design.md) for the full product plan (Chinese).

```
     25%              75%
  ┌──────────┬────────────────────┐
  │ SESSIONS │                    │
  ├──────────┤      CONTENT       │
  │   TREE   │                    │
  └──────────┴────────────────────┘
  │ NORMAL │ / Search  ? Help ... │
```

## Install (once published)

```bash
pi install npm:pi-lazy-panel
```

During development, load it straight from this folder:

```bash
npm install
pi -e ./src/index.ts        # or: npm run dev
```

## Project layout

```
src/
  index.ts                  extension entry — registers /lazy-history
  constants.ts              ids, command name, layout constants
  types.ts                  shared types (rows, keymap, search query, config)
  config/
    keymap.ts               default key bindings + action descriptions (data only)
    keys.ts                 chord parsing / matching / per-scope resolution
    config.ts               loads ~/.pi/agent/lazy-panel.json over defaults
  data/                     read-only adapters over pi's SessionManager
    sessions.ts             list + sort sessions
    tree.ts                 entry tree of one session + filters
    content.ts              message blocks for the content pane, session info
    search.ts               `name:` `model:` `path:` `tag:` `after:` `before:` parsing
  actions/                  side effects (each wraps a pi command / API)
    session-actions.ts      resume, delete, rename, fork, clone, export, import, share, copy, new
    tree-actions.ts         restore-to-node, copy, label
  ui/
    app.ts                  root component: layout, focus, mode, state
    panes/                  sessions-pane, tree-pane, content-pane
    widgets/                footer, search-bar, help-overlay, confirm-dialog, session-info-dialog
  utils/
    format.ts               time / tokens / cost / path formatting
test/
  smoke.test.ts
docs/
  keybindings.md            default keymap reference
```

## Scripts

| Script          | What it does                          |
| --------------- | ------------------------------------- |
| `npm run check` | Type-check with `tsc --noEmit`        |
| `npm test`      | Run `test/**/*.test.ts` via node:test |
| `npm run dev`   | `pi -e ./src/index.ts`                |

## Configuration

Optional file `~/.pi/agent/lazy-panel.json`:

```json
{
  "defaultScope": "current-folder",
  "defaultSort": "recent",
  "leftColumnRatio": 0.25,
  "keymap": {
    "global":   { "help": "F1", "toggle-scope": ["C", "A"] },
    "sessions": { "session-delete": "ctrl+d", "session-share": null }
  }
}
```

A keymap value replaces the default chords for that action; `null` unbinds it.
Chords use pi-tui syntax (`ctrl+d`, `shift+tab`), an uppercase letter means
shift (`G`), and multi-key sequences are written verbatim (`gg`) or space
separated (`ctrl+w h`).

Action ids are listed in `src/types.ts` (`ActionId`); default bindings and the
full chord syntax in [docs/keybindings.md](./docs/keybindings.md).

## License

MIT
