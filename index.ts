/**
 * 包根入口 shim —— pi 加载扩展时用它当入口。
 *
 * pi 用「扩展文件相对包根的路径」生成展示名：名为 index 且位于包根（目录为空）时
 * 只显示包名 `pi-lazy-panel`；若直接指向 `src/index.ts`，目录段 `src` 会被拼成后缀，
 * 展示成 `pi-lazy-panel:src`。真正的实现仍在 ./src/index.ts，这里只把默认导出透出去，
 * 保持 src 分层结构不变。
 */

export { default } from "./src/index.ts";
