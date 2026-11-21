// 체크리스트 규칙 검증 + 프롬프트 6요소 감지 (규칙 기반)

export const ELEMENTS = [
  // 역할은 선택 요소: 요즘 모델은 역할 없이도 잘 답하고, 말투·관점이 중요할 때만 효과가 크다
  { key: "role", name: "역할", josa: "이", optional: true, hint: "필요할 때만 써요. 말투나 관점을 정하고 싶을 때 도움이 돼요. 예) 너는 후배를 아끼는 고등학생 선배야.",
    re: /(너는|당신은)[^.?!\n]{0,30}?(야|이야|이다|입니다|역할)|역할을|역할로|[가-힣]+로서/g },
  { key: "task", name: "과제", josa: "가", hint: "무엇을 해야 하는지 동사로 분명히 쓰세요. 예) 요약해 줘, 표로 정리해 줘.",
    re: /요약|정리|설명|작성|만들어|만들|써 ?줘|알려 ?줘|바꿔|분류|번역/g },
  { key: "context", name: "맥락", josa: "이", hint: "누가 읽는지, 왜 필요한지 알려 주세요. 예) 중학교 1학년 후배가 읽을 거야.",
    re: /대상|후배|중학생|고등학생|초등학생|친구들|반 친구|학급|목적|위해|상황|배경|읽을 사람|수업/g },
  { key: "format", name: "형식", josa: "이", hint: "출력 모양을 정해 주세요. 예) 정확히 3줄로, 마크다운 표로, 열 3개.",
    re: /\d+\s*줄|[한두세네다섯]\s*줄|표로|표 형식|마크다운|\d+\s*열|열은|열을|\d+\s*자|글자|항목|목록|번호|형식|문단|문장으로/g },
  { key: "example", name: "예시", josa: "가", hint: "원하는 출력의 예를 하나 보여 주세요. 예) 예시: | 챗봇 | 대화로 답함 | ... |",
    re: /예시|예를 들어|예:|예\)|다음처럼|다음과 같이|이런 식/g },
  { key: "constraint", name: "제약", josa: "이", hint: "하지 말아야 할 것, 한도를 정하세요. 예) 단, 원문에 없는 내용은 쓰지 마.",
    re: /단[,\s]|하지 ?마|금지|이내|넘지|넘기지|반드시|만 (써|사용)|쓰지 마|덧붙이지|제외|이하|최대/g },
];

// 점수·약점 분석에 쓰는 핵심 5요소 (역할 제외)
export const CORE = ELEMENTS.filter((el) => !el.optional);

export function detectElements(prompt) {
  const found = {};
  for (const el of ELEMENTS) {
    el.re.lastIndex = 0;
    found[el.key] = el.re.test(prompt);
  }
  return found;
}

// 해부 피드백용: 프롬프트에서 요소별로 걸린 구간
export function elementSpans(prompt) {
  const spans = [];
  for (const el of ELEMENTS) {
    el.re.lastIndex = 0;
    let m;
    while ((m = el.re.exec(prompt))) {
      spans.push({ start: m.index, end: m.index + m[0].length, key: el.key });
      if (m[0].length === 0) el.re.lastIndex++;
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let last = -1;
  for (const s of spans) if (s.start >= last) { out.push(s); last = s.end; }
  return out;
}

const lines = (t) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const tableLines = (t) => lines(t).filter((l) => l.startsWith("|"));
const isSep = (l) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(l);
const cells = (l) => l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const parseList = (s) => s.replace(/^\[|\]$/g, "").split(",").map((x) => x.trim()).filter(Boolean);

function table(t) {
  const tl = tableLines(t);
  const sepIdx = tl.findIndex(isSep);
  if (tl.length < 2 || sepIdx !== 1) return null;
  return { header: cells(tl[0]), rows: tl.slice(2).filter((l) => !isSep(l)).map(cells) };
}

function politeCheck(text) {
  const sentences = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\*\*|__|`/g, "").trim())
    // 목록 항목(- 날짜: …)은 문장이 아니므로 제외
    .filter((l) => !/^([-*•·]|\d+[.)])\s/.test(l))
    // 문장부호 없이 끝나는 짧은 줄은 제목으로 보고 제외 (예: "📢 체험학습 안내")
    .filter((l) => /[.!?]$/.test(l) || [...l].length > 20)
    .flatMap((l) => l.split(/(?<=[.!?])\s+/))
    .map((s) => s.replace(/[\s.!?~…"'”’)\]\p{Extended_Pictographic}️]+$/gu, "").trim())
    // 부름말("안녕하세요, 여러분!")은 서술어가 없으므로 제외
    .filter((s) => s.length > 1 && !/(여러분|친구들|학생들)$/.test(s));
  const bad = sentences.filter((s) => !/(요|니다|세요|까요|죠|시오|시다)$/.test(s));
  return { ok: sentences.length > 0 && bad.length === 0, bad };
}

// 반환: { ok: true|false|null, detail }  (null = judge 판정 대기/불가)
export function checkRule(rule, output, judgeChecks, id) {
  const out = output.trim();
  let m;
  if (rule === "judge") {
    if (!judgeChecks || !(id in judgeChecks)) return { ok: null, detail: "AI 판정 불가" };
    return { ok: Boolean(judgeChecks[id]), detail: "AI 루브릭 판정" };
  }
  if ((m = rule.match(/^lines(==|<=|>=)(\d+)$/))) {
    const n = lines(out).length, k = +m[2];
    const ok = m[1] === "==" ? n === k : m[1] === "<=" ? n <= k : n >= k;
    return { ok, detail: `${n}줄` };
  }
  if ((m = rule.match(/^chars<=(\d+)$/))) {
    const n = [...out.replace(/\r?\n/g, " ")].length;
    return { ok: n <= +m[1], detail: `${n}자` };
  }
  if ((m = rule.match(/^contains_all:(\[.*\])$/))) {
    const need = parseList(m[1]);
    const missing = need.filter((w) => !out.includes(w));
    return { ok: missing.length === 0, detail: missing.length ? `빠짐: ${missing.join(", ")}` : "모두 포함" };
  }
  if ((m = rule.match(/^max_terms:(\d+):(\[.*\])$/))) {
    const used = parseList(m[2]).filter((w) => out.includes(w));
    return { ok: used.length <= +m[1], detail: used.length ? `사용: ${used.join(", ")} (${used.length}개)` : "0개" };
  }
  if (rule === "is_table") {
    const t = table(out);
    return { ok: Boolean(t), detail: t ? "표 확인" : "표가 아님" };
  }
  if ((m = rule.match(/^table_cols==(\d+)$/))) {
    const t = table(out);
    if (!t) return { ok: false, detail: "표가 아님" };
    return { ok: t.header.length === +m[1], detail: `열 ${t.header.length}개` };
  }
  if ((m = rule.match(/^table_header:(\[.*\])$/))) {
    const t = table(out);
    if (!t) return { ok: false, detail: "표가 아님" };
    const need = parseList(m[1]);
    const ok = t.header.length === need.length && need.every((w, i) => t.header[i].replace(/\*/g, "").trim() === w);
    return { ok, detail: `열: ${t.header.join(" / ")}` };
  }
  if ((m = rule.match(/^table_rows==(\d+)$/))) {
    const t = table(out);
    if (!t) return { ok: false, detail: "표가 아님" };
    return { ok: t.rows.length === +m[1], detail: `행 ${t.rows.length}개` };
  }
  if (rule === "polite") {
    const r = politeCheck(out);
    return { ok: r.ok, detail: r.ok ? "모두 존댓말" : `반말 문장 ${r.bad.length}개` };
  }
  return { ok: false, detail: "알 수 없는 규칙" };
}

// 미션 1회 시도 채점: 체크리스트 70 + 질 30 + 보너스
export function scoreAttempt(mission, output, judge, attemptNo) {
  const judgeChecks = judge ? judge.checks : null;
  const results = mission.checklist.map((c) => ({ ...c, ...checkRule(c.rule, output, judgeChecks, c.id) }));
  // 판정 실패 시 judge 항목은 제외하고 규칙 항목만으로 70점을 배분
  const scored = results.filter((r) => r.ok !== null);
  const passed = scored.filter((r) => r.ok).length;
  const checklistScore = scored.length ? Math.round((70 * passed) / scored.length) : 0;
  const quality = judge ? judge.quality_score : 0;
  const cleared = scored.length > 0 && passed === scored.length;
  const bonus = cleared ? [10, 5, 0][attemptNo - 1] ?? 0 : 0;
  return { results, checklistScore, quality, bonus, total: checklistScore + quality + bonus, cleared, judgeFailed: !judge };
}
