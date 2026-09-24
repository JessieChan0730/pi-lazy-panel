#!/usr/bin/env node
/**
 * i18n scan / sync tool (`npm run i18n:scan`, or `npm run i18n:check` for CI).
 *
 * 扫描 src 里所有 `t("…")` 的 key，和 src/i18n/locales/{en,zh}.json 对齐：
 *   - 报告代码用到但 en.json 缺失的 key（需要补基准文案）
 *   - 报告 en.json 有、zh.json 缺的 key（需要翻译）
 *   - 报告 json 里没被用到的 key（孤儿，可能可删；动态 key 会被保守跳过）
 *
 * 默认（无 --check）还会把缺失的 key 以空串占位补进两份 json 并按字母排序，
 * 保留已有译文；补完后由人 / AI 填空。--check 只报告不写，有问题时退出码非 0。
 *
 * 说明：像 `t(`action.${id}`)` 这种动态 key 无法静态提取，脚本记下它的前缀
 * （如 `action`），据此避免把该命名空间下的 key 误报成孤儿。
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = join(ROOT, "src");
const LOCALES_DIR = join(ROOT, "src", "i18n", "locales");
const LOCALES = ["en", "zh"];
const BASE = "en";
/** Plural / context suffixes i18next appends; a base key counts as present if any variant exists. */
const SUFFIX_RE = /_(zero|one|two|few|many|other)$/;

const CHECK_ONLY = process.argv.includes("--check");

/** Every .ts file under src (recursively). */
function sourceFiles(dir) {
	const out = [];
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
		else if (name.endsWith(".ts")) out.push(full);
	}
	return out;
}

/** Static `t("key")` literals and dynamic ``t(`prefix.${…}`)`` prefixes used in the source. */
function collectUsage(files) {
	const staticKeys = new Set();
	const dynamicPrefixes = new Set();
	const re = /\bt\(\s*(["'`])([^"'`]*)\1?/g;
	for (const file of files) {
		const text = readFileSync(file, "utf8");
		for (const m of text.matchAll(re)) {
			const raw = m[2];
			if (!raw) continue;
			const dollar = raw.indexOf("${");
			if (dollar >= 0) {
				const prefix = raw.slice(0, dollar).split(".")[0];
				if (prefix) dynamicPrefixes.add(prefix);
			} else {
				staticKeys.add(raw);
			}
		}
	}
	return { staticKeys, dynamicPrefixes };
}

/** Flatten a nested locale object into dotted keys ("action.session-resume"). */
function flatten(obj, prefix = "") {
	const out = {};
	for (const [key, value] of Object.entries(obj)) {
		const full = prefix ? `${prefix}.${key}` : key;
		if (value && typeof value === "object" && !Array.isArray(value)) Object.assign(out, flatten(value, full));
		else out[full] = value;
	}
	return out;
}

/** Set a dotted key on a nested object, creating intermediate objects. */
function setDeep(obj, dottedKey, value) {
	const parts = dottedKey.split(".");
	let node = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		node[parts[i]] = node[parts[i]] ?? {};
		node = node[parts[i]];
	}
	node[parts[parts.length - 1]] = value;
}

/** Recursively sort object keys so the JSON files stay in a stable order. */
function sortDeep(value) {
	if (Array.isArray(value) || value === null || typeof value !== "object") return value;
	const out = {};
	for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);
	return out;
}

/** Base key of a plural / context variant ("k_other" -> "k"). */
function baseKey(key) {
	return key.replace(SUFFIX_RE, "");
}

/** Is `key` present in `flat`, counting any plural / context variant of it? */
function present(key, flat) {
	if (key in flat) return true;
	return Object.keys(flat).some((k) => baseKey(k) === key);
}

function main() {
	const files = sourceFiles(SRC_DIR);
	const { staticKeys, dynamicPrefixes } = collectUsage(files);

	const raw = {};
	const flat = {};
	for (const locale of LOCALES) {
		raw[locale] = JSON.parse(readFileSync(join(LOCALES_DIR, `${locale}.json`), "utf8"));
		flat[locale] = flatten(raw[locale]);
	}
	const baseFlat = flat[BASE];

	// 代码用到但 en.json 缺失的静态 key（需要补基准文案）。
	const missingInBase = [...staticKeys].filter((k) => !present(k, baseFlat)).sort();
	// en 有、其它语言缺的 key（需要翻译）。
	const missingByLocale = {};
	for (const locale of LOCALES) {
		if (locale === BASE) continue;
		missingByLocale[locale] = Object.keys(baseFlat)
			.filter((k) => !present(k, flat[locale]))
			.sort();
	}
	// json 里有、但没被任何静态 key 或动态前缀用到的 key（可能是孤儿）。
	const used = (key) => staticKeys.has(key) || staticKeys.has(baseKey(key)) || dynamicPrefixes.has(key.split(".")[0]);
	const orphans = Object.keys(baseFlat)
		.filter((k) => !used(k))
		.sort();

	console.log(`i18n scan — ${files.length} source files, ${staticKeys.size} static keys, ${Object.keys(baseFlat).length} keys in ${BASE}.json`);
	report(`keys used in code but missing from ${BASE}.json`, missingInBase);
	for (const locale of LOCALES) {
		if (locale === BASE) continue;
		report(`keys missing from ${locale}.json (need translation)`, missingByLocale[locale]);
	}
	report("possibly-unused keys (dynamic keys are skipped, review before deleting)", orphans, true);

	const totalMissing = missingInBase.length + LOCALES.reduce((n, l) => n + (missingByLocale[l]?.length ?? 0), 0);
	if (totalMissing === 0) {
		console.log("\n✓ locale files are in sync.");
		return;
	}
	if (CHECK_ONLY) {
		console.error(`\n✗ ${totalMissing} key(s) out of sync. Run \`npm run i18n:scan\` to scaffold them.`);
		process.exit(1);
	}
	// 写模式：把缺失的 key 以空串补进对应文件（保留已有译文），按字母排序落盘。
	for (const key of missingInBase) for (const locale of LOCALES) setDeep(raw[locale], key, "");
	for (const locale of LOCALES) for (const key of missingByLocale[locale] ?? []) setDeep(raw[locale], key, "");
	for (const locale of LOCALES) writeFileSync(join(LOCALES_DIR, `${locale}.json`), `${JSON.stringify(sortDeep(raw[locale]), null, 2)}\n`);
	console.log(`\n✓ scaffolded ${totalMissing} placeholder key(s); fill in the empty strings.`);
}

/** Print a labelled list, or a one-line "none" when empty. */
function report(label, keys, muted = false) {
	if (keys.length === 0) {
		console.log(`  ${label}: none`);
		return;
	}
	console.log(`  ${label}: ${keys.length}`);
	for (const key of keys) console.log(`    ${muted ? "· " : "+ "}${key}`);
}

main();

