/**
 * 提交消息检查：约定式提交（Conventional Commits），例如 `fix(sessions): optimize ui`。
 * commit 时由 .husky/commit-msg 检查一次，push 前 scripts/pre-push.mjs 再把要推的提交都查一遍。
 * Merge / Revert / fixup! 这类 git 自动生成的消息默认跳过。
 */
export default {
	extends: ["@commitlint/config-conventional"],
};
