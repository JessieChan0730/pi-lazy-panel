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
  `~/.pi/agent/themes/`，设置页每次打开都重新扫描，新主题立刻出现在列表里。
  改当前主题的文件，pi 会热重载，面板即时变色。
- **切换**：设置页 THEME 分类 Enter → `ctx.ui.setTheme(name)`。pi 负责写它自己的
  `settings.json`、广播变化、重绘；面板只在自己的状态里记下新的活动主题名。
  面板的 `~/.pi/agent/lazy-panel.json` **不保存 theme**（写了会在 footer 得到一条警告）。
- 主题名后的路径来自 `ctx.ui.getAllThemes()`：内置主题是 pi 安装目录里的文件，自定义主题
  是用户目录里的文件，设置页直接把路径显示在说明框里，所以列表不需要"内置 / 自定义"标签。

## 面板元素 → pi token

面板只用 pi 现有的 token，没有面板专属的颜色名。下面是全部用到的映射（改主题时对着这张表调）：

| 面板元素 | token |
|---|---|
| 面板 / 弹窗边框 | `border`（无焦点）、`borderAccent`（有焦点、设置主框） |
| 面板标题、光标 `›`、活动路径 `•`、选中行前景、段头 | `accent`（无焦点时标题降为 `muted`） |
| 光标行背景、多选行、footer 的模式块、设置页选中行 | `selectedBg` |
| 正文、次级文字（消息预览、旁支行、搜索状态） | `muted` |
| 三级文字：时间戳、树缩进线、footer 版本号、说明框元信息 | `dim` |
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
