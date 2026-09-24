/**
 * i18n tests: locale detection, initialisation, interpolation, plurals and the
 * English fallback. Run with `npm test` (node --test via tsx).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { detectLocale, initI18n, normalizeLocale, t } from "../src/i18n/index.ts";

test("normalizeLocale maps zh* to zh and everything else to en", () => {
	assert.equal(normalizeLocale("zh"), "zh");
	assert.equal(normalizeLocale("zh_CN.UTF-8"), "zh");
	assert.equal(normalizeLocale("zh-Hans"), "zh");
	assert.equal(normalizeLocale("en_US.UTF-8"), "en");
	assert.equal(normalizeLocale("fr"), "en");
	assert.equal(normalizeLocale(""), "en");
	// "zho"/"zhx" 不是 zh：normalizeLocale 只认词边界后的 zh。
	assert.equal(normalizeLocale("zhh"), "en");
});

test("detectLocale reads the locale env vars, LC_ALL first", () => {
	assert.equal(detectLocale({ LANG: "zh_CN.UTF-8" }), "zh");
	assert.equal(detectLocale({ LANG: "en_US.UTF-8" }), "en");
	assert.equal(detectLocale({ LC_ALL: "zh_CN.UTF-8", LANG: "en_US.UTF-8" }), "zh");
	assert.equal(detectLocale({ LC_MESSAGES: "zh_CN.UTF-8", LANG: "en_US.UTF-8" }), "zh");
});

test("initI18n('en') resolves keys, interpolates and pluralises in English", () => {
	initI18n("en");
	assert.equal(t("action.session-resume"), "Resume session");
	assert.equal(t("status.labelSet", { label: "ckpt" }), "label set: ckpt");
	assert.equal(t("status.sessionsDeleted", { count: 1 }), "1 session deleted");
	assert.equal(t("status.sessionsDeleted", { count: 3 }), "3 sessions deleted");
	assert.equal(t("search.matches", { position: 2, total: 7 }), "2/7 matches");
});

test("initI18n('zh') switches every string to Chinese", () => {
	initI18n("zh");
	assert.equal(t("action.session-resume"), "恢复会话");
	assert.equal(t("status.labelSet", { label: "ckpt" }), "已设置标签：ckpt");
	// 中文只有一种复数形态。
	assert.equal(t("status.sessionsDeleted", { count: 3 }), "已删除 3 个会话");
	// 回到 en，别影响其它测试文件（同进程内 node:test 顺序执行）。
	initI18n("en");
});

test("a missing key falls back to the key itself", () => {
	initI18n("en");
	assert.equal(t("this.key.does.not.exist"), "this.key.does.not.exist");
});
