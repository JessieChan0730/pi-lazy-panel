/**
 * pi-lazy-panel — entry point.
 *
 * Registers the `/lazy-panel` command. When invoked, it opens the full-screen
 * lazygit-style panel (see ./ui/app.ts). Everything else lives in sub-modules:
 *
 *   config/   keymap + user configuration
 *   data/     read-only adapters over pi's SessionManager (sessions, tree, content)
 *   actions/  side-effecting operations (resume, restore, label, copy, delete, fork, ...)
 *   ui/       TUI components (panes, dialogs, footer, search bar)
 */

import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	cloneSession,
	compactSession,
	copyLastReply,
	copyText,
	deleteSession,
	exportSession,
	exportTarget,
	forkSession,
	importSession,
	newSession,
	renameSession,
	resumeSession,
	shareSession,
} from "./actions/session-actions.ts";
import { copyNodeText, labelNode, restoreNode } from "./actions/tree-actions.ts";
import { loadConfig } from "./config/config.ts";
import { loadPiSettings } from "./config/pi-settings.ts";
import { COMMAND_NAME } from "./constants.ts";
import { loadChangelog } from "./data/changelog.ts";
import { loadContent, loadForkPoints, loadSessionInfo } from "./data/content.ts";
import { initI18n, t } from "./i18n/index.ts";
import { listSessions, sortSessions } from "./data/sessions.ts";
import { applyTreeFilter, loadTree } from "./data/tree.ts";
import { type ActionSource, type DataSource, LazyPanel } from "./ui/app.ts";
import { attachMouse } from "./ui/mouse-input.ts";

/** 读本插件 package.json 的版本号，展示在 footer 右下角；读不到就返回空串（不显示）。 */
function extensionVersion(): string {
	try {
		const pkgPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: unknown };
		return typeof pkg.version === "string" ? pkg.version : "";
	} catch {
		return "";
	}
}

export default function (pi: ExtensionAPI) {
	// 按系统语言初始化 i18n（命令描述在注册时就要用到，一次会话内固定）。
	initI18n();
	pi.registerCommand(COMMAND_NAME, {
		description: t("command.description"),
		handler: async (_args, ctx) => {
			// 按系统语言初始化 i18n（一次会话内固定），之后所有 UI 文案走 t()。
			initI18n();
			if (ctx.mode !== "tui") {
				ctx.ui.notify(t("notify.tuiOnly", { command: COMMAND_NAME }), "warning");
				return;
			}
			const config = await loadConfig(getAgentDir());
			// pi 自己的 branchSummary.skipPrompt 打开时，TREE Enter 和内置 /tree 一样不弹摘要菜单；
			// treeFilterMode 是内置 /tree 的默认过滤，面板的 TREE 也从它开始。
			const piSettings = loadPiSettings(ctx.cwd, getAgentDir(), ctx.isProjectTrusted());
			const data: DataSource = {
				listSessions: async (scope, sort) => sortSessions(await listSessions({ cwd: ctx.cwd, scope }), sort),
				loadTree: async (file, filter) => applyTreeFilter(await loadTree(file), filter),
				loadContent: (file, leafEntryId) =>
					loadContent(leafEntryId ? { sessionFile: file, leafEntryId } : { sessionFile: file }),
				loadSessionInfo,
				loadForkPoints,
				loadChangelog: () => loadChangelog(),
			};
			// 副作用统一走 actions 层；目标是当前会话时用 pi 内存里的 API（setLabel / setSessionName / navigateTree），
			// 其他历史会话则直接读写文件或先 switchSession。
			const actions: ActionSource = {
				copyNodeText,
				setNodeLabel: (file, entryId, label) => labelNode(pi, ctx, file, entryId, label),
				resumeSession: (file) => resumeSession(ctx, file),
				restoreNode: (file, entryId, options) => restoreNode(ctx, file, entryId, options),
				deleteSession: (file) => deleteSession(ctx, file),
				renameSession: (file, name) => renameSession(pi, ctx, file, name),
				newSession: (name) => newSession(ctx, name),
				forkSession: (file, entryId) => forkSession(ctx, file, entryId),
				cloneSession: (file) => cloneSession(ctx, file),
				compactSession: (file, customInstructions) => compactSession(ctx, file, customInstructions),
				copyLastReply,
				copyText,
				// 导出 / 分享的 HTML 走 pi 自己的 `pi --export`；相对路径和默认文件名都按 pi 的工作目录算。
				exportTarget: (file, format, input) => exportTarget(ctx.cwd, file, format, input),
				exportSession: (file, format, outputPath) => exportSession(ctx, file, format, outputPath),
				importSession: (input) => importSession(ctx, input),
				shareSession: (file) => shareSession(file),
			};
			// overlay 句柄在面板显示后才拿到；Enter 等待 pi 切换时用它暂时隐藏面板。
			let setHidden: ((hidden: boolean) => void) | undefined;
			// regular 模式下 pi 不开鼠标追踪，面板自己开；关闭时再关掉（fullscreen 由 pi 管，不碰）。
			let disableMouse: (() => void) | undefined;
			const currentFile = ctx.sessionManager.getSessionFile();
			const version = extensionVersion();

			await ctx.ui.custom<void>(
				(tui, theme, _keybindings, done) => {
					// overlay 模式默认不清理"腾空"的行（pi 的 terminal.clearOnShrink 默认 false）：关掉 ? 帮助框后
					// 会留残影（切面板时闪一下），在有内容的当前会话里滚动时整块面板还会整体往下漂。全屏面板下打开
					// 这个开关，让缩小后的区域被清掉。老版本 pi 可能没有这个方法，先做一次存在性判断。
					if (typeof tui.setClearOnShrink === "function") tui.setClearOnShrink(true);
					const panel = new LazyPanel({
						theme,
						data,
						actions,
						getHeight: () => tui.terminal.rows,
						requestRender: () => tui.requestRender(),
						onClose: () => done(),
						setHidden: (hidden) => setHidden?.(hidden),
						keymap: config.keymap,
						initialState: { scope: config.defaultScope, sort: config.defaultSort, treeFilter: piSettings.treeFilter },
						leftColumnRatio: config.leftColumnRatio,
						skipSummaryPrompt: piSettings.skipBranchSummaryPrompt,
						// 打开时 SESSIONS 光标落到 pi 当前打开的会话上；新会话没有文件 / 还没列出时留在第一行。
						...(currentFile ? { currentSessionFile: currentFile } : {}),
						// 配置文件有问题时在底部提示，但不阻止面板打开。
						...(config.warnings.length ? { status: config.warnings[0] } : {}),
						// footer 右下角的版本号（读不到 package.json 时为空、不显示）。
						...(version ? { version } : {}),
					});
					// fullscreen 模式 pi 已经开了鼠标并派给 overlay 的 handleMouse；regular 模式
					// 由 attachMouse 自己开 SGR 上报并解析（fullscreen 下是 no-op）。
					disableMouse = attachMouse(tui, panel);
					void panel.load();
					return panel;
				},
				{
					// Full-screen overlay: covers pi's own header/editor/footer instead of
					// being embedded in the editor slot (which would overflow the terminal).
					overlay: true,
					overlayOptions: { anchor: "top-left", width: "100%", maxHeight: "100%", margin: 0 },
					onHandle: (handle) => {
						setHidden = (hidden) => handle.setHidden(hidden);
					},
				},
			);
			// 面板关闭后恢复终端自己的滚动 / 选择。
			disableMouse?.();
		},
	});
}
