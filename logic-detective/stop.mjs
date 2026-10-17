/**
 * 停止《逻辑小侦探》的本地服务。
 *
 * 为什么用 node 写而不是写在 .cmd 里？
 * cmd.exe 是按**系统代码页（中文 Windows 是 GBK）**读 .cmd 文件的，
 * 而我们的文件是 UTF-8 —— 中文会被拆成错误的字节，`for /f` 那行直接解析崩掉，
 * cmd 会把中文当命令去执行。踩过一次，所以 .cmd 一律纯 ASCII，
 * 所有中文输出交给 node。
 *
 *   node stop.mjs           默认 4173
 *   node stop.mjs 8080      指定端口
 */
import { execSync } from "node:child_process";

const PORT = Number(
  process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || 4173
);

console.log("");
console.log("  ============================================");
console.log("     🔍  逻辑小侦探  ——  正在停止服务");
console.log("  ============================================");
console.log("");

/** 找出正在监听这个端口的进程号 */
function findListeners(port) {
  let out = "";
  try {
    out = execSync("netstat -ano", { encoding: "utf8" });
  } catch (e) {
    return null; // 拿不到 netstat 就别猜
  }
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (!line.includes(":" + port)) continue;
    if (!/LISTENING/i.test(line)) continue;
    const cols = line.trim().split(/\s+/);
    const pid = cols[cols.length - 1];
    if (/^\d+$/.test(pid) && pid !== "0") pids.add(pid);
  }
  return pids;
}

const pids = findListeners(PORT);
if (pids === null) {
  console.log("  ⚠️  拿不到系统进程列表，没法自动停。");
  console.log("      可以手动关掉那个跑着 serve.mjs 的窗口。");
  console.log("");
  process.exitCode = 1;
} else if (pids.size === 0) {
  console.log("  没有找到在跑的服务 —— 可能本来就没开着。");
  console.log("");
} else {
  let killed = 0;
  for (const pid of pids) {
    console.log(`  找到正在运行的进程（PID ${pid}），正在关闭…`);
    try {
      process.kill(Number(pid), "SIGTERM");
      killed++;
    } catch (e) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: "ignore" });
        killed++;
      } catch (e2) {
        console.log(`    关不掉（${e.message}）—— 可能要管理员权限。`);
      }
    }
  }
  console.log("");
  if (killed) console.log(`  ✓ 已经关掉了 ${killed} 个进程。`);
  else {
    console.log("  ✗ 一个都没关掉。可以手动关掉那个跑着 serve.mjs 的窗口。");
    process.exitCode = 1;
  }
  console.log("");
}
