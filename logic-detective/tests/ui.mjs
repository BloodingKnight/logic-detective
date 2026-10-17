/**
 * 界面端到端测试：用 jsdom 把 index.html 真的跑起来，
 * 然后像小朋友一样点按钮，检查：
 *
 *   1. 页面能启动，没有 JS 报错
 *   2. 首页 / 世界页 / 关卡页能正常切换
 *   3. 每一关（介绍 / 选择 / 证明）都能在界面上点通
 *   4. 新道具介绍弹层：每一关的新卡都先介绍过
 *   5. 撤销 / 重来 / 提示按钮能用
 *   6. 武器库能开、能切页、内容完整
 *   7. 通关后进度写进 localStorage
 *
 * 这是最有价值的一层测试：它验证的不是「代码看起来对」，
 * 而是「小朋友真的能把它玩通」。
 */
import { JSDOM, VirtualConsole } from "jsdom";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = join(HERE, "..");

const L = require("../js/logic.js");
const E = require("../js/engine.js");
const LV = require("../js/levels.js");

let fails = 0;
const fail = (m) => { fails++; console.log("  ❌   " + m); };
const ok = (m) => console.log("  ok   " + m);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 出题关：找一组「成立的题」（返回菜单下标）。
 *
 * 判定规则必须和 app.js 的 checkCreate、content.mjs 的 findValidPuzzle 一致。
 * 别在测试里「全选线索再逐个试结论」—— 全选常常会让线索互相矛盾，
 * 那说明提示是对的，不是 bug。
 */
function findCreateCombo(level) {
  const pool = level.poolF;
  const avail = LV.tacticsForLevel(level.id);
  let tries = 0;
  for (let mask = 1; mask < 1 << pool.length; mask++) {
    const idx = [];
    for (let i = 0; i < pool.length; i++) if (mask & (1 << i)) idx.push(i);
    if (idx.length > 4) continue;
    const givens = idx.map((i) => pool[i]);
    if (!L.isSatisfiable(givens)) continue;
    for (let gi = 0; gi < level.goalsF.length; gi++) {
      if (++tries > 400) return null;
      const goal = level.goalsF[gi];
      if (L.isTautology(goal)) continue;
      if (givens.some((g) => L.key(g) === L.key(goal))) continue;
      E.resetIds();
      const sol = E.solve(E.initialState(givens, goal, []), {
        maxDepth: 12,
        maxNodes: 60000,
        only: avail,
      });
      if (sol) return { givens: idx, goal: gi };
    }
  }
  return null;
}

// ------------------------------------------------------------ 启动页面

const html = await readFile(join(GAME, "index.html"), "utf8");
const errors = [];
const vc = new VirtualConsole();
vc.on("jsdomError", (e) => errors.push("jsdomError: " + e.message));
vc.on("error", (...a) => errors.push("console.error: " + a.join(" ")));

const dom = new JSDOM(html, {
  runScripts: "dangerously",
  pretendToBeVisual: true,
  url: "http://127.0.0.1:4173/",
  virtualConsole: vc,
});
const { window } = dom;
const doc = window.document;

// jsdom 没实现 scrollTo，补个空壳免得刷屏
window.scrollTo = () => {};

// jsdom 默认不加载本地相对路径的 <script>，手动按顺序塞进去
for (const f of ["js/logic.js", "js/engine.js", "js/levels.js", "js/app.js"]) {
  const code = await readFile(join(GAME, f), "utf8");
  const s = doc.createElement("script");
  s.textContent = code;
  doc.body.appendChild(s);
}

const $ = (id) => doc.getElementById(id);
const click = (node) => {
  if (!node) throw new Error("要点击的元素不存在");
  node.dispatchEvent(
    new window.MouseEvent("click", { bubbles: true, cancelable: true })
  );
};

console.log("\n=== 界面端到端测试（jsdom）===");

console.log("\n--- 1. 启动 ---");
if (errors.length) fail("启动时报错：" + errors.join(" | "));
else ok("页面启动无报错");
const worldCards0 = [...doc.querySelectorAll(".world-card")];
if (worldCards0.length !== LV.WORLDS.length)
  fail(`世界卡片 ${worldCards0.length} 个，应该是 ${LV.WORLDS.length} 个`);
else ok(`首页渲染出 ${worldCards0.length} 个世界`);

/** 一共弹了几次「新道具介绍」——用来验证新词确实都先介绍过 */
let introShown = 0;

function backToHome() {
  for (let i = 0; i < 4; i++) {
    if (!$("screen-home").hidden) return;
    click($("btn-back"));
  }
  throw new Error("回不到首页");
}

function gotoLevel(levelId) {
  const level = LV.findLevel(levelId);
  const wIdx = LV.WORLD_INDEX[level.world];
  backToHome();
  const cards = [...doc.querySelectorAll(".world-card")];
  if (cards[wIdx].classList.contains("locked"))
    throw new Error(`世界 ${level.world} 还是锁着的（测试顺序有问题）`);
  click(cards[wIdx]);
  const list = [...doc.querySelectorAll(".level-item")];
  const inWorld = LV.LEVELS.filter((l) => l.world === level.world);
  const idx = inWorld.findIndex((l) => l.id === levelId);
  if (idx < 0 || !list[idx]) throw new Error("找不到关卡入口 " + levelId);
  if (list[idx].classList.contains("locked"))
    throw new Error(`关卡 ${levelId} 还是锁着的`);
  click(list[idx]);
  // 「新道具介绍」弹层会挡在关卡前面 —— 小朋友得先看完它才进得去
  if (!$("card-intro").hidden) {
    introShown++;
    click($("btn-card-intro-ok"));
  }
}

console.log("\n--- 2. 导航 ---");
try {
  click([...doc.querySelectorAll(".world-card")][0]);
  if ($("screen-world").hidden) fail("点世界卡片没进入世界页");
  else ok(`进入世界页，列出 ${doc.querySelectorAll(".level-item").length} 关`);
  backToHome();
  if ($("screen-home").hidden) fail("返回按钮失效");
  else ok("返回按钮正常");

  // 学习路线页
  click($("btn-lessons"));
  if ($("screen-lessons").hidden) fail("打不开学习路线页");
  else {
    const cards = [...doc.querySelectorAll("#lesson-list .lesson-card")];
    if (cards.length !== LV.LESSONS.length)
      fail(`学习路线列出 ${cards.length} 次课，应该是 ${LV.LESSONS.length} 次`);
    else ok(`学习路线列出 ${cards.length} 次课`);
    if (cards.filter((c) => !c.textContent.includes("毕业标准")).length)
      fail("有些课时没有显示毕业标准");
    else ok("每次课都显示了「毕业标准」");
    if (!cards[0].textContent.includes("第 1 次")) fail("第一课没有编号");
    if (!cards[LV.LESSONS.length - 1].classList.contains("locked"))
      fail("最后一课一开始就该是锁着的");
    else ok("没做完前一课时，后面的课时是锁着的");
  }
  backToHome();
  const locked = doc.querySelectorAll(".world-card.locked").length;
  if (locked !== LV.WORLDS.length - 1)
    fail(`应该有 ${LV.WORLDS.length - 1} 个世界是锁的，实际 ${locked} 个`);
  else ok(`后面的世界都上锁了（${locked} 个）`);
} catch (e) {
  fail("导航测试异常：" + e.message);
}

console.log("\n--- 3. 逐关通关（走真实点击）---");
let solvedCount = 0;
const failedLevels = [];

for (const level of LV.LEVELS) {
  try {
    gotoLevel(level.id);
  } catch (e) {
    fail(`${level.id} 打不开：${e.message}`);
    failedLevels.push(level.id);
    continue;
  }

  if (level.type === "teach") {
    const sym = $("teach-symbol").textContent.trim();
    const text = $("teach-body").textContent.trim();
    if (!sym) fail(`${level.id} 介绍关没有显示大符号`);
    if (text.length < 60) fail(`${level.id} 介绍关正文太短（${text.length} 字）`);
    click($("btn-teach-done"));
    if ($("screen-done").hidden) {
      fail(`${level.id}（介绍关）没走到完成页`);
      failedLevels.push(level.id);
    } else solvedCount++;
    continue;
  }

  if (level.type === "quiz") {
    const need = level.options.filter((o) => o.correct).length;
    for (let round = 0; round < need; round++) {
      const opts = [...doc.querySelectorAll(".quiz-option")];
      const t = level.options.findIndex((o, i) => o.correct && !opts[i].disabled);
      if (t < 0) break;
      click(opts[t]);
    }
    await sleep(1100); // 等通关动画的延时
    if ($("screen-done").hidden) {
      fail(`${level.id}（选择题）没走到通关页`);
      failedLevels.push(level.id);
    } else solvedCount++;
    continue;
  }

  if (level.type === "summary") {
    const ta = $("summary-note");
    if (!ta) {
      fail(`${level.id} 没有「用自己的话说」的输入框`);
      failedLevels.push(level.id);
      continue;
    }
    if (!$("summary-graduation").textContent.trim()) {
      fail(`${level.id} 没显示毕业标准`);
      failedLevels.push(level.id);
      continue;
    }
    ta.value = "我自己的理解（测试）";
    click($("btn-summary-done"));
    if ($("screen-done").hidden) {
      fail(`${level.id}（小结关）没走到完成页`);
      failedLevels.push(level.id);
    } else solvedCount++;
    continue;
  }

  if (level.type === "justify") {
    const rows = [...doc.querySelectorAll("#justify-steps .justify-step")];
    if (rows.length !== level.stepsF.length) {
      fail(`${level.id} 显示了 ${rows.length} 步，应该有 ${level.stepsF.length} 步`);
      failedLevels.push(level.id);
      continue;
    }
    // 先空着交一次，确认它会提示「还有 N 步没选」
    click($("btn-justify-check"));
    const fb0 = $("justify-feedback");
    if (fb0.hidden || !fb0.textContent.includes("没选理由")) {
      fail(`${level.id} 没选理由就提交，没给出「还有几步没选」的提示`);
      failedLevels.push(level.id);
      continue;
    }
    // 故意把第一步选错，确认它会标红而不是放行
    const sels = rows.map((r) => r.querySelector("select"));
    const wrongPick =
      (level.steps[0].answer + 1) % level.options.length;
    sels[0].value = String(wrongPick);
    for (let i = 1; i < sels.length; i++) sels[i].value = String(level.steps[i].answer);
    click($("btn-justify-check"));
    const fb1 = $("justify-feedback");
    if (!fb1.textContent.includes("不对")) {
      fail(`${level.id} 第一步选错了，却没提示「理由不对」`);
      failedLevels.push(level.id);
      continue;
    }
    // 全部选对
    for (let i = 0; i < sels.length; i++) sels[i].value = String(level.steps[i].answer);
    click($("btn-justify-check"));
    const fb2 = $("justify-feedback");
    if (!fb2.classList.contains("good")) {
      fail(`${level.id} 全部选对却没判过关`);
      failedLevels.push(level.id);
      continue;
    }
    const fin = [...doc.querySelectorAll("#justify-play button")][0];
    if (!fin) {
      fail(`${level.id} 全对之后没有「收工」按钮`);
      failedLevels.push(level.id);
      continue;
    }
    click(fin);
    if ($("screen-done").hidden) {
      fail(`${level.id}（补理由关）没走到完成页`);
      failedLevels.push(level.id);
    } else solvedCount++;
    continue;
  }

  if (level.type === "explain") {
    const rows = [...doc.querySelectorAll("#explain-steps .explain-step")];
    if (rows.length !== level.stepsF.length) {
      fail(`${level.id} 显示了 ${rows.length} 步，应该有 ${level.stepsF.length} 步`);
      failedLevels.push(level.id);
      continue;
    }
    // 先故意点错一步，确认它会说「没问题」而不是直接判过关
    const wrongPick = level.wrongIndex === 0 ? 1 : 0;
    click(rows[wrongPick]);
    const fb0 = $("explain-feedback");
    if (fb0.hidden || !fb0.classList.contains("bad")) {
      fail(`${level.id} 点错的那一步没给出「这一步没问题」的反馈`);
      failedLevels.push(level.id);
      continue;
    }
    // 再点对的那一步
    click(rows[level.wrongIndex]);
    const fb1 = $("explain-feedback");
    if (!fb1.classList.contains("good")) {
      fail(`${level.id} 点对的那一步没判对`);
      failedLevels.push(level.id);
      continue;
    }
    if (!$("explain-steps").querySelector(".explain-step.wrong")) {
      fail(`${level.id} 没标出哪一步是错的`);
      failedLevels.push(level.id);
      continue;
    }
    const fin = [...doc.querySelectorAll("#explain-play button")][0];
    if (!fin) {
      fail(`${level.id} 找到错误后没有「收工」按钮`);
      failedLevels.push(level.id);
      continue;
    }
    click(fin);
    if ($("screen-done").hidden) {
      fail(`${level.id}（讲解关）没走到完成页`);
      failedLevels.push(level.id);
    } else solvedCount++;
    continue;
  }

  if (level.type === "create") {
    const combo = findCreateCombo(level);
    if (!combo) {
      fail(`${level.id}（出题关）菜单里没有任何成立的组合 —— 孩子怎么试都过不去`);
      failedLevels.push(level.id);
      continue;
    }
    const poolChips = [...doc.querySelectorAll("#create-pool .create-chip")];
    combo.givens.forEach((i) => click(poolChips[i]));
    const goalChips = [...doc.querySelectorAll("#create-goals .create-chip")];
    click(goalChips[combo.goal]);
    click($("btn-create-check"));
    const fb = $("create-feedback");
    if (fb.hidden || !fb.classList.contains("good")) {
      fail(`${level.id}（出题关）按测试算出的成立组合去点，却没判「成立」`);
      failedLevels.push(level.id);
      continue;
    }
    if ($("create-play").hidden) {
      fail(`${level.id} 判定成立之后没出现「继续」按钮`);
      failedLevels.push(level.id);
      continue;
    }

    // ★ 回归：点「做做看我出的题」，必须能拿到方法卡。
    //   临时关卡的 id 不在关卡表里，以前 tacticsForLevel 返回空集合，
    //   孩子会进到一张卡都没有的关卡，根本玩不了。
    const tryBtn = [...doc.querySelectorAll("#create-play button")].find((b) =>
      b.textContent.includes("做做看")
    );
    if (!tryBtn) {
      fail(`${level.id} 没有「做做看我出的题」按钮`);
      failedLevels.push(level.id);
      continue;
    }
    click(tryBtn);
    const customCards = doc.querySelectorAll("#card-palette .card").length;
    if (!customCards) {
      fail(`${level.id} 点「做做看我出的题」之后方法卡一张都没有`);
      failedLevels.push(level.id);
      continue;
    }
    ok(`${level.id} 做自己出的题时能拿到 ${customCards} 张方法卡`);

    // 「做做看」是加分项，不算这一关的通关 —— 回来重新走一遍再收工
    gotoLevel(level.id);
    const pool2 = [...doc.querySelectorAll("#create-pool .create-chip")];
    combo.givens.forEach((i) => click(pool2[i]));
    const goals2 = [...doc.querySelectorAll("#create-goals .create-chip")];
    click(goals2[combo.goal]);
    click($("btn-create-check"));
    if (!$("create-feedback").classList.contains("good")) {
      fail(`${level.id} 重新走一遍出题流程时没判成立`);
      failedLevels.push(level.id);
      continue;
    }
    const fin = [...doc.querySelectorAll("#create-play button")].find((b) =>
      b.textContent.includes("收工")
    );
    if (!fin) {
      fail(`${level.id} 没有「收工」按钮`);
      failedLevels.push(level.id);
      continue;
    }
    click(fin);
    if ($("screen-done").hidden) {
      fail(`${level.id}（出题关）没走到完成页`);
      failedLevels.push(level.id);
    } else solvedCount++;
    continue;
  }

  // ---- 证明关：必须用「这一关已解锁的卡片」求解 ----
  // 否则求解器可能挑一张孩子那时还没有的卡，测试就会去点界面上不存在的按钮。
  // 这也正是小朋友的真实处境，所以这样测才对。
  const sol = E.solve(E.initialState(level.givensF, level.goalF, level.rulesF), {
    maxDepth: 16,
    maxNodes: 120000,
    only: LV.tacticsForLevel(level.id),
  });
  if (!sol) {
    fail(`${level.id} 求解器找不到证明`);
    failedLevels.push(level.id);
    continue;
  }

  let cur = E.initialState(level.givensF, level.goalF, level.rulesF);
  let died = null;

  for (const step of sol.path) {
    const tactic = E.TACTIC_MAP[step.tactic];
    const goal = E.focused(cur);

    const cardBtn = [...doc.querySelectorAll("#card-palette .card")].find(
      (b) =>
        b.textContent.includes(tactic.card.name) &&
        !b.classList.contains("disabled")
    );
    if (!cardBtn) {
      died = `界面上找不到可用的方法卡「${tactic.card.name}」`;
      break;
    }
    click(cardBtn);

    for (const pickId of step.picks) {
      if (tactic.pickKind === "formula") {
        const cands = E.candidates(goal, tactic, []);
        const ci = cands.findIndex((x) => x.id === pickId);
        const chips = [...doc.querySelectorAll("#formula-picker .formula-chip")];
        if (ci < 0 || !chips[ci]) { died = `公式选择器里找不到第 ${ci + 1} 个候选`; break; }
        click(chips[ci]);
      } else {
        const el = doc.querySelector(`[data-hyp="${pickId}"]`);
        if (!el) { died = `界面上找不到线索 ${pickId}`; break; }
        click(el);
      }
    }
    if (died) break;
    cur = E.applyMove(cur, step.tactic, step.picks).state;
  }

  if (died) {
    fail(`${level.id} 界面操作失败：${died}`);
    failedLevels.push(level.id);
    continue;
  }
  if ($("screen-done").hidden) {
    fail(`${level.id} 走完路线却没通关`);
    failedLevels.push(level.id);
  } else solvedCount++;
}

if (solvedCount === LV.LEVELS.length)
  ok(`全部 ${LV.LEVELS.length} 关都能在界面上点通`);
else
  fail(`${solvedCount} / ${LV.LEVELS.length} 关通关，失败的：${failedLevels.join("、")}`);

{
  const shouldIntroduce = LV.LEVELS.filter(
    (l) => l.type === "proof" && (l.newCards || []).length
  ).length;
  if (introShown !== shouldIntroduce)
    fail(`新道具介绍弹了 ${introShown} 次，应该有 ${shouldIntroduce} 次`);
  else ok(`每一关的新道具都先介绍过（${introShown} 次）`);
}

console.log("\n--- 4. 撤销 / 重来 / 提示 ---");
try {
  const lv = LV.LEVELS.find(
    (l) => l.type === "proof" && l.givens.length >= 2 && l.world === "chain"
  );
  gotoLevel(lv.id);
  const before = doc.querySelectorAll("#clue-list .clue").length;
  const card = [...doc.querySelectorAll("#card-palette .card")].find((b) =>
    b.textContent.includes(E.TACTIC_MAP["mp"].card.name)
  );
  click(card);
  click([...doc.querySelectorAll("#clue-list .clue")][0]);
  click([...doc.querySelectorAll("#clue-list .clue")][1]);
  const after = doc.querySelectorAll("#clue-list .clue").length;
  if (after <= before) fail(`串起来后线索应该变多（${before} → ${after}）`);
  else ok(`推理一步：线索 ${before} → ${after} 条`);

  if ($("btn-undo").disabled) fail("撤销按钮应该是可用的");
  click($("btn-undo"));
  const undone = doc.querySelectorAll("#clue-list .clue").length;
  if (undone !== before) fail(`撤销后应回到 ${before} 条，实际 ${undone} 条`);
  else ok("撤销恢复正常");

  click($("btn-hint"));
  if ($("feedback").hidden || !$("feedback").textContent.trim())
    fail("点提示没有显示内容");
  else ok("提示按钮正常：" + $("feedback").textContent.trim().slice(0, 24) + "…");

  click($("btn-reset"));
  if (doc.querySelectorAll("#clue-list .clue").length !== before)
    fail("重来没有恢复初始状态");
  else ok("重来按钮正常");
} catch (e) {
  fail("按钮测试异常：" + e.message);
}

console.log("\n--- 4b. 武器库 ---");
try {
  backToHome();
  if (!$("inventory").hidden) fail("武器库默认应该是关着的");
  click($("btn-inventory"));
  if ($("inventory").hidden) {
    fail("点 🎒 打不开武器库");
  } else {
    const cardItems = [...doc.querySelectorAll("#inv-body .inv-item[data-card]")];
    if (cardItems.length !== E.TACTICS.length)
      fail(`武器库里方法卡 ${cardItems.length} 张，应该是 ${E.TACTICS.length} 张`);
    else ok(`武器库列出全部 ${cardItems.length} 张方法卡`);

    const unlocked = cardItems.filter((x) => !x.classList.contains("locked"));
    const locked = cardItems.filter((x) => x.classList.contains("locked"));
    if (!unlocked.length) fail("全部通关后不该还有锁着的方法卡");
    else if (locked.length) fail(`还锁着 ${locked.length} 张，但已经全部通关了`);
    else ok(`${unlocked.length} 张方法卡全部解锁`);

    const incomplete = unlocked.filter(
      (x) => !x.textContent.includes("什么时候用") || !x.textContent.includes("🔎")
    );
    if (incomplete.length)
      fail(`${incomplete.length} 张已解锁的卡缺少「什么时候用」或例子`);
    else ok("每张卡都有「什么时候用」和一个例子");

    const symTab = [...doc.querySelectorAll(".inv-tab")].find(
      (b) => b.dataset.tab === "symbols"
    );
    click(symTab);
    const symItems = [...doc.querySelectorAll("#inv-body .inv-item[data-symbol]")];
    if (symItems.length !== LV.SYMBOLS.length)
      fail(`符号页列出 ${symItems.length} 个，应该是 ${LV.SYMBOLS.length} 个`);
    else ok(`符号页列出 ${symItems.length} 个符号`);

    click($("btn-close-inventory"));
    if (!$("inventory").hidden) fail("武器库关不掉");
    else ok("武器库能正常关闭");
  }
} catch (e) {
  fail("武器库测试异常：" + e.message);
}

console.log("\n--- 5. 进度保存 ---");
try {
  const raw = window.localStorage.getItem("logic-detective-v2");
  if (!raw) fail("进度没有写进 localStorage");
  else {
    const sv = JSON.parse(raw);
    const n = Object.keys(sv.solved || {}).length;
    if (n !== LV.LEVELS.length) fail(`存档里 ${n} 关，应该 ${LV.LEVELS.length} 关`);
    else ok(`存档完整：${n} 关全部记录在案`);
  }
} catch (e) {
  fail("读存档异常：" + e.message);
}

console.log("\n--- 6. 复习模式（间隔重复）---");
{
  // 造一个「昨天就该复习了」的存档，重新起一个页面，看复习按钮会不会自己冒出来。
  // 不能靠改已有页面的 localStorage —— app.js 在**解析时**就把存档读进去了。
  const DAY = 24 * 60 * 60 * 1000;
  const target = "intro-q1";

  async function boot(fill) {
    const d = new JSDOM(html, {
      runScripts: "dangerously",
      pretendToBeVisual: true,
      url: "http://127.0.0.1:4173/",
      virtualConsole: new VirtualConsole(),
    });
    const w = d.window;
    w.scrollTo = () => {};
    w.localStorage.setItem("logic-detective-v2", JSON.stringify(fill));
    for (const f of ["js/logic.js", "js/engine.js", "js/levels.js", "js/app.js"]) {
      const s = w.document.createElement("script");
      s.textContent = await readFile(join(GAME, f), "utf8");
      w.document.body.appendChild(s);
    }
    return { w, d: w.document };
  }

  // 全部通关 + 其中一关昨天到期
  const allSolved = {};
  for (const l of LV.LEVELS) allSolved[l.id] = Date.now() - 40 * DAY;
  const { w, d } = await boot({
    solved: allSolved,
    review: { [target]: { box: 2, due: Date.now() - DAY } },
    seenCards: {},
    settings: {},
  });
  const btnReview = d.getElementById("btn-review");
  if (!btnReview) fail("首页没有复习按钮");
  else if (btnReview.hidden) fail("有到期的复习，按钮却没出现");
  else {
    ok(`复习按钮出现：「${btnReview.textContent.trim()}」`);
    if (!btnReview.textContent.includes("1")) fail("按钮没显示到期的关数");
    btnReview.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
    if (d.getElementById("screen-level").hidden) fail("点复习没有进入关卡");
    else ok("点复习能进入该复习的关卡");
    const raw = JSON.parse(w.localStorage.getItem("logic-detective-v2"));
    if (!raw.review || !raw.review[target]) fail("复习排期丢了");
    else ok(`复习排期还在（box=${raw.review[target].box}）`);
  }

  // 还没到期时，按钮必须藏着 —— 否则会一直打扰孩子
  const later = await boot({
    solved: {},
    review: { [target]: { box: 1, due: Date.now() + 5 * DAY } },
    seenCards: {},
    settings: {},
  });
  if (!later.d.getElementById("btn-review").hidden)
    fail("还没到复习时间，按钮却显示出来了");
  else ok("没到期的复习不会打扰孩子");

  // 从没玩过的新存档，也不该出现复习按钮
  const blank = await boot({ solved: {}, review: {}, seenCards: {}, settings: {} });
  if (!blank.d.getElementById("btn-review").hidden)
    fail("全新存档不该有复习按钮");
  else ok("全新存档没有复习按钮");
}

console.log("\n--- 7. 课程模式（先复习，再学新内容）---");
{
  const DAY = 24 * 60 * 60 * 1000;
  const click2 = (w, el) =>
    el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true }));

  // 前 3 课已通关，然后开始第 4 课
  const solved = {};
  for (const l of LV.LESSONS.slice(0, 3))
    for (const id of l.levels) solved[id] = Date.now() - 20 * DAY;

  const d0 = new JSDOM(html, {
    runScripts: "dangerously",
    pretendToBeVisual: true,
    url: "http://127.0.0.1:4173/",
    virtualConsole: new VirtualConsole(),
  });
  const w = d0.window;
  w.scrollTo = () => {};
  w.localStorage.setItem(
    "logic-detective-v2",
    JSON.stringify({ solved, review: {}, seenCards: {}, settings: {} })
  );
  for (const f of ["js/logic.js", "js/engine.js", "js/levels.js", "js/app.js"]) {
    const s = w.document.createElement("script");
    s.textContent = await readFile(join(GAME, f), "utf8");
    w.document.body.appendChild(s);
  }
  const d = w.document;

  click2(w, d.getElementById("btn-lessons"));
  const cards = [...d.querySelectorAll("#lesson-list .lesson-card")];
  if (cards.length !== LV.LESSONS.length) fail(`学习路线只列出 ${cards.length} 课`);
  else {
    if (cards[0].querySelector(".fl.review"))
      fail("第 1 课不该安排复习（前面没有内容）");
    else ok("第 1 课不安排复习");

    const revChip = cards[3].querySelector(".fl.review");
    if (!revChip) fail("第 4 课的卡片上没标出要复习");
    else ok(`第 4 课的卡片上标出了要复习：${revChip.textContent.trim()} 关`);

    // 每张卡都要画出「这一课怎么走」的流程（复习 → 讲 → 练 → 测 → …）
    const noFlow = cards.filter((c) => !c.querySelector(".lc-flow"));
    if (noFlow.length) fail(`${noFlow.length} 课没显示流程`);
    else ok("每一课都画出了「这一课怎么走」");

    // 流程里的图标要能对上关卡类型：
    // 第 5 课「串线索（进阶）」有 练 + 讲解 + 补理由 + 小结 + 出题
    const f5 = cards[4].querySelector(".lc-flow").textContent;
    for (const icon of ["✏️", "🕵️", "🧾", "🎓", "🎨"])
      if (!f5.includes(icon))
        fail(`第 5 课的流程里没有 ${icon}：「${f5.trim()}」`);
    ok(`第 5 课的流程：${f5.trim().replace(/\s+/g, " ")}`);

    click2(w, cards[3]);
    const banner = d.getElementById("course-banner");
    if (banner.hidden) fail("进入课程后没显示进度条");
    else if (!banner.textContent.includes("复习"))
      fail("开始新课应该**先**复习，实际显示：" + banner.textContent.trim());
    else ok("开始新课时先进入复习：" + banner.textContent.trim());

    // 把实际打开的关卡标题取出来，确认它是**前面课**的内容
    const VIEWS = {
      "teach-view": "teach-title",
      "proof-view": "proof-title",
      "quiz-view": "quiz-title",
      "summary-view": "summary-title",
      "create-view": "create-title",
    };
    const shown = Object.keys(VIEWS).find((v) => !d.getElementById(v).hidden);
    const title = shown
      ? d.getElementById(VIEWS[shown]).textContent.trim()
      : "";
    const earlier = LV.LESSONS.slice(0, 3)
      .flatMap((l) => l.levels)
      .map((id) => LV.findLevel(id).title);
    if (!earlier.includes(title))
      fail(`先复习时打开的「${title}」不是前面课的内容`);
    else ok(`复习的确实是前面的关卡：「${title}」`);
  }
}

console.log("\n--- 8. 全程 JS 报错检查 ---");
if (errors.length) fail("运行期间有报错：\n     " + errors.slice(0, 6).join("\n     "));
else ok("整个流程零 JS 报错");

console.log("\n" + "=".repeat(52));
console.log(fails === 0 ? "✅ 界面端到端测试全部通过" : `❌ ${fails} 项失败`);
process.exitCode = fails === 0 ? 0 : 1;
