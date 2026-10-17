/**
 * 真实浏览器截图工具（开发用，不属于游戏本体）。
 *
 * 为什么需要它：jsdom 能验证「逻辑和流程对不对」，但它**不做 CSS 布局**，
 * 所以「弹窗没关掉」「按钮叠在一起」这类问题它一个都发现不了。
 * 这个脚本用真的 Chrome 渲染页面并截图，用来肉眼检查视觉效果。
 *
 *   node scripts/shots.mjs
 */
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const WS = join(HERE, "..");
const GAME = join(WS, "logic-detective");
const OUT = join(WS, ".shots");

const CHROME =
  process.env.CHROME ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const PORT = process.env.PORT || 4173;
const BASE = `http://127.0.0.1:${PORT}`;

// ---------------------------------------------------------------- 注入脚本
//
// 往 index.html 里塞一段脚本，让页面自动走到想截图的画面。
// 流程完全靠「模拟真实点击」，和小朋友玩的时候走的是同一条路径。

// 注意：这段必须插在 app.js **之前**。
// app.js 在脚本解析时就会执行 `let save = loadSave()`，
// 之后再写 localStorage 就晚了 —— 页面已经拿着空存档渲染过了。
const SEED = `
<script>
(function () {
  var q = new URLSearchParams(location.search);
  // solve=both-l5 表示「把这一关（含）之前的全部标记为已完成」
  var upto = q.get('solve') || q.get('level');
  if (!upto) return;
  var LD = window.LD;
  var lv = LD.LEVELS.filter(function (l) { return l.id === upto; })[0];
  if (!lv) return;
  var idx = LD.LEVELS.indexOf(lv);
  var solved = {};
  for (var i = 0; i <= idx; i++) solved[LD.LEVELS[i].id] = true;
  try {
    localStorage.setItem('logic-detective-v2', JSON.stringify({
      solved: solved,
      seenCards: {},
      settings: { highlight: true, sound: false, legend: true }
    }));
  } catch (e) {}
})();
</script>
`;

const HARNESS = `
<script>
(function () {
  var q = new URLSearchParams(location.search);
  var target = q.get('level');
  var wantModal = q.get('modal') !== null;
  var wantInv = q.get('inv') !== null;
  var keepIntro = q.get('intro') === 'show';
  if (!target && !wantModal && !wantInv) return;
  var LD = window.LD;
  var lv = target
    ? LD.LEVELS.filter(function (l) { return l.id === target; })[0]
    : null;
  if (target && !lv) return;

  function findCard(name) {
    return [].slice.call(document.querySelectorAll('#card-palette .card'))
      .filter(function (b) {
        return b.textContent.indexOf(name) >= 0 && !b.classList.contains('disabled');
      })[0];
  }

  function act() {
    var cards = document.querySelectorAll('.world-card');
    if (!cards.length) return false;

    // 只截武器库 / 设置弹层
    if (!lv) {
      var btn = document.getElementById(wantInv ? 'btn-inventory' : 'btn-settings');
      if (!btn) return false;
      btn.click();
      return true;
    }

    cards[LD.WORLD_INDEX[lv.world]].click();

    var inWorld = LD.LEVELS.filter(function (l) { return l.world === lv.world; });
    var items = document.querySelectorAll('.level-item');
    if (!items.length) return false;
    items[inWorld.indexOf(lv)].click();

    // 「新道具介绍」弹层：除非特意要截它，否则先关掉
    var introEl = document.getElementById('card-intro');
    if (introEl && !introEl.hidden) {
      if (keepIntro) return true;
      document.getElementById('btn-card-intro-ok').click();
    }

    if (lv.type === 'quiz') {
      if (q.get('answer') !== null) {
        var want = lv.options.findIndex(function (o) { return o.correct; });
        var opts = document.querySelectorAll('.quiz-option');
        if (opts[want]) opts[want].click();
      }
      if (q.get('wrong') !== null) {
        var bad = lv.options.findIndex(function (o) { return !o.correct; });
        var opts2 = document.querySelectorAll('.quiz-option');
        if (opts2[bad]) opts2[bad].click();
      }
      return true;
    }

    var steps = parseInt(q.get('steps') || '0', 10);
    if (steps > 0) {
      var sol = LD.solve(LD.initialState(lv.givensF, lv.goalF), { maxDepth: 16, maxNodes: 120000 });
      if (sol) {
        var cur = LD.initialState(lv.givensF, lv.goalF);
        for (var k = 0; k < Math.min(steps, sol.path.length); k++) {
          var step = sol.path[k];
          var tactic = LD.TACTIC_MAP[step.tactic];
          var goal = LD.focused(cur);
          var card = findCard(tactic.card.name);
          if (!card) break;
          card.click();
          var good = true;
          for (var j = 0; j < step.picks.length; j++) {
            var pid = step.picks[j];
            if (tactic.pickKind === 'formula') {
              var cands = LD.candidates(goal, tactic, []);
              var ci = -1;
              for (var m = 0; m < cands.length; m++) if (cands[m].id === pid) ci = m;
              var chips = document.querySelectorAll('#formula-picker .formula-chip');
              if (ci < 0 || !chips[ci]) { good = false; break; }
              chips[ci].click();
            } else {
              var el = document.querySelector('[data-hyp="' + pid + '"]');
              if (!el) { good = false; break; }
              el.click();
            }
          }
          if (!good) break;
          cur = LD.applyMove(cur, step.tactic, step.picks).state;
          if (LD.isSolved(cur)) break;
        }
      }
    }

    // 停在「正在选线索」的状态，展示高亮效果
    var pick = q.get('pick');
    if (pick) {
      var c = findCard(pick);
      if (c) c.click();
    }
    return true;
  }

  // 轮询等待应用启动完成。不用 load 事件 —— 在 Chrome 的虚拟时间模式下
  // load 的时序不可靠，会让截图拍到还没导航的首页。
  var tries = 0;
  (function wait() {
    if (act() || ++tries > 400) return;
    setTimeout(wait, 15);
  })();
})();
</script>
`;

// ---------------------------------------------------------------- 截图清单

const SHOTS = [
  { name: "01-home", q: "" },
  { name: "02-world", q: "level=chain-l1" },
  { name: "03-proof-empty", q: "level=chain-l1" },
  { name: "04-proof-steps", q: "level=chain-l2&steps=2" },
  { name: "05-proof-picking", q: "level=both-l3&steps=1&pick=合起来" },
  { name: "06-proof-assume", q: "level=assumption-l6&steps=2" },
  { name: "07-proof-knights", q: "level=knights-l5&steps=1" },
  { name: "08-quiz", q: "level=intro-q1" },
  { name: "09-quiz-feedback", q: "level=intro-q1&wrong=1" },
  { name: "10-quiz-done", q: "level=numbers-q4&answer=1" },
  { name: "11-settings", q: "modal=1" },
  { name: "12-number-proof", q: "level=numbers-l3&steps=1" },
  { name: "13-set-proof", q: "level=sets-l1&steps=1" },
  { name: "17-equality-rule", q: "level=equality-l4&steps=1" },
  { name: "18-peano", q: "level=numbers-l5&steps=2" },
  { name: "20-induction", q: "level=python-l4&pick=归纳法" },
  { name: "14-teach-symbol", q: "level=intro-t4" },
  { name: "15-card-intro", q: "level=either-l3&intro=show" },
  { name: "16-inventory", q: "inv=1&solve=both-l5" },
];

// ---------------------------------------------------------------- 执行

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const html = await readFile(join(GAME, "index.html"), "utf8");
const injected = html
  .replace('<script src="js/app.js"></script>', SEED + '<script src="js/app.js"></script>')
  .replace("</body>", HARNESS + "</body>");
const shotFile = join(GAME, "_shot.html");
await writeFile(shotFile, injected, "utf8");

function shoot(name, url) {
  return new Promise((resolve) => {
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      // 每张图用独立的 profile：共用 profile 时 Chrome 会把新请求塞进已有进程，
      // 截图就会拍到上一个页面（踩过这个坑）。
      `--user-data-dir=${join(OUT, "profile-" + name)}`,
      "--window-size=1280,1100",
      "--virtual-time-budget=8000",
      `--screenshot=${join(OUT, name + ".png")}`,
      url,
    ];
    const p = spawn(CHROME, args, { stdio: "ignore" });
    p.on("exit", () => setTimeout(resolve, 250));
    p.on("error", (e) => {
      console.log("  启动浏览器失败：" + e.message);
      resolve();
    });
  });
}

console.log("\n开始截图（真实 Chrome 渲染）…\n");
for (const s of SHOTS) {
  const url = `${BASE}/_shot.html${s.q ? "?" + s.q : ""}`;
  await shoot(s.name, url);
  console.log("  ✓ " + s.name);
}

await rm(shotFile, { force: true });
console.log(`\n截图已保存到 ${OUT}\n`);
