/**
 * 内容校验：把 levels.js 里每一关都过一遍机器检查。
 *
 *   1. 可证性 —— 命题关用真值表验「线索 ⇒ 结论」是重言式；
 *      等式关不能用真值表（等号两边是算式不是真假），由求解器与改写引擎测试兜底。
 *   2. 可玩性 —— 用引擎自己的求解器找一条真实证明路线。
 *   3. 工具够不够用 —— ★ 每一关只用「孩子当时已解锁的卡片」就能做出来。
 *      这条同时挡住「先用后介绍」和「新卡偷偷混进早期关卡」。
 *   4. 健全性 —— 内核不能证明假命题。
 *   5. 先教后考 —— 新词必须先介绍，不能藏在题目里。
 *   6. 一致性 —— 关卡按世界顺序连续排列。
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const L = require("../js/logic.js");
const E = require("../js/engine.js");
const LV = require("../js/levels.js");

let fails = 0;
let warns = 0;
const fail = (m) => { fails++; console.log("  ❌   " + m); };
const warn = (m) => { warns++; console.log("  ⚠️   " + m); };
const ok = (m) => console.log("  ok   " + m);

console.log("\n=== 1. 关卡结构 ===");
{
  const seen = new Set();
  for (const lv of LV.LEVELS) {
    if (seen.has(lv.id)) fail(`关卡 id 重复：${lv.id}`);
    seen.add(lv.id);
    if (!LV.WORLD_INDEX.hasOwnProperty(lv.world)) fail(`${lv.id} 的世界不存在`);
    if (!["teach", "quiz", "proof"].includes(lv.type))
      fail(`${lv.id} 的类型 "${lv.type}" 不认识`);
    if (lv.type === "proof") {
      if (!lv.goal) fail(`${lv.id} 没有结论`);
      if (!lv.conclusion) warn(`${lv.id} 没有结案语`);
      if (!lv.hints || !lv.hints.length) warn(`${lv.id} 没有提示`);
    } else if (lv.type === "quiz") {
      const n = (lv.options || []).filter((o) => o.correct).length;
      if (n === 0) fail(`${lv.id} 没有正确答案`);
      for (const o of lv.options) if (!o.why) warn(`${lv.id} 的选项缺少解释`);
    } else if (lv.type === "teach") {
      if (!lv.body || !lv.body.trim()) fail(`${lv.id} 介绍关没有正文`);
      if (!lv.emoji) fail(`${lv.id} 介绍关没有配图`);
    }
  }
  for (const w of LV.WORLDS)
    if (!LV.LEVELS.filter((l) => l.world === w.id).length)
      fail(`世界 ${w.id}（${w.name}）一关都没有`);
  const t = {};
  LV.LEVELS.forEach((l) => (t[l.type] = (t[l.type] || 0) + 1));
  ok(
    `${LV.WORLDS.length} 个世界、${LV.LEVELS.length} 关` +
      `（介绍 ${t.teach} / 选择 ${t.quiz} / 证明 ${t.proof}）`
  );
}

console.log("\n=== 1b. 先教后考（新词必须先介绍）===");
{
  const first = LV.LEVELS.filter((l) => l.world === "intro");
  const teachCount = first.filter((l) => l.type === "teach").length;
  if (teachCount < 4) fail(`第一个档案只有 ${teachCount} 个介绍关，∧ ∨ ¬ → 应该各有一次`);
  else ok(`第一个档案最前面 ${teachCount} 关是纯介绍页`);
  for (let i = 0; i < teachCount; i++)
    if (first[i].type !== "teach")
      fail(`第一个档案第 ${i + 1} 关是「${first[i].type}」而不是介绍关`);

  const taughtSyms = new Set(
    LV.LEVELS.filter((l) => l.type === "teach").map((l) => l.symbol)
  );
  const noPage = LV.SYMBOLS.filter((s) => !taughtSyms.has(s.sym));
  if (noPage.length)
    fail(
      "这些符号没有专门的介绍页：" +
        noPage.map((s) => `${s.sym} ${s.name}`).join("、")
    );
  else ok(`全部 ${LV.SYMBOLS.length} 个符号都有专门的介绍页`);

  // 解锁信息只能有一份数据源（介绍关）。世界重排时残留的手写字段曾让武器库崩掉。
  const stray = [];
  for (const t of E.TACTICS) if (t.intro !== undefined) stray.push("方法卡 " + t.id);
  for (const s of LV.SYMBOLS) if (s.intro !== undefined) stray.push("符号 " + s.sym);
  if (stray.length) fail(`这些地方还留着旧的 intro 字段：${stray.join("、")}`);
  else ok("解锁信息只有一份数据源（介绍关）");

  const noGuide = E.TACTICS.filter((t) => !LV.CARD_GUIDE[t.id]);
  if (noGuide.length)
    fail(`这些方法卡没有武器库说明：${noGuide.map((t) => t.id).join("、")}`);
  else ok(`全部 ${E.TACTICS.length} 张方法卡都有「什么时候用 + 例子」`);

  const placed = new Set();
  for (const g of LV.CARD_GROUPS) for (const id of g.ids) placed.add(id);
  const missing = E.TACTICS.filter((t) => !placed.has(t.id));
  if (missing.length)
    fail(`这些卡没有归到武器库任何一组：${missing.map((t) => t.id).join("、")}`);
  else ok(`武器库分 ${LV.CARD_GROUPS.length} 组，覆盖全部 ${E.TACTICS.length} 张卡`);
  const unknown = [...placed].filter((id) => !E.TACTIC_MAP[id]);
  if (unknown.length) fail(`武器库分组引用了不存在的卡：${unknown.join("、")}`);
}

console.log("\n=== 2. 可证性 ===");
{
  const proofs = LV.LEVELS.filter((l) => l.type === "proof");
  let equational = 0;
  for (const lv of proofs) {
    const f = L.impAll(lv.givensF.concat(lv.rulesF || []), lv.goalF);
    if (L.hasEquation(f)) { equational++; continue; }
    if (!L.isTautology(f)) {
      const names = [...L.atomsOf(f)];
      let cex = null;
      for (let m = 0; m < 1 << names.length && !cex; m++) {
        const env = {};
        names.forEach((n, i) => (env[n] = !!(m & (1 << i))));
        if (!L.evaluate(f, env)) cex = env;
      }
      fail(`${lv.id} 不是重言式 —— 结论推不出来！反例：${JSON.stringify(cex)}`);
    }
  }
  ok(`真值表检查了 ${proofs.length - equational} 个命题逻辑关`);
  if (equational)
    console.log(`       另有 ${equational} 个等式关，由求解器与改写引擎测试兜底`);
}

console.log("\n=== 3. 可玩性（求解器要能找到真实证明）===");
{
  const proofs = LV.LEVELS.filter((l) => l.type === "proof");
  const timings = [];
  for (const lv of proofs) {
    E.resetIds();
    const st = E.initialState(lv.givensF, lv.goalF, lv.rulesF);
    const t0 = Date.now();
    const sol = E.solve(st, { maxDepth: 16, maxNodes: 120000 });
    const ms = Date.now() - t0;
    timings.push({ id: lv.id, ms, len: sol ? sol.path.length : -1 });
    if (!sol) { fail(`${lv.id}（${lv.title}）求解器找不到证明 —— 孩子会卡死`); continue; }
    E.resetIds();
    let s2 = E.initialState(lv.givensF, lv.goalF, lv.rulesF);
    let replayOk = true;
    for (const step of sol.path) {
      try { s2 = E.applyMove(s2, step.tactic, step.picks).state; }
      catch (err) {
        replayOk = false;
        fail(`${lv.id} 重放到「${step.tactic}」走不通：${err.message}`);
        break;
      }
    }
    if (replayOk && !E.isSolved(s2)) fail(`${lv.id} 重放后没有结案`);
    if (ms > 3000) warn(`${lv.id} 求解耗时 ${ms}ms`);
  }
  const slow = timings.filter((t) => t.ms > 500).sort((a, b) => b.ms - a.ms);
  ok(
    `全部 ${proofs.length} 关都找到了证明` +
      (slow.length
        ? `；最慢：${slow.slice(0, 3).map((t) => `${t.id} ${t.ms}ms`).join("、")}`
        : "；都很快")
  );
  const steps = timings.map((t) => t.len).filter((n) => n > 0);
  console.log(
    `       证明步数：最短 ${Math.min(...steps)}，最长 ${Math.max(...steps)}，` +
      `平均 ${(steps.reduce((a, b) => a + b, 0) / steps.length).toFixed(1)}`
  );
}

console.log("\n=== 3b. 每一关都能用「孩子当时已有的工具」做出来 ===");
{
  const proofs = LV.LEVELS.filter((l) => l.type === "proof");
  let worst = { id: "-", n: 0 };
  for (const lv of proofs) {
    const avail = LV.tacticsForLevel(lv.id);
    if (avail.size > worst.n) worst = { id: lv.id, n: avail.size };
    E.resetIds();
    const st = E.initialState(lv.givensF, lv.goalF, lv.rulesF);
    const sol = E.solve(st, { maxDepth: 16, maxNodes: 80000, only: avail });
    if (!sol)
      fail(`${lv.id}（${lv.title}）用已解锁的 ${avail.size} 张卡证不出来 —— 孩子会卡死`);
  }
  ok(`全部 ${proofs.length} 关，只用当时解锁的卡片就能做出来`);
  console.log(`       工具最多的一关是 ${worst.id}，那时手上有 ${worst.n} 张卡`);

  const introCount = {};
  for (const lv of LV.LEVELS)
    for (const c of lv.newCards || []) introCount[c] = (introCount[c] || 0) + 1;
  for (const t of E.TACTICS) {
    if (!introCount[t.id]) fail(`方法卡「${t.card.name}」(${t.id}) 没有任何一关介绍它`);
    else if (introCount[t.id] > 1)
      warn(`方法卡「${t.card.name}」被 ${introCount[t.id]} 关重复介绍`);
  }
  ok(`全部 ${E.TACTICS.length} 张卡都恰好有一关负责介绍`);

  for (const t of E.TACTICS) {
    const lv = LV.cardIntroLevel(t.id);
    if (lv && !LV.tacticsForLevel(lv.id).has(t.id))
      fail(`${lv.id} 介绍了 ${t.id}，但这一关自己用不上它`);
  }
  ok("介绍某张卡的那一关，自己就在用这张卡");
}

console.log("\n=== 4. 内核健全性（不能证明假命题）===");
{
  const bad = [
    [["A"], "B"],
    [["A -> B"], "A"],
    [["A | B"], "A"],
    [["A -> B", "B"], "A"],
    [["~A"], "A"],
  ];
  for (const [givens, goal] of bad) {
    E.resetIds();
    const st = E.initialState(givens.map(L.parse), L.parse(goal));
    if (E.solve(st, { maxDepth: 8, maxNodes: 20000 }))
      fail(`内核竟然"证明"了 ${givens.join(", ")} ⊢ ${goal} —— 不健全！`);
  }
  ok(`检查了 ${bad.length} 个不该有解的推理，全部无解`);
  console.log("       （等式的健全性由 scripts/check-equality.mjs 专门检查）");
}

console.log("\n=== 4b. 学习路线（课时表）===");
{
  const seen = new Map();
  for (const lesson of LV.LESSONS)
    for (const id of lesson.levels) {
      if (seen.has(id))
        fail(`${id} 同时出现在第 ${seen.get(id)} 课和第 ${lesson.n} 课`);
      seen.set(id, lesson.n);
      if (!LV.findLevel(id)) fail(`第 ${lesson.n} 课引用了不存在的关卡：${id}`);
    }
  const missing = LV.LEVELS.filter((l) => !seen.has(l.id));
  if (missing.length)
    fail(`这些关不属于任何一课：${missing.map((l) => l.id).join("、")}`);
  else ok(`全部 ${LV.LEVELS.length} 关都归到了某一课，且不重复`);

  // ★ 每一课必须是连续的一段关卡。关卡按顺序解锁，不连续就意味着
  //   孩子会在某一课里撞上锁着的门（踩过：knights-l6 被放进了「说谎岛（上）」）。
  const flat = LV.LESSONS.flatMap((l) => l.levels);
  const realOrder = LV.LEVELS.map((l) => l.id);
  if (flat.length !== realOrder.length || !flat.every((id, i) => id === realOrder[i]))
    fail(
      "课时和关卡顺序对不上 —— 每一课必须是连续的一段，" +
        "否则孩子会在课时里撞上没解锁的关卡"
    );
  else ok("每一课都是连续的一段，课时顺序和关卡顺序完全一致");

  const mins = LV.LESSONS.map((l) => l.minutes);
  const total = mins.reduce((a, b) => a + b, 0);
  const over = LV.LESSONS.filter((l) => l.minutes > 35);
  if (over.length) warn(`这些课时超过 35 分钟：${over.map((l) => l.title).join("、")}`);
  ok(
    `${LV.LESSONS.length} 次课，合计约 ${total} 分钟，` +
      `每课 ${Math.min(...mins)}~${Math.max(...mins)} 分钟`
  );

  for (const l of LV.LESSONS)
    if (!l.goal || !l.goal.trim()) fail(`第 ${l.n} 课没有毕业标准`);
  ok("每一课都有「毕业标准」");
}

console.log("\n=== 4c. 线索必须可满足（否则任何结论都能「推出」）===");
{
  let checked = 0;
  for (const lv of LV.LEVELS) {
    if (lv.type !== "proof") continue;
    const all = lv.givensF.concat(lv.rulesF || []);
    if (all.some((f) => L.hasEquation(f))) continue;
    checked++;
    const names = [...new Set(all.flatMap((f) => [...L.atomsOf(f)]))];
    let models = 0;
    for (let m = 0; m < 1 << names.length; m++) {
      const env = {};
      names.forEach((n, i) => (env[n] = !!(m & (1 << i))));
      if (all.every((g) => L.evaluate(g, env))) models++;
    }
    // ★ 线索自相矛盾时，「线索 ⇒ 结论」永远为真 —— 第 2 节的重言式检查会放行。
    //   这一关其实在教假逻辑：结论不是从故事推出来的，是从矛盾里「炸」出来的。
    //   例外：lv.paradox 标了名的关卡，**故意**用矛盾线索，结论必须是 ⊥。
    if (models === 0) {
      if (!lv.paradox)
        fail(
          `${lv.id}（${lv.title}）线索自相矛盾 —— 任何结论都能被「推出」：` +
            all.map((f) => L.show(f)).join(" ; ")
        );
      else if (lv.goalF.k !== "false")
        fail(`${lv.id} 标了 paradox，但结论不是 ⊥ —— 矛盾线索下证明任何东西都是假的`);
    } else if (lv.paradox) {
      fail(`${lv.id} 标了 paradox（要用矛盾线索证 ⊥），可它的线索其实有解`);
    }
  }
  ok(`${checked} 个命题逻辑关的线索都可满足`);
}

console.log("\n=== 5. 一致性 ===");
{
  const known = new Set(E.TACTICS.map((t) => t.id));
  for (const lv of LV.LEVELS)
    for (const c of lv.newCards || [])
      if (!known.has(c)) fail(`${lv.id} 引用了不存在的方法卡：${c}`);
  for (const lv of LV.LEVELS) {
    if (lv.type !== "proof") continue;
    for (const c of lv.newCards || [])
      if (!LV.tacticsForLevel(lv.id).has(c))
        fail(`${lv.id} 介绍了 ${c}，但这一关自己用不上`);
  }
  const order = LV.LEVELS.map((l) => LV.WORLD_INDEX[l.world]);
  for (let i = 1; i < order.length; i++)
    if (order[i] < order[i - 1])
      fail(
        `关卡排列和世界顺序不一致：${LV.LEVELS[i].id} 排在 ${LV.LEVELS[i - 1].id} 后面，` +
          `但它的世界更靠前`
      );
  ok("关卡按世界顺序分组排列，没有交错");
}

console.log("\n" + "=".repeat(52));
if (fails === 0) console.log(`✅ 全部通过${warns ? `（${warns} 条提醒）` : ""}`);
else console.log(`❌ ${fails} 项失败${warns ? `，${warns} 条提醒` : ""}`);
process.exitCode = fails === 0 ? 0 : 1;
