/*!
 * 《逻辑小侦探》— 界面与流程
 *
 * 这一层只负责「怎么呈现」和「怎么走流程」，一点逻辑判断都不做。
 * 所有推理都交给 engine.js 的真实证明内核，界面只是它的一个友好外壳。
 */
(function () {
  "use strict";

  const L = window.LD;
  const $ = (id) => document.getElementById(id);

  // ============================================================ 小工具

  const esc = (s) =>
    String(s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );

  /** 极简 markdown：只支持 **粗体** 和 `代码`，以及空行分段。 */
  function inlineMd(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/`(.+?)`/g, "<code>$1</code>");
  }
  function mdToHtml(src) {
    return String(src || "")
      .split("\n")
      .map((line) =>
        line.trim() === "" ? '<div class="sp"></div>' : "<p>" + inlineMd(line) + "</p>"
      )
      .join("");
  }

  // 逻辑符号的颜色编码渲染。
  // 括号规则必须和 logic.js 的 show() **完全一致** ——
  // 不一致的话，同一个公式在「目标框」和「推理记录」里会长得不一样，
  // 孩子会以为它们是两个东西。ui.mjs 里有一条测试专门盯着这件事。
  const PREC = { imp: 1, or: 2, and: 3, not: 4, atom: 5, false: 5 };

  /** ∨ 的操作数：是 ∧ 就补一层括号 */
  function orOperandHtml(x) {
    return x.k === "and" ? "(" + fhtml(x, 0, false) + ")" : fhtml(x, 2, false);
  }
  /** → 的操作数：只要是复合公式就补括号 */
  function impOperandHtml(x) {
    return "(" + fhtml(x, 0, false) + ")";
  }

  // 算式的 HTML 渲染。括号规则必须和 logic.js 的 showTerm 一致：
  // 同级的 + 要加括号（(x+1)+0），succ 套 succ 也要（succ (succ 0)）——
  // 因为孩子改写时操作的正是结构，省掉括号就看不出来该换哪一块。
  const TPREC = { add: 1, mul: 2, succ: 3, num: 4, var: 4 };
  function htmlTerm(t, minPrec) {
    let s;
    switch (t.t) {
      case "num":
        s = esc(String(t.n));
        break;
      case "var":
        s = '<span class="atom">' + esc(t.name) + "</span>";
        break;
      case "succ":
        s = '<span class="op op-imp">succ</span> ' + htmlTerm(t.a, 4);
        break;
      case "add":
        s =
          htmlTerm(t.a, 2) +
          ' <span class="op op-and">+</span> ' +
          htmlTerm(t.b, 2);
        break;
      case "mul":
        s =
          htmlTerm(t.a, 3) +
          ' <span class="op op-or">×</span> ' +
          htmlTerm(t.b, 3);
        break;
      default:
        s = "?";
    }
    if ((TPREC[t.t] || 0) < (minPrec || 0)) return "(" + s + ")";
    return s;
  }

  function fhtml(f, minPrec, strict) {
    // 归纳法的变量选择器会把「项」当候选递进来，这里要能接住
    if (f && f.t !== undefined) return htmlTerm(f, minPrec || 0);
    const p = PREC[f.k] || 0;
    let inner;
    switch (f.k) {
      case "atom":
        inner = '<span class="atom">' + esc(f.name) + "</span>";
        break;
      case "false":
        inner = '<span class="op op-false">⊥</span>';
        break;
      case "eq":
        // 等式：等号两边各是一个算式
        inner =
          htmlTerm(f.a, 0) + ' <span class="op op-imp">=</span> ' + htmlTerm(f.b, 0);
        break;
      case "not":
        inner = '<span class="op op-not">¬</span>' + fhtml(f.a, 4, false);
        break;
      case "and":
        inner =
          fhtml(f.a, 3, false) +
          ' <span class="op op-and">∧</span> ' +
          fhtml(f.b, 3, false);
        break;
      case "or":
        inner =
          orOperandHtml(f.a) +
          ' <span class="op op-or">∨</span> ' +
          orOperandHtml(f.b);
        break;
      case "imp":
        inner =
          (f.a.k === "and" || f.a.k === "or" || f.a.k === "imp"
            ? "(" + fhtml(f.a, 0, false) + ")"
            : fhtml(f.a, 0, false)) +
          ' <span class="op op-imp">→</span> ' +
          (f.b.k === "and" || f.b.k === "or" || f.b.k === "imp"
            ? "(" + fhtml(f.b, 0, false) + ")"
            : fhtml(f.b, 0, false));
        break;
      default:
        inner = "?";
    }
    if (p < minPrec || (strict && p === minPrec))
      return '<span class="paren">(</span>' + inner + '<span class="paren">)</span>';
    return inner;
  }
  const fshow = (f) => fhtml(f, 0, false);

  const TONES = {
    green: "#16a34a",
    blue: "#2563eb",
    orange: "#ea580c",
    purple: "#9333ea",
    red: "#dc2626",
  };

  // ============================================================ 音效

  let audioCtx = null;
  function beep(freqs, dur) {
    if (!save.settings.sound) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = audioCtx || new AC();
      if (audioCtx.state === "suspended") audioCtx.resume();
      freqs.forEach((f, i) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = "sine";
        o.frequency.value = f;
        const t0 = audioCtx.currentTime + i * dur;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.012);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g);
        g.connect(audioCtx.destination);
        o.start(t0);
        o.stop(t0 + dur + 0.03);
      });
    } catch (e) {
      /* 没声音也照样玩 */
    }
  }
  const sfxStep = () => beep([720], 0.09);
  const sfxWin = () => beep([523, 659, 784, 1047], 0.135);
  const sfxOops = () => beep([240, 190], 0.13);
  const sfxClick = () => beep([520], 0.06);

  // ============================================================ 进度存档

  // 存档键带版本号。世界重排时关卡 id 换过（w6-l1 → numbers-l1），
  // 旧存档里的 id 一个都对不上，所以直接换键名，让旧数据自然作废，
  // 而不是留下一个「进度看起来丢了但其实是 id 不匹配」的糊涂状态。
  const STORE_KEY = "logic-detective-v2";

  function defaultSave() {
    return {
      solved: {},
      // 间隔重复的排期：{ 关卡id: { box: 第几轮, due: 下次该复习的时间戳 } }
      // 单独存一份而不是塞进 solved，是为了让老存档还能用（solved 里以前是 true）。
      review: {},
      // 小结页里孩子自己写的话（"用自己的话说一遍"）。不判对错，存下来给家长看。
      notes: {},
      // 已经介绍过的方法卡。用来决定「新道具介绍」要不要弹，
      // 也决定武器库里哪些是亮的、哪些还锁着。
      seenCards: {},
      settings: { highlight: true, sound: true, legend: true },
    };
  }

  function loadSave() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaultSave();
      const parsed = JSON.parse(raw);
      const d = defaultSave();
      return {
        solved: parsed.solved || {},
        review: parsed.review || {},
        notes: parsed.notes || {},
        seenCards: parsed.seenCards || {},
        settings: Object.assign(d.settings, parsed.settings || {}),
      };
    } catch (e) {
      return defaultSave();
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(save));
    } catch (e) {
      /* 隐私模式下存不了也无所谓，这次能玩就行 */
    }
  }

  let save = loadSave();

  // ============================================================ 间隔重复
  //
  // 遗忘是正常的。要记住，就得在「马上要忘」的时候再见一次面。
  // 这里用的是 Leitner 盒子：答对一次，下次复习推得更远；答错就退回第一格。
  //
  // 教学上比这更重要的一点：**复习的时候不给提示**。给提示就成了「认字」，
  // 而不是「回忆」——只有真正从脑子里拽出来，记忆才会被加固。

  const REVIEW_GAPS = [1, 3, 7, 14, 30]; // 每轮之后隔几天
  const DAY = 24 * 60 * 60 * 1000;
  const REVIEW_BATCH = 5; // 一次最多复习几关，别把孩子吓跑

  /** 把某一关排进复习计划（box 从 1 开始） */
  function scheduleReview(levelId, box) {
    const b = Math.max(1, Math.min(REVIEW_GAPS.length, box));
    save.review[levelId] = { box: b, due: Date.now() + REVIEW_GAPS[b - 1] * DAY };
  }

  /** 复习完之后更新排期：答对升一格，答错退回第一格 */
  function bumpReview(levelId, gotIt) {
    const cur = save.review[levelId];
    scheduleReview(levelId, gotIt ? (cur ? cur.box : 0) + 1 : 1);
  }

  /** 现在该复习哪些关（到期的），最该复习的排前面 */
  function dueReviews() {
    const now = Date.now();
    return Object.keys(save.review)
      .filter((id) => L.findLevel(id) && save.review[id].due <= now)
      .sort((a, b) => save.review[a].due - save.review[b].due);
  }

  /** 复习队列：点了「复习」之后依次要过的几关 */
  let reviewQueue = [];
  /** 这一轮复习有没有用过提示（用过就不算「自己想起来了」） */
  let reviewUsedHint = false;

  // ============================================================ 课程模式
  //
  // 一「课」不只是「学新东西」。它是这个顺序：
  //
  //   ① 复习前面学过的   ← 每课开头，趁记忆还热，先提取一次
  //   ② 讲解新内容       ← 讲
  //   ③ 练习             ← 练
  //   ④ 小结             ← 总（用自己的话说一遍）
  //   ⑤ 自己出题         ← 创
  //
  // 为什么复习放在**最前面**，而不是学完再练：
  // 这叫「提取练习」——努力从记忆里拽出来的那一下，比再看一遍有效得多。
  // 复习放在新课之前，效果最好。
  //
  // 关卡组织（世界 / 课时）完全不变，这里只是在它上面加了一条"怎么走"的主线。

  const REVIEW_PER_SESSION = 3;

  /** 正在上的这门课：{ n, learn: [关卡id], phase } */
  let courseRun = null;
  /** 下一关要去哪（复习关 or 课程里的下一关），由 showDone 算好给按钮用 */
  let nextTarget = null;

  /**
   * 规划第 n 课：先复习哪些、再学哪些。
   * 复习题从**前面所有课**里挑，优先挑到期的；没到期的按「学得最早」补。
   */
  function planSession(n) {
    const lesson = L.LESSONS[n - 1];
    if (!lesson) return { review: [], learn: [] };
    const now = Date.now();

    // 讲解 / 小结 / 出题 不适合当复习题 —— 复习要的是「回忆 + 动手」
    const cands = L.LESSONS.slice(0, n - 1)
      .flatMap((x) => x.levels)
      .map((id) => L.findLevel(id))
      .filter((lv) => lv && (lv.type === "proof" || lv.type === "quiz"));

    const rank = (lv) => {
      const rev = save.review[lv.id];
      const isDue = !!rev && rev.due <= now;
      // 到期的排最前；其余按学得最早的排（越久没碰越该复习）
      return [isDue ? 0 : 1, save.solved[lv.id] || 0];
    };
    const review = cands
      .slice()
      .sort((a, b) => {
        const ra = rank(a);
        const rb = rank(b);
        return ra[0] - rb[0] || ra[1] - rb[1];
      })
      .slice(0, REVIEW_PER_SESSION)
      .map((lv) => lv.id);

    return { review, learn: lesson.levels.slice() };
  }

  /** 开始上第 n 课：先走复习，复习完了自动接新内容 */
  function startCourse(n) {
    const plan = planSession(n);
    courseRun = { n, learn: plan.learn, reviewTotal: plan.review.length };
    reviewQueue = plan.review;
    reviewUsedHint = false;
    const first = reviewQueue.length ? reviewQueue[0] : plan.learn[0];
    if (first) openLevel(first);
  }

  /** 顶部的课程进度条：现在在「复习」还是在「上新课」 */
  function updateCourseBanner(level) {
    const el = $("course-banner");
    if (!el) return;
    if (!courseRun || !level) {
      el.hidden = true;
      return;
    }
    const lesson = L.LESSONS[courseRun.n - 1];
    const isReview = reviewQueue[0] === level.id;
    el.hidden = false;
    if (isReview) {
      const doneN = courseRun.reviewTotal - reviewQueue.length + 1;
      el.className = "course-banner review";
      el.innerHTML =
        `📚 第 ${courseRun.n} 次 · ① <b>先复习</b>　` +
        `<span class="cb-count">${doneN} / ${courseRun.reviewTotal}</span>`;
    } else {
      const i = courseRun.learn.indexOf(level.id);
      el.className = "course-banner learn";
      el.innerHTML =
        `📚 第 ${courseRun.n} 次 · ${lesson ? esc(lesson.title) : ""}　` +
        (i >= 0
          ? `<span class="cb-count">${i + 1} / ${courseRun.learn.length}</span>`
          : "");
    }
  }

  // ============================================================ 页面切换

  const SCREENS = [
    "screen-home",
    "screen-lessons",
    "screen-world",
    "screen-level",
    "screen-done",
  ];
  let currentScreen = "screen-home";

  function showScreen(id) {
    currentScreen = id;
    SCREENS.forEach((s) => ($(s).hidden = s !== id));
    window.scrollTo({ top: 0, behavior: "smooth" });
    $("btn-back").hidden = id === "screen-home";
  }

  // ============================================================ 首页

  function renderHome() {
    const total = L.LEVELS.length;
    const done = L.LEVELS.filter((l) => save.solved[l.id]).length;

    $("home-stats").innerHTML = [
      { n: done, t: "已破案件" },
      { n: total, t: "案件总数" },
      { n: L.WORLDS.length, t: "案件档案" },
    ]
      .map(
        (s) =>
          `<div class="stat"><b>${s.n}</b><span>${esc(s.t)}</span></div>`
      )
      .join("");

    const next = nextPlayable();
    $("btn-continue").textContent = done === 0 ? "开始侦探之旅 ▶" : "继续侦探之旅 ▶";
    $("btn-continue").disabled = !next;

    // 复习按钮：只有真到期了才出现，平时不打扰。
    // 复习是「快忘的时候再见一面」，所以它按日期自己冒出来，不用孩子记。
    const due = dueReviews().length;
    $("btn-review").hidden = due === 0;
    $("btn-review").textContent = `🔁 复习（${due} 关到时候了）`;

    $("world-grid").innerHTML = "";    for (const w of L.WORLDS) {
      const unlocked = L.isWorldUnlocked(w.id, save.solved);
      const { done: d, total: t } = L.worldProgress(w.id, save.solved);
      const card = document.createElement("button");
      card.className = "world-card" + (unlocked ? "" : " locked");
      card.style.setProperty("--wc", w.color);
      card.innerHTML = `
        <div class="world-emoji">${w.emoji}</div>
        <div class="world-name">${esc(w.name)}</div>
        <div class="world-desc">${esc(w.desc)}</div>
        <div class="progress-bar"><div class="progress-fill" style="width:${
          t ? (d / t) * 100 : 0
        }%"></div></div>
        <div class="progress-text">${
          unlocked ? `${d} / ${t} 关` : "🔒 完成上一个档案后解锁"
        }</div>`;
      if (unlocked) card.onclick = () => openWorld(w.id);
      else card.onclick = () => sfxOops();
      $("world-grid").appendChild(card);
    }
  }

  /** 下一个可以玩的关卡：按顺序找第一个没做过的、且已解锁的 */
  function nextPlayable() {
    for (const lv of L.LEVELS) {
      if (save.solved[lv.id]) continue;
      if (!L.isWorldUnlocked(lv.world, save.solved)) return null;
      if (!L.isUnlocked(lv, save.solved)) continue;
      return lv;
    }
    return null;
  }

  // ============================================================ 学习路线
  //
  // 把 68 关切成 14 次、每次约半小时。每一课都带一句「毕业标准」——
  // 做完之后家长问这一句，孩子能用自己的话说出来才算过关。
  // 这一页解决的是「一次玩多久、玩到哪儿停」。

  function renderLessons() {
    const totalMin = L.LESSONS.reduce((a, l) => a + l.minutes, 0);
    $("lessons-total").textContent = `${L.LESSONS.length} 次、约 ${totalMin} 分钟`;

    const box = $("lesson-list");
    box.innerHTML = "";
    L.LESSONS.forEach((lesson) => {
      const levels = lesson.levels.map((id) => L.findLevel(id)).filter(Boolean);
      const done = levels.filter((lv) => save.solved[lv.id]).length;
      const allDone = done === levels.length;
      const next = levels.find((lv) => !save.solved[lv.id]) || levels[0];
      // 前一课没做完就锁上，免得跳着玩看不懂
      const prevDone =
        lesson.n === 1 ||
        L.LESSONS[lesson.n - 2].levels.every((id) => save.solved[id]);

      const card = document.createElement("div");
      const plan = planSession(lesson.n);
      card.className =
        "lesson-card" + (allDone ? " done" : "") + (prevDone ? "" : " locked");
      card.dataset.lesson = String(lesson.n);
      card.innerHTML = `
        <div class="lc-num">${allDone ? "✓" : lesson.n}</div>
        <div class="lc-main">
          <div class="lc-title">第 ${lesson.n} 次 · ${esc(lesson.title)}</div>
          <div class="lc-meta">约 ${lesson.minutes} 分钟 · 已完成 ${done}/${levels.length}</div>
          <div class="lc-plan">${
            plan.review.length
              ? `🔁 先复习 <b>${plan.review.length}</b> 关`
              : "🔁 第 1 课，不用复习"
          }　→　📖 本课 <b>${plan.learn.length}</b> 关</div>
          <div class="lc-goal">🎓 <b>毕业标准</b>：${esc(lesson.goal)}</div>
          <div class="progress-bar"><div class="progress-fill" style="width:${
            levels.length ? (done / levels.length) * 100 : 0
          }%"></div></div>
        </div>
        <div class="lc-go">${
          !prevDone ? "🔒" : allDone ? "🔁 再来" : done ? "▶ 继续" : "▶ 开始"
        }</div>`;

      card.onclick = () => {
        if (!prevDone) return sfxOops();
        sfxClick();
        startCourse(lesson.n);
      };
      box.appendChild(card);
    });
  }

  // ============================================================ 世界页

  let currentWorldId = null;

  function openWorld(worldId) {
    currentWorldId = worldId;
    sfxClick();
    const w = L.WORLDS.find((x) => x.id === worldId);
    const levels = L.LEVELS.filter((l) => l.world === worldId);

    $("world-head").style.setProperty("--wc", w.color);
    $("world-head").innerHTML = `
      <h2>${w.emoji} ${esc(w.name)}</h2>
      <div class="wh-desc">${esc(w.desc)}</div>
      <div class="markdown">${mdToHtml(w.intro)}</div>`;

    $("level-list").innerHTML = "";
    // 关卡类型 → 图标 / 小标签。一目了然地知道「这一关是干什么的」。
    const KIND = {
      teach: { icon: null, label: "先认识一下" },
      quiz: { icon: null, label: "选择题" },
      proof: { icon: null, label: "推理题" },
      summary: { icon: "🎓", label: "本课小结" },
      create: { icon: "🎨", label: "自己出题" },
    };

    levels.forEach((lv, i) => {
      const unlocked = L.isUnlocked(lv, save.solved);
      const done = !!save.solved[lv.id];
      const kind = KIND[lv.type] || KIND.proof;
      const item = document.createElement("button");
      item.className =
        "level-item" + (done ? " done" : "") + (unlocked ? "" : " locked");
      item.innerHTML = `
        <div class="level-num">${
          done ? "✓" : kind.icon || (lv.type === "teach" ? lv.emoji || "📖" : i + 1)
        }</div>
        <div class="level-title">${esc(lv.title)}
          <div class="level-kind">${kind.label}</div>
        </div>
        <div class="level-status">${done ? "⭐" : unlocked ? "▶" : "🔒"}</div>`;
      item.onclick = () => {
        if (!unlocked) return sfxOops();
        openLevel(lv.id);
      };
      $("level-list").appendChild(item);
    });

    showScreen("screen-world");
  }

  // ============================================================ 关卡

  let session = null;
  let teachLevel = null;
  let currentLevel = null; // 最近打开的关卡（三种类型通用，供「下一关」用）

  /**
   * 打开一关。
   *
   * 如果这一关会用到还没见过的方法卡，先弹「新道具介绍」——
   * 新词必须先介绍，不能让孩子在做题的时候第一次遇到它。
   */
  function openLevel(levelId, opts) {
    const level = L.findLevel(levelId);
    if (!level) return;
    opts = opts || {};
    if (!opts.silent) sfxClick();

    if (level.type === "proof" && !opts.skipIntro) {
      const fresh = (level.newCards || []).filter((id) => !save.seenCards[id]);
      if (fresh.length) {
        showCardIntro(level, fresh, () =>
          openLevel(levelId, { skipIntro: true, silent: true })
        );
        return;
      }
    }

    currentLevel = level;
    // 先把所有视图藏起来，再让下面各自打开自己那一个 ——
    // 加新关卡类型时只要在这里补一个名字，不会漏掉某个分支导致两个视图同时露出来
    for (const v of [
      "teach-view",
      "proof-view",
      "quiz-view",
      "summary-view",
      "create-view",
      "explain-view",
    ])
      $(v).hidden = true;
    if (level.type === "teach") startTeach(level);
    else if (level.type === "quiz") startQuiz(level);
    else if (level.type === "summary") startSummary(level);
    else if (level.type === "create") startCreate(level);
    else if (level.type === "explain") startExplain(level);
    else startProof(level);
    updateCourseBanner(level);
    showScreen("screen-level");
  }

  /**
   * 这一关能用哪些方法卡。
   * 「能用」＝「已经介绍过」—— 唯一数据源在 levels.js 的 tacticsForLevel。
   * 早期版本按「卡片声明的世界 ≤ 当前世界」来算，结果是孩子会先看到卡、
   * 后看到介绍（`只差一步` 就是这样漏出去的）。
   */
  function unlockedTactics(level) {
    const introduced = L.tacticsForLevel(level.id);
    return L.TACTICS.filter((t) => introduced.has(t.id));
  }

  // ------------------------------------------------------------ 介绍关

  /** 纯介绍页：一题都不出，看完点「我明白啦」。 */
  function startTeach(level) {
    session = null;
    quiz = null;
    teachLevel = level;
    $("teach-view").hidden = false;
    $("proof-view").hidden = true;
    $("quiz-view").hidden = true;
    $("summary-view").hidden = true;
    $("create-view").hidden = true;
    $("teach-symbol").textContent = level.symbol || level.emoji || "📖";
    $("teach-title").textContent = level.title;
    $("teach-body").innerHTML = mdToHtml(level.body);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ------------------------------------------------------------ 小结关
  //
  // 一课的最后一步：把这一课的知识点串一遍，确认「毕业标准」，
  // 再让孩子**用自己的话写一遍**。不判对错 —— 判不了，也不该判。
  // 用途有两个：写的过程就是复述（费曼技巧），写下来的东西家长能看。

  let summaryLevel = null;

  function startSummary(level) {
    session = null;
    quiz = null;
    teachLevel = null;
    summaryLevel = level;
    $("teach-view").hidden = true;
    $("proof-view").hidden = true;
    $("quiz-view").hidden = true;
    $("create-view").hidden = true;
    $("summary-view").hidden = false;

    $("summary-emoji").textContent = level.emoji || "🎓";
    $("summary-title").textContent = level.title;

    const recap = (level.intro ? level.intro + "\n\n" : "")
      + (level.points || []).map((p) => "· " + p).join("\n");
    $("summary-recap").innerHTML = mdToHtml(recap);
    $("summary-graduation").innerHTML = mdToHtml(level.graduation || "");
    $("summary-ask-label").textContent =
      "✍️ " + (level.askKid || "用你自己的话说说，这一课学了什么？");
    $("summary-note").value = save.notes[level.id] || "";
    $("btn-summary-done").textContent = level.button || "写好了，收工 ▶";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ------------------------------------------------------------ 自己出题关
  //
  // 这一关反过来：孩子当出题人。
  // 引擎负责判三件事 —— 线索自洽吗、结论真能推出来吗、会不会太简单。
  // 「出一道成立的题」比「做一道题」难得多，也是真正检验懂没懂的关卡。

  let createLevel = null;
  const createPick = { givens: new Set(), goal: null };

  function startCreate(level) {
    session = null;
    quiz = null;
    teachLevel = null;
    summaryLevel = null;
    createLevel = level;
    createPick.givens = new Set();
    createPick.goal = null;

    $("teach-view").hidden = true;
    $("proof-view").hidden = true;
    $("quiz-view").hidden = true;
    $("summary-view").hidden = true;
    $("create-view").hidden = false;

    $("create-title").textContent = level.title;
    $("create-brief-body").innerHTML = mdToHtml(level.intro || "");
    $("create-feedback").hidden = true;
    $("create-play").hidden = true;

    // ① 线索菜单
    const pool = $("create-pool");
    pool.innerHTML = "";
    level.poolF.forEach((f, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "create-chip";
      btn.dataset.pool = String(i);
      btn.innerHTML = fshow(f);
      btn.onclick = () => {
        if (createPick.givens.has(i)) createPick.givens.delete(i);
        else createPick.givens.add(i);
        btn.classList.toggle("on");
        sfxClick();
      };
      pool.appendChild(btn);
    });

    // ② 结论菜单
    const goals = $("create-goals");
    goals.innerHTML = "";
    level.goalsF.forEach((f, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "create-chip goal";
      btn.dataset.goal = String(i);
      btn.innerHTML = fshow(f);
      btn.onclick = () => {
        createPick.goal = i;
        [...goals.children].forEach((c) => c.classList.remove("on"));
        btn.classList.add("on");
        sfxClick();
      };
      goals.appendChild(btn);
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** 检查孩子出的题成不成立。三种「不成立」都要给出具体的理由。 */
  function checkCreate() {
    const level = createLevel;
    if (!level) return;
    const box = $("create-feedback");
    const show = (msg) => {
      box.hidden = false;
      box.className = "feedback bad";
      box.innerHTML = mdToHtml(msg);
    };

    if (!createPick.givens.size)
      return show("先选至少一条**线索**——没有线索的话，题目就没有难度了。");
    if (createPick.goal === null)
      return show("还没选**要证明的结论**呢。");

    const givens = [...createPick.givens].map((i) => level.poolF[i]);
    const goal = level.goalsF[createPick.goal];

    // ① 线索不能自相矛盾 —— 矛盾线索下什么都能"证明"，那是一道假题
    if (!L.isSatisfiable(givens))
      return show(
        "这几条线索**互相打架**，不可能同时成立。\n\n自相矛盾的线索能「推出」任何结论，\n所以那不是一道好题。换一条试试？"
      );

    // ② 结论不能空手就成立
    if (L.isTautology(goal))
      return show(
        "这个结论**不用任何线索**就成立，太简单了 😄\n\n好题的结论要靠线索才推得出来。"
      );

    // ③ 结论不能就是某条线索本身 —— 那等于"因为下雨，所以下雨"
    if (givens.some((g) => L.key(g) === L.key(goal)))
      return show(
        "这个结论**就是你选的一条线索**😄\n\n「因为它，所以它」不是一道题。\n结论要从线索**推出来**，而不是直接抄一条。"
      );

    // ③ 结论必须真能推出来
    L.resetIds();
    const sol = L.solve(L.initialState(givens, goal, []), {
      maxDepth: 12,
      maxNodes: 60000,
      only: L.tacticsForLevel(level.id),
    });
    if (!sol)
      return show(
        "这个结论**推不出来** 😕\n\n线索不够，或者你选的结论和线索说的是两回事。\n再想想：这些线索合起来能保证什么？"
      );

    // 成立！
    box.hidden = false;
    box.className = "feedback good";
    box.innerHTML = mdToHtml(
      "🎉 **成立！** 你出的这道题是一道**真题目** ——\n线索自洽，结论确实能从线索推出来，而且还不是废话。\n\n"
        + "**题目**：" + givens.map((f) => "`" + L.show(f) + "`").join("、")
        + "　⊢　`" + L.show(goal) + "`\n\n"
        + "数学老师出一道好题，就是这个标准。"
    );

    const play = $("create-play");
    play.hidden = false;
    play.innerHTML = "";
    const btn = document.createElement("button");
    btn.className = "big-primary";
    btn.textContent = "▶ 现在做做看我出的题";
    btn.onclick = () => {
      const custom = {
        id: "custom-" + Date.now(),
        world: level.world,
        type: "proof",
        title: "我出的题",
        givensF: givens,
        rulesF: [],
        goalF: goal,
        hints: [],
        conclusion: "这道题是**你自己出的**，而且它成立。🎨\n\n能出题，说明你真的懂了。",
        isCustom: true,
      };
      createLevel = null;
      currentLevel = custom;
      startProof(custom);
      showScreen("screen-level");
    };
    play.appendChild(btn);

    const fin = document.createElement("button");
    fin.className = "ghost";
    fin.textContent = "✓ 我满意这一题，收工";
    fin.onclick = () => {
      const lv = createLevel;
      createLevel = null;
      showDone(lv, { emoji: "🎨", title: "你出题成功了！" });
    };
    play.appendChild(fin);
  }

  // ------------------------------------------------------------ 讲解关
  //
  // 反过来：**别人**推了一段，其中一步是错的，让孩子抓出来。
  //
  // 为什么这一关值得做：会做一道题，和会「检查别人的推理」是两种能力。
  // 后者更接近真实的数学和编程 —— 你大部分时间都在看别人的东西哪里不对。
  // 而且它好判分：错了就是错了，不用猜孩子怎么想的。

  let explainLevel = null;
  let explainFound = false;

  function startExplain(level) {
    session = null;
    quiz = null;
    teachLevel = null;
    summaryLevel = null;
    createLevel = null;
    explainLevel = level;
    explainFound = false;

    $("teach-view").hidden = true;
    $("proof-view").hidden = true;
    $("quiz-view").hidden = true;
    $("summary-view").hidden = true;
    $("create-view").hidden = true;
    $("explain-view").hidden = false;

    $("explain-title").textContent = level.title;
    $("explain-brief-body").innerHTML = mdToHtml(level.intro || "");
    $("explain-feedback").hidden = true;
    $("explain-play").hidden = true;
    $("explain-play").innerHTML = "";

    const box = $("explain-steps");
    box.innerHTML = "";
    level.stepsF.forEach((f, i) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "explain-step";
      row.dataset.step = String(i);
      row.innerHTML =
        `<span class="es-num">${i + 1}</span>` +
        `<span class="es-body">` +
        `<span class="es-claim">${fshow(f)}</span>` +
        `<span class="es-why">${inlineMd(level.steps[i].why || "")}</span>` +
        `</span>`;
      row.onclick = () => pickExplainStep(i);
      box.appendChild(row);
    });

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function pickExplainStep(i) {
    if (explainFound || !explainLevel) return;
    const fb = $("explain-feedback");

    if (i !== explainLevel.wrongIndex) {
      sfxOops();
      fb.hidden = false;
      fb.className = "feedback bad";
      fb.innerHTML = mdToHtml(
        `第 ${i + 1} 步**没问题** —— 它确实能从前面推出来。再看看别的。`
      );
      return;
    }

    explainFound = true;
    sfxWin();
    fb.hidden = false;
    fb.className = "feedback good";
    fb.innerHTML = mdToHtml(
      `🎯 **找到了！第 ${i + 1} 步是错的。**\n\n` +
        (explainLevel.explanation || "") +
        (explainLevel.fix ? `\n\n✅ **正确的做法**：${explainLevel.fix}` : "")
    );
    [...$("explain-steps").children].forEach((el, k) => {
      if (k === i) el.classList.add("wrong");
    });

    const play = $("explain-play");
    play.hidden = false;
    play.innerHTML = "";
    const b = document.createElement("button");
    b.className = "big-primary";
    b.textContent = "明白了，收工 ▶";
    b.onclick = () => {
      const lv = explainLevel;
      explainLevel = null;
      showDone(lv, { emoji: "🕵️", title: "抓到错误了！" });
    };
    play.appendChild(b);
  }

  // ------------------------------------------------------------ 新道具介绍

  /**
   * 新道具介绍弹层。
   * 每一张卡都说三件事：是什么、什么时候用、举个例子。
   */
  function showCardIntro(level, cardIds, onOk) {
    const list = $("card-intro-list");
    list.innerHTML = "";
    cardIds.forEach((id) => {
      const t = L.TACTIC_MAP[id];
      if (!t) return;
      const guide = L.CARD_GUIDE[id] || {};
      const item = document.createElement("div");
      item.className = "intro-item";
      item.style.setProperty("--tone", TONES[t.card.tone] || "#5b6ef5");
      item.innerHTML =
        `<div class="ii-head"><span style="font-size:24px">${t.card.emoji}</span>` +
        `<span>${esc(t.card.name)}</span></div>` +
        `<div class="ii-tip">${inlineMd(t.card.tip)}</div>` +
        (guide.when
          ? `<div class="ii-when">💡 <b>什么时候用？</b>${inlineMd(guide.when)}</div>`
          : "") +
        (guide.example
          ? `<div class="ii-ex">🔎 例如：${inlineMd(guide.example)}</div>`
          : "");
      list.appendChild(item);
    });

    // 标记为已介绍（这样重玩这一关不会再弹）
    cardIds.forEach((id) => (save.seenCards[id] = true));
    persist();

    const modal = $("card-intro");
    modal.hidden = false;
    $("btn-card-intro-ok").onclick = () => {
      modal.hidden = true;
      sfxClick();
      if (onOk) onOk();
    };
  }

  // ------------------------------------------------------------ 证明关

  function startProof(level) {
    quiz = null;
    teachLevel = null;
    const cards = unlockedTactics(level);
    session = {
      level,
      state: L.initialState(level.givensF, level.goalF, level.rulesF),
      history: [],
      log: [],
      pick: null,
      feedback: null,
      hintIdx: 0,
      cards,
    };
    $("proof-view").hidden = false;
    $("quiz-view").hidden = true;
    $("teach-view").hidden = true;
    $("summary-view").hidden = true;
    $("create-view").hidden = true;
    $("proof-title").textContent = level.title;
    // 有些关（比如入门选择题）没有案情简介，这时整个折叠块藏起来，
    // 免得孩子点开一个空盒子。
    const brief = (level.intro || "").trim();
    $("proof-brief").hidden = !brief;
    if (brief) {
      $("proof-brief-body").innerHTML = mdToHtml(brief);
      $("proof-brief").open = true;
    }
    renderProof();
  }

  function setFeedback(kind, text) {
    session.feedback = text ? { kind, text } : null;
    renderFeedback();
  }

  function renderFeedback() {
    const box = $("feedback");
    if (!session || !session.feedback) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.className = "feedback " + session.feedback.kind;
    box.innerHTML = mdToHtml(session.feedback.text);
  }

  /** 当前这一步，哪些线索是可选的 */
  function pickCandidates() {
    if (!session || !session.pick) return [];
    const goal = L.focused(session.state);
    const tactic = L.TACTIC_MAP[session.pick.tacticId];
    const picked = session.pick.picked
      .map((id) => goal.hyps.find((h) => h.id === id))
      .filter(Boolean);
    return L.candidates(goal, tactic, picked);
  }

  function renderProof() {
    const st = session.state;
    const goal = L.focused(st);
    if (!goal) return; // 已经全部证完，交给通关页去显示

    // ---- 目标 ----
    const remaining = st.goals.length;
    $("goal-box").innerHTML = `
      <div class="goal-label">🎯 要证明</div>
      <div class="goal-formula">${fshow(goal.target)}</div>
      ${remaining > 1 ? `<div class="goal-note">后面还排着 ${remaining - 1} 个小目标</div>` : ""}`;

    // ---- 假设区 ----
    const cands = pickCandidates();
    const candIds = new Set(cands.map((c) => c.id));
    const pickedIds = new Set(session.pick ? session.pick.picked : []);
    const pickTactic = session.pick ? L.TACTIC_MAP[session.pick.tacticId] : null;
    const isHypPick = !!pickTactic && pickTactic.pickKind !== "formula";

    /**
     * 造一张线索卡。
     * 假设框里的「假设」和下面列表里的线索走的是同一套逻辑 ——
     * 这很重要：分情况讨论产生的分支假设，必须能像普通线索一样被点选，
     * 否则像「小明选了苹果 ∨ 小明选了香蕉」这种关卡根本没法玩完。
     */
    function makeClueNode(h, badge, tagText) {
      const div = document.createElement("div");
      const clickable = isHypPick && candIds.has(h.id);
      div.dataset.hyp = h.id;
      div.className =
        "clue " +
        h.tag +
        (clickable ? " clickable" : "") +
        (clickable && save.settings.highlight ? " pickable" : "") +
        (pickedIds.has(h.id) ? " selected" : "") +
        (isHypPick && save.settings.highlight && !candIds.has(h.id) ? " dim" : "");
      div.innerHTML =
        `<span class="clue-no">${badge}</span>` +
        `<span>${fshow(h.f)}</span>` +
        `<span class="clue-tag">${tagText}</span>`;
      if (clickable) div.onclick = () => onClueClick(h.id);
      return div;
    }

    const assumes = goal.hyps.filter((h) => h.tag === "assume");
    const assumeBox = $("assume-box");
    if (assumes.length) {
      assumeBox.hidden = false;
      assumeBox.innerHTML =
        '<div class="assume-label">🔮 我们现在假装这些是对的（也可以当线索用）</div>';
      assumes.forEach((h) =>
        assumeBox.appendChild(makeClueNode(h, "假", "假设"))
      );
    } else {
      assumeBox.hidden = true;
      assumeBox.innerHTML = "";
    }

    // ---- 线索 ----
    const visible = goal.hyps.filter((h) => h.tag !== "assume");
    const clueList = $("clue-list");
    clueList.innerHTML = "";
    if (!visible.length) {
      const empty = document.createElement("div");
      empty.className = "log-empty";
      empty.textContent = "（这一关一开始没有线索，得靠「先假设」自己造）";
      clueList.appendChild(empty);
    }
    visible.forEach((h, i) =>
      clueList.appendChild(
        makeClueNode(
          h,
          String(i + 1),
          // 线索 = 关于特定对象的事实；规则 = 普遍成立的定律（变量是空位）
          h.tag === "rule" ? "规则" : h.tag === "given" ? "线索" : "推出"
        )
      )
    );

    // ---- 待办清单 ----
    const todoBox = $("todo-box");
    if (st.goals.length > 1) {
      todoBox.hidden = false;
      todoBox.innerHTML =
        '<div class="todo-title">⏳ 待办清单（一共 ' +
        st.goals.length +
        " 个小目标）</div><ol>" +
        st.goals
          .map(
            (g, i) =>
              `<li class="${i === 0 ? "current" : ""}">${fshow(g.target)}${
                i === 0 ? " ← 正在做" : ""
              }</li>`
          )
          .join("") +
        "</ol>";
    } else {
      todoBox.hidden = true;
    }

    // ---- 推理记录 ----
    $("proof-log").innerHTML = session.log.length
      ? session.log
          .map(
            (s, i) =>
              `<div class="log-item"><span class="log-step">${i + 1}.</span>${
                inlineMd(s.message)
              }</div>`
          )
          .join("")
      : '<div class="log-empty">还没开始推理。点下面的方法卡试试～</div>';
    const logPane = $("proof-log");
    logPane.parentElement.scrollTop = logPane.parentElement.scrollHeight;

    // ---- 方法卡 ----
    // 把「现在能用」的排在前面。到了后面的世界一共有 13 张卡，
    // 如果照登记顺序平铺，唯一可用的那张会被埋在十几张灰卡中间，
    // 孩子得逐张扫过去才知道自己能做什么。排序后左上角永远是「现在能做的」。
    const newCards = new Set(session.level.newCards || []);
    const cardStates = session.cards.map((t) => ({ t, usable: L.isUsable(goal, t) }));
    cardStates.sort((a, b) => (a.usable === b.usable ? 0 : a.usable ? -1 : 1));

    $("card-palette").innerHTML = "";
    cardStates.forEach(({ t, usable }) => {
      const btn = document.createElement("button");
      const active = session.pick && session.pick.tacticId === t.id;
      btn.className =
        "card" + (usable ? "" : " disabled") + (active ? " active" : "");
      btn.style.setProperty("--tone", TONES[t.card.tone] || "#5b6ef5");
      btn.title = t.card.tip + (usable ? "" : "（现在用不上）");
      btn.innerHTML =
        (newCards.has(t.id) ? '<span class="card-new">新</span>' : "") +
        `<span class="card-emoji">${t.card.emoji}</span><span>${esc(
          t.card.name
        )}</span>`;
      btn.onclick = () => onCardClick(t.id, usable);
      $("card-palette").appendChild(btn);
    });

    // 图例
    const legend = document.createElement("div");
    legend.className = "legend";
    if (save.settings.legend) {
      legend.innerHTML =
        '<span><span class="op op-and">∧</span> 且（两个都要）</span>' +
        '<span><span class="op op-or">∨</span> 或（一个就够）</span>' +
        '<span><span class="op op-not">¬</span> 非（不是）</span>' +
        '<span><span class="op op-imp">→</span> 如果…那么…</span>';
    }
    $("card-palette").appendChild(legend);

    // ---- 选线索提示条 / 公式选择器 ----
    const banner = $("pick-banner");
    const picker = $("formula-picker");
    if (session.pick) {
      const tactic = L.TACTIC_MAP[session.pick.tacticId];
      const pickedHyps = session.pick.picked
        .map((id) => goal.hyps.find((h) => h.id === id))
        .filter(Boolean);
      if (tactic.pickKind === "formula") {
        banner.hidden = true;
        picker.hidden = false;
        picker.innerHTML =
          '<div class="picker-note">' +
          esc(tactic.pickPrompt(pickedHyps)) +
          "</div>";
        cands.forEach((c) => {
          const chip = document.createElement("button");
          chip.className = "formula-chip";
          chip.innerHTML = fshow(c.f);
          chip.onclick = () => onFormulaPick(c.id);
          picker.appendChild(chip);
        });
        if (!cands.length) {
          const none = document.createElement("div");
          none.className = "picker-note";
          none.textContent = "现在没有可以选的公式，换张卡试试？";
          picker.appendChild(none);
        }
      } else {
        picker.hidden = true;
        banner.hidden = false;
        $("pick-text").textContent = tactic.pickPrompt(pickedHyps);
      }
    } else {
      banner.hidden = true;
      picker.hidden = true;
    }

    // ---- 按钮状态 ----
    $("btn-undo").disabled = session.history.length === 0;
    $("btn-hint").disabled = false;

    renderFeedback();
  }

  function onCardClick(tacticId, usable) {
    if (!usable) return sfxOops();
    const tactic = L.TACTIC_MAP[tacticId];
    const arity = tactic.arity || 0;
    if (arity === 0) {
      doMove(tacticId, []);
      return;
    }
    sfxClick();
    session.pick = { tacticId, picked: [] };
    setFeedback("info", tactic.card.tip);
    renderProof();
  }

  function onClueClick(hypId) {
    if (!session.pick) return;
    const tactic = L.TACTIC_MAP[session.pick.tacticId];
    if (tactic.pickKind === "formula") return;
    if (session.pick.picked.includes(hypId)) return;
    if (!pickCandidates().some((h) => h.id === hypId)) {
      sfxOops();
      setFeedback("bad", "这条线索用不上哦。再想想：这张卡需要什么样的线索？");
      return;
    }
    session.pick.picked.push(hypId);
    if (session.pick.picked.length >= (tactic.arity || 0)) {
      const picks = session.pick.picked.slice();
      doMove(tactic.id, picks);
    } else {
      sfxClick();
      renderProof();
    }
  }

  function onFormulaPick(candidateId) {
    if (!session.pick) return;
    const picks = session.pick.picked.concat([candidateId]);
    doMove(session.pick.tacticId, picks);
  }

  function cancelPick() {
    session.pick = null;
    setFeedback(null);
    renderProof();
  }

  function doMove(tacticId, picks) {
    try {
      const res = L.applyMove(session.state, tacticId, picks);
      session.history.push({ state: session.state, log: session.log.slice() });
      session.state = res.state;
      session.log.push({ tactic: tacticId, message: res.message });
      session.pick = null;
      if (L.isSolved(session.state)) {
        // 注意：这里不能再调 renderProof() —— 目标已经全部证完，
        // focused() 返回 undefined，重新渲染会直接抛异常。
        onSolved();
      } else {
        sfxStep();
        setFeedback("good", res.message);
        renderProof();
      }
    } catch (e) {
      sfxOops();
      session.pick = null;
      setFeedback("bad", e.message);
      renderProof();
    }
  }

  function undo() {
    if (!session.history.length) return;
    const h = session.history.pop();
    session.state = h.state;
    session.log = h.log;
    session.pick = null;
    sfxClick();
    setFeedback("info", "退回上一步了，再来一次～");
    renderProof();
  }

  function resetLevel() {
    startProof(session.level);
    setFeedback("info", "重新开始这一关。加油！");
    renderProof();
  }

  // ------------------------------------------------------------ 提示

  function showHint() {
    const hints = session.level.hints || [];
    if (session.hintIdx < hints.length) {
      setFeedback("info", "💡 提示 " + (session.hintIdx + 1) + "：" + hints[session.hintIdx]);
      session.hintIdx++;
      sfxClick();
      return;
    }
    // 手写提示用完了，就让求解器算一步
    setFeedback("info", "💡 让我想想…");
    setTimeout(() => {
      const sol = L.solve(session.state, { maxDepth: 12, maxNodes: 30000 });
      if (!sol || !sol.path.length) {
        setFeedback(
          "bad",
          "我也绕晕了 😅 试试「🔄 重来」，或者回顾一下线索。"
        );
        return;
      }
      const step = sol.path[0];
      const tactic = L.TACTIC_MAP[step.tactic];
      const goal = L.focused(session.state);
      const clueTexts = step.picks
        .map((id) => {
          const h = goal.hyps.find((x) => x.id === id);
          if (h) return "「" + L.show(h.f) + "」";
          const c = L.candidates(goal, tactic, []).find((x) => x.id === id);
          return c ? "「" + L.show(c.f) + "」" : "";
        })
        .filter(Boolean)
        .join("、");
      setFeedback(
        "info",
        `💡 可以试试 **${tactic.card.emoji} ${tactic.card.name}**` +
          (clueTexts ? `，选 ${clueTexts}` : "") +
          "。"
      );
      sfxClick();
    }, 30);
  }

  // ------------------------------------------------------------ 过关

  /**
   * 通关结算。证明关、选择题、介绍关三种共用这一套，
   * 只有标题和表情不一样。
   */
  function showDone(lv, opts) {
    opts = opts || {};
    const firstTime = !save.solved[lv.id];
    const wasReview = reviewQueue[0] === lv.id;
    // solved 里以前存的是 true，现在改存完成时间戳。
    // 所有地方都是按「真假」用的，所以老存档照样能用。
    // 自己出的题是临时的，不进存档、也不排复习。
    if (!lv.isCustom) {
      if (firstTime) save.solved[lv.id] = Date.now();
      if (wasReview) {
        // 自己想起了 → 升一格（下次更远再见）；靠提示做的 → 退回第一格，明天再来
        bumpReview(lv.id, !reviewUsedHint);
        reviewQueue.shift();
      } else if (firstTime) {
        scheduleReview(lv.id, 1); // 第一次学会 → 明天该复习
      }
    }
    persist();
    sfxWin();
    confetti();

    $("done-emoji").textContent =
      opts.emoji ||
      ["🎉", "🏆", "🌟", "🕵️", "💡", "🧠"][Math.floor(Math.random() * 6)];
    $("done-title").textContent = firstTime
      ? opts.title || "破案啦！"
      : opts.replayTitle || "又做对一次！";
    $("done-conclusion").innerHTML = mdToHtml(lv.conclusion || "");

    const w = L.WORLDS.find((x) => x.id === lv.world);
    const { done, total } = L.worldProgress(lv.world, save.solved);
    const allDone = L.LEVELS.filter((l) => save.solved[l.id]).length;
    let xp = `📁 ${w.name}：${done} / ${total} 关`;
    if (done === total) xp += "　🎊 这个档案全部破完！";
    xp += `　　🏅 全站进度 ${allDone} / ${L.LEVELS.length}`;
    $("done-xp").textContent = xp;

    // 下一关去哪：复习队列 → 课程里排的新内容 → 普通顺序的下一关
    nextTarget = null;
    if (lv.isCustom) {
      // 自己出的题不参与任何队列
    } else if (reviewQueue.length) {
      nextTarget = reviewQueue[0];
    } else if (courseRun) {
      const i = courseRun.learn.indexOf(lv.id);
      // 复习关不在 learn 里 → 复习做完就接本课的第一关新内容
      nextTarget = i >= 0 ? courseRun.learn[i + 1] || null : courseRun.learn[0] || null;
    } else {
      const nxt = L.LEVELS[L.LEVELS.indexOf(lv) + 1];
      nextTarget = nxt ? nxt.id : null;
    }

    $("btn-next").hidden = !nextTarget;
    if (nextTarget) {
      const t = L.findLevel(nextTarget);
      if (reviewQueue.length) {
        $("btn-next").textContent = `继续复习（还剩 ${reviewQueue.length} 关）▶`;
      } else if (courseRun) {
        $("btn-next").textContent = "继续这一课 ▶";
      } else {
        $("btn-next").textContent =
          t && t.world === lv.world ? "下一关 ▶" : "进入下一个档案 ▶";
      }
    }

    showScreen("screen-done");
  }

  function onSolved() {
    showDone(session.level, {});
  }

  function confetti() {
    const box = $("confetti");
    box.hidden = false;
    box.innerHTML = "";
    const emojis = ["🎉", "⭐", "✨", "🎊", "🏅", "💫"];
    for (let i = 0; i < 34; i++) {
      const s = document.createElement("span");
      s.textContent = emojis[i % emojis.length];
      s.style.left = Math.random() * 100 + "%";
      s.style.animationDuration = 1.8 + Math.random() * 1.6 + "s";
      s.style.animationDelay = Math.random() * 0.5 + "s";
      box.appendChild(s);
    }
    setTimeout(() => {
      box.hidden = true;
      box.innerHTML = "";
    }, 4200);
  }

  // ------------------------------------------------------------ 选择题

  let quiz = null;

  function startQuiz(level) {
    quiz = {
      level,
      found: new Set(),
      wrong: new Set(),
      answers: level.options.map((o) => o.correct),
    };
    session = null;
    teachLevel = null;
    $("proof-view").hidden = true;
    $("quiz-view").hidden = false;
    $("teach-view").hidden = true;
    $("summary-view").hidden = true;
    $("create-view").hidden = true;
    $("quiz-title").textContent = level.title;
    const qBrief = (level.intro || "").trim();
    $("quiz-brief").hidden = !qBrief;
    if (qBrief) {
      $("quiz-brief-body").innerHTML = mdToHtml(qBrief);
      $("quiz-brief").open = true;
    }

    const need = level.options.filter((o) => o.correct).length;
    $("quiz-question").innerHTML =
      mdToHtml(level.question) +
      (need > 1
        ? `<p style="font-size:15px;color:var(--warn);font-weight:700">这一题有 ${need} 个正确答案，要全都找出来哦！</p>`
        : "");
    renderQuiz();
  }

  function renderQuiz() {
    const level = quiz.level;
    const need = level.options.filter((o) => o.correct).length;
    const box = $("quiz-options");
    box.innerHTML = "";
    level.options.forEach((opt, i) => {
      const btn = document.createElement("button");
      const isFound = quiz.found.has(i);
      const isWrong = quiz.wrong.has(i);
      btn.className =
        "quiz-option" +
        (isFound ? " correct" : "") +
        (isWrong ? " wrong" : "") +
        (!isFound && !isWrong && (quiz.found.size || quiz.wrong.size) ? " dimmed" : "");
      btn.disabled = isFound || isWrong;
      btn.innerHTML = `<span class="opt-mark">${String.fromCharCode(
        65 + i
      )}</span><span>${inlineMd(opt.text)}</span>`;
      btn.onclick = () => onQuizAnswer(i);
      box.appendChild(btn);
    });

    // 已经找到的答案解释
    const texts = [];
    quiz.found.forEach((i) =>
      texts.push("✅ **" + level.options[i].text + "** —— " + level.options[i].why)
    );
    quiz.wrong.forEach((i) =>
      texts.push("❌ **" + level.options[i].text + "** —— " + level.options[i].why)
    );
    const fb = $("quiz-feedback");
    if (texts.length) {
      fb.hidden = false;
      fb.className = "feedback info";
      fb.innerHTML = texts.map((t) => mdToHtml(t)).join("");
    } else {
      fb.hidden = true;
    }

    if (quiz.found.size >= need) {
      setTimeout(() => onQuizSolved(), 900);
    }
  }

  function onQuizAnswer(i) {
    const opt = quiz.level.options[i];
    if (opt.correct) {
      quiz.found.add(i);
      sfxStep();
    } else {
      quiz.wrong.add(i);
      sfxOops();
    }
    renderQuiz();
  }

  function onQuizSolved() {
    showDone(quiz.level, {
      emoji: "🌟",
      title: "答对啦！",
      replayTitle: "又答对一次！",
    });
  }

  // ============================================================ 设置

  function openSettings() {
    $("opt-hints-highlight").checked = !!save.settings.highlight;
    $("opt-sound").checked = !!save.settings.sound;
    $("opt-show-formula").checked = !!save.settings.legend;
    $("settings-modal").hidden = false;
  }
  function closeSettings() {
    save.settings.highlight = $("opt-hints-highlight").checked;
    save.settings.sound = $("opt-sound").checked;
    save.settings.legend = $("opt-show-formula").checked;
    persist();
    $("settings-modal").hidden = true;
    updateSoundIcon();
    if (currentScreen === "screen-level" && session) renderProof();
  }
  function updateSoundIcon() {
    $("btn-sound").textContent = save.settings.sound ? "🔊" : "🔇";
  }

  // ============================================================ 武器库
  //
  // 参考 lean4game 的 Inventory：把已经学会的工具集中放在一个地方，随时能翻。
  // 对孩子有两层用处：
  //   ① 忘了某张卡是干什么的，不用回去翻案情简介；
  //   ② 看见还锁着的东西，会想着「再破几关就能拿到」—— 这是收集的动力。

  let invTab = "cards";

  function openInventory(tab) {
    if (tab) invTab = tab;
    renderInventory();
    $("inventory").hidden = false;
  }

  function renderInventory() {
    [...document.querySelectorAll(".inv-tab")].forEach((b) =>
      b.classList.toggle("active", b.dataset.tab === invTab)
    );

    const body = $("inv-body");
    body.innerHTML = "";

    /** 造一张方法卡条目 */
    function cardItem(t) {
      // 「已解锁」＝介绍弹层弹过（seenCards），或者孩子已经推进到介绍它的那个档案
      const introLv = L.cardIntroLevel(t.id);
      const unlocked =
        !!save.seenCards[t.id] ||
        (!!introLv && L.isWorldUnlocked(introLv.world, save.solved));
      const guide = L.CARD_GUIDE[t.id] || {};
      const el = document.createElement("div");
      el.className = "inv-item" + (unlocked ? "" : " locked");
      el.dataset.card = t.id;
      el.style.setProperty("--tone", TONES[t.card.tone] || "#5b6ef5");
      const head =
        `<div class="iv-head"><span style="font-size:20px">${t.card.emoji}</span>` +
        `<span>${unlocked ? esc(t.card.name) : "？？？"}</span></div>`;
      if (unlocked) {
        el.innerHTML =
          head +
          `<div class="iv-tip">${inlineMd(t.card.tip)}</div>` +
          (guide.when
            ? `<div class="iv-when">💡 <b>什么时候用：</b>${inlineMd(guide.when)}</div>`
            : "") +
          (guide.example ? `<div class="iv-ex">🔎 ${inlineMd(guide.example)}</div>` : "");
      } else {
        const w = introLv ? L.WORLDS[L.WORLD_INDEX[introLv.world]] : null;
        el.innerHTML =
          head + `<div class="iv-lock">🔒 在「${esc(w ? w.name : "后面的档案")}」拿到</div>`;
      }
      return el;
    }

    if (invTab === "cards") {
      // 按用途分组显示，而不是铺成一长条
      const byId = {};
      L.TACTICS.forEach((t) => (byId[t.id] = t));
      const placed = new Set();
      const groups = (L.CARD_GROUPS || []).map((g) => ({
        name: g.name,
        cards: g.ids.map((id) => byId[id]).filter(Boolean),
      }));
      groups.forEach((g) => g.cards.forEach((t) => placed.add(t.id)));
      const rest = L.TACTICS.filter((t) => !placed.has(t.id));
      if (rest.length) groups.push({ name: "🃏 其他", cards: rest });

      groups.forEach((g) => {
        if (!g.cards.length) return;
        const title = document.createElement("div");
        title.className = "inv-group-title";
        title.textContent = g.name;
        body.appendChild(title);
        const grid = document.createElement("div");
        grid.className = "inv-group";
        g.cards.forEach((t) => grid.appendChild(cardItem(t)));
        body.appendChild(grid);
      });
    } else {
      L.SYMBOLS.forEach((s) => {
        // 和卡片一样：绑定到「介绍它那一页」，不是另写的字段
        const introLv = L.symbolIntroLevel(s.sym);
        const unlocked =
          !!introLv && L.isWorldUnlocked(introLv.world, save.solved);
        const el = document.createElement("div");
        el.className = "inv-item" + (unlocked ? "" : " locked");
        el.dataset.symbol = s.sym;
        el.style.setProperty("--tone", TONES[s.tone] || "#5b6ef5");
        if (unlocked) {
          el.innerHTML =
            `<div class="iv-sym op-${s.tone}">${s.sym}</div>` +
            `<div class="iv-head" style="justify-content:center"><span>${esc(s.name)}</span></div>` +
            `<div class="iv-tip" style="text-align:center">${inlineMd(s.read)}</div>` +
            `<div class="iv-when">📖 <b>意思：</b>${inlineMd(s.meaning)}</div>` +
            `<div class="iv-ex">🔎 ${inlineMd(s.example)}</div>`;
        } else {
          const w = introLv ? L.WORLDS[L.WORLD_INDEX[introLv.world]] : null;
          el.innerHTML =
            `<div class="iv-sym">？</div>` +
            `<div class="iv-lock" style="text-align:center">🔒 在「${esc(
              w ? w.name : "后面的档案"
            )}」认识它</div>`;
        }
        body.appendChild(el);
      });
    }
  }

  // ============================================================ 事件绑定

  function back() {
    if (currentScreen === "screen-level") {
      if (currentWorldId) openWorld(currentWorldId);
      else showScreen("screen-home");
    } else if (currentScreen === "screen-world" || currentScreen === "screen-lessons") {
      renderHome();
      showScreen("screen-home");
    } else if (currentScreen === "screen-done") {
      if (currentWorldId) openWorld(currentWorldId);
      else {
        renderHome();
        showScreen("screen-home");
      }
    }
  }

  function bind() {
    $("btn-back").onclick = back;
    $("btn-sound").onclick = () => {
      save.settings.sound = !save.settings.sound;
      persist();
      updateSoundIcon();
      if (save.settings.sound) sfxClick();
    };
    $("btn-settings").onclick = openSettings;
    $("btn-close-settings").onclick = closeSettings;
    $("settings-modal").onclick = (e) => {
      if (e.target.id === "settings-modal") closeSettings();
    };
    $("btn-clear-progress").onclick = () => {
      if (!window.confirm("确定要清空全部进度吗？这个操作不能撤销。")) return;
      save = defaultSave();
      persist();
      updateSoundIcon();
      $("settings-modal").hidden = true;
      renderHome();
      showScreen("screen-home");
    };

    $("btn-continue").onclick = () => {
      const n = nextPlayable();
      if (n) openLevel(n.id);
    };
    $("btn-lessons").onclick = () => {
      sfxClick();
      renderLessons();
      showScreen("screen-lessons");
    };
    $("btn-review").onclick = () => {
      const due = dueReviews().slice(0, REVIEW_BATCH);
      if (!due.length) return;
      sfxClick();
      reviewQueue = due.slice();
      reviewUsedHint = false;
      openLevel(reviewQueue[0]);
    };

    $("btn-undo").onclick = undo;
    $("btn-hint").onclick = () => {
      // 复习时看了提示，说明这次不是「自己想起来」的 —— 排期要退回第一格
      if (reviewQueue.length) reviewUsedHint = true;
      showHint();
    };
    $("btn-reset").onclick = resetLevel;
    $("btn-cancel-pick").onclick = cancelPick;
    $("btn-quiz-reset").onclick = () => startQuiz(quiz.level);
    $("btn-create-check").onclick = () => {
      sfxClick();
      checkCreate();
    };
    $("btn-create-reset").onclick = () => {
      if (createLevel) startCreate(createLevel);
    };
    $("btn-summary-done").onclick = () => {
      if (!summaryLevel) return;
      // 孩子写的话存下来（不判对错）—— 写的过程本身就是复述
      const text = $("summary-note").value.trim();
      if (text) save.notes[summaryLevel.id] = text;
      else delete save.notes[summaryLevel.id];
      persist();
      showDone(summaryLevel, {
        emoji: summaryLevel.emoji || "🎓",
        title: "这一课收工啦！",
      });
    };

    $("btn-next").onclick = () => {
      if (!nextTarget) return;
      const id = nextTarget;
      nextTarget = null;
      openLevel(id);
    };
    $("btn-done-back").onclick = () => {
      const lv = currentLevel;
      // 离开课程模式：下次从「学习路线」重新开始一课
      courseRun = null;
      reviewQueue = [];
      nextTarget = null;
      if (!lv) return;
      currentWorldId = lv.world;
      openWorld(lv.world);
    };

    // ---- 介绍关 ----
    $("btn-teach-done").onclick = () => {
      if (!teachLevel) return;
      showDone(teachLevel, {
        emoji: teachLevel.emoji || "📖",
        title: "又认识一个新符号！",
        replayTitle: "再看一遍也挺好",
      });
    };

    // ---- 武器库 ----
    $("btn-inventory").onclick = () => {
      sfxClick();
      openInventory();
    };
    $("btn-close-inventory").onclick = () => {
      $("inventory").hidden = true;
    };
    $("inventory").onclick = (e) => {
      if (e.target.id === "inventory") $("inventory").hidden = true;
    };
    [...document.querySelectorAll(".inv-tab")].forEach((b) => {
      b.onclick = () => {
        invTab = b.dataset.tab;
        sfxClick();
        renderInventory();
      };
    });

    // 键盘快捷键（给大一点的孩子）
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("settings-modal").hidden) closeSettings();
      else if (!$("inventory").hidden) $("inventory").hidden = true;
      else if (session && session.pick) cancelPick();
      else back();
    });
  }

  // ============================================================ 启动

  function boot() {
    bind();
    updateSoundIcon();
    renderHome();
    showScreen("screen-home");
    console.log(
      `%c🔍 逻辑小侦探 已就绪`,
      "color:#5b6ef5;font-weight:bold;font-size:14px",
      `\n${L.WORLDS.length} 个世界 / ${L.LEVELS.length} 关 / ${L.TACTICS.length} 张方法卡` +
        `\n证明内核：自然演绎，共 ${L.TACTICS.length} 条推理规则`
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
