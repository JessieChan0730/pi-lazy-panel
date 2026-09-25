/**
 * Local ESLint plugin: `i18n/no-hardcoded-text`.
 *
 * 界面文案一律走 src/i18n 的 t()（CLAUDE.md 第 13 条）。这条规则找出写死在代码里的非英文字符串：
 * 字符串 / 模板字符串里出现非拉丁字母（中日韩、西里尔、阿拉伯……）或全角标点就报错。
 * 英文文案靠这种办法分辨不出来是不是漏了 t()，所以只查非英文。
 *
 * 不算的：注释（本来就不是字符串节点）、日志（console.* 的参数）、类型位置的字面量、
 * import / export 的路径、对象和类的键名、正则。确实要写死的（比如按文字范围判断的数据）用
 * `// eslint-disable-next-line i18n/no-hardcoded-text -- 原因` 放行。
 *
 * eslint.config.js 只对 src 打开它；push 前 scripts/pre-push.mjs 只拿它查本次推送改动过的文件。
 */

/**
 * A letter from a script other than Latin (Han, Kana, Hangul, Cyrillic, Arabic, …),
 * or CJK / full-width punctuation. Box drawing, arrows, emoji and other symbols
 * are script "Common" and not letters, so the UI glyphs (›, •, ▸, ◰, …) pass.
 */
const NON_ENGLISH = /(?![\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}])\p{L}|[\u3000-\u303f\uff00-\uffef]/u;

/** Parents whose string child is a module path, not text. */
const MODULE_PATH_PARENTS = new Set([
	"ImportDeclaration",
	"ExportAllDeclaration",
	"ExportNamedDeclaration",
	"ImportExpression",
	"TSExternalModuleReference",
	"TSImportType",
	"TSModuleDeclaration",
]);

/** Parents whose `key` is a property / member name, not text. */
const KEYED_PARENTS = new Set([
	"Property",
	"PropertyDefinition",
	"MethodDefinition",
	"AccessorProperty",
	"TSPropertySignature",
	"TSAbstractPropertyDefinition",
	"TSAbstractMethodDefinition",
]);

/** `console.log(…)`, `console.error(…)`, …: logs are not UI text. */
function isConsoleCall(node) {
	return (
		node.type === "CallExpression" &&
		node.callee.type === "MemberExpression" &&
		node.callee.object.type === "Identifier" &&
		node.callee.object.name === "console"
	);
}

/** Is the string `node` (with these ancestors, outermost first) something other than UI text? */
function isExempt(node, ancestors) {
	const parent = ancestors.at(-1);
	if (!parent) return false;
	if (MODULE_PATH_PARENTS.has(parent.type)) return true;
	if (KEYED_PARENTS.has(parent.type) && parent.key === node && !parent.computed) return true;
	if (parent.type === "TSEnumMember" && parent.id === node) return true;
	// 类型位置：type Lang = "中文"
	if (parent.type === "TSLiteralType") return true;
	// "use strict" 这类指令
	if (parent.type === "ExpressionStatement" && parent.directive) return true;
	// 日志：console.* 的参数里（含嵌套的表达式）都不算
	return ancestors.some(isConsoleCall);
}

/** The offending text, shortened for the message. */
function preview(text) {
	const flat = text.replace(/\s+/g, " ").trim();
	return JSON.stringify(flat.length > 40 ? `${flat.slice(0, 40)}…` : flat);
}

/** @type {import("eslint").Rule.RuleModule} */
const noHardcodedText = {
	meta: {
		type: "problem",
		docs: { description: "Disallow hardcoded non-English text; UI text goes through t() from src/i18n" },
		messages: {
			hardcoded: "Hardcoded non-English text {{text}}: add it to src/i18n/locales/{en,zh}.json and render it with t().",
		},
		schema: [],
	},
	create(context) {
		const sourceCode = context.sourceCode;
		function check(node, text) {
			if (!NON_ENGLISH.test(text)) return;
			if (isExempt(node, sourceCode.getAncestors(node))) return;
			context.report({ node, messageId: "hardcoded", data: { text: preview(text) } });
		}
		return {
			Literal(node) {
				if (typeof node.value === "string") check(node, node.value);
			},
			// 模板字符串按整体报一次（`${}` 两边的片段拼起来看）
			TemplateLiteral(node) {
				check(node, node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join(""));
			},
		};
	},
};

export default {
	meta: { name: "eslint-plugin-i18n (local)" },
	rules: { "no-hardcoded-text": noHardcodedText },
};
