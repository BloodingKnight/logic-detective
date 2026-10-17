/*!
 * 《逻辑小侦探》— 证明内核（第 2 层：推理）
 *
 * 这是一台「真的」证明检查器：它实现的是经典的**自然演绎**（natural deduction）。
 * 规则只有下面这些，每一条都是可靠的（sound）：
 *
 *     →I 先假设      Γ, A ⊢ B    ⟹  Γ ⊢ A → B
 *     →E 串起来      Γ ⊢ A, A→B  ⟹  Γ ⊢ B
 *     ∧I 合起来      Γ ⊢ A, B    ⟹  Γ ⊢ A ∧ B
 *     ∧E 拆开线索    Γ ⊢ A ∧ B   ⟹  Γ ⊢ A 且 Γ ⊢ B
 *     ∨I 只证一边    Γ ⊢ A       ⟹  Γ ⊢ A ∨ B
 *     ∨E 分情况      Γ ⊢ A∨B, Γ,A⊢C, Γ,B⊢C ⟹ Γ ⊢ C
 *     ¬I 先假设      Γ, A ⊢ ⊥    ⟹  Γ ⊢ ¬A
 *     ⊥E 出现矛盾    Γ ⊢ ⊥（或同时有 P 和 ¬P）⟹ Γ ⊢ 任何结论
 *     反证法         Γ, ¬A ⊢ ⊥   ⟹  Γ ⊢ A       （经典逻辑的特征规则）
 *     一分为二       Γ,A ⊢ C, Γ,¬A ⊢ C ⟹ Γ ⊢ C  （排中律，等价于 A ∨ ¬A）
 *     引理(cut)      Γ ⊢ A, Γ,A ⊢ C ⟹ Γ ⊢ C
 *
 * 孩子点的是「方法卡」，背后走的都是上面某一条。所以孩子每一步推理
 * 都是被机器真正验证过的 —— 不是「看起来对」，而是「确实对」。
 *
 * 状态结构：
 *   Hyp   = { id, f: Formula, tag: 'given' | 'assume' | 'derived' }
 *   Goal  = { hyps: Hyp[], target: Formula }
 *   State = { goals: Goal[], nextId: number }
 *
 * 注意 nextId 是**放在状态里**的，不是全局计数器。这样「同一个局面」
 * 每次重建都会得到一模一样的线索编号 —— 求解器给出的路线才能被重放、
 * 被测试检查。（早期版本用全局计数器，重放时 id 全对不上。）
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./logic.js"));
  } else {
    root.LD = Object.assign(root.LD || {}, factory(root.LD));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (L) {
  "use strict";

  const {
    falsum,
    not,
    and,
    or,
    imp,
    eq,
    key,
    show,
    // 项与等式（「替换世界」用）
    num,
    vr,
    add,
    mul,
    succ,
    equation,
    isEquation,
    termEq,
    showTerm,
    computeTerm,
    substFormula,
    formulaTermVars,
  } = L;

  // ------------------------------------------------------------ 状态工具

  const copyHyps = (g) =>
    g.hyps.map((h) => ({ id: h.id, f: h.f, tag: h.tag, rule: h.rule }));
  const cloneGoal = (g) => ({ hyps: copyHyps(g), target: g.target });
  const cloneState = (s) => ({
    goals: s.goals.map(cloneGoal),
    nextId: s.nextId,
  });
  const focused = (s) => s.goals[0];
  const isSolved = (s) => s.goals.length === 0;

  /** 目标里加一条线索。assume 出来的假设永远保留（用于显示「我们现在假装…」）。 */
  function addHyp(goal, f, tag, ctx) {
    if (tag !== "assume" && goal.hyps.some((h) => eq(h.f, f))) return null;
    const h = { id: ctx.fresh(), f, tag };
    goal.hyps.push(h);
    return h;
  }

  /** 有没有自相矛盾：要么有 ⊥，要么同时有 P 和 ¬P */
  function findContradiction(hyps) {
    const bot = hyps.find((h) => h.f.k === "false");
    if (bot) return { kind: "false", hyp: bot };
    for (const b of hyps) {
      if (b.f.k !== "not") continue;
      for (const a of hyps) {
        if (a !== b && eq(b.f.a, a.f)) return { kind: "pair", a, b };
      }
    }
    return null;
  }

  /** 两条线索能不能配成一次「因为…所以…」 */
  function matchMP(a, b) {
    if (a.f.k === "imp" && eq(a.f.a, b.f)) return { imp: a, arg: b };
    if (b.f.k === "imp" && eq(b.f.a, a.f)) return { imp: b, arg: a };
    return null;
  }

  /**
   * 当前局面里「出现过」的所有子公式（key → 公式）。
   *
   * 这是给「合起来」「先立个小目标」「一分为二」用的护栏。没有它，
   * 可以无中生有地造出「A∧B」「(A∧B)∧C」「((A∧B)∧C)∧D」…… 状态空间会指数爆炸。
   * 加上护栏之后，只有后面真用得上的公式才允许出现 —— 既够用，又不会炸。
   * （对孩子来说这条规则也更自然：拼出来的线索总得有人用。）
   */
  function subformulas(goal) {
    const map = new Map();
    const go = (f) => {
      const k = key(f);
      if (map.has(k)) return;
      map.set(k, f);
      if (f.k === "not") go(f.a);
      else if (f.k === "and" || f.k === "or" || f.k === "imp") {
        go(f.a);
        go(f.b);
      }
    };
    go(goal.target);
    for (const h of goal.hyps) go(h.f);
    return map;
  }

  /** 「选公式」类卡片的候选：局面里出现过的、还没被当成线索的公式 */
  function formulaCandidates(goal, opts) {
    const o = opts || {};
    const rel = subformulas(goal);
    const taken = new Set(goal.hyps.map((h) => key(h.f)));
    if (o.excludeTarget) taken.add(key(goal.target));
    taken.add(key(falsum()));
    return [...rel.entries()]
      .filter(([k]) => !taken.has(k))
      .map(([k, f]) => ({ id: k, f }))
      .sort((a, b) => show(a.f).localeCompare(show(b.f), "zh"));
  }

  // ------------------------------------------------ 等式推理：匹配与改写
  //
  // 「替换」这张卡的背后是莱布尼茨律：既然 a = b，那么任何出现 a 的地方
  // 都可以换成 b。技术上要做两件事：
  //   ① 模式匹配 —— 规则 `n + 0 = n` 里的 n 是个**占位符**，
  //      拿它去匹配 `(x + 1) + 0` 要能得出 n := (x + 1)
  //   ② 全部替换 —— 像 Lean 的 rw 一样，把目标里所有匹配的地方都换掉

  /**
   * 单向模式匹配：把规则左式里的**占位符变量**对应到目标里的子算式上。
   *
   * ★ 这里有个容易搞错、而且搞错就不健全的地方：
   *   变量分两种，必须区别对待。
   *
   *   · **线索**（givens）是关于**特定对象**的事实。`y = x + 7` 里的 y 就是 y，
   *     它只能去匹配目标里那个名叫 y 的变量。
   *   · **规则**（rules）是普遍成立的定律。`n + 0 = n` 里的 n 是**占位符**，
   *     可以代入任何算式（比如 (x + 1)）。
   *
   *   一开始我把两者都当占位符，结果 `a = b` 变成「把任何东西换成 b」，
   *   于是 `a + c = b + b` 被"证明"了 —— 完全不健全。
   *   这也是 Lean 里「假设 h : y = x+7」和「引理 add_zero : ∀ n, n+0=n」的区别。
   *
   * schema = 这条等式里哪些变量名是占位符（线索的话就是空集）。
   */
  function matchTerm(pattern, subject, binding, schema) {
    if (pattern.t === "var") {
      if (!schema.has(pattern.name)) {
        // 固定变量：目标里必须出现同名的那个变量
        return subject.t === "var" && subject.name === pattern.name;
      }
      const bound = binding.get(pattern.name);
      if (bound === undefined) {
        binding.set(pattern.name, subject);
        return true;
      }
      // 同一个占位符出现两次，就必须匹配到完全相同的算式
      return termEq(bound, subject);
    }
    if (pattern.t !== subject.t) return false;
    switch (pattern.t) {
      case "num":
        return pattern.n === subject.n;
      case "succ":
        return matchTerm(pattern.a, subject.a, binding, schema);
      default:
        return (
          matchTerm(pattern.a, subject.a, binding, schema) &&
          matchTerm(pattern.b, subject.b, binding, schema)
        );
    }
  }

  /** 把匹配到的占位符填回规则右式。固定变量不在 binding 里，原样保留。 */
  function instantiate(pattern, binding) {
    switch (pattern.t) {
      case "var": {
        const b = binding.get(pattern.name);
        return b === undefined ? pattern : b;
      }
      case "num":
        return pattern;
      case "succ":
        return succ(instantiate(pattern.a, binding));
      default: {
        const a = instantiate(pattern.a, binding);
        const b = instantiate(pattern.b, binding);
        return pattern.t === "add" ? add(a, b) : mul(a, b);
      }
    }
  }

  /**
   * 在算式里把所有能匹配 lhs 的地方换成 rhs。外层优先。
   *
   * 有一条护栏：**光杆占位符不许当改写目标**。
   * 否则规则 `n + 0 = n` 反着用就变成「任何算式都可以写成它加 0」，
   * 虽然每步都合法，但目标里每个子算式都能换，搜索空间会炸掉。
   */
  function rewriteTermAll(t, lhs, rhs, schema) {
    const trivial = lhs.t === "var" && schema.has(lhs.name);
    if (!trivial) {
      const b = new Map();
      if (matchTerm(lhs, t, b, schema)) {
        return { term: instantiate(rhs, b), count: 1 };
      }
    }
    switch (t.t) {
      case "succ": {
        const r = rewriteTermAll(t.a, lhs, rhs, schema);
        return r.count
          ? { term: succ(r.term), count: r.count }
          : { term: t, count: 0 };
      }
      case "add":
      case "mul": {
        const a = rewriteTermAll(t.a, lhs, rhs, schema);
        const c = rewriteTermAll(t.b, lhs, rhs, schema);
        if (!a.count && !c.count) return { term: t, count: 0 };
        return {
          term: t.t === "add" ? add(a.term, c.term) : mul(a.term, c.term),
          count: a.count + c.count,
        };
      }
      default:
        return { term: t, count: 0 };
    }
  }

  /** 在整条公式里做改写（等式两边都要走到） */
  function rewriteFormula(f, lhs, rhs, schema) {
    if (f.k === "eq") {
      const a = rewriteTermAll(f.a, lhs, rhs, schema);
      const b = rewriteTermAll(f.b, lhs, rhs, schema);
      if (!a.count && !b.count) return { f, count: 0 };
      return { f: equation(a.term, b.term), count: a.count + b.count };
    }
    if (f.k === "not") {
      const r = rewriteFormula(f.a, lhs, rhs, schema);
      return r.count ? { f: not(r.f), count: r.count } : { f, count: 0 };
    }
    if (f.k === "and" || f.k === "or" || f.k === "imp") {
      const a = rewriteFormula(f.a, lhs, rhs, schema);
      const b = rewriteFormula(f.b, lhs, rhs, schema);
      if (!a.count && !b.count) return { f, count: 0 };
      const mk = f.k === "and" ? and : f.k === "or" ? or : imp;
      return { f: mk(a.f, b.f), count: a.count + b.count };
    }
    return { f, count: 0 };
  }

  const NO_SCHEMA = new Set();

  /** 挑一个目标里没用过的变量名，给归纳法的「假设那个数」用 */
  function freshVar(goal, avoid) {
    const used = new Set([avoid]);
    for (const n of formulaTermVars(goal.target)) used.add(n);
    for (const h of goal.hyps) for (const n of formulaTermVars(h.f)) used.add(n);
    for (const c of ["k", "j", "i", "a", "b", "c"]) if (!used.has(c)) return vr(c);
    let i = 1;
    while (used.has("k" + i)) i++;
    return vr("k" + i);
  }

  /** 这条等式里哪些变量是占位符（线索 → 空集；规则 → 它出现的全部变量） */
  function ruleSchema(hyp) {
    if (!hyp.rule || !isEquation(hyp.f)) return NO_SCHEMA;
    return L.formulaTermVars(hyp.f);
  }

  /** 用一条等式改写目标。forward=true 表示左换右。 */
  function applyRewrite(hyp, target, forward) {
    const sc = ruleSchema(hyp);
    const lhs = forward ? hyp.f.a : hyp.f.b;
    const rhs = forward ? hyp.f.b : hyp.f.a;
    return rewriteFormula(target, lhs, rhs, sc);
  }

  /** 算一算：把公式里能算的 + 和 × 都算出来 */
  function computeFormula(f) {
    if (f.k === "eq") {
      const a = computeTerm(f.a);
      const b = computeTerm(f.b);
      if (!a.changed && !b.changed) return { f, changed: false };
      return { f: equation(a.term, b.term), changed: true };
    }
    if (f.k === "not") {
      const r = computeFormula(f.a);
      return r.changed ? { f: not(r.f), changed: true } : { f, changed: false };
    }
    if (f.k === "and" || f.k === "or" || f.k === "imp") {
      const a = computeFormula(f.a);
      const b = computeFormula(f.b);
      if (!a.changed && !b.changed) return { f, changed: false };
      const mk = f.k === "and" ? and : f.k === "or" ? or : imp;
      return { f: mk(a.f, b.f), changed: true };
    }
    return { f, changed: false };
  }

  // ------------------------------------------------------------ 方法卡

  const TACTICS = [
    // -------- 结案 --------
    {
      id: "exact",
      prio: 0,
      arity: 1,
      card: {
        name: "就是它！",
        emoji: "🎯",
        tone: "green",
        tip: "手上有一条线索，和要证明的结论一模一样 —— 那就直接结案。",
      },
      pickPrompt: () => "点一下那条和结论完全一样的线索",
      candidates: (g) => g.hyps.filter((h) => eq(h.f, g.target)),
      run: (g, [h]) => ({
        goals: [],
        message: `线索「${show(h.f)}」正是要证明的结论 —— 结案！`,
      }),
    },

    // -------- 蕴含 --------
    {
      id: "mp",
      prio: 3,
      arity: 2,
      card: {
        name: "串起来",
        emoji: "🔗",
        tone: "blue",
        tip: "有「P」又有「P → Q」，就能得到新线索「Q」。这就是「因为…所以…」。",
      },
      pickPrompt: (picked) =>
        picked.length === 0
          ? "先点一条线索（「如果…那么…」或者它的前提都行）"
          : "再点一条，和刚才那条配成一对",
      candidates: (g, picked) => {
        if (picked.length === 0) {
          return g.hyps.filter((h) =>
            g.hyps.some((o) => o.id !== h.id && matchMP(h, o))
          );
        }
        const first = picked[0];
        return g.hyps.filter(
          (o) => o.id !== first.id && matchMP(first, o)
        );
      },
      run: (g, [p, q], ctx) => {
        const m = matchMP(p, q);
        const got = m.imp.f.b;
        const added = addHyp(g, got, "derived", ctx);
        return {
          goals: [g],
          message: added
            ? `「${show(m.arg.f)}」配上「${show(m.imp.f)}」，推出新线索「${show(
                got
              )}」。`
            : `「${show(got)}」这条线索我们已经有了。`,
        };
      },
    },
    {
      id: "assume",
      prio: 1,
      arity: 0,
      card: {
        name: "先假设",
        emoji: "🤔",
        tone: "purple",
        tip: "要证明「如果 P 那么 Q」，就先假装 P 是对的，然后想办法推出 Q。",
      },
      visible: (g) => g.target.k === "imp" || g.target.k === "not",
      run: (g, _picked, ctx) => {
        const assum = g.target.a;
        const isImp = g.target.k === "imp";
        const hyps = copyHyps(g);
        hyps.push({ id: ctx.fresh(), f: assum, tag: "assume" });
        return {
          goals: [{ hyps, target: isImp ? g.target.b : falsum() }],
          message: isImp
            ? `好，我们先假装「${show(assum)}」是对的，再想办法推出「${show(
                g.target.b
              )}」。`
            : `好，我们先假装「${show(
                assum
              )}」是对的，看看会不会推出矛盾（⊥）。`,
        };
      },
    },
    {
      id: "apply",
      prio: 2,
      arity: 1,
      card: {
        name: "只差一步",
        emoji: "🪜",
        tone: "blue",
        tip: "有「P → Q」，要证明 Q，那么只要再证明 P 就够了。",
      },
      pickPrompt: () =>
        "点一下那条「如果…那么…」的线索，它的结论正好是我们要证的东西",
      candidates: (g) =>
        g.hyps.filter((h) => h.f.k === "imp" && eq(h.f.b, g.target)),
      run: (g, [h]) => ({
        goals: [{ hyps: copyHyps(g), target: h.f.a }],
        message: `因为「${show(h.f)}」，所以只要证明「${show(
          h.f.a
        )}」，就能得到「${show(g.target)}」啦。`,
      }),
    },

    // -------- 且 --------
    {
      id: "andElim",
      prio: 3,
      arity: 1,
      card: {
        name: "拆开线索",
        emoji: "✂️",
        tone: "blue",
        tip: "「P 且 Q」这条线索里，同时藏着 P 和 Q，两个都能拿出来用。",
      },
      pickPrompt: () => "点一下那条「…且…」的线索",
      candidates: (g) => g.hyps.filter((h) => h.f.k === "and"),
      run: (g, [h], ctx) => {
        const a = addHyp(g, h.f.a, "derived", ctx);
        const b = addHyp(g, h.f.b, "derived", ctx);
        const got = [];
        if (a) got.push(show(h.f.a));
        if (b) got.push(show(h.f.b));
        return {
          goals: [g],
          message: got.length
            ? `把「${show(h.f)}」拆开，得到新线索：${got.join("、")}。`
            : `「${show(h.f)}」已经拆开过了。`,
        };
      },
    },
    {
      id: "andIntroFwd",
      prio: 4,
      arity: 2,
      card: {
        name: "合起来",
        emoji: "🧩",
        tone: "blue",
        tip: "已经有「P」，也有「Q」，就能得到新线索「P 且 Q」。",
      },
      pickPrompt: (picked) =>
        picked.length === 0 ? "先点第一条线索" : "再点一条，把两条合起来",
      candidates: (g, picked) => {
        const rel = subformulas(g);
        if (picked.length === 0) {
          return g.hyps.filter((h) =>
            g.hyps.some((o) => o.id !== h.id && rel.has(key(and(h.f, o.f))))
          );
        }
        return g.hyps.filter(
          (h) => h.id !== picked[0].id && rel.has(key(and(picked[0].f, h.f)))
        );
      },
      run: (g, [p, q], ctx) => {
        const both = and(p.f, q.f);
        const added = addHyp(g, both, "derived", ctx);
        return {
          goals: [g],
          message: added
            ? `把「${show(p.f)}」和「${show(q.f)}」合起来，得到新线索「${show(
                both
              )}」。`
            : `「${show(both)}」这条线索我们已经有了。`,
        };
      },
    },
    {
      id: "andIntro",
      prio: 1,
      arity: 0,
      card: {
        name: "分开证明",
        emoji: "🎯",
        tone: "blue",
        tip: "要证明「P 且 Q」，得分别证明 P 和 Q 两件事。",
      },
      visible: (g) => g.target.k === "and",
      run: (g) => ({
        goals: [
          { hyps: copyHyps(g), target: g.target.a },
          { hyps: copyHyps(g), target: g.target.b },
        ],
        message: `要证明「${show(g.target)}」，得分别证明「${show(
          g.target.a
        )}」和「${show(g.target.b)}」两件事。`,
      }),
    },

    // -------- 或 --------
    {
      id: "orIntroL",
      prio: 1,
      arity: 0,
      card: {
        name: "只证左边",
        emoji: "👈",
        tone: "orange",
        tip: "「P 或 Q」比较宽松：只要 P 成立，它就已经成立了。",
      },
      visible: (g) => g.target.k === "or",
      run: (g) => ({
        goals: [{ hyps: copyHyps(g), target: g.target.a }],
        message: `「${show(g.target)}」只要左边「${show(
          g.target.a
        )}」成立就够了 —— 来证明它。`,
      }),
    },
    {
      id: "orIntroR",
      prio: 1,
      arity: 0,
      card: {
        name: "只证右边",
        emoji: "👉",
        tone: "orange",
        tip: "「P 或 Q」比较宽松：只要 Q 成立，它就已经成立了。",
      },
      visible: (g) => g.target.k === "or",
      run: (g) => ({
        goals: [{ hyps: copyHyps(g), target: g.target.b }],
        message: `「${show(g.target)}」只要右边「${show(
          g.target.b
        )}」成立就够了 —— 来证明它。`,
      }),
    },
    {
      id: "orElim",
      prio: 2,
      arity: 1,
      card: {
        name: "分情况讨论",
        emoji: "🔀",
        tone: "orange",
        tip: "已知「P 或 Q」，不知道是哪一个 —— 那就两种可能各证明一次。",
      },
      pickPrompt: () => "点一下那条「…或…」的线索",
      candidates: (g) => g.hyps.filter((h) => h.f.k === "or"),
      run: (g, [h], ctx) => {
        const branch = (assum) => {
          const hyps = copyHyps(g);
          hyps.push({ id: ctx.fresh(), f: assum, tag: "assume" });
          return { hyps, target: g.target };
        };
        return {
          goals: [branch(h.f.a), branch(h.f.b)],
          message: `「${show(h.f)}」有两种可能。先假设「${show(
            h.f.a
          )}」，再假设「${show(h.f.b)}」，两种情况都要能推出「${show(
            g.target
          )}」。`,
        };
      },
    },

    // -------- 矛盾 --------
    {
      id: "raa",
      prio: 2,
      arity: 0,
      card: {
        name: "反证法",
        emoji: "↩️",
        tone: "purple",
        tip: "先假设结论是错的。如果这样会推出矛盾，就说明结论其实是对的。",
      },
      visible: (g) => g.target.k !== "false" && g.target.k !== "not",
      run: (g, _picked, ctx) => {
        const hyps = copyHyps(g);
        hyps.push({ id: ctx.fresh(), f: not(g.target), tag: "assume" });
        return {
          goals: [{ hyps, target: falsum() }],
          message: `我们假装「${show(g.target)}」是错的（也就是「${show(
            not(g.target)
          )}」），看看会不会推出矛盾。`,
        };
      },
    },
    {
      id: "contradiction",
      prio: 0,
      arity: 0,
      card: {
        name: "出现矛盾",
        emoji: "💥",
        tone: "red",
        tip: "同时有「P」和「非 P」，说明某个假设不可能成立 —— 这时什么结论都能得出来。",
      },
      visible: (g) => !!findContradiction(g.hyps),
      run: (g) => {
        const c = findContradiction(g.hyps);
        return {
          goals: [],
          message:
            c.kind === "false"
              ? "线索里出现了 ⊥（不可能的事），所以这一关的目标自动成立！"
              : `线索里同时有「${show(c.a.f)}」和「${show(
                  c.b.f
                )}」，互相打架 —— 说明我们刚才的那个假设是错的。`,
        };
      },
    },

    // -------- 中间结论（引理） --------
    {
      id: "have",
      prio: 6,
      arity: 1,
      pickKind: "formula",
      card: {
        name: "先立个小目标",
        emoji: "💡",
        tone: "purple",
        tip: "先证明一个中间的小结论，证完它就会变成一条新线索。数学家用这一招时，管它叫「引理」。",
      },
      pickPrompt: () => "选一个想先证明的小结论（证完它就成了新线索）",
      candidates: (g) => formulaCandidates(g, { excludeTarget: true }),
      run: (g, [pick], ctx) => {
        const F = pick.f;
        const lemmaGoal = { hyps: copyHyps(g), target: F };
        const hypsAfter = copyHyps(g);
        hypsAfter.push({ id: ctx.fresh(), f: F, tag: "derived" });
        const mainGoal = { hyps: hypsAfter, target: g.target };
        return {
          goals: [lemmaGoal, mainGoal],
          message: `好，先证明小结论「${show(
            F
          )}」。证完之后它就变成一条新线索，我们再用它来解决原来的问题。`,
        };
      },
    },

    // -------- 排中律：一分为二 --------
    {
      id: "lem",
      prio: 5,
      arity: 1,
      pickKind: "formula",
      card: {
        name: "一分为二",
        emoji: "⚖️",
        tone: "orange",
        tip: "任何一句话，要么成立，要么不成立 —— 没有第三种可能。两种可能各走一遍。",
      },
      pickPrompt: () => "选一句话，把它分成「成立」和「不成立」两种情况",
      // 只对**最基本的一句话**（原子命题）分情况，比如「甲是骑士」。
      // 对「甲是骑士 ∧ 乙是骑士」这种复合句子分情况既没意义（两种情况里
      // 都还得再拆），又会让搜索分支爆炸。对孩子来说也更自然：
      // 「要么他是骑士，要么他不是」，分的就是最基础的那件事。
      candidates: (g) =>
        formulaCandidates(g, { excludeTarget: false }).filter(
          (c) => c.f.k === "atom"
        ),
      run: (g, [pick], ctx) => {
        const F = pick.f;
        const branch = (assum) => {
          const hyps = copyHyps(g);
          hyps.push({ id: ctx.fresh(), f: assum, tag: "assume" });
          return { hyps, target: g.target };
        };
        return {
          goals: [branch(F), branch(not(F))],
          message: `我们分两种情况来看：先假设「${show(F)}」，再假设「${show(
            not(F)
          )}」。两种都要能推出「${show(g.target)}」。`,
        };
      },
    },

    // -------- 等式：替换与计算 --------
    {
      id: "rfl",
      prio: 0,
      arity: 0,
      card: {
        name: "两边一样",
        emoji: "☑️",
        tone: "green",
        tip: "等号两边写得一模一样 —— 一样的东西当然相等，直接结案。",
      },
      visible: (g) => g.target.k === "eq" && termEq(g.target.a, g.target.b),
      run: (g) => ({
        goals: [],
        message: `等号两边都是「${showTerm(
          g.target.a,
          0
        )}」—— 同一个东西当然等于它自己，结案！`,
      }),
    },
    {
      id: "compute",
      prio: 1,
      arity: 0,
      card: {
        name: "算一算",
        emoji: "🔢",
        tone: "blue",
        tip: "把能算的加法乘法先算出来：3 + 4 就是 7。",
      },
      visible: (g) => computeFormula(g.target).changed,
      run: (g) => {
        const before = show(g.target);
        g.target = computeFormula(g.target).f;
        return {
          goals: [g],
          message: `算一算：「${before}」变成了「${show(g.target)}」。`,
        };
      },
    },
    {
      id: "rw",
      prio: 2,
      arity: 1,
      card: {
        name: "替换",
        emoji: "🔁",
        tone: "purple",
        tip: "等式就是「换个写法」的许可证：既然 a = b，目标里的 a 全都可以写成 b。",
      },
      pickPrompt: () => "点一条等式，用它把目标里的部分换个写法",
      candidates: (g) =>
        g.hyps.filter(
          (h) => isEquation(h.f) && applyRewrite(h, g.target, true).count > 0
        ),
      run: (g, [h]) => {
        const before = show(g.target);
        const r = applyRewrite(h, g.target, true);
        g.target = r.f;
        return {
          goals: [g],
          message: `用「${show(h.f)}」换掉了 ${r.count} 处：「${before}」→「${show(
            g.target
          )}」。`,
        };
      },
    },
    {
      id: "rwBack",
      prio: 3,
      arity: 1,
      card: {
        name: "反着换",
        emoji: "🪞",
        tone: "purple",
        tip: "等式两边是对称的：a = b 也能当 b = a 来用。",
      },
      pickPrompt: () => "点一条等式，反着用（把右边换成左边）",
      candidates: (g) =>
        g.hyps.filter(
          (h) => isEquation(h.f) && applyRewrite(h, g.target, false).count > 0
        ),
      run: (g, [h]) => {
        const before = show(g.target);
        const r = applyRewrite(h, g.target, false);
        g.target = r.f;
        return {
          goals: [g],
          message: `把「${show(
            h.f
          )}」反着用，换掉了 ${r.count} 处：「${before}」→「${show(g.target)}」。`,
        };
      },
    },
    {
      id: "succInj",
      prio: 4,
      arity: 1,
      card: {
        name: "去掉 succ",
        emoji: "🪜",
        tone: "orange",
        tip: "线索两边都是「下一个数」，那去掉这个「下一个」，里面也得相等 —— 因为不同数的下一个数不会撞车。",
      },
      pickPrompt: () => "点一条两边都带 succ 的等式",
      // 只认「succ ? = succ ?」这种形状：这是 succ 的单射性
      candidates: (g) =>
        g.hyps.filter(
          (h) => isEquation(h.f) && h.f.a.t === "succ" && h.f.b.t === "succ"
        ),
      run: (g, [h], ctx) => {
        const inner = equation(h.f.a.a, h.f.b.a);
        const added = addHyp(g, inner, "derived", ctx);
        return {
          goals: [g],
          message: added
            ? `「${show(h.f)}」两边都是 succ —— 去掉它，得到「${show(inner)}」。`
            : `「${show(inner)}」这条线索已经有了。`,
        };
      },
    },
    {
      id: "ind",
      prio: 5,
      arity: 1,
      pickKind: "formula",
      card: {
        name: "归纳法",
        emoji: "🪜",
        tone: "orange",
        tip: "先看最小的那一步（0）对不对；再假设某个数对，证明它的下一个也对。两步都成立，就所有数都成立。",
      },
      pickPrompt: () => "选一个要「归纳」的变量",
      candidates: (g) =>
        [...formulaTermVars(g.target)].map((n) => ({ id: "v:" + n, f: vr(n) })),
      // 归纳法：要证「对所有 n，P(n)」，就证
      //   ① P(0)                      —— 起点
      //   ② 假设 P(k)，证明 P(succ k)  —— 往前走一步
      // 因为我们只有 0 和 succ 两个构造子，这两步合起来覆盖了所有自然数。
      run: (g, [pick], ctx) => {
        const v = pick.f.name;
        const k = freshVar(g, v);
        const base = { hyps: copyHyps(g), target: substFormula(g.target, v, num(0)) };
        const stepHyps = copyHyps(g);
        stepHyps.push({
          id: ctx.fresh(),
          f: substFormula(g.target, v, k),
          tag: "assume",
        });
        const step = { hyps: stepHyps, target: substFormula(g.target, v, succ(k)) };
        return {
          goals: [base, step],
          message: `好，我们对「${v}」用归纳法。先证明最小的「0」成立，再假设「${show(
            k
          )}」成立、证明「${show(succ(k))}」也成立。`,
        };
      },
    },
    {
      id: "iffElim",
      prio: 4,
      arity: 1,
      card: {
        name: "拆成两个箭头",
        emoji: "⬌",
        tone: "blue",
        tip: "「A ↔ B」其实是两条线索合在一起：A 能推出 B，B 也能推出 A。拆开它们。",
      },
      pickPrompt: () => "点一条带 ↔ 的线索",
      candidates: (g) => g.hyps.filter((h) => h.f.k === "iff"),
      run: (g, [h], ctx) => {
        const f1 = imp(h.f.a, h.f.b);
        const f2 = imp(h.f.b, h.f.a);
        const a1 = addHyp(g, f1, "derived", ctx);
        const a2 = addHyp(g, f2, "derived", ctx);
        return {
          goals: [g],
          message:
            a1 || a2
              ? `「${show(h.f)}」拆成两个箭头：${show(f1)} 和 ${show(f2)}。`
              : "这两条箭头已经有了。",
        };
      },
    },
    {
      id: "iffIntro",
      prio: 4,
      arity: 0,
      card: {
        name: "合成双向",
        emoji: "🪢",
        tone: "blue",
        tip: "要证「A ↔ B」，得两个方向都证：先证 A → B，再证 B → A。",
      },
      visible: (g) => g.target.k === "iff",
      run: (g) => ({
        goals: [
          { hyps: copyHyps(g), target: imp(g.target.a, g.target.b) },
          { hyps: copyHyps(g), target: imp(g.target.b, g.target.a) },
        ],
        message: `要证「${show(
          g.target
        )}」，两个方向都要证：先证「A → B」，再证「B → A」。`,
      }),
    },
  ];

  const TACTIC_MAP = {};
  for (const t of TACTICS) TACTIC_MAP[t.id] = t;

  // ------------------------------------------------------ 应用一步推理

  /** 当前已选的线索下，还能选哪些线索 */
  function candidates(goal, tactic, picked) {
    const n = tactic.arity || 0;
    if (picked.length >= n) return [];
    return tactic.candidates ? tactic.candidates(goal, picked) : [];
  }

  /** 把一张卡所有可能的选法都列出来（求解器用） */
  function enumeratePicks(goal, tactic) {
    const n = tactic.arity || 0;
    if (n === 0) return [[]];
    const out = [];
    const step = (picked) => {
      if (picked.length === n) {
        out.push(picked.map((h) => h.id));
        return;
      }
      for (const h of candidates(goal, tactic, picked)) step(picked.concat([h]));
    };
    step([]);
    return out;
  }

  /** 这张卡现在能不能用（用于界面灰显） */
  function isUsable(goal, tactic) {
    if (tactic.visible && !tactic.visible(goal)) return false;
    return enumeratePicks(goal, tactic).length > 0;
  }

  /**
   * 走一步。返回新的 state 和一句中文解说。
   * 选错了就抛异常（界面会把它变成一句友好的提示）。
   */
  function applyMove(state, tacticId, pickedIds) {
    const tactic = TACTIC_MAP[tacticId];
    if (!tactic) throw new Error("没有这张方法卡：" + tacticId);

    const next = cloneState(state);
    const goal = focused(next);
    if (!goal) throw new Error("已经没有要证明的目标啦");
    if (tactic.visible && !tactic.visible(goal))
      throw new Error("这张卡现在用不上哦");

    const picked = [];
    for (const id of pickedIds || []) {
      const cands = candidates(goal, tactic, picked);
      const hit = cands.find((h) => h.id === id);
      if (!hit) throw new Error("这条线索不能用在这张卡上，再想想？");
      picked.push(hit);
    }
    if ((tactic.arity || 0) !== picked.length)
      throw new Error("还要再选线索才能用这张卡");

    const ctx = { fresh: () => "h" + next.nextId++ };
    const res = tactic.run(goal, picked, ctx);
    next.goals.splice(0, 1, ...(res.goals || []));
    return { state: next, message: res.message || "" };
  }

  // ------------------------------------------------------------ 求解器
  //
  // 用来（a）在界面上给提示，（b）在测试里确认每一关都真的做得出来。

  function stateKey(s) {
    return s.goals
      .map(
        (g) =>
          g.hyps
            .map((h) => key(h.f))
            .sort()
            .join(",") +
          "|-" +
          key(g.target)
      )
      .join("||");
  }

  // 试卡的先后顺序。先试「能立刻结案」的，再试「把目标拆小」的，
  // 最后才试「造新线索」的。顺序不影响能不能找到证明，但极大影响找得多快。
  const fallbackPrio = (t) => (typeof t.prio === "number" ? t.prio : 9);

  function orderedTactics(goal, skip) {
    const usable = [];
    for (const t of TACTICS) {
      if (skip && skip.has(t.id)) continue;
      if (t.visible && !t.visible(goal)) continue;
      usable.push(t);
    }
    usable.sort(
      (a, b) =>
        fallbackPrio(a) - fallbackPrio(b) || (a.arity || 0) - (b.arity || 0)
    );
    return usable;
  }

  /**
   * 迭代加深的深度优先搜索。
   *
   * 为什么不用广度优先？因为「一分为二」和「先立个小目标」这两张卡的分支太多，
   * 广度优先会把内存撑爆。迭代加深用线性的内存，同样能找到最短的证明。
   *
   * 转置表 seen 跨轮次保留：某个局面在「还剩 d 步」时已经彻底试过且失败了，
   * 那下次还剩 d' ≤ d 步时就不用再试。这一条是性能的关键 ——
   * 否则每一轮加深都要把前面所有轮次重做一遍。
   */
  function search(state, maxDepth, maxNodes, skip) {
    const seen = new Map();
    let nodes = 0;
    let solution = null;

    function dfs(s, depth, path) {
      if (solution) return true;
      if (isSolved(s)) {
        solution = path;
        return true;
      }
      if (depth <= 0) return false;

      const k = stateKey(s);
      const before = seen.get(k);
      if (before !== undefined && before >= depth) return false;

      if (++nodes > maxNodes) return false;
      seen.set(k, depth);

      const goal = focused(s);
      for (const tactic of orderedTactics(goal, skip)) {
        for (const picks of enumeratePicks(goal, tactic)) {
          let result;
          try {
            result = applyMove(s, tactic.id, picks);
          } catch (e) {
            continue;
          }
          if (
            dfs(result.state, depth - 1, path.concat([{ tactic: tactic.id, picks }]))
          )
            return true;
        }
      }
      return false;
    }

    for (let d = 1; d <= maxDepth; d++) {
      if (dfs(cloneState(state), d, [])) return { path: solution, nodes };
      if (nodes > maxNodes) return null;
    }
    return null;
  }

  /**
   * 找一条证明路线。
   *
   * 分三趟跑，一趟比一趟放开 —— 因为有两张卡对搜索特别不友好：
   *
   *   · ⚖️ 一分为二（lem）：每层最多 4 个候选公式，每个候选又分成 2 条分支，
   *     等于把分支因子乘 8。而绝大多数关卡根本不需要它。
   *   · 💡 先立个小目标（have）：候选多，而且一次多出两个子目标。
   *
   * 所以第一趟两张都不用；只有第一趟彻底失败，才逐张放开。
   * （曾经这里只跳过了 have，把 lem 留在了最贵的第一趟里，
   *   结果 w6-l3 这样需要 11 步的关卡直接爆炸 —— 见 scripts/diag-search.mjs。）
   *
   * opts.only：只允许用这几张卡。测试用它验证「孩子玩到这一关时，
   * 手上的工具真的够用」—— 这是防止把新卡偷偷用进早期关卡的关键检查。
   */
  function solve(state, opts) {
    const o = opts || {};
    const only = o.only || null;
    const passes = [
      { skip: new Set(["have", "lem"]), depth: o.maxDepth || 16, nodes: o.maxNodes || 40000 },
      { skip: new Set(["have"]), depth: o.maxDepth2 || 14, nodes: o.maxNodes2 || 40000 },
      { skip: null, depth: o.maxDepth3 || 12, nodes: o.maxNodes3 || 40000 },
    ];
    for (const p of passes) {
      // 注意是「并集」不是「替换」：每一趟本来就有的跳过（比如第一趟不用
      // 引理/排中律）必须保留，否则限定卡片反而会把最贵的那两张放进来。
      const skip = p.skip ? new Set(p.skip) : new Set();
      if (only) for (const t of TACTICS) if (!only.has(t.id)) skip.add(t.id);
      const r = search(state, p.depth, p.nodes, skip);
      if (r) return r;
    }
    return null;
  }

  // ------------------------------------------------------------ 初始状态

  /**
   * 起手状态。
   *   givens —— 关于**特定对象**的线索（变量是固定的，比如 y = x + 7 里的 y）
   *   rules  —— 普遍成立的**规则**（变量是占位符，可以代入任何算式）
   * 两者都会显示在线索区，但改写时的匹配方式不同 —— 见 matchTerm 的注释。
   */
  function initialState(givens, target, rules) {
    const hyps = (givens || []).map((f, i) => ({
      id: "h" + (i + 1),
      f,
      tag: "given",
      rule: false,
    }));
    (rules || []).forEach((f) => {
      hyps.push({
        id: "h" + (hyps.length + 1),
        f,
        tag: "rule",
        rule: true,
      });
    });
    return { goals: [{ hyps, target }], nextId: hyps.length + 1 };
  }

  /** 兼容旧调用。现在编号跟着状态走，不再需要手动重置。 */
  function resetIds() {}

  return {
    TACTICS,
    TACTIC_MAP,
    resetIds,
    initialState,
    cloneState,
    copyHyps,
    focused,
    isSolved,
    addHyp,
    findContradiction,
    subformulas,
    candidates,
    enumeratePicks,
    isUsable,
    applyMove,
    solve,
    stateKey,
  };
});
