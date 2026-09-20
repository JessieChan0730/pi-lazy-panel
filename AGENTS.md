# pi-lazy-panel

pi extension (TypeScript, ESM, tabs). Entry: `src/index.ts`, loaded by pi via the `pi.extensions`
field in `package.json`. Product spec lives in `计划.md`; default keys in `docs/keybindings.md`.

## Rules

- Layering: `data/` and `config/` are pure and pi-agnostic where possible; `actions/` may call pi
  APIs; `ui/` only renders and dispatches. Do not put I/O in `ui/` or `types.ts`.
- Imports between local modules use explicit `.ts` extensions (`allowImportingTsExtensions`).
- pi core packages (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, `typebox`) stay
  in `peerDependencies` with `*`; never bundle them.
- Destructive actions (delete, fork) always go through the confirm dialog first.
- Use pi's own Markdown renderer from `@earendil-works/pi-tui` for content; do not add another
  markdown library.

## Commands

```
npm run check   # tsc --noEmit
npm test        # node --test via tsx
npm run dev     # pi -e ./src/index.ts
```

Reference docs for the extension API are in the local pi install:
`node_modules/@earendil-works/pi-coding-agent/docs/{extensions,tui,session-format}.md`.
