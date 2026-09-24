/**
 * i18n — the only module that knows about i18next and the locale files.
 *
 * 整个插件的 UI 文案都走这里的 `t()`。语言在一次会话里固定：`initI18n()` 打开面板前调用一次，
 * 按系统语言（环境变量 / Intl）决定用中文还是英文，没覆盖到的语言回退英文（fallback）。
 *
 * 用法约定（重要）：
 *   - 不要在模块顶层用 `t()` 计算 `export const`——那会在 import 期求值，可能早于 `initI18n()`。
 *     需要文案的地方一律写成函数，渲染时才调用 `t()`（见 config/keymap.ts 的 getter 们）。
 *   - `t()` 在未初始化时会惰性初始化（按系统语言），保证任何调用点都能拿到文案。
 *
 * 翻译文件在 ./locales/{en,zh}.json，用 `fs` 读取（不走 JSON import，省掉 tsconfig 的坑，
 * 也让 scripts/i18n-scan.mjs 和运行时读同一份格式）。英文是基准语言（source of truth）。
 */

import { readFileSync } from "node:fs";
import i18next from "i18next";

/** Languages we ship. English is the fallback for everything else. */
export type Locale = "en" | "zh";
export const SUPPORTED_LOCALES: readonly Locale[] = ["en", "zh"];
export const FALLBACK_LOCALE: Locale = "en";

/** Options accepted by `t` (interpolation values, `count` for plurals). */
export type TOptions = Record<string, unknown>;

let initialized = false;

/** Read one locale file as a plain object (throws only if the shipped file is missing/corrupt). */
function loadLocale(locale: Locale): Record<string, unknown> {
	const url = new URL(`./locales/${locale}.json`, import.meta.url);
	return JSON.parse(readFileSync(url, "utf8")) as Record<string, unknown>;
}

/**
 * Detect the UI language from the environment.
 *
 * 优先看 POSIX 的 locale 环境变量（LC_ALL > LC_MESSAGES > LANG > LANGUAGE），
 * 没有就退回 `Intl` 解析出来的运行时 locale；只要以 `zh` 开头就用中文，其余一律英文。
 */
export function detectLocale(env: NodeJS.ProcessEnv = process.env): Locale {
	const fromEnv = env.LC_ALL || env.LC_MESSAGES || env.LANG || env.LANGUAGE || "";
	const raw = fromEnv || intlLocale();
	return normalizeLocale(raw);
}

/** Runtime locale from `Intl`, e.g. "zh-CN"; "" when it cannot be determined. */
function intlLocale(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().locale ?? "";
	} catch {
		return "";
	}
}

/** Map a raw locale tag ("zh_CN.UTF-8", "zh-Hans", "en_US") to a shipped language. */
export function normalizeLocale(raw: string): Locale {
	return /^zh\b/i.test(raw.replace(/[_.]/g, "-")) ? "zh" : FALLBACK_LOCALE;
}

/**
 * Initialise i18next with both locale files (synchronously — inline resources,
 * no async backend). Pass `lng` to force a language (tests use "en"); omit it to
 * follow the system. Idempotent: a second call just switches the language.
 */
export function initI18n(lng?: Locale): Locale {
	const language = lng ?? detectLocale();
	if (initialized) {
		if (i18next.language !== language) void i18next.changeLanguage(language);
		return language;
	}
	i18next.init({
		lng: language,
		fallbackLng: FALLBACK_LOCALE,
		supportedLngs: [...SUPPORTED_LOCALES],
		// 同步初始化：资源内联、没有异步 backend，init 返回时 t() 已可用。
		initImmediate: false,
		// 终端不是 HTML，关掉 HTML 转义，否则 `'` / `<` 会被转义成实体。
		interpolation: { escapeValue: false },
		resources: {
			en: { translation: loadLocale("en") },
			zh: { translation: loadLocale("zh") },
		},
	});
	initialized = true;
	return language;
}

/** The active language (initialising lazily to the system language if needed). */
export function currentLocale(): Locale {
	if (!initialized) initI18n();
	return (i18next.language as Locale) ?? FALLBACK_LOCALE;
}

/**
 * Translate `key`, interpolating `options` (and using `options.count` for
 * plurals). Lazily initialises i18n on first use so no call site can run before
 * a language is set. A missing key falls back to English, then to the key text.
 */
export function t(key: string, options?: TOptions): string {
	if (!initialized) initI18n();
	return i18next.t(key, options ?? {}) as string;
}
