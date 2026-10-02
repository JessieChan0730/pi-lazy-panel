import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsAsync from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { loadSessionFileState, updateSessionFileState } from "../src/config/archive.ts";
import type { SessionFileState } from "../src/types.ts";
import { sessionFileKey } from "../src/utils/session-file-key.ts";

const STATE_FILE_NAME = "lazy-panel-state.json";
const LEGACY_FILE_NAME = "lazy-panel-pins.json";

function tempDir(t: TestContext): string {
	const dir = fs.mkdtempSync(join(tmpdir(), "lazy-panel-archive-"));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
}

function writeState(dir: string, pinned: string[], archived: string[]): void {
	fs.writeFileSync(join(dir, STATE_FILE_NAME), JSON.stringify({ version: 1, pinned, archived }));
}

function readStored(dir: string): SessionFileState & { version: number } {
	return JSON.parse(fs.readFileSync(join(dir, STATE_FILE_NAME), "utf8")) as SessionFileState & { version: number };
}

function ioError(code: string): NodeJS.ErrnoException {
	return Object.assign(new Error(`Injected filesystem error: ${code}`), { code });
}

function assertOnlyState(dir: string): void {
	assert.deepEqual(fs.readdirSync(dir), [STATE_FILE_NAME], "no lock or temporary files remain");
}

function runChild(t: TestContext, dir: string, prefix: string, count: number): Promise<void> {
	const moduleUrl = new URL("../src/config/archive.ts", import.meta.url).href;
	const files = Array.from({ length: count }, (_, i) => join(dir, `${prefix}-${i}.jsonl`));
	const script = `
		import { updateSessionFileState } from ${JSON.stringify(moduleUrl)};
		await Promise.all(${JSON.stringify(files)}.map(file =>
			updateSessionFileState(${JSON.stringify(dir)}, {type: 'pin', files: [file]})
		));
	`;
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
			stdio: ["ignore", "ignore", "pipe"],
		});
		t.after(() => {
			if (child.exitCode === null && child.signalCode === null) child.kill();
		});
		let stderr = "";
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.once("error", reject);
		child.once("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`Child writer exited ${String(code)}: ${stderr}`));
		});
	});
}

test("missing state loads empty without writes; mutations create the directory and round-trip both lists", async (t) => {
	const dir = join(tempDir(t), "new-agent-dir");
	assert.deepEqual(loadSessionFileState(dir), { pinned: [], archived: [] });
	assert.equal(fs.existsSync(dir), false);
	const a = join(dir, "a.jsonl");
	const b = join(dir, "b.jsonl");
	assert.deepEqual(await updateSessionFileState(dir, { type: "pin", files: [a] }), { pinned: [a], archived: [] });
	assert.deepEqual(await updateSessionFileState(dir, { type: "archive", files: [b] }), { pinned: [a], archived: [b] });
	assert.deepEqual(readStored(dir), { version: 1, pinned: [a], archived: [b] });
	assert.deepEqual(loadSessionFileState(dir), { pinned: [a], archived: [b] });
	assert.equal(fs.existsSync(a), false, "nonexistent/inaccessible sessions are not pruned");
	assertOnlyState(dir);
});

test("legacy arrays and objects preserve order and remain untouched until and after migration", async (t) => {
	for (const bareArray of [true, false]) {
		const dir = tempDir(t);
		const a = join(dir, "A.jsonl");
		const b = join(dir, "B.jsonl");
		const c = join(dir, "C.jsonl");
		const pins = [b, a, b, join(dir, "sub", "..", "A.jsonl")];
		const legacy = JSON.stringify(bareArray ? pins : { pinned: pins }, null, 2);
		fs.writeFileSync(join(dir, LEGACY_FILE_NAME), legacy);
		assert.deepEqual(loadSessionFileState(dir), { pinned: [b, a], archived: [] });
		assert.equal(fs.existsSync(join(dir, STATE_FILE_NAME)), false, "reading does not migrate");
		assert.deepEqual(await updateSessionFileState(dir, { type: "pin", files: [c] }), { pinned: [c, b, a], archived: [] });
		assert.equal(fs.readFileSync(join(dir, LEGACY_FILE_NAME), "utf8"), legacy);
		assert.deepEqual(readStored(dir), { version: 1, pinned: [c, b, a], archived: [] });
	}
});

test("the new file is authoritative even if legacy pins are corrupt or later modified", async (t) => {
	const dir = tempDir(t);
	const archived = join(dir, "old-pin.jsonl");
	writeState(dir, [], [archived]);
	fs.writeFileSync(join(dir, LEGACY_FILE_NAME), "{ corrupt legacy");
	assert.deepEqual(loadSessionFileState(dir), { pinned: [], archived: [archived] });
	fs.writeFileSync(join(dir, LEGACY_FILE_NAME), JSON.stringify([archived]));
	await updateSessionFileState(dir, { type: "unarchive", files: [archived] });
	assert.deepEqual(loadSessionFileState(dir), { pinned: [], archived: [] }, "legacy pins cannot resurrect");
});

test("corrupt new files are preserved and never fall back to valid legacy pins", async (t) => {
	const invalid = ["{ bad JSON", "null", "[]", "{}", '{"version":2,"pinned":[],"archived":[]}',
		'{"version":1,"pinned":[],"archived":[42]}', '{"version":1,"pinned":[""],"archived":[]}',
		'{"version":1,"pinned":[],"archived":["\\u0000"]}', '{"version":1,"pinned":[]}'];
	for (const raw of invalid) {
		const dir = tempDir(t);
		const file = join(dir, STATE_FILE_NAME);
		fs.writeFileSync(file, raw);
		fs.writeFileSync(join(dir, LEGACY_FILE_NAME), JSON.stringify([join(dir, "a.jsonl")]));
		assert.throws(() => loadSessionFileState(dir), /Invalid/);
		await assert.rejects(updateSessionFileState(dir, { type: "pin", files: [join(dir, "b.jsonl")] }), /Invalid/);
		assert.equal(fs.readFileSync(file, "utf8"), raw);
		assert.deepEqual(fs.readdirSync(dir).sort(), [LEGACY_FILE_NAME, STATE_FILE_NAME].sort());
	}
});

test("invalid legacy JSON, shape, and entries fail migration rather than silently dropping data", async (t) => {
	for (const raw of ["{ bad JSON", "null", "{}", "42", '["valid",42]', '[" "]', '{"pinned":"not an array"}']) {
		const dir = tempDir(t);
		const file = join(dir, LEGACY_FILE_NAME);
		fs.writeFileSync(file, raw);
		assert.throws(() => loadSessionFileState(dir), /Invalid/);
		await assert.rejects(updateSessionFileState(dir, { type: "archive", files: [join(dir, "a.jsonl")] }), /Invalid/);
		assert.equal(fs.readFileSync(file, "utf8"), raw);
		assert.deepEqual(fs.readdirSync(dir), [LEGACY_FILE_NAME]);
	}
});

test("identity resolves paths, uses Windows case-insensitivity only on Windows, and preserves first spelling", async (t) => {
	const dir = tempDir(t);
	const first = join(dir, "A.jsonl");
	const alias = `${dir}/sub/../A.jsonl`;
	const lower = join(dir, "a.jsonl");
	assert.equal(sessionFileKey(alias), sessionFileKey(first));
	assert.equal(sessionFileKey("./session.jsonl"), sessionFileKey(resolve("session.jsonl")));
	assert.equal(sessionFileKey(first) === sessionFileKey(lower), process.platform === "win32");
	if (process.platform === "win32") {
		assert.equal(sessionFileKey("C:\\Sessions\\A.jsonl"), sessionFileKey("c:/sessions/a.jsonl"));
		assert.equal(sessionFileKey("\\\\SERVER\\Share\\A.jsonl"), sessionFileKey("//server/share/a.jsonl"));
	}
	const expected = process.platform === "win32" ? [first] : [first, lower];
	await updateSessionFileState(dir, { type: "pin", files: [first, alias, lower] });
	assert.deepEqual(loadSessionFileState(dir).pinned, expected);
	await updateSessionFileState(dir, { type: "archive", files: [alias, first] });
	assert.deepEqual(loadSessionFileState(dir), { pinned: expected.filter((file) => file !== first), archived: [first] });
});

test("loads deduplicate deterministically and archive membership overrides conflicting pins without writing", (t) => {
	const dir = tempDir(t);
	const a = join(dir, "a.jsonl");
	const b = join(dir, "b.jsonl");
	writeState(dir, [a, b, b], [a, `${dir}/./a.jsonl`, a]);
	const before = fs.readFileSync(join(dir, STATE_FILE_NAME), "utf8");
	assert.deepEqual(loadSessionFileState(dir), { pinned: [b], archived: [a] });
	assert.equal(fs.readFileSync(join(dir, STATE_FILE_NAME), "utf8"), before);
});

test("pin prepends only new targets; each desired-state mutation is idempotent", async (t) => {
	const dir = tempDir(t);
	const a = join(dir, "a.jsonl");
	const b = join(dir, "b.jsonl");
	const c = join(dir, "c.jsonl");
	await updateSessionFileState(dir, { type: "pin", files: [a, b] });
	assert.deepEqual(await updateSessionFileState(dir, { type: "pin", files: [b, c, a, c] }), { pinned: [c, a, b], archived: [] });
	for (const type of ["pin", "archive", "unpin", "unarchive", "delete"] as const) {
		const first = await updateSessionFileState(dir, { type, files: [a, b] });
		const bytes = fs.readFileSync(join(dir, STATE_FILE_NAME), "utf8");
		assert.deepEqual(await updateSessionFileState(dir, { type, files: [a, b] }), first);
		assert.equal(fs.readFileSync(join(dir, STATE_FILE_NAME), "utf8"), bytes);
	}
	assert.deepEqual(loadSessionFileState(dir), { pinned: [c], archived: [] });
});

test("archive unpins in the same atomic rename; unarchive does not restore the old pin", async (t) => {
	const dir = tempDir(t);
	const a = join(dir, "a.jsonl");
	const b = join(dir, "b.jsonl");
	writeState(dir, [a, b], []);
	const originalRename = fsAsync.rename;
	const rename = t.mock.method(fsAsync, "rename", async (from: string, to: string) => {
		assert.equal(to, join(dir, STATE_FILE_NAME));
		assert.deepEqual(loadSessionFileState(dir), { pinned: [a, b], archived: [] });
		assert.deepEqual(JSON.parse(fs.readFileSync(from, "utf8")), { version: 1, pinned: [b], archived: [a] });
		await originalRename(from, to);
		assert.deepEqual(loadSessionFileState(dir), { pinned: [b], archived: [a] });
	});
	await updateSessionFileState(dir, { type: "archive", files: [a] });
	assert.equal(rename.mock.callCount(), 1, "both fields share one commit point");
	rename.mock.restore();
	assert.deepEqual(await updateSessionFileState(dir, { type: "unarchive", files: [a] }), { pinned: [b], archived: [] });
	assertOnlyState(dir);
});

test("a mixed pin batch with any archived target rejects entirely and leaves bytes unchanged", async (t) => {
	const dir = tempDir(t);
	const a = join(dir, "a.jsonl");
	const b = join(dir, "b.jsonl");
	writeState(dir, [], [a]);
	const before = fs.readFileSync(join(dir, STATE_FILE_NAME), "utf8");
	await assert.rejects(updateSessionFileState(dir, { type: "pin", files: [b, a] }), /Cannot pin archived sessions/);
	assert.equal(fs.readFileSync(join(dir, STATE_FILE_NAME), "utf8"), before);
	assertOnlyState(dir);
});

test("unpin preserves archives and explicit deletion removes both memberships without touching sessions", async (t) => {
	const dir = tempDir(t);
	const a = join(dir, "a.jsonl");
	const b = join(dir, "b.jsonl");
	const c = join(dir, "c.jsonl");
	fs.writeFileSync(a, "session data");
	writeState(dir, [b], [a, c]);
	assert.deepEqual(await updateSessionFileState(dir, { type: "unpin", files: [a, b] }), { pinned: [], archived: [a, c] });
	await updateSessionFileState(dir, { type: "pin", files: [b] });
	assert.deepEqual(await updateSessionFileState(dir, { type: "delete", files: [a, b] }), { pinned: [], archived: [c] });
	assert.equal(fs.readFileSync(a, "utf8"), "session data");
});

test("simultaneous updates read latest state inside the lock and capture caller targets before waiting", async (t) => {
	const dir = tempDir(t);
	const files = Array.from({ length: 15 }, (_, i) => join(dir, `${i}.jsonl`));
	const requests = files.map((file) => updateSessionFileState(dir, { type: "pin", files: [file] }));
	const mutable = [join(dir, "captured.jsonl")];
	const request = updateSessionFileState(dir, { type: "archive", files: mutable });
	mutable[0] = join(dir, "changed-after-request.jsonl");
	await Promise.all([...requests, request]);
	const state = loadSessionFileState(dir);
	assert.deepEqual([...state.pinned].sort(), [...files].sort());
	assert.deepEqual(state.archived, [join(dir, "captured.jsonl")]);
	assertOnlyState(dir);
});

test("competing pin and archive requests cannot leave an archived session pinned", async (t) => {
	const dir = tempDir(t);
	const file = join(dir, "a.jsonl");
	const results = await Promise.allSettled([
		updateSessionFileState(dir, { type: "pin", files: [file] }),
		updateSessionFileState(dir, { type: "archive", files: [file] }),
	]);
	assert.equal(results[1]?.status, "fulfilled");
	if (results[0]?.status === "rejected") assert.match(String(results[0].reason), /Cannot pin archived sessions/);
	assert.deepEqual(loadSessionFileState(dir), { pinned: [], archived: [file] });
	assertOnlyState(dir);
});

test("independent child processes and this process cannot overwrite each other's updates", { timeout: 20000 }, async (t) => {
	const dir = tempDir(t);
	const count = 8;
	await Promise.all([
		...Array.from({ length: 4 }, (_, i) => runChild(t, dir, `child-${i}`, count)),
		...Array.from({ length: count }, (_, i) => updateSessionFileState(dir, { type: "archive", files: [join(dir, `parent-${i}.jsonl`)] })),
	]);
	const state = loadSessionFileState(dir);
	const expectedPins = Array.from({ length: 4 }, (_, child) => Array.from({ length: count }, (_, i) => join(dir, `child-${child}-${i}.jsonl`))).flat();
	assert.deepEqual([...state.pinned].sort(), expectedPins.sort());
	assert.deepEqual([...state.archived].sort(), Array.from({ length: count }, (_, i) => join(dir, `parent-${i}.jsonl`)).sort());
	assertOnlyState(dir);
});

test("read permission failures throw without falling back, migrating, or altering existing state", async (t) => {
	const dir = tempDir(t);
	const file = join(dir, STATE_FILE_NAME);
	writeState(dir, [join(dir, "a.jsonl")], []);
	const before = fs.readFileSync(file, "utf8");
	fs.writeFileSync(join(dir, LEGACY_FILE_NAME), "[]");
	const originalRead = fs.readFileSync;
	const read = t.mock.method(fs, "readFileSync", (...args: unknown[]) => {
		if (args[0] === file) throw ioError("EACCES");
		return Reflect.apply(originalRead, fs, args);
	});
	assert.throws(() => loadSessionFileState(dir), /Cannot read session state/);
	await assert.rejects(updateSessionFileState(dir, { type: "archive", files: [join(dir, "a.jsonl")] }), /Cannot read session state/);
	read.mock.restore();
	assert.equal(fs.readFileSync(file, "utf8"), before);
	assert.deepEqual(fs.readdirSync(dir).sort(), [LEGACY_FILE_NAME, STATE_FILE_NAME].sort());
});

test("a directory at the authoritative path is an error, not missing state", async (t) => {
	const dir = tempDir(t);
	fs.mkdirSync(join(dir, STATE_FILE_NAME));
	fs.writeFileSync(join(dir, LEGACY_FILE_NAME), "[]");
	assert.throws(() => loadSessionFileState(dir), /Cannot read session state/);
	await assert.rejects(updateSessionFileState(dir, { type: "pin", files: [join(dir, "a.jsonl")] }), /Cannot read session state/);
	assert.equal(fs.statSync(join(dir, STATE_FILE_NAME)).isDirectory(), true);
});

test("temporary-file creation permission errors preserve legacy state and do not migrate", async (t) => {
	const dir = tempDir(t);
	const legacy = JSON.stringify([join(dir, "a.jsonl")]);
	fs.writeFileSync(join(dir, LEGACY_FILE_NAME), legacy);
	t.mock.method(fsAsync, "open", async () => {
		throw ioError("EACCES");
	});
	await assert.rejects(updateSessionFileState(dir, { type: "archive", files: [join(dir, "a.jsonl")] }), { code: "EACCES" });
	assert.equal(fs.readFileSync(join(dir, LEGACY_FILE_NAME), "utf8"), legacy);
	assert.deepEqual(fs.readdirSync(dir), [LEGACY_FILE_NAME]);
});

for (const failure of ["writeFile", "sync", "rename"] as const) {
	test(`${failure} failures leave old state intact and remove temporary files and locks`, async (t) => {
		const dir = tempDir(t);
		const a = join(dir, "a.jsonl");
		writeState(dir, [a], []);
		const before = fs.readFileSync(join(dir, STATE_FILE_NAME), "utf8");
		if (failure === "rename") {
			t.mock.method(fsAsync, "rename", async () => {
				throw ioError("EPERM");
			});
		} else {
			const originalOpen = fsAsync.open;
			t.mock.method(fsAsync, "open", async (...args: Parameters<typeof fsAsync.open>) => {
				const handle = await originalOpen(...args);
				t.mock.method(handle, failure, async () => {
					throw ioError("ENOSPC");
				});
				return handle;
			});
		}
		await assert.rejects(updateSessionFileState(dir, { type: "archive", files: [a] }), /Cannot save session state/);
		assert.equal(fs.readFileSync(join(dir, STATE_FILE_NAME), "utf8"), before);
		assert.deepEqual(loadSessionFileState(dir), { pinned: [a], archived: [] });
		assertOnlyState(dir);
	});
}

test("lock acquisition permission errors never write state", async (t) => {
	const dir = tempDir(t);
	writeState(dir, [], []);
	const before = fs.readFileSync(join(dir, STATE_FILE_NAME), "utf8");
	const originalMkdir = fsAsync.mkdir;
	t.mock.method(fsAsync, "mkdir", (...args: unknown[]) => {
		if (String(args[0]).endsWith(".lock")) return Promise.reject(ioError("EACCES"));
		return Reflect.apply(originalMkdir, fsAsync, args);
	});
	await assert.rejects(updateSessionFileState(dir, { type: "pin", files: [join(dir, "a.jsonl")] }), /Cannot acquire session state lock/);
	assert.equal(fs.readFileSync(join(dir, STATE_FILE_NAME), "utf8"), before);
	assertOnlyState(dir);
});

test("an old or live lock is never stolen; bounded timeout names the recovery path and preserves state", { timeout: 10000 }, async (t) => {
	const dir = tempDir(t);
	const file = join(dir, STATE_FILE_NAME);
	const lock = `${file}.lock`;
	writeState(dir, [], []);
	const before = fs.readFileSync(file, "utf8");
	fs.mkdirSync(lock);
	fs.writeFileSync(join(lock, "owner"), String(process.pid));
	fs.utimesSync(lock, new Date(0), new Date(0));
	const started = performance.now();
	await assert.rejects(updateSessionFileState(dir, { type: "pin", files: [join(dir, "a.jsonl")] }), (error: unknown) => {
		assert.ok(error instanceof Error);
		assert.ok(error.message.includes(lock));
		assert.match(error.message, /Timed out.*close all pi processes/);
		return true;
	});
	assert.ok(performance.now() - started < 9000, "lock wait is bounded");
	assert.equal(fs.readFileSync(join(lock, "owner"), "utf8"), String(process.pid));
	assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("unlock failure after rename explicitly reports that the state was saved", async (t) => {
	const dir = tempDir(t);
	writeState(dir, [], []);
	t.mock.method(fsAsync, "rmdir", async () => {
		throw ioError("EACCES");
	});
	const a = join(dir, "a.jsonl");
	const result = await updateSessionFileState(dir, { type: "pin", files: [a] });
	assert.deepEqual(result.pinned, [a]);
	assert.match(result.warning ?? "", /Cannot release lock.*close all pi processes/);
	assert.deepEqual(loadSessionFileState(dir), { pinned: [a], archived: [] });
	assert.equal(fs.existsSync(`${join(dir, STATE_FILE_NAME)}.lock`), true);
});
