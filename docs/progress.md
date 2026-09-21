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
- 修正：`assistant: (empty)`（中断/失败产生的空回复）在 tree 里归为 meta，默认过滤下隐藏，`a` 全部模式仍可见；活动分支上没有消息框的节点（工具结果、空回复）��再截断右侧内容，而是保持完整分支并高亮它前面最近的一条消息。
