// 快速冒烟测试：确认内核 API 正常
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const L = require("../js/logic.js");
const E = require("../js/engine.js");

const p = L.parse;
let fails = 0;
function check(name, cond, extra) {
  if (cond) console.log("  ok   " + name);
  else {
    fails++;
    console.log("  FAIL " + name + (extra ? "  → " + extra : ""));
  }
}

console.log("[1] 解析与显示");
check("解析 A -> B", L.show(p("A -> B")) === "A → B", L.show(p("A -> B")));
check("中文原子", L.show(p("下雨 -> 草地湿")) === "下雨 → 草地湿", L.show(p("下雨 -> 草地湿")));
check("双重否定", L.show(p("~~A")) === "¬¬A", L.show(p("~~A")));

// 「给小朋友看的括号」规则：比数学惯例更啰嗦，但绝不会读错。
// 见 logic.js 里 show() 上方的注释。
console.log("  -- 儿童友好括号 --");
check("∧ 套在 ∨ 里要加括号", L.show(p("A & B | C")) === "(A ∧ B) ∨ C", L.show(p("A & B | C")));
check("∨ 套在 ∧ 里也要加括号", L.show(p("A | B & C")) === "A ∨ (B ∧ C)", L.show(p("A | B & C")));
check("→ 右边复合要加括号", L.show(p("A -> B -> C")) === "A → (B → C)", L.show(p("A -> B -> C")));
check("→ 左边复合要加括号", L.show(p("(A -> B) -> C")) === "(A → B) → C", L.show(p("(A -> B) -> C")));
check("→ 右边是 ∧ 要加括号", L.show(p("A -> B & C")) === "A → (B ∧ C)", L.show(p("A -> B & C")));
check("→ 左边是 ∨ 要加括号", L.show(p("(A | B) -> C")) === "(A ∨ B) → C", L.show(p("(A | B) -> C")));
check("非的括号只加在复合公式上", L.show(p("~(A & B)")) === "¬(A ∧ B)");
check("¬ 作用在原子命题上不加括号", L.show(p("~A -> B")) === "¬A → B", L.show(p("~A -> B")));
check("同样结合的 ∧ 不加多余括号", L.show(p("A & B & C")) === "A ∧ B ∧ C", L.show(p("A & B & C")));
check("骑士关的目标能读懂",
  L.show(p("(甲是骑士 & 乙是骑士) | (~甲是骑士 & ~乙是骑士)")) ===
    "(甲是骑士 ∧ 乙是骑士) ∨ (¬甲是骑士 ∧ ¬乙是骑士)",
  L.show(p("(甲是骑士 & 乙是骑士) | (~甲是骑士 & ~乙是骑士)")));

console.log("[2] 真值表");
check("A -> A 是重言式", L.isTautology(p("A -> A")));
check("A -> B 不是重言式", !L.isTautology(p("A -> B")));
check("排中律", L.isTautology(p("A | ~A")));
check("德摩根", L.isTautology(p("~(A & B) -> (~A | ~B)")));

console.log("[3] 走一步证明：A, A->B ⊢ B");
E.resetIds();
let st = E.initialState([p("A"), p("A -> B")], p("B"));
const hyps = E.focused(st).hyps;
let r = E.applyMove(st, "mp", [hyps[0].id, hyps[1].id]);
check("串起来后有 B", r.state.goals[0].hyps.some((h) => L.show(h.f) === "B"));
const bHyp = r.state.goals[0].hyps.find((h) => L.show(h.f) === "B");
r = E.applyMove(r.state, "exact", [bHyp.id]);
check("结案", E.isSolved(r.state));

console.log("[4] 求解器：A∨B, A→C, B→C ⊢ C");
E.resetIds();
st = E.initialState([p("A | B"), p("A -> C"), p("B -> C")], p("C"));
const sol = E.solve(st, { maxDepth: 12 });
check("找得到证明", !!sol, sol ? sol.path.map((m) => m.tactic).join(" → ") : "null");
if (sol) console.log("       路线：" + sol.path.map((m) => m.tactic).join(" → "));

console.log("[5] 求解器：A ⊢ B 应该无解（健全性）");
E.resetIds();
st = E.initialState([p("A")], p("B"));
check("无解", E.solve(st, { maxDepth: 10 }) === null);

console.log("[6] 引理（先立个小目标）");
E.resetIds();
st = E.initialState(
  [p("甲是骑士 -> ~乙是骑士"), p("~甲是骑士 -> 丙是骑士"), p("~丙是骑士")],
  p("~乙是骑士")
);
check("这一关可解", !!E.solve(st, { maxDepth: 14 }));

// 手动走一条「立引理」的路，确认 cut 规则真的把引理变成了新线索
E.resetIds();
st = E.initialState([p("A -> C")], p("A -> C"));
const haveT = E.TACTIC_MAP["have"];
const goal0 = E.focused(st);
const cands = haveT.candidates(goal0, []);
check("引理候选里没有已经有的线索", !cands.some((c) => L.show(c.f) === "A → C"));
check("引理候选里没有目标本身", cands.every((c) => L.show(c.f) !== "A → C"));

console.log("[7] 引理本身可靠吗：A ⊢ B 用引理也不该有解");
E.resetIds();
st = E.initialState([p("A")], p("B"));
check("仍然无解", E.solve(st, { maxDepth: 8 }) === null);

console.log(fails === 0 ? "\n全部通过 ✅" : `\n${fails} 个失败 ❌`);
process.exit(fails === 0 ? 0 : 1);
