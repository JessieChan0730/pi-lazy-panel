import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { currentLocale, initI18n } from "../src/i18n/index.ts";
import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext, type Theme } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";
import { LazyPanel } from "../src/ui/app.ts";

const theme = {
	fg: (_c: string, s: string) => s,
	bg: (_c: string, s: string) => s,
	bold: (s: string) => s,
} as unknown as Theme;

type Command = Parameters<ExtensionAPI["registerCommand"]>[1];
type PanelFactory = (tui: unknown, theme: Theme, keybindings: unknown, done: () => void) => LazyPanel;

function registeredCommand(): Command {
	const commands: Command[] = [];
	const pi: Pick<ExtensionAPI, "registerCommand"> = {
		registerCommand: (name, command) => {
			assert.equal(name, "lazy-panel");
			commands.push(command);
		},
	};
	extension(pi as ExtensionAPI);
	return commands[0]!;
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
			ui: {
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
			},
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

test("settings saves General fields, applies language now and scope/sort only on next open", async (ctx) => {
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
		ui: {
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
					for (const key of ["l", "\r", "k", "\r"]) panel.handleInput(key);
					assert.equal(currentLocale(), "en", "draft does not change language");
					panel.handleInput("s");
					await settingsIdle(panel);
					assert.equal(currentLocale(), "zh");
					assert.match(panel.render(120).join("\n"), /界面语言/);
					// Scope: all -> current folder; sort: created -> title.
					for (const key of ["j", "\r", "k", "\r", "j", "\r", "j", "\r", "s"]) panel.handleInput(key);
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
		},
	} as unknown as ExtensionCommandContext;
	await command.handler("settings", context);
	await command.handler("settings", context);
	assert.equal(opens, 2);
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
