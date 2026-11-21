// Vercel 서버리스 함수: POST /api/solar-proxy
// 실제 로직은 lib/solar-proxy.js 에 있고, 여기서는 Vercel 요청·응답 형식만 맞춘다.
// API 키는 Vercel 환경변수 UPSTAGE_API_KEY 에서만 읽는다 (브라우저 코드·응답·로그에 노출하지 않음).

const { handler } = require("../lib/solar-proxy");

function rawBody(req) {
  // Vercel 은 JSON 본문을 미리 파싱해 req.body 에 넣는다. 잘못된 JSON 이면 접근할 때 오류가 난다.
  try {
    const b = req.body;
    if (b == null) return "";
    if (typeof b === "string") return b;
    if (Buffer.isBuffer(b)) return b.toString("utf8");
    return JSON.stringify(b);
  } catch {
    return "{bad json";
  }
}

module.exports = async (req, res) => {
  const r = await handler({ httpMethod: req.method, body: rawBody(req), headers: req.headers });
  res.statusCode = r.statusCode;
  for (const [k, v] of Object.entries(r.headers || {})) res.setHeader(k, v);
  res.end(r.body);
};
