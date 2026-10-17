// Minimal downloader: node scripts/dl.mjs <url> <dest>
// Uses Node's bundled OpenSSL (Windows schannel is unavailable in this sandbox).
import { createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const [url, dest] = process.argv.slice(2);
if (!url || !dest) {
  console.error("usage: node dl.mjs <url> <dest>");
  process.exit(2);
}

await mkdir(dirname(dest), { recursive: true });

const headers = { "User-Agent": "lean4game-kids-setup" };
if (process.env.GH_TOKEN) headers.Authorization = `Bearer ${process.env.GH_TOKEN}`;

const res = await fetch(url, { headers, redirect: "follow" });
if (!res.ok) {
  console.error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  process.exit(1);
}

const total = Number(res.headers.get("content-length") ?? 0);
let seen = 0;
let lastLog = 0;
const body = Readable.fromWeb(res.body);
body.on("data", (c) => {
  seen += c.length;
  const now = Date.now();
  if (now - lastLog > 2000) {
    lastLog = now;
    const pct = total ? ((seen / total) * 100).toFixed(1) + "%" : "?";
    process.stdout.write(`  ${pct}  ${(seen / 1048576).toFixed(1)} MiB\n`);
  }
});

await pipeline(body, createWriteStream(dest));
const s = await stat(dest);
console.log(`OK ${dest} ${(s.size / 1048576).toFixed(1)} MiB`);
