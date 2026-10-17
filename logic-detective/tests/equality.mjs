import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const L = require("../js/logic.js");
const E = require("../js/engine.js");
const LV = require("../js/levels.js");

let fails = 0;
const ok = (m) => console.log("  ok   " + m);
const bad = (m) => {
  fails++;
  console.log("  ❌   " + m);
};

/** givens = 关于特定对象的线索；rules = 普遍成立的规则（变量当占位符） */
function make(givens, rules, goal) {
  E.resetIds();
  return E.initialState(
    (givens || []).map(L.parse),
    L.parse(goal),
    (rules || []).map(L.parse)
  );
}
function solve(givens, rules, goal, opts) {
  return E.solve(make(givens, rules, goal), opts || {});
}

console.log("=== 1. 项的解析与显示 ===");
for (const [src, want] of [
  ["3 + 4 = 7", "3 + 4 = 7"],
  ["2 * y = 2 * (x + 7)", "2 × y = 2 × (x + 7)"],
  ["(x + 1) + 0 = x + 1", "(x + 1) + 0 = x + 1"],
  ["succ (succ 0) = 2", "succ (succ 0) = 2"],
]) {
  const got = L.show(L.parse(src));
  if (got === want) ok(`${src}  →  ${got}`);
  else bad(`${src} 显示成「${got}」，应该是「${want}」`);
}

console.log("\n=== 2. 老语法不能坏（55 关重新解析）===");
{
  let n = 0;
  for (const lv of LV.LEVELS) {
    if (lv.type !== "proof") continue;
    for (const g of lv.givens || []) L.parse(g);
    for (const r of lv.rules || []) L.parse(r);
    L.parse(lv.goal);
    n++;
  }
  ok(`${n} 个证明关的公式全部解析通过`);
}

console.log("\n=== 3. 改写 ===");
{
  // 算一算 + 两边一样
  E.resetIds();
  let st = make([], [], "3 + 4 = 7");
  st = E.applyMove(st, "compute", []).state;
  const after = L.show(E.focused(st).target);
  if (after === "7 = 7") ok(`3 + 4 = 7  算一算 →  ${after}`);
  else bad(`算一算后是「${after}」，应该是「7 = 7」`);
  st = E.applyMove(st, "rfl", []).state;
  if (E.isSolved(st)) ok("再点「两边一样」结案");
  else bad("两边一样没能结案");
}

for (const [name, givens, rules, goal] of [
  ["NNG 第 2 关那道题", ["y = x + 7"], [], "2 * y = 2 * (x + 7)"],
  ["规则里的变量要能匹配一整块", [], ["n + 0 = n"], "(x + 1) + 0 = x + 1"],
  ["同一个线索用两次（两个 a 都换）", ["a = b"], [], "a + a = b + b"],
  ["反着换", ["y = x + 7"], [], "2 * (x + 7) = 2 * y"],
  ["替换 + 算一算", ["k = 5"], [], "k + k = 10"],
  ["两条线索一起用", ["m = n + 1", "k = 3"], [], "m + k = (n + 1) + 3"],
  ["对称性是能推出来的", ["a = b"], [], "b = a"],
]) {
  const sol = solve(givens, rules, goal);
  if (sol)
    ok(
      `${name}：${goal}  →  ` +
        sol.path.map((p) => E.TACTIC_MAP[p.tactic].card.name).join(" → ")
    );
  else bad(`${name}：${goal} 求解器找不到证明`);
}

console.log("\n=== 4. Peano：从公理推出 1 + 1 = 2 ===");
{
  const rules = ["n + 0 = n", "n + succ m = succ (n + m)"];
  // 关键：必须写成 succ 链。写成阿拉伯数字的话，`1 + 1` 会被「算一算」
  // 直接算成 2，那就完全没用到 Peano 公理，也就没什么可学的了。
  const sol = solve([], rules, "succ 0 + succ 0 = succ (succ 0)", { maxDepth: 14 });
  if (sol)
    ok(
      `succ 0 + succ 0 = succ (succ 0) 从两条公理推出来（${sol.path.length} 步）：` +
        sol.path.map((p) => E.TACTIC_MAP[p.tactic].card.name).join(" → ")
    );
  else bad("succ 0 + succ 0 = succ (succ 0) 推不出来");
  if (sol && sol.path.every((p) => p.tactic !== "compute"))
    ok("全程没有用「算一算」—— 确实是靠公理推的，不是算出来的");
  else if (sol) bad("这条证明里混进了「算一算」，说明 succ 被当成数字算掉了");

  // 再翻译回熟悉的写法
  const sol2 = solve(
    [],
    rules.concat(["succ 0 = 1", "succ 1 = 2"]),
    "1 + 1 = 2",
    { maxDepth: 14 }
  );
  if (sol2)
    ok(
      `再翻译回 1 + 1 = 2（${sol2.path.length} 步）：` +
        sol2.path.map((p) => E.TACTIC_MAP[p.tactic].card.name).join(" → ")
    );
  else bad("1 + 1 = 2 推不出来");
}

console.log("\n=== 4b. 归纳法：从两条定义推出 0 + n = n ===");
{
  // 只给加法的两条定义，**不给** 0 + n = n —— 这条必须靠归纳法才能得到
  const rules = ["n + 0 = n", "n + succ m = succ (n + m)"];
  const sol = solve([], rules, "0 + n = n", { maxDepth: 14 });
  if (sol) {
    ok(
      `0 + n = n 推出来了（${sol.path.length} 步）：` +
        sol.path.map((p) => E.TACTIC_MAP[p.tactic].card.name).join(" → ")
    );
    if (sol.path.some((p) => p.tactic === "ind")) ok("证明里确实用到了归纳法");
    else bad("没用归纳法就证出来了？那说明规则给多了");
  } else bad("0 + n = n 推不出来 —— 归纳法可能没接对");

  // 健全性：归纳法不能把假命题证成真的
  if (!solve([], rules, "n = 0", { maxDepth: 10 }))
    ok("n = 0 正确地证不出来（归纳法第二步过不去）");
  else bad("n = 0 竟然被证出来了 —— 归纳法不健全！");
}

console.log("\n=== 5. 健全性（不该能证的必须证不出来）===");
for (const [givens, rules, goal, why] of [
  [[], [], "x + 0 = x", "一条规则都没有时，x+0=x 不是自动成立"],
  [[], [], "2 + 2 = 5", "2+2 算出来是 4"],
  [["a = b"], [], "a + c = b + b", "★ 线索 a=b 只能换掉 a 本身，不能换别的东西"],
  [["y = x + 7"], [], "2 * y = 2 * x", "右边应该是 2×(x+7)"],
  [[], ["succ 0 = 1"], "succ (succ 0) = 2", "只给了 succ 0 = 1"],
  [["n = 3"], [], "n + 1 = 3", "n=3 时 n+1 应该是 4"],
]) {
  const sol = solve(givens, rules, goal, { maxDepth: 8 });
  if (!sol) ok(`${goal} 正确地无解（${why}）`);
  else bad(`${goal} 竟然被"证明"了 —— ${why}`);
}

console.log("\n" + "=".repeat(52));
console.log(fails === 0 ? "✅ 等式推理全部通过" : `❌ ${fails} 项失败`);
process.exitCode = fails === 0 ? 0 : 1;
