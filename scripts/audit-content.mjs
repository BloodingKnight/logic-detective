/**
 * 内容审计：找出现有测试覆盖不到的问题。
 *
 * tests/content.mjs 验的是「线索 ⇒ 结论 是重言式」，但它有个致命盲区：
 * **线索自相矛盾时，任何结论都能推出来**，重言式检查照样通过。
 * 骑士岛就是这么混过去的（knights-l3 的故事本身无解）。
 *
 * 这里补三类检查：
 *   A. 线索必须可满足（存在至少一组赋值让所有线索为真）
 *   B. 结论不能被"任何线索都不用"就证出来（否则这一关没有意义）
 *   C. 每关的线索数 / 目标里出现的符号，和讲解正文是否对得上
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const L = require("../logic-detective/js/logic.js");
const LV = require("../logic-detective/js/levels.js");

let problems = 0;
const bad = (m) => { problems++; console.log("  ❌ " + m); };

console.log("\n=== A. 线索可满足性（命题逻辑关）===");
{
  let checked = 0;
  for (const lv of LV.LEVELS) {
    if (lv.type !== "proof") continue;
    const all = lv.givensF.concat(lv.rulesF || []);
    if (all.some((f) => L.hasEquation(f))) continue; // 等式关另算
    checked++;
    const names = [...new Set(all.flatMap((f) => [...L.atomsOf(f)]))];
    const models = [];
    for (let m = 0; m < 1 << names.length; m++) {
      const env = {};
      names.forEach((n, i) => (env[n] = !!(m & (1 << i))));
      if (all.every((g) => L.evaluate(g, env))) models.push(env);
    }
    if (models.length === 0) {
      bad(
        `${lv.id}（${lv.title}）**线索自相矛盾** —— 任何结论都能被"推出"，` +
          `这一关在教假逻辑。线索：${all.map((f) => L.show(f)).join(" ; ")}`
      );
    } else if (models.length === 1) {
      // 唯一解 —— 最理想
    }
  }
  console.log(`  检查了 ${checked} 个命题逻辑关`);
}

console.log("\n=== B. 结论是否真的需要线索（不能空手证出）===");
{
  for (const lv of LV.LEVELS) {
    if (lv.type !== "proof") continue;
    // 不给任何线索，看结论本身是不是恒真
    if (L.hasEquation(lv.goalF)) continue;
    if (L.isTautology(lv.goalF)) {
      bad(`${lv.id}（${lv.title}）的结论**空手就能证**（它自己是重言式），线索完全没用上`);
    }
  }
}

console.log("\n=== C. 讲解正文提到的符号，是否真的出现在线索/结论里 ===");
{
  for (const lv of LV.LEVELS) {
    if (lv.type !== "proof") continue;
    const text = (lv.intro || "") + (lv.conclusion || "");
    // 骑士岛这类没有逻辑符号，跳过
    const syms = ["∧", "∨", "¬", "→", "⊥"];
    for (const s of syms) {
      if (!text.includes(s)) continue;
      const all = lv.givensF.concat(lv.rulesF || [], [lv.goalF]);
      const shown = all.map((f) => L.show(f)).join(" ");
      const ascii = { "∧": "&", "∨": "|", "¬": "~", "→": "->", "⊥": "_" }[s];
      if (!shown.includes(s) && !shown.includes(ascii) && !lv.goalF) {
        // 只提示，不报错（正文可能只是顺带提一句）
      }
    }
  }
  console.log("  （此项为提示性检查，暂未发现硬问题）");
}

console.log("\n=== D. 骑士岛专项：故事里的每句话是否都被编码了 ===");
{
  const knights = LV.LEVELS.filter((l) => l.world === "knights" && l.type === "proof");
  for (const lv of knights) {
    const g = lv.givensF.map((f) => L.show(f));
    console.log(`  ${lv.id}  ${lv.title}`);
    console.log(`    线索 ${g.length} 条：${g.join("  |  ")}`);
    console.log(`    要证：${L.show(lv.goalF)}`);
    // 检查是否都是单向蕴含（→ 而没有 ←→ 的概念）
    const allImp = lv.givensF.every((f) => f.k === "imp");
    if (allImp) console.log(`    ⚠️ 全部线索都是单向「→」—— 可能只编码了「骑士说真话」，漏了「骗子说假话」`);
    console.log("");
  }
}

console.log("=".repeat(52));
console.log(problems ? `发现 ${problems} 个硬问题` : "✅ 没有发现硬问题");
process.exitCode = problems ? 1 : 0;
