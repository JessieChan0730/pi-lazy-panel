/**
 * pi-lazy-panel — entry point.
 *
 * Registers the `/lazy-history` command. When invoked, it opens the full-screen
 * lazygit-style panel (see ./ui/app.ts). Everything else lives in sub-modules:
 *
 *   config/   keymap + user configuration
 *   data/     read-only adapters over pi's SessionManager (sessions, tree, content)
 *   actions/  side-effecting operations (resume, delete, rename, fork, export, ...)
 *   ui/       TUI components (panes, dialogs, footer, search bar)
 *
 * NOTE: This is scaffolding only. No feature is implemented yet.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { COMMAND_NAME, EXTENSION_ID } from "./constants.ts";

export default function (pi: ExtensionAPI) {
	pi.registerCommand(COMMAND_NAME, {
		description: "Open the lazygit-style session panel (sessions / tree / content)",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify(`/${COMMAND_NAME} is only available in TUI mode`, "warning");
				return;
			}
			// TODO: open the panel via ctx.ui.custom(...) — see ./ui/app.ts
			ctx.ui.notify(`${EXTENSION_ID}: not implemented yet`, "info");
		},
	});
}
