## 已知问题

搁置中的问题，解决后用 `~~` 划掉并写明处理方式。

### 窄终端下 SESSIONS 标题右侧 meta 显示不全（2026-09-21）

- 现象：非全屏（如在 herdr 里）使用时，Current 模式只显示 `1/16 · Current`，看不到排序 `· recent`；All 模式因为标签短，能完整显示 `1/16 · All · recent`。
- 原因：左栏按 `LEFT_COLUMN_RATIO`（0.25）分配，160 列终端左栏只有 40 列，`[1] SESSIONS` 标题占掉 20 列后 meta 只剩 20 列，`1/16 · Current · recent` 需要 23 列，于是按 `sessionsMeta` 的降级链缩短。全屏使用没有问题。
- 备选方案（暂不处理）：scope 标签统一缩成 `Cur`；排序标签缩成 `rec` / `thr`；或把左栏比例调到 0.3。

### Enter 恢复时不确认就中断正在输出的回复（2026-09-22）

- 现象：pi 还在流式输出时，在面板里按 Enter（SESSIONS 切会话 / TREE 跳节点）会直接中断当前回复再切换 / 跳转，没有确认框。
- 原因：和 pi 自带命令一致——`ctx.switchSession` 内部先 `session.abort()`，内置 `/resume` 不问；`ctx.navigateTree` 在输出中直接抛错，内置 `/tree` 是选定节点后先中断再跳。面板是全屏 overlay，用户看不到 pi 正在输出，所以比内置命令更容易误伤。
- 备选方案（暂不处理）：等 `ui/widgets/confirm-dialog.ts` 落地后，`!ctx.isIdle()` 时先弹确认再继续；或者只在 footer 提示并让用户再按一次 Enter。

### 面板发起的分支摘要中途取消不了（2026-09-22）

- 现象：TREE Enter 选 Summarize / Summarize with custom prompt 后，面板隐藏、按键全部忽略，只能等模型把摘要写完或失败；内置 `/tree` 在摘要期间按 Esc 可以中止。
- 原因：扩展 API 没有暴露 `abortBranchSummary`；而且扩展 ctx 的 `navigateTree` 把 `{ aborted: true }` 折叠成 `{ cancelled: true }`，面板分不出是被中止还是被别的扩展否决，统一报 `branch summary cancelled`。pi 对扩展发起的摘要也不显示自己的进度指示，所以摘要期间只有 pi footer 上的 `summarizing branch…`（`ctx.ui.setStatus`）。
- 备选方案（暂不处理）：pi 的 `ctx.abort()` 内部走 `session.abort()`，会顺带 `abortBranchSummary()`；如果摘要期间让面板保持可见并把 Esc 接到 `ctx.abort()`，就能取消。但这要求 `enter()` 只在真正切换会话时才隐藏面板（`session_before_tree` 钩子里若有扩展弹窗仍可能被面板挡住），先不动。

### 当前会话在 `/tree` 无摘要跳转后，面板里的活动分支 / 叶子标记会短暂过期（2026-09-22）

- 现象：在 pi 里用 `/tree`（或面板 Enter → No summary）跳到旧节点后、还没发下一条消息时打开面板，当前会话的 TREE 仍把之前的分支画成活动分支，`isLeaf`（决定 Enter 弹不弹菜单）也跟着错：真正的叶子会弹菜单（无害，restore 是 no-op），被放弃的旧叶子反而不弹。
- 原因：pi 的 `SessionManager.branch()` 只改内存里的 leaf 指针，不落盘；`data/tree.ts` / `data/content.ts` 都是 `SessionManager.open(file)` 从文件重建，文件里最后一条还是旧叶子。发一条新消息（或带摘要跳转，会追加 `branch_summary` 条目）后就恢复正常。actions 层的 `restoreNode` 用的是 pi 内存里的 `ctx.sessionManager`，判断本身不受影响。
- 备选方案（暂不处理）：`loadTree` / `loadContent` 接受一个可选的 manager，`index.ts` 对当前会话传 `ctx.sessionManager`（`ReadonlySessionManager` 有 `getTree` / `getBranch` / `getLeafId` / `getEntries`），其他会话照旧读文件。

### ~~SESSIONS 的 s 排序在没有 fork 会话时看不出变化（2026-09-23）~~（同日解决：fuzzy 去掉，换成 created / title，见 progress.md）

- 现象：按 s 在 threaded → recent → fuzzy 之间循环，标题右侧的排序名变了，列表顺序却一样。
- 原因：三种排序照搬 pi 内置 `/resume`（`session-selector-search.js` 的 `filterAndSortSessions`）：recent 按最后更新时间倒序；threaded 只是把 `/fork` 出来的子会话缩进挂到父会话下面、父会话按"自己和子会话里最近的一次更新"排序，没有 fork 关系时每个会话都是根，顺序和 recent 相同；fuzzy（pi 里叫 relevance）只在有搜索关键字时按匹配分数排序，没有关键字时 pi 自己也原样返回列表。插件的 `/` 搜索目前是跳转不排序，所以 fuzzy 现在和 recent 完全一样。
- 备选方案（暂不处理）：让 SESSIONS 的搜索生效期间 fuzzy 按匹配分数重排列表（要给 `matchSessionRow` 加打分），或者把 fuzzy 从循环里去掉只留 threaded / recent。

### 导出 / 分享的 HTML 和 pi 自带的 /export、/share 不完全一样（2026-09-24）

- 现象：面板 `e` 导出的 HTML、`S` 上传的 HTML 里没有系统提示词和工具定义，配色是 pi 的默认主题；pi 自带的 `/export` / `/share` 对当前会话会带上这些、用当前主题。`S` 也不会像 pi 那样先试 Radius（组织内分享），只走 GitHub gist。
- 原因：扩展 API 只有 `AgentSession.exportToHtml`（只能导出当前会话，ctx 上也没开放），包的 `exports` 只开放入口，渲染 HTML 的 `exportFromFile` 引不到，所以插件调用 pi 公开的 CLI `pi --export <file> <out>`，它本来就是为"任意会话文件"准备的、不带运行时状态。Radius 要 pi 的 `modelRuntime` 取凭据，扩展拿不到。
- 备选方案（暂不处理）：pi 以后在 ctx 上开放导出 / 分享时改用官方 API；或者对当前会话单独走 pi 自带的 `/export`（需要扩展能触发内置命令，目前不行）。

### Windows 上 `deleteSession` 的假 trash 测试失败（2026-09-24 发现，原有问题）

- 现象：`test/session-actions.test.ts` 的 `deleteSession: a trash command that removes the file counts as trash` 在 Windows 上失败（期望 `trash`，实际 `unlink`），改动前的代码上同样失败，其他平台应当正常。
- 原因：测试用一个 `trash.cmd` 包装脚本假扮 trash，但 Node 在 Windows 上不再允许不开 shell 直接 `spawnSync` 一个 `.cmd`（CVE-2024-27980 之后会报 EINVAL），于是回退到了 unlink。功能本身不受影响：Windows 上通常也没有 `trash` 命令，本来就是 unlink。
- 备选方案（暂不处理）：`DeleteOptions.trashCommand` 改成和导出 / 分享一样的 `{ command, args }`（`session-actions.ts` 的 `CommandSpec`），测试传 `node 假脚本.cjs`，就不需要 .cmd 了。

### 鼠标事件只在 fullscreen TUI 模式下生效（2026-09-24）

- 现象：插件的 `handleMouse`（滚轮滚动、单击切焦点 / 选中、双击进入 / 折叠）只有在 pi 以 `--tui-mode fullscreen` 运行时才会被调用；regular（默认）模式下鼠标完全没反应，滚动 / 选择还是终端自己的行为。
- 原因：pi 的 regular 模式用 `TuiMainScreen`，它根本不开启终端的鼠标追踪（不发 `\x1b[?1000h` 等序列），也没有 `handleMouse`，把鼠标选择交给终端模拟器；只有 fullscreen 模式的 `TuiAltScreen` 才开鼠标追踪并把事件派发给（含 overlay 的）组件（`node_modules/@earendil-works/pi-tui/dist/tui-alt-screen.js`）。插件是 `ctx.ui.custom` 的全屏 overlay，收到事件与否完全取决于 pi 用的是哪个 TUI，扩展侧改不了。
- 备选方案（暂不处理）：等 pi 在扩展 API 上提供“临时切到 fullscreen”或“为 overlay 打开鼠标”的开关；在那之前，需要鼠标的用户用 `pi --tui-mode fullscreen`（或设置里把 TUI 模式设为 fullscreen）。`handleMouse` 的逻辑本身与模式无关，单测直接调用它验证，不依赖 pi 的模式。
