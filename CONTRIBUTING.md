**English** | [中文](./CONTRIBUTING.zh.md)

# Contributing to pi-lazy-panel

Thanks for your interest in improving pi-lazy-panel! This guide covers the local setup, the conventions the project enforces, and how to get a change merged. It mirrors the rules in [CLAUDE.md](./CLAUDE.md) — when in doubt, that file is the source of truth.

## Prerequisites

- **Node.js ≥ 20**
- **[pi](https://pi.dev)** installed (the panel runs as a pi plugin, only in TUI mode)

## Getting started

The pi-related packages are `devDependencies`, so they are **not** installed automatically — you must install dependencies after cloning:

```bash
npm install            # install dependencies (pi packages included) and set up git hooks
npm run dev            # load the plugin temporarily via pi -e ./src/index.ts, without writing config
npm run install:pi     # pi install . registers this directory into pi (once only)
```

After `install:pi`, edit code and run `/reload` inside pi to pick up the latest — there is no build step, pi loads `src/index.ts` directly.

## Project layout

The codebase is strictly layered: an upper layer may depend on a lower one, never the reverse.

```
src/
├── index.ts      # entry: registers /lazy-panel, guarded to TUI mode only
├── types.ts      # shared types only (no runtime code)
├── constants.ts  # constants (ids, layout ratios, key scopes, …)
├── ui/           # render layer (pi-tui components); no I/O, no pi session API
├── actions/      # side-effect layer: one function per pi command/API
├── data/         # read-only adapters over pi's SessionManager → plain data rows
├── config/       # keymap, chord parsing, user config, pi settings
├── i18n/         # the only layer that knows i18next
└── utils/        # pure formatting / path helpers
```

See CLAUDE.md for the full annotated tree and the data-flow / keybinding-resolution overview. pi's extension API docs live under `node_modules/@earendil-works/pi-coding-agent/docs/` after install — check them before guessing at pi / pi-tui APIs.

## Code style

Formatting is enforced by `.editorconfig` (tab indent, LF) and `eslint.config.js`. Run `npm run lint` (or `npm run lint:fix`) before committing.

- Prefer named function declarations for top-level functions — not arrow functions.
- Local imports must include the explicit `.ts` extension; type-only imports must use `import type`.
- Chinese comments on key code are welcome (they help review); no hard-coded non-English **UI text** in `src` (the lint rule `i18n/no-hardcoded-text` catches non-Latin letters / full-width punctuation in strings).
- Keep modules loosely coupled.

### Internationalization (i18n)

- All UI copy goes through `t()` from `src/i18n`; keep both `src/i18n/locales/en.json` and `zh.json` in sync (**English is the source of truth**).
- **Never** compute an `export const` with `t()` at module top level (import-time evaluation runs before `initI18n`) — write copy as a function and call `t()` at render time.
- Run `npm run i18n:check` to confirm the two locales are aligned.

### Cross-platform

Always write cross-platform code — no platform-specific behavior. For example, never hard-code a literal `~/` path (it breaks on Windows); use the helpers in `src/utils/paths.ts`.

### Dependencies

- `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui` and `typebox` must stay in `peerDependencies` with version `*`. **Never** bundle or vendor them.
- Ordinary new dependencies (like i18next) go in `dependencies` as usual.

### A few hard rules

- Perform destructive operations (delete, fork, …) only after confirming via `ui/widgets/confirm-dialog.ts`.
- Render conversation content only with the `Markdown` component from `@earendil-works/pi-tui` — do not add another Markdown library.
- Keep the `ctx.mode !== "tui"` guard in `src/index.ts`; `/lazy-panel` is TUI-only.

## Testing & checks

```bash
npm run lint           # ESLint
npm run check          # tsc --noEmit
npm test               # unit tests
npm run i18n:check     # English/Chinese copy alignment
```

- Run a single test file: `node --import tsx --test test/ui.test.ts`
- Filter by name: `node --import tsx --test --test-name-pattern="frame" test/ui.test.ts`

Run all four before you push — the `pre-push` hook runs the same suite (six checks total) and will reject a push if any fails. Don't bypass it with `--no-verify`.

## Commits & pull requests

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) and are written in **English**, e.g. `fix(sessions): optimize ui`. `commitlint` runs on every commit via the `commit-msg` hook.
- Doc-only commits use a fixed message: `chore(doc): update doc by $what` (e.g. `chore(doc): update doc by README, keybindings`).
- When you add a new keybinding/action, update all of: the `ActionId` union, the default keymap, `ACTION_DESCRIPTIONS`, the `dispatch` branch, and `docs/keybindings.md`.
- Open pull requests against the `main` branch. Describe what changed and how you verified it.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE).
