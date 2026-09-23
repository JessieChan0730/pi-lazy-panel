# CLAUDE.md

## 这个项目是什么

一个类似 lazygit 的 pi(<https://pi.dev/>) 插件，用来管理 pi 的历史对话，主要命令有三个 /resume（恢复会话，从历史会话中选择并恢复）  /tree  （会话树导航，跳转到对话树的任意节点继续对话，某个对话详情里面的某一个界面） /new （新建一个对话），然后还有围绕着对话进行操作的命令：/name（命名会话，为当前会话设置一个易读的名称） /session（会话信息，显示会话文件路径、ID、消息数、token 用量和费用） /fork（分叉会话，从之前的用户消息分叉出一个新会话文件）/clone（克隆会话复制当前活动分支到新会话文件）/copy （复制 AI 最后一条回复到剪贴板）/export（导出会话导出为 HTML 或 JSONL 文件）/import（导入会话从 JSONL 文件导入并恢复会话）
/share（分享会话上传为私有 GitHub Gist，生成可分享的 HTML 链接）， 根据这些命令能够拿到信息，我觉得产品可以设计成为这样：

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
/compact，/settings，/changelog

确定不会用到的指令：
/login，/logout，/model，/thinking，/scoped-models

## 命令

```
npm install            # 必须先执行：pi 相关包是 devDependencies，默认不会安装
npm run check          # tsc --noEmit（strict、noUncheckedIndexedAccess、exactOptionalPropertyTypes）
npm test               # node --import tsx --test "test/**/*.test.ts"
npm run dev            # pi -e ./src/index.ts，临时把插件加载进一个 pi TUI，不写配置
npm run install:pi     # pi install .，把本目录以本地路径注册到 ~/.pi/agent/settings.json（pi 会把 . 解析成绝对路径），只需执行一次
npm run uninstall:pi   # pi remove .，从 pi 中移除
```

- 运行单个测试文件：`node --import tsx --test test/ui.test.ts`
- 按名称过滤：`node --import tsx --test --test-name-pattern="frame" test/ui.test.ts`
- 没有构建步骤：pi 直接加载 `src/index.ts`（见 `package.json` 的 `pi.extensions`）。`install:pi` 注册的是目录路径，改完代码后重启 pi 或在 pi 里输入 `/reload` 即为最新代码。
- 没有 linter，`.editorconfig`（tab 缩进、LF）是格式规范。
- pi 扩展 API 文档在安装后的 `node_modules/@earendil-works/pi-coding-agent/docs/{extensions,tui,session-format}.md`，涉及 pi / pi-tui API 时先查文档，不要猜。

## 项目目录结构

严格分层，上层可以依赖下层，下层禁止依赖上层。

```
src/
├── index.ts                  # 入口：registerCommand("/lazy-history")，用 ctx.ui.custom 打开全屏面板
├── types.ts                  # 共享类型（只放类型，禁止运行时代码）
├── constants.ts              # 常量：扩展 id、命令名、布局比例、面板 id、排序循环顺序（SESSION_SORT_MODES）、键位 scope（KEY_SCOPES = global + 面板 + tree-dialog）
├── ui/                       # 渲染层：pi-tui Component。不做 I/O，不调用 pi 会话 API
│   ├── app.ts                # 根组件 LazyPanel + PanelState；数据通过 DataSource 接口注入；/ 搜索的流程（原位置、实时跳转、n/N、折叠展开）也在这里
│   ├── frame.ts              # 纯函数：画边框（FRAME_DIVIDER 哨兵行画 ├──┤）、左右拼列、按可见宽度补齐/截断、居中叠加弹窗（overlayCentered）、弹窗宽度（dialogWidth）
│   ├── search-highlight.ts   # 纯函数：搜索命中的高亮（highlightLine 在画好的整行上按可见列叠加样式，照 pi 全屏搜索的做法，前后颜色 / 光标背景不断；matchStyle 其他匹配下划线、当前匹配反色；searchMeta 标题的 2/7 matches）
│   ├── tree-lines.ts         # 纯函数：按 parentId 算 pi /tree 风格的树线前缀（treePrefixes，折叠的段头画 ⊞），只给树对话框用
│   ├── tree-outline.ts       # 纯函数：TREE 面板的折叠大纲前缀（treeOutline）：段头画 ▸/▾、没有后代的旁支画 ─，段内每层缩进 2 列、最多 4 层、更深的以 … 代替；三角直接占段头行首两列、不预留空列（lazygit 文件树的画法），线性对话完全不缩进
│   ├── panes/
│   │   ├── sessions-pane.ts  # 左上 SESSIONS 面板（search prop：命中行高亮、标题计数）
│   │   ├── tree-pane.ts      # 左下 TREE 面板：折叠大纲（前缀来自 tree-outline.ts，可见行由 app.ts 用 applyTreeFold 算好）；renderTreeRow（光标 › + 已配色的前缀 + 活动路径 • + [label] + 时间 + role + 正文，可选的搜索高亮）和树对话框共用
│   │   └── content-pane.ts   # 右侧 CONTENT 面板，用 pi-tui 的 Markdown 渲染消息；排版结果带 searchable[]（只有正文行参与 / 搜索），命中只叠加在窗口里的行上
│   └── widgets/
│       ├── footer.ts         # 底部一行：模式 + 当前面板快捷键提示（弹窗打开时显示弹窗的提示）
│       ├── prompt-bar.ts     # 底部一行输入的通用组件（包装 pi-tui Input），搜索栏和树对话框的搜索行基于它
│       ├── search-bar.ts     # 底部搜索输入：显示 `搜索:`；renderSearchStatus 是回车后的状态行（关键字 + 2/7 + n/N/Esc 提示 + 状态文字）
│       ├── input-dialog.ts   # 通用的居中单行输入弹窗（包装 pi-tui Input，3 行高）：标题 / 预填值 / 提示 / 回调在 open 时传入
│       ├── label-dialog.ts   # T 打标签：InputDialog 的预设（标题 + footer 提示）；给 session 起名等场景照此加预设
│       ├── select-dialog.ts  # 通用的居中选择菜单（j/k/方向键移动、Enter 确认、Esc 取消，高度 = 选项数 + 2；spec.shortcuts 让某个键直接选中某一项）：标题 / 选项 / 回调在 open 时传入
│       ├── restore-dialog.ts # TREE Enter 的预设：Summarize branch? 三选菜单的标题 / 选项 / 提示 + 自定义摘要指令输入框的标题 / 提示
│       ├── rename-dialog.ts  # r 给会话改名：InputDialog 的预设（标题 Rename + footer 提示，空值清除名字）
│       ├── tree-dialog.ts    # a 打开的完整树对话框：顶部搜索行（PromptBar，实时搜索，Esc 退出搜索框但关键字保留、Enter 无含义；没焦点时只显示关键字或 `/ to search`）、中间画树线的树（和面板共用折叠状态，折叠的段头画 ⊞）、底部提示（来自 keymap，对话框里不做 ? 帮助），几乎占满终端。只管画、搜索框和自己的光标；行的搜索 / 过滤 / 折叠由 app.ts 算好 setRows，按键也由 app.ts 按 tree-dialog scope 解析后调用它的方法
│       ├── confirm-dialog.ts # 删除 / fork 前的确认框：SelectDialog 的预设（confirmDialogSpec：Yes / No，默认停在 No，y / n 直接选，Enter 确认，Esc 取消）
│       ├── help-overlay.ts   # ? 快捷键帮助：居中弹窗，内容来自最终 keymap
│       └── session-info-dialog.ts  # i 会话信息弹窗：一行一个字段（Name / Model / Messages / Tokens / Cost / Created / Updated / Path / ID），y 把 sessionInfoText 交给面板复制，Esc / q 关闭
├── actions/                  # 副作用层：每个函数包装一个 pi 命令/API，不弹窗，由调用方先确认
│   ├── session-actions.ts    # resume / delete（先 trash 再 unlink，当前会话拒绝）/ rename（当前会话 pi.setSessionName，其他 appendSessionInfo）/ copyText（已完成）；fork / export / import / share / clone …（TODO）
│   └── tree-actions.ts       # restore / label / copy（已完成；restore 把 No summary / Summarize / custom prompt 透传给 navigateTree）
├── data/                     # 数据层：只读适配 pi 的 SessionManager，产出纯数据行，无 UI
│   ├── sessions.ts           # SessionManager.list/listAll -> SessionRow[]；sortSessions
│   ├── tree.ts               # getTree -> TreeRow[]（parentId 指向最近的"也是行"的祖先，含 isLeaf 标记；kind 分 message/tool/system/meta，和 pi /tree 一致）；applyTreeFilter（default 只藏 meta、no-tools 再藏工具结果，删行后重新挂父节点走 tree-fold.ts 的 filterTreeRows）；isEffectiveLeaf
│   ├── tree-fold.ts          # 纯函数：filterTreeRows（删行并把幸存的行挂到最近保留的祖先上，过滤和搜索共用）；折叠（z）：foldableIds（段头 = 父节点有多个子节点且自己有后代；单根不可折叠）、defaultFolded（旁支默认折叠）、applyTreeFold（隐藏折叠段的后代）、foldTarget（z 作用的段头：自己或最近的可折叠祖先）；对话框用的 nearestListedIndex（行被藏掉时光标落到最近还列出来的祖先）、foldedAncestors（关对话框时要展开的段）
│   ├── content.ts            # getBranch -> ContentBlock[]；loadSessionInfo；resolveContentLeaf
│   └── search.ts             # 纯函数：parseSearchQuery 解析 name:/model:/path:/tag:/role:/after:/before: + 自由文本；普通词只搜 名称 / 标题 / label，其他字段都要限定词：matchTreeRow（TREE 面板和树对话框：每个词都要出现在 label + 正文里，tag: 只看 label，role: 只看角色，after:/before: 看时间）；matchSessionRow（SESSIONS：普通词只看 名称 + 首条消息预览，模型 / 路径只通过 model: / path: 匹配，path: 也认 ~/… 写法，after:/before: 看更新时间）；matchesTokens（CONTENT 行）；highlightTerms / findMatchRanges 给高亮用
├── config/
│   ├── keymap.ts             # 默认键位 + 动作描述 + footer 提示顺序（纯数据），含 tree-dialog scope（d/t/u/l/a 过滤、q 关闭）；DISABLED_ACTIONS 列出在某个 scope 里关掉的外层动作（对话框里的切面板 / C A / n N / quit / help / tree-open）；TREE_DIALOG_FOOTER 是对话框提示的顺序
│   ├── keys.ts               # 纯函数：chord 解析（ctrl+d / G / gg）、按键匹配、按 scope 解析 ActionId；scopeChain 定义查找顺序（对话框 → tree → global，面板 → global）
│   ├── config.ts             # 唯一知道 ~/.pi/agent/lazy-panel.json 的模块，深合并用户配置（null 解绑）
│   └── pi-settings.ts        # 唯一读 pi 自己 settings.json 的模块（SettingsManager.create 只读），目前取 branchSummary.skipPrompt 和 treeFilterMode（TREE 的初始过滤）
└── utils/
    └── format.ts             # 纯格式化：时间、token、费用、路径缩写

test/
├── smoke.test.ts             # 键位表、搜索解析的冒烟测试
├── keymap.test.ts            # chord 解析、多键序列、scope 链（tree-dialog → tree → global）、用户配置合并
├── panel.test.ts             # LazyPanel 行为：焦点切换、C/A、? 帮助、/ 搜索（三个面板的实时跳转 / Enter / Esc / n N 回绕 / 标题计数 / 折叠展开 / 高亮 / 切面板保留关键字）、自定义键位、y/T/Enter（含摘要菜单）、树对话框（移动、搜索、过滤、z 折叠、y/T/Enter、关闭后面板光标跟随）、SESSIONS 的 d 确认删除 / r 改名 / s 排序 / i 信息弹窗、InputDialog / SelectDialog
├── tree-actions.test.ts      # 临时会话文件上验证 loadNodeText / labelNode 的分流、loadTree 的 isLeaf 标记
├── session-actions.test.ts   # 临时会话文件上验证 isEffectiveLeaf / resumeSession / restoreNode 的分流与摘要选项透传、deleteSession（当前会话拒绝、trash → unlink 回退）、renameSession 的分流
├── pi-settings.test.ts       # 临时目录上验证 branchSummary.skipPrompt 的全局 / 项目两级读取、treeFilterMode 映射
├── search.test.ts            # parseSearchQuery 的限定词解析、matchTreeRow / matchSessionRow / matchesTokens 的匹配规则、findMatchRanges
└── ui.test.ts                # 格式化、frame 几何、树过滤 / 折叠、TreeDialog 搜索行、highlightLine / searchMeta

docs/keybindings.md           # 默认快捷键表，新增 ActionId 时同步更新
docs/design.md                # 产品设计（原 计划.md）
docs/progress.md              # 任务进度（原 进度.md），每次开工前先看
docs/issues.md                # 已知问题 / 搁置的问题，解决后划掉
AGENTS.md                     # 仅指向本文件，规则统一在这里维护
```

数据流：`sessions.ts` → `SessionRow[]` → SESSIONS 面板；选中行驱动 `tree.ts` → `TreeRow[]` → `tree-fold.ts` 隐藏折叠段（`PanelState.treeFolded`，默认旁支折叠）→ TREE 面板；选中节点（或活动叶子）驱动 `content.ts` → `ContentBlock[]` → CONTENT 面板。所有 UI 状态集中在 `PanelState`（`src/ui/app.ts`）。`/` 搜索是每个面板一份的 `PanelState.search`（关键字 + 匹配行号），列表不过滤只跳转；面板拿到的是 `SearchView`（可见行号的匹配集合、当前匹配、要高亮的词），高亮由 `ui/search-highlight.ts` 在画好的行上叠加。

快捷键是间接绑定：按键 → `resolveKeys`（`src/config/keys.ts`，按 `scopeChain` 的顺序查：面板 scope 再 global，树对话框是 tree-dialog → tree → global，支持 `gg` 这类多键序列） → `ActionId`（`src/types.ts`） → `LazyPanel.dispatch`（对话框里是 `dispatchInTreeDialog`）。默认值在 `src/config/keymap.ts`，`loadConfig` 深合并用户覆盖。新增动作时要同时改：`ActionId`、默认键位、`ACTION_DESCRIPTIONS`、`dispatch` 里的分发、`docs/keybindings.md`。

## 代码风格/合作规范

1. 函数格式尽量统一，顶级函数最好不要使用箭头函数
2. 关键代码部分可以添加中文注释，方便我review代码
3. 用户叫你提交的代码的时候，message 格式请遵循`约定式提交 (Conventional Commits)`, message 要使用英文，例如 `fix(sessions): optimize ui`
4. 完成一个任务后，自动帮我执行 `npm run install:pi` 我会去 pi 中进行验证
5. 本地导入必须显式包含 `.ts` 扩展名（需配合 `allowImportingTsExtensions` 和 `verbatimModuleSyntax` 配置）；仅类型导入（type-only imports）必须使用 `import type` 语法。
6. `@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui` 和 `typebox` 需保留在 `peerDependencies` 中，版本号设为 `*`；严禁将其打包（bundle）或作为本地依赖（vendor）包含在内。
7. 执行破坏性操作（如删除、fork）时，必须先通过 `ui/widgets/confirm-dialog.ts` 进行确认。
8. 对话内容渲染必须使用 `@earendil-works/pi-tui` 提供的 `Markdown` 组件；禁止引入其他 Markdown 库。
9. `/lazy-history` 仅适用于 TUI 模式；请务必在 `src/index.ts` 中保留 `ctx.mode !== "tui"` 的条件判断。
10. 模块之间尽量低耦合
11. 更新 design, progress, keybindings 这些文档，提交消息固定为 `chore(doc): update doc by $progress` 后面 $变量 根据实际修改的文档来定
12. 新增功能一定要考虑跨平台，不要使用某些特定平台的特性，比如路径使用`~/` 这个在 windows下是会报错的。

## 重要文档

不清楚业务和进度，请查看下面两个文档

- ./docs/design.md（设计）
- ./docs/progress.md （开发进度）
- ./docs/issues.md（已知/搁置问题）
