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
 */

import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { copyNodeText, labelNode } from "./actions/tree-actions.ts";
import { loadConfig } from "./config/config.ts";
import { COMMAND_NAME } from "./constants.ts";
import { loadContent } from "./data/content.ts";
import { listSessions, sortSessions } from "./data/sessions.ts";
import { applyTreeFilter, loadTree } from "./data/tree.ts";
import { type ActionSource, type DataSource, LazyPanel } from "./ui/app.ts";

export default function (pi: ExtensionAPI) {
	pi.registerCommand(COMMAND_NAME, {
		description: "Open the lazygit-style session panel (sessions / tree / content)",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify(`/${COMMAND_NAME} is only available in TUI mode`, "warning");
				return;
			}
			const config = await loadConfig(getAgentDir());
			const data: DataSource = {
				listSessions: async (scope, sort) => sortSessions(await listSessions({ cwd: ctx.cwd, scope }), sort),
				loadTree: async (file, filter) => applyTreeFilter(await loadTree(file), filter),
				loadContent: (file, leafEntryId) =>
					loadContent(leafEntryId ? { sessionFile: file, leafEntryId } : { sessionFile: file }),
			};
			// 副作用统一走 actions 层；打标签时如果是当前会话就通过 pi.setLabel 同步 pi 内存状态。
			const actions: ActionSource = {
				copyNodeText,
				setNodeLabel: (file, entryId, label) => labelNode(pi, ctx, file, entryId, label),
			};

			await ctx.ui.custom<void>(
				(tui, theme, _keybindings, done) => {
					const panel = new LazyPanel({
						theme,
						data,
						actions,
						getHeight: () => tui.terminal.rows,
						requestRender: () => tui.requestRender(),
						onClose: () => done(),
						keymap: config.keymap,
						initialState: { scope: config.defaultScope, sort: config.defaultSort },
						leftColumnRatio: config.leftColumnRatio,
						// 配置文件有问题时在底部提示，但不阻止面板打开。
						...(config.warnings.length ? { status: config.warnings[0] } : {}),
					});
					void panel.load();
					return panel;
				},
				{
					// Full-screen overlay: covers pi's own header/editor/footer instead of
					// being embedded in the editor slot (which would overflow the terminal).
					overlay: true,
					overlayOptions: { anchor: "top-left", width: "100%", maxHeight: "100%", margin: 0 },
				},
			);
		},
	});
}
