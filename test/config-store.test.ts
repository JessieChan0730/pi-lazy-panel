import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { SettingsPatch } from "../src/config/config-store.ts";
import { readSnapshot, savePatch } from "../src/config/config-store.ts";
import { readConfigSnapshot, saveConfigPatch } from "../src/config/config.ts";

async function fixture(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
	const dir = await fs.mkdtemp(join(tmpdir(), "config-store-"));
	t.after(() => fs.rm(dir, { recursive: true, force: true }));
	return join(dir, "lazy-panel.json");
}

/** 系统不允许建链接时的 errno（Windows 未开开发者模式 / 非管理员是 EPERM，不支持链接的文件系统是 UNKNOWN）。 */
const SYMLINK_UNAVAILABLE = ["EPERM", "EACCES", "ENOSYS", "UNKNOWN"];

function isSymlinkUnavailable(error: unknown): error is Error & { code: string } {
	return error instanceof Error && "code" in error && SYMLINK_UNAVAILABLE.includes(String(error.code));
}

/**
 * 建一个真链接；这台机器不允许时把调用方这条测试标成跳过（CI 是 ubuntu，真链接照旧全覆盖）。
 * 返回 false 时调用方必须立刻 `return` —— `t.skip()` 只打标记，不中断执行。
 * 显式传 "file"：不给类型时 Windows 得自己判断目标是文件还是目录，悬空链接那条就可能报 UNKNOWN。
 */
async function symlinkOrSkip(t: { skip: (message?: string) => void }, target: string, link: string): Promise<boolean> {
	try {
		await fs.symlink(target, link, "file");
		return true;
	} catch (error) {
		if (!isSymlinkUnavailable(error)) throw error;
		t.skip(`symlinks are not available on this system (${error.code})`);
		return false;
	}
}

test("snapshot missing, first save, wrappers and reset preserve unrelated raw fields", async (t) => {
	const file = await fixture(t);
	const dir = join(file, "..");
	const baseline = await readConfigSnapshot(dir);
	assert.deepEqual(baseline, { raw: {}, fingerprint: null });
	const saved = await saveConfigPatch(dir, baseline, { locale: "zh", defaultScope: "all", defaultSort: "threaded" });
	assert.deepEqual(saved.snapshot, await readSnapshot(file));
	const raw = { ...saved.snapshot.raw, keymap: { global: { quit: null } }, unknown: { nested: [1, true] }, leftColumnRatio: 0.4 };
	await fs.writeFile(file, JSON.stringify(raw));
	const reset = await savePatch(file, saved.snapshot, { locale: null, defaultScope: null, defaultSort: null });
	assert.deepEqual(reset.snapshot.raw, { keymap: raw.keymap, unknown: raw.unknown, leftColumnRatio: 0.4 });
});

test("no-op preserves exact bytes and missing file stays missing", async (t) => {
	const file = await fixture(t);
	const missing = await readSnapshot(file);
	assert.deepEqual((await savePatch(file, missing, { locale: null })).snapshot, missing);
	await assert.rejects(fs.stat(file), { code: "ENOENT" });
	const text = '{ "locale" : "zh", "unknown": 1 }';
	await fs.writeFile(file, text);
	const baseline = await readSnapshot(file);
	await savePatch(file, baseline, { locale: "zh" }, {
		io: { open: async () => { throw new Error("must not write"); } },
	});
	assert.equal(await fs.readFile(file, "utf8"), text);
});

test("a symlinked config is written through the link: the target changes, the link stays", async (t) => {
	const root = await fs.mkdtemp(join(tmpdir(), "config-store-link-"));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	// dotfiles 布局：~/.pi/agent/lazy-panel.json 链到仓库里那份。
	const target = join(root, "dotfiles", "lazy-panel.json");
	const link = join(root, "agent", "lazy-panel.json");
	await fs.mkdir(join(root, "dotfiles"));
	await fs.mkdir(join(root, "agent"));
	await fs.writeFile(target, '{ "defaultSort": "recent" }\n');
	await fs.chmod(target, 0o640);
	// 记录改前的权限位再比：Windows 上 chmod 只动只读位（0o640 读回来是 0o666），
	// 断言"保存没改动权限"才是跨平台的，POSIX 上照样抓得到把 0640 写成 0600 的回归。
	const modeBefore = (await fs.stat(target)).mode & 0o777;
	if (!await symlinkOrSkip(t, target, link)) return;
	await savePatch(link, await readSnapshot(link), { defaultSort: "title" });
	// 链接没被换掉：仓库里那份仍然是 pi 读的那个文件。
	assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
	assert.equal(await fs.readlink(link), target);
	assert.deepEqual(JSON.parse(await fs.readFile(target, "utf8")), { defaultSort: "title" });
	// 权限位沿用原文件，仓库里不该因为面板保存多出一条 mode 变更。
	assert.equal((await fs.stat(target)).mode & 0o777, modeBefore);
	// 临时文件和锁都落在真身这一侧，两边都不留残留。
	assert.deepEqual(await fs.readdir(join(root, "agent")), ["lazy-panel.json"]);
	assert.deepEqual(await fs.readdir(join(root, "dotfiles")), ["lazy-panel.json"]);
});

test("a chain of links is followed to its end", async (t) => {
	const root = await fs.mkdtemp(join(tmpdir(), "config-store-chain-"));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const target = join(root, "real.json");
	const mid = join(root, "mid.json");
	const link = join(root, "lazy-panel.json");
	await fs.writeFile(target, "{}");
	if (!await symlinkOrSkip(t, target, mid)) return;
	if (!await symlinkOrSkip(t, mid, link)) return;
	await savePatch(link, await readSnapshot(link), { locale: "zh" });
	assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
	assert.equal((await fs.lstat(mid)).isSymbolicLink(), true);
	assert.deepEqual(JSON.parse(await fs.readFile(target, "utf8")), { locale: "zh" });
});

test("a dangling link reads as a missing config and saving creates the file it points at", async (t) => {
	const root = await fs.mkdtemp(join(tmpdir(), "config-store-dangling-"));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const link = join(root, "agent", "lazy-panel.json");
	const target = join(root, "dotfiles", "lazy-panel.json");
	await fs.mkdir(join(root, "agent"));
	if (!await symlinkOrSkip(t, target, link)) return;
	assert.deepEqual(await readSnapshot(link), { raw: {}, fingerprint: null });
	const saved = await savePatch(link, { raw: {}, fingerprint: null }, { locale: "zh" });
	assert.deepEqual(saved.snapshot.raw, { locale: "zh" });
	// 链接留着，目标（连同目录）被建出来，链接从此可用。
	assert.equal((await fs.lstat(link)).isSymbolicLink(), true);
	assert.deepEqual(JSON.parse(await fs.readFile(target, "utf8")), { locale: "zh" });
	assert.deepEqual(await fs.readdir(join(root, "agent")), ["lazy-panel.json"]);
});

test("a path that is not a link is written as given", async (t) => {
	const file = await fixture(t);
	await fs.writeFile(file, '{ "locale": "zh" }');
	const notALink = {
		realpath: async () => { throw new Error("cannot resolve"); },
		readlink: async () => { throw new Error("not a link"); },
	};
	await savePatch(file, await readSnapshot(file), { locale: "en" }, { io: notALink });
	assert.deepEqual(JSON.parse(await fs.readFile(file, "utf8")), { locale: "en" });
});

test("malformed, non-object and unreadable config cannot be saved", async (t) => {
	const file = await fixture(t);
	for (const text of ["{", "null", "[]", "42"]) {
		await fs.writeFile(file, text);
		await assert.rejects(readSnapshot(file), /Invalid/);
		await assert.rejects(savePatch(file, { raw: {}, fingerprint: null }, { locale: "en" }), /Invalid/);
		assert.equal(await fs.readFile(file, "utf8"), text);
	}
	await fs.unlink(file);
	await fs.mkdir(file);
	await assert.rejects(readSnapshot(file), /Cannot read/);
	await assert.rejects(savePatch(file, { raw: {}, fingerprint: null }, { locale: "en" }), /Cannot read/);
	assert.equal((await fs.stat(file)).isDirectory(), true);
	assert.deepEqual(await fs.readdir(join(file, "..")), ["lazy-panel.json"]);
});

test("concurrent disjoint patches merge, conflicting fields reject, same intent converges", async (t) => {
	const file = await fixture(t);
	const baseline = await readSnapshot(file);
	await Promise.all([
		savePatch(file, baseline, { locale: "zh" }),
		savePatch(file, baseline, { defaultSort: "created" }),
	]);
	assert.deepEqual((await readSnapshot(file)).raw, { locale: "zh", defaultSort: "created" });
	await assert.rejects(savePatch(file, baseline, { locale: "en" }), /conflict in locale/);
	await assert.rejects(savePatch(file, baseline, { locale: null }), /conflict in locale/);
	await savePatch(file, baseline, { locale: "zh" });
});

test("three-way equality compares invalid raw objects structurally", async (t) => {
	const file = await fixture(t);
	await fs.writeFile(file, '{"locale":{"invalid":true}}');
	const baseline = await readSnapshot(file);
	await fs.writeFile(file, '{"locale":{"invalid":true},"new":1}');
	assert.deepEqual((await savePatch(file, baseline, { locale: "en" })).snapshot.raw, { locale: "en", new: 1 });
});

test("invalid patch fields and values are rejected before I/O", async (t) => {
	const file = await fixture(t);
	for (const patch of [{ keymap: { nope: {} } }, { keymap: { global: { help: { set: [""] } } } }, { locale: "auto" }, { defaultSort: undefined }, { leftColumnRatio: 0.9 }, { leftColumnRatio: "0.3" }]) {
		await assert.rejects(savePatch(file, { raw: {}, fingerprint: null }, patch as SettingsPatch), /Invalid settings patch/);
	}
	// leftColumnRatio 在合法区间内可写入（null 清除、数字落盘）。
	const saved = await savePatch(file, { raw: {}, fingerprint: null }, { leftColumnRatio: 0.4 });
	assert.equal(saved.snapshot.raw.leftColumnRatio, 0.4);
});

test("rename and write failures preserve original and remove temporary files", async (t) => {
	const file = await fixture(t);
	await fs.writeFile(file, "{}");
	const baseline = await readSnapshot(file);
	await assert.rejects(savePatch(file, baseline, { locale: "zh" }, {
		io: { rename: async () => { throw new Error("rename failed"); } },
	}), /rename failed/);
	await assert.rejects(savePatch(file, baseline, { locale: "zh" }, {
		io: { open: async () => { throw new Error("open failed"); } },
	}), /open failed/);
	for (const operation of ["writeFile", "sync"] as const) {
		await assert.rejects(savePatch(file, baseline, { locale: "zh" }, {
			io: {
				open: async (...args) => {
					const handle = await fs.open(...args);
					handle[operation] = async () => {
						throw new Error(`${operation} failed`);
					};
					return handle;
				},
			},
		}), new RegExp(`${operation} failed`));
	}
	assert.equal(await fs.readFile(file, "utf8"), "{}");
	assert.deepEqual(await fs.readdir(join(file, "..")), ["lazy-panel.json"]);
});

test("fingerprint recheck rejects an external edit during temporary write", async (t) => {
	const file = await fixture(t);
	await fs.writeFile(file, "{}");
	const baseline = await readSnapshot(file);
	await assert.rejects(savePatch(file, baseline, { locale: "zh" }, {
		io: {
			open: async (...args) => {
				const handle = await fs.open(...args);
				await fs.writeFile(file, '{"external":true}');
				return handle;
			},
		},
	}), /changed before commit/);
	assert.deepEqual((await readSnapshot(file)).raw, { external: true });
	assert.deepEqual(await fs.readdir(join(file, "..")), ["lazy-panel.json"]);
});

test("unlock failure after commit returns saved snapshot and warning", async (t) => {
	const file = await fixture(t);
	const result = await savePatch(file, await readSnapshot(file), { locale: "en" }, {
		io: { rmdir: async () => { throw new Error("unlock failed"); } },
	});
	assert.deepEqual(result.snapshot, await readSnapshot(file));
	assert.equal(result.warnings.length, 1);
	assert.match(result.warnings[0]!, /Cannot release config lock/);
});

test("existing cross-process lock times out without deleting its owner lock", async (t) => {
	const file = await fixture(t);
	await fs.mkdir(`${file}.lock`);
	await assert.rejects(savePatch(file, await readSnapshot(file), { locale: "en" }, { lockTimeoutMs: 0 }), /Timed out/);
	assert.equal((await fs.stat(`${file}.lock`)).isDirectory(), true);
});

test("keymap edits write set / unbind / reset and drop empty scopes", async (t) => {
	const file = await fixture(t);
	// set: single chord written as a string, multiple as an array.
	const first = await savePatch(file, await readSnapshot(file), {
		keymap: { sessions: { "session-delete": { set: ["ctrl+d"] }, "move-down": { set: ["j", "down"] } } },
	});
	assert.deepEqual(first.snapshot.raw.keymap, { sessions: { "session-delete": "ctrl+d", "move-down": ["j", "down"] } });
	// unbind writes null; reset deletes the key; the now-empty scope is dropped.
	const second = await savePatch(file, first.snapshot, {
		keymap: { sessions: { "session-delete": { unbind: true }, "move-down": { reset: true } } },
	});
	assert.deepEqual(second.snapshot.raw.keymap, { sessions: { "session-delete": null } });
	const third = await savePatch(file, second.snapshot, { keymap: { sessions: { "session-delete": { reset: true } } } });
	assert.equal(third.snapshot.raw.keymap, undefined);
});

test("keymap conflict only when another writer changed the same binding", async (t) => {
	const file = await fixture(t);
	const base = (await savePatch(file, await readSnapshot(file), { keymap: { tree: { "tree-copy": { set: ["y"] } } } })).snapshot;
	// External edit to a different binding does not conflict.
	await fs.writeFile(file, JSON.stringify({ keymap: { tree: { "tree-copy": "y", "tree-fold": "z" } } }));
	const ok = await savePatch(file, base, { keymap: { tree: { "tree-copy": { set: ["c"] } } } });
	assert.deepEqual(ok.snapshot.raw.keymap, { tree: { "tree-copy": "c", "tree-fold": "z" } });
	// External edit to the same binding conflicts.
	await fs.writeFile(file, JSON.stringify({ keymap: { tree: { "tree-copy": "x" } } }));
	await assert.rejects(savePatch(file, base, { keymap: { tree: { "tree-copy": { set: ["c"] } } } }), /Config conflict in keymap\.tree\.tree-copy/);
});
