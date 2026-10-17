/**
 * 静态文件服务器 —— 只为《逻辑小侦探》服务。
 *
 * 为什么要它？直接双击 index.html 也能玩，但浏览器的 file:// 协议下
 * localStorage 有时会被拦，进度就存不住了。用这个服务器打开，
 * 进度能正常保存，而且完全不联网（只听 127.0.0.1）。
 *
 *   node serve.mjs              默认 4173 端口
 *   node serve.mjs 8080         指定端口
 *   node serve.mjs --no-open    不要自动开浏览器
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(
  process.argv.slice(2).find((a) => /^\d+$/.test(a)) || process.env.PORT || 4173
);
const NO_OPEN = process.argv.includes("--no-open");
const URL_ = `http://127.0.0.1:${PORT}/`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** 打开系统默认浏览器。stdio 用 ignore，免得在受限环境里因为管道权限失败。 */
function openBrowser(url) {
  const cmd =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true }).unref();
  } catch (e) {
    /* 打不开就算了，用户自己复制地址也行 */
  }
}

/** 把请求路径安全地映射到磁盘路径，挡住 ../ 之类的越界访问 */
function resolveSafe(urlPath) {
  let p = decodeURIComponent(urlPath.split("?")[0]);
  if (p === "/" || p === "") p = "/index.html";
  const rel = normalize(p).replace(/^([/\\])+/, "");
  const abs = join(ROOT, rel);
  if (!abs.startsWith(ROOT + sep) && abs !== ROOT) return null;
  return abs;
}

const server = createServer(async (req, res) => {
  const abs = resolveSafe(req.url || "/");
  if (!abs) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("403 越界了");
    return;
  }
  try {
    const info = await stat(abs);
    if (info.isDirectory()) throw new Error("is a directory");
    const body = await readFile(abs);
    res.writeHead(200, {
      "Content-Type": MIME[extname(abs).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    res.end(body);
  } catch (e) {
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<meta charset='utf-8'><body style='font-family:sans-serif;padding:40px'>" +
        "<h2>404 找不到这个文件</h2><p>回 <a href='/'>首页</a> 吧。</p></body>"
    );
  }
});

// 端口被占用时不要甩一堆红色报错吓人 —— 那多半是上次没关干净，
// 或者游戏已经在另一个窗口里跑着了。直接打开它就好。
server.on("error", (e) => {
  if (e.code === "EADDRINUSE" || e.code === "EACCES") {
    console.log("");
    console.log("  ⚠️  端口 " + PORT + " 已经有东西在跑了。");
    console.log("");
    console.log("  可能是上一次的游戏窗口还没关。直接用它就行：");
    console.log("      " + URL_);
    console.log("");
    console.log("  如果那个页面打不开，先双击「停止游戏.cmd」，再重新启动。");
    console.log("");
    if (!NO_OPEN) openBrowser(URL_);
    setTimeout(() => process.exit(0), 300);
  } else {
    console.error("启动失败：" + e.message);
    process.exit(1);
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("");
  console.log("  🔍 《逻辑小侦探》已经启动！");
  console.log("");
  console.log("  在浏览器里打开这个地址：");
  console.log("      " + URL_);
  console.log("");
  console.log("  玩完之后，回到这个窗口按 Ctrl+C 就可以关掉。");
  console.log("  （或者双击「停止游戏.cmd」）");
  console.log("");
  if (!NO_OPEN) openBrowser(URL_);
});
