/**
 * 诊断脚本：w6-l3 的求解为什么这么慢？
 * 统计「根节点上每个候选走法，各自展开出多少局面」。
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const L = require("../logic-detective/js/logic.js");
const E = require("../logic-detective/js/engine.js");
const LV = require("../logic-detective/js/levels.js");

const lv = LV.findLevel(process.argv[2] || "w6-l3");
const st = E.initialState(lv.givensF, lv.goalF);
const goal = E.focused(st);

console.log(`关卡 ${lv.id}（${lv.title}）`);
console.log("目标：" + L.show(goal.target));
console.log("线索：");
goal.hyps.forEach((h) => console.log("   " + L.show(h.f)));
console.log();

console.log("当前可用的方法卡：");
for (const t of E.TACTICS) {
  if (t.visible && !t.visible(goal)) continue;
  const picks = E.enumeratePicks(goal, t);
  if (!picks.length) continue;
  console.log(
    `   ${t.card.emoji} ${t.card.name.padEnd(6)} prio=${String(t.prio).padEnd(2)} 有 ${picks.length} 种走法`
  );
}

console.log("\n每个根走法展开出的局面数（限深 11）：");

// 借用引擎的搜索，但只统计第一层的子树规模
function countSubtree(state, depth, seen) {
  if (depth <= 0) return 0;
  if (E.isSolved(state)) return 1;
  const k = E.stateKey(state);
  if (seen.has(k)) return 0;
  seen.add(k);
  let n = 1;
  const g = E.focused(state);
  for (const t of E.TACTICS) {
    if (t.visible && !t.visible(g)) continue;
    for (const picks of E.enumeratePicks(g, t)) {
      let r;
      try {
        r = E.applyMove(state, t.id, picks);
      } catch (e) {
        continue;
      }
      n += countSubtree(r.state, depth - 1, seen);
      if (n > 200000) return n;
    }
  }
  return n;
}

const results = [];
for (const t of E.TACTICS) {
  if (t.visible && !t.visible(goal)) continue;
  for (const picks of E.enumeratePicks(goal, t)) {
    let r;
    try {
      r = E.applyMove(st, t.id, picks);
    } catch (e) {
      continue;
    }
    const t0 = Date.now();
    const n = countSubtree(r.state, 10, new Set([E.stateKey(st)]));
    results.push({ tactic: t.id, name: t.card.name, n, ms: Date.now() - t0 });
  }
}
results.sort((a, b) => a.n - b.n);
for (const r of results) {
  console.log(`   ${r.name.padEnd(8)} 展开 ${String(r.n).padStart(8)} 个局面   ${r.ms}ms`);
}

console.log("\n完整求解：");
for (const cfg of [
  { label: "当前设置", o: { maxDepth: 16, maxNodes: 120000 } },
  { label: "限深 12", o: { maxDepth: 12, maxNodes: 200000 } },
]) {
  const t0 = Date.now();
  const sol = E.solve(E.initialState(lv.givensF, lv.goalF), cfg.o);
  console.log(
    `   ${cfg.label.padEnd(10)} ${sol ? "找到 " + sol.path.length + " 步证明" : "未找到"}  ` +
      `${Date.now() - t0}ms  (${sol ? sol.nodes : "-"} 局面)`
  );
  if (sol) console.log("       路线：" + sol.path.map((p) => p.tactic).join(" → "));
}
