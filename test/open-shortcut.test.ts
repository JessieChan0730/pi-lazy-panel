/**
 * pi-level shortcut tests: the synchronous config read used while the extension
 * registers itself, and the registration that re-enters `/lazy-panel`.
 * Run with `npm test` (node --test via tsx).
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { KeyId } from "@earendil-works/pi-tui";
import { loadConfigSync } from "../src/config/config.ts";
import { CONFIG_FILE_NAME, DEFAULT_OPEN_SHORTCUT } from "../src/constants.ts";
import { initI18n } from "../src/i18n/index.ts";
import { registerOpenShortcut, type ShortcutHost } from "../src/index.ts";

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
	const registered: Array<{ key: KeyId; options: Parameters<ShortcutHost["registerShortcut"]>[1] }> = [];
	const sent: Array<Parameters<ShortcutHost["sendUserMessage"]>> = [];
	const pi: ShortcutHost = {
		registerShortcut(key, options) {
			registered.push({ key, options });
		},
		sendUserMessage(...args) {
			sent.push(args);
		},
	};

	registerOpenShortcut(pi, "alt+l");
	assert.equal(registered.length, 1);
	assert.equal(registered[0]!.key, "alt+l");
	assert.ok(registered[0]!.options.description, "pi's shortcut help needs a description");

	// 触发快捷键只走命令路径：命令处理器才拿得到 newSession / switchSession 等会话控制方法。
	registered[0]!.options.handler({} as never);
	assert.equal(sent.length, 1);
	assert.equal(sent[0]![0], "/lazy-panel");
	assert.deepEqual(sent[0]![1], { expandPromptTemplates: true });

	// null（配置里关掉）时不注册。
	registerOpenShortcut(pi, null);
	assert.equal(registered.length, 1);
});
