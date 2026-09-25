/**
 * ESLint 配置（flat config）。
 *
 *   npm run lint       检查整个项目
 *   npm run lint:fix   自动修复能修的（缩进、未使用的 import、引号 / 分号 / 尾逗号……）
 *
 * push 前 .husky/pre-push → scripts/pre-push.mjs 会再跑一遍，不通过就拒绝 push。
 * 规则只收紧项目里已经在遵守的写法（见 CLAUDE.md 的"代码风格"），不引入新的格式化风格。
 */

import js from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import { defineConfig, globalIgnores } from "eslint/config";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";
import tseslint from "typescript-eslint";
import i18n from "./scripts/eslint-plugin-i18n.mjs";

/** `const foo = () => {}` / `const foo = function () {}` at the top level of a module. */
const TOP_LEVEL_FUNCTION_EXPRESSION = [
	"Program > VariableDeclaration > VariableDeclarator > :matches(ArrowFunctionExpression, FunctionExpression)",
	"Program > ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > :matches(ArrowFunctionExpression, FunctionExpression)",
	"Program > ExportDefaultDeclaration > ArrowFunctionExpression",
].join(", ");

export default defineConfig([
	globalIgnores(["node_modules/", "dist/", ".codegraph/"]),

	{
		name: "project/base",
		files: ["**/*.{js,mjs,cjs,ts}"],
		// @stylistic 的预设：tab 缩进（和 .editorconfig 一致）、双引号、分号、多行尾逗号、1tbs 大括号……
		extends: [
			js.configs.recommended,
			stylistic.configs.customize({
				indent: "tab",
				quotes: "double",
				semi: true,
				commaDangle: "always-multiline",
				braceStyle: "1tbs",
				arrowParens: true,
				quoteProps: "as-needed",
				jsx: false,
			}),
		],
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "module",
			globals: globals.node,
		},
		linterOptions: { reportUnusedDisableDirectives: "error" },
		plugins: { "unused-imports": unusedImports },
		rules: {
			// 预设之外按项目现有写法微调：字符串里有双引号时允许单引号；二元运算符放行尾、
			// 三元的 ? : 和类型联合的 | & 放行首（和现有代码一致）；类成员之间不强制空行
			"@stylistic/quotes": ["error", "double", { avoidEscape: true, allowTemplateLiterals: "always" }],
			"@stylistic/operator-linebreak": ["error", "after", { overrides: { "?": "before", ":": "before", "|": "before", "&": "before" } }],
			"@stylistic/lines-between-class-members": "off",
			// 终端 UI 要匹配 ANSI 转义序列（\x1b），正则里的控制字符是故意的
			"no-control-regex": "off",

			// 未使用的 import 报错，`npm run lint:fix` 会直接删掉；未使用的变量 / 参数报错（_ 开头的放行）
			"no-unused-vars": "off",
			"unused-imports/no-unused-imports": "error",
			"unused-imports/no-unused-vars": [
				"error",
				{ vars: "all", args: "after-used", argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true },
			],

			// 顶级函数用 function 声明，不写成箭头函数（CLAUDE.md 代码风格第 1 条）；函数里面的箭头函数不限
			"no-restricted-syntax": [
				"error",
				{
					selector: TOP_LEVEL_FUNCTION_EXPRESSION,
					message: "Top-level functions are function declarations: write `function name() {}` instead of `const name = () => {}`.",
				},
			],

			eqeqeq: ["error", "always", { null: "ignore" }],
		},
	},

	{
		name: "project/typescript",
		files: ["**/*.ts"],
		extends: [tseslint.configs.recommended],
		rules: {
			// 由 unused-imports 接管（它能自动删掉未使用的 import）
			"@typescript-eslint/no-unused-vars": "off",
			// 只用作类型的导入写成 `import type` / `{ type X }`（CLAUDE.md 第 5 条；tsc 的 verbatimModuleSyntax 也会查）
			"@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
			// 本地导入必须带 .ts 扩展名（CLAUDE.md 第 5 条）
			"no-restricted-imports": [
				"error",
				{ patterns: [{ regex: "^\\.{1,2}/(?!.*\\.ts$)", message: "Local imports spell out the .ts extension." }] },
			],
			// 命名：函数 / 变量 / 参数 camelCase（常量可以 UPPER_CASE），类型 PascalCase；
			// 对象 / 类型里的属性名不限（键位表的 "session-resume"、pi 数据里的字段名等）
			"@typescript-eslint/naming-convention": [
				"error",
				{ selector: "default", format: ["camelCase"], leadingUnderscore: "allow" },
				{ selector: "function", format: ["camelCase"] },
				{ selector: "variable", format: ["camelCase", "UPPER_CASE"], leadingUnderscore: "allow" },
				{ selector: "typeLike", format: ["PascalCase"] },
				{ selector: ["objectLiteralProperty", "objectLiteralMethod", "typeProperty", "typeMethod"], format: null },
				{ selector: "import", format: null },
			],
		},
	},

	{
		// 界面文案走 t()：src 里不许写死非英文的字符串（注释、console 日志不算）
		name: "project/i18n",
		files: ["src/**/*.ts"],
		plugins: { i18n },
		rules: { "i18n/no-hardcoded-text": "error" },
	},
]);
