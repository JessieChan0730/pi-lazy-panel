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
