// 로컬 개발 서버: public/ 정적 파일 + Netlify Function 실행 (netlify-cli 없이 테스트용)
// .env 에 UPSTAGE_API_KEY 가 있으면 실제 Solar 호출, 없으면 모의 응답(SOLAR_MOCK=1)으로 동작한다.
const http = require("http");
const fs = require("fs");
const path = require("path");

const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (!process.env.UPSTAGE_API_KEY && !process.env.SOLAR_MOCK) process.env.SOLAR_MOCK = "1";

const { handler } = require("./netlify/functions/solar-proxy");
const ROOT = path.join(__dirname, "public");
const PORT = +process.argv[2] || +process.env.PORT || 8888;
// netlify.toml 의 보안 헤더를 로컬에서도 똑같이 보내 CSP 문제를 배포 전에 확인한다
const SEC_HEADERS = {};
try {
  const toml = fs.readFileSync(path.join(__dirname, "netlify.toml"), "utf8");
  for (const m of toml.matchAll(/^\s*([A-Za-z-]+)\s*=\s*"(.*)"\s*$/gm)) if (/^(Content-Security-Policy|X-Frame-Options|X-Content-Type-Options|Referrer-Policy|Permissions-Policy)$/.test(m[1])) SEC_HEADERS[m[1]] = m[2];
} catch {}
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/.netlify/functions/solar-proxy") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        const r = await handler({ httpMethod: req.method, body, headers: req.headers });
        res.writeHead(r.statusCode, r.headers);
        res.end(r.body);
      });
      return;
    }
    let file = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { ...SEC_HEADERS, "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  })
  .listen(PORT, () => {
    console.log(`프롬프트 아레나: http://localhost:${PORT}  (${process.env.SOLAR_MOCK === "1" ? "모의 응답 모드" : "Solar 실제 호출"})`);
  });
