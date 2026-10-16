# 主题（Theme）

面板**没有自己的主题**。它画的每一个颜色都来自 pi 当前的活动主题，主题列表和切换也直接交给
pi：这里只说明这份映射，改颜色请改 pi 的主题文件。

## 数据流

```
pi 的主题文件（内置 dark/light、~/.pi/agent/themes/*.json）
    │  pi 自己扫描 / 校验 / 热重载
    ▼
ctx.ui.theme（live proxy，每次取属性都现查当前主题实例）
    │  src/index.ts 传给 LazyPanel 的 options.theme
    ▼
面板各 pane / dialog 的 theme.fg(...) / theme.bg(...)
```

- **跟随 pi**：入口传的是 `ctx.ui.theme`，不是 `ctx.ui.custom` 回调参数里的 `theme`。后者是
  构造那一刻的快照——pi 换主题时整体替换 `globalThis[THEME_KEY]`，拿着快照的面板会一直用旧
  颜色（`test/panel.test.ts` 的 "reads colors through the live theme" 锁住这一点）。
  pi 侧换主题（`/settings`、主题文件热重载）会触发 `ui.requestRender()`，面板跟着重绘。
- **内置 + 自定义主题**：都是 pi 的主题，面板不额外发明格式。用户按 pi 的
  `docs/themes.md` 写一个 JSON（全部 53 个必填 token + 可选 `vars`）丢进
  `~/.pi/agent/themes/`，设置页每次打开都重新扫描，新主题立刻出现在菜单里。
  改当前主题的文件，pi 会热重载，面板即时变色。
- **切换**：设置页 THEME 分类只有一行（右边是当前主题），Enter 弹出主题菜单。选中即切：
  直接走 `ctx.ui.setTheme(name)`，pi 立刻换主题（面板和 pi 的界面一起变色），并由 pi 写它自己的
  `settings.json`——设置页对主题没有草稿，也不需要再按 `s` 保存（其余三个分类同样是选中即落盘）。
- **失败**：pi 拒绝这个主题时，失败的名字留在设置页（`SettingsState.themeDraft`，行上带 `*`
  标记，算一处没生效的改动，退出时照样会被挽留），错误显示在设置框里，按 `s` 重试；
  按 `d` 或 `r` 重新加载则放弃这次切换。
  面板的 `~/.pi/agent/lazy-panel.json` **不保存 theme**（写了会在 footer 得到一条警告）。
- 主题菜单里的名字来自 `ctx.ui.getAllThemes()`，每一项还带各自的文件路径（内置主题在 pi 安装目录、
  自定义主题在用户目录），但**设置页不显示路径**：主题页平时只有一行主题名，没有说明，底部说明框
  整个不画（只有切换失败、或一个主题都没有时才给一句提示）。路径留给 `getAllThemes()` 的调用方。

## 主题明暗必须和终端底色一致

pi 的主题里**没有「应用底色」这个 token**（`ThemeBg` 只有 `selectedBg` / `searchMatchBg` /
`userMessageBg` / `customMessageBg` / 三个 tool bg），所有前景色都是设计成直接落在**终端自己的
底色**上的：内置 `light` 的 `text` 是 `#1f2328`（近黑），`dark` 的是 `#d4d4d4`。

所以主题的明暗和终端底色是**绑定**的：深色终端配 `light` 主题（`#1f2328` 的字落在黑底上）在
pi 自己的界面里同样看不清——这不是面板的问题，面板只是跟着主题走。pi 自己也是这么处理的：
首次运行探测终端底色来自动选 `dark` / `light`，并且支持跟随终端外观的写法：

```jsonc
// ~/.pi/agent/settings.json
{ "theme": "light/dark" }   // 终端浅色用 light、深色用 dark，跟着终端外观走
```

命令行上是 `pi --use-theme light/dark`。想省事就用这个，别手动钉死一个和终端相反的明暗。

### 光标行

选中行的底色是主题的 `selectedBg`，而它本来就只比主题假设的底色亮一档（`dark` 的 `#3a3a4a`
落在它假设的画布 `#18181e` 上只有 1.6:1，落在纯黑终端上 1.9:1），压在它上面的 `dim` / `muted`
文字会跟着糊掉。所以**光标行的次级文字统一提亮一档**（`dim` → `muted`、`muted` → `text`，
见 `ui/cursor-tone.ts`）：时间戳、会话行的「模型 · 路径 · 条数」、旁支行、树缩进线都算在内。
这样「光标在哪」在任何主题、任何终端底色下都看得清，也不用改主题文件。

## 面板元素 → pi token

面板只用 pi 现有的 token，没有面板专属的颜色名。下面是全部用到的映射（改主题时对着这张表调）：

| 面板元素 | token |
|---|---|
| 面板 / 弹窗边框 | `border`（无焦点）、`borderAccent`（有焦点、设置主框） |
| 面板标题、光标 `›`、活动路径 `•`、选中行前景、段头 | `accent`（无焦点时标题降为 `muted`） |
| 光标行背景、多选行、footer 的模式块、设置页选中行 | `selectedBg` |
| 正文、次级文字（消息预览、旁支行、搜索状态） | `muted`（在光标行上 = `text`，见上） |
| 三级文字：时间戳、树缩进线、footer 版本号、说明框元信息 | `dim`（在光标行上 = `muted`，见上） |
| 普通文字（未选中的设置项、无焦点弹窗文字） | `text` |
| 树段头的 `▸`/`▾`、未选中的标签 `[label]` | `warning`（`warning` 也用于 footer 的状态提示） |
| 多选框 `[x]`、成功状态 | `success` |
| 错误提示（设置保存失败、删除失败） | `error` |
| YOU 消息的头部与边框 | `userMessageText` |
| AI 消息的头部与边框 | `accent`（正文交给 pi-tui 的 `Markdown`，走 `md*` 系列） |
| 搜索命中（其他匹配） | `searchMatchBg` + `searchMatchText` + 下划线 |
| 搜索命中（当前匹配） | 同上反色 + 加粗（见 `ui/search-highlight.ts`） |

pi 的 `Markdown` 组件内部用 `getMarkdownTheme()`，那也是一份读 live proxy 的闭包，所以正文的
标题 / 链接 / 代码块颜色跟着主题走，不需要面板做任何事。

## 为什么不做面板专属主题

面板的次要元素（树缩进线、段头三角）复用 `dim` / `warning`，不能单独调色。这是有意的取舍：
pi 的主题 schema 只认它自己那 53 个 token，面板要单独调色就得再发明一套文件格式和扫描逻辑，
而绝大多数视觉元素用 pi 的 token 已经够贴切。真需要单独调这三两个元素时，再在 pi 主题文件里
加一个可选的面板覆盖段（pi 忽略它、面板读它），比现在就引入第二套主题系统便宜。
