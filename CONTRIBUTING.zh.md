[English](./CONTRIBUTING.md) | **中文**

# 为 pi-lazy-panel 做贡献

感谢你有兴趣改进 pi-lazy-panel！本指南介绍本地环境搭建、项目强制的规范，以及如何让改动被合并。它与 [CLAUDE.md](./CLAUDE.md) 中的规则一致——有疑问时，以那份文件为准。

## 前置条件

- **Node.js ≥ 20**
- 已安装 **[pi](https://pi.dev)**（面板作为 pi 插件运行，仅在 TUI 模式下可用）

## 快速开始

pi 相关的包是 `devDependencies`，**默认不会自动安装**——克隆后必须先安装依赖：

```bash
npm install            # 安装依赖（含 pi 相关包）并装好 git 钩子
npm run dev            # 用 pi -e ./src/index.ts 临时加载插件，不写配置
npm run install:pi     # pi install . 把本目录注册进 pi（只需一次）
```

执行 `install:pi` 后，改完代码在 pi 里输入 `/reload` 即为最新——没有构建步骤，pi 直接加载 `src/index.ts`。

## 项目结构

代码严格分层：上层可以依赖下层，下层禁止依赖上层。

```
src/
├── index.ts      # 入口：注册 /lazy-panel，仅限 TUI 模式
├── types.ts      # 只放共享类型（禁止运行时代码）
├── constants.ts  # 常量（id、布局比例、键位 scope……）
├── ui/           # 渲染层（pi-tui 组件）；不做 I/O，不调用 pi 会话 API
├── actions/      # 副作用层：每个函数包装一个 pi 命令/API
├── data/         # 只读适配 pi 的 SessionManager，产出纯数据行
├── config/       # keymap、chord 解析、用户配置、pi 设置
├── i18n/         # 唯一知道 i18next 的层
└── utils/        # 纯格式化 / 路径工具
```

完整的带注释目录树、数据流与键位解析说明见 CLAUDE.md。安装后 pi 的扩展 API 文档在 `node_modules/@earendil-works/pi-coding-agent/docs/`——涉及 pi / pi-tui API 时先查文档，不要猜。

## 代码风格

格式规范由 `.editorconfig`（tab 缩进、LF）和 `eslint.config.js` 强制。提交前跑 `npm run lint`（或 `npm run lint:fix`）。

- 顶级函数优先用具名函数声明，不要用箭头函数。
- 本地导入必须显式包含 `.ts` 扩展名；仅类型导入必须使用 `import type`。
- 欢迎在关键代码上写中文注释（方便 review）；但 `src` 里不许写死非英文 **UI 文案**（lint 规则 `i18n/no-hardcoded-text` 会揪出字符串里的非拉丁字母 / 全角标点）。
- 模块之间尽量低耦合。

### 国际化（i18n）

- 所有 UI 文案走 `src/i18n` 的 `t()`；`src/i18n/locales/en.json` 和 `zh.json` 两份同步维护（**英文是基准**）。
- **禁止**在模块顶层用 `t()` 计算 `export const`（import 期求值早于 `initI18n`）——需要文案的地方写成函数、渲染时才调用。
- 跑 `npm run i18n:check` 确认两份语言对齐。

### 跨平台

一定要写跨平台代码，不要使用某些平台特有的特性。例如：不要写死 `~/` 这样的字面路径（在 Windows 下会报错），用 `src/utils/paths.ts` 里的工具。

### 依赖

- `@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui` 和 `typebox` 必须保留在 `peerDependencies` 中，版本号设为 `*`。**严禁**打包（bundle）或作为本地依赖（vendor）包含。
- 普通的新依赖（如 i18next）照常放 `dependencies`。

### 几条硬性规则

- 执行破坏性操作（删除、fork……）前，必须先通过 `ui/widgets/confirm-dialog.ts` 确认。
- 对话内容渲染只能用 `@earendil-works/pi-tui` 的 `Markdown` 组件——禁止引入其它 Markdown 库。
- 保留 `src/index.ts` 里的 `ctx.mode !== "tui"` 判断；`/lazy-panel` 仅限 TUI 模式。

## 测试与检查

```bash
npm run lint           # ESLint
npm run check          # tsc --noEmit
npm test               # 单元测试
npm run i18n:check     # 中英文案对齐
```

- 运行单个测试文件：`node --import tsx --test test/ui.test.ts`
- 按名称过滤：`node --import tsx --test --test-name-pattern="frame" test/ui.test.ts`

推送前把这四项都跑一遍——`pre-push` 钩子会跑同一套检查（共六项），任何一项失败就拒绝 push。不要用 `--no-verify` 绕过。

## 提交与 Pull Request

- 提交消息遵循[约定式提交 (Conventional Commits)](https://www.conventionalcommits.org/)，用**英文**书写，例如 `fix(sessions): optimize ui`。每次提交由 `commit-msg` 钩子跑 `commitlint` 校验。
- 纯文档提交用固定消息：`chore(doc): update doc by $what`（例如 `chore(doc): update doc by README, keybindings`）。
- 新增键位/动作时，要同时改：`ActionId` 联合类型、默认键位、`ACTION_DESCRIPTIONS`、`dispatch` 分发，以及 `docs/keybindings.md`。
- Pull Request 提交到 `main` 分支，说明改了什么、如何验证的。

## 许可证

提交贡献即表示你同意你的贡献以 [MIT 许可证](./LICENSE)授权。
