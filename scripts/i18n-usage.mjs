/**
 * Pure helpers behind the i18n scan (`scripts/i18n-scan.mjs`).
 *
 * 拆出来是为了能单测：扫描脚本本身还要读写文件，这里只做纯计算
 * （从源码文本里提取静态 / 动态 key，以及判断某个 key 是否被用到）。
 * 类型声明在 `i18n-usage.d.mts`，供测试里的 type-only import 使用。
 */

/** Plural / context suffixes i18next appends; a base key counts as present if any variant exists. */
const SUFFIX_RE = /_(zero|one|two|few|many|other)$/;

/** Anything that looks like a dotted i18n key (`ns.name`); filters out comparisons like `key === "layout"`. */
const KEY_RE = /^[\w-]+(\.[\w-]+)+$/;

/** A string / template literal anywhere inside a `t(…)` argument list. */
const LITERAL_RE = /(["'`])((?:\\[\s\S]|(?!\1)[^\\])*)\1/g;

/**
 * Static `t("key")` literals and dynamic ``t(`prefix.${…}`)`` prefixes in source text.
 *
 * 取的是 `t(…)` 实参里的**所有**字符串字面量，而不是紧跟在 `t(` 后面的那一个：
 * `t(state.loading ? "a.b" : "c.d")` 这种条件写法两个 key 都要算数。
 *
 * 动态 key 只取 `${` **之前**的完整前缀（如 `settings.language.`），而不是首段
 * （`settings`）——只取首段会放行整个命名空间，让孤儿检测形同虚设。
 */
export function usageFromText(text) {
	const staticKeys = new Set();
	const dynamicPrefixes = new Set();
	for (const call of text.matchAll(/\bt\(/g)) {
		const args = callArguments(text, (call.index ?? 0) + call[0].length);
		if (args === undefined) continue;
		for (const literal of args.matchAll(LITERAL_RE)) {
			const raw = literal[2];
			if (raw === undefined || !KEY_RE.test(raw.replace(/\$\{[^}]*\}/g, "x"))) continue;
			const dollar = raw.indexOf("${");
			if (dollar < 0) staticKeys.add(raw);
			else if (raw.slice(0, dollar)) dynamicPrefixes.add(raw.slice(0, dollar));
		}
	}
	return { staticKeys, dynamicPrefixes };
}

/** Text between the parens that start at `start` (the char after `t(`), or undefined if unbalanced. */
function callArguments(text, start) {
	let depth = 1;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (ch === "(") depth++;
		else if (ch === ")") {
			depth--;
			if (depth === 0) return text.slice(start, i);
		} else if (ch === "\"" || ch === "'" || ch === "`") {
			const end = skipString(text, i);
			if (end < 0) return undefined;
			i = end;
		}
	}
	return undefined;
}

/** Index of the closing quote for the literal opening at `start`, or -1 if unterminated. */
function skipString(text, start) {
	const quote = text[start];
	for (let i = start + 1; i < text.length; i++) {
		const ch = text[i];
		if (ch === "\\") i++;
		else if (ch === quote) return i;
	}
	return -1;
}

/** Base key of a plural / context variant ("k_other" -> "k"). */
export function baseKey(key) {
	return key.replace(SUFFIX_RE, "");
}

/** Is `key` referenced by a static literal, or covered by a dynamic prefix? */
export function isKeyUsed(key, staticKeys, dynamicPrefixes) {
	if (staticKeys.has(key) || staticKeys.has(baseKey(key))) return true;
	for (const prefix of dynamicPrefixes) if (key.startsWith(prefix)) return true;
	return false;
}

/** Is `key` present in a flattened locale, counting any plural / context variant? */
export function isKeyPresent(key, flat) {
	if (key in flat) return true;
	return Object.keys(flat).some((k) => baseKey(k) === key);
}
