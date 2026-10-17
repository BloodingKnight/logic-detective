/*!
 * 《逻辑小侦探》— 逻辑内核（第 1 层：公式与算式）
 *
 * 这一层负责「写出来的东西长什么样」：构造、解析、显示、结构比较、算术求值。
 * 不含任何推理规则 —— 推理规则在 engine.js。
 *
 * 有两种东西：
 *
 *   项（term）—— 算式，例如  x + 1 、 2 × (y + 7) 、 succ 0
 *   公式（formula）—— 可以判断真假的话，例如
 *        下雨            （命题原子）
 *        x + 0 = x       （等式）
 *        下雨 → 草地湿    （蕴含）
 *
 * 等式把两者连起来：等号两边各是一个项。
 *
 * 同时支持两种加载方式：
 *   · 浏览器：<script src="js/logic.js"></script>   → 挂到 window.LD
 *   · Node  ：const L = require('./logic.js')      → 便于跑自动化测试
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.LD = Object.assign(root.LD || {}, factory());
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // ================================================================ 项

  const num = (n) => ({ t: "num", n: Number(n) });
  const vr = (name) => ({ t: "var", name: String(name) });
  const add = (a, b) => ({ t: "add", a, b });
  const mul = (a, b) => ({ t: "mul", a, b });
  const succ = (a) => ({ t: "succ", a });

  const isTerm = (x) => !!x && x.t !== undefined;

  /** 项的唯一指纹 */
  function termKey(t) {
    switch (t.t) {
      case "num":
        return "N" + t.n;
      case "var":
        return "v:" + t.name;
      case "succ":
        return "s(" + termKey(t.a) + ")";
      default:
        return t.t[0] + "(" + termKey(t.a) + "," + termKey(t.b) + ")";
    }
  }
  const termEq = (a, b) => termKey(a) === termKey(b);

  /** 这个项里有没有变量（没有变量就是「能算出来」的） */
  function isGroundTerm(t) {
    switch (t.t) {
      case "num":
        return true;
      case "var":
        return false;
      case "succ":
        return isGroundTerm(t.a);
      default:
        return isGroundTerm(t.a) && isGroundTerm(t.b);
    }
  }

  /** 把算式里的某个变量换成另一个算式（归纳法靠它：把 n 换成 0 或 succ k） */
  function substTerm(t, name, repl) {
    switch (t.t) {
      case "num":
        return t;
      case "var":
        return t.name === name ? repl : t;
      case "succ":
        return succ(substTerm(t.a, name, repl));
      default: {
        const a = substTerm(t.a, name, repl);
        const b = substTerm(t.b, name, repl);
        return t.t === "add" ? add(a, b) : mul(a, b);
      }
    }
  }

  /** 公式版的替换 */
  function substFormula(f, name, repl) {
    switch (f.k) {
      case "eq":
        return equation(substTerm(f.a, name, repl), substTerm(f.b, name, repl));
      case "not":
        return not(substFormula(f.a, name, repl));
      case "and":
      case "or":
      case "imp":
      case "iff": {
        const a = substFormula(f.a, name, repl);
        const b = substFormula(f.b, name, repl);
        return f.k === "and"
          ? and(a, b)
          : f.k === "or"
          ? or(a, b)
          : f.k === "imp"
          ? imp(a, b)
          : iff(a, b);
      }
      default:
        return f;
    }
  }

  /** 收集算式里出现的所有变量名 */
  function termVars(t, acc) {
    acc = acc || new Set();
    switch (t.t) {
      case "var":
        acc.add(t.name);
        break;
      case "succ":
        termVars(t.a, acc);
        break;
      case "add":
      case "mul":
        termVars(t.a, acc);
        termVars(t.b, acc);
        break;
      default:
        break;
    }
    return acc;
  }

  /** 收集一条公式里出现的所有算式变量名 */
  function formulaTermVars(f, acc) {
    acc = acc || new Set();
    switch (f.k) {
      case "eq":
        termVars(f.a, acc);
        termVars(f.b, acc);
        break;
      case "not":
        formulaTermVars(f.a, acc);
        break;
      case "and":
      case "or":
      case "imp":
      case "iff":
        formulaTermVars(f.a, acc);
        formulaTermVars(f.b, acc);
        break;
      default:
        break;
    }
    return acc;
  }

  /**
   * 算一算：把能算的算术都算出来。
   *
   * 只算 + 和 × —— **故意不算 succ**。
   * succ 是个「构造子」而不是运算符：succ 0 = 1 在 Peano 算术里是一条
   * 需要你去用的**定义**，不是自动等于。要是这里把 succ 也算掉，
   * 「1 + 1 = 2 为什么成立」那一关就没得证了。
   */
  function computeTerm(t) {
    switch (t.t) {
      case "num":
      case "var":
        return { term: t, changed: false };
      case "succ": {
        const r = computeTerm(t.a);
        return { term: succ(r.term), changed: r.changed };
      }
      case "add":
      case "mul": {
        const a = computeTerm(t.a);
        const b = computeTerm(t.b);
        if (a.term.t === "num" && b.term.t === "num") {
          const v = t.t === "add" ? a.term.n + b.term.n : a.term.n * b.term.n;
          return { term: num(v), changed: true };
        }
        const rebuilt = t.t === "add" ? add(a.term, b.term) : mul(a.term, b.term);
        return { term: rebuilt, changed: a.changed || b.changed };
      }
      default:
        return { term: t, changed: false };
    }
  }

  // ============================================================== 公式

  /** 原子命题，例如「下雨」。name 里不要有空格。 */
  const atom = (name) => ({ k: "atom", name: String(name) });
  /** 矛盾 / 荒谬，显示为 ⊥ */
  const falsum = () => ({ k: "false" });
  const not = (a) => ({ k: "not", a });
  const and = (a, b) => ({ k: "and", a, b });
  const or = (a, b) => ({ k: "or", a, b });
  const imp = (a, b) => ({ k: "imp", a, b });
  /** 当且仅当：A ↔ B 就是「A 和 B 同真同假」 */
  const iff = (a, b) => ({ k: "iff", a, b });
  /** 等式：等号两边各是一个项 */
  const equation = (a, b) => ({ k: "eq", a, b });

  const isEquation = (f) => !!f && f.k === "eq";

  /** 公式里有没有等式。有等式就不能用真值表验，得用归一化。 */
  function hasEquation(f) {
    if (!f) return false;
    switch (f.k) {
      case "eq":
        return true;
      case "not":
        return hasEquation(f.a);
      case "and":
      case "or":
      case "imp":
      case "iff":
        return hasEquation(f.a) || hasEquation(f.b);
      default:
        return false;
    }
  }

  // ---------------------------------------------------------- 结构相等

  /**
   * 结构相等。项和公式共用同一个入口 ——
   * 因为等式公式的两个孩子是**项**，如果只按公式比较就会崩。
   */
  function eq(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    if (isTerm(a) || isTerm(b)) {
      if (!isTerm(a) || !isTerm(b) || a.t !== b.t) return false;
      switch (a.t) {
        case "num":
          return a.n === b.n;
        case "var":
          return a.name === b.name;
        case "succ":
          return eq(a.a, b.a);
        default:
          return eq(a.a, b.a) && eq(a.b, b.b);
      }
    }
    if (a.k !== b.k) return false;
    switch (a.k) {
      case "atom":
        return a.name === b.name;
      case "false":
        return true;
      case "not":
        return eq(a.a, b.a);
      default:
        return eq(a.a, b.a) && eq(a.b, b.b);
    }
  }

  // ------------------------------------------------------------ 显示

  // 项的优先级：越大结合越紧
  const TPREC = { add: 1, mul: 2, succ: 3, num: 4, var: 4 };

  /**
   * 算式的显示。括号比学校习惯**多**一些，是故意的：
   *
   *   (x + 1) + 0     而不是  x + 1 + 0
   *   succ (succ 0)   而不是  succ succ 0
   *
   * 因为这个游戏里孩子操作的就是**结构** —— 规则「n + 0 = n」要把
   * 哪一块看成 n，取决于括号怎么划。省掉括号会让他看不出该替换哪一块。
   * 数学上 `a + b + c` 确实无所谓结合顺序，但「改写」在乎。
   */
  function showTerm(t, minPrec) {
    let s;
    switch (t.t) {
      case "num":
        s = String(t.n);
        break;
      case "var":
        s = t.name;
        break;
      case "succ":
        s = "succ " + showTerm(t.a, 4);
        break;
      case "add":
        // 同级的 + 要加括号，别人才看得出结构
        s = showTerm(t.a, 2) + " + " + showTerm(t.b, 2);
        break;
      case "mul":
        s = showTerm(t.a, 3) + " × " + showTerm(t.b, 3);
        break;
      default:
        s = "?";
    }
    if ((TPREC[t.t] || 0) < (minPrec || 0)) return "(" + s + ")";
    return s;
  }

  // 公式的优先级。↔ 最松 —— 和数学惯例一致，也让「A ↔ B」不会跟别人抢读法。
  const PREC = {
    iff: 0,
    imp: 1,
    or: 2,
    and: 3,
    not: 4,
    atom: 5,
    false: 5,
    eq: 6,
  };
  const prec = (f) => PREC[f.k] || 0;

  function render(f, minPrec, strict) {
    const p = prec(f);
    const inner = show(f);
    if (p < minPrec || (strict && p === minPrec)) return "(" + inner + ")";
    return inner;
  }

  /**
   * 括号策略 —— 这是特意为 9 岁孩子选的，比数学惯例**更啰嗦**：
   *
   *   · ∨ 的两边只要出现 ∧，就加括号：  (A ∧ B) ∨ C
   *   · → 的两边只要是复合公式，就加括号：(A ∧ B) → C，A → (B → C)
   *
   * 按数学惯例，`A ∧ B ∨ C` 确实读作 `(A ∧ B) ∨ C`（∧ 比 ∨ 结合紧）。
   * 但孩子得一边读一边回忆优先级，注意力就从「推理」跑到「记规则」上了。
   * 多余的括号永远不算错，少一层心算就多一分思考。
   */
  function show(f) {
    switch (f.k) {
      case "atom":
        return f.name;
      case "false":
        return "⊥";
      case "eq":
        return showTerm(f.a, 0) + " = " + showTerm(f.b, 0);
      case "not":
        return "¬" + render(f.a, 4, false);
      case "and":
        return render(f.a, 3, false) + " ∧ " + render(f.b, 3, false);
      case "or":
        return orOperand(f.a) + " ∨ " + orOperand(f.b);
      case "imp":
        return impOperand(f.a) + " → " + impOperand(f.b);
      case "iff":
        // ↔ 比 → 还松，所以两边只要有 → 或别的复合就会加括号
        return iffOperand(f.a) + " ↔ " + iffOperand(f.b);
      default:
        return "?";
    }
  }

  /** ∨ 的操作数：是 ∧ 就补一层括号 */
  function orOperand(x) {
    return x.k === "and" ? "(" + show(x) + ")" : render(x, 2, false);
  }

  /** → 的操作数：只要是复合公式就补括号（含右结合的 A → (B → C)） */
  function impOperand(x) {
    return x.k === "and" || x.k === "or" || x.k === "imp" || x.k === "iff"
      ? "(" + show(x) + ")"
      : show(x);
  }

  /** ↔ 的操作数：只要不是原子/¬/⊥ 就补括号（↔ 是最松的） */
  function iffOperand(x) {
    return x.k === "atom" || x.k === "false" || x.k === "not" || x.k === "eq"
      ? show(x)
      : "(" + show(x) + ")";
  }

  // -------------------------------------------------------------- 指纹

  /**
   * 结构化的唯一指纹（全括号序列化）。
   * 注意不能用 show() 当指纹：`(A∧B)∧C` 和 `A∧(B∧C)` 显示出来是一样的，
   * 但它们不是同一个公式，混起来会让求解器剪掉本该走的路。
   */
  function key(x) {
    if (isTerm(x)) return termKey(x);
    switch (x.k) {
      case "atom":
        return "a:" + x.name;
      case "false":
        return "F";
      case "eq":
        return "=(" + termKey(x.a) + "," + termKey(x.b) + ")";
      case "not":
        return "n(" + key(x.a) + ")";
      case "iff":
        // 不能用 default 的首字母 —— imp 和 iff 都是 'i'，会撞指纹
        return "b(" + key(x.a) + "," + key(x.b) + ")";
      default:
        return x.k[0] + "(" + key(x.a) + "," + key(x.b) + ")";
    }
  }

  // -------------------------------------------------------------- 解析
  //
  // 给关卡作者用的简写语法（孩子永远不需要输入它）：
  //     ~A            非 A
  //     A & B         A 且 B
  //     A | B         A 或 B
  //     A -> B        A 蕴含 B
  //     x + 1 = y     等式（等号两边是算式）
  //     2 * (y + 7)   算式：+ 和 ×，可以用括号
  //     succ n        后继（Peano 风格，后面才用）
  //
  // 同一个解析器要同时认「命题原子」和「算式变量」。
  // 分辨办法：先按算式解析，如果后面跟着 = 就是等式；
  // 如果只是一个光杆标识符，那它就是命题原子（中文的那种，比如「下雨」）。

  function tokenize(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      // 注意顺序：`<->` 必须在 `->` 之前判断（前三个字符是 `<` 不是 `-`）
      if (src.startsWith("<->", i)) {
        out.push({ t: "iff" });
        i += 3;
        continue;
      }
      if (src.startsWith("->", i)) {
        out.push({ t: "->" });
        i += 2;
        continue;
      }
      if ("+*=&|~()".includes(c)) {
        out.push({ t: c });
        i++;
        continue;
      }
      // 界面上显示的就是 ∧ ∨ ¬ → ⊥，关卡作者自然会照着写。
      // 解析器必须能原样读回来，否则每写一关都要记一遍 ASCII 对照表。
      const GLYPH = {
        "∧": "&",
        "∨": "|",
        "¬": "~",
        "→": "->",
        "↔": "iff",
        "⊥": "false",
      };
      if (GLYPH[c]) {
        out.push({ t: GLYPH[c] });
        i++;
        continue;
      }
      if (c >= "0" && c <= "9") {
        const m = /^[0-9]+/.exec(src.slice(i));
        out.push({ t: "num", v: parseInt(m[0], 10) });
        i += m[0].length;
        continue;
      }
      // 标识符必须以字母或下划线开头，但中间可以夹数字
      // （「n加1是奇数」这种中文原子就靠这一条才能整体识别）
      const m = /^[\p{L}_][\p{L}\p{N}_]*/u.exec(src.slice(i));
      if (m) {
        out.push({ t: "id", v: m[0] });
        i += m[0].length;
        continue;
      }
      throw new Error(`看不懂的符号：'${c}'（在第 ${i + 1} 个字符）`);
    }
    return out;
  }

  function parse(src) {
    const toks = tokenize(src);
    let pos = 0;
    const peek = () => toks[pos];
    const at = (t) => peek() && peek().t === t;
    const eat = (t) => {
      if (!at(t)) throw new Error(`公式里缺少 '${t}'：${src}`);
      pos++;
    };

    /** ↔ 最松，其次是 → */
    function pIff() {
      const left = pImp();
      if (at("iff")) {
        pos++;
        return iff(left, pIff()); // 右结合
      }
      return left;
    }
    function pImp() {
      const left = pOr();
      if (at("->")) {
        pos++;
        return imp(left, pImp()); // 右结合
      }
      return left;
    }
    function pOr() {
      let left = pAnd();
      while (at("|")) {
        pos++;
        left = or(left, pAnd());
      }
      return left;
    }
    function pAnd() {
      let left = pNot();
      while (at("&")) {
        pos++;
        left = and(left, pNot());
      }
      return left;
    }
    function pNot() {
      if (at("~")) {
        pos++;
        return not(pNot());
      }
      return pEq();
    }

    function pEq() {
      // ⊥ 是公式，不是算式 —— 要在尝试算式的**前面**拦下它。
      if (at("false")) {
        pos++;
        return falsum();
      }
      // 难点在于 `(` 既可能开一个算式 `(x + 1) + 0`，也可能包一整句公式
      // `(A & B) -> C`。做法：**先整体按算式解析**，解析不出来再退回公式。
      // （别只看到 `(` 就分叉 —— `(x + 1) + 0 = x + 1` 的括号后面还跟着 `+`，
      //   它只是整个左式的一小块。）
      const save = pos;
      let t = null;
      try {
        t = pTerm();
      } catch (e) {
        t = null;
      }

      if (t !== null) {
        if (at("=")) {
          pos++;
          return equation(t, pTerm());
        }
        // 光杆标识符：就是命题原子（「下雨」这种）
        if (t.t === "var") return atom(t.name);
        throw new Error(
          `这里是一个算式 '${showTerm(t, 0)}'，但缺少等号 '='：${src}`
        );
      }

      // 连算式都读不出来 —— 那应该是一个括号包起来的公式
      pos = save;
      if (at("(")) {
        pos++;
        const f = pIff();
        eat(")");
        return f;
      }
      throw new Error(`公式没写完，或者写法不对：${src}`);
    }

    function pTerm() {
      let left = pMul();
      while (at("+")) {
        pos++;
        left = add(left, pMul());
      }
      return left;
    }
    function pMul() {
      let left = pUnary();
      while (at("*")) {
        pos++;
        left = mul(left, pUnary());
      }
      return left;
    }
    function pUnary() {
      if (peek() && peek().t === "id" && peek().v === "succ") {
        pos++;
        return succ(pUnary());
      }
      return pTermAtom();
    }
    function pTermAtom() {
      const tk = peek();
      if (!tk) throw new Error(`算式没写完：${src}`);
      if (tk.t === "num") {
        pos++;
        return num(tk.v);
      }
      if (tk.t === "id") {
        pos++;
        return vr(tk.v);
      }
      if (tk.t === "(") {
        pos++;
        const t = pTerm();
        eat(")");
        return t;
      }
      throw new Error(`算式里出现了意外的符号 '${tk.t}'：${src}`);
    }

    const result = pIff();
    if (pos !== toks.length) throw new Error(`公式后面还有多余的东西：${src}`);
    return result;
  }

  // -------------------------------------------------------------- 求值

  /** 收集公式里出现的所有命题原子名字（等式里的变量不算） */
  function atomsOf(f, acc) {
    acc = acc || new Set();
    switch (f.k) {
      case "atom":
        acc.add(f.name);
        break;
      case "not":
        atomsOf(f.a, acc);
        break;
      case "and":
      case "or":
      case "imp":
      case "iff":
        atomsOf(f.a, acc);
        atomsOf(f.b, acc);
        break;
      default:
        break;
    }
    return acc;
  }

  /** 给定一套真假取值，算出公式的真假（只能用于没有等式的公式） */
  function evaluate(f, env) {
    switch (f.k) {
      case "atom":
        return !!env[f.name];
      case "false":
        return false;
      case "not":
        return !evaluate(f.a, env);
      case "and":
        return evaluate(f.a, env) && evaluate(f.b, env);
      case "or":
        return evaluate(f.a, env) || evaluate(f.b, env);
      case "imp":
        return !evaluate(f.a, env) || evaluate(f.b, env);
      case "iff":
        return evaluate(f.a, env) === evaluate(f.b, env);
      default:
        throw new Error("这个公式没法用真值表算：" + show(f));
    }
  }

  /**
   * 是不是「永远成立」（重言式）。用真值表穷举，适合我们这种小公式。
   * 含等式的公式不能用真值表 —— 请改用 engine.js 里的归一化判据。
   */
  /**
   * 一组公式能不能同时为真。
   *
   * 为什么需要它：只检查「线索 ⇒ 结论 是重言式」是不够的 ——
   * **线索自相矛盾时，任何结论都能被推出来**，重言式检查照样放行。
   * 那种关其实在教假逻辑。所以「自己出题」这一关要求孩子选的线索必须自洽。
   */
  function isSatisfiable(fs) {
    if (fs.some(hasEquation)) return true; // 等式另作处理，不在这里判断
    const names = [...new Set(fs.flatMap((f) => [...atomsOf(f)]))];
    if (names.length > 16) return true; // 原子太多就别硬算了
    const total = 1 << names.length;
    for (let mask = 0; mask < total; mask++) {
      const env = {};
      for (let i = 0; i < names.length; i++) env[names[i]] = !!(mask & (1 << i));
      if (fs.every((f) => evaluate(f, env))) return true;
    }
    return false;
  }

  function isTautology(f) {
    if (hasEquation(f))
      throw new Error(
        "含等式的公式不能用真值表验（等号两边是算式，不是真假）：" + show(f)
      );
    const names = [...atomsOf(f)];
    if (names.length > 16) throw new Error("原子命题太多，真值表算不动");
    const total = 1 << names.length;
    for (let mask = 0; mask < total; mask++) {
      const env = {};
      for (let i = 0; i < names.length; i++) env[names[i]] = !!(mask & (1 << i));
      if (!evaluate(f, env)) return false;
    }
    return true;
  }

  /** 把一串前提和一个结论拼成「前提 ⇒ 结论」 */
  function impAll(premises, conclusion) {
    return premises.reduceRight((acc, p) => imp(p, acc), conclusion);
  }

  /** 把一串公式用 ∧ 连起来 */
  function andAll(list) {
    if (!list.length) return null;
    return list.reduce((a, b) => and(a, b));
  }

  return {
    // 项
    num,
    vr,
    add,
    mul,
    succ,
    isTerm,
    termKey,
    termEq,
    isGroundTerm,
    substTerm,
    substFormula,
    termVars,
    formulaTermVars,
    computeTerm,
    showTerm,
    // 公式
    atom,
    falsum,
    not,
    and,
    or,
    imp,
    iff,
    equation,
    isEquation,
    hasEquation,
    eq,
    key,
    show,
    parse,
    atomsOf,
    evaluate,
    isTautology,
    isSatisfiable,
    impAll,
    andAll,
  };
});
