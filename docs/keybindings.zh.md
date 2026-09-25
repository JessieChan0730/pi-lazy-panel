[English](./keybindings.md) | **中文**

# 快捷键与配置

默认键位的唯一真实来源是 `src/config/keymap.ts`。可在 `~/.pi/agent/lazy-panel.json` 的 `keymap.<scope>.<action-id>` 下覆盖任意键位（scope：`global`、`sessions`、`tree`、`content`、`tree-dialog`）。动作 id 就是 `src/types.ts` 里的 `ActionId` 联合类型。

## 配置文件

配置文件位于 `~/.pi/agent/lazy-panel.json`，所有字段均为可选，缺省时使用内置默认值：

```json
{
  "locale": "zh",
  "defaultScope": "all",
  "defaultSort": "recent",
  "leftColumnRatio": 0.25,
  "keymap": {
    "global":   { "help": "F1", "scope-all": ["A", "ctrl+space"] },
    "sessions": { "session-delete": "ctrl+d", "session-share": null }
  }
}
```

| 字段 | 说明 | 可选值 / 范围 | 默认 |
| --- | --- | --- | --- |
| `locale` | UI 语言 | `"en"` / `"zh"` | 跟随系统语言 |
| `defaultScope` | 打开时的会话范围 | `"current-folder"` / `"all"` | `"current-folder"` |
| `defaultSort` | 会话列表排序 | `"recent"` / `"created"` / `"title"` / `"threaded"` | `"recent"` |
| `leftColumnRatio` | 左侧列宽占比 | `0.15` ~ `0.6` | `0.25` |
| `keymap` | 自定义快捷键（见下） | 按 scope 分组 | 内置键位 |

- 非法的 `locale` / `defaultScope` / `defaultSort` 会退回默认值，越界的 `leftColumnRatio` 也会被忽略，并在面板打开时于 footer 提示。
- `locale` 缺省时按系统语言自动检测（见 `src/i18n/index.ts`）。

## 自定义快捷键

```json
{
  "keymap": {
    "global":   { "help": "F1", "scope-all": ["A", "ctrl+space"], "focus-sessions": "F5" },
    "sessions": { "session-delete": "ctrl+d", "session-share": null }
  }
}
```

- 一个值是**一个 chord** 或 **chord 数组**。它**替换**该动作的默认键位（不是追加），`null` 表示解绑该动作。
- **配置名称就是动作 id**（下面每张表格中间那一列），把它放到对应 scope 下即可，例如给 SESSIONS 的删除换成 `ctrl+d`：`{ "keymap": { "sessions": { "session-delete": "ctrl+d" } } }`。每个面板小节的 scope 见其标题：全局→`global`、SESSIONS→`sessions`、TREE→`tree`、CONTENT→`content`、树对话框→`tree-dialog`（表格里标注了非本 scope 的例外）。

- Chord 语法（`src/config/keys.ts`）：
  - 单键：`j`、`?`、`/`、`1`、`tab`、`enter`、`escape`、`space`、`up`、`pageDown`、`f1`
  - 修饰键：`ctrl+d`、`shift+tab`、`alt+x`、`ctrl+shift+p`（顺序任意）
  - 大写字母是 shift 的简写：`G` = `shift+g`
  - 多键序列：`gg`、`yy`（原样连写），或空格分隔的 `ctrl+w h`
- 面板键位会遮蔽同一个键的全局键位（例如 `n` 在 SESSIONS 面板是「新建会话」，在其它面板是「下一个匹配」）。`h` / `l` 没有被任何默认面板键位遮蔽，所以切换面板在哪里都一样。
- 树对话框按 `tree-dialog` → `tree` → `global` 顺序解析：它自己的键（`d` `t` `u` `l` `a` `q`）遮蔽面板与全局键位（`a` 变成过滤而不是打开对话框，`l` 变成「只看有标签」过滤而不是「下一个面板」，`q` 变成关闭对话框而不是退出），其余都沿用树面板的键位。
- 无效的 chord 或未知 scope 会被跳过，并在面板打开时显示在 footer。
- 多键序列最多等待下一个键 1 秒；`Esc` 丢弃打了一半的序列。
- 面板标题显示绑定到 `focus-<pane>` 的跳转键（`[1] SESSIONS`），所以重绑它标题也会跟着变。

## 全局快捷键

| 键 | 配置名称 | 操作 |
| --- | --- | --- |
| `l` / `Tab` | `focus-next` | 聚焦下一个面板 |
| `h` | `focus-prev` | 聚焦上一个面板 |
| `1` `2` `3` | `focus-sessions` / `focus-tree` / `focus-content` | 直接聚焦 SESSIONS / TREE / CONTENT |
| `C` | `scope-current` | 列表范围：当前文件夹（Current folder） |
| `A` | `scope-all` | 列表范围：全部（All） |
| `?` | `help` | 当前面板的快捷键帮助（`?` / `Esc` / `q` 关闭，`j` / `k` 滚动） |
| `q` / `Ctrl+c` | `quit` | 退出面板 |
| `@` | `changelog` | pi 的 changelog（`/changelog`）大弹窗：`j` `k` `↑` `↓` 滚动，`Ctrl+d` / `Ctrl+u` 半页，`g` / `G` 顶部 / 底部，`Esc` / `q` / `@` 关闭。整份文件渲染较慢，弹窗先在中间显示旋转方块 `◰ Loading changelog…`，随后显示内容（有缓存，第二次按 `@` 瞬间打开）。最新版本在最上面（pi 自己的 `/changelog` 放在最后）。树对话框里不可用 |
| `Esc` | —（内置，不可配置） | 依次：丢弃未完成的按键 → 清除当前面板的搜索 → 清除 SESSIONS 的多选 → 退出 |
| `/` | `search` | 搜索当前面板（见下）：底部搜索栏边输入边搜，`Enter` 保留关键字，`Esc` 取消 |
| `n` / `N` | `search-next` / `search-prev` | 当前面板搜索的下一个 / 上一个匹配，循环回绕。搜索生效时它们优先于同名的面板键位（`n` 只有在 SESSIONS 且没有搜索时才是「新建会话」） |

`C` 和 `A` 是单向的：已经在 *All* 时再按 `A` 无效。

`?` 帮助弹窗列出全部键位，按使用频率排序（最常用的在前，如 `Enter` 排在 vim 移动键之前）。底部 footer 只提示每个面板的少数几个键；长尾（排序 / 信息 / 压缩 / 分叉 / 克隆 / 导出 / 导入 / 分享 / changelog）只在 `?` 里能看到。

## 搜索（`/`）

lazygit 风格，每个面板各记各的：列表行永不过滤，光标在匹配之间跳转。`/` 在底部打开当前面板的 `搜索:` 栏；每敲一个键都跳到「光标位置或其之后的第一个匹配」（到底则回绕到第一个），没有匹配时把光标放回原位。`Enter` 保留关键字并把按键交回面板，搜索栏里的 `Esc` 丢弃关键字并恢复光标（在 TREE 里还恢复折叠）。之后面板标题显示 `2/7 matches`（光标不在匹配上时显示 `7 matches`，无匹配显示 `no matches`），footer 显示关键字和 `n next  N prev  Esc clear`，`n` / `N` 在匹配间步进、两端回绕。面板里的 `Esc` 结束该面板的搜索。每个面板保留自己的关键字，所以切换面板不会丢失；只有当前聚焦面板的搜索会被 `n` / `N` 步进，其它面板的命中仍保持高亮。命中文字会高亮；当前匹配（光标所在的那个）反色，以便和其它命中区分。

关键字大小写不敏感、且每个词都必须出现。裸词（不带限定词）只匹配「命名一行的内容」（会话名 / 预览、树节点 label / 正文、内容正文）；模型、路径、角色、日期都需要用 `key:value` 限定词（同类限定词以最后一个为准，未知 key 和无法解析的日期当作裸词搜索，某个面板没有的字段对应的限定词被忽略）：

| 面板 | 裸词匹配的字段 | 限定词 |
| --- | --- | --- |
| SESSIONS | 会话名和首条消息预览（行的标题）；模型和工作目录不参与裸词匹配 | `name:`（仅会话名）、`model:`（仅模型）、`path:`（工作目录，完整路径或 `~/…` 写法）、`after:` / `before:`（最后更新，`YYYY-MM-DD`）；`tag:` 被忽略 |
| TREE | label 和正文；折叠的行也算。角色不参与裸词匹配（与 `/tree` 不同） | `tag:`（仅 label）、`role:`（`user` / `assistant` / `system` / `tool`）、`after:` / `before:`（节点时间）；`name:` `model:` `path:` 被忽略 |
| CONTENT | 消息渲染后的正文行（跳过消息框头部）；命中会被滚到面板顶部 | 无（限定词被丢弃，只搜裸词） |

跳到折叠分支里的 TREE 匹配会展开它，右侧 CONTENT 照常跟随光标。树对话框（`a`）有自己的搜索行，它是**过滤**而不是跳转，两者互不影响。

## SESSIONS 面板

面板打开时光标落在 pi 当前打开的会话上（因此 TREE / CONTENT 显示当前对话）；一个尚未列出的全新会话则把光标停在第一行。`C` / `A` 切换范围后仍从顶部开始。`/` 搜索会话名和首条消息预览，`model:` / `path:` 触及模型和工作目录（见上文*搜索*）；该搜索生效期间 `n` / `N` 步进匹配，而不是 `n` 新建会话。

| 键 | 配置名称 | 操作 |
| --- | --- | --- |
| `j` `k` `↑` `↓` | `move-down` / `move-up` | 移动光标 |
| `gg` / `G` | `go-top` / `go-bottom` | 顶部 / 底部 |
| `J` / `K` | `scroll-content-down` / `scroll-content-up` | 滚动右侧 CONTENT 面板 |
| `Enter` | `session-resume` | 恢复会话：pi 切换过去、面板关闭；失败（文件缺失、切换取消）停留在 footer |
| `d` | `session-delete` | 删除：居中的 *Delete session?* 框问 Yes / No（光标停在 No，`y` / `n` 直接选，`Enter` 确认高亮项，`Esc` 取消）。和 pi 的 `/resume` 一样，有 `trash` CLI 时移入系统回收站，否则直接 unlink（footer 说明用了哪种）；pi 当前打开的会话会被拒绝、不询问。列表重新加载，光标夹回范围内，TREE / CONTENT 跟随 |
| `r` | `session-rename` | 在预填当前名字的居中框里改名（`Enter` 保存，`Esc` 取消，空值清除名字；等同 `/name` 或 `/resume` 里的 ctrl+r）。列表重新加载，光标仍停在该会话 |
| `n` | `session-new` | 新建会话（`/new`）：居中的 *New session* 框询问名字（`Enter` 创建，`Esc` 取消，**留空则以未命名启动** —— `/name` 的 `[name]` 参数不设置）。pi 切换到新会话、面板关闭 |
| `o` | `session-fork` | 分叉（`/fork`）：居中选择器列出会话的用户消息（光标停在最后一条，和 pi 自带 `/fork` 一致；`j` / `k` 移动，长列表可滚动），`Enter` 选中后 *Fork session?* Yes / No 框确认（`Esc` / No 退回选择器）。分叉从那条消息**之前**开始，pi 把它的文本填回编辑器。非当前会话会先切过去；没有用户消息时提示 *No messages to fork from* |
| `y` | `session-clone` | 克隆（`/clone`）：*Clone session?* Yes / No 框确认（光标停在 No），随后把活动分支复制到新会话文件、pi 打开它 |
| `Y` | `session-copy-last-reply` | 复制最后一条 assistant 回复到剪贴板（`/copy`）：只取其文本片段，跳过思考和工具调用；面板保持打开，footer 报告结果（*copied last reply* 或 *no assistant reply to copy*） |
| `Space` | `session-toggle-select` | 切换多选：不画标记字形 —— 选中行的标题着色（accent），在长列表里凸显 —— 标题以 `3 selected` 开头。有选中时 `d` 在一次 *Delete N sessions?* 确认后删除全部（跳过 pi 打开的会话；失败的仍列出并保持选中，第一条错误进 footer），而 `r` `o` `y` `e` `S` 拒绝（*cannot act on multiple sessions*）。`Esc` 先清空选中、再按才退出 |
| `e` | `session-export` | 导出（`/export`）：居中 *Export as* 菜单选 **HTML**（整棵树，由 pi 自己的 `pi --export` 渲染）或 **JSONL**（活动分支，可重新导入），然后 *Export to* 框预填 pi 的默认路径（pi 工作目录下的 `pi-session-<file>.html` / `session-<time>.jsonl`）。相对路径和 `~` 在所有平台通用；目录（已存在，或以 `/` 结尾输入）会在里面用默认文件名。框里 `Esc` 退回菜单；已存在的文件先问 *Overwrite file?*。任意会话都能导出，不只当前会话；面板保持打开，footer 说明文件去向 |
| `I` | `session-import` | 导入（`/import`）：居中框询问一个会话 `.jsonl`（相对 pi 工作目录，允许 `~`），*Import and switch to it?* Yes / No 框确认，随后文件被复制进当前会话目录（重名加 `-1` 后缀）、pi 切换过去、面板关闭。缺失 / 空 / 非 pi 文件会在 footer 报告，不复制任何东西 |
| `S` | `session-share` | 分享（`/share`）：*Upload as secret gist?* Yes / No 框确认（光标停在 No），随后会话渲染为 HTML 并用 `gh gist create --public=false` 上传；pi.dev 查看链接复制到剪贴板并显示在 footer。需要已登录的 GitHub CLI（否则用 pi 的措辞提示）；pi 的 Radius 上传对扩展不可用 |
| `s` | `session-sort` | 循环排序：recent（最后更新）→ created（创建时间）→ title（按显示的标题 —— 有名字用名字，否则用首条消息预览 —— A–Z，空会话排最后）→ threaded（分叉缩进挂在父会话下）→ …；标题显示当前排序，光标跟随其会话 |
| `i` | `session-info` | 会话信息居中框（即 `/session` 展示的：名称、模型、消息数、token、费用、创建 / 更新、路径、id）；`y` 复制全部文本，`Esc` / `q` 关闭 |
| `c` | `session-compact` | 压缩（`/compact`）：居中 *Compact* 框询问可选的聚焦指令（`Enter` 压缩，`Esc` 取消，留空用 pi 默认）。压缩光标会话的活动分支后 pi 打开它 —— 非当前会话会先切过去（这就是「进入对话」）。压缩期间 pi 自己的 footer 显示旋转 spinner；成功后面板关闭，失败（无模型、会话太小、已压缩）停留在 footer。选中多个会话时 `c` 拒绝 |

## TREE 面板

面板把树显示为折叠大纲：`▸` 折叠的旁支，`▾` 展开的旁支，`─` 从未继续的旁支；分支内的行每层缩进两列（最多四层，更深以 `… ` 代替）。旁支默认折叠，活动分支展开。过滤住在树对话框（`a`）里，对话框用 pi 风格的引导线画同样的行，并有自己的实时搜索行来收窄列表。面板里的 `/` 是上文*搜索*的跳转式搜索（label / 正文，`tag:` 匹配 label，`role:` 匹配角色；折叠分支里的匹配会被展开）。在对话框里选的过滤会保留：面板列出同样过滤后的树，标题也标出（`2/12 · user-only`）；面板打开时采用 pi 自己的 `treeFilterMode` 设置（`/tree` 启动时的过滤）。

| 键 | 配置名称 | 操作 |
| --- | --- | --- |
| `j` `k` `↑` `↓` | `move-down` / `move-up` | 移动光标 |
| `gg` / `G` | `go-top` / `go-bottom` | 顶部 / 底部 |
| `Enter` | `tree-restore` | 恢复到节点，和 `/tree` 一样：居中菜单问 *No summary / Summarize / Summarize with custom prompt*（`j`/`k`/`↑`/`↓` 移动，`Enter` 选，`Esc` 退回树）；自定义提示是单行输入（`Enter` 摘要，`Esc` 退回菜单）。需要时先切换到该会话。节点本身就是叶子（`Enter` 直接关闭面板）或 pi 的 `branchSummary.skipPrompt` 开启时不弹菜单 |
| `z` | `tree-fold` | 折叠 / 展开光标所在分支：在 `▸` / `▾` 行上切换，在分支内任意行则折叠该分支并跳到段头（vim 的 `zc`）；线性对话的主干没有可折叠的段 |
| `y` | `tree-copy` | 复制节点文本（完整文本，等同 `/tree` 里的 `Ctrl+x`） |
| `T` | `tree-label` | 在居中对话框里添加 / 编辑 label，类似 lazygit 的 commit 弹窗（`Enter` 保存，`Esc` 取消，空值删除；等同 `/tree` 里的 `Shift+T`） |
| `a` | `tree-open` | 打开树对话框：整棵树的大弹窗（顶部搜索行，底部键位提示），和面板共享折叠状态；键位见下 |

## 树对话框（在 TREE 面板按 `a`）

整棵树的大弹窗：顶部搜索行，中间是行（pi 风格引导线，折叠的行在连接处显示 `⊞`），底部键位提示（footer 也重复它们，所以对话框内没有 `?` 帮助）。对话框有自己的光标；关闭时面板光标移到它上面。按键先用 `tree-dialog` scope，再树面板的键位，最后全局的，所以 `j` `k`、`gg` `G`、`Enter`、`y`、`T`、`z` 和 `/` 是面板的键（并跟随它们的重绑），而对话框自己的键在 `keymap."tree-dialog"` 下。切换面板（`h` `Tab` `1`..`3`）、列表范围（`C` `A`）、`n` `N`、`?`、`@` 和退出面板（`Ctrl+c`）在这里都无效。

下表「配置名称」后括号标出它属于哪个 scope（要改这些键就在对应 scope 下改）：过滤键和关闭键在 `tree-dialog`，移动 / 恢复 / 复制 / 标签 / 折叠沿用 `tree`，搜索沿用 `global`。

| 键 | 配置名称（scope） | 操作 |
| --- | --- | --- |
| `j` `k` `↑` `↓` | `move-down` / `move-up`（tree） | 移动对话框的光标 |
| `gg` / `G` | `go-top` / `go-bottom`（tree） | 顶部 / 底部 |
| `/` | `search`（global） | 聚焦搜索行；输入实时过滤行，和 `/tree` 一样：每个词都要出现在行的 label / 正文里（大小写不敏感），`tag:x` 收窄到 label，`role:user` 到角色，`after:2026-09-01` / `before:2026-09-20` 到日期。`Esc` 把按键交回列表并保留关键字（行保持收窄）；再按 `/` 编辑它，删光文本即清除。搜索行里 `Enter` 无含义。关键字生效时全部匹配都显示（折叠被清除，和 `/tree` 一样）；关键字清空或关闭对话框后折叠恢复 |
| `Enter` | `tree-restore`（tree） | 恢复到该行，和面板完全一样（含摘要菜单） |
| `y` | `tree-copy`（tree） | 复制该行的文本 |
| `T` | `tree-label`（tree） | 添加 / 编辑该行的 label（Label 对话框叠在树对话框上面） |
| `z` | `tree-fold`（tree） | 折叠 / 展开光标所在分支（规则和折叠状态与面板相同） |
| `d` `t` `u` `l` `a` | `tree-filter-default` / `tree-filter-no-tools` / `tree-filter-user` / `tree-filter-labeled` / `tree-filter-all`（tree-dialog） | 过滤：default（隐藏记账信息）/ 无工具结果 / 只看 user / 只看有 label / 全部；`t` `u` `l` `a` 再按一次回到 default（对应 pi 的 `Ctrl+d/t/u/l/a`）。树被重新加载、折叠被清除，面板随后显示同样的过滤 |
| `Esc` / `q` | `tree-dialog-close`（tree-dialog；`Esc` 内置不可配置） | 关闭（在列表上）：面板光标落到对话框的行上（展开挡住它的折叠），CONTENT 跟随。在搜索行里 `Esc` 只离开搜索行，`q` 只是一个字母 |

## CONTENT 面板（只读）

只有滚动和搜索；复制消息在 TREE 面板做（`y`）。

| 键 | 配置名称 | 操作 |
| --- | --- | --- |
| `j` `k` `↑` `↓` | `move-down` / `move-up` | 滚动 |
| `gg` / `G` | `go-top` / `go-bottom` | 顶部 / 底部 |
| `/` | `search`（global） | 搜索渲染后的消息正文（只搜裸词，无限定词）；匹配行被滚到顶部，`n` / `N` 步进命中 |

## 鼠标

核心仍是键盘，鼠标只做轻量适配。regular（默认）和 fullscreen 两种 TUI 模式都支持：fullscreen 由 pi 把事件派给面板，regular 模式插件自己打开 SGR 鼠标上报（需要终端支持 SGR，现代终端基本都行；面板打开期间终端自己的选中 / 滚动被接管，关闭后恢复）。见 `docs/issues.md`。

| 操作 | 行为 |
| --- | --- |
| 滚轮 / 三指上下 | 滚动指针所在面板的视图（列表只滚动、不移动选中项；CONTENT 按行滚动），不改变焦点 |
| 单击 | 焦点切到指针所在面板；点在列表项上时同时把光标移到该项 |
| 双击 SESSIONS | 进入该会话（等价于 `Enter` / resume） |
| 双击 TREE | 折叠 / 展开光标所在分支（等价于 `z`） |



