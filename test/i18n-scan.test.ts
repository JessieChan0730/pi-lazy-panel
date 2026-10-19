import assert from "node:assert/strict";
import { test } from "node:test";
import { baseKey, isKeyPresent, isKeyUsed, pluralBaseKeys, pluralCategories, usageFromText } from "../scripts/i18n-usage.mjs";

test("usageFromText: static literals and dynamic prefixes", () => {
	const { staticKeys, dynamicPrefixes } = usageFromText([
		"const a = t(\"action.session-resume\");",
		"const b = t(`settings.language.${code}`);",
	].join("\n"));
	assert.deepEqual([...staticKeys], ["action.session-resume"]);
	assert.deepEqual([...dynamicPrefixes], ["settings.language."]);
});

test("usageFromText: keys passed through a conditional are static, other strings are ignored", () => {
	const { staticKeys, dynamicPrefixes } = usageFromText(
		"const a = t(state.loading ? \"settings.loading\" : \"settings.saving\");\n" +
		"const b = t(key === \"layout\" ? \"settings.x\" : \"settings.y\");",
	);
	assert.deepEqual([...staticKeys].sort(), ["settings.loading", "settings.saving", "settings.x", "settings.y"]);
	assert.deepEqual([...dynamicPrefixes], []);
});

test("isKeyUsed: a dynamic prefix only covers its own subtree, not the whole namespace", () => {
	// 回归：`t(`settings.language.${…}`)` 曾只取首段 `settings`，把 settings.close 也当成"用到"。
	const { staticKeys, dynamicPrefixes } = usageFromText("t(`settings.language.${code}`);");
	assert.equal(isKeyUsed("settings.language.en", staticKeys, dynamicPrefixes), true);
	assert.equal(isKeyUsed("settings.close", staticKeys, dynamicPrefixes), false);
	assert.equal(isKeyUsed("settings.scope.all", staticKeys, dynamicPrefixes), false);
});

test("isKeyUsed: static keys and plural variants count as used", () => {
	const { staticKeys, dynamicPrefixes } = usageFromText("t(\"settings.unsaved\"); t(\"dialog.x\");");
	assert.equal(isKeyUsed("dialog.x", staticKeys, dynamicPrefixes), true);
	assert.equal(isKeyUsed("settings.unsaved", staticKeys, dynamicPrefixes), true);
	assert.equal(isKeyUsed("settings.unsaved_other", staticKeys, dynamicPrefixes), true);
	assert.equal(isKeyUsed("settings.never", staticKeys, dynamicPrefixes), false);
});

test("baseKey strips plural / context suffixes", () => {
	assert.equal(baseKey("a.b_one"), "a.b");
	assert.equal(baseKey("a.b_other"), "a.b");
	assert.equal(baseKey("a.b"), "a.b");
});

test("isKeyPresent counts plural / context variants already in the locale", () => {
	const flat = { "a.b_other": "x", "c.d": "y" };
	assert.equal(isKeyPresent("c.d", flat), true);
	assert.equal(isKeyPresent("a.b", flat), true);
	assert.equal(isKeyPresent("a.e", flat), false);
});

test("isKeyPresent treats scaffold placeholders (empty / blank) as missing", () => {
	// 回归：空串是扫描脚本补的占位，不该算「已同步」，否则空译文能过 i18n:check。
	const flat = { "a.b": "", "c.d": "   ", "e.f_other": "x", "e.f_one": "" };
	assert.equal(isKeyPresent("a.b", flat), false);
	assert.equal(isKeyPresent("c.d", flat), false);
	assert.equal(isKeyPresent("e.f", flat), true, "_other is filled, so the base key counts as translated");
	assert.equal(isKeyPresent("e.f_one", flat), false, "the explicitly named plural variant still has to be filled");
	assert.equal(isKeyPresent("e.f_other", flat), true);
});

test("pluralCategories reports the CLDR categories i18next will look up", () => {
	assert.deepEqual(pluralCategories("en"), ["one", "other"]);
	assert.deepEqual(pluralCategories("zh"), ["other"]);
});

test("pluralBaseKeys finds the bases that carry plural variants", () => {
	const flat = { "a.b": "x", "c.d_one": "1", "c.d_other": "n", "e.f_other": "n" };
	assert.deepEqual([...pluralBaseKeys(flat)].sort(), ["c.d", "e.f"]);
});
