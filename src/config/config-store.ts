import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isDeepStrictEqual } from "node:util";
import { KEY_SCOPES, LEFT_COLUMN_RATIO_MAX, LEFT_COLUMN_RATIO_MIN } from "../constants.ts";
import type { ActionId, KeyChord, KeyScope } from "../types.ts";
import { parseChord } from "./keys.ts";

export interface ConfigSnapshot {
	raw: Record<string, unknown>;
	/** Hash of the exact file bytes; null means the file did not exist. */
	fingerprint: string | null;
}

export interface SettingsPatch {
	locale?: "en" | "zh" | null;
	defaultScope?: "all" | "current-folder" | null;
	defaultSort?: "recent" | "created" | "title" | "threaded" | null;
	leftColumnRatio?: number | null;
	/** Per-(scope, action) key binding edits; see KeymapPatchValue. */
	keymap?: KeymapPatch;
}

/**
 * One key binding edit relative to the on-disk user config:
 *   { set }    override the action with these chords (written to the user file)
 *   { unbind } write null (remove the built-in default binding)
 *   { reset }  delete the user override (fall back to the built-in default)
 */
export type KeymapPatchValue = { set: KeyChord[] } | { unbind: true } | { reset: true };
export type KeymapPatch = Partial<Record<KeyScope, Partial<Record<ActionId, KeymapPatchValue>>>>;

export interface ConfigSaveResult {
	snapshot: ConfigSnapshot;
	warnings: string[];
}

/** File-operation seam for deterministic failure tests; normal callers omit it. */
export interface ConfigStoreOptions {
	io?: Partial<Pick<typeof fs, "open" | "readFile" | "writeFile" | "readdir" | "realpath" | "readlink" | "rename" | "stat" | "unlink" | "rmdir" | "mkdir">>;
	lockTimeoutMs?: number;
}

const FIELD_VALUES = {
	locale: ["en", "zh"],
	defaultScope: ["all", "current-folder"],
	defaultSort: ["recent", "created", "title", "threaded"],
} satisfies Record<Exclude<keyof SettingsPatch, "leftColumnRatio" | "keymap">, string[]>;

/** How far `resolveTarget` follows a chain of links, mirroring the kernel's ELOOP cap. */
const MAX_LINK_DEPTH = 32;

/** What a lock directory holds: who took it, and since when. */
interface LockOwner {
	pid: number;
	host: string;
	/** Epoch ms the lock was taken. */
	at: number;
}

interface LockState {
	owner: LockOwner | undefined;
	ownerFile: string | undefined;
	mtimeMs: number;
	reclaimable: boolean;
}

/**
 * How long a lock no process can vouch for may sit before we break it: one whose
 * record is missing or unreadable, or whose owner lives on another machine (a
 * shared home directory), where a PID says nothing about liveness.
 * A known live local process is never evicted based on age alone.
 */
const STALE_LOCK_MS = 30_000;

/** Unlike loadConfig, this never converts a broken file to writable defaults. */
export async function readSnapshot(file: string): Promise<ConfigSnapshot> {
	let bytes: Buffer;
	try {
		bytes = await fs.readFile(file);
	} catch (error) {
		if (hasCode(error, "ENOENT")) {
			try {
				// 悬空链接（目标还没建）和"没有配置文件"是同一种状态：返回空快照，
				// 面板就能照常编辑，保存时再写到链接指向的位置（见 resolveTarget）。
				const stats = await fs.lstat(file);
				if (stats.isSymbolicLink()) return { raw: {}, fingerprint: null };
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

export async function savePatch(file: string, baseline: ConfigSnapshot, patch: SettingsPatch, options: ConfigStoreOptions = {}): Promise<ConfigSaveResult> {
	// Capture inputs before waiting for other processes; do not retain mutable UI state.
	const base = structuredClone(baseline);
	const changes = { ...patch };
	validatePatch(changes);
	const io = { ...fs, ...options.io };
	// 写的是链接指向的真身（dotfiles 里那份），不是链接本身；锁也跟着真身走，
	// 两个指向同一个文件的链接才会共用同一把锁。
	file = await resolveTarget(io, resolve(file));
	const mode = await existingMode(io, file);
	const lock = `${file}.lock`;
	await io.mkdir(dirname(file), { recursive: true });
	const ownerFile = await acquireLock(io, lock, options.lockTimeoutMs ?? 5000);

	let snapshot: ConfigSnapshot;
	try {
		const latest = await readSnapshot(file);
		const raw = { ...latest.raw };
		for (const field of Object.keys(changes) as (keyof SettingsPatch)[]) {
			if (field === "keymap") {
				const edits = changes.keymap!;
				const desired = applyKeymapPatch(latest.raw.keymap, edits);
				// 冲突检测按单个绑定粒度：别人改了同一个 (scope, action) 且和我们想写的不一致才算冲突。
				for (const [scope, actions] of Object.entries(edits)) {
					for (const action of Object.keys(actions!)) {
						const bv = userBinding(base.raw.keymap, scope, action);
						const lv = userBinding(latest.raw.keymap, scope, action);
						const dv = userBinding(desired, scope, action);
						const sameBase = bv.has === lv.has && isDeepStrictEqual(bv.value, lv.value);
						const sameDesired = dv.has === lv.has && isDeepStrictEqual(dv.value, lv.value);
						if (!sameBase && !sameDesired) throw new Error(`Config conflict in keymap.${scope}.${action}; reload settings before saving`);
					}
				}
				if (Object.keys(desired).length) raw.keymap = desired;
				else delete raw.keymap;
				continue;
			}
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
			// 沿用原文件的缩进和行尾：面板只改一个键，不该把手工维护（dotfiles 仓库里那份）
			// 的配置整体重排——那会变成整文件 diff，Windows 上还会顺手把 CRLF 换成 LF。
			const text = formatConfig(raw, await existingStyle(io, file));
			const temp = `${file}.${randomUUID()}.tmp`;
			// Only clean up a temporary file this operation successfully created.
			const handle = await io.open(temp, "wx", 0o600);
			try {
				try {
					// 沿用原文件的权限位：dotfiles 仓库里那份不该因为面板保存就从 644 变成 600
					// （临时文件一律 0o600 建，否则降级不了权限）；文件不存在时保持 0o600。
					// 这一步只动元数据，失败（不支持的文件系统等）不该让整次保存失败。
					if (mode !== undefined) await handle.chmod(mode).catch(() => undefined);
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
			await removeLock(io, lock, ownerFile);
		} catch (unlockError) {
			throw new AggregateError([error, unlockError], `Config save failed; cannot release lock ${lock}`, { cause: unlockError });
		}
		throw error;
	}
	try {
		await removeLock(io, lock, ownerFile);
	} catch {
		// Commit already succeeded: callers must apply the snapshot, not report rollback.
		return { snapshot, warnings: [`Cannot release config lock ${lock}; close all pi processes before removing this lock directory`] };
	}
	return { snapshot, warnings: [] };
}

async function acquireLock(io: typeof fs, lock: string, timeoutMs: number): Promise<string> {
	const id = randomUUID();
	const pending = `${lock}.${id}.pending`;
	const ownerFile = `owner-${id}.json`;
	const owner: LockOwner = { pid: process.pid, host: hostname(), at: Date.now() };
	await io.mkdir(pending, { mode: 0o700 });
	try {
		// 先写完整 owner 再发布目录，避免新锁短暂为空，被另一个回收者的 rmdir 误删。
		await io.writeFile(join(pending, ownerFile), JSON.stringify(owner), { flag: "wx", mode: 0o600 });
		const deadline = performance.now() + timeoutMs;
		while (true) {
			const state = await readLockState(io, lock);
			if (!state || (isStaleLock(state) && await breakStaleLock(io, lock, state))) {
				try {
					await io.rename(pending, lock);
					return ownerFile;
				} catch (error) {
					// Windows may report EPERM/EACCES instead of ENOTEMPTY for an existing directory.
					const occupied = ["EEXIST", "ENOTEMPTY", "EPERM", "EACCES"].some((code) => hasCode(error, code));
					if (!occupied || !await readLockState(io, lock)) {
						throw new Error(`Cannot acquire config lock ${lock}`, { cause: error });
					}
				}
			}
			if (performance.now() >= deadline) {
				throw new Error(`Timed out waiting for config lock ${lock}${describeHolder((await readLockState(io, lock))?.owner)}; close all pi processes before removing a stale lock directory`);
			}
			await delay(25);
		}
	} catch (error) {
		try {
			await removeLock(io, pending, ownerFile);
		} catch (cleanupError) {
			throw new AggregateError([error, cleanupError], `Cannot acquire config lock or remove pending directory ${pending}`, { cause: cleanupError });
		}
		throw error;
	}
}

/** Only a single owner record (or an empty legacy lock) is safe to reclaim. */
async function readLockState(io: typeof fs, lock: string): Promise<LockState | undefined> {
	let mtimeMs: number;
	let files: string[];
	try {
		mtimeMs = (await io.stat(lock)).mtimeMs;
		files = await io.readdir(lock);
	} catch (error) {
		if (hasCode(error, "ENOENT")) return undefined;
		throw new Error(`Cannot inspect config lock ${lock}`, { cause: error });
	}
	const ownerFile = files.length === 1 && /^(?:owner|owner-[\da-f-]+)\.json$/.test(files[0]!) ? files[0] : undefined;
	// Unknown contents must not be deleted, even if their directory is old.
	const reclaimable = files.length === 0 || ownerFile !== undefined;
	return { owner: ownerFile ? await readLockOwner(io, join(lock, ownerFile)) : undefined, ownerFile, mtimeMs, reclaimable };
}

async function readLockOwner(io: typeof fs, file: string): Promise<LockOwner | undefined> {
	try {
		const parsed: unknown = JSON.parse(await io.readFile(file, "utf8"));
		if (isPlainObject(parsed) && typeof parsed.pid === "number" && Number.isSafeInteger(parsed.pid) && parsed.pid > 0 && parsed.pid <= 0x7fffffff && typeof parsed.host === "string" && parsed.host.length > 0) {
			const at = typeof parsed.at === "number" && Number.isFinite(parsed.at) && Math.abs(parsed.at) <= 8.64e15 ? parsed.at : 0;
			return { pid: parsed.pid, host: parsed.host, at };
		}
	} catch {
		// 没有记录（旧版本留下的锁、mkdir 之后立刻崩了）或读到一半被删：交给年龄判断。
	}
	return undefined;
}

function isStaleLock(state: LockState): boolean {
	if (!state.reclaimable) return false;
	if (state.owner?.host === hostname()) return isProcessGone(state.owner.pid);
	return Date.now() - state.mtimeMs >= STALE_LOCK_MS;
}

/** Whether `pid` is known to be dead; anything we cannot tell (EPERM, another user's process) counts as alive. */
function isProcessGone(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return true;
	try {
		process.kill(pid, 0);
		return false;
	} catch (error) {
		return hasCode(error, "ESRCH");
	}
}

async function breakStaleLock(io: typeof fs, lock: string, state: LockState): Promise<boolean> {
	try {
		// 只删观察到的那一任属主的唯一文件名；后来者的文件名不同，rmdir 会以 ENOTEMPTY 保护它。
		await removeLock(io, lock, state.ownerFile);
		return true;
	} catch (error) {
		throw new Error(`Cannot reclaim stale config lock ${lock}`, { cause: error });
	}
}

async function removeLock(io: typeof fs, lock: string, ownerFile: string | undefined): Promise<void> {
	if (ownerFile) {
		try {
			await io.unlink(join(lock, ownerFile));
		} catch (error) {
			if (!hasCode(error, "ENOENT")) throw error;
		}
	}
	try {
		await io.rmdir(lock);
	} catch (error) {
		// A successor may already have published its nonempty directory.
		if (!["ENOENT", "ENOTEMPTY", "EEXIST"].some((code) => hasCode(error, code))) throw error;
	}
}

/** The holder's description for the timeout message, or "" when there is no usable record. */
function describeHolder(owner: LockOwner | undefined): string {
	if (!owner) return "";
	const since = owner.at > 0 ? new Date(owner.at).toISOString() : "unknown";
	return ` (held by pid ${owner.pid} on ${owner.host} since ${since})`;
}

/**
 * The path to actually write.
 *
 * A dotfiles setup links `~/.pi/agent/lazy-panel.json` into a repository, and
 * `rename` swaps the *link* for a plain file — the repository's copy would then
 * silently stop being the one pi reads (reading follows the link, so nothing
 * looks wrong, and the repo shows no change). Follow the link and replace its
 * target instead: the repository's file is updated and the link keeps working.
 *
 * A link whose target does not exist yet cannot be resolved by `realpath`, so the
 * chain is walked by hand — the first save then creates the file the link points
 * at (its directory too) instead of replacing the link. Anything else (a plain
 * missing path, an unreadable directory, a link cycle) is written as given.
 *
 * `MAX_LINK_DEPTH` mirrors the kernel's own ELOOP cap, so a cycle stops here
 * rather than spinning.
 */
async function resolveTarget(io: typeof fs, file: string): Promise<string> {
	let target = file;
	for (let depth = 0; depth < MAX_LINK_DEPTH; depth++) {
		try {
			return await io.realpath(target);
		} catch {
			try {
				target = resolve(dirname(target), await io.readlink(target));
			} catch {
				return target;
			}
		}
	}
	return target;
}

/** Permission bits of the file already on disk, or undefined when there is none (first save). */
async function existingMode(io: typeof fs, file: string): Promise<number | undefined> {
	try {
		return (await io.stat(file)).mode & 0o777;
	} catch {
		return undefined;
	}
}

/** How a config file is laid out; see `detectStyle`. */
interface ConfigStyle {
	indent: string;
	eol: string;
	trailingNewline: boolean;
}

/** What a file we create ourselves looks like: two spaces, LF, trailing newline. */
const DEFAULT_CONFIG_STYLE: ConfigStyle = { indent: "  ", eol: "\n", trailingNewline: true };

/**
 * The layout of the config text already on disk, or the default when there is
 * none (first save). Only the path that really writes asks for it: a save that
 * changes nothing stays byte-exact and never reads this.
 *
 * 手工维护的配置文件（或 dotfiles 仓库里那份）有自己的排版，保存时照抄：
 * 缩进单位取第一条带缩进的行（`JSON.stringify` 的第三参数收字符串，tab 就能原样沿回去），
 * 行尾看有没有 CRLF，末尾换行也照它原来的样子。本来就写成一行的文件仍然保持一行
 * （缩进为空串 = 紧凑输出），不会被"帮忙"展开成多行。
 */
async function existingStyle(io: typeof fs, file: string): Promise<ConfigStyle> {
	try {
		return detectStyle(await io.readFile(file, "utf8"));
	} catch {
		return DEFAULT_CONFIG_STYLE;
	}
}

/** The layout of `text` (see `existingStyle`). */
function detectStyle(text: string): ConfigStyle {
	const indent = /^([ \t]+)"/m.exec(text)?.[1];
	return {
		// 没有带缩进的行：多行的按默认两空格，单行的保持紧凑。
		indent: indent ?? (text.includes("\n") ? DEFAULT_CONFIG_STYLE.indent : ""),
		eol: text.includes("\r\n") ? "\r\n" : "\n",
		trailingNewline: text.endsWith("\n"),
	};
}

/** `raw` as JSON text in `style` (see `existingStyle`). */
function formatConfig(raw: Record<string, unknown>, style: ConfigStyle): string {
	// JSON.stringify 只认 \n，CRLF 文件得把分隔符自己换回去。字符串值里的换行在 JSON 里是转义的
	// `\n` 两个字符，不会被这条替换误伤。
	const body = JSON.stringify(raw, null, style.indent).replaceAll("\n", style.eol);
	return style.trailingNewline ? `${body}${style.eol}` : body;
}

function validatePatch(patch: SettingsPatch): void {
	for (const [field, value] of Object.entries(patch)) {
		if (field === "keymap") {
			validateKeymapPatch(value);
			continue;
		}
		const valid = field === "leftColumnRatio"
			? value === null || (typeof value === "number" && Number.isFinite(value) && value >= LEFT_COLUMN_RATIO_MIN && value <= LEFT_COLUMN_RATIO_MAX)
			: Object.hasOwn(FIELD_VALUES, field) && (value === null || (FIELD_VALUES[field as keyof typeof FIELD_VALUES] as readonly unknown[]).includes(value));
		if (!valid) throw new Error(`Invalid settings patch field ${field}`);
	}
}

function validateKeymapPatch(value: unknown): void {
	if (!isPlainObject(value)) throw new Error("Invalid settings patch field keymap");
	for (const [scope, actions] of Object.entries(value)) {
		if (!(KEY_SCOPES as readonly string[]).includes(scope)) throw new Error(`Invalid settings patch field keymap.${scope}`);
		if (!isPlainObject(actions)) throw new Error(`Invalid settings patch field keymap.${scope}`);
		for (const [action, edit] of Object.entries(actions)) {
			const valid = isPlainObject(edit) && (
				("reset" in edit && edit.reset === true) ||
				("unbind" in edit && edit.unbind === true) ||
				("set" in edit && Array.isArray(edit.set) && edit.set.length > 0 && edit.set.every((c) => typeof c === "string" && parseChord(c) !== undefined))
			);
			if (!valid) throw new Error(`Invalid settings patch field keymap.${scope}.${action}`);
		}
	}
}

/**
 * Apply a keymap patch to the user file's `keymap` value, returning a fresh object.
 * `set` of a single chord is written as a plain string to match the hand-edited
 * config style; empty scopes are dropped so the file stays clean.
 */
export function applyKeymapPatch(baseKeymap: unknown, patch: KeymapPatch): Record<string, unknown> {
	const out: Record<string, unknown> = isPlainObject(baseKeymap) ? structuredClone(baseKeymap) : {};
	for (const [scope, actions] of Object.entries(patch)) {
		const scopeMap: Record<string, unknown> = isPlainObject(out[scope]) ? { ...(out[scope] as Record<string, unknown>) } : {};
		for (const [action, edit] of Object.entries(actions!)) {
			if ("reset" in edit) delete scopeMap[action];
			else if ("unbind" in edit) scopeMap[action] = null;
			else scopeMap[action] = edit.set.length === 1 ? edit.set[0] : edit.set;
		}
		if (Object.keys(scopeMap).length) out[scope] = scopeMap;
		else delete out[scope];
	}
	return out;
}

/** The user-file binding for one (scope, action): whether it is present and its raw value (string / array / null). */
function userBinding(keymap: unknown, scope: string, action: string): { has: boolean; value: unknown } {
	if (!isPlainObject(keymap)) return { has: false, value: undefined };
	const scopeMap = keymap[scope];
	if (!isPlainObject(scopeMap) || !Object.hasOwn(scopeMap, action)) return { has: false, value: undefined };
	return { has: true, value: scopeMap[action] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fingerprint(bytes: Buffer): string {
	return createHash("sha256").update(bytes).digest("hex");
}

function hasCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}
