## 已知问题

搁置中的问题，解决后用 `~~` 划掉并写明处理方式。

### 窄终端下 SESSIONS 标题右侧 meta 显示不全（2026-09-21）

- 现象：非全屏（如在 herdr 里）使用时，Current 模式只显示 `1/16 · Current`，看不到排序 `· recent`；All 模式因为标签短，能完整显示 `1/16 · All · recent`。
- 原因：左栏按 `LEFT_COLUMN_RATIO`（0.25）分配，160 列终端左栏只有 40 列，`[1] SESSIONS` 标题占掉 20 列后 meta 只剩 20 列，`1/16 · Current · recent` 需要 23 列，于是按 `sessionsMeta` 的降级链缩短。全屏使用没有问题。
- 备选方案（暂不处理）：scope 标签统一缩成 `Cur`；排序标签缩成 `rec` / `thr`；或把左栏比例调到 0.3。
