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
	for (const patch of [{ keymap: {} }, { locale: "auto" }, { defaultSort: undefined }, { leftColumnRatio: 0.9 }, { leftColumnRatio: "0.3" }]) {
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
