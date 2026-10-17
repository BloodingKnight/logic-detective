/**
 * 打包一份「可以直接拖到静态托管」的产物。
 *
 * 为什么需要它：这个游戏是纯静态的 ——
 *   一个 index.html + 一个 css + 4 个 js，
 *   不联网、不要后端、路径**全是相对的**（放在任何子路径下都能跑）。
 *
 * 所以「部署」就等于「把这 6 个文件放到能被访问的地方」。
 * dist/ 里不放 serve.mjs / 测试 / .cmd / README —— 那些是本地开发用的，
 * 传上去只会让人困惑，还可能被误当成入口。
 *
 *   node scripts/build-dist.mjs
 *   → dist/
 */
import { readFile, writeFile, mkdir, rm, cp, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "logic-detective");
const OUT = join(HERE, "..", "dist");

// 顺序有意义：index.html 里的 <script> 就是这个顺序，谁先谁后有依赖
const FILES = [
  "index.html",
  "css/style.css",
  "js/logic.js",
  "js/engine.js",
  "js/levels.js",
  "js/app.js",
];

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

let total = 0;
for (const rel of FILES) {
  const src = join(SRC, rel);
  const dst = join(OUT, rel);
  await mkdir(dirname(dst), { recursive: true });
  await cp(src, dst);
  const { size } = await stat(dst);
  total += size;
  console.log("  " + rel.padEnd(18) + String(Math.round(size / 1024)).padStart(5) + " KB");
}

// 给 EdgeOne / Netlify 之类看的：没有构建步骤，产物就是这些文件
await writeFile(
  join(OUT, "404.html"),
  `<!DOCTYPE html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>找不到这一页 · 逻辑小侦探</title>
<body style="font-family:system-ui,sans-serif;padding:48px;text-align:center;color:#334">
<div style="font-size:56px">🔍</div>
<h2>这一页不存在</h2>
<p><a href="./" style="color:#5b6ef5">回到首页</a></p>
</body>`
);

console.log("");
console.log(`✅ 产物在 dist/    共 ${Math.round(total / 1024)} KB`);
console.log("");
console.log("怎么部署：");
console.log("  · EdgeOne Pages / Netlify / Vercel：把 dist/ 整个目录拖进去");
console.log("  · 或者命令行上传：把 dist/ 里的内容放到服务器任意目录");
console.log("  · 本地先看一眼：cd dist && npx serve .  （或者 node ../logic-detective/serve.mjs）");
