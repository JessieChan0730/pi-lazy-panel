**English** | [中文](./README.zh.md)

## Introduction

pi-lazy-panel is a panel for managing [pi](https://pi.dev) sessions and session trees, offering a lazygit-style workflow and TUI look. Once installed, run `/lazy-panel` — or press the `alt+l` shortcut it registers in pi — to open a full-terminal three-pane interface:

- Top-left **SESSIONS**: the history of past sessions (mirrors `/resume`)
- Bottom-left **TREE**: the conversation tree of the selected session (mirrors `/tree`, switches automatically with the selection above)
- Right **CONTENT**: the conversation detail of the selected node, rendered with pi's native Markdown, distinguishing "me" from "AI"

The everyday session operations (new / resume / fork / clone / rename / delete / compact / export / import / share / copy) are all condensed into single-key shortcuts — no mouse required.

Press `,` for the built-in **settings page**: General (language, default scope, default sort), Layout (how wide the left column is), Keybindings (per scope, recorded by pressing the keys you want; the pi-level open shortcut sits at the top of this page) and Theme (switches pi's own theme). Every edit takes effect at once and is written back to `~/.pi/agent/lazy-panel.json` — no hand-editing JSON.

## Preview

![pi-lazy-panel preview](https://raw.githubusercontent.com/JessieChan0730/pi-lazy-panel/HEAD/assets/readme/preview-en.png)

## Features

1. Pure keyboard flow — most operations take a single key (hjkl to move, `d` to delete, `r` to rename, à la lazygit)
2. Three linked panes: SESSIONS → TREE → CONTENT cascade-refresh as the cursor moves
3. Full coverage of the session commands: resume / new / fork / clone / rename / delete / compact / export / import / share / copy
4. Session-tree navigation: restore to any node, choosing "No summary / Summarize / Summarize with custom prompt" for the abandoned branch
5. lazygit-style search: `/` jumps in place, `n` / `N` cycle, with `name:` `model:` `path:` `tag:` `role:` `after:` `before:` qualifiers
6. Theme follows pi automatically — the settings page switches pi's own theme, both the built-in ones and custom ones under `~/.pi/agent/themes/`
7. Bilingual — English and Chinese (follows the system language, overridable in the config)
8. Fully customizable keybindings: rebind any action in the settings page or in `~/.pi/agent/lazy-panel.json`
9. Light mouse support (wheel to scroll, click to focus, double-click to enter / fold)
10. Built-in settings page (`,`): General / Layout / Keybindings / Theme edited in place — key bindings are recorded by pressing the keys, conflicts are caught before they are written, and each edit is saved as you make it
11. A global shortcut: installing the plugin registers `alt+l` in pi, so the panel opens without typing `/lazy-panel` (change or disable it with `openShortcut` in the config)

## Quick start

Requires [pi](https://pi.dev) to be installed. Run the install command inside pi:

```bash
# npm
pi install npm:pi-lazy-panel

# GitHub
pi install git:github.com/JessieChan0730/pi-lazy-panel
```

After installing, run `/lazy-panel` (or press `alt+l`) inside pi to open the panel; `?` shows all shortcuts for the current pane, and `,` opens the settings page.

## Local development

The pi-related packages are `devDependencies`, so you must install dependencies after cloning:

```bash
npm install            # install dependencies (pi packages included; not installed automatically by default)
npm run dev            # load the plugin temporarily via pi -e ./index.ts, without writing config
npm run install:pi     # pi install . registers this directory into pi (once only); after editing code, run /reload in pi to pick up the latest
```

If an npm installation is also present, disable its extension with `pi config` while testing the local copy, or remove it with `pi remove npm:pi-lazy-panel`. Reload or restart pi afterward. If multiple copies are enabled, the open shortcut resolves its own entry's actual command name (`/lazy-panel` or `/lazy-panel:N`) at keypress time. Pi still gives a shared shortcut to the last-loaded extension; unresolved or ambiguous matches show a warning instead of sending an invalid command.

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
- **Optional external commands**: `/share` opens a destination menu — Auto (private GitHub Gist when `gh` is logged in, otherwise Radius), GitHub Gist, or Radius. Radius uses pi's `/login radius` credential, while the gist path needs a logged-in GitHub CLI (`gh`); choosing Radius without a credential runs the same sign-in inside the panel (account / API key, browser or device code) and then continues the share. When deleting a session, `trash` is used if available (moving it to the recycle bin), otherwise the file is deleted directly.

## Configuration

The config file lives at `~/.pi/agent/lazy-panel.json`. Every field is optional and falls back to a built-in default when omitted:

```json
{
 "locale": "zh",
 "openShortcut": "alt+l",
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
| `openShortcut`    | pi-level key that opens the panel | one key with a modifier, or `F1`–`F12`; `null` disables | `"alt+l"`          |
| `defaultScope`    | session scope on open           | `"current-folder"` / `"all"`                        | `"current-folder"`     |
| `defaultSort`     | session list ordering           | `"recent"` / `"created"` / `"title"` / `"threaded"` | `"recent"`             |
| `leftColumnRatio` | left column width ratio         | `0.15` ~ `0.6`                                      | `0.25`                 |
| `keymap`          | custom keybindings              | see below                                           | built-in keys          |

`keymap` is grouped by `scope` (`global` / `sessions` / `tree` / `content` / `tree-dialog`); the key is an action id and the value is one or more chords (e.g. `"ctrl+d"`, `["A", "ctrl+space"]`). A user-provided binding **replaces the action's default entirely**, and `null` unbinds it. See [docs/keybindings.md](./docs/keybindings.md) for the full list of action ids and keybindings.

`openShortcut` is read once when the extension loads — run pi's `/reload` after changing it. Set it to `null` to keep only `/lazy-panel`. The settings page edits it too (**Keybindings → Open shortcut (pi)**: press a new key, turn it off, or fall back to the default).

The settings page (`,`) edits this same file: it patches only the fields you changed, leaves the rest of the file — including its indentation and line endings — as it was, and merges unrelated changes made in another window (a conflict on the same field stops the write and offers a retry).

## Roadmap

0.2.0 adds the settings panel; the 0.2.x line is for fixes, polish and code cleanups rather than new features.

Two display quirks are known and still open: closing `?` and switching panes right away can leave a one-frame ghost, and in pi's regular (main-screen) TUI mode a long session can clip the panel's top rows — `pi --tui-mode fullscreen` (or `"tuiMode": "fullscreen"` in pi's `settings.json`) avoids the latter.

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md) for the local setup, coding conventions and commit/PR flow.

## License

Licensed under the [MIT License](./LICENSE).
