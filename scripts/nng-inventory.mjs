/**
 * 抓 NNG4 的关卡清单，打印成紧凑的世界 → 关卡列表。
 * 只是为了做「覆盖差距清单」，不属于游戏本体。
 */
const API = "https://api.github.com/repos/leanprover-community/nng4/git/trees/main?recursive=1";

const r = await fetch(API, { headers: { "User-Agent": "gap-analysis" } });
if (!r.ok) {
  console.log("抓取失败 HTTP " + r.status);
  process.exit(1);
}
const j = await r.json();

const worlds = new Map();
for (const e of j.tree) {
  const m = /^Game\/Levels\/([^/]+)\/([^/]+)\.lean$/.exec(e.path);
  if (!m) continue;
  const [, world, file] = m;
  if (!worlds.has(world)) worlds.set(world, []);
  worlds.get(world).push(file);
}

// 找出世界本身的介绍文件（Game/Levels/Xxx.lean），记录世界顺序
const order = [];
for (const e of j.tree) {
  const m = /^Game\/Levels\/([^/]+)\.lean$/.exec(e.path);
  if (m) order.push(m[1]);
}

const sorted = [...worlds.keys()].sort(
  (a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)
);

let total = 0;
for (const w of sorted) {
  const files = worlds.get(w).sort();
  total += files.length;
  console.log(`\n【${w}】 ${files.length} 关`);
  console.log("  " + files.join("  "));
}
console.log(`\n合计 ${sorted.length} 个世界、${total} 关`);
