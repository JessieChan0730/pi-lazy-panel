# CLAUDE.md

## 这个项目是什么

一个类似 lazygit 的 pi(<https://pi.dev/>) 插件，用来管理 pi 的历史对话，主要命令有三个 /resume（恢复会话，从历史会话中选择并恢复）  /tree  （会话树导航，跳转到对话树的任意节点继续对话，某个对话详情里面的某一个界面） /new （新建一个对话），然后还有围绕着对话进行操作的命令：/name（命名会话，为当前会话设置一个易读的名称） /session（会话信息，显示会话文件路径、ID、消息数、token 用量和费用） /fork（分叉会话，从之前的用户消息分叉出一个新会话文件）/clone（克隆会话复制当前活动分支到新会话文件）/copy （复制 AI 最后一条回复到剪贴板）/export（导出会话导出为 HTML 或 JSONL 文件）/import（导入会话从 JSONL 文件导入并恢复会话）
/share（分享会话：选择 Auto / GitHub Gist / Radius 上传，Auto 优先 Gist、其次 Radius，生成可分享的链接）， 根据这些命令能够拿到信息，我觉得产品可以设计成为这样：

- 左边第一个面板是显示历史对话, 也就是 /resume 里面的那些数据
- 左边第二个面板（在第一个面板底部）是显示对话节点 也就是 /tree 里面的那些数据（根据上面选择的不同的 /resume 来确自动变化这里面的内容）
- 右边第一个面板是显示对话的详细内容（需要区分是AI的消息，还是我的消息），这个面板占据全部高度
- 搜索，放在底部不需要一个输入框。当用户输入 / 时候，底部出现 搜索：两个字样，随后用户输入内容回车进行搜索（只搜索当前focus面板中的内容），这个完全参考 lazygit 就行

聚焦到得不同的面板，不同的快捷键有不同的含义。

```txt
关系其实是：
    resume1
        - tree1
            - node1
            - node2
```

也就是随着第一个面板，用户选择聚焦不同的resume,下面的第二个面板的tree也要不停变化显示不同的可还原的节点

暂定的指定（后续可能会适配）：
/compact，/settings，~~/changelog~~（已完成：全局快捷键 `@`）

确定不会用到的指令：
/login，/logout，/model，/thinking，/scoped-models

## 命令

```
npm install            # 必须先执行：pi 相关包是 devDependencies，默认不会安装
npm run check          # tsc --noEmit（strict、noUncheckedIndexedAccess、exactOptionalPropertyTypes）
npm test               # node --import tsx --test "test/**/*.test.ts"
npm run dev            # pi -e ./index.ts，临时把插件加载进一个 pi TUI，不写配置
npm run install:pi     # pi install .，把本目录以本地路径注册到 ~/.pi/agent/settings.json（pi 会把 . 解析成绝对路径），只需执行一次
npm run uninstall:pi   # pi remove .，从 pi 中移除
npm run i18n:scan      # 扫描 src 里的 t("…") key，和 src/i18n/locales/{en,zh}.json 对齐（缺失的以空串补进去、按字母排序），报告缺失 / 需翻译 / 复数 key 缺变体 / 孤儿；空串只算待翻译
npm run i18n:check     # 同上但只读不写，有不一致（含空占位）时退出码非 0（CI 用）
npm run lint           # ESLint（eslint.config.js）：@stylistic 预设（tab 缩进等）、命名规范、未使用变量 / import、顶级函数不用箭头函数、本地导入带 .ts、src 里不许写死非英文文案
npm run lint:fix       # 自动修复能修的（缩进、引号、未使用的 import……）
npm run ci             # CI 入口（.github/workflows/ci.yml 调用）：跑和 pre-push 同一套六项检查；PR_BASE_SHA / PR_HEAD_SHA 在时按 base..head 算提交消息和改动文件
```

- git hooks（husky，`npm install` 时由 `prepare` 自动安装）：commit 时 `.husky/commit-msg` 用 commitlint 检查约定式提交；push 前 `.husky/pre-push` → `scripts/pre-push.mjs` 并行跑 提交消息 / eslint / i18n 写死文案（只查本次推送改动的代码文件）/ i18n:check / tsc / 全部测试，任何一项失败就拒绝 push（紧急时 `git push --no-verify`）。

- 运行单个测试文件：`node --import tsx --test test/ui/ui.test.ts`
- 按名称过滤：`node --import tsx --test --test-name-pattern="frame" test/ui/ui.test.ts`
- 没有构建步骤：pi 直接加载包根 `index.ts`（见 `package.json` 的 `pi.extensions`），入口再调用 `src/index.ts`。`install:pi` 注册的是目录路径，改完代码后重启 pi 或在 pi 里输入 `/reload` 即为最新代码。
- 格式规范是 `.editorconfig`（tab 缩进、LF）+ `eslint.config.js`，提交前跑 `npm run lint`。
- pi 扩展 API 文档在安装后的 `node_modules/@earendil-works/pi-coding-agent/docs/{extensions,tui,session-format}.md`，涉及 pi / pi-tui API 时先查文档，不要猜。

## 项目目录结构

严格分层，上层可以依赖下层，下层禁止依赖上层。

```
src/
├── index.ts                  # 入口：registerCommand("/lazy-panel")（命令本体在 openPanel）用 ctx.ui.custom 打开全屏面板；同时 registerShortcut 注册 pi 全局快捷键（默认 alt+l，走 sendUserMessage 重新进入命令）
├── types.ts                  # 共享类型（只放类型，禁止运行时代码）
├── constants.ts              # 常量：扩展 id、命令名、pi 级快捷键默认值（DEFAULT_OPEN_SHORTCUT = alt+l）、布局比例、面板 id、排序循环顺序（SESSION_SORT_MODES）、键位 scope（KEY_SCOPES = global + 面板 + tree-dialog）
├── ui/                       # 渲染层：pi-tui Component。不做 I/O，不调用 pi 会话 API
│   ├── app.ts                # 根组件 LazyPanel，只做协调：加载光标下的会话、TREE 光标驱动 CONTENT 高亮、/ 搜索的编排（原位置、实时跳转、n/N、折叠展开）、树对话框、鼠标、render。overlays 一张表决定按键归谁 / footer 提示 / 鼠标屏蔽 / 叠加顺序（新增弹窗只加一项）；dispatch 对 ActionId 做了穷尽检查（新增动作漏了分发 tsc 会报错）
│   ├── state.ts              # PanelState + createInitialState：全部可变 UI 状态（焦点、光标、搜索、多选、置顶、折叠……）
│   ├── ports.ts              # DataSource / ActionSource：面板对外的两个注入端口（只读数据、副作用），入口接真实实现、测试传内存桩
│   ├── content-viewport.ts   # ContentViewport：CONTENT 的消息块、排版缓存、滚动（含 zz 越界居中，下一次普通滚动收回）、高亮、正文行的 / 匹配缓存；滚动位置和高亮仍放在 PanelState
│   ├── tree-view.ts          # TreeView：TREE 的整棵树 / 折叠后的可见行 / 大纲前缀，以及 reveal（展开藏住某行的段）、keepCursorOn、z 折叠、树对话框搜索期间暂停折叠；折叠集合和光标仍放在 PanelState
│   ├── key-sequencer.ts      # KeySequencer：多键序列（gg）的前缀缓冲 + 超时，面板和树对话框共用
│   ├── frame.ts              # 纯函数：画边框（FRAME_DIVIDER 哨兵行画 ├──┤）、左右拼列、按可见宽度补齐/截断、居中叠加弹窗（overlayCentered）、弹窗宽度（dialogWidth）
│   ├── mouse.ts              # 纯函数：verticalSplit / panelGeometry（面板列/行切分）、listVisibleRows（每个列表可见行数）、hitTest（单元格 (x,y) → 面板 + 列表行号，吃 render 用的首行偏移，SESSIONS 每行 2 行、TREE 每行 1 行）。render 和鼠标共用，保证画的位置=点的位置
│   ├── mouse-input.ts        # 纯函数：regular 模式下 pi 不开鼠标，插件自己开 SGR 上报（ENABLE/DISABLE_MOUSE）；parseSgrMouseChunk 解析原始序列（批量拆条），MouseTracker 把按下/释放/滚轮变成 TuiMouseEvent（同格点击、双击计数、只认左键），index.ts 用它把鼠标喂给 handleMouse
│   ├── search-highlight.ts   # 纯函数：搜索命中的高亮（highlightLine 在画好的整行上按可见列叠加样式，照 pi 全屏搜索的做法，前后颜色 / 光标背景不断；matchStyle 其他匹配下划线、当前匹配反色；searchMeta 标题的 2/7 matches）
│   ├── cursor-tone.ts        # 纯函数：光标行的次级色调（cursorTone 把 dim→muted、muted→text）。光标行整行刷 selectedBg，而主题的 selectedBg 只比它假设的底色亮一档，压在它上面的 dim/muted 会糊掉；面板和树对话框都用它
│   ├── tree-lines.ts         # 纯函数：按 parentId 算 pi /tree 风格的树线前缀（treePrefixes，折叠的段头画 ⊞），只给树对话框用
│   ├── tree-outline.ts       # 纯函数：TREE 面板的折叠大纲前缀（treeOutline）：段头画 ▸/▾、没有后代的旁支画 ─，段内每层缩进 2 列、最多 4 层、更深的以 … 代替；三角直接占段头行首两列、不预留空列（lazygit 文件树的画法），线性对话完全不缩进
│   ├── flows/                # 弹窗流程：每个命令从按键到 action 的整条路径（检查 → 弹输入框 / 菜单 → 调 action → footer 报结果）。顶级函数、第一个参数是 FlowHost；流程的目标由弹窗回调的闭包带着，不存任何状态
│   │   ├── host.ts           # FlowHost：flows 对面板的全部依赖（LazyPanel 用私有对象实现）；flows 不 import app.ts，测试用假 host
│   │   ├── session-flows.ts  # SESSIONS：Enter / d（单个、批量，拒删当前会话）/ p / r / n / c / o / y / Y / e / I / S / i
│   │   └── tree-flows.ts     # TREE 和树对话框：y 复制、T 打标签、Enter 恢复（Summarize branch? 菜单 + 自定义摘要指令）
│   ├── panes/
│   │   ├── sessions-pane.ts  # 左上 SESSIONS 面板（search prop：命中行高亮、标题计数）
│   │   ├── tree-pane.ts      # 左下 TREE 面板：折叠大纲（前缀来自 tree-outline.ts，可见行由 tree-view.ts 用 applyTreeFold 算好）；renderTreeRow（光标 › + 已配色的前缀 + 活动路径 • + [label] + 时间 + role + 正文，可选的搜索高亮）和树对话框共用
│   │   └── content-pane.ts   # 右侧 CONTENT 面板，用 pi-tui 的 Markdown 渲染消息；排版结果带 searchable[]（只有正文行参与 / 搜索），命中只叠加在窗口里的行上
│   └── widgets/
│       ├── footer.ts         # 底部一行：模式 + 当前面板快捷键提示（弹窗打开时显示弹窗的提示）
│       ├── prompt-bar.ts     # 底部一行输入的通用组件（包装 pi-tui Input），搜索栏和树对话框的搜索行基于它
│       ├── search-bar.ts     # 底部搜索输入：显示 `搜索:`；renderSearchStatus 是回车后的状态行（关键字 + 2/7 + n/N/Esc 提示 + 状态文字）
│       ├── input-dialog.ts   # 通用的居中单行输入弹窗（包装 pi-tui Input，3 行高）：标题 / 预填值 / 提示 / 回调在 open 时传入
│       ├── label-dialog.ts   # T 打标签：InputDialog 的预设（标题 + footer 提示）；给 session 起名等场景照此加预设
│       ├── dialog-subject.ts # 弹窗标题栏右上角的“作用对象”：nodeSubject（树节点 角色 · 时间，打标签 / Enter 恢复共用）和 sessionSubject（会话 名字或模型 · 更新日期，永不用会被截断的首条消息预览）
│       ├── select-dialog.ts  # 通用的居中选择菜单（j/k/方向键移动、Enter 确认、Esc 取消，高度 = 选项数 + 2；spec.shortcuts 让某个键直接选中某一项）：标题 / 选项 / 回调在 open 时传入
│       ├── restore-dialog.ts # TREE Enter 的预设：Summarize branch? 三选菜单的标题 / 选项 / 提示 + 自定义摘要指令输入框的标题 / 提示
│       ├── fork-dialog.ts    # o 分叉：选择器（user 消息列表，可滚动）的标题 / 提示；确认框右上角只显示 #序号/总数
│       ├── rename-dialog.ts  # r 给会话改名：InputDialog 的预设（标题 Rename + footer 提示，空值清除名字）
│       ├── tree-dialog.ts    # a 打开的完整树对话框：顶部搜索行（PromptBar，实时搜索，Esc 退出搜索框但关键字保留、Enter 无含义；没焦点时只显示关键字或 `/ to search`）、中间画树线的树（和面板共用折叠状态，折叠的段头画 ⊞），几乎占满终端；快捷键只在面板底部 footer 显示（对话框里不做 ? 帮助）。只管画、搜索框和自己的光标；行的搜索 / 过滤 / 折叠由 app.ts 算好 setRows，按键也由 app.ts 按 tree-dialog scope 解析后调用它的方法
│       ├── confirm-dialog.ts # 删除 / fork / clone / 导入 / 覆盖导出文件前的确认框：SelectDialog 的预设（confirmDialogSpec：Yes / No，默认停在 No，y / n 直接选，Enter 确认，Esc 取消）
│       ├── share-dialog.ts   # S 分享：目的地菜单（Auto / GitHub Gist / Radius）的标题 / 选项 / 提示；Auto 是 Gist 优先，初始光标来自 pi 的 sessionShareDestination
│       ├── radius-account-dialog.ts # S → Radius 已登录时的账号菜单（分享到 Radius / 退出登录）的标题 / 选项 / 提示
│       ├── radius-login-dialog.ts # S → Radius 未登录时接管 `/login radius`：账号 / API Key 菜单，以及 pi 浏览器 / 设备码选择菜单的标题 / 选项（i18n 后的文案）
│       ├── notice-dialog.ts  # 通用只读提示框（URL 自动换行、y 复制、Esc / q 关闭）：Radius 登录的设备码 / 信息提示用它（浏览器登录不弹框，链接直接进剪贴板）
│       ├── export-dialog.ts  # e 导出：格式菜单（HTML / JSONL）+ 输出路径输入框的标题 / 选项 / 提示
│       ├── import-dialog.ts  # I 导入：InputDialog 的预设（标题 / 说明 / 提示，输入 JSONL 路径）
│       ├── help-overlay.ts   # ? 快捷键帮助：居中弹窗，内容来自最终 keymap
│       ├── changelog-dialog.ts     # @ 查看 pi 的 changelog：几乎占满终端的弹窗，pi-tui Markdown 按宽度缓存，j/k/方向键/ctrl+d/u/g/G 滚动，Esc / q 关闭（再按 @ 由 app.ts 关闭）
│       └── session-info-dialog.ts  # i 会话信息弹窗：一行一个字段（Name / Model / Messages / Tokens / Cost / Created / Updated / Path / ID），y 把 sessionInfoText 交给面板复制，Esc / q 关闭
├── actions/                  # 副作用层：每个函数包装一个 pi 命令/API，不弹窗，由调用方先确认
│   ├── session-actions.ts    # resume / delete（先 trash 再 unlink，当前会话拒绝）/ rename / new / fork / clone / copy-reply / copyText；export（HTML 调正在运行的 pi 的 `pi --export`，JSONL 照搬 pi 的活动分支导出）/ import（复制进会话目录再 switchSession）/ share（目的地由 S 菜单传入：Auto 优先 Gist、其次 Radius；Radius 走 `/v1/artifacts`，Gist 走 `gh gist create --public=false`）/ radiusAuthenticated（分享前查 Radius 凭据）。外部命令用 CommandSpec 注入，测试传 node 假脚本
│   ├── radius-auth.ts        # Radius 登录 / 退出：用同一个 auth.json 新建 ModelRuntime，走 pi-ai 的 `/login radius` OAuth / API key 流程，`logout` 删除本地凭据；另含 openExternalUrl。扩展没有 /login API，凭据落盘后运行中的 modelRegistry 按文件版本自动读到
│   └── tree-actions.ts       # restore / label / copy（已完成；restore 把 No summary / Summarize / custom prompt 透传给 navigateTree）
├── data/                     # 数据层：只读适配 pi 的 SessionManager，产出纯数据行，无 UI
│   ├── sessions.ts           # SessionManager.list/listAll -> SessionRow[]；sortSessions
│   ├── tree.ts               # getTree -> TreeRow[]（parentId 指向最近的"也是行"的祖先，含 isLeaf 标记；kind 分 message/tool/system/meta，和 pi /tree 一致）；applyTreeFilter（default 只藏 meta、no-tools 再藏工具结果，删行后重新挂父节点走 tree-fold.ts 的 filterTreeRows）；isEffectiveLeaf
│   ├── tree-fold.ts          # 纯函数：filterTreeRows（删行并把幸存的行挂到最近保留的祖先上，过滤和搜索共用）；折叠（z）：foldableIds（段头 = 父节点有多个子节点且自己有后代；单根不可折叠）、defaultFolded（旁支默认折叠）、applyTreeFold（隐藏折叠段的后代）、foldTarget（z 作用的段头：自己或最近的可折叠祖先）；对话框用的 nearestListedIndex（行被藏掉时光标落到最近还列出来的祖先）、foldedAncestors（关对话框时要展开的段）
│   ├── content.ts            # getBranch -> ContentBlock[]；loadSessionInfo；resolveContentLeaf
│   ├── changelog.ts          # 读正在运行的 pi 安装目录（getPackageDir）的 CHANGELOG.md，照搬 pi 的 parseChangelog 按 ## [x.y.z] 切分；保持文件顺序（最新在上）
│   └── search.ts             # 纯函数：parseSearchQuery 解析 name:/model:/path:/tag:/role:/after:/before: + 自由文本；普通词只搜 名称 / 标题 / label，其他字段都要限定词：matchTreeRow（TREE 面板和树对话框：每个词都要出现在 label + 正文里，tag: 只看 label，role: 只看角色，after:/before: 看时间）；matchSessionRow（SESSIONS：普通词只看 名称 + 首条消息预览，模型 / 路径只通过 model: / path: 匹配，path: 也认 ~/… 写法，after:/before: 看更新时间）；matchesTokens（CONTENT 行）；highlightTerms / findMatchRanges 给高亮用；firstMatchFrom / stepMatch / cycleMatch：实时搜索、n / N 跳到哪个匹配（回绕）
├── config/
│   ├── keymap.ts             # 默认键位 + 动作描述 + footer 提示顺序（纯数据），含 tree-dialog scope（d/t/u/l/a 过滤、q 关闭）；DISABLED_ACTIONS 列出在某个 scope 里关掉的外层动作（对话框里的切面板 / C A / n N / quit / help / tree-open / changelog）；TREE_DIALOG_FOOTER 是对话框提示的顺序
│   ├── keys.ts               # 纯函数：chord 解析（ctrl+d / G / gg）、按键匹配、按 scope 解析 ActionId；scopeChain 定义查找顺序（对话框 → tree → global，面板 → global）；normalizeOpenShortcut 校验 pi 级快捷键（单键、带修饰键或 F 键）
│   ├── config.ts             # 唯一知道 ~/.pi/agent/lazy-panel.json 的模块，深合并用户配置（null 解绑）；openShortcut 是 pi 级打开面板的快捷键（校验 + 规范化），loadConfigSync 供扩展加载时同步注册
│   └── pi-settings.ts        # 唯一读 pi 自己 settings.json 的模块（SettingsManager.create 只读），目前取 branchSummary.skipPrompt、treeFilterMode（TREE 的初始过滤）和 sessionShareDestination（S 目的地菜单的初始光标）
├── i18n/                     # 国际化：唯一知道 i18next 的层
│   ├── index.ts              # initI18n(lng?)（同步、按系统语言、fallback en、returnEmptyString:false 让空占位回退英文）、detectLocale / normalizeLocale、导出 t()。约定：不在模块顶层用 t() 算 const，文案一律写成函数、渲染时才 t()
│   └── locales/
│       ├── en.json           # 基准语言（source of truth）
│       └── zh.json           # 中文
└── utils/
    ├── format.ts             # 纯格式化：时间、token、费用、路径缩写
    ├── indices.ts            # 纯函数：clamp、findLastIndex、indicesWhere（光标 / 滚动夹取、按条件取下标）
    └── paths.ts              # 用户输入的路径：去引号、~ 用 os.homedir() 展开（Windows 也能用）、相对路径按 cwd 解析

scripts/
├── i18n-scan.mjs             # 扫描 t("…") key 并和 locales 对齐（i18n:scan 写 / i18n:check 只读）：缺失、空占位、复数 key 缺变体、孤儿
├── i18n-usage.mjs            # i18n-scan 的纯函数：从源码文本提取静态 / 动态 key、判断 key 是否被用到 / 已翻译（空串算未翻译）、按 CLDR 类别找复数 key（+ i18n-usage.d.mts 类型声明，供测试 type-only import）
├── eslint-plugin-i18n.mjs    # 本地 ESLint 规则 i18n/no-hardcoded-text：src 里的字符串出现非拉丁字母 / 全角标点就报错（注释、console 日志、类型、键名、import 路径不算）
├── install-hooks.mjs         # npm prepare：装 husky hooks；没有 husky（pi 用 --omit=dev 安装 git 来源插件时）静默跳过
├── checks.mjs                # 共享的六项检查实现（commit messages / eslint / i18n text / i18n keys / typecheck / tests）；导出 git / changedCodeFiles / runChecks，pre-push 和 CI 复用，保证两边规则一致
├── pre-push.mjs              # pre-push 钩子：从 git stdin 算本次推送新增的提交 + 改动文件，调 checks.mjs 的 runChecks，失败退出码 1
└── ci-check.mjs              # CI 入口（npm run ci）：从 PR_BASE_SHA / PR_HEAD_SHA 算 base..head 的提交 + 改动文件，调同一个 runChecks

eslint.config.js              # ESLint flat config
commitlint.config.js          # 约定式提交（@commitlint/config-conventional）
.husky/                       # pre-push、commit-msg 两个钩子（_/ 是 husky 生成的，已被忽略）
.github/workflows/ci.yml      # GitHub Actions：PR（→ main）/ push（main）时装依赖后 npm run ci，跑和 pre-push 同一套检查

test/                        # 目录是 src 分层的镜像：一个模块的测试就放到对应层，别再平铺在 test 根下
├── smoke.test.ts             # 键位表、搜索解析的冒烟测试（跨层，留在根）
├── app/                      # LazyPanel 端到端（同一个操作要从按键一路验到渲染）+ 扩展入口
│   ├── panel.test.ts         # LazyPanel 行为：焦点切换、C/A、? 帮助、/ 搜索（三个面板的实时跳转 / Enter / Esc / n N 回绕 / 标题计数 / 折叠展开 / 高亮 / 切面板保留关键字）、自定义键位、y/T/Enter（含摘要菜单）、树对话框（移动、搜索、过滤、z 折叠、y/T/Enter、关闭后面板光标跟随）、SESSIONS 的 space 多选 / 批量删除 / d 确认删除 / r 改名 / s 排序 / i 信息弹窗 / n o y Y / e I S、@ changelog 弹窗、InputDialog / SelectDialog；拆分 app.ts 时补的行为锁定：输入法光标（CURSOR_MARKER）跟着各输入框走、多键超时、弹窗打开时屏蔽鼠标、各流程的失败分支、绑错 scope / 写错名字的动作只在 footer 提示
│   ├── archive-panel.test.ts # X 归档框：跨目录扫描 / 项目筛选 / 实时搜索 / s 排序、Enter 恢复与 R 批量恢复（并保留弹窗）、d 拒绝当前会话、确认删除（文件 + 元数据）、加载失败、自定义多键
│   ├── tree-filter.test.ts   # f 过滤菜单：五种模式 / 直选键 / 取消保留 / 面板与树对话框双向共享 / 清折叠 / 空结果恢复 / 失败回滚可重试 / 可配置与帮助 footer
│   ├── label-time.test.ts    # T / L 与标签时间：可选的独立时间、宽度安全、选中背景与搜索高亮不断、跨树视图共享、清空同时移除、重新绑定 / 解绑 / 帮助执行
│   ├── index.test.ts         # 扩展入口：带 settings 参数直开设置且不写配置、General 字段即时写入 / 语言即时生效 / scope·sort 下次打开生效、非 TUI 守卫
│   └── open-shortcut.test.ts # pi 级快捷键：loadConfigSync（默认 / 自定义 / null / 坏 JSON）和 registerOpenShortcut（注册键位、description、重新发 /lazy-panel、null 不注册）
├── actions/                  # 副作用层：临时会话文件 + 假外部命令
│   ├── session-actions.test.ts # 临时会话文件上验证 isEffectiveLeaf / resumeSession / restoreNode 的分流与摘要选项透传、deleteSession（当前会话拒绝、trash → unlink 回退）、renameSession 的分流、new / fork / clone、export（默认路径 / JSONL 链 / 假 pi）/ import（复制 / 重名 / 清理副本）/ share（假 gh、假 Radius fetch、auto 的 Gist 优先与 Radius 回退、radius 不回落、pi.share entry）/ radiusAuthenticated / loginRadius、utils/paths
│   └── tree-actions.test.ts  # 临时会话文件上验证 loadNodeText / labelNode 的分流、loadTree 的 isLeaf 标记、标签时间戳
├── config/                   # 键位与配置文件
│   ├── keymap.test.ts        # chord 解析、多键序列、scope 链（tree-dialog → tree → global）、用户配置合并、KeySequencer（前缀缓冲 / 超时）
│   ├── config-store.test.ts  # 配置快照 / 保存：保留无关字段、缩进 / 行尾 / 单行 / 缺尾换行、no-op 不改字节、缺文件不创建、跨进程锁
│   ├── pi-settings.test.ts   # 临时目录上验证 branchSummary.skipPrompt 的全局 / 项目两级读取、treeFilterMode 映射、sessionShareDestination 的合并与非法值回落
│   ├── archive.test.ts       # 会话文件状态（pin / archive）：缺失不写、新旧格式迁移、损坏文件保留、原子 rename、Windows 大小写键
│   └── pins.test.ts          # loadPins / savePins：缺文件与坏 JSON、裸数组兼容、去重与 { pinned } 形状
├── data/                     # 只读适配与纯函数
│   ├── sessions.test.ts      # findSessionIndex 的路径比较、listArchivedSessions 跨目录、sortSessions 的四种模式 / 置顶 / 分叉线程
│   ├── search.test.ts        # parseSearchQuery 的限定词解析、matchTreeRow / matchSessionRow / matchesTokens 的匹配规则、findMatchRanges、firstMatchFrom / stepMatch / cycleMatch
│   ├── changelog.test.ts     # parseChangelog 的切分 / 跳过无版本段、文件缺失
│   └── context-usage.test.ts # loadContextUsage 的两个层级（当前会话逐项 / 其他会话折叠成 Other）、无窗口信息、文件不可读、capParts / usageSegments
├── i18n/                     # 国际化与元检查
│   ├── i18n.test.ts          # 语言检测 / 初始化 / 插值 / 复数 / 缺失回退（initI18n / detectLocale / normalizeLocale / t）
│   ├── i18n-scan.test.ts     # scripts/i18n-usage.mjs：静态 / 动态 key 提取、前缀只覆盖自身子树、复数变体、isKeyPresent
│   └── lint.test.ts          # i18n/no-hardcoded-text 规则：报 / 不报的场景、只作用于 src
└── ui/                       # 渲染层
    ├── ui.test.ts            # 格式化、frame 几何、树过滤 / 折叠、TreeDialog 搜索行、highlightLine / searchMeta、ContentViewport（滚动夹取 / zz 越界 / 行匹配缓存）、TreeView（reveal / keepCursorOn / z / 搜索期间暂停折叠）、mouse 命中映射、dialog subject
    ├── key-log.test.ts       # attachKeyLog：没开 LAZY_PANEL_KEY_LOG 时什么都不做、开了逐 chunk 追加且照常把按键交回面板
    ├── mouse-input.test.ts   # parseSgrMouse / parseSgrMouseChunk / MouseTracker：按下释放、只认左键、同格点击、双击计数、滚轮批量拆条
    ├── overlay-lifecycle.test.ts # mountPanelOverlay：regular 首次挂载重绘一次、恢复可见才重绘、fullscreen 不额外重绘
    ├── pane-highlight.test.ts # 三个面板 + 树对话框的行样式：光标色、命中高亮、帮助行不进候选
    ├── flows/                # 假 FlowHost 驱动 ui/flows（不 import app.ts）
    │   ├── flows.test.ts     # 导出 格式 → 路径 → 覆盖确认（每一步 Esc / No 退回上一步）、fork 选择器 ↔ 确认、恢复菜单 ↔ 自定义指令、批量删除跳过当前会话、Radius 未登录的登录菜单（i18n）/ 浏览器链接复制与无弹窗等待 / API Key / 设备码 / 取消后继续分享、面板关掉后不再写 footer、过滤菜单
    │   └── settings-flows.test.ts # 设置流程：General 选择即写 / 取消与撤销不写、回到隐式默认清掉覆盖、成功提示带值、scope 菜单、恢复默认只删已有覆盖、脏退出二次确认
    └── widgets/              # 弹窗组件级测试（构造组件、喂按键、看渲染）
        ├── modal.test.ts     # 弹窗外观与叠加：背景降级、嵌套不叠加样式、窄边距裁剪、统一边框与 footer 优先级
        ├── dialog-header.test.ts # 标题栏几何：Esc / 提示 / 主体在长标题下仍可见、窄宽度退让
        ├── help.test.ts      # ? 帮助：固定高度与小终端收缩、边框提示、条目保留 ActionId / alias / 绑定、跨语言换行
        ├── context-dialog.test.ts # u 上下文与 prompt 详情：分类导航夹取、Enter 与统计行、prompt 预览滚动 / 复制、footer 提示不重复、鼠标点选
        └── settings-dialog.test.ts # 设置页渲染：值列对齐、分类详情框、本地只读提示、footer 只留导航键

docs/keybindings.md           # 默认快捷键表，新增 ActionId 时同步更新
docs/design.md                # 产品设计（原 计划.md）
docs/progress.md              # 任务进度（原 进度.md），每次开工前先看
AGENTS.md                     # 仅指向本文件，规则统一在这里维护
```

数据流：`sessions.ts` → `SessionRow[]` → SESSIONS 面板；选中行驱动 `tree.ts` → `TreeRow[]` → `tree-fold.ts` 隐藏折叠段（`PanelState.treeFolded`，默认旁支折叠）→ TREE 面板；选中节点（或活动叶子）驱动 `content.ts` → `ContentBlock[]` → CONTENT 面板。所有 UI 状态集中在 `PanelState`（`src/ui/state.ts`），TREE / CONTENT 由此派生的视图（可见行、排版、滚动规则）在 `ui/tree-view.ts` / `ui/content-viewport.ts`。`/` 搜索是每个面板一份的 `PanelState.search`（关键字 + 匹配行号），列表不过滤只跳转；面板拿到的是 `SearchView`（可见行号的匹配集合、当前匹配、要高亮的词），高亮由 `ui/search-highlight.ts` 在画好的行上叠加。

快捷键是间接绑定：按键 → `resolveKeys`（`src/config/keys.ts`，按 `scopeChain` 的顺序查：面板 scope 再 global，树对话框是 tree-dialog → tree → global，支持 `gg` 这类多键序列） → `ActionId`（`src/types.ts`） → `LazyPanel.dispatch`（对话框里是 `dispatchInTreeDialog`）。默认值在 `src/config/keymap.ts`，`loadConfig` 深合并用户覆盖。新增动作时要同时改：`ActionId`、默认键位、`ACTION_DESCRIPTIONS`、`dispatch` 里的分发（漏了 tsc 会报错）、`docs/keybindings.md`。要弹窗或调 action 的命令，流程写成 `ui/flows/` 里的顶级函数（第一个参数是 `FlowHost`），`dispatch` 里只调用它；需要面板的新能力就加到 `FlowHost` 上。

面板之外还有一个 pi 级快捷键（默认 `alt+l`，配置 `openShortcut`）：`src/index.ts` 在扩展工厂里同步注册。包根 `index.ts` 传入自己的实际入口路径，直接加载 `src/index.ts` 时用它自己的路径；处理器在每次按键时通过 `pi.getCommands()` 按 `sourceInfo.path` 匹配当前实例，调用真实的 `/lazy-panel` 或 `/lazy-panel:N`（`expandPromptTemplates: true`）。路径会规范化符号链接；没有唯一匹配时只显示国际化警告，不发送命令。扩展快捷键自带的 ctx 没有 newSession / switchSession / navigateTree / fork，不能直接开面板。多份扩展共用一个键时仍由 pi 决定后加载者生效，开发测试建议禁用或卸载 npm 版。改键要 pi `/reload` 才生效；设置页「快捷键」分类里也能改（`settings-flows.ts` 的 openOpenShortcutEditor：修改 / 关闭 / 恢复默认，补丁形状是 `OpenShortcutPatch`，因为 `null` 是「关闭」这个真实取值而不是删除）。

## 代码风格/合作规范

1. 函数格式尽量统一，顶级函数最好不要使用箭头函数
2. 关键代码部分可以添加中文注释，方便我review代码
3. 用户叫你提交的代码的时候，message 格式请遵循`约定式提交 (Conventional Commits)`, message 要使用英文，例如 `fix(sessions): optimize ui`
4. 完成一个任务后，自动帮我执行 `npm run install:pi` 我会去 pi 中进行验证
5. 本地导入必须显式包含 `.ts` 扩展名（需配合 `allowImportingTsExtensions` 和 `verbatimModuleSyntax` 配置）；仅类型导入（type-only imports）必须使用 `import type` 语法。
6. `@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui` 和 `typebox` 需保留在 `peerDependencies` 中，版本号设为 `*`；严禁将其打包（bundle）或作为本地依赖（vendor）包含在内。
7. 执行破坏性操作（如删除、fork）时，必须先通过 `ui/widgets/confirm-dialog.ts` 进行确认；外发的分享用 `ui/widgets/share-dialog.ts` 的目的地菜单确认（Esc 不上传）。显式选 Radius 但没登录时，先走面板里的 `/login radius`（账号 / API Key，浏览器登录把链接复制到剪贴板、Esc 取消，设备码用 `notice-dialog.ts`），登录成功才继续上传。
8. 对话内容渲染必须使用 `@earendil-works/pi-tui` 提供的 `Markdown` 组件；禁止引入其他 Markdown 库。
9. `/lazy-panel` 仅适用于 TUI 模式；请务必在 `src/index.ts` 中保留 `ctx.mode !== "tui"` 的条件判断。
10. 模块之间尽量低耦合
11. 更新 design, progress, keybindings 这些文档，提交消息固定为 `chore(doc): update doc by $progress` 后面 $变量 根据实际修改的文档来定
12. 新增功能一定要考虑跨平台，不要使用某些特定平台的特性，比如路径使用`~/` 这个在 windows下是会报错的。
13. 所有 UI 文案走 `src/i18n` 的 `t()`，中英两份 `src/i18n/locales/{en,zh}.json` 同步维护（英文是基准）；**不要在模块顶层用 `t()` 计算 `export const`**（import 期求值会早于 `initI18n`），需要文案的地方写成函数、渲染时才调用。改完跑 `npm run i18n:check` 确认对齐（空串算未翻译、en 复数 key 必须凑齐 `_one`/`_other`）。i18next 放 `dependencies`（第 6 条只约束那三个 pi 包，不影响新增普通依赖）。
14. 完成任务前跑 `npm run lint`、`npm run check`、`npm test`、`npm run i18n:check` 确认全过——push 时 pre-push 钩子会检查同样的内容，不过就推不上去；不要用 `--no-verify` 绕过。
15. 发版只在 `main` 上打 tag：先把改动经 PR 合并进 `main`，切到 `main`（`git pull` 到最新）再打 `vX.Y.Z` 并推送。推 `v*.*.*` tag 会触发 `.github/workflows/release.yml` 自动 `npm publish` + 建 GitHub Release，所以严禁在功能分支上打 release tag；`scripts/pre-push.mjs` 会拦截指向非 main 提交的 release tag 推送。

## 重要文档

不清楚业务和进度，请查看下面两个文档

- ./docs/design.md（设计）
- ./docs/progress.md （开发进度）
