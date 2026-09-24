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
- 搜索：`TreeDialog` 持有搜索框（`PromptBar`，`reset` 加了"光标放末尾"参数），每次按键把查询通过 `onQueryChange` 报给面板；面板用 `data/search.ts` 的 `parseSearchQuery` + `matchTreeRow` 过滤 `tree`（和 pi /tree 一样：每个词都要出现在 label + role + 正文里、不分大小写（2026-09-23 起 role 不再参与普通词匹配，改用 `role:` 限定，见后面的调整）；正文是整条消息压成一行的文本，渲染时才截断，所以比 pi 只看前 200 字符更全；`tag:` 只看 label，`after:` / `before:` 看时间，`name:` / `model:` / `path:` 是会话搜索的、这里忽略；`parseSearchQuery` 现在真的拆 `key:value`，供以后的 SESSIONS 搜索复用），再经 `tree-fold.ts` 的 `filterTreeRows`（从 `applyTreeFilter` 里抽出来的"删行并重新挂父节点"）和 `applyTreeFold` 交回 `setRows`。标题的 `n/m` 是匹配行里的位置 / 数量。搜索期间折叠全部清空（pi 的做法，否则折叠段里的匹配看不见），第一次开始搜索时记住原折叠集合（`foldedBeforeSearch`），关键字删光或关对话框时恢复；搜索期间用 z 折的段下一次改关键字就被清掉（pi 一样）。Esc 退出搜索框回到列表、关键字保留（列表仍是过滤后的结果），再按 / 光标停在原关键字末尾接着改、删光即清除；Enter 在搜索框里没有含义。搜索框没焦点时那一行只显示关键字原文（不画光标），空的时候显示 `/ to search`（键名来自 keymap）。
- 折叠：z 和面板一样（`toggleFold` 抽成共用，对话框以搜索后的行为基准找段头）。折叠状态和面板共用（`state.treeFolded`）；光标所在行被搜索 / 过滤 / 折叠藏掉时落到最近还列出来的祖先上，没有就落到最后一行（`nearestListedIndex`，pi 的 `findNearestVisibleIndex`）。
- 过滤：d 直接回 default，t/u/L/a 再按一次回 default（pi 的 toggle）。过滤是面板级状态 `state.treeFilter`：重新 `loadTree(file, filter)`，折叠全部清空（pi 一样；不清的话 L 过滤下折叠的旁支会把带标签的行藏起来），面板的 TREE 之后也显示同一棵过滤后的树，标题在非 default 时显示 `2/12 · user-only`（`tree-pane.ts` 的 `treeMeta`，放不下就只留位置）。pi 自己的 `treeFilterMode` 设置（内置 /tree 的默认过滤，`labeled-only` 对应这里的 `labeled`）作为面板打开时的初始过滤（`pi-settings.ts`）。
- 关闭：q / Esc 后面板光标跳到对话框选中的行，藏在折叠段里就把它的祖先展开（`foldedAncestors`），右侧 CONTENT 跟着高亮。
- 提示：对话框底部一行和 footer 都由最终 keymap 生成（`keymap.ts` 的 `TREE_DIALOG_FOOTER` + `TREE_DIALOG_HINT_TEXT`，`d/t/u/l/a filter` 这类合并成一条），放不下的从后面丢（100 列时 `T label` 先没了，`q close` 排得靠前）；对话框里不做 ? 帮助（键已经都在底部一行了），`help-overlay.ts` 的 `focus` 顺手改成了 `KeyScope`、按 `scopeChain` 列各层的键。
- 测试：`test/panel.test.ts` 加了对话框的移动 / y / T / Enter（含菜单、失败后留在对话框）/ 搜索（实时过滤、Esc 保留关键字回列表、Enter 无效、删光后折叠恢复、关闭时展开并选中）/ 标签与 `tag:` 搜索 / 过滤（toggle、折叠清空、面板标题）/ z / 被禁用的全局键（含 h、?）；`test/ui.test.ts` 加了 `nearestListedIndex`、`foldedAncestors`、`filterTreeRows`、`treeMeta`、`TreeDialog` 搜索行；新增 `test/search.test.ts`；`test/keymap.test.ts` 加了 scope 链和 `tree-dialog` 覆盖；`test/pi-settings.test.ts` 加了 `treeFilterMode`。
- 调整（2026-09-22，按反馈）：去掉 h / l（`tree-fold-or-up` / `tree-unfold-or-down` 连同 `segmentStartAbove` / `segmentStartBelow` 一并删除），labeled 过滤改为小写 l；对话框里去掉 ?；搜索框里 Esc 不再清关键字、Enter 没有含义。

实现说明（2026-09-22，对话框 UI 对齐 pi /tree）：

- 拿本机一份有分支的真实会话对比后发现：pi 的分支实际挂在 `[system]` 系统提示词节点下（每次 /resume 或 /tree restore 再继续对话，pi 会先追加一条新的 system 消息），插件之前把 system 消息归到 `meta` 默认隐藏，过滤后重新挂父节点就把整棵树压平成了几条独立的链，树线一根都画不出来。现在 `TreeRow.kind` 拆成四类和 pi 一致：`message`（user / assistant）、`tool`（工具结果）、`system`（system 提示词、bash 执行、compaction、branch summary，pi 默认就显示的骨架节点）、`meta`（model / thinking / name 这些记账条目，pi 默认隐藏）。`TreeFilter` 的 `tools` 改名 `no-tools`（对应 pi 的 ctrl+t）：`default` 只隐藏 meta（和 pi 默认一样能看到工具结果），`no-tools` 再去掉工具结果。
- 行文字改成 pi 的中括号标签风格：`[system]`、`[bash]: cmd`、`[compaction: 12k tokens]`、`[branch summary]: …`、`[model: xxx]`、`[thinking: off]`、`[name: xxx]`；system 行不再带 `system:` 前缀，整行 muted。
- 活动路径标记：和 pi 一样，活动分支上的节点在文字前加 accent 色的 `•`，一眼能看出当前对话走的是哪条路；非活动分支仍然 dim。
- 对话框和小面板共用 `renderTreeRow`，所以两边同步变化；小面板仍然只保留最里面 3 层树线，外面折叠成 `…`。

实现说明（2026-09-22，1–5 项）：

- 树线：先看了 pi 0.85.1 `tree-selector.js` 的 `flattenTree` / `render`，规则照搬到新模块 `ui/tree-lines.ts` 的 `treePrefixes`：父节点有多个子节点时子节点带 `├` / `└` 连接符，连接符第二格 `⊟` 表示有子节点、`─` 表示叶子；分叉处缩进 +1 层，分叉后的第一代再 +1 层做视觉分组，单链不缩进；连接符行的后代在该列画 `│`，最后一个兄弟之后改画空白；每层 3 列。多个根时挂在虚拟根下、不画连接符（和 pi 一致）。
- 数据层：`TreeRow` 去掉 `depth`，`parentId` 改为指向"最近的一个也是行的祖先"（label 这类不显示的条目被跳过），树线全靠 `parentId` 画。`applyTreeFilter` 过滤掉中间节点后把子节点挂到最近保留的祖先上（`rows` 是先序的，一遍算完），过滤后仍是一片合法的森林。
- 小面板（`ui/panes/tree-pane.ts`）：`renderTreeRow` 抽成共用函数（光标 `›` + 树线 + `[label]` + 时间 + `role:` + 正文），`capPrefix` 只保留最里面 `MAX_LEVELS`（3）层、更外面的折叠成 `…`；标题右侧不再显示过滤名，只显示 `2/12`。
- 对话框（`ui/widgets/tree-dialog.ts`，`TreeDialog`）：`a` 打开，占满终端只留 2 列 / 1 行边距；顶部一行是 `搜索:` 输入框（`PromptBar`，本次静态）、`├──┤` 分隔线、中间是不折叠的完整树（光标从面板当前节点开始）、再一条分隔线、底部一行按键提示；标题右侧显示 `3/12 · default`。`frame.ts` 新增 `FRAME_DIVIDER` 哨兵：body 里出现它就画 `├────┤`。`PanelMode` 新增 `tree`（footer 左侧显示 `TREE`，右侧显示对话框的提示）。本次只有 Esc / q 关闭，其他按键一律吞掉。
- 键位：`tree` scope 删掉 `tree-filter-*` 五个动作（`ActionId`、默认键位、`ACTION_DESCRIPTIONS`、`HELP_GROUPS`、footer 提示一并移除），新增 `tree-open`（默认 `a`，footer 显示 `a Tree`）。`/`、`n`、`N` 是 global 绑定，不能靠删键位去掉，所以 `keymap.ts` 新增 `DISABLED_GLOBAL_ACTIONS`：TREE 聚焦时这三个动作不执行，footer 提示 `search: not available here, press a to open the tree dialog`，? 帮助里也不列出。`state.treeFilter` 保留（对话框过滤下个任务用）。（2026-09-22 撤回：树大了小面板也需要 /，`DISABLED_ACTIONS` 里去掉 `tree` 这一项、`app.ts` 里的"not available here"提示删掉，footer 恢复 `/ Search`；现在 TREE 里的 / 和别的面板一样只打开搜索栏，真正的匹配后面统一做。）
- 顺手：`PromptBar` 的 pi-tui `Input` 改成 `prompt: ""`，去掉输入框前多余的 `>`（搜索栏之前一直是 `搜索: >`）。
- 测试：`test/ui.test.ts` 加了 `treePrefixes` / `capPrefix` 的几何测试、`applyTreeFilter` 重新挂父节点、小面板折叠层级而对话框不折叠、`FRAME_DIVIDER`；`test/panel.test.ts` 加了 TREE 里 `/`、`n`、`u` 不起作用且 footer 提示、`a` 打开对话框的布局（搜索行 / 分隔线 / 光标行 / 提示行 / 边距）、其他键被吞、Esc / q 关闭；帮助弹窗测试改为断言不再出现 Filter 和搜索。

### tree 面板改为折叠大纲（2026-09-22）

背景：小面板照搬 pi /tree 的树线后显得太重，也和 a 打开的对话框重复。跑了本机 7 个会话：6 个是纯线性链，树线一根都画不出来；唯一有分叉的那个 80 行里 57 行在被放弃的旁支上。真正的问题不是树线，而是"分叉一深就全部展开 + 每层 3 列 + `…` 截断"，折叠才是解法，三角箭头只是换个皮。

- ~~小面板改成三角 + 缩进的折叠大纲：段头（父节点有多个子节点、自己又有后代的节点）左侧画 `▸`（折叠）/ `▾`（展开），没有后代的旁支画 `─`；段内的行每层缩进 2 列，最多四层，更深的以 `…` 代替；线性对话完全不缩进。~~
- ~~默认旁支折叠、活动分支展开：打开面板就能看到当前对话，右侧 CONTENT 联动不受影响；换会话时重置，同一会话内打标签等重新加载保留折叠状态。~~
- ~~z：折叠 / 展开光标所在的分支段。光标在段头上切换；在段内任意一行按下则折叠所在段并把光标移到段头（vim 的 zc）；线性对话的主干上没有可折叠的段，footer 提示 `nothing to fold here`。~~
- ~~树对话框沿用同一份折叠状态：只列出没被折叠的行，折叠的段头在树线连接符上画 `⊞`（和 pi 一致）。对话框内的 z / j / k 等按键仍归"对话框快捷键"任务。~~

实现说明（2026-09-22）：

- 数据层：新增 `data/tree-fold.ts`，纯函数：`treeChildren`（按 parentId 分组，`tree-lines.ts` 也改用它）、`forkChildIds`（分支段起点：父节点有多个子节点的子节点，或多根时的根）、`foldableIds`（起点里自己有后代的才能折叠；和 pi 不同，单根不可折叠——折了整棵树就没了）、`defaultFolded`（不在活动分支上的可折叠行）、`applyTreeFold`（先序一遍隐藏折叠行的后代，不是段头的 id 忽略）、`foldTarget`（z 的目标：自己可折叠就是自己，否则最近的可折叠祖先，主干上没有）。
- 面板前缀：新增 `ui/tree-outline.ts` 的 `treeOutline`：深度只在可折叠的行下面 +1（单链、死胡同和父节点同深），每层 2 列；三角（或死胡同的 `─`）直接占段头这一行的前两列、不预留空列，段头的正文因此比同层的普通行靠右 2 列，段内的行正好顶在段头正文下面（lazygit 文件树的画法；先试过"按深度预留三角列"，真实会话里段头的同层行和段内的行会落到同一列，看不出层级）；线性对话前缀为空、和之前完全一样；`MAX_DEPTH = 3`（0～3 共四层），更深的行宽度和第 3 层一样、最外面两列换成 `…`。前缀按整棵树算（不是折叠后的可见行），折叠时列不会跳动。
- `ui/panes/tree-pane.ts`：不再画树线，删掉 `MAX_LEVELS` / `capPrefix`；props 增加 `outline`（entryId → 前缀），缩进 dim、三角 muted（旁支整行 dim 时三角仍看得见）。`renderTreeRow` 的 `prefix` 改为调用方已配好色的字符串，对话框传 `theme.fg("dim", 树线)`。
- `ui/tree-lines.ts`：`treePrefixes(rows, folded)` 第二个参数是折叠集合，折叠的连接符行画 `⊞`，多根时折叠的根在前缀后面补 `⊞`（照 pi）。
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

### 三个面板的 / 搜索（2026-09-23）

背景：三个面板的 `/` 目前只打开底部搜索栏，回车后只是记住 query，匹配、高亮、n/N 都没做；`data/search.ts` 的 `parseSearchQuery` 已能解析 `name:` / `model:` / `path:` / `tag:` / `after:` / `before:`，但只有树对话框的实时搜索在用，SESSIONS / CONTENT 的匹配函数还没有。这一步把 lazygit 风格的搜索在三个面板上做完整。

- ~~交互统一参考 lazygit：`/` 打开底部搜索栏，输入时实时跳到第一个匹配（光标 / 滚动位置跟着走），Enter 确认并退出输入栏、关键字保留，`n` / `N` 在匹配之间往下 / 往上跳并回绕，Esc 在输入栏里取消搜索（清掉关键字并恢复原位置）；搜索生效期间面板标题右侧显示 `2/7 matches`，footer 显示当前关键字，没有匹配显示 `no matches`。搜索只作用于当前聚焦的面板，切换面板不清掉该面板的关键字。~~
- ~~SESSIONS：匹配名称 / 首条消息预览 / 模型 / 路径，限定词按 `parseSearchQuery` 已经定义的语义生效：`name:` 只看会话名、`model:` 只看模型、`path:` 只看 cwd、`after:` / `before:` 看时间，`tag:` 在这里忽略。新增 `matchSessionRow`。列表不过滤只跳转（lazygit 的做法，和树对话框的过滤不同），匹配的行里命中的文字高亮。~~
- ~~TREE：复用 `matchTreeRow`（label + role + 正文，`tag:` 只看 label），在折叠大纲上跳转：目标行藏在折叠段里时展开它的祖先（`foldedAncestors`），右侧 CONTENT 跟着高亮。~~
- ~~CONTENT：按渲染后的行匹配自由文本（不支持限定词），跳转即把该行滚到面板顶部，命中的文字高亮；Markdown 渲染结果已有缓存，高亮在缓存行上叠加，不要重新渲染。~~
- ~~高亮方式三个面板统一：命中的片段用 theme 的一个背景色，光标所在的当前匹配再加强调（和 lazygit 一样能区分"当前匹配"和"其他匹配"）。~~
- ~~键位：`/`、`n`、`N` 已经是 global 绑定，本次只接上 `dispatch`；把 footer 里 `n/N` 的提示补上，`docs/keybindings.md` 同步说明限定词。~~
- ~~树对话框（a 打开）里的搜索功能不要动，保持现状：仍然是顶部搜索框实时过滤列表、Esc 退出搜索框保留关键字、Enter 无含义，不改成跳转、不加 n/N、不加高亮。本次只做面板底部的 `/`，两边只是共用 `parseSearchQuery` / `matchTreeRow` 这两个纯函数，改动它们时不能影响对话框的行为（`test/panel.test.ts` 里已有的对话框搜索测试必须原样通过）。~~
- ~~测试：`test/search.test.ts` 加 `matchSessionRow` 和 CONTENT 行匹配；`test/panel.test.ts` 加三个面板的 / → 实时跳转 → Enter / Esc → n / N 回绕 → 标题计数 → 折叠段展开 → 切面板保留关键字。~~

实现说明（2026-09-23）：

- 状态：`PanelState.searchQuery` / `searchPane` 换成 `search: Partial<Record<PaneId, PaneSearch>>`（`types.ts` 的 `PaneSearch`：原始关键字、匹配的行号、当前匹配在其中的位置），每个面板各记各的，只有聚焦面板的搜索会被 n / N / Esc 操作，其他面板的命中仍然画着、标题仍然计数。SESSIONS 的匹配是列表行号；TREE 的匹配是整棵（过滤后的）树的行号，折叠藏起来的行也算，画的时候再换算成可见行号；CONTENT 的匹配是排版结果的行号，按排版对象 + 关键字缓存（`contentSearchCache`），终端变宽重排后自动重算。列表变化（`load` / `setTree`）时按新数据重算匹配、关键字保留。
- 流程（`app.ts`）：`/` 记下原位置（`SearchOrigin`：SESSIONS 光标、TREE 的整树行号 + entryId + 折叠集合、CONTENT 滚动行），搜索栏预填该面板已有的关键字（光标在末尾）。每敲一个键 `applyLiveSearch`：重算匹配，跳到原位置之后（含）的第一个匹配、没有就回绕到第一个；没匹配或删光则回到原位置（TREE 连折叠状态一起恢复，vim 的 incsearch 效果）。Enter 只是退出输入栏；Esc 在栏里删掉关键字并回原位置；normal 模式下 Esc 清掉当前面板的搜索、光标不动。n / N：列表面板以光标位置为基准找下一个 / 上一个匹配并回绕（vim 的 n / N；标题的 `2/7` 是光标所在匹配的序号，光标不在匹配上时只显示 `7 matches`）；CONTENT 因为滚动位置到不了末尾附近的行顶，改按上一次跳到的匹配前后数。跳到 TREE 的匹配时用 `foldedAncestors` 展开它的祖先，右侧 CONTENT 跟着高亮（`placeTreeCursor`：即使可见行号没变也同步一次，因为折叠变了行下面的内容可能变了）。搜索生效期间 n / N 先按 global 解析，优先于面板自己的同键绑定（SESSIONS 的 n 本来是 new session），和 lazygit 搜索模式一致；没有搜索时照旧。
- 匹配（`data/search.ts`，纯函数）：新增 `matchSessionRow`（词在 名称 + 预览 + 模型 + cwd 里，`name:` / `model:` / `path:` 只看对应字段且字段缺失就不匹配，`after:` / `before:` 看 `updatedAt`，`tag:` 忽略）、`matchesTokens`（CONTENT 行：每个词都在，限定词全部忽略；没有词就没有匹配）、`highlightTerms`（要高亮的词：自由文本 + name / model / path / tag 的值）、`findMatchRanges`（词在文本里的所有出现位置，`giu` 正则不区分大小写、重叠相邻的段合并）；`matchTreeRow` / `parseSearchQuery` 的行为没变，对话框的测试原样通过。
- 高亮（新模块 `ui/search-highlight.ts`，纯函数）：照搬 pi 自己全屏搜索的画法——面板先按原样把整行画完（颜色、光标背景、截断都不动），`highlightLine` 再把命中的片段按可见列用 pi-tui 的 `sliceByColumn` 切成 前 / 中 / 后 三段，只给中段的纯文本加样式、里面原有的转义序列原样保留，后段开头自带该处生效的样式，所以命中前后的颜色和光标行的背景不会断掉。踩到的坑：`sliceByColumn` 会丢掉最后一个可见字符之后的转义序列（光标行末尾的背景复位、上一轮画在行尾的高亮结束码），每一轮都先剥下来切完再接回去（`splitTail`），否则背景会漏到右边。样式和 pi 一致：其他匹配 = `searchMatchBg` + `searchMatchText` + 下划线，当前匹配再加粗 + 反色（主题没定义 searchMatchBg 时 pi 的 Theme 会回落到 selectedBg，反色保证在光标行上也看得出来）。三个面板都传 `SearchView`（`types.ts`：可见行号的匹配集合、当前匹配、要高亮的词、位置 / 数量），标题 meta 统一用 `searchMeta`（`2/7 matches` → `2/7`，`7 matches`，`no matches`）。CONTENT 的排版结果新增 `searchable[]`，只有消息正文行参与搜索（YOU / ASSISTANT 头部和边框不算），高亮只叠加在窗口里的命中行上，缓存的排版不动。
- footer：`renderSearchStatus` 改为 `搜索: foo   2/7   n next  N prev  Esc clear   <状态文字>`，n / N 的键名来自最终 keymap（global 的 search-next / search-prev）；输入栏里的提示仍是 `Enter search  Esc cancel`。
- 测试：`test/search.test.ts` 加 `matchSessionRow` / `matchesTokens` / `highlightTerms` / `findMatchRanges`；`test/ui.test.ts` 加 `highlightLine`（宽度不变、命中前后样式保留、行尾复位保留、宽字符按列、跨转义序列）和 `searchMeta`；`test/panel.test.ts` 重写原来的搜索栏测试，新增 SESSIONS（实时跳转 / 无匹配回原位 / Enter / n N 回绕 / 标题与 footer 计数 / 光标离开匹配 / Esc 两种含义 / 空关键字 / 限定词 / 用真实转义码的桩主题验证高亮与光标背景）、TREE（折叠段里的匹配、跳转展开、右侧联动、Esc 恢复折叠、n N 回绕、`tag:`）、CONTENT（只搜正文行、滚到顶部、n N 回绕、头部不参与、限定词无效）、切面板各留各的关键字。
- 调整（2026-09-23，按反馈）：SESSIONS 的普通词只搜 名称 + 首条消息预览（标题那一行的内容），不再搜模型和路径。原因：路径是完整的 cwd，`/home/cheng` 里的 `he` 让家目录下所有会话都命中 `he`，而面板显示的是 `~/…`，命中处看不见；模型名 `claude-opus-4` 也会让 `us` 这类短词全命中。模型和路径只通过 `model:` / `path:` 匹配，`path:` 同时认完整路径和 `~/…` 写法。
- 调整（2026-09-23，按反馈）：统一成"普通词只搜 名称 / 标题 / label，其他字段都要限定词"。TREE（面板和树对话框共用 `matchTreeRow`）的普通词不再匹配 role（和 pi /tree 不同，`us` 不会命中所有 user 行），新增 `role:` 限定词（`role:user` / `role:assistant` / `role:system` / `role:tool`，子串匹配）；忽略规则不变：SESSIONS 忽略 `tag:` / `role:`，TREE 忽略 `name:` / `model:` / `path:`，CONTENT 忽略全部限定词。`role:` 的值也参与高亮。

### SESSIONS 的删除 / 重命名（2026-09-23）

背景：这是项目最初的动机（design.md 第一句：pi 自带 /resume 用 ctrl+d 删很别扭，想要 lazygit 那种 d 删除、r 重命名）。目前面板能看、能进（Enter 恢复 / 跳节点）、能搜，但删除和重命名还得回 pi 自带的 /resume 去做。`ui/widgets/confirm-dialog.ts` 和 `ui/widgets/session-info-dialog.ts` 还是空壳，`actions/session-actions.ts` 只有 resume。

- ~~确认框 `ui/widgets/confirm-dialog.ts`：基于已有的 `SelectDialog` 做预设（标题 + 右上角说明 + Yes / No 两项，默认停在 No，`y` / `n` 直接选，Enter 确认、Esc 取消），footer 显示它的提示。删除、之后的 fork、批量删除都复用它（CLAUDE.md 第 7 条：破坏性操作必须先经它确认）。~~
- ~~d 删除：确认后删掉光标所在会话的文件。做法照 pi 自带 /resume（`session-selector.js` 的 deleteSession）：先试系统的 `trash` 命令，失败再 `unlink`，footer 说明用了哪种方式；失败原因进 footer、不关面板。删完重新拉列表，光标夹回范围内，TREE / CONTENT 跟着换。动手前先查：目标是 pi 当前打开的会话时 pi 自己怎么处理（禁止、还是删了以后开新会话），照 pi 的行为做，不猜。~~
- ~~r 重命名：复用 `InputDialog`，照 `label-dialog.ts` 加一个预设（标题 `Rename`，预填当前名字，右上角显示会话预览，空值清除名字）。当前会话走 `pi.setSessionName`（pi 内存里同步）；其他历史会话先查 `SessionManager` 有没有对应的追加接口（和打标签的 `appendLabelChange` 同一思路），查文档 `docs/extensions.md` / `session-format.md`，不猜。改完重新拉列表，光标留在同一会话上，标题行显示新名字。~~
- ~~顺手接上两个数据层已经就绪的键：s 排序（`sortSessions` 已支持 threaded / recent / fuzzy，循环切换 + 标题 meta 显示当前排序）；i 会话信息（`loadSessionInfo` 已写好，`ui/widgets/session-info-dialog.ts` 照 design.md 的草图画居中弹窗，Esc 关闭，弹窗里 y 复制全部内容）。~~
- space 多选和批量删除放到删除做完之后再做（它的唯一用途就是批量删除）。
- ~~键位：`session-delete` / `session-rename` / `session-sort` / `session-info` 已在 keymap 里（d / r / s / i），本次只接上 `dispatch`；`ACTION_DESCRIPTIONS`、footer 提示、`docs/keybindings.md` 同步。~~
- ~~测试：`test/panel.test.ts` 加确认框（y / n / Enter / Esc）、删除后列表与光标、重命名弹窗往返、排序切换、信息弹窗；`test/session-actions.test.ts` 用临时会话文件验证删除（trash 不可用时的 unlink 回退）和重命名的分流（当前会话 / 其他会话）。~~

实现说明（2026-09-23）：

- 先查了 pi 0.85.1 的行为（`session-selector.js` + `interactive-mode.js`）：内置 /resume 的 ctrl+d 对当前打开的会话直接拒绝（"Cannot delete the currently active session"），不会删了再开新会话；其他会话 `spawnSync("trash", [file])`，状态 0 或文件已不在算进了回收站，否则 `unlink`，两个都失败时把 unlink 的错误和 trash 的第一行 stderr 拼在一起。内置 rename（ctrl+r）不管是不是当前会话都是 `SessionManager.open(file).appendSessionInfo(name)`，空值直接忽略；`getSessionName` 对空的 session_info 返回 undefined，所以追加空名字就能清除名称。插件照搬，唯一的差别：当前会话改名走 `pi.setSessionName`（pi 内存里的 SessionManager 同步，还会广播 `session_info_changed`），空值也允许（清名字）。
- actions（`actions/session-actions.ts`）：`deleteSession(ctx, file, { trashCommand })` 返回 `DeleteMethod`（`trash` / `unlink`，`types.ts`），当前会话抛 `CURRENT_SESSION_DELETE_ERROR`，文件不存在也抛；`trashCommand` 只给测试用（本机装了 `trash`，测试传一个不存在的命令名验证 unlink 回退，不然会把临时文件真扔进回收站）。`renameSession(pi, ctx, file, name)` 按 `isCurrentSession` 分流。`copyText` 包装 `copyToClipboard` 给信息弹窗的 y。三个都挂到 `ActionSource`（可选成员：没注入时 footer 提示 `delete: actions unavailable`），`index.ts` 组装。
- 确认框：`SelectDialogSpec` 新增 `shortcuts`（pi-tui 键名 → 选项下标，按下直接选中），`ui/widgets/confirm-dialog.ts` 的 `confirmDialogSpec({ title, subject, onConfirm, onCancel })` 生成 Yes / No 的 spec：默认停在 No（误按 Enter 不会删）、`y` / `n` 直接选、选 No 等于 Esc；`CONFIRM_HINTS` 是 footer 的 `y/n choose  Enter confirm  Esc cancel`。`PanelMode` 新增 `confirm` / `rename` / `info`（footer 左侧的模式名）。
- 面板（`app.ts`）：`load()` 里的列表加载抽成 `listSessions(keepFile)`：重新拉列表，光标放到 `keepFile` 那一行（找不到就夹回范围内），重算 SESSIONS 的搜索匹配；`followSessionsCursor` 只在光标下的会话真的变了时重新加载 TREE / CONTENT。d：光标是 pi 当前打开的会话（`LazyPanelOptions.currentSessionFile`，之前只用来定位光标）时 footer 直接报 pi 的那句话、不弹框；否则弹确认框，Yes 后 `deleteSession` → 从多选集合里去掉 → `listSessions(undefined)`（被删的行没了，光标自然落到下一行，是最后一行就上移）→ footer `session moved to trash` / `session deleted`。r：`InputDialog` 预设 `ui/widgets/rename-dialog.ts`（标题 `Rename`，右上角是首条消息预览，提示 `Enter save  Esc cancel  empty removes`），Enter 后 `renameSession` → `listSessions(row.file)` 光标留在原会话 → footer `renamed: xxx` / `name removed`；改名会往会话文件追加一条 session_info，所以改的是已加载的会话时用 `reloadTree` 重读一遍树（`all` 过滤下能看到 `[name: xxx]`，光标和折叠不动）。s：`SESSION_SORT_MODES`（`constants.ts`，`SessionSortMode` 由它推导）循环，`listSessions(当前会话)` 让光标跟着同一会话走，footer `sort: fuzzy`，标题 meta 本来就显示排序。i：`DataSource` 新增可选的 `loadSessionInfo`（`index.ts` 接 `data/content.ts` 已有的同名函数），`ui/widgets/session-info-dialog.ts` 的 `SessionInfoDialog` 画居中弹窗（一行一个字段，标签列固定 9 列，路径显示 `~/…` 缩写、复制用完整路径，标题右侧是会话名），`y` 把 `sessionInfoText` 交给 `copyText`、弹窗不关，Esc / q 关闭，其他键吞掉。
- 键位没动（d / r / s / i 早就绑好），只接上 `dispatch`；footer 提示补上 `s Sort` / `i Info`（`FOOTER_HINTS` + `footer.ts` 的 `SHORT`）。
- 调整（2026-09-23，按反馈）：信息弹窗里过长的值（主要是路径）不再截断，换行续在值那一列下面（`session-info-dialog.ts` 的 `wrapValue` 按可见列切，路径没有空格可断），弹窗高度随之增加；三种排序的含义和"没有 fork 会话时看不出变化"记在 issues.md。
- 调整（2026-09-23，按反馈）：排序改成 recent → created → title → threaded（`constants.ts` 的 `SESSION_SORT_MODES`）。pi 的 fuzzy 只在有搜索关键字时按相关度排，插件的搜索是跳转不排序，它和 recent 完全一样，去掉；换成 created（创建时间倒序）和 title（按面板显示的标题排序，见下）。threaded 保留，只在有 `/fork` 出来的会话时和 recent 不同。`config.ts` 的 `defaultSort` 校验改为查 `SESSION_SORT_MODES`。
- 调整（2026-09-23，按反馈）：`title` 排序原来叫 `name`，把没起名字的会话一律排到后面，用户视角看不出规律（叫 "Hi" 的会话排在名为 y/z 的会话之后，因为它没有 name）。改成按面板真正显示的标题排序（`sessions.ts` 的 `sessionTitle` = name 去空格后取，否则 preview），所见即所排，不分大小写 A–Z，只有既无名字也无预览的空会话才落到最后。`compareTitles` 取代 `compareNames`。英文（ASCII 首字符）标题排在中文等非 ASCII 之前（`titleGroup`），避免中文 locale 下 localeCompare 把中文排到英文前面。
- 测试：`test/session-actions.test.ts` 加了 `deleteSession`（当前会话拒绝、trash 不可用回退 unlink、文件不存在、用 `node` 脚本假扮 trash 时算 trash）和 `renameSession`（当前会话走 `pi.setSessionName` 且不碰文件、其他会话追加到文件、空值清除、文件缺失）；`test/panel.test.ts` 加了确认框（位置 / 默认 No / y n Enter Esc / 其他键吞掉）、删除后的列表与光标（末行上移、首行原地换会话、TREE 跟随、unlink 与失败的措辞）、当前会话拒绝、无 actions 提示、Rename 往返（预填 / 光标留在原行 / 树重读一次 / 空值清除 / Esc / 失败）、排序循环（光标跟随会话、不重载树）、信息弹窗（九个字段 / y 复制全文 / 其他键吞掉 / Esc q 关闭 / 无名字显示 (none) / 没注入 loader 的提示）。

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

### SESSIONS 的新建 / fork / clone / 复制末条回复（2026-09-23）

背景：SESSIONS 面板已经能看、能进（Enter 恢复 / 跳节点）、能搜、能删 / 改名 / 排序 / 看信息，但"创建新会话文件"这一族命令还没接：`n`（/new）、`o`（/fork）、`y`（/clone）、`Y`（/copy 复制 AI 末条回复）。这四个键在 `keymap.ts` 里早已绑好，`actions/session-actions.ts` 里是 TODO 空壳。这一步把它们做完——三大核心命令 /resume /tree /new 里的 /new 就是这次补齐。

先查了 pi 0.85.1（`interactive-mode.js`）：内置 /fork 弹一个 user 消息选择器（`AgentSession.getUserMessagesForForking()` 取全部 user 消息，默认选中最后一条），选中后 `fork(id)`（position `before`）并把该 prompt 填回编辑器；/clone 直接 `fork(getLeafId(), { position: "at" })` 并清空编辑器；两者都只作用于当前打开的会话（`ctx.fork` 操作当前 session）。`getUserMessagesForForking` / `getLeafId` 都能从 `SessionManager.open(file)` 拿到，所以选择器列表可以直接读光标会话的文件、不必先切。

四个都作用于 SESSIONS 光标所在的会话（和 Enter / d / r / i 一致）；`o` / `y` 若光标会话不是当前会话，先 `switchSession` 再在 `withSession` 里 fork（照搬 `restoreNode` 处理"其他会话"的做法），最终停在 fork / clone 出来的新会话。

- ~~`n` 新建：先弹 `InputDialog` 输入名字（复用 rename 那套预设），名字非空才设置（对应 /name 的 `[name]` 参数），空则不设。`ctx.newSession({ setup: sm => 非空时 sm.appendSessionInfo(name) })`，走现有 `enter()` 流程：面板隐藏 → 成功后关闭，落到新的空对话。创建、非破坏，不弹确认。~~
- ~~`o` fork（按反馈弹选择器）：先弹 **user 消息选择器**让用户挑分叉点（默认光标停在最后一条 user 消息）→ 再弹确认框（CLAUDE.md 第 7 条 / design 第 3 条）→ fork 在选中的 user 消息之前，把该 prompt 填回编辑器。该会话没有 user 消息时 footer 报 `No messages to fork from`（pi 原话），不弹选择器。~~
- ~~`y` clone（按反馈加确认）：弹确认框（虽然无损但会把用户切走）→ `fork(leafId, { position: "at" })` 复制活动分支、清空编辑器。~~
- ~~`Y` 复制末条回复：读光标会话活动分支里最后一条 assistant 正文 `copyToClipboard`，footer 反馈（`copied last reply` / `no assistant reply to copy`），面板不关（和 TREE 的 `y` 一致）；不切会话。~~
- ~~分层：`session-actions.ts` 补 `newSession` / `forkSession` / `cloneSession`；末条回复文本读取放 `data/content.ts`（action 里复制，和 tree-actions 调 `loadNodeText` 同构）。`SelectDialog` 增加可滚动窗口（选项多到超过终端高度时按窗口滚动，默认定位到 `initialIndex`），fork 选择器基于它 + 新预设 `fork-dialog.ts`（`ui/widgets/`）。~~
- ~~接线：`ActionSource` 加四个方法、`index.ts` 组装、`dispatch` 分发；footer 提示补 `n New` / `o Fork` / `y Clone` / `Y Copy reply`；`docs/keybindings.md`、`docs/design.md` 同步。~~
- ~~测试：`test/session-actions.test.ts` 用临时会话文件验证 `newSession`（名字透传 / 空名字不设 setup）、`forkSession`（选中 entryId 透传、当前 vs 其他会话分流）、`cloneSession`（叶子 id、分流）、末条回复读取；`test/panel.test.ts` 加 dispatch（new 输入框往返、fork 选择器 → 确认、clone 确认、copy 反馈与无回复分支、无 actions 提示）；`test/ui.test.ts` 加 `SelectDialog` 滚动窗口的几何。~~

实现说明（2026-09-23）：

- 先查了 pi 0.85.1 的真实行为：`/new` 就是 `handleClearCommand`（新会话，名字另说）；`/fork` 的选择器来自 `AgentSession.getUserMessagesForForking()`（遍历所有条目，只取有文字的 user 消息），选中后 `fork(id)`；`/clone` 是 `fork(getLeafId(), { position: "at" })`；`/copy` 是 `getLastAssistantText()`（跳过中止且无内容的回复，只拼 text 片段）。插件按这些行为一一对齐，`data/content.ts` 的 `loadForkPoints` / `loadLastReply` 就是这两个读取的复刻（只读文件，不碰 pi 内存）。
- **踩到的坑（重要）**：pi 给扩展的 `ctx.fork` 包装（`interactive-mode.js` 的 `commandContextActions`）把 fork 抛的任何异常都交给 `handleFatalRuntimeError`，那个函数直接 `process.exit(1)` —— 也就是说传一个非法 entryId 进去会把用户整个 pi 退掉。所以 `session-actions.ts` 新增 `checkForkable`，在调用 `ctx.fork` 之前把 pi 会抛的几种情况全部拦下：条目不存在、position `before` 但不是 user 消息、会话文件不存在、会话记的 cwd 已被删除（fork 出来的会话要在那个目录重建）。`newSession` 的 `setup` 同理（异常也会被当致命错误），所以它只做一次 `appendSessionInfo`。
- 分流和 `restoreNode` 一致：`ctx.fork` 只能 fork 当前打开的会话，所以光标会话是别的会话时先 `switchSession`，在 `withSession` 给的新 ctx 上 fork（旧 ctx 切换后失效）；切换后面板已被 pi 收掉，fork 失败只能 `next.ui.notify`。
- 编辑器回填不用插件做：pi 的 fork 包装自己会 `this.editor.setText(result.selectedText ?? "")`，所以 `forkSession` 不接 `editorText` 参数（第一版写了，查了 pi 源码后删掉）。
- UI：`SelectDialog` 新增可选的 `maxRows`（超出就按窗口滚动，`ensureVisible` 保证光标行可见，`open` 时按 `initialIndex` 定位），fork 选择器用 `dialogMaxRows()`（终端高度 - 6）当上限；新增两个预设 `ui/widgets/fork-dialog.ts`、`ui/widgets/new-session-dialog.ts`，确认框标题加 `CLONE_SESSION_TITLE` / `FORK_SESSION_TITLE`。`PanelMode` 加 `new` / `fork` / `clone` 三个模式名（footer 左侧显示）。
- fork 的两级弹窗：选择器 → 确认框都走同一个 `selectDialog`，Esc / No 从确认框退回选择器时用 `openForkSelector(index)` 重开并把光标停在刚才那条（顺手修了第一版重开时丢掉标题右侧会话名的问题，测试里加了断言）。
- footer 提示顺序（`FOOTER_HINTS.sessions`）把 fork / clone / copy-reply 放在 `s Sort` / `i Info` 后面：实测 120 列时前面的提示正好排到 `o Fork`，把常用的 Sort / Info 挤掉不划算；? 帮助里仍然全都有。
- 测试：`test/session-actions.test.ts` 加了 6 个（`loadForkPoints` 两个、`loadLastReply` 两个、`newSession`、`forkSession` 分流、`checkForkable` 的五种拒绝、`cloneSession`）；`test/panel.test.ts` 加了 7 个（n 往返 / o 选择器 → 确认 → fork / o 的两级 Esc / 没有 user 消息 / y 确认 / Y 两种结果 / 四个键在没有 actions 时的提示），并把两个老的搜索测试里断言 `session-new: not implemented yet` 的地方改成 `new: actions unavailable`（那两个面板没注入 actions）；`SelectDialog` 的滚动几何测试加在 `test/panel.test.ts` 里（和已有的 SelectDialog 组件测试放一起）。全量 `npm run check` + `npm test`：113 个测试全过。

### SESSIONS 的导出 / 导入 / 分享（2026-09-23）

背景："下一步"清单里的第 2、3 项。`e`（session-export）/ `I`（session-import）/ `S`（session-share）三个键早已绑好，`actions/session-actions.ts` 里 `exportSession` / `importSession` / `shareSession` 还是 TODO 空壳。按风险从低到高做：先导出、再导入、分享放最后。

- ~~动手前先查 pi 0.85.1：内置 `/export` / `/import` / `/share` 分别怎么实现（`interactive-mode.js`、`agent-session.js`、`agent-session-runtime.js`）；导出能不能对**任意会话文件**做（`exportToHtml` / `exportToJsonl` 只作用于当前会话），包里有没有导出的独立函数；导入用的 `importFromJsonl` 在扩展 ctx 上没有开放，确认有没有别的路子（例如自己复制文件再 `switchSession`），做不了就记到 issues.md。不猜。~~
- ~~`e` 导出：先用 `SelectDialog` 选 HTML / JSONL，再用 `InputDialog` 输入输出路径（预填 pi 的默认路径，空值用默认），导出光标所在会话，footer 显示写到了哪里；非破坏、不切会话、面板不关。~~
- ~~`I` 导入：用 `InputDialog` 输入 JSONL 路径，导入后切到导入的会话（和内置 `/import` 一样），走 `enter()` 流程；文件不存在 / 格式不对在 footer 报错、不关面板。会替换当前会话，注意 `ctx.switchSession` / `withSession` 的注意事项。~~
- ~~`S` 分享：外发操作，先弹确认框（CLAUDE.md 第 7 条），照 pi 的 `/share` 做（大概率是 `gh gist create`），footer 显示生成的链接并可复制；`gh` 不存在 / 没登录时报 pi 同样的提示。~~
- ~~接线：`ActionSource` 加方法、`index.ts` 组装、`dispatch` 分发、footer / `ACTION_DESCRIPTIONS` / `docs/keybindings.md` / `docs/design.md` 同步。~~
- ~~测试：`test/session-actions.test.ts` 用临时会话文件验证导出（两种格式、默认路径、任意会话）、导入（复制 + 切换 / 报错）、分享（用假 `gh` 命令验证参数与链接解析）；`test/panel.test.ts` 加三个键的弹窗往返与无 actions 提示。~~

实现说明（2026-09-24）：

- 先查了 pi 0.85.1 的真实实现，结论是三个都能做，不需要 `importFromJsonl`：
  - `/export`（`interactive-mode.js` 的 `handleExportCommand`）：路径以 `.jsonl` 结尾走 `AgentSession.exportToJsonl`，否则 `exportToHtml`，两者都只作用于当前会话，扩展 ctx 上也没有。包的 `exports` 只开放了入口，`export-html/index.js` 里对任意文件导出的 `exportFromFile` 引不到；但 pi 的 CLI 公开了同一个函数：`pi --export <file> [out]`（`main.js`，在加载扩展 / 会话之前就处理完退出，本机实测约 1 秒）。JSONL 导出（`core/session-export.js`）只是"新 header + 活动分支上的条目、parentId 重新串成链"，用包导出的 `SessionManager` + `CURRENT_SESSION_VERSION` 就能照搬。
  - `/import`（`agent-session-runtime.js` 的 `importFromJsonl`）：把文件复制进当前会话目录（重名加 `-1`、`-2`，本来就在目录里则不复制），`SessionManager.open` 后切过去。`ctx.switchSession` 做的是同一件事的后半段（同样发 `session_before_switch`、目录不存在时同样弹"要不要在当前目录继续"），所以"自己复制 + switchSession"等价。
  - `/share`（`session-share.js`）：先试 Radius（要 pi 的 `modelRuntime`，扩展拿不到），不行再走 gist：`gh auth status` 检查登录 → 当前会话导出 HTML 到临时目录 → `gh gist create --public=false` → 从 gist 地址取 id，拼 `PI_SHARE_VIEWER_URL || https://pi.dev/session/` + `#id`。插件只走 gist 这条。
- actions（`actions/session-actions.ts`）：
  - `exportTarget(cwd, file, format, input)`：空输入 = pi 的默认文件名（`pi-session-<文件名>.html` / `session-<时间>.jsonl`）放在 pi 的工作目录；输入已存在的目录或以 `/`、`\` 结尾就在里面用默认文件名；返回绝对路径和是否已存在（面板据此决定要不要问覆盖）。用户输入的路径统一走新模块 `utils/paths.ts` 的 `resolveUserPath`（去引号、`~` 用 `os.homedir()` 展开、相对路径按 cwd 解析），Windows 下 `~/`、`~\` 都能用（CLAUDE.md 第 12 条）。
  - `exportSession(ctx, file, format, outputPath)`：JSONL 照搬 pi（当前会话用 pi 内存里的 manager，跳转后没落盘的叶子也算；其他会话读文件）；HTML 调 `pi --export`。拒绝把会话文件自己当输出（JSONL 只留一条分支会丢数据）；输出目录不存在就建（pi 的 `exportFromFile` 不建目录会失败）。
  - 调 pi CLI 用的是**正在运行的 pi**（`runningPi`）：npm 安装时 `process.execPath` + `process.argv[1]`（cli.js），Bun 编译的单文件里可执行文件本身就是 pi（argv[1] 是磁盘上不存在的虚拟路径）。不走 PATH 上的 `pi`：Windows 上那是 `pi.cmd`，不开 shell 起不来，版本也可能不同。子进程 stdin 关掉（否则会和 pi 抢终端按键），60 秒超时。
  - `importSession(ctx, input)`：校验（空 / 不存在 / 不是文件 / 空文件，空文件会被 `SessionManager.open` 当新会话初始化）→ 复制进 `ctx.sessionManager.getSessionDir()` → 交给 `resumeSession`（先 `SessionManager.open` 校验格式，必须在 `ctx.switchSession` 之前拦下，那里的异常会让 pi 直接退出）。校验失败或切换被取消时删掉刚复制的副本。
  - `shareSession(file)`：`gh auth status`（命令不存在报 pi 的 "GitHub CLI (gh) is not installed…"，未登录报 "…Run 'gh auth login' first."）→ `pi --export` 到临时目录 → `gh gist create --public=false` → 取 stdout 最后一行的 gist 地址；临时目录最后删掉。外部命令都可以通过 `ExternalCommands`（`{ command, args }`）替换，测试用 `node 假脚本.cjs`，不需要 shell / .cmd。
- 面板（`app.ts`）：
  - `e`：`Export as` 菜单（HTML / JSONL）→ `Export to` 输入框预填默认路径（绝对路径，一眼能看到写到哪），Esc 退回菜单且光标停在刚选的格式；目标已存在弹 `Overwrite file?`（覆盖是破坏性操作），No / Esc 退回输入框并保留刚才的输入；导出期间 footer `exporting…`，完成 `exported to <路径>`，面板不关、不隐藏。
  - `I`：`Import session` 输入框 → `Import and switch to it?` 确认（照 pi 的 "Replace current session with …?"；Esc / No 退回输入框保留路径）→ 走 `enter()`（隐藏面板、成功关闭、失败重新显示并在 footer 报原因）。空路径直接报 `import: no file given`。
  - `S`：`Upload as secret gist?` 确认（默认 No）→ footer `sharing…` → 成功后把 pi.dev 链接复制到剪贴板（链接长，footer 可能放不下）并显示 `share URL copied: <链接>`；剪贴板失败时显示 `shared: <链接>`。
  - 新增两个预设 `ui/widgets/export-dialog.ts`、`ui/widgets/import-dialog.ts`，确认框标题加 `SHARE_SESSION_TITLE` / `IMPORT_SESSION_TITLE` / `OVERWRITE_FILE_TITLE`；`PanelMode` 加 `export` / `import` / `share`；`ActionSource` 加 `exportTarget` / `exportSession` / `importSession` / `shareSession`（都可选，没注入时 footer 报 `export: actions unavailable` 等）；footer 提示补 `e Export` / `I Import` / `S Share`（排在最后，窄终端先被挤掉，? 帮助里都有）。
- 和 pi 的差异（记在 issues.md）：HTML 走 CLI，所以不带系统提示词 / 工具定义、用 pi 的默认主题（pi 的 `/export` 对当前会话会带上、用当前主题）；分享只走 gist、不试 Radius。
- 验证：本机用真实会话 + 全局 pi 的 `cli.js` 跑了一遍 HTML / JSONL 导出（HTML 写进新建的子目录，JSONL 用 `SessionManager.open` 能重新打开、id 一致）。分享没有真的上传（会把内容发出去），只用假 `gh` 测了流程。
- 测试：`test/session-actions.test.ts` 加 7 个（`utils/paths` 的引号 / `~` / 相对路径、`exportTarget` 的默认名 / 目录 / 已存在、JSONL 导出的 header 与链、当前会话按内存叶子导出、拒绝覆盖会话文件、HTML 调 pi 的参数与报错、导入的复制 / 重名 / 原地切换、导入的各种拒绝与取消后清理副本、分享的成功 / 未登录 / 未安装 / gist 失败）；`test/panel.test.ts` 加 9 个（e 的两级弹窗往返 / JSONL / 覆盖确认 / 失败，I 的确认往返 / 空路径 / 失败重新显示，S 的确认 / 复制链接 / 失败 / 剪贴板失败，三个键在没有 actions 时的提示）。`npm run check` 通过，`npm test` 129 个里 128 个通过；唯一失败的是**原有的** `deleteSession: a trash command that removes the file counts as trash`，在 Windows 上改动前就失败（见 issues.md），和本次无关。

### SESSIONS 的 space 多选 + 批量删除、全局 @ 查看 changelog（2026-09-24）

- ~~`space` 多选：切换光标行的选中态（行首画标记），标题显示 `3 selected`；Esc（没有搜索时）先清空选中再退出。~~
- ~~`d` 在有选中时改为批量删除：确认框标题带数量，跳过 pi 当前打开的会话，逐个调 `deleteSession`，失败的留在列表里（仍保持选中）并把第一条错误写进 footer。~~
- ~~选中多个时，`r`（rename）/ `o`（fork）/ `y`（clone）等只能作用于单个会话的动作提示 `cannot … multiple sessions`。~~
- ~~`@`（global）：和 pi 的 `/changelog` 一样读 pi 安装目录的 `CHANGELOG.md`，用 pi-tui `Markdown` 渲染在居中大弹窗里，`j` / `k` / 方向键滚动、`g` / `G` 顶部 / 底部，`Esc` / `q` / `@` 关闭。~~
- ~~键位、`ACTION_DESCRIPTIONS`、footer、`docs/keybindings.md` 同步；测试补上。~~

实现说明（2026-09-24）：

- 多选（`app.ts`）：`toggleSelect` 往 `PanelState.selectedSessionFiles` 里加 / 删光标行；`listSessions` 每次重新拉列表时把已不在列表里的文件从选中里去掉。面板行首改成两列标记：第一列光标 `›`、第二列选中 `•`（光标停在选中行上时显示 `›•`，之前光标会盖住选中标记）；标题右侧先放 `3 selected`，剩下的空间再放位置 / 搜索计数（`sessions-pane.ts` 的 `selectedMeta`）。Esc 的顺序：半截按键 → 当前面板的搜索 → SESSIONS 的选中 → 退出面板。
- 批量删除：`confirmDeleteSession` 有选中时走 `confirmDeleteSelected`：按列表顺序取选中的行，跳过 pi 当前打开的会话（顺手从选中里去掉），全被跳过时直接报 pi 的那句话；确认框标题 `Delete N sessions?`，右侧列出会话标题（有跳过时前面加 `current session skipped`）。确认后逐个 `deleteSession`，成功的从选中里去掉，失败的留在列表和选中里，footer `N sessions deleted` 或 `deleted 2, 1 failed — <会话>: <原因>`。
- 单会话动作的拒绝：`refuseMultiSelect` 在选中 ≥ 2 个时让 r / o / y / e / S 报 `<动作>: cannot act on multiple sessions (Esc clears the selection)`；Enter / i / Y 仍作用于光标行（只读或只是打开）。
- changelog：先查了 pi 0.85.1 的 `handleChangelogCommand`：`getChangelogPath()`（包目录下的 `CHANGELOG.md`）→ `parseChangelog`（按带版本号的 `##` 标题切段）→ 倒序拼接 → `Markdown` 渲染在聊天区。`parseChangelog` 没从包里导出，`getPackageDir` 导出了（运行时指向正在运行的 pi），所以新增 `data/changelog.ts` 照搬切分规则（顺手认 `
`）。和 pi 的差异：pi 倒序是因为聊天区看的是底部（最新的在最下面），弹窗从顶部开始看，保持文件顺序、最新的在最上面；pi 的 `normalizeChangelogLinks`（把相对链接改成 GitHub 地址）没照搬，终端里点不了链接意义不大。
- 弹窗 `ui/widgets/changelog-dialog.ts`（`ChangelogDialog`）：和树对话框一样占满终端只留 2 列 / 1 行边距，pi-tui `Markdown` 按宽度缓存渲染结果，j / k / ↑ / ↓ 一行，ctrl+d / ctrl+u / PageDown / PageUp 半页，g / G 顶部 / 底部（弹窗里不做 `gg` 多键序列），标题右侧 `1-38/2140`，Esc / q 关闭，再按 `@`（按最终 keymap 判断）由面板关闭；其他键吞掉。`DataSource` 新增可选的 `loadChangelog`，`PanelMode` 加 `changelog`；树对话框里 `@` 被 `DISABLED_ACTIONS` 关掉。
- 键位：global 新增 `changelog`（默认 `@`），`ACTION_DESCRIPTIONS` / footer（三个面板的提示都在 `quit` 前加了 `@ Changelog`）/ `docs/keybindings.md` 同步。
- 测试：`test/panel.test.ts` 加 4 个（space 标记 / 标题 / Esc 两级，批量删除含跳过当前会话与失败保留，选中多个时 r o y e S 拒绝，@ 弹窗的滚动 / 跳转 / 三种关闭 / 按键不漏到面板）；新增 `test/changelog.test.ts`（切分、跳过无版本段、文件缺失）。`npm run check` 通过，`npm test` 135 个里 134 个通过，唯一失败的仍是 Windows 上原有的 `deleteSession: a trash command …`（见 issues.md）。

### 下一步可以做的任务（2026-09-23 记录，方便换机器后接着做）

当前状态：SESSIONS 面板的 Enter / d / r / s / i / n / o / y / Y 都做完了，TREE 面板和树对话框的功能也齐了，三个面板的 `/` 搜索齐了。`npm run check` + `npm test`（113 个）全过。剩下的按建议顺序：

1. ~~**`space` 多选 + 批量删除**~~（2026-09-24 完成，见上面"SESSIONS 的 space 多选 + 批量删除、全局 @ 查看 changelog"）（`session-toggle-select` 已绑好键，`PanelState.selectedSessionFiles` 这个集合在删除时已经在维护了，但没有任何地方往里加）。做法：space 切换光标行的选中态、行首画标记、标题显示 `3 selected`；`d` 在有选中时改成批量确认（确认框标题带数量），逐个调 `deleteSession`、失败的留在列表里并把第一条错误写进 footer；按 design.md 的要求，选中多个时 `r`（rename）和 `o`（fork）要提示"不能对多个对象操作"。范围最小、没有新的 pi API。
2. ~~**`e` 导出 / `I` 导入**~~（2026-09-24 完成，见上面"SESSIONS 的导出 / 导入 / 分享"）（`session-export` / `session-import` 已绑好键，`actions/session-actions.ts` 里 `exportSession` / `importSession` 还是 TODO 空壳）。pi 侧的 API 已经查到：导出是 `AgentSession.exportToHtml(outputPath?, { themeName? })` 和 `exportToJsonl(outputPath?)`（都在 `dist/core/agent-session.d.ts`，只对**当前打开的会话**有效，所以其他会话要么先切过去，要么自己按 session-format.md 拼 JSONL——动手前先查 pi 有没有对任意文件导出的路子）；导入是 `AgentSessionRuntime.importFromJsonl(inputPath, cwdOverride?)`，扩展 ctx 上**没有**暴露它（`ExtensionCommandContextActions` 里只有 waitForIdle / newSession / fork / navigateTree / switchSession / reload），所以导入可能做不了，先查清楚，做不了就记到 issues.md。UI 上两个都需要一个"输入路径"的输入框（`InputDialog` 直接能用），导出还要选 HTML / JSONL（`SelectDialog`）。
3. ~~**`S` 分享为私有 Gist**~~（2026-09-24 完成，同上）（`session-share` 已绑好键，`shareSession` 是空壳）。风险最高：要走网络、要 GitHub 凭据、是外发操作，一定要确认框并在 footer 显示生成的链接。建议放最后，动手前先查 pi 自己的 `/share` 怎么实现的（大概在 `interactive-mode.js` 里搜 `gist`）。

注意事项（这次踩到的，做上面几项时同样适用）：

- 凡是调 `ctx.fork` / `ctx.newSession` 这类会话替换 API，**异常会让 pi 直接 `process.exit(1)`**（见上面 fork 那条），所有能提前判断的非法情况都要在 actions 层先拦下。
- 会话替换后旧 ctx 立刻失效，后续动作只能放进 `withSession` 拿到的新 ctx。
- 破坏性 / 外发操作（批量删除、share）必须先过 `ui/widgets/confirm-dialog.ts`（CLAUDE.md 第 7 条）。

### 快捷键收尾

1. ~~看看 /compact 这个命令能不能做进去，我想要的效果是，通过一个快捷键能够压缩选中的对话，压缩完进对话，注意如果压缩过程比较慢，可能需要加载动画或者进度条组件~~
2. ~~? 开启的那个快捷键提示，那个菜单里面的快捷键介绍，可以优化一下顺序，使用频率高的可以放在前面~~
3. ~~space 多选的UI效果可以优化一下，目前是在前面加个点，这个还有更好的效果吗？~~
4. ~~目前changelog对话框打开还是比较慢的，可以在底部添加一个加载的提示？例如: xxx对话框打开中....... 可以在这段文字前加一个加载的动画（正方形进度条旋转）~~
5. ~~底部提示的键盘太多了，可以只提示一些比较关键的快捷键~~

实现说明（2026-09-24，第 1 项 /compact）：

- 先查了 pi 0.85.1：扩展 ctx 暴露 `ctx.compact({ customInstructions?, onComplete, onError })`（`extensions/types.d.ts`，fire-and-forget，结果走回调），底层 `session.compact`（`agent-session.js`）会先 `await this.abort()` 再对**当前会话的活动分支**做一次 LLM 摘要压缩，没 model / 会话太小 / 已压缩会抛错。因为只作用于当前会话，压缩其他会话必须先切过去——正好对应"压缩完进对话"。
- 键位：SESSIONS 面板新增 `session-compact`（默认 `c`；`C` 是全局 scope-current，小写空闲、助记 compact）。`ActionId` / `PanelMode`（`compact`）/ `EnterOutcome`（`compacted`）/ `ACTION_DESCRIPTIONS` / `FOOTER_HINTS`（排在 `i Info` 后）/ `footer.ts` 的 `SHORT`（`Compact`）/ `docs/keybindings.md` / `docs/design.md` 同步。
- actions（`actions/session-actions.ts` 的 `compactSession`）：光标会话就是当前会话时直接压缩，返回 `compacted`；其他会话走 `resumeSession(..., { withSession })`，在 pi 给的新 ctx 上压缩（切换后旧 ctx 失效、面板已被 pi 收掉，失败只能 `next.ui.notify`，和 `restoreNode` 一致）。`runCompaction` 把 fire-and-forget 的 `ctx.compact` 包成 promise（onComplete → resolve、onError → reject）。
- 进度动画：`startFooterSpinner` 用 `ctx.ui.setStatus(EXTENSION_ID, "◰ compacting conversation…")` 每 120ms 轮换一帧旋转的方块（`constants.ts` 的 `SPINNER_FRAMES` / `SPINNER_INTERVAL_MS` / `COMPACTING_STATUS`，任务 #4 可复用），压缩结束（成功或失败）清掉。面板隐藏期间进度写在 pi 自己的 footer 上（和 /tree 分支摘要同一手法，只是加了动画）。
- 面板（`app.ts` 的 `openCompactInput` / `submitCompact`，和 `openNewSessionInput` 同构）：`c` → 多选 ≥2 时 `refuseMultiSelect("compact")`；否则弹 `ui/widgets/compact-dialog.ts` 的 `Compact` 预设（InputDialog，标题右侧显示会话预览，可留空），回车走 `enter()`（隐藏面板 → 成功关闭 / 失败重显 + footer 报错），空输入传 `undefined`（用 pi 默认指令）。不弹确认框（压缩只追加一条 compaction 条目、不删数据，和 pi 自带 /compact 一致）。
- 测试：`test/session-actions.test.ts` 加了 3 个（当前会话透传/不透传 customInstructions + spinner 起停、失败清 footer、其他会话先切再压 + 失败 notify）；`test/panel.test.ts` 加了 `c` 的往返（输入框 / 空与带指令 / Esc / 失败留 footer）、把多选拒绝和无 actions 提示补上 `c`。`npm run check` 通过，`npm test` 139 个全过。

实现说明（2026-09-24，第 2 / 3 / 4 / 5 项）：

- **第 2 项（? 帮助按频率排序）**：`?` 帮助里每个 scope 的展示顺序 = `DEFAULT_KEYMAP` 里 key 的书写顺序（`help-overlay.ts` 的 `buildScopeLines` 遍历 `Object.keys`）。所以直接重排 `keymap.ts` 里 global / sessions / tree 三个 scope 的 key 顺序，高频在前：sessions 先 `Enter Resume` 再 j/k、gg/G，然后 n/d/r、s/i、space、c、o/y/Y，最后 J/K 滚动和 e/I/S；global 先 `/` 再切面板、n/N、C/A、? / @ / q；tree 先 `Enter` 再 j/k、gg/G、z/a/T/y。**只影响帮助展示**——键位解析和顺序无关，footer 另有 `FOOTER_HINTS` 顺序，用户自定义键位深合并后照样按这个基础顺序显示。没有新增 ActionId，`ACTION_DESCRIPTIONS` / `HELP_GROUPS` 不动。
- **第 3 项（多选 UI）**：`sessions-pane.ts` 的 `renderRow` 去掉第二列的选中图标（原来是 `✓`），选中**只靠标题着 accent 色**区分（`titleStyle`；光标行整行反白时标题也着 accent），长列表里一眼能扫出选了哪些。第二列保留一个空格做对齐，line2 缩进不变。`docs/keybindings.md` / `docs/design.md` 的 Space 说明同步。
- **第 4 项（changelog 加载提示）**：实测慢在 pi-tui `Markdown.render` 渲染整份 changelog（约 5700 行、550KB，同步阻塞），文件读取只要 ~3ms。所以 `changelog-dialog.ts` 加了 loading 态：`openLoading()` 先画空框 + 中间一行居中的 `◰ Loading changelog…`（复用 `SPINNER_FRAMES`），`setContent(md)` 再填内容；`app.ts` 的 `openChangelog` 先 `openLoading()` + 起一个 120ms 的 spinner 定时器（`startChangelogSpinner`，`unref` 防止拖住测试进程）+ `requestRender`，`await load()` 后**再 `await setTimeout(0)` 让加载帧先画出来**（否则两次 requestRender 可能被合并，加载提示看不见），最后 `setContent` + 停 spinner。渲染结果按 `(width, markdown)` 缓存且跨 `close()` 保留，`app.changelogMd` 也缓存了 markdown，所以**第二次 `@` 直接 `setContent` 秒开、不再显示加载**。同步的那次重渲染本身没法转动画（单线程），但提示会在它之前出现。加载中 Esc/q 可取消（`isLoading` 守卫让异步续着的 `setContent` 不会把已关的弹窗重新打开）。`closeChangelog` / `dispose` 都会停 spinner。
- **第 5 项（footer 精简）**：`keymap.ts` 的 `FOOTER_HINTS` 砍到每个面板只留核心键——sessions：`/ 搜索 · Tab 切面板 · C/A 范围 · Enter · d · r · n · ? · q`；tree：`/ · Tab · Enter · z · a · ? · q`；content：`/ · Tab · gg · G · ? · q`。长尾（排序 / 信息 / 压缩 / fork / clone / 复制回复 / 导出 / 导入 / 分享 / changelog）只进 `?`。footer 本来就按宽度截断，这里是把"半高频"的一串直接从常驻提示里拿掉。
- 测试：`test/panel.test.ts` 的多选测试断言 `•` → `✓`（`›✓beta` / `✓alpha`），changelog 测试改为先断言"加载中弹窗（`Loading changelog` + 还没内容）"、`await flush()` 后再断言内容和 `j/k scroll` 提示；帮助 / footer 的既有测试都是按存在性断言，重排后照常通过。`npm run check` 通过，`npm test` 139 个全过。

### i18n

项目需要支持多语言模式，目前需要支持得中文和英文，请使用 i18n 框架来处理。

1. ~~使用 t 函数包裹当前所有UI上的文案, 一些日志打印不用管, 语言显示要统一，不要中文界面里面还有一些英文文案~~
2. ~~package.json 添加扫描命令，将文案扫描到对应的json文件中，并且进行翻译，翻译要比较优雅~~
3. ~~默认跟随系统语言即 可，如果是没有提供国际化的语言，请使用英文~~
4. ~~项目目录符合国际化工程的规范就行了~~

实现说明（2026-09-24）：

- 框架：用 `i18next`（新增到 `dependencies`，不进 peerDependencies——那三个 pi 包的约束不变）。新增唯一知道 i18next 的模块 `src/i18n/index.ts`：`initI18n(lng?)` 同步初始化（`initImmediate:false` + inline resources，`escapeValue:false` 因为终端不是 HTML），`detectLocale()` 按 `LC_ALL > LC_MESSAGES > LANG > LANGUAGE` + `Intl` 兜底判断，`normalizeLocale` 只认 `zh*` → 中文，其余回退英文（`fallbackLng: en`）；导出的 `t()` 未初始化时惰性按系统语言初始化，任何调用点都能拿到文案。语言在一次会话内固定。
- 目录规范：翻译放 `src/i18n/locales/{en,zh}.json`（英文是基准语言 / source of truth），用 `fs` 读（不走 JSON import，省掉 NodeNext + verbatimModuleSyntax 的坑，也让运行时和扫描脚本读同一份格式）。`files` 里的 `src` 已经覆盖，随包发布。
- 文案改造：约定**不在模块顶层用 `t()` 计算 `export const`**（会在 import 期求值，可能早于 `initI18n`），需要文案的地方一律写成函数、渲染时才 `t()`。因此 `config/keymap.ts` 的 `ACTION_DESCRIPTIONS` / `HELP_GROUPS` / `SCOPE_TITLES` / `PANE_TITLES` / `TREE_DIALOG_HINT_TEXT` 改成 `actionDescription()` / `helpGroupText()` / `scopeTitle()` / `paneTitleText()` / `treeDialogHintText()`；各 widget 预设的标题 / 提示（label/rename/new/import/fork/restore/export/confirm/session-info/changelog/tree-dialog、`search-bar` 的 `searchLabel()`）都由 const 改成函数；`footer` 的 SHORT / mode 名、三个面板的空态 / 计数 / 角色前缀（`user:`→`t("role.user")`）/ `YOU`·`ASSISTANT`、`sessions-pane` 的 scope / sort 标签、`search-highlight` 的 `searchMeta`、`app.ts` 里全部 `setStatus(...)`（含插值 `{{error}}` / 复数 `count`）都走 `t()`。`index.ts` 在注册命令前 `initI18n()`，命令描述和 `ctx.ui.notify` 的 "TUI only" 也本地化。搜索标签从写死的 `搜索:` 改成随语言（en `Search:` / zh `搜索:`）。
- 未本地化的部分（有意保留）：`actions/` 层抛出的技术性 Error 文本（如 `session file not found`、pi 原样措辞的 `Cannot delete the currently active session` / `GitHub CLI (gh) is not installed…`）——它们要么是诊断信息、要么刻意对齐 pi；面板把它们包在已翻译的 `xxx failed: {{error}}` 前缀里显示。会话里的 `role:` 搜索限定词、tree 的 kind 判断等数据层逻辑仍用英文标识符。
- 扫描命令：`npm run i18n:scan`（写）/ `npm run i18n:check`（只读，CI 用）→ `scripts/i18n-scan.mjs`。扫描 `src` 里所有静态 `t("…")` 的 key，和两份 json 对齐：报告①代码用到但 en 缺失②en 有 zh 缺（需翻译）③没被用到的孤儿（动态 `t(\`ns.${x}\`)` 记下前缀 `ns`、跳过该命名空间避免误报）；写模式把缺失 key 以空串补进两份并按字母排序（译文由人 / AI 补），`--check` 有问题时退出码非 0。翻译本身这次由 AI 一次性补齐，无需联网 / API。
- 测试：新增 `test/i18n.test.ts`（detectLocale / normalizeLocale / 初始化 / 插值 / 复数 / 缺失回退）。既有测试统一在文件顶部 `initI18n("en")`，断言仍按英文界面；用到的标题 / 提示常量改为在测试里调用对应函数取值（所见即所测），写死的 `搜索:` 断言改成 `Search:`（并用带冒号的 `Search:` 和 footer 里不带冒号的 `Search` 提示区分）。`npm run check` + `npm test`（140 个）+ `npm run i18n:check` 全过。
- 已知小问题：会话信息弹窗的标签列改成按可见宽度对齐（中文标签宽度不一），值仍换行不截断；`role.*` 只翻译显示前缀，不影响 `role:` 搜索。

### 鼠标事件

项目目前无法响应鼠标事件，但核心还是键盘操作，所以鼠标只做如下的适配：

1. ~~鼠标，触控板能够通过滚轮或者三指上下滚动列表~~
2. ~~点击列表中的item能够选中，双击对话能够进入，双击tree能够展开/收起~~
3. ~~点击列表和列表之外的空余的地方，焦点需要切换到对应的面板上~~

实现说明（2026-09-24）：

- 先查了 pi-tui / pi 的鼠标机制：`Component` 有可选的 `handleMouse(event)`，event 是规范化的单元格坐标（`type` 含 `wheel` / `click`，click 带 `clickCount`，`wheelDelta` 负数为上滚），overlay 的事件坐标由 `dispatchMouseToOverlay` 换算成组件本地坐标。**关键**：pi 只有 fullscreen 模式（`TuiAltScreen`）才开终端鼠标追踪并派发事件；regular（默认）模式用 `TuiMainScreen`，根本不收鼠标（第一版就栽在这，测试机默认 regular 所以"完全没反应"）。
- 分流两种模式（`index.ts`）：fullscreen 继续靠 pi 把事件派到 overlay 的 `handleMouse`；regular 模式插件自己开鼠标——`tui.terminal.write("\x1b[?1000h\x1b[?1006h")` 打开 SGR 上报，`tui.addInputListener` 截获原始 stdin，`ui/mouse-input.ts` 的 `parseSgrMouseChunk`（快速触控板滚动会把多条 wheel 合并进一次读入，这里拆开逐条）+ `MouseTracker`（按下 / 释放同格算一次 click，同格 400ms 内再点算双击；只认左键；滚轮 bit6）解析成 `TuiMouseEvent` 喂给 `panel.handleMouse`，鼠标序列一律 `consume` 掉不漏给按键；面板关闭时写 `\x1b[?1000l\x1b[?1006l` 恢复终端自己的滚动 / 选择。按 `tui.mode` 判断，`TuiMainScreen.mode === "regular"`。
- 新增纯函数模块 `ui/mouse.ts`：`panelGeometry(width, height, ratio)` 把面板的列 / 行切分抽出来（左栏 `leftW`、body 高度、SESSIONS / TREE 各自高度），`render()` 也改用它，保证"画出来的位置"和"点击命中的位置"永远一致；`hitTest(...)` 把单元格 (x, y) 映射到面板 + 列表行号（SESSIONS 每行 2 line、TREE 每行 1 line，窗口用和面板一样的 `scrollOffset` 重算；边框 / 底部不足一行的空白 / 页脚都返回"无行"）。`sessions-pane.ts` 的 `ROW_HEIGHT` 导出成 `SESSIONS_ROW_HEIGHT` 共用。
- `LazyPanel.handleMouse`：`disposed` / `entering` 时忽略；搜索输入或任意弹窗打开时吞掉滚轮 / 点击（返回 `{ handled: true }` 但不动列表），press / move / drag 一律返回 `undefined` 交回终端做文本选择。滚轮 → **只滚动指针所在面板的视图，不移动选中项**（列表用独立的 `listScroll` 偏移，CONTENT 按行滚）、不改焦点；单击 → 切焦点到指针所在面板，落在列表项上再把该面板光标移过去；双击 SESSIONS → `resumeSession`（等价 Enter），双击 TREE → `toggleTreeFold`（等价 z）。
- 列表滚动模型：`PanelState.listScroll.{sessions,tree}` 是滚轮设的首行偏移（`null` = 跟随光标、按光标居中，键盘默认）；滚轮改这个偏移、光标不动，任何键盘 / 点击移动光标都把它清回 `null` 重新居中。`ui/mouse.ts` 拆出 `verticalSplit` / `panelGeometry` / `listVisibleRows`（列 / 行切分和每个列表可见行数，render 和鼠标共用），`hitTest` 直接吃 render 用的首行偏移；`sessions-pane` / `tree-pane` 加可选的 `first` 属性（不传时按 `scrollOffset` 居中，行为和以前完全一样），`clampFirst` 夹范围。
- 测试：`test/ui.test.ts` 加了 `panelGeometry` / `listVisibleRows` / `hitTest` 的映射（按首行偏移）；`test/panel.test.ts` 单击切焦点 + 选中 / 边框只切焦点 / **滚轮只滚视图不动选中且不夺焦点、键盘移动清掉滚轮偏移、树滚轮不动选中** / 双击会话 resume / 双击树节点折叠 / 弹窗打开时鼠标被吞；`test/mouse-input.test.ts` 覆盖 SGR 解析与 `MouseTracker`。`npm run check` 通过，`npm test` 159 个全过。残留说明记在 issues.md。
- 调整（2026-09-24，按反馈）：滚轮原本是移动列表光标（会切换选中的会话 / 节点并联动加载），改成只滚动视图、不动选中，符合"单纯滚动列表"的预期。

### bug 反馈

1. 打开/关闭按键提示对话框（？）之后，再切换面板，对话框会闪一下（2026-09-24：`clearOnShrink` 没能消掉这个残影，影响不大，已搁置到 `docs/issues.md`，等用户再提到时再修）
2. ~~在新对话上使用插件还算正常，但是如果选中了一个对话，然后在选中的对话中，再次打开插件，这个时候滚动会发现，整个插件面板都会整体向下移动，这很丑，有没有办法解决~~（2026-09-24 完成，见下面的实现说明）
3. ~~英文状态下，按键提示框面板（？）中英文会进行省略，这里最好不要省略，毕竟是很重要的信息，可以选择换行展示。~~（2026-09-24 完成）

实现说明（2026-09-24）：

- **第 2 项（面板整体下漂）+ 第 1 项（残影闪，未解决）**：两者同源。面板用 `ctx.ui.custom(..., { overlay: true })` 挂全屏 overlay，pi 文档明说 overlay "renders on top without clearing the screen"，而 pi 的 `terminal.clearOnShrink` 默认 `false`（`settings.md`："Clear empty rows when content shrinks (can cause flicker)"）。在 `src/index.ts` 的 `ctx.ui.custom` 工厂里加 `if (typeof tui.setClearOnShrink === "function") tui.setClearOnShrink(true)`（存在性判断兼容老版本 pi）。用户在真实 pi 里验证：**第 2 项（有内容的当前会话里滚动时面板整体下漂）已解决**；**第 1 项（关掉 `?` 帮助框后切面板闪一下残影）依旧**——残影更像是 pi overlay 合成的时序问题，`clearOnShrink` 只清腾空的行、清不掉那一帧。影响不大，先搁置（`docs/issues.md`），备选思路（关弹窗时 `requestRender(true)` 强制整屏重绘等）留待再提时试。`setClearOnShrink(true)` 保留，因为它修好了第 2 项。
- **第 3 项（帮助框英文换行）**：`help-overlay.ts` 原来每个绑定拼成一行交给 `frame()` → `fit()` → `truncateToWidth(..., "…")`，宽度还封顶 64 列，英文描述（如 tree 的 `z` "Fold / unfold the branch under the cursor (inside a branch: fold it and jump to its head)"）就被 `…` 截掉；中文短看不出来。改法：新增 `wrapText`（按可见宽度折行，英文按空格断词、单词超宽再按列硬断）和 `helpLayout`（把逻辑行展开成实际渲染行，binding 描述折到续行、续行 keys 列留空），`renderHelpBox` / `helpBoxSize` / `helpLineCount` 三处都基于 `helpLayout` 的行数，滚动和盒子高度不会对不上。`helpLineCount` 加了 `termW` 参数（`helpBoxWidth(termW)` 决定盒宽 → 描述列宽 → 折行数），`app.ts` 在 `render` 里存 `lastWidth`、`handleHelpInput` 用它 clamp 滚动。`helpBoxSize` 的签名从 `(termW, termH, lineCount)` 改成 `(termW, termH, keymap, focus)`。用户已在真实 pi 里确认第 3 项 OK。
- 测试：`test/panel.test.ts` 加了 "help wraps long descriptions onto continuation rows"（tree 帮助里 `z` 的长描述首尾都完整出现、不带 `…`、每行仍是精确宽度）；既有帮助测试（合并行、各面板标题、宽度不变）原样通过。`npm run check` + `npm test`（145 个）+ `npm run i18n:check` 全过。

### 新功能

1. 加个选项，能够让用户主动切换语言
