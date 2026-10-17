/**
 * 验证 dist/ 是**自足**的：能独立跑起来，不是"文件都在"就算过。
 *
 * 做法和 tests/ui.mjs 一样：用 jsdom 加载 dist/index.html，
 * 手动注入 dist/js/ 里的 4 个脚本，然后看首页有没有渲染出世界卡片。
 *
 *   node scripts/verify-dist.mjs
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "..", "dist");

const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push(e.message));
vc.on("error", (...a) => errors.push(a.join(" ")));

const html = await readFile(join(DIST, "index.html"), "utf8");
const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  url: "http://127.0.0.1:4173/",
  virtualConsole: vc,
});
const { window } = dom;
window.scrollTo = () => {};

for (const f of ["js/logic.js", "js/engine.js", "js/levels.js", "js/app.js"]) {
  const s = window.document.createElement("script");
  s.textContent = await readFile(join(DIST, f), "utf8");
  window.document.body.appendChild(s);
}

const d = window.document;
const worlds = d.querySelectorAll(".world-card").length;
const expected = window.LD.WORLDS.length;
const levels = window.LD.LEVELS.length;
const cards = window.LD.TACTICS.length;

let bad = 0;
const ok = (m) => console.log("  ok   " + m);
const fail = (m) => {
  bad++;
  console.log("  ❌   " + m);
};

if (errors.length) fail("加载时报错：" + errors.join(" | "));
else ok("零 JS 报错");

if (worlds !== expected) fail(`首页渲染出 ${worlds} 个世界，应该有 ${expected} 个`);
else ok(`首页渲染出全部 ${worlds} 个世界`);

if (levels < 100) fail(`只装载了 ${levels} 关，像是漏了文件`);
else ok(`${levels} 关全部装载`);

if (!cards) fail("方法卡没装载");
else ok(`${cards} 张方法卡全部装载`);

// index.html 里不能有绝对路径 —— 否则放到子路径下会 404
const abs = [...html.matchAll(/(?:src|href)="(\/[^/][^"]*)"/g)].map((m) => m[1]);
if (abs.length) fail("index.html 里有绝对路径，放子路径下会 404：" + abs.join(", "));
else ok("所有资源都是相对路径（放任何子路径下都能跑）");

console.log("\n" + (bad === 0 ? "✅ dist/ 是自足的，可以直接部署" : `❌ ${bad} 项失败`));
process.exitCode = bad ? 1 : 0;
