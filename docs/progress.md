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
- 输入框：抽出通用的底部一行输入 `ui/widgets/prompt-bar.ts`（包装 pi-tui `Input`），搜索栏和 `ui/widgets/label-bar.ts`（`Label: ` 前缀，预填当前标签）都基于它；新增 `PanelMode` 的 `label` 模式，该模式下所有按键交给输入框。
- 反馈都在 footer：`copied node text to clipboard` / `selected entry has no text to copy` / `label set: xxx` / `label removed` / 失败原因。
- 测试：`test/panel.test.ts` 加了 y / T 的面板行为测试（含错误分支和无 actions 的情况）；新增 `test/tree-actions.test.ts` 在临时目录里建真实会话文件，验证 `loadNodeText` 和 `labelNode` 的落盘与 `pi.setLabel` 分流。

### TREE 打标签改为居中弹窗（2026-09-22）

- ~~T 打标签的输入框从底部一行改成面板中央弹出的输入框（类似 lazygit commit 的效果）：标题 `Label`，右侧显示被打标签的节点（`assistant: …`），回车保存、Esc 取消、空内容清除；按键提示放在底部 footer（`LABEL │ Enter save  Esc cancel  empty removes`）。~~

实现说明（2026-09-22）：

- 新增 `ui/widgets/label-dialog.ts`（`LabelDialog`）：包装 pi-tui `Input`，5 行高的居中方框，预填当前标签且光标停在末尾（直接退格就能清空）；删除原来的 `ui/widgets/label-bar.ts`，`prompt-bar.ts` 现在只被搜索栏使用。
- `ui/frame.ts` 抽出 `overlayCentered`（居中叠加，基于 pi-tui `compositeTuiLine`），帮助弹窗和标签弹窗共用；后续的确认框 / 会话信息弹窗也可以直接用。
- `ui/widgets/footer.ts` 新增 `hints` 参数：弹窗打开时 footer 显示弹窗自己的按键提示，而不是当前面板的键位；`types.ts` 新增 `KeyHint` 类型给 footer / prompt-bar / label-dialog 共用。
- `test/panel.test.ts` 的 T 测试改为断言弹窗画在面板中间、标题带节点信息、footer 带提示、Enter/Esc 后弹窗消失；`test/ui.test.ts` 加了 `overlayCentered` 的几何测试。

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
