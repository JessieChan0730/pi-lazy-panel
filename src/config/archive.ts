/**
 * Authoritative pin/archive state. Legacy pins are read only until the first
 * successful mutation; all subsequent mutations read the latest state under a
 * cross-process lock and replace both lists in one atomic rename.
 *
 * Locks are deliberately never stolen (age/PID checks cannot prove ownership).
 * After a crash, close all pi processes before manually removing the lock
 * directory named in the timeout error. A crash may also leave an unused .tmp
 * file; it is never read as state. The temporary file is fsynced before rename;
 * directory fsync is not portable, so power-loss durability depends on the OS.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsAsync from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { SessionFileChange, SessionFileState, SessionFileUpdate } from "../types.ts";
import { sessionFileKey } from "../utils/session-file-key.ts";

const STATE_FILE_NAME = "lazy-panel-state.json";
const LEGACY_FILE_NAME = "lazy-panel-pins.json";
const LOCK_TIMEOUT_MS = 5000;
const LOCK_RETRY_MS = 25;

/** Missing files are empty; malformed or unreadable files are never ignored. */
export function loadSessionFileState(agentDir: string): SessionFileState {
	const file = join(agentDir, STATE_FILE_NAME);
	const raw = readOptional(file);
	if (raw !== undefined) {
		const value = parseJson(raw, file);
		if (!isRecord(value) || value.version !== 1) {
			throw new Error(`Invalid session state in ${file}: expected an object with version 1`);
		}
		return normalizeState(parseFiles(value.pinned, file, "pinned"), parseFiles(value.archived, file, "archived"));
	}

	const legacyFile = join(agentDir, LEGACY_FILE_NAME);
	const legacy = readOptional(legacyFile);
	if (legacy === undefined) return { pinned: [], archived: [] };
	const value = parseJson(legacy, legacyFile);
	const pinned = parseFiles(isRecord(value) ? value.pinned : value, legacyFile, "pinned");
	return { pinned, archived: [] };
}

/** Explicit targets and desired state, never a possibly stale UI snapshot. */
export async function updateSessionFileState(agentDir: string, change: SessionFileChange): Promise<SessionFileUpdate> {
	// Capture the request before waiting so caller mutations cannot change it.
	const type = change.type;
	const files = parseFiles(change.files, "session state change", "files");
	const dir = resolve(agentDir);
	const file = join(dir, STATE_FILE_NAME);
	const lock = `${file}.lock`;
	await fsAsync.mkdir(dir, { recursive: true });
	await acquireLock(lock);

	let next: SessionFileState;
	try {
		next = applyChange(loadSessionFileState(dir), { type, files });
		await writeAtomic(file, next);
	} catch (error) {
		try {
			await fsAsync.rmdir(lock);
		} catch (unlockError) {
			throw new AggregateError([error, unlockError], `Session state update failed; also unable to release lock ${lock}`, { cause: unlockError });
		}
		throw error;
	}
	try {
		await fsAsync.rmdir(lock);
	} catch {
		// 提交点已过去：返回新状态和警告，调用方不能再把它当成回滚。
		return { ...next, warning: `Cannot release lock ${lock}; close all pi processes before removing this lock directory` };
	}
	return next;
}

function readOptional(file: string): string | undefined {
	try {
		return fs.readFileSync(file, "utf8");
	} catch (error) {
		if (hasCode(error, "ENOENT")) {
			// A dangling symlink is not an absent state file: do not replace it.
			try {
				fs.lstatSync(file);
			} catch (statError) {
				if (hasCode(statError, "ENOENT")) return undefined;
				throw new Error(`Cannot inspect session state file ${file}`, { cause: statError });
			}
		}
		throw new Error(`Cannot read session state file ${file}`, { cause: error });
	}
}

function parseJson(raw: string, file: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch (error) {
		throw new Error(`Invalid JSON in session state file ${file}`, { cause: error });
	}
}

/** Keep the first absolute spelling and position for each identity. */
function parseFiles(value: unknown, file: string, field: string): string[] {
	if (!Array.isArray(value) || !value.every((item): item is string => typeof item === "string" && item.trim().length > 0 && !item.includes("\0"))) {
		throw new Error(`Invalid ${field} in ${file}: expected an array of non-empty session paths`);
	}
	const seen = new Set<string>();
	const files: string[] = [];
	for (const item of value) {
		const absolute = resolve(item);
		const key = sessionFileKey(absolute);
		if (seen.has(key)) continue;
		seen.add(key);
		files.push(absolute);
	}
	return files;
}

function normalizeState(pinned: string[], archived: string[]): SessionFileState {
	const archiveKeys = new Set(archived.map(sessionFileKey));
	return { pinned: pinned.filter((file) => !archiveKeys.has(sessionFileKey(file))), archived };
}

function applyChange(state: SessionFileState, change: SessionFileChange): SessionFileState {
	const targets = new Set(change.files.map(sessionFileKey));
	const withoutTargets = (files: string[]) => files.filter((file) => !targets.has(sessionFileKey(file)));
	switch (change.type) {
		case "archive": {
			const existing = new Set(state.archived.map(sessionFileKey));
			return {
				pinned: withoutTargets(state.pinned),
				archived: [...state.archived, ...change.files.filter((file) => !existing.has(sessionFileKey(file)))],
			};
		}
		case "unarchive":
			return { pinned: state.pinned, archived: withoutTargets(state.archived) };
		case "pin": {
			const archived = new Set(state.archived.map(sessionFileKey));
			if (change.files.some((file) => archived.has(sessionFileKey(file)))) {
				throw new Error("Cannot pin archived sessions; unarchive them first");
			}
			const existing = new Set(state.pinned.map(sessionFileKey));
			return {
				pinned: [...change.files.filter((file) => !existing.has(sessionFileKey(file))), ...state.pinned],
				archived: state.archived,
			};
		}
		case "unpin":
			return { pinned: withoutTargets(state.pinned), archived: state.archived };
		case "delete":
			return { pinned: withoutTargets(state.pinned), archived: withoutTargets(state.archived) };
		default: {
			const unexpected: never = change.type;
			throw new Error(`Unknown session state change: ${String(unexpected)}`);
		}
	}
}

async function acquireLock(lock: string): Promise<void> {
	const deadline = performance.now() + LOCK_TIMEOUT_MS;
	while (true) {
		try {
			await fsAsync.mkdir(lock);
			return;
		} catch (error) {
			if (!hasCode(error, "EEXIST")) throw new Error(`Cannot acquire session state lock ${lock}`, { cause: error });
		}
		if (performance.now() >= deadline) {
			throw new Error(`Timed out waiting for session state lock ${lock}; another pi process may be updating it. If a process crashed, close all pi processes before removing this lock directory and retrying`);
		}
		await delay(LOCK_RETRY_MS);
	}
}

async function writeAtomic(file: string, state: SessionFileState): Promise<void> {
	const temp = `${file}.${randomUUID()}.tmp`;
	// Open outside the cleanup block: never unlink a file we did not create.
	const handle = await fsAsync.open(temp, "wx", 0o600);
	try {
		try {
			await handle.writeFile(`${JSON.stringify({ version: 1, ...state }, null, 2)}\n`, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		await fsAsync.rename(temp, file);
	} catch (error) {
		try {
			await fsAsync.unlink(temp);
		} catch (cleanupError) {
			if (!hasCode(cleanupError, "ENOENT")) {
				throw new AggregateError([error, cleanupError], `Cannot save session state ${file} or remove temporary file ${temp}`, { cause: cleanupError });
			}
		}
		throw new Error(`Cannot save session state ${file}`, { cause: error });
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}
