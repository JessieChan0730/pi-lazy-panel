/**
 * pi-level shortcut tests: the synchronous config read used while the extension
 * registers itself, and the registration that re-enters `/lazy-panel`.
 * Run with `npm test` (node --test via tsx).
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { KeyId } from "@earendil-works/pi-tui";
import rootExtension from "../../index.ts";
import { loadConfigSync } from "../../src/config/config.ts";
import { CONFIG_FILE_NAME, DEFAULT_OPEN_SHORTCUT } from "../../src/constants.ts";
import { initI18n, t as translate } from "../../src/i18n/index.ts";
import extension, { registerOpenShortcut, type ShortcutHost } from "../../src/index.ts";

type SlashCommand = ReturnType<ShortcutHost["getCommands"]>[number];

const ROOT_ENTRY = fileURLToPath(new URL("../../index.ts", import.meta.url));
const SOURCE_ENTRY = fileURLToPath(new URL("../../src/index.ts", import.meta.url));

function slashCommand(name: string, file: string, source: SlashCommand["source"] = "extension"): SlashCommand {
	return {
		name,
		source,
		sourceInfo: { path: file, source: "local", scope: "temporary", origin: "top-level" },
	};
}

function shortcutHost() {
	const registered: Array<{ key: KeyId; options: Parameters<ShortcutHost["registerShortcut"]>[1] }> = [];
	const sent: Array<Parameters<ShortcutHost["sendUserMessage"]>> = [];
	const notices: Array<{ message: string; type: string | undefined }> = [];
	const commands: SlashCommand[] = [];
	let queries = 0;
	const pi: ShortcutHost = {
		registerShortcut(key, options) {
			registered.push({ key, options });
		},
		sendUserMessage(...args) {
			sent.push(args);
		},
		getCommands() {
			queries++;
			return commands;
		},
	};
	const ctx = { ui: {
		notify(message: string, type?: string) {
			notices.push({ message, type });
		},
	} };
	return { pi, registered, sent, notices, commands, queries: () => queries, trigger: () => registered[0]!.options.handler(ctx as never) };
}

function tempDir(t: { after: (fn: () => void) => void }): string {
	const dir = mkdtempSync(join(tmpdir(), "lazy-panel-shortcut-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

test("loadConfigSync: reads openShortcut like the async loader, defaulting when absent", (t) => {
	const dir = tempDir(t);
	// 没有配置文件时用内置默认值。
	assert.equal(loadConfigSync(dir).openShortcut, DEFAULT_OPEN_SHORTCUT);

	writeFileSync(join(dir, CONFIG_FILE_NAME), JSON.stringify({ openShortcut: "F2", locale: "zh" }), "utf8");
	const cfg = loadConfigSync(dir);
	assert.equal(cfg.openShortcut, "f2");
	assert.equal(cfg.locale, "zh");

	// 关闭：null 保留为 null，不会被默认值顶回去。
	writeFileSync(join(dir, CONFIG_FILE_NAME), JSON.stringify({ openShortcut: null }), "utf8");
	assert.equal(loadConfigSync(dir).openShortcut, null);

	// 坏 JSON 退回默认值并带 warning（和 loadConfig 一致）。
	writeFileSync(join(dir, CONFIG_FILE_NAME), "{ nope", "utf8");
	const broken = loadConfigSync(dir);
	assert.equal(broken.openShortcut, DEFAULT_OPEN_SHORTCUT);
	assert.equal(broken.warnings.length, 1);
});

test("registerOpenShortcut: registers the key and re-enters the command", () => {
	initI18n("en");
	const host = shortcutHost();
	const { pi, registered, sent, notices } = host;

	registerOpenShortcut(pi, "alt+l");
	assert.equal(registered.length, 1);
	assert.equal(registered[0]!.key, "alt+l");
	assert.ok(registered[0]!.options.description, "pi's shortcut help needs a description");
	assert.equal(host.queries(), 0, "the command registry is not ready during extension registration");
	host.commands.push(slashCommand("lazy-panel", SOURCE_ENTRY));

	// 触发快捷键只走命令路径：命令处理器才拿得到 newSession / switchSession 等会话控制方法。
	host.trigger();
	assert.equal(sent.length, 1);
	assert.equal(sent[0]![0], "/lazy-panel");
	assert.deepEqual(sent[0]![1], { expandPromptTemplates: true });
	assert.deepEqual(notices, []);

	// null（配置里关掉）时不注册。
	registerOpenShortcut(pi, null);
	assert.equal(registered.length, 1);
});

test("registerOpenShortcut: selects its own numbered command regardless of load order", () => {
	const foreignEntry = join(tmpdir(), "npm", "pi-lazy-panel", "index.ts");
	for (const ownNumber of [1, 2]) {
		const host = shortcutHost();
		host.commands.push(
			slashCommand(`lazy-panel:${3 - ownNumber}`, foreignEntry),
			slashCommand(`lazy-panel:${ownNumber}`, ROOT_ENTRY),
		);
		registerOpenShortcut(host.pi, "alt+l", ROOT_ENTRY);
		host.trigger();
		assert.deepEqual(host.sent, [[`/lazy-panel:${ownNumber}`, { expandPromptTemplates: true }]]);
		assert.deepEqual(host.notices, []);
	}
});

test("registerOpenShortcut: looks up the current invocation name on every keypress", () => {
	const host = shortcutHost();
	registerOpenShortcut(host.pi, "f2", ROOT_ENTRY);
	for (const name of ["lazy-panel:2", "lazy-panel:3", "lazy-panel"]) {
		host.commands.splice(0, host.commands.length, slashCommand(name, ROOT_ENTRY));
		host.trigger();
	}
	assert.equal(host.queries(), 3);
	assert.deepEqual(host.sent.map(([message]) => message), ["/lazy-panel:2", "/lazy-panel:3", "/lazy-panel"]);
});

test("registerOpenShortcut: missing, foreign, non-extension or ambiguous matches warn without sending", () => {
	const foreignEntry = join(tmpdir(), "other-lazy-panel", "index.ts");
	const cases: SlashCommand[][] = [
		[],
		[slashCommand("lazy-panel", foreignEntry)],
		[slashCommand("lazy-panel:1", foreignEntry), slashCommand("lazy-panel:2", foreignEntry)],
		[slashCommand("lazy-panel", ROOT_ENTRY, "prompt")],
		[slashCommand("lazy-panel:1", ROOT_ENTRY, "skill")],
		[slashCommand("lazy-panel-settings", ROOT_ENTRY)],
		[slashCommand("lazy-panel:other", ROOT_ENTRY)],
		[slashCommand("lazy-panel:1:2", ROOT_ENTRY)],
		[slashCommand("lazy-panel:1", ROOT_ENTRY), slashCommand("lazy-panel:2", ROOT_ENTRY)],
	];
	for (const locale of ["en", "zh"] as const) {
		initI18n(locale);
		for (const commands of cases) {
			const host = shortcutHost();
			host.commands.push(...commands);
			registerOpenShortcut(host.pi, "alt+l", ROOT_ENTRY);
			host.trigger();
			assert.deepEqual(host.sent, []);
			assert.deepEqual(host.notices, [{
				message: translate("notify.openCommandUnavailable", { command: "lazy-panel", path: ROOT_ENTRY }),
				type: "warning",
			}]);
			assert.ok(host.notices[0]!.message.includes("/reload"));
		}
	}
	initI18n("en");
});

test("registerOpenShortcut: unrelated commands do not make the owned command ambiguous", () => {
	const host = shortcutHost();
	host.commands.push(
		slashCommand("lazy-panel", ROOT_ENTRY, "prompt"),
		slashCommand("lazy-panel-settings", ROOT_ENTRY),
		slashCommand("lazy-panel:2", ROOT_ENTRY),
	);
	registerOpenShortcut(host.pi, "alt+l", ROOT_ENTRY);
	host.trigger();
	assert.equal(host.sent[0]![0], "/lazy-panel:2");
	assert.deepEqual(host.notices, []);
});

test("registerOpenShortcut: normalizes symlinks and paths containing spaces", (t) => {
	const dir = tempDir(t);
	const actual = join(dir, "entry with spaces.ts");
	const linked = join(dir, "linked-entry.ts");
	writeFileSync(actual, "", "utf8");
	try {
		symlinkSync(actual, linked, "file");
	} catch (error) {
		if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") {
			t.skip("Creating symlinks requires permission on Windows");
			return;
		}
		throw error;
	}
	for (const [entry, source] of [[linked, actual], [actual, linked]]) {
		const host = shortcutHost();
		host.commands.push(slashCommand("lazy-panel:2", source!));
		registerOpenShortcut(host.pi, "alt+l", entry!);
		host.trigger();
		assert.equal(host.sent[0]![0], "/lazy-panel:2");
		assert.deepEqual(host.notices, []);
	}
});

test("extension factories: root shim and direct source entry resolve only their own commands", (t) => {
	const dir = tempDir(t);
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = dir;
	t.after(() => {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
	});
	for (const [factory, own, other] of [[rootExtension, ROOT_ENTRY, SOURCE_ENTRY], [extension, SOURCE_ENTRY, ROOT_ENTRY]] as const) {
		const host = shortcutHost();
		host.commands.push(slashCommand("lazy-panel:1", other));
		factory({
			...host.pi,
			registerCommand(name, _command) {
				assert.equal(name, "lazy-panel");
				host.commands.push(slashCommand("lazy-panel:2", own));
			},
		} as Parameters<typeof extension>[0]);
		host.trigger();
		assert.deepEqual(host.sent, [["/lazy-panel:2", { expandPromptTemplates: true }]]);
		assert.deepEqual(host.notices, []);
	}
});
