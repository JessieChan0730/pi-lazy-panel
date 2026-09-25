import assert from "node:assert/strict";
import { test } from "node:test";
import { ESLint } from "eslint";

/** Messages of the local i18n rule for `code`, linted as if it were a file under src/. */
async function i18nProblems(code: string, filePath = "src/ui/demo.ts"): Promise<string[]> {
	const eslint = new ESLint({ ruleFilter: ({ ruleId }) => ruleId === "i18n/no-hardcoded-text" });
	const [result] = await eslint.lintText(code, { filePath });
	return (result?.messages ?? []).map((m) => `${m.line}:${m.ruleId ?? m.message}`);
}

test("i18n/no-hardcoded-text flags non-English strings and templates in src", async () => {
	const code = [
		"export function a(): string {",
		"\treturn \"已删除\";",
		"}",
		"export function b(n: number): string {",
		"\treturn `共 ${n} 个`;",
		"}",
		"export const C = \"Привет\";",
		"export const D = \"（\";",
		"",
	].join("\n");
	assert.deepEqual(await i18nProblems(code), ["2:i18n/no-hardcoded-text", "5:i18n/no-hardcoded-text", "7:i18n/no-hardcoded-text", "8:i18n/no-hardcoded-text"]);
});

test("i18n/no-hardcoded-text ignores comments, logs, English, UI glyphs, keys and types", async () => {
	const code = [
		"// 注释不算",
		"/** 文档注释也不算 */",
		"export type Lang = \"中文\";",
		"export const GLYPHS = [\"›\", \"•\", \"▸\", \"◰\", \"…\", \"├─┤\", \"café\"];",
		"export const KEYS = { \"中文键\": 1 };",
		"export function log(): void {",
		"\tconsole.log(\"日志不算\", [\"嵌套\"].join(\"\"));",
		"}",
		"",
	].join("\n");
	assert.deepEqual(await i18nProblems(code), []);
});

test("i18n/no-hardcoded-text only applies to src (tests keep their CJK fixtures)", async () => {
	assert.deepEqual(await i18nProblems("export const S = \"中文字符测试\";\n", "test/demo.test.ts"), []);
});
