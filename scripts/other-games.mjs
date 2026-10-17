/**
 * 抓 lean4game 生态里另外几个游戏的关卡结构（只打印世界名 + 数量）。
 */
const REPOS = [
  ["Logic Game", "trequetrum/lean4game-logic"],
  ["Knights and Knaves", "jadabouhawili/knightsandknaves-lean4game"],
  ["Set Theory Game", "djvelleman/stg4"],
];

for (const [name, repo] of REPOS) {
  for (const branch of ["main", "master"]) {
    try {
      const r = await fetch(
        `https://api.github.com/repos/${repo}/git/trees/${branch}?recursive=1`,
        { headers: { "User-Agent": "gap-analysis" } }
      );
      if (!r.ok) continue;
      const j = await r.json();
      const worlds = new Map();
      for (const e of j.tree) {
        const m = /^(?:Game|Src)?\/?Levels\/([^/]+)\/([^/]+)\.lean$/.exec(e.path);
        if (m) {
          if (!worlds.has(m[1])) worlds.set(m[1], []);
          worlds.get(m[1]).push(m[2]);
        }
      }
      if (!worlds.size) {
        // 有些游戏不放在 Levels/ 下，退一步：列出所有 .lean 的顶层目录
        const dirs = new Set();
        for (const e of j.tree)
          if (e.path.endsWith(".lean")) dirs.add(e.path.split("/").slice(0, 2).join("/"));
        console.log(`\n【${name}】(${repo}, ${branch})  结构不同，目录：`);
        console.log("  " + [...dirs].slice(0, 20).join("  "));
        break;
      }
      let total = 0;
      console.log(`\n【${name}】(${repo}, ${branch})`);
      for (const [w, files] of [...worlds].sort((a, b) => b[1].length - a[1].length)) {
        total += files.length;
        console.log(`  ${w}: ${files.length} 关  ${files.slice(0, 14).join(" ")}`);
      }
      console.log(`  合计 ${worlds.size} 个世界、${total} 关`);
      break;
    } catch (e) {
      /* 换下一个分支 */
    }
  }
}
