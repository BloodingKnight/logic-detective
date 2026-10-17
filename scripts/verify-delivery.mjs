/**
 * 交付验收脚本：确认正在运行的服务器提供的，确实是修好之后的最新版本。
 * （缓存、忘记重启、改错文件 —— 这些都会让「本地明明修好了」变成假象。）
 */
const BASE = process.env.BASE || "http://127.0.0.1:4173";

const checks = [];
const check = (name, cond) => checks.push({ name, ok: !!cond });

async function get(path) {
  const r = await fetch(BASE + path);
  return { status: r.status, text: await r.text() };
}

const page = await get("/");
const css = await get("/css/style.css");
const logic = await get("/js/logic.js");
const engine = await get("/js/engine.js");
const levels = await get("/js/levels.js");
const app = await get("/js/app.js");
const readme = await get("/README.md");

check("首页 200", page.status === 200);
check("CSS 200", css.status === 200);
check("四个脚本都 200", [logic, engine, levels, app].every((r) => r.status === 200));

// --- 这一轮修掉的问题，逐一确认已经上线 ---
check(
  "① [hidden] 被 CSS 盖掉的弹窗问题已修",
  css.text.includes("[hidden] { display: none !important; }")
);
check(
  "② 儿童友好括号（∧ 在 ∨ 里加括号）已上线",
  logic.text.includes("function orOperand") &&
    logic.text.includes('x.k === "and" ? "(" + show(x) + ")"')
);
check(
  "③ → 的两边加括号已上线",
  logic.text.includes("function impOperand")
);
check(
  "④ 界面渲染与 show() 括号规则一致",
  app.text.includes("function orOperandHtml")
);
check(
  "⑤ 方法卡「能用的排前面」已上线",
  app.text.includes("a.usable ? -1 : 1")
);
check(
  "⑥ 假设块里的假设可点击（共用同一套线索渲染）",
  app.text.includes("div.dataset.hyp = h.id") &&
    app.text.includes("assumeBox.appendChild(makeClueNode(h,")
);
check(
  "⑦ 空的案情简介会隐藏",
  app.text.includes('$("proof-brief").hidden = !brief') &&
    app.text.includes('$("quiz-brief").hidden = !qBrief')
);
check(
  "⑧ 通关时不再空渲染（修掉 focused() 为 undefined 的崩溃）",
  app.text.includes("if (!goal) return; // 已经全部证完")
);

// --- 内容规模 ---
const levelIds = [...levels.text.matchAll(/id:\s*"([a-z][a-z-]*-(?:t|q|l)\d+)"/g)].map(
  (m) => m[1]
);
check("关卡数量 = 68", levelIds.length === 68);
check(
  "世界数量 = 9",
  (levels.text.match(/id: "[a-z-]+",\n\s+name: "/g) || []).length === 9
);
check(
  "世界按内容顺序排列（等式在最前，说谎岛压轴）",
  (() => {
    const order = [...levels.text.matchAll(/世界：\S+ \(([a-z-]+)\)/g)].map((m) => m[1]);
    return (
      order.join(",") ===
      "intro,equality,chain,both,either,numbers,assumption,sets,knights"
    );
  })()
);
check(
  "等式推理已接入（项 / 等式 / 改写）",
  logic.text.includes("computeTerm") &&
    logic.text.includes("equation") &&
    engine.text.includes("rewriteTermAll") &&
    engine.text.includes("matchTerm")
);
check(
  "先教后考：有介绍关（type: teach）",
  (levels.text.match(/type: "teach"/g) || []).length >= 5
);
check(
  "每个符号都有介绍页（∧ ∨ ¬ → ⊥）",
  ["intro-t1", "intro-t2", "intro-t3", "intro-t4", "assumption-t1"].every((id) =>
    levelIds.includes(id)
  )
);
check(
  "武器库数据齐备（每张卡什么时候用 + 例子）",
  levels.text.includes("CARD_GUIDE") && levels.text.includes("CARD_GROUPS")
);
check(
  "数字世界有真证明关（不只是选择题）",
  levelIds.includes("numbers-l1") && levelIds.includes("numbers-l3")
);
check(
  "集合世界有真证明关",
  levelIds.includes("sets-l1") && levelIds.includes("sets-l2")
);
check(
  "求解器分趟结构正确（排中律不在最贵的第一趟里）",
  engine.text.includes('new Set(["have", "lem"])')
);

// --- 内核规则 ---
const tacticIds = [...engine.text.matchAll(/^\s{6}id: "([a-z][A-Za-z]+)",$/gm)].map((m) => m[1]);
check("证明内核方法卡 >= 13 张", tacticIds.length >= 13);
check("有「一分为二」（排中律）", tacticIds.includes("lem"));
check("有「先立个小目标」（引理）", tacticIds.includes("have"));
check("有「反证法」", tacticIds.includes("raa"));

check("中文 README 已就位", readme.status === 200 && readme.text.includes("逻辑小侦探"));

// ---------------------------------------------------------------- 输出

let bad = 0;
for (const c of checks) {
  console.log((c.ok ? "  ok   " : "  ❌   ") + c.name);
  if (!c.ok) bad++;
}
console.log(
  "\n" +
    (bad === 0
      ? `✅ 交付验收全部通过（${checks.length} 项）`
      : `❌ ${bad} / ${checks.length} 项未通过`)
);
// 用 exitCode 而不是 process.exit()：直接退出会在 Windows 上留下
// libuv 的 UV_HANDLE_CLOSING 断言噪音，看着像出了错，其实没有。
process.exitCode = bad === 0 ? 0 : 1;
