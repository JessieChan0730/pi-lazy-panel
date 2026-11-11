import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { currentLocale, initI18n } from "../../src/i18n/index.ts";
import { CURRENT_SESSION_VERSION, getAgentDir, SessionManager, type ExtensionAPI, type ExtensionCommandContext, type Theme } from "@earendil-works/pi-coding-agent";
import extension from "../../src/index.ts";
import { LazyPanel } from "../../src/ui/app.ts";
import { DISABLE_MOUSE, ENABLE_MOUSE } from "../../src/ui/mouse-input.ts";

const theme = {
	fg: (_c: string, s: string) => s,
	bg: (_c: string, s: string) => s,
	bold: (s: string) => s,
} as unknown as Theme;

/**
 * The panel reads its colors from `ctx.ui.theme` (a live getter in pi, so the
 * panel follows pi's theme switches), remembers that name as the theme pi has
 * saved, and lists pi's themes through the same UI context — so every fake
 * context that opens a panel needs these. Switching themes goes through
 * `ctx.ui.setTheme` and previewing through pi's `initTheme`, so a test that
 * picks a theme needs a real pi theme to load.
 */
function fakeUi(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		theme,
		getAllThemes: () => [{ name: "test", path: "/themes/test.json" }],
		setTheme: () => ({ success: true }),
		...overrides,
	};
}

type Command = Parameters<ExtensionAPI["registerCommand"]>[1];
type PanelFactory = (tui: unknown, theme: Theme, keybindings: unknown, done: () => void) => LazyPanel;

type Listener = (event: unknown, ctx: unknown) => unknown;

/** Load the extension into a fake pi: its command plus `emit` to fire the pi events it subscribed to. */
function registeredExtension(): { command: Command; emit: (event: string) => void } {
	const commands: Command[] = [];
	const listeners = new Map<string, Listener[]>();
	const pi: Pick<ExtensionAPI, "registerCommand" | "registerShortcut" | "sendUserMessage"> & { on: (event: string, handler: Listener) => void } = {
		on: (event, handler) => void listeners.set(event, [...(listeners.get(event) ?? []), handler]),
		registerCommand: (name, command) => {
			assert.equal(name, "lazy-panel");
			commands.push(command);
		},
		// 扩展加载时还会注册 pi 级快捷键；这里不需要它，给个 no-op 即可（注册本身在 open-shortcut.test.ts 里测）。
		registerShortcut: () => {},
		sendUserMessage: () => {},
	};
	extension(pi as unknown as ExtensionAPI);
	return {
		command: commands[0]!,
		emit: (event) => {
			for (const handler of listeners.get(event) ?? []) handler({ type: event }, {});
		},
	};
}

function registeredCommand(): Command {
	return registeredExtension().command;
}

test("registered settings argument bypasses unbound keys and opens before session loading, without writing config", async (ctx) => {
	ctx.mock.timers.enable({ apis: ["setInterval"] });
	const dir = await mkdtemp(join(tmpdir(), "lazy-panel-command-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	ctx.after(async () => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(dir, { recursive: true, force: true });
	});
	assert.equal(getAgentDir(), dir);
	const raw = JSON.stringify({ locale: "en", defaultScope: "all", defaultSort: "created", leftColumnRatio: 0.45, keymap: { global: { "settings-open": null } }, futureField: true });
	const file = join(dir, "lazy-panel.json");
	await writeFile(file, raw);
	let loadCalls = 0;
	ctx.mock.method(LazyPanel.prototype, "load", () => {
		loadCalls++;
		return new Promise<void>(() => {});
	});
	const command = registeredCommand();
	for (const args of ["settings", "  settings  ", "", "unknown"]) {
		const previousLoadCalls = loadCalls;
		let customCalls = 0;
		const context = {
			mode: "tui",
			cwd: dir,
			isProjectTrusted: () => false,
			sessionManager: { getSessionFile: () => undefined },
			ui: fakeUi({
				custom: async (factory: PanelFactory) => {
					customCalls++;
					const panel = factory({ mode: "fullscreen", terminal: { rows: 28, columns: 120 }, requestRender: () => {} }, theme, {}, () => {});
					try {
						assert.equal(loadCalls, previousLoadCalls + 1, "load has started but has not completed");
						assert.equal(panel.keymap.global["settings-open"], undefined);
						if (args.trim() === "settings") {
							assert.equal(panel.state.settings.phase, "open");
							const text = panel.render(120).join("\n");
							assert.match(text, /All folders/);
							assert.match(text, /Creation time/);
							panel.state.settings.category = "layout";
							assert.match(panel.render(120).join("\n"), /45%/);
						} else {
							assert.equal(panel.state.settings.phase, "closed");
							panel.handleInput(",");
							assert.equal(panel.state.settings.phase, "closed");
						}
					} finally {
						panel.dispose();
					}
				},
			}),
		} as unknown as ExtensionCommandContext;
		await command.handler(args, context);
		assert.equal(customCalls, 1);
		assert.equal(await readFile(file, "utf8"), raw);
	}
	assert.equal(loadCalls, 4);
});

async function settingsIdle(panel: LazyPanel): Promise<void> {
	for (let i = 0; i < 200 && (panel.state.settings.loading || panel.state.settings.saving); i++) await delay(5);
	assert.equal(panel.state.settings.loading, false);
	assert.equal(panel.state.settings.saving, false);
	assert.equal(panel.state.settings.error, undefined);
}

test("settings writes General fields as soon as they are picked, applies language now and scope/sort only on next open", async (ctx) => {
	const dir = await mkdtemp(join(tmpdir(), "lazy-panel-save-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	ctx.after(async () => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		initI18n("en");
		await rm(dir, { recursive: true, force: true });
	});
	const file = join(dir, "lazy-panel.json");
	const keymap = { global: { "settings-open": null } };
	await writeFile(file, JSON.stringify({ locale: "en", defaultScope: "all", defaultSort: "created", keymap, futureField: { keep: true } }));
	ctx.mock.method(LazyPanel.prototype, "load", async () => {});
	const command = registeredCommand();
	let opens = 0;
	const context = {
		mode: "tui", cwd: dir, isProjectTrusted: () => false,
		sessionManager: { getSessionFile: () => undefined },
		ui: fakeUi({
			custom: async (factory: PanelFactory) => {
				const panel = factory({ mode: "fullscreen", terminal: { rows: 28, columns: 120 }, requestRender: () => {} }, theme, {}, () => {});
				try {
					await settingsIdle(panel);
					if (opens++ > 0) {
						assert.equal(panel.state.scope, "current-folder");
						assert.equal(panel.state.sort, "title");
						assert.equal(currentLocale(), "zh");
						return;
					}
					panel.state.treeFolded.add("keep-fold");
					panel.state.selectedSessionFiles.add("keep-selection");
					panel.state.search.content = { query: "keep-search", matches: [], current: -1 };
					panel.render(120); // Prime the English render before changing language.
					// 打开语言菜单、把光标移到中文都还不算改动，回车那一下才落盘并当场生效。
					for (const key of ["l", "\r", "k"]) panel.handleInput(key);
					assert.equal(currentLocale(), "en", "还没选中，语言不变");
					panel.handleInput("\r");
					await settingsIdle(panel);
					assert.equal(currentLocale(), "zh");
					assert.match(panel.render(120).join("\n"), /界面语言/);
					// Scope: all -> current folder; sort: created -> title（每次选中都立刻落盘，
					// 保存进行中 handleInput 会让路，所以一项一项来）。
					for (const key of ["j", "\r", "k", "\r"]) panel.handleInput(key);
					await settingsIdle(panel);
					for (const key of ["j", "\r", "j", "\r"]) panel.handleInput(key);
					await settingsIdle(panel);
					assert.equal(panel.state.scope, "all");
					assert.equal(panel.state.sort, "created");
					assert.ok(panel.state.treeFolded.has("keep-fold"));
					assert.ok(panel.state.selectedSessionFiles.has("keep-selection"));
					assert.equal(panel.state.search.content.query, "keep-search");
					const saved = JSON.parse(await readFile(file, "utf8"));
					assert.deepEqual(saved, { locale: "zh", defaultScope: "current-folder", defaultSort: "title", keymap, futureField: { keep: true } });
					panel.handleInput("q");
					assert.equal(panel.state.settings.phase, "closed");
				} finally {
					panel.dispose();
				}
			},
		}),
	} as unknown as ExtensionCommandContext;
	await command.handler("settings", context);
	await command.handler("settings", context);
	assert.equal(opens, 2);
});

test("the entry point checks live pi activity before switching and cancellation never calls switchSession or abort", async (ctx) => {
	// 隔离运行中动画的轮询，避免异步等待期间定时器额外调用 isIdle 干扰切换守卫的计数。
	ctx.mock.timers.enable({ apis: ["setInterval"] });
	const dir = await mkdtemp(join(tmpdir(), "lazy-panel-running-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	ctx.after(async () => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(dir, { recursive: true, force: true });
	});
	await writeFile(join(dir, "lazy-panel.json"), JSON.stringify({ locale: "en" }));
	const file = join(dir, "b.jsonl");
	const now = new Date();
	const entries = [
		{ type: "session", version: CURRENT_SESSION_VERSION, id: "session-b", timestamp: now.toISOString(), cwd: dir },
		{ type: "message", id: "u1", parentId: null, timestamp: now.toISOString(), message: { role: "user", content: [{ type: "text", text: "B conversation" }], timestamp: now.getTime() } },
	];
	await writeFile(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
	ctx.mock.method(SessionManager, "list", async () => [{ path: file, id: "session-b", cwd: dir, name: "B", created: now, modified: now, messageCount: 1, firstMessage: "B conversation", allMessagesText: "B conversation" }]);
	const switched: string[] = [];
	let idle = false;
	let idleQueries = 0;
	let closed = false;
	const context = {
		mode: "tui",
		cwd: dir,
		isProjectTrusted: () => false,
		isIdle: () => {
			idleQueries++;
			return idle;
		},
		abort: () => assert.fail("cancelling a switch must not abort the current response"),
		sessionManager: { getSessionFile: () => join(dir, "a.jsonl") },
		switchSession: async (target: string) => {
			switched.push(target);
			return { cancelled: false };
		},
		ui: fakeUi({
			custom: async (factory: PanelFactory) => {
				const panel = factory({ mode: "fullscreen", terminal: { rows: 24, columns: 120 }, requestRender: () => {} }, theme, {}, () => {
					closed = true;
				});
				try {
					await panel.load();
					// 打开时为了运行中标记会查一次活动状态，但切换前必须重新查，不能用那次的结果。
					const atOpen = idleQueries;
					panel.handleInput("\r");
					assert.equal(idleQueries, atOpen + 1, "the switch guard asks pi again instead of reusing what the panel saw at open");
					assert.equal(panel.state.mode, "confirm");
					assert.match(panel.render(120).join("\n"), /Switch and interrupt the running conversation!/);
					assert.deepEqual(switched, []);
					panel.handleInput("n");
					assert.equal(panel.state.mode, "normal");
					assert.equal(closed, false);
					assert.deepEqual(switched, []);
					idle = true;
					const beforeRetry = idleQueries;
					panel.handleInput("\r");
					await delay(0);
					assert.deepEqual(switched, [file]);
					assert.equal(closed, true);
					assert.equal(idleQueries, beforeRetry + 1);
				} finally {
					panel.dispose();
				}
			},
		}),
	} as unknown as ExtensionCommandContext;
	await registeredCommand().handler("", context);
});

test("agent_start reaches the open panel so the current session starts spinning, and is ignored once it is closed", async (ctx) => {
	ctx.mock.timers.enable({ apis: ["setInterval"] });
	const dir = await mkdtemp(join(tmpdir(), "lazy-panel-activity-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	ctx.after(async () => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(dir, { recursive: true, force: true });
	});
	await writeFile(join(dir, "lazy-panel.json"), JSON.stringify({ locale: "en" }));
	const file = join(dir, "a.jsonl");
	const now = new Date();
	const entries = [
		{ type: "session", version: CURRENT_SESSION_VERSION, id: "session-a", timestamp: now.toISOString(), cwd: dir },
		{ type: "message", id: "u1", parentId: null, timestamp: now.toISOString(), message: { role: "user", content: [{ type: "text", text: "A conversation" }], timestamp: now.getTime() } },
	];
	await writeFile(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
	ctx.mock.method(SessionManager, "list", async () => [{ path: file, id: "session-a", cwd: dir, name: "Alpha", created: now, modified: now, messageCount: 1, firstMessage: "A conversation", allMessagesText: "A conversation" }]);
	let idle = true;
	let renders = 0;
	const { command, emit } = registeredExtension();
	let opened: LazyPanel | undefined;
	const context = {
		mode: "tui",
		cwd: dir,
		isProjectTrusted: () => false,
		isIdle: () => idle,
		sessionManager: { getSessionFile: () => file },
		ui: fakeUi({
			custom: async (factory: PanelFactory) => {
				const panel = factory({ mode: "fullscreen", terminal: { rows: 24, columns: 120 }, requestRender: () => void renders++ }, theme, {}, () => {});
				opened = panel;
				try {
					await panel.load();
					// 200 列：左栏够宽，标记带得上 running 这个词
					const row = () => panel.render(200).find((line) => line.includes("Alpha")) ?? "";
					assert.match(row(), /Alpha\(current\)/);
					// 面板开着时 pi 开始跑（比如排队的后续消息）
					idle = false;
					const before = renders;
					emit("agent_start");
					assert.match(row(), /Alpha ⠋ running/);
					assert.ok(renders > before, "the panel repaints as soon as the run starts");
					ctx.mock.timers.tick(80);
					assert.match(row(), /Alpha ⠙ running/);
					idle = true;
					ctx.mock.timers.tick(80);
					assert.match(row(), /Alpha\(current\)/);
				} finally {
					panel.dispose();
				}
			},
		}),
	} as unknown as ExtensionCommandContext;
	await command.handler("", context);
	// 面板关掉以后的事件不再碰它
	idle = false;
	const after = renders;
	emit("agent_start");
	ctx.mock.timers.tick(1200);
	assert.equal(renders, after);
	assert.ok(opened);
});

/** Poll until `check` holds: the command reads its config files before pi's `custom()` factory runs. */
async function until(check: () => boolean, what: string): Promise<void> {
	for (let i = 0; i < 200 && !check(); i++) await delay(5);
	assert.ok(check(), what);
}

test("a session switch that disposes the panel without done() still ends the command, so the panel opens again", async (ctx) => {
	const dir = await mkdtemp(join(tmpdir(), "lazy-panel-reset-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	ctx.after(async () => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(dir, { recursive: true, force: true });
	});
	await writeFile(join(dir, "lazy-panel.json"), JSON.stringify({ locale: "en" }));
	const file = join(dir, "b.jsonl");
	const now = new Date();
	const entries = [
		{ type: "session", version: CURRENT_SESSION_VERSION, id: "session-b", timestamp: now.toISOString(), cwd: dir },
		{ type: "message", id: "u1", parentId: null, timestamp: now.toISOString(), message: { role: "user", content: [{ type: "text", text: "B conversation" }], timestamp: now.getTime() } },
	];
	await writeFile(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
	ctx.mock.method(SessionManager, "list", async () => [{ path: file, id: "session-b", cwd: dir, name: "B", created: now, modified: now, messageCount: 1, firstMessage: "B conversation", allMessagesText: "B conversation" }]);
	// regular 模式：面板自己打开鼠标上报、挂输入监听，要等命令结束时才关掉。
	const writes: string[] = [];
	const listeners = new Set<(data: string) => unknown>();
	const tui = {
		mode: "regular",
		terminal: { rows: 24, columns: 120, write: (data: string) => writes.push(data) },
		requestRender: () => {},
		addInputListener: (listener: (data: string) => unknown) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	// 照搬 pi 1.5 的 showExtensionCustom：done 先移除 overlay（dispose 组件）再 resolve；
	// 切换会话时 resetExtensionUI 只移除 overlay，promise 一直挂着、永远不 resolve。
	const panels: LazyPanel[] = [];
	let resetExtensionUI = () => {};
	const custom = (factory: PanelFactory) => new Promise<void>((resolve) => {
		let closed = false;
		let mounted: LazyPanel | undefined;
		const removeOverlay = () => {
			const panel = mounted;
			mounted = undefined;
			panel?.dispose();
		};
		mounted = factory(tui, theme, {}, () => {
			if (closed) return;
			closed = true;
			removeOverlay();
			resolve();
		});
		panels.push(mounted);
		resetExtensionUI = removeOverlay;
	});
	const switched: string[] = [];
	const context = {
		mode: "tui",
		cwd: dir,
		isProjectTrusted: () => false,
		// 当前对话正在运行：Enter 先弹确认，y 才切换（用户实际走到的路径）。
		isIdle: () => false,
		sessionManager: { getSessionFile: () => join(dir, "a.jsonl") },
		switchSession: async (target: string) => {
			// pi 的 teardownCurrent：先 resetExtensionUI（dispose 面板但不调 done），再换成目标会话。
			resetExtensionUI();
			switched.push(target);
			return { cancelled: false };
		},
		ui: fakeUi({ custom }),
	} as unknown as ExtensionCommandContext;
	const command = registeredCommand();
	const first = command.handler("", context);
	await until(() => panels.length === 1, "the panel opens");
	const panel = panels[0]!;
	await panel.load();
	assert.ok(writes.includes(ENABLE_MOUSE));
	assert.ok(listeners.size > 0);
	panel.handleInput("\r");
	assert.equal(panel.state.mode, "confirm");
	panel.handleInput("y");
	// 有上限地等命令结束：修复前 pi 永远不 resolve，1 秒后在这里给出明确的失败信息。
	const timeout = new AbortController();
	const ended = await Promise.race([first.then(() => true), delay(1000, false, { signal: timeout.signal }).catch(() => false)]);
	timeout.abort();
	assert.equal(ended, true, "the command ends although pi never calls done()");
	assert.deepEqual(switched, [file]);
	assert.equal(writes.at(-1), DISABLE_MOUSE, "mouse reporting is switched off again");
	assert.equal(listeners.size, 0, "no input listener is left behind");
	// 防重入标记已复位：再次执行命令会打开新面板；q 正常关闭（done → dispose → onDispose 的第二次 done 是 no-op）。
	const second = command.handler("", context);
	await until(() => panels.length === 2, "the panel opens again");
	panels[1]!.handleInput("q");
	await second;
	assert.equal(listeners.size, 0);
});

test("settings command preserves the non-TUI guard", async () => {
	const command = registeredCommand();
	const notices: Array<{ text: string; kind: string }> = [];
	const ctx = {
		mode: "rpc",
		ui: {
			notify: (text: string, kind: string) => notices.push({ text, kind }),
			custom: () => assert.fail("non-TUI must not create a panel"),
		},
	} as unknown as ExtensionCommandContext;
	await command.handler("settings", ctx);
	assert.equal(notices.length, 1);
	assert.equal(notices[0]!.kind, "warning");
});
