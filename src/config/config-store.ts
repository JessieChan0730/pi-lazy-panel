import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";

export interface ConfigSnapshot {
	raw: Record<string, unknown>;
	/** Hash of the exact file bytes; null means the file did not exist. */
	fingerprint: string | null;
}

export interface GeneralSettingsPatch {
	locale?: "en" | "zh" | null;
	defaultScope?: "all" | "current-folder" | null;
	defaultSort?: "recent" | "created" | "title" | "threaded" | null;
}

export interface ConfigSaveResult {
	snapshot: ConfigSnapshot;
	warnings: string[];
}

/** File-operation seam for deterministic failure tests; normal callers omit it. */
export interface ConfigStoreOptions {
	io?: Partial<Pick<typeof fs, "open" | "rename" | "unlink" | "rmdir" | "mkdir">>;
	lockTimeoutMs?: number;
}

const FIELD_VALUES = {
	locale: ["en", "zh"],
	defaultScope: ["all", "current-folder"],
	defaultSort: ["recent", "created", "title", "threaded"],
} satisfies Record<keyof GeneralSettingsPatch, string[]>;

/** Unlike loadConfig, this never converts a broken file to writable defaults. */
export async function readSnapshot(file: string): Promise<ConfigSnapshot> {
	let bytes: Buffer;
	try {
		bytes = await fs.readFile(file);
	} catch (error) {
		if (hasCode(error, "ENOENT")) {
			try {
				await fs.lstat(file);
			} catch (statError) {
				if (hasCode(statError, "ENOENT")) return { raw: {}, fingerprint: null };
				throw new Error(`Cannot inspect config ${file}`, { cause: statError });
			}
		}
		throw new Error(`Cannot read config ${file}`, { cause: error });
	}
	let raw: unknown;
	try {
		raw = JSON.parse(bytes.toString("utf8")) as unknown;
	} catch (error) {
		throw new Error(`Invalid JSON in config ${file}`, { cause: error });
	}
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new Error(`Invalid config ${file}: top level must be an object`);
	}
	return { raw: raw as Record<string, unknown>, fingerprint: fingerprint(bytes) };
}

export async function savePatch(file: string, baseline: ConfigSnapshot, patch: GeneralSettingsPatch, options: ConfigStoreOptions = {}): Promise<ConfigSaveResult> {
	// Capture inputs before waiting for other processes; do not retain mutable UI state.
	const base = structuredClone(baseline);
	const changes = { ...patch };
	validatePatch(changes);
	file = resolve(file);
	const io = { ...fs, ...options.io };
	const lock = `${file}.lock`;
	await io.mkdir(dirname(file), { recursive: true });
	const deadline = performance.now() + (options.lockTimeoutMs ?? 5000);
	while (true) {
		try {
			await io.mkdir(lock);
			break;
		} catch (error) {
			if (!hasCode(error, "EEXIST")) throw new Error(`Cannot acquire config lock ${lock}`, { cause: error });
		}
		if (performance.now() >= deadline) {
			throw new Error(`Timed out waiting for config lock ${lock}; close all pi processes before removing a stale lock directory`);
		}
		await delay(25);
	}

	let snapshot: ConfigSnapshot;
	try {
		const latest = await readSnapshot(file);
		const raw = { ...latest.raw };
		for (const field of Object.keys(changes) as (keyof GeneralSettingsPatch)[]) {
			const desired = changes[field];
			const sameDesired = desired === null ? !Object.hasOwn(latest.raw, field) : latest.raw[field] === desired;
			const sameBase = Object.hasOwn(base.raw, field) === Object.hasOwn(latest.raw, field) &&
				isDeepStrictEqual(base.raw[field], latest.raw[field]);
			if (!sameBase && !sameDesired) throw new Error(`Config conflict in ${field}; reload settings before saving`);
			if (desired === null) delete raw[field];
			else raw[field] = desired;
		}
		snapshot = latest;
		if (!isDeepStrictEqual(raw, latest.raw)) {
			const text = `${JSON.stringify(raw, null, 2)}\n`;
			const temp = `${file}.${randomUUID()}.tmp`;
			// Only clean up a temporary file this operation successfully created.
			const handle = await io.open(temp, "wx", 0o600);
			try {
				try {
					await handle.writeFile(text, "utf8");
					await handle.sync();
				} finally {
					await handle.close();
				}
				if ((await readSnapshot(file)).fingerprint !== latest.fingerprint) {
					throw new Error("Config changed before commit; reload settings before saving");
				}
				// Cooperative writers hold the lock. External editors still have a tiny check/rename race.
				await io.rename(temp, file);
			} catch (error) {
				try {
					await io.unlink(temp);
				} catch (cleanupError) {
					if (!hasCode(cleanupError, "ENOENT")) {
						throw new AggregateError([error, cleanupError], `Cannot save config or remove temporary file ${temp}`, { cause: cleanupError });
					}
				}
				throw error;
			}
			snapshot = { raw, fingerprint: fingerprint(Buffer.from(text, "utf8")) };
		}
	} catch (error) {
		try {
			await io.rmdir(lock);
		} catch (unlockError) {
			throw new AggregateError([error, unlockError], `Config save failed; cannot release lock ${lock}`, { cause: unlockError });
		}
		throw error;
	}
	try {
		await io.rmdir(lock);
	} catch {
		// Commit already succeeded: callers must apply the snapshot, not report rollback.
		return { snapshot, warnings: [`Cannot release config lock ${lock}; close all pi processes before removing this lock directory`] };
	}
	return { snapshot, warnings: [] };
}

function validatePatch(patch: GeneralSettingsPatch): void {
	for (const [field, value] of Object.entries(patch)) {
		if (!Object.hasOwn(FIELD_VALUES, field) ||
			(value !== null && !(FIELD_VALUES[field as keyof GeneralSettingsPatch] as readonly unknown[]).includes(value))) {
			throw new Error(`Invalid General settings patch field ${field}`);
		}
	}
}

function fingerprint(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function hasCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}
