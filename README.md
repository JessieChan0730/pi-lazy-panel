**English** | [中文](./README.zh.md)

## Introduction

pi-lazy-panel is a panel for managing [pi](https://pi.dev) sessions and session trees, offering a lazygit-style workflow and TUI look. Once installed, run `/lazy-panel` inside pi to open a full-terminal three-pane interface:

- Top-left **SESSIONS**: the history of past sessions (mirrors `/resume`)
- Bottom-left **TREE**: the conversation tree of the selected session (mirrors `/tree`, switches automatically with the selection above)
- Right **CONTENT**: the conversation detail of the selected node, rendered with pi's native Markdown, distinguishing "me" from "AI"

The everyday session operations (new / resume / fork / clone / rename / delete / compact / export / import / share / copy) are all condensed into single-key shortcuts — no mouse required.

## Preview

![pi-lazy-panel preview](https://raw.githubusercontent.com/JessieChan0730/PiLazyPanel/HEAD/assets/readme/preview-en.png)

## Features

1. Pure keyboard flow — most operations take a single key (hjkl to move, `d` to delete, `r` to rename, à la lazygit)
2. Three linked panes: SESSIONS → TREE → CONTENT cascade-refresh as the cursor moves
3. Full coverage of the session commands: resume / new / fork / clone / rename / delete / compact / export / import / share / copy
4. Session-tree navigation: restore to any node, choosing "No summary / Summarize / Summarize with custom prompt" for the abandoned branch
5. lazygit-style search: `/` jumps in place, `n` / `N` cycle, with `name:` `model:` `path:` `tag:` `role:` `after:` `before:` qualifiers
6. Theme follows pi automatically
7. Bilingual — English and Chinese (follows the system language, overridable in the config)
8. Fully customizable keybindings: rebind any action in `~/.pi/agent/lazy-panel.json`
9. Light mouse support (wheel to scroll, click to focus, double-click to enter / fold)

## Quick start

Requires [pi](https://pi.dev) to be installed. Run the install command inside pi:

```bash
# npm
pi install npm:pi-lazy-panel

# GitHub
pi install git:github.com/JessieChan0730/pi-lazy-panel
```

After installing, run `/lazy-panel` inside pi to open the panel; `?` shows all shortcuts for the current pane.

## Local development

The pi-related packages are `devDependencies`, so you must install dependencies after cloning:

```bash
npm install            # install dependencies (pi packages included; not installed automatically by default)
npm run dev            # load the plugin temporarily via pi -e ./src/index.ts, without writing config
npm run install:pi     # pi install . registers this directory into pi (once only); after editing code, run /reload in pi to pick up the latest
```

Run the full check suite before committing (same as the pre-push hook):

```bash
npm run lint           # ESLint
npm run check          # tsc --noEmit
npm test               # unit tests
npm run i18n:check     # English/Chinese copy alignment
```

## Compatibility

- **Runtime**: Node.js ≥ 20.
- **pi version**: runs as a pi plugin, depending on pi's session API (`@earendil-works/pi-coding-agent`).
- **Run mode**: available only in pi's TUI mode (`/lazy-panel` refuses to open outside TUI mode).
- **OS**: cross-platform — Windows / macOS / Linux all work (paths are handled uniformly per platform).
- **Terminal**: mouse support in regular mode needs a terminal that supports SGR mouse reporting (virtually all modern terminals do); without it, keyboard operation is unaffected.
- **Optional external commands**: `/share` needs a logged-in GitHub CLI (`gh`); when deleting a session, `trash` is used if available (moving it to the recycle bin), otherwise the file is deleted directly.

## Configuration

The config file lives at `~/.pi/agent/lazy-panel.json`. Every field is optional and falls back to a built-in default when omitted:

```json
{
 "locale": "zh",
 "defaultScope": "all",
 "defaultSort": "recent",
 "leftColumnRatio": 0.25,
 "keymap": {
  "global": { "help": "F1", "scope-all": ["A", "ctrl+space"] },
  "sessions": { "session-delete": "ctrl+d", "session-share": null }
 }
}
```

| Field             | Description                     | Values / range                                      | Default                |
| ----------------- | ------------------------------- | --------------------------------------------------- | ---------------------- |
| `locale`          | UI language                     | `"en"` / `"zh"`                                     | follows system language |
| `defaultScope`    | session scope on open           | `"current-folder"` / `"all"`                        | `"current-folder"`     |
| `defaultSort`     | session list ordering           | `"recent"` / `"created"` / `"title"` / `"threaded"` | `"recent"`             |
| `leftColumnRatio` | left column width ratio         | `0.15` ~ `0.6`                                      | `0.25`                 |
| `keymap`          | custom keybindings              | see below                                           | built-in keys          |

`keymap` is grouped by `scope` (`global` / `sessions` / `tree` / `content` / `tree-dialog`); the key is an action id and the value is one or more chords (e.g. `"ctrl+d"`, `["A", "ctrl+space"]`). A user-provided binding **replaces the action's default entirely**, and `null` unbinds it. See [docs/keybindings.md](./docs/keybindings.md) for the full list of action ids and keybindings.

## Next steps

- Add a settings panel
- Add multiple themes / custom themes

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for the local setup, coding conventions and commit/PR flow.

## License

Licensed under the [MIT License](./LICENSE).
