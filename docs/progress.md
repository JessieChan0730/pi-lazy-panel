## 项目开发进度

### 基础目录搭建

- ~~完成项目基础目录结构搭建~~

### 基础 UI 搭建

- ~~完成基础UI结构搭建，终端绘制 resume,tree,context三个面板，里面的数据需要全部正常显示，UI要显示正确，本次任务，不做任何快捷键操作（包括 j/k 上下移动）就做一个静态的界面就行，里面的数据显示正确，UI正确就行, 快捷键交给下个任务，任务完成后告诉我你使用的技术。~~

### 完成部分通用快捷键功能

- ~~帮我完成下面的快捷键功能，注意：~~

~~1. 需要开始能够自定义快捷键了，自定的快捷键能覆盖这些默认的快捷键，并且能使用组合键~~
~~2. 完成下面的快捷键的功能：~~
~~table： 用于切换不同 pane(面板)的foucs(焦点)，聚焦在不同的面板上，快捷键会有不同的表现~~
~~C/A：切换列表 mode （Current Folder | All）~~
~~?: 快捷键提示菜单, 不同的面板提示不同的快捷键。~~
~~exit/q： 退出插件, 这个已经完成~~
~~/: 底部出现 搜索：两个字样，随后用户输入内容回车进行搜索，只搜索当前fouce的,文本需要高亮，使用 n/N 可以上一个和下一个，具体参考lazygit的形式，这个任务不需要完成搜索功能，只需要帮我完成这个效果，按下 / 键，显示搜索字样~~

实现说明（2026-09-21）：

- 键位解析/匹配：`src/config/keys.ts`（chord → pi-tui key id 序列，支持 `ctrl+d`、`G`=shift+g、`gg` 多键序列）；面板键位优先于 global。
- 用户配置：`src/config/config.ts` 读取 `~/.pi/agent/lazy-panel.json`，按 scope/action 深合并，`null` 解绑，非法值给出 footer 警告。写法见 `docs/keybindings.md`。
- UI：`ui/widgets/help-overlay.ts`（居中弹窗，内容来自最终 keymap）、`ui/widgets/search-bar.ts`（包装 pi-tui `Input`，底部显示 `搜索:`，Enter 记录 query，Esc 取消）、footer 提示改为由 keymap 生成。
- 尚未实现（后续任务）：搜索匹配/高亮与 n/N 跳转、各面板内的 j/k/gg/G 等动作（按下会在 footer 提示 `not implemented yet`）。

### 快捷键调整（2026-09-21）

- ~~CONTENT 面板改为只读轻操作：只保留 j/k/方向键、gg/G，删掉 h/l 光标、b/e、zz、v、y/yy 这些 vim 编辑键（配置、? 帮助、footer 提示一并移除）。~~
- ~~面板切换改为 lazygit 风格：h 上一个、l 下一个（tab 仍可用作下一个），去掉 shift+tab。~~
- ~~面板标题加数字标记 `[1] SESSIONS` / `[2] TREE` / `[3] CONTENT`，按 1/2/3 直接跳到对应面板；标记来自最终 keymap，重绑 `focus-<pane>` 后标题同步变化。~~
- ~~C / A 拆成两个单向动作 `scope-current` / `scope-all`：C 只切到 Current Folder，A 只切到 All，重复按不做 toggle。~~
- ~~tree 面板打标签改为 `T`（和 pi 自带 `/tree` 的 shift+T 一致），`l` 在所有面板都统一为“下一个面板”，不再被遮住。~~
- ~~修复回归：`[1]` 标题前缀占掉 4 列后，Current 模式下 SESSIONS 标题右侧的 `1/15 · Current · recent` 在常见宽度下整段消失。现在 meta 按预算逐级缩短（`frame.ts` 的 `metaBudget` + `sessions-pane.ts` 的 `sessionsMeta`），两种模式都能看到位置和模式；footer 只提示另一个 scope（Current 时显示 `A All`，All 时显示 `C Current`）。`test/panel.test.ts`、`test/ui.test.ts` 加了回归测试。~~

### 基础移动快捷键

- ~~完成 session tree context 的 j/k 方向键的上下移动~~
- ~~完成 session tree context 的 gg 和 G 的滚动到顶部和底部的快捷键操作~~
- ~~完成 session  J/K 移动右侧 context 的快捷键的功能~~

注意:

1. ~~session 切换不同的对话的时候，下面的tree也要跟着改变~~
2. ~~tree 选中不同的节点的时候，右侧的content，能否用一种方式来选中对应的 nodes 的那句对话，我想着可以加个箭头或者说背景色啥的？~~

实现说明（2026-09-21）：

- SESSIONS / TREE：j/k/↑/↓ 移动一行，gg/G 到顶部/底部，边界处 clamp 不回绕。
- SESSIONS 光标变化 → 40ms 防抖后重新加载 TREE + CONTENT（连续按住 j 只加载最后停下的那个会话，过期结果丢弃）。
- TREE 光标变化 → CONTENT 高亮对应消息：消息框头部加 `›` 箭头 + 选中背景，并把该消息滚到面板顶部。节点在当前分支里只高亮；节点在另一条分支上时按“以该节点为叶子”重新加载分支再高亮；工具结果这类没有消息框的节点高亮它前面最近的一条消息。
- CONTENT：j/k 按行滚动，gg/G 到顶部/最后一页；SESSIONS 里 J/K 按半屏滚动右侧内容，光标不动。内容排版（Markdown 渲染）按宽度/高亮缓存，只在数据或宽度变化时重算；窗口变小时滚动位置自动夹回。
- `test/panel.test.ts` 加了三组测试覆盖以上行为。
- 修正：`assistant: (empty)`（中断/失败产生的空回复）在 tree 里归为 meta，默认过滤下隐藏，`a` 全部模式仍可见；活动分支上没有消息框的节点（工具结果、空回复）不再截断右侧内容，而是保持完整分支并高亮它前面最近的一条消息。

### TREE 面板节点操作（2026-09-21）

- ~~y：复制光标所在节点的消息内容到剪贴板（对应 pi 自带 `/tree` 的 ctrl+x）。~~
- ~~T：给光标所在节点添加 label，底部弹出输入框，回车保存、Esc 取消，空内容清除 label（对应 `/tree` 的 shift+T；不用 `l` 是为了把 `l` 留给全局的"下一个面板"）。~~
- 打完标签后 `/` 搜索要能按 label 搜索（搜索功能本身另开任务，本次不做）。

实现说明（2026-09-21）：

- 分层：`data/tree.ts` 新增 `loadNodeText`（和 `/tree` ctrl+x 一样：消息取全部 text 片段原文、bash 执行取命令、没正文的 assistant 回复取 errorMessage、compaction / branch summary 取摘要）；`actions/tree-actions.ts` 实现 `copyNodeText`（pi 的 `copyToClipboard`）和 `labelNode`；UI 通过 `LazyPanel` 新增的 `ActionSource` 接口调用，面板本身仍不做 I/O，`index.ts` 负责组装。
- 打标签落盘：如果目标就是 pi 当前打开的会话，走 `pi.setLabel` 让 pi 内存里的 SessionManager 同步；其他历史会话用 `SessionManager.open(file).appendLabelChange` 直接追加 label 条目到 .jsonl。保存后重新加载 TREE，光标停在同一节点上，行首显示 `[label]`；在 `L`（labeled）过滤下清掉标签会让该行消失，光标夹回范围内。
- 输入框：抽出通用的底部一行输入 `ui/widgets/prompt-bar.ts`（包装 pi-tui `Input`），搜索栏和 `ui/widgets/label-bar.ts`（`Label:` 前缀，预填当前标签）都基于它；新增 `PanelMode` 的 `label` 模式，该模式下所有按键交给输入框。
- 反馈都在 footer：`copied node text to clipboard` / `selected entry has no text to copy` / `label set: xxx` / `label removed` / 失败原因。
- 测试：`test/panel.test.ts` 加了 y / T 的面板行为测试（含错误分支和无 actions 的情况）；新增 `test/tree-actions.test.ts` 在临时目录里建真实会话文件，验证 `loadNodeText` 和 `labelNode` 的落盘与 `pi.setLabel` 分流。

### TREE 打标签改为居中弹窗（2026-09-22）

- ~~T 打标签的输入框从底部一行改成面板中央弹出的输入框（类似 lazygit commit 的效果）：标题 `Label`，右侧显示被打标签的节点（`assistant: …`），回车保存、Esc 取消、空内容清除；按键提示放在底部 footer（`LABEL │ Enter save  Esc cancel  empty removes`）。~~

实现说明（2026-09-22）：

- 新增 `ui/widgets/label-dialog.ts`（`LabelDialog`）：包装 pi-tui `Input`，5 行高的居中方框，预填当前标签且光标停在末尾（直接退格就能清空）；删除原来的 `ui/widgets/label-bar.ts`，`prompt-bar.ts` 现在只被搜索栏使用。
- `ui/frame.ts` 抽出 `overlayCentered`（居中叠加，基于 pi-tui `compositeTuiLine`），帮助弹窗和标签弹窗共用；后续的确认框 / 会话信息弹窗也可以直接用。
- `ui/widgets/footer.ts` 新增 `hints` 参数：弹窗打开时 footer 显示弹窗自己的按键提示，而不是当前面板的键位；`types.ts` 新增 `KeyHint` 类型给 footer / prompt-bar / label-dialog 共用。
- `test/panel.test.ts` 的 T 测试改为断言弹窗画在面板中间、标题带节点信息、footer 带提示、Enter/Esc 后弹窗消失；`test/ui.test.ts` 加了 `overlayCentered` 的几何测试。

### 输入弹窗通用化 + 压缩高度（2026-09-22）

- ~~Label 弹窗从 5 行（上下各留一行空白）压到 3 行：边框、输入行、边框。~~
- ~~输入弹窗抽成通用组件，后续给 session 起名（`/name`）等场景直接复用，不再各写一个。~~

实现说明（2026-09-22）：

- 新增 `ui/widgets/input-dialog.ts`（`InputDialog`）：标题、预填值、标题栏右侧说明、footer 提示和 onSubmit / onCancel 都在 `open(spec)` 时传入，`isOpen` / `hints` 供 app.ts 决定是否叠加弹窗和 footer 显示什么；`close()` 只清状态不触发回调。
- `ui/widgets/label-dialog.ts` 缩减为打标签的预设，只剩 `LABEL_DIALOG_TITLE` / `LABEL_DIALOG_HINTS`；`app.ts` 持有一个 `inputDialog`，按键路由、叠加渲染、footer 都改为看 `inputDialog.isOpen`，不再写死 `mode === "label"`。
- 新增场景的做法：写一个预设（标题 + 提示），在动作里 `this.inputDialog.open({...})` 并把 `state.mode` 设成对应模式（footer 左侧显示的大写模式名）。
- 测试：`test/panel.test.ts` 加了 `InputDialog` 的组件测试（3 行、宽度、二次 open 换 spec 和回调）；T 测试补了底边框紧贴输入行的断言。

### Enter 恢复会话 / 跳转节点（2026-09-22）

背景：目前插件只能"看"，不能"用"。三个面板的浏览、y 复制、T 打标签都有了，但选中一个会话或节点之后没有办法进入它。这一步要把 `/resume` 和 `/tree` 两个核心命令的本体接进来，让面板真正可用。

- ~~SESSIONS 面板 Enter：切换到光标所在会话（对应 `/resume`），成功后关闭面板回到 pi 对话。~~
- ~~TREE 面板 Enter：以光标所在节点为叶子恢复会话（对应 `/tree` 的 restore），成功后关闭面板。pi 自带的 `/tree` 在离开分支时会问 No summary / Summarize / Summarize with custom prompt，本次只做 No summary，选择弹窗后续再加。~~
- ~~分流：目标是 pi 当前打开的会话时走 pi 内存里的 API；目标是其他历史会话时先切会话再 restore。分流方式和 T 打标签的 `pi.setLabel` / `SessionManager.open` 一致，尽量复用。~~
- ~~光标节点就是当前活动叶子时，Enter 等价于直接切到该会话，不重复 restore。~~
- ~~如果 pi 正在流式输出或有未完成的工具调用，切换前是否需要确认，取决于 pi API 的行为，动手前先查 `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`，不猜。~~
- ~~失败原因（文件不存在、节点不存在、API 拒绝）在 footer 提示，不关闭面板。~~
- ~~键位：Enter 在 SESSIONS / TREE 两个 scope 各绑一个 ActionId，同步更新 `ACTION_DESCRIPTIONS`、? 帮助、footer 提示和 `docs/keybindings.md`。~~
- ~~测试：`test/panel.test.ts` 补面板行为（Enter 调用 actions、失败不关闭）；`test/tree-actions.test.ts` 或新建 `test/session-actions.test.ts` 用临时会话文件验证分流。~~

实现说明（2026-09-22）：

- 先查了 pi 0.85.1 的行为（`docs/extensions.md` + `dist/core/agent-session.js`、`dist/modes/interactive/interactive-mode.js`）：`ctx.switchSession` 内部会先 `session.abort()` 再切换，内置 `/resume` 不做确认；`ctx.navigateTree` 在流式输出时直接抛错 "Wait for the current response to finish…"，内置 `/tree` 的做法是用户选定节点后先中断当前回复再跳。插件照搬：SESSIONS Enter 直接交给 `switchSession`；TREE Enter 在 `!ctx.isIdle()` 时先 `ctx.abort()` + `ctx.waitForIdle()`（最多等 15s，超时进 footer）。两者都不弹确认框，和 pi 自带命令一致。
- 分层：`actions/session-actions.ts` 的 `resumeSession`（目标是当前会话直接返回 `unchanged`；否则先 `existsSync` + `SessionManager.open` 确认文件能读，再 `switchSession`，被取消就抛错）；`actions/tree-actions.ts` 的 `restoreNode`（当前会话走 `ctx.navigateTree(id, { summarize: false })`；其他会话 `switchSession(file, { withSession })`，在 pi 交给 `withSession` 的新 ctx 里 navigate——切换后旧 ctx 已失效，不能复用）。"是不是当前会话"抽成 `isCurrentSession`（比较 `path.resolve` 后的路径），打标签也改用它。
- "光标就是活动叶子"的判断：pi 把 label / `/name` / 模型切换这些记账条目也追加成新叶子，刚打完标签的最后一条消息已经不是 `getLeafId()`。`data/tree.ts` 新增 `isEffectiveLeaf`：节点就是叶子，或它在活动分支上且后面只剩记账条目（label、session_info、model_change、thinking_level_change、custom）就算"已在叶子"，不再 restore（否则会把这些尾部条目甩到分支外，比如把刚切的模型切回去）。用户消息不适用：pi 恢复到用户消息是把叶子移到它父节点并把内容填回编辑器，属于真正的变化。
- 面板：`ActionSource` 新增 `resumeSession` / `restoreNode`；`dispatch` 里 `session-resume` / `tree-restore` 走统一的 `enter()`：等待期间 footer 显示 `resume…` / `restore…`，面板通过 `LazyPanelOptions.setHidden`（`index.ts` 用 `ctx.ui.custom` 的 `onHandle` 拿到 overlay 句柄）暂时隐藏且忽略所有按键——pi 切换时可能自己弹提示（会话目录已不存在时问要不要在当前目录继续），面板藏起来它才看得见、按键才到得了它。成功后 `close()`；失败重新显示面板，footer 显示 `resume failed: …` / `restore failed: …`。切换成功时 pi 会在 `session_shutdown` 后自己收掉扩展的 overlay，面板随后的 `done()` 只是让 `ctx.ui.custom` 的 promise 结束。
- 切换成功但在新会话里 restore 失败：面板已被 pi 收掉，抛不回 footer，改用新 ctx 的 `ui.notify` 报错，结果算 `switched`（人已经在目标会话里，只是叶子没动）。
- 键位、`ACTION_DESCRIPTIONS`、footer 提示（`Enter Resume` / `Enter Restore`）之前就有，这次只接上 `dispatch`。
- 测试：`test/panel.test.ts` 加了 Enter 的面板行为（调用 actions、成功关闭、失败留在 footer 且面板重新显示、等待期间忽略按键、无 actions 提示）；新增 `test/session-actions.test.ts` 用临时会话文件验证 `isEffectiveLeaf` 与 `resumeSession` / `restoreNode` 的分流（当前会话 / 其他会话 / 文件缺失 / 节点缺失 / 取消 / 非 idle 先 abort / withSession 里只用新 ctx）。

### TREE Enter 的摘要选择菜单（2026-09-22）

背景：TREE 面板 Enter 目前只做 No summary（`navigateTree(id, { summarize: false })`）。pi 自带的 `/tree` 在选定节点后会先问 No summary / Summarize / Summarize with custom prompt，选 Summarize 会让模型给被放弃的那段分支写一段摘要接在目标节点后面（`branch_summary` 条目）。要把这三个选项补齐。

- ~~新增居中的选择弹窗 `ui/widgets/select-dialog.ts`（类似 lazygit 的菜单）：标题 + 若干选项，j/k/方向键移动，Enter 确认，Esc 取消；footer 显示弹窗自己的按键提示。和 `InputDialog` 一样做成通用组件，后续删除确认、排序切换等场景直接复用。~~
- ~~TREE Enter：光标节点不是活动叶子时先弹三选菜单；Esc 退回 tree 面板、什么都不做（pi 的做法是退回 tree 选择器）；光标节点就是活动叶子时照旧不弹菜单、直接进入。~~
- ~~Summarize with custom prompt：选中后再用 `InputDialog` 输入自定义指令（pi 用的是多行编辑器，先用单行；Esc 退回三选菜单，和 pi 一致）。~~
- ~~pi 有 `branchSummary.skipPrompt` 设置（`docs/settings.md`），为 true 时内置 `/tree` 不问、直接 No summary。扩展 ctx 上没看到读 settings 的 API，动手前先查能不能读到（可能要用 `getAgentDir()` 直接读 `settings.json`），不猜；读不到就先不支持并记到 issues.md。~~
- ~~actions：`restoreNode` 加 `{ summarize, customInstructions }` 参数透传给 `ctx.navigateTree`；其他会话的分流不变（`withSession` 里 navigate）。摘要需要模型，`ctx.model` 为空时 pi 会抛 "No model available for summarization"，照旧进 footer。~~
- ~~摘要期间 footer 显示 `summarizing branch…`。扩展 API 没有暴露 `abortBranchSummary`，从面板发起的摘要中途取消不了，只能等它跑完或失败，这一点写进 issues.md。`navigateTree` 返回 `{ aborted: true }` / `{ cancelled: true }` 或抛错时留在 footer、面板不关。~~
- ~~键位不变（还是 Enter）；更新 `docs/keybindings.md` 里 TREE Enter 的说明和 `docs/design.md` 里对应那行。~~
- ~~测试：`test/panel.test.ts` 补菜单行为（三项显示 / Esc 退回 / 自定义 prompt 输入 / 活动叶子不弹菜单）；`test/session-actions.test.ts` 补 `summarize` / `customInstructions` 的透传。~~

实现说明（2026-09-22）：

- 先查了 pi 0.85.1：扩展 ctx 上确实没有 settings API，但包导出了 `SettingsManager`，`SettingsManager.create(cwd, agentDir, { projectTrusted })` 只读文件（短暂加锁，不写），`getBranchSummarySkipPrompt()` 就是内置 `/tree` 用的那个判断。新增 `config/pi-settings.ts`（唯一读 pi 自己 `settings.json` 的模块）的 `loadPiSettings`，`index.ts` 打开面板时读一次，作为 `LazyPanelOptions.skipSummaryPrompt` 传给面板；读不到按 pi 默认值（不跳过）。
- 扩展 ctx 的 `navigateTree`（`interactive-mode.js` 的 `commandContextActions`）把 `AgentSession.navigateTree` 的 `{ cancelled, aborted }` 折叠成 `{ cancelled: true }`，面板分不出是摘要被中止还是被别的扩展否决，统一报 `restore failed: branch summary cancelled`（不做摘要时仍是 `restore cancelled by an extension`）。pi 对扩展发起的摘要也不显示自己的 `BranchSummaryStatusIndicator`，只有内置 `/tree` 才有。
- 弹窗：新增通用的 `ui/widgets/select-dialog.ts`（`SelectDialog`：标题 / 选项 / 初始光标 / 右上角说明 / footer 提示 / 回调都在 `open(spec)` 时传入，j/k/↑/↓ 移动、Enter 确认、Esc 取消，其他按键吞掉；高度 = 选项数 + 2，宽度和 `InputDialog` 共用 `frame.ts` 的 `dialogWidth`）。`ui/widgets/restore-dialog.ts` 是 TREE Enter 的预设：`Summarize branch?` 三项（顺序和 pi 一致）+ 菜单提示 + 自定义指令输入框的标题 / 提示。`PanelMode` 新增 `restore`（菜单和输入框打开时 footer 左侧显示 `RESTORE`）。
- 面板流程（`app.ts`）：Enter → `restoreTreeNode`：光标行 `isLeaf` 或 `skipSummaryPrompt` 时直接 `restoreNode(..., { summarize: false })`；否则 `openSummaryMenu`。菜单 Esc → 关掉、什么都不做；No summary / Summarize → 直接进入；custom → `openCustomPrompt`（`InputDialog`），Esc 退回菜单且光标停在 custom 那一项，Enter 把去掉首尾空白的文本作为 `customInstructions`（空则只 `summarize: true`，用 pi 默认指令）。三种情况都走原来的 `enter()`（面板隐藏、忽略按键），只是等待期间 footer 文字改成 `summarizing branch…`（`constants.ts` 的 `SUMMARIZING_STATUS`）。
- "光标就是活动叶子"的判断放到数据层：`data/tree.ts` 新增 `effectiveLeafIds`（从叶子沿活动分支往上走一次算出整组），`isEffectiveLeaf` 改为查这个集合，`loadTree` 给对应行打 `TreeRow.isLeaf`，面板据此决定弹不弹菜单；actions 里的 `restoreNode` 仍自己再判一次（用的是 pi 内存里的 manager，更准）。当前会话在无摘要跳转后的短暂过期问题记在 issues.md。
- actions：`restoreNode(ctx, file, entryId, options = { summarize: false })`，`options` 原样透传给 `navigateTree`（没有自定义指令时不带 `customInstructions` 键）。摘要期间面板是隐藏的，所以 `navigateTo` 用 `ctx.ui.setStatus("lazy-panel", "summarizing branch…")` 把进度写到 pi 自己的 footer，结束（含失败）后清掉；其他会话在 `withSession` 的新 ctx 上做同样的事。
- 测试：`test/panel.test.ts` 加了叶子行不弹菜单 / 菜单显示与 j/k/Esc / No summary / Summarize 期间 footer 与按键忽略 / custom prompt 往返与空指令 / `skipSummaryPrompt` / 摘要失败留在 footer，以及 `SelectDialog` 的组件测试；`test/session-actions.test.ts` 加了 `summarize` / `customInstructions` 透传、`setStatus` 进度、取消时的报错；`test/tree-actions.test.ts` 加了 `loadTree` 的 `isLeaf` 标记；新增 `test/pi-settings.test.ts` 用临时目录验证全局 / 项目两级 `skipPrompt` 和 `projectTrusted`。

### tree 面板调整（2026-09-22）

刚刚看了一下pi 的 /tree 命令的显示方案，发现是使用的树形结构，如下：

```txt
 • [system]
  ├⊟ [hello] user: hi
  │     [第三] assistant: Hello! I'm here to help you with your PiLazyPanel project. What would you like to work on today?
  ├⊟ [system]
  │  ├⊟ user: hi
  │  │     assistant: Hello! I'm an assistant that can help you with coding tasks, file operations, and various other things. How can I assist you today?
  │  │     user: hi
  │  │     assistant: Hello again! What can I help you with today?
  │  └⊟ user: hi
  │        assistant: Hello! 👋   I'm here to help you with your PiLazyPanel project. Feel free to ask me to: - Read and understand files - Execute commands - Edit co
  │        ├─ [branch summary]: No content to summarize
  │        └⊟ user: hi
  │              assistant: Hello! 👋   I'm here to help with your PiLazyPanel project. What would you like to work on today? I can: - Explore or debug code files - R
  └─ [branch summary]: The user explored a different conversation branch before returning here. Summary of that exploration:    ## Goal The user initiated a greeting
```

目前此插件的 tree 面板用的还是缩进的方式，这有点不美观，所以需要做如下修改：

1. ~~tree 面板左侧可以添加这些树形结构的线条~~
2. ~~目前tree面板太小了，肯定不能无限缩进，所以当层级超过3或者4层的时候可以省略，效果可以是... 或者其他的也行~~
3. ~~添加一个 a 快捷键，使用打开一个对话框，其中显示完整的树形结构，UI 可以参考 herdr 中 prefix + g 打开的对话框的效果~~
4. ~~对话框样式是顶部为搜索框，中间为完成的树形结构，底部是快捷键提示，可以做的足够大~~
5. ~~外面的tree面板保留 y/T 快捷键的功能，删除掉 / 和 d/t/u/l/a 这两个快捷键的功能(这个两个功能移动到对话框)，因为只是部分数据，所以搜索和过滤没啥作用~~
6. ~~对话框快捷键盘~~（2026-09-22 完成，见下面的实现说明）：

- ~~/ 搜索，聚焦到搜索框，实时搜索，用户输入关键字，下面列表实时改变~~
- ~~y: 复制消息内容（类似于 /tree 里面 ctrl + x 快捷键的功能）~~
- ~~T: 给某个节点添加 label，在面板中央弹出一个输入框（类似 lazygit commit 的弹窗；和 /tree 里面 shift+t 快捷键一致；不用 l 是为了把 l~~
- ~~d/t/u/l/a: 过滤（过滤 类似 /tree ：filters ctrl+d/t/u/l/a 快捷键的功能)~~（labeled 就用小写 l，和 pi 的 ctrl+l 一致）
- ~~j/k/方向键：上下移动~~
- ~~q: 退出对话框~~
- ~~exit: 如果当前聚焦在搜索框，则退出搜索框，聚焦在树形列表上，如果在树形列表上则直接退出对话框~~（搜索框里 Esc 只退出搜索模式，关键字和过滤结果保留，再按 / 接着改；Enter 在搜索框里没有含义）
- ~~enter: 和外面的tree面板表现一样即可~~
- ~~折叠 / 展开分支：和 pi /tree 一样，连接符上 `⊟` 表示可折叠、`⊞` 表示已折叠，折叠后隐藏该节点的所有后代；pi 只允许折叠"分支段的起点"（根节点，或父节点有多个子节点的节点），键位是 ctrl+← 折叠 / ctrl+→ 展开（不可折叠时改为跳到上 / 下一个分支段起点）。对话框里键位不和面板冲突，可以直接用 h 折叠 / l 展开。~~（2026-09-22 调整：h / l 去掉，只留 z、和面板一样切换；l 让给 labeled 过滤）
- ~o: 切换展示视图~ 这个暂时不做

实现说明（2026-09-22，对话框快捷键）：

- 键位走 keymap：新增 `tree-dialog` scope（`constants.ts` 的 `TREE_DIALOG_SCOPE` / `KEY_SCOPES`，`types.ts` 的 `KeyScope` 由它推导），`keys.ts` 新增 `scopeChain`：对话框里先查 `tree-dialog`、再查 `tree`、最后 `global`，所以 j/k/gg/G、Enter、y、T、z 直接沿用 tree 面板的绑定（用户改了面板键位对话框跟着变），`/` 沿用 global 的 search。对话框独有的动作：`tree-filter-default` / `-no-tools` / `-user` / `-labeled` / `-all`（d/t/u/l/a）、`tree-dialog-close`（q），用户配置写在 `keymap."tree-dialog"` 下，对话框自己的键遮住面板 / global 的同一个键（a 变成 all 过滤、l 变成 labeled 过滤而不是切面板、q 关的是对话框；h 没有对话框绑定，被 DISABLED_ACTIONS 吞掉）。`DISABLED_GLOBAL_ACTIONS` 改名 `DISABLED_ACTIONS`（按 scope 列出关掉的外层动作）：对话框里切面板、C/A、n/N、quit（含 ctrl+c）、help（? 不开帮助，键都在底部一行）、tree-open 全部吞掉。Esc 不走 keymap：搜索框里只退出搜索框（关键字和过滤结果保留，再按 / 接着改），列表上直接关对话框（两级规则）。
- 面板侧（`app.ts` 的 `handleTreeDialogInput` / `dispatchInTreeDialog`）：搜索框聚焦时所有键交给输入框；否则按上面的链解析，gg 之类的多键序列复用面板的 pending 缓冲。y / T / Enter 的实现改成接收 `TreeTarget`（文件 + 行）：面板传光标行、对话框传自己选中的行；Label 弹窗 / Summarize 菜单画在对话框上面（渲染顺序改为树对话框 → 输入框 / 菜单 → 帮助），关掉后 mode 回到 `tree`（`baseMode()`），restore 失败也留在对话框里。footer 在弹窗打开时也显示状态文字（之前只显示弹窗提示，copy / restore 的结果在对话框里看不见）；打开对话框时清掉面板里的旧提示。
- 搜索：`TreeDialog` 持有搜索框（`PromptBar`，`reset` 加了"光标放末尾"参数），每次按键把查询通过 `onQueryChange` 报给面板；面板用 `data/search.ts` 的 `parseSearchQuery` + `matchTreeRow` 过滤 `tree`（和 pi /tree 一样：每个词都要出现在 label + role + 正文里、不分大小写；正文是整条消息压成一行的文本，渲染时才截断，所以比 pi 只看前 200 字符更全；`tag:` 只看 label，`after:` / `before:` 看时间，`name:` / `model:` / `path:` 是会话搜索的、这里忽略；`parseSearchQuery` 现在真的拆 `key:value`，供以后的 SESSIONS 搜索复用），再经 `tree-fold.ts` 的 `filterTreeRows`（从 `applyTreeFilter` 里抽出来的"删行并重新挂父节点"）和 `applyTreeFold` 交回 `setRows`。标题的 `n/m` 是匹配行里的位置 / 数量。搜索期间折叠全部清空（pi 的做法，否则折叠段里的匹配看不见），第一次开始搜索时记住原折叠集合（`foldedBeforeSearch`），关键字删光或关对话框时恢复；搜索期间用 z 折的段下一次改关键字就被清掉（pi 一样）。Esc 退出搜索框回到列表、关键字保留（列表仍是过滤后的结果），再按 / 光标停在原关键字末尾接着改、删光即清除；Enter 在搜索框里没有含义。搜索框没焦点时那一行只显示关键字原文（不画光标），空的时候显示 `/ to search`（键名来自 keymap）。
- 折叠：z 和面板一样（`toggleFold` 抽成共用，对话框以搜索后的行为基准找段头）。折叠状态和面板共用（`state.treeFolded`）；光标所在行被搜索 / 过滤 / 折叠藏掉时落到最近还列出来的祖先上，没有就落到最后一行（`nearestListedIndex`，pi 的 `findNearestVisibleIndex`）。
- 过滤：d 直接回 default，t/u/L/a 再按一次回 default（pi 的 toggle）。过滤是面板级状态 `state.treeFilter`：重新 `loadTree(file, filter)`，折叠全部清空（pi 一样；不清的话 L 过滤下折叠的旁支会把带标签的行藏起来），面板的 TREE 之后也显示同一棵过滤后的树，标题在非 default 时显示 `2/12 · user-only`（`tree-pane.ts` 的 `treeMeta`，放不下就只留位置）。pi 自己的 `treeFilterMode` 设置（内置 /tree 的默认过滤，`labeled-only` 对应这里的 `labeled`）作为面板打开时的初始过滤（`pi-settings.ts`）。
- 关闭：q / Esc 后面板光标跳到对话框选中的行，藏在折叠段里就把它的祖先展开（`foldedAncestors`），右侧 CONTENT 跟着高亮。
- 提示：对话框底部一行和 footer 都由最终 keymap 生成（`keymap.ts` 的 `TREE_DIALOG_FOOTER` + `TREE_DIALOG_HINT_TEXT`，`d/t/u/l/a filter` 这类合并成一条），放不下的从后面丢（100 列时 `T label` 先没了，`q close` 排得靠前）；对话框里不做 ? 帮助（键已经都在底部一行了），`help-overlay.ts` 的 `focus` 顺手改成了 `KeyScope`、按 `scopeChain` 列各层的键。
- 测试：`test/panel.test.ts` 加了对话框的移动 / y / T / Enter（含菜单、失败后留在对话框）/ 搜索（实时过滤、Esc 保留关键字回列表、Enter 无效、删光后折叠恢复、关闭时展开并选中）/ 标签与 `tag:` 搜索 / 过滤（toggle、折叠清空、面板标题）/ z / 被禁用的全局键（含 h、?）；`test/ui.test.ts` 加了 `nearestListedIndex`、`foldedAncestors`、`filterTreeRows`、`treeMeta`、`TreeDialog` 搜索行；新增 `test/search.test.ts`；`test/keymap.test.ts` 加了 scope 链和 `tree-dialog` 覆盖；`test/pi-settings.test.ts` 加了 `treeFilterMode`。
- 调整（2026-09-22，按反馈）：去掉 h / l（`tree-fold-or-up` / `tree-unfold-or-down` 连同 `segmentStartAbove` / `segmentStartBelow` 一并删除），labeled 过滤改为小写 l；对话框里去掉 ?；搜索框里 Esc 不再清关键字、Enter 没有含义。

实现说明（2026-09-22，对话框 UI 对齐 pi /tree）：

- 拿本机一份有分支的真实会话对比后发现：pi 的分支实际挂在 `[system]` 系统提示词节点下（每次 /resume 或 /tree restore 再继续对话，pi 会先追加一条新的 system 消息），插件之前把 system 消息归到 `meta` 默认隐藏，过滤后重新挂父节点就把整棵树压平成了几条独立的链，树线一根都画不出来。现在 `TreeRow.kind` 拆成四类和 pi 一致：`message`（user / assistant）、`tool`（工具结果）、`system`（system 提示词、bash 执行、compaction、branch summary，pi 默认就显示的骨架节点）、`meta`（model / thinking / name 这些记账条目，pi 默认隐藏）。`TreeFilter` 的 `tools` 改名 `no-tools`（对应 pi 的 ctrl+t）：`default` 只隐藏 meta（和 pi 默认一样能看到工具结果），`no-tools` 再去掉工具结果。
- 行文字改成 pi 的中括号标签风格：`[system]`、`[bash]: cmd`、`[compaction: 12k tokens]`、`[branch summary]: …`、`[model: xxx]`、`[thinking: off]`、`[name: xxx]`；system 行不再带 `system: ` 前缀，整行 muted。
- 活动路径标记：和 pi 一样，活动分支上的节点在文字前加 accent 色的 `• `，一眼能看出当前对话走的是哪条路；非活动分支仍然 dim。
- 对话框和小面板共用 `renderTreeRow`，所以两边同步变化；小面板仍然只保留最里面 3 层树线，外面折叠成 `… `。

实现说明（2026-09-22，1–5 项）：

- 树线：先看了 pi 0.85.1 `tree-selector.js` 的 `flattenTree` / `render`，规则照搬到新模块 `ui/tree-lines.ts` 的 `treePrefixes`：父节点有多个子节点时子节点带 `├` / `└` 连接符，连接符第二格 `⊟` 表示有子节点、`─` 表示叶子；分叉处缩进 +1 层，分叉后的第一代再 +1 层做视觉分组，单链不缩进；连接符行的后代在该列画 `│`，最后一个兄弟之后改画空白；每层 3 列。多个根时挂在虚拟根下、不画连接符（和 pi 一致）。
- 数据层：`TreeRow` 去掉 `depth`，`parentId` 改为指向"最近的一个也是行的祖先"（label 这类不显示的条目被跳过），树线全靠 `parentId` 画。`applyTreeFilter` 过滤掉中间节点后把子节点挂到最近保留的祖先上（`rows` 是先序的，一遍算完），过滤后仍是一片合法的森林。
- 小面板（`ui/panes/tree-pane.ts`）：`renderTreeRow` 抽成共用函数（光标 `› ` + 树线 + `[label]` + 时间 + `role:` + 正文），`capPrefix` 只保留最里面 `MAX_LEVELS`（3）层、更外面的折叠成 `… `；标题右侧不再显示过滤名，只显示 `2/12`。
- 对话框（`ui/widgets/tree-dialog.ts`，`TreeDialog`）：`a` 打开，占满终端只留 2 列 / 1 行边距；顶部一行是 `搜索:` 输入框（`PromptBar`，本次静态）、`├──┤` 分隔线、中间是不折叠的完整树（光标从面板当前节点开始）、再一条分隔线、底部一行按键提示；标题右侧显示 `3/12 · default`。`frame.ts` 新增 `FRAME_DIVIDER` 哨兵：body 里出现它就画 `├────┤`。`PanelMode` 新增 `tree`（footer 左侧显示 `TREE`，右侧显示对话框的提示）。本次只有 Esc / q 关闭，其他按键一律吞掉。
- 键位：`tree` scope 删掉 `tree-filter-*` 五个动作（`ActionId`、默认键位、`ACTION_DESCRIPTIONS`、`HELP_GROUPS`、footer 提示一并移除），新增 `tree-open`（默认 `a`，footer 显示 `a Tree`）。`/`、`n`、`N` 是 global 绑定，不能靠删键位去掉，所以 `keymap.ts` 新增 `DISABLED_GLOBAL_ACTIONS`：TREE 聚焦时这三个动作不执行，footer 提示 `search: not available here, press a to open the tree dialog`，? 帮助里也不列出。`state.treeFilter` 保留（对话框过滤下个任务用）。（2026-09-22 撤回：树大了小面板也需要 /，`DISABLED_ACTIONS` 里去掉 `tree` 这一项、`app.ts` 里的"not available here"提示删掉，footer 恢复 `/ Search`；现在 TREE 里的 / 和别的面板一样只打开搜索栏，真正的匹配后面统一做。）
- 顺手：`PromptBar` 的 pi-tui `Input` 改成 `prompt: ""`，去掉输入框前多余的 `> `（搜索栏之前一直是 `搜索: > `）。
- 测试：`test/ui.test.ts` 加了 `treePrefixes` / `capPrefix` 的几何测试、`applyTreeFilter` 重新挂父节点、小面板折叠层级而对话框不折叠、`FRAME_DIVIDER`；`test/panel.test.ts` 加了 TREE 里 `/`、`n`、`u` 不起作用且 footer 提示、`a` 打开对话框的布局（搜索行 / 分隔线 / 光标行 / 提示行 / 边距）、其他键被吞、Esc / q 关闭；帮助弹窗测试改为断言不再出现 Filter 和搜索。

### tree 面板改为折叠大纲（2026-09-22）

背景：小面板照搬 pi /tree 的树线后显得太重，也和 a 打开的对话框重复。跑了本机 7 个会话：6 个是纯线性链，树线一根都画不出来；唯一有分叉的那个 80 行里 57 行在被放弃的旁支上。真正的问题不是树线，而是"分叉一深就全部展开 + 每层 3 列 + `… ` 截断"，折叠才是解法，三角箭头只是换个皮。

- ~~小面板改成三角 + 缩进的折叠大纲：段头（父节点有多个子节点、自己又有后代的节点）左侧画 `▸`（折叠）/ `▾`（展开），没有后代的旁支画 `─`；段内的行每层缩进 2 列，最多四层，更深的以 `… ` 代替；线性对话完全不缩进。~~
- ~~默认旁支折叠、活动分支展开：打开面板就能看到当前对话，右侧 CONTENT 联动不受影响；换会话时重置，同一会话内打标签等重新加载保留折叠状态。~~
- ~~z：折叠 / 展开光标所在的分支段。光标在段头上切换；在段内任意一行按下则折叠所在段并把光标移到段头（vim 的 zc）；线性对话的主干上没有可折叠的段，footer 提示 `nothing to fold here`。~~
- ~~树对话框沿用同一份折叠状态：只列出没被折叠的行，折叠的段头在树线连接符上画 `⊞`（和 pi 一致）。对话框内的 z / j / k 等按键仍归"对话框快捷键"任务。~~

实现说明（2026-09-22）：

- 数据层：新增 `data/tree-fold.ts`，纯函数：`treeChildren`（按 parentId 分组，`tree-lines.ts` 也改用它）、`forkChildIds`（分支段起点：父节点有多个子节点的子节点，或多根时的根）、`foldableIds`（起点里自己有后代的才能折叠；和 pi 不同，单根不可折叠——折了整棵树就没了）、`defaultFolded`（不在活动分支上的可折叠行）、`applyTreeFold`（先序一遍隐藏折叠行的后代，不是段头的 id 忽略）、`foldTarget`（z 的目标：自己可折叠就是自己，否则最近的可折叠祖先，主干上没有）。
- 面板前缀：新增 `ui/tree-outline.ts` 的 `treeOutline`：深度只在可折叠的行下面 +1（单链、死胡同和父节点同深），每层 2 列；三角（或死胡同的 `─`）直接占段头这一行的前两列、不预留空列，段头的正文因此比同层的普通行靠右 2 列，段内的行正好顶在段头正文下面（lazygit 文件树的画法；先试过"按深度预留三角列"，真实会话里段头的同层行和段内的行会落到同一列，看不出层级）；线性对话前缀为空、和之前完全一样；`MAX_DEPTH = 3`（0～3 共四层），更深的行宽度和第 3 层一样、最外面两列换成 `… `。前缀按整棵树算（不是折叠后的可见行），折叠时列不会跳动。
- `ui/panes/tree-pane.ts`：不再画树线，删掉 `MAX_LEVELS` / `capPrefix`；props 增加 `outline`（entryId → 前缀），缩进 dim、三角 muted（旁支整行 dim 时三角仍看得见）。`renderTreeRow` 的 `prefix` 改为调用方已配好色的字符串，对话框传 `theme.fg("dim", 树线)`。
- `ui/tree-lines.ts`：`treePrefixes(rows, folded)` 第二个参数是折叠集合，折叠的连接符行画 `⊞`，多根时折叠的根在前缀后面补 `⊞ `（照 pi）。
- 面板状态：`PanelState.treeFolded: Set<string>`；`LazyPanel` 里 `tree` 是完整过滤后的树，`visibleTree` 是 `applyTreeFold` 之后面板真正列出的行，光标索引、y / T / Enter、右侧联动都改成看 `visibleTree`；`setTree` / `refreshTreeView` 统一重算可见行和大纲前缀。`loadSelectedSession` 用 `defaultFolded`，`reloadTree` 保留原折叠集合。
- 键位：`tree` scope 新增 `tree-fold`（默认 `z`），`ACTION_DESCRIPTIONS` / footer（`z Fold`）/ `docs/keybindings.md` 同步。
- 测试：`test/ui.test.ts` 加了 `tree-fold` 四个函数、`treeOutline` 的几何（预留列、深度上限）、面板画大纲 / 对话框画树线和 `⊞`；`test/panel.test.ts` 加了分叉树上的默认折叠、z 在段头 / 段内 / 主干上的行为、光标跳到段头后右侧高亮跟随、对话框显示 `⊞`。

### 优化选中

- ~~感觉有个可以优化的小点，比如我打开插件，选择进入 session 中的第二个会话，随后什么也不干再次输入 /lazy-history 打开此插件，发现 session 还是选中了第一个对话，这里能不能优化一下，打开的时候应该自动选中当前的对话，如果是一个新的对话，则选择第一个就行.~~

实现说明（2026-09-22）：

- `index.ts` 打开面板时用 `ctx.sessionManager.getSessionFile()` 取 pi 当前会话文件，作为 `LazyPanelOptions.currentSessionFile` 传给面板；新会话还没落盘时它是 undefined，不传。
- `data/sessions.ts` 新增 `findSessionIndex(rows, file)`：和 `isCurrentSession` 同一规则，`path.resolve` 后比较，找不到返回 -1。
- `app.ts`：只在第一次 `load()` 时定位（`locateSessionFile` 用过即清），找到就把 SESSIONS 光标放到那一行，TREE / CONTENT 随之加载该会话；没找到（新会话、或当前会话不在当前范围里）留在第一行。之后 C / A 切范围仍回到顶部，行为不变。
- 测试：`test/panel.test.ts` 加了初始光标 / 未列出 / 切范围后回顶部；新增 `test/sessions.test.ts` 验证 `findSessionIndex` 的路径比较。

### 跨平台适配（分支 `feat/windows-support`，2026-09-21）

背景：`npm run install:pi` 在 Windows 上报 `Path does not exist: ...\$(pwd)`。npm 在 Windows 默认用 cmd.exe 跑 scripts，`$(pwd)` 这种 bash 命令替换会被原样传给 pi。说明之前的写法只考虑了 Linux / macOS，需要系统性排查。先在本分支把 Windows 适配好，再考虑 macOS。

- ~~Windows 上安装修复：`package.json` 的 `install:pi` / `uninstall:pi` 改为 `pi install .` / `pi remove .`（pi 内部会把 `.` 解析成绝对路径，cmd / PowerShell / bash 下通用），`CLAUDE.md` 同步更新。已验证 `~/.pi/agent/settings.json` 的 packages 里出现 `E:\frontwebWorkSpace\PiLazyPanel`。~~
- ~~排查代码中不能跨平台的写法。初步扫描（`src/`、`test/`、`package.json`）发现的可疑点，逐项确认并修复。~~
- 待用户在 Windows 的 pi 里完整跑一遍 `/lazy-history`（三个面板、j/k、y、T、/），确认无异常；macOS 的验证另开任务。

实现说明（2026-09-21）：

1. ~~`shortenPath`~~：实测 pi 在 Windows 上存的 cwd 是 `E:\\androidWorkspace\\FilmRecall` 这种反斜杠写法。现在 `/` 和 `\` 两种分隔符都认，Windows 下前缀比较忽略大小写（盘符大小写不敏感）；`C:\Users\xxxyz` 这种只是前缀相同的目录不会误缩。
2. ~~`test/ui.test.ts`~~：改用 `os.homedir()` + `path.join`，同时断言两种分隔符；反例不能用 `tmpdir()`（Windows 的临时目录在 home 下面，会被正确缩写成 `~\AppData\...`），改用平台各自的一个 home 外路径。
3. ~~`test/panel.test.ts` 的 `/tmp/s1.jsonl`~~：确认面板对 `file` 不做任何路径处理，只当不透明 id 传给 DataSource 桩，加了注释说明，不改路径。
4. ~~换行~~：实测本机 7 个会话文件（含 Windows 下产生的）都没有 `\r`（原始字节和 JSON 转义里都没有）。但工具输出 / 粘贴内容仍可能带，所以 `utils/format.ts` 新增 `normalizeNewlines`（`\r\n` / `\r` → `\n`），`data/content.ts` 在生成 markdown 时统一调用；tree / sessions 的一行预览走 `singleLine`，`\s+` 本来就会吃掉 `\r`。
5. ~~scripts~~：已验证，无需改动。
6. ~~剪贴板~~：查了 pi 0.85.1 的 `copyToClipboard` 实现：先试 OSC 52，再按平台走 `pbcopy`（darwin）/ `clip`（win32）/ `wl-copy`、`xclip` 等（linux），Windows 已覆盖，无需插件侧处理。
7. ~~配置路径~~：无问题。
8. ~~文档~~：`CLAUDE.md`、`docs/design.md`、`docs/keybindings.md` 里的路径示例都已是 `~/.pi/agent/...` 写法，没有 bash 专有命令。
