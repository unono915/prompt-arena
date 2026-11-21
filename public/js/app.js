import { CORE, ELEMENTS, detectElements, elementSpans, scoreAttempt } from "./rules.js";
import { burst, countUp, magnetic, reduced, sleep, stagger } from "./motion.js";

// 6요소 카드용 짧은 설명과 대표 글자
const EL_SHORT = { role: "필요할 때만 · 말투·관점", task: "해야 할 일", context: "대상·목적·상황", format: "출력 모양", example: "원하는 출력 예", constraint: "하지 말 것·한도" };
const DEMO_PROMPTS = [
  "아래 글을 요약해 줘.",
  "아래 글을 중학생 후배가 읽기 쉽게 3줄로 요약해 줘. 예: '인공지능은 ~해요.'처럼 써 줘. 단, 원문에 없는 내용은 쓰지 마.",
];

const API = "/api/solar-proxy";
const MAX_CHARS = 1000;
const ATTEMPTS = 3;

const state = {
  missions: [],
  facts: [],
  token: null,
  online: false,
  mock: false,
  model: "",
  view: "home",
  current: 0,
  progress: {}, // missionId -> { attempts: [], cleared, revealed, best }
  fact: { idx: 0, picked: new Set(), done: false, score: 0, played: 0 },
};

const $app = document.getElementById("app");
const $status = document.getElementById("status");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ───────── 서버 통신 ─────────
async function call(body) {
  let res;
  try {
    res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, token: state.token }),
    });
  } catch {
    throw new Error("AI 서버에 연결하지 못했어요. 팩트체크 보너스 라운드는 계속할 수 있어요.");
  }
  let data = {};
  try { data = await res.json(); } catch { /* 빈 응답 */ }
  if (data.token) state.token = data.token;
  if (!res.ok) throw Object.assign(new Error(data.message || "요청 실패"), { status: res.status, code: data.error });
  return data;
}

async function connect() {
  try {
    const h = await call({ kind: "health" });
    state.online = h.ok;
    state.mock = h.mock;
    state.model = h.model;
  } catch {
    state.online = false;
  }
  renderStatus();
}

function renderStatus() {
  if (!state.online) {
    $status.className = "status off";
    $status.textContent = "AI 연결 안 됨 · 팩트체크만 가능";
  } else if (state.mock) {
    $status.className = "status mock";
    $status.textContent = "데모 모드 (모의 응답)";
  } else {
    $status.className = "status on";
    $status.textContent = `Solar 연결됨 · ${state.model}`;
  }
}

// ───────── 공통 ─────────
function prog(id) {
  return (state.progress[id] ||= { attempts: [], cleared: false, revealed: false, best: 0 });
}
function go(view, extra = {}) {
  Object.assign(state, { view, liveFound: {} }, extra);
  render();
  window.scrollTo({ top: 0 });
  $app.focus({ preventScroll: true });
}
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-go]");
  if (t) go(t.dataset.go);
});

function elementChips(found, { big = false, prev = null } = {}) {
  return `<ul class="chips ${big ? "big" : ""}" aria-label="프롬프트 6요소">${ELEMENTS.map(
    (el) => `<li class="chip el-${el.key} ${found && found[el.key] ? "lit" : ""} ${prev && found && found[el.key] && !prev[el.key] ? "pop" : ""}" title="${esc(el.hint)}">
      <span class="dot" aria-hidden="true"></span>${el.name}${el.optional ? `<small class="opt">선택</small>` : ""}<span class="sr">${found && found[el.key] ? " 포함" : " 없음"}</span></li>`
  ).join("")}</ul>`;
}

function meter(found) {
  const n = CORE.filter((el) => found[el.key]).length;
  return `<div class="meter" role="img" aria-label="핵심 5요소 중 ${n}개 포함${found.role ? ", 역할도 씀" : ""}">
    ${ELEMENTS.map((el) => `<span class="seg-${el.key} el-${el.key} ${el.optional ? "opt" : ""} ${found[el.key] ? "on" : ""}"></span>`).join("")}
    <b>${n}<small>/5</small></b></div>`;
}

function renderOutput(text) {
  // 마크다운 표는 표로 그려서 보여 준다 (원문은 그대로 채점)
  const ls = text.split(/\r?\n/);
  const html = [];
  for (let i = 0; i < ls.length; i++) {
    if (ls[i].trim().startsWith("|") && ls[i + 1] && /^\s*\|?\s*:?-{2,}/.test(ls[i + 1])) {
      const rows = [];
      while (i < ls.length && ls[i].trim().startsWith("|")) rows.push(ls[i++]);
      i--;
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => esc(c.trim()));
      const [head, , ...body] = rows;
      html.push(`<div class="table-wrap"><table><thead><tr>${cells(head).map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${body
        .map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join("")}</tr>`)
        .join("")}</tbody></table></div>`);
    } else if (ls[i].trim()) {
      html.push(`<p>${esc(ls[i]).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")}</p>`);
    }
  }
  return html.join("");
}

// ───────── 홈 ─────────
function viewHome() {
  const total = Object.values(state.progress).reduce((a, p) => a + p.best, 0);
  const done = state.missions.filter((m) => prog(m.id).cleared || prog(m.id).revealed).length;
  const max = state.missions.length * 110;
  return `
  <section class="p-hero">
    <div class="p-hero-copy">
      <p class="eyebrow">인공지능 기초 · 생성형 AI 제대로 활용하기</p>
      <h1>프롬프트를 설계해서<br />AI가 <span class="hl">조건을 지키게</span><br />만들어 보세요</h1>
      <p class="lede">미션마다 목표와 체크리스트가 주어져요. 프롬프트를 쓰면 Solar가 바로 실행하고, 체크리스트를 모두 달성하면 클리어! 시도는 미션당 ${ATTEMPTS}번이에요.</p>
      <div class="hero-actions">
        <button class="btn primary big" id="start" ${state.online ? "" : "disabled"}>${done ? "이어서 하기" : "게임 시작"} <span aria-hidden="true">→</span></button>
        <button class="btn ghost big" data-go="fact">팩트체크 보너스 라운드</button>
      </div>
      ${state.online ? "" : `<p class="warn">AI 서버에 연결하지 못했어요. 지금은 팩트체크 보너스 라운드만 할 수 있어요.</p>`}
    </div>
    <div class="prompt-demo" aria-hidden="true">
      <div class="pd-box">
        <div class="pd-head"><span class="pd-live"></span>프롬프트 해부 미리보기</div>
        <p class="pd-text"><span id="pd-typed"></span><span class="pd-caret"></span></p>
        <div id="pd-meter">${meter({})}</div>
        <div id="pd-chips">${elementChips({})}</div>
        <p class="pd-verdict" id="pd-verdict">&nbsp;</p>
      </div>
    </div>
  </section>

  <section class="card">
    <div class="row-between"><h2>프롬프트 6요소</h2><span class="muted small">카드를 눌러 예시를 확인해요 · 역할은 필요할 때만 써요</span></div>
    <div class="flip-grid">
      ${ELEMENTS.map((el) => {
        const [desc, ex] = el.hint.split(/\s*예\)\s*/);
        return `<button class="flip el-${el.key}" aria-pressed="false" aria-label="${el.name}: ${esc(EL_SHORT[el.key])}. 예시 보기">
          <span class="flip-inner">
            <span class="flip-face front"><span class="f-icon">${el.name[0]}</span><b>${el.name}${el.optional ? ` <span class="opt">선택</span>` : ""}</b><small>${esc(EL_SHORT[el.key])}</small></span>
            <span class="flip-face back"><small>${esc(desc)}</small><span class="f-ex">${esc(ex || "")}</span></span>
          </span></button>`;
      }).join("")}
    </div>
  </section>

  <section class="card">
    <div class="row-between"><h2>미션</h2><span class="pill">${done} / ${state.missions.length} 완료 · <span id="home-total">${total}</span>점</span></div>
    <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${total}"><span style="width:${max ? (100 * total) / max : 0}%"></span></div>
    <ol class="mission-path">
      ${state.missions.map((m, i) => {
        const p = prog(m.id);
        const pct = Math.round((100 * p.best) / 110);
        const mark = p.cleared ? "✓" : String(i + 1);
        const badge = p.cleared ? `<span class="pill ok">클리어 ${p.best}점</span>` : p.revealed ? `<span class="pill">완료 ${p.best}점</span>` : `<span class="go" aria-hidden="true">→</span>`;
        return `<li><button class="m-node ${p.cleared ? "cleared" : ""}" data-mission="${i}" ${state.online ? "" : "disabled"}>
          <span class="ring" style="--p:${pct}"><span>${mark}</span></span>
          <span class="m-title">${esc(m.title)}<small>Lv${m.level} · ${esc(m.skill)}</small></span>${badge}</button></li>`;
      }).join("")}
    </ol>
  </section>`;
}

// 홈 화면 데모: 약한 프롬프트 → 6요소를 갖춘 프롬프트를 타이핑하며 요소가 켜지는 모습
async function runPromptDemo() {
  const typed = $app.querySelector("#pd-typed");
  if (!typed) return;
  const meterBox = $app.querySelector("#pd-meter");
  const chipBox = $app.querySelector("#pd-chips");
  const verdict = $app.querySelector("#pd-verdict");
  let prev = {};
  const show = (text) => {
    typed.textContent = text;
    const f = detectElements(text);
    meterBox.innerHTML = meter(f);
    chipBox.innerHTML = elementChips(f, { prev });
    prev = f;
    return f;
  };
  const judge = (f) => {
    const n = CORE.filter((el) => f[el.key]).length;
    verdict.textContent = n >= 4 ? `핵심 요소 ${n}개 — 역할 없이도 AI가 조건을 지키기 쉬워요` : `핵심 요소 ${n}개 — AI가 무엇을 원하는지 짐작해야 해요`;
    verdict.className = "pd-verdict " + (n >= 4 ? "good" : "weak");
  };
  if (reduced()) { judge(show(DEMO_PROMPTS[1])); return; }
  while (typed.isConnected) {
    for (const text of DEMO_PROMPTS) {
      verdict.innerHTML = "&nbsp;"; verdict.className = "pd-verdict";
      prev = {};
      for (let i = 1; i <= text.length; i++) {
        if (!typed.isConnected) return;
        show(text.slice(0, i));
        await sleep(text[i - 1] === " " ? 18 : 34);
      }
      judge(detectElements(text));
      await sleep(2600);
      for (let i = text.length; i >= 0; i -= 4) { if (!typed.isConnected) return; typed.textContent = text.slice(0, i); await sleep(12); }
      show("");
    }
  }
}

// ───────── 미션 ─────────
function viewMission() {
  const m = state.missions[state.current];
  const p = prog(m.id);
  const last = p.attempts[p.attempts.length - 1];
  const used = p.attempts.length;
  const finished = p.cleared || p.revealed;
  const draft = state.draft ?? "";
  const liveFound = detectElements(draft);

  const checklist = m.checklist.map((c) => {
    const r = last && last.score.results.find((x) => x.id === c.id);
    const st = !r ? "todo" : r.ok === null ? "na" : r.ok ? "ok" : "no";
    return `<li class="check ${st}"><span class="box" aria-hidden="true">${st === "ok" ? "✓" : st === "no" ? "✕" : st === "na" ? "?" : ""}</span>
      <span>${esc(c.text)}${c.rule === "judge" ? ` <span class="tag">AI 판정</span>` : ""}${r ? `<small>${esc(r.detail)}</small>` : ""}</span></li>`;
  }).join("");

  return `
  <nav class="crumbs"><button class="link" data-go="home">← 미션 목록</button><span>미션 ${state.current + 1} / ${state.missions.length}</span></nav>
  <div class="mission-grid">
    <section class="card brief">
      <div class="row-between"><span class="lv lv${m.level}">Lv${m.level} · ${esc(m.skill)}</span>
        <span class="tries" aria-label="남은 시도">${Array.from({ length: ATTEMPTS }, (_, i) => `<span class="try ${i < used ? "used" : ""}"></span>`).join("")}</span></div>
      <h1 class="m-h">${esc(m.title)}</h1>
      <p class="target"><strong>목표</strong> ${esc(m.target)}</p>
      ${m.source_text ? `<details class="source" open><summary>자료 (AI에게 자동으로 함께 전달돼요)</summary><p>${esc(m.source_text)}</p></details>` : ""}
      <h2 class="sub">체크리스트</h2>
      <ul class="checklist">${checklist}</ul>
      <h2 class="sub">내 프롬프트의 6요소</h2>
      <div id="live-chips">${elementChips(last && !state.draftDirty ? last.found : liveFound)}</div>
    </section>

    <section class="card work">
      ${finished ? "" : `
      <label class="sub" for="prompt">프롬프트 작성 <span class="muted">(${used + 1}번째 시도)</span></label>
      <textarea id="prompt" maxlength="${MAX_CHARS}" rows="7" placeholder="예) 너는 ○○야. 아래 자료를 … 해 줘. 단, …">${esc(draft)}</textarea>
      <div class="compose-bar">
        <div id="meter-box">${meter(liveFound)}</div>
        <span class="limit"><span class="ring-sm" id="limit-ring" style="--p:${Math.min(100, (100 * [...draft].length) / MAX_CHARS)}"></span><span id="count">${[...draft].length} / ${MAX_CHARS}자</span></span>
        <button class="btn primary" id="send" ${state.busy ? "disabled" : ""}>${state.busy ? `<span class="spin" aria-hidden="true"></span>${state.busy}` : "AI에게 보내기"}</button></div>
      ${state.error ? `<p class="warn" role="alert">${esc(state.error)} ${state.error && !state.online ? `<button class="link" data-go="fact">팩트체크 하러 가기</button>` : ""}</p>` : ""}`}
      ${state.busy ? stepsView() : last ? attemptView(m, last, p) : `<div class="empty">프롬프트를 보내면 여기에 AI 출력과 채점 결과가 나와요.</div>`}
      ${finished ? finishedView(m, p) : ""}
    </section>
  </div>`;
}

function stepsView() {
  const judging = state.busy === "채점 중…";
  const steps = [
    ["프롬프트 보내기", "done"],
    ["Solar가 출력 쓰는 중", judging ? "done" : "now"],
    ["체크리스트·루브릭 채점", judging ? "now" : "wait"],
  ];
  return `<ol class="agent-steps" aria-live="polite">${steps.map(([t, st]) => `<li class="${st}"><span class="st-ic" aria-hidden="true">${st === "done" ? "✓" : st === "now" ? `<span class="spin"></span>` : ""}</span><span class="${st === "now" ? "shimmer-text" : ""}">${t}</span></li>`).join("")}</ol>`;
}

function attemptView(m, a, p) {
  const s = a.score;
  const spans = elementSpans(a.prompt);
  let html = "", pos = 0;
  for (const sp of spans) {
    html += esc(a.prompt.slice(pos, sp.start));
    html += `<mark class="el-${sp.key}">${esc(a.prompt.slice(sp.start, sp.end))}</mark>`;
    pos = sp.end;
  }
  html += esc(a.prompt.slice(pos));
  const missing = CORE.filter((el) => !a.found[el.key]);
  const failed = s.results.filter((r) => r.ok === false);
  return `
  <div class="result">
    <h2 class="sub">AI 출력 <span class="muted">${esc(a.model)}${a.mock ? " · 모의 응답" : ""}</span></h2>
    <div class="output">${renderOutput(a.output)}</div>

    <div class="score ${s.cleared ? "cleared" : ""}">
      <div class="score-total"><span class="num" id="score-num">${s.total}</span><span class="of">/ 110</span>${s.cleared ? `<span class="pill ok">클리어!</span>` : ""}</div>
      <dl class="score-break">
        <div><dt>체크리스트</dt><dd>${s.checklistScore} / 70</dd></div>
        <div><dt>내용 질 (AI 판정)</dt><dd>${s.judgeFailed ? "판정 불가" : `${s.quality} / 30`}</dd></div>
        <div><dt>시도 보너스</dt><dd>+${s.bonus}</dd></div>
      </dl>
    </div>

    <h2 class="sub">프롬프트 해부</h2>
    <p class="anatomy">${html}</p>
    ${elementChips(a.found, { big: false })}
    <ul class="tips">
      ${failed.map((r) => `<li><strong>미달성: ${esc(r.text)}</strong> — ${esc(r.detail)}</li>`).join("")}
      ${missing.slice(0, 3).map((el) => `<li><span class="dot el-${el.key}"></span><strong>${el.name}</strong>${el.josa} 안 보여요. ${esc(el.hint)}</li>`).join("")}
      ${a.feedback ? `<li class="ai-fb"><strong>AI 코치</strong> ${esc(a.feedback)}</li>` : ""}
      ${s.judgeFailed ? `<li>AI 판정을 받지 못해 규칙 항목만으로 채점했어요.</li>` : ""}
    </ul>
  </div>`;
}

function finishedView(m, p) {
  const next = state.current + 1 < state.missions.length;
  return `
  <div class="finish">
    ${p.cleared ? `<p class="big-ok">미션 클리어! 최고 점수 ${p.best}점</p>` : `<p class="big-no">3번의 시도를 모두 썼어요. 모범 프롬프트를 확인해 보세요.</p>`}
    <h2 class="sub">모범 프롬프트</h2>
    <blockquote class="model">${esc(m.model_prompt)}</blockquote>
    ${elementChips(detectElements(m.model_prompt))}
    <div class="row-end">
      ${next ? `<button class="btn primary" id="next">다음 미션 →</button>` : `<button class="btn primary" data-go="final">최종 결과 보기</button>`}
    </div>
  </div>`;
}

async function send() {
  const m = state.missions[state.current];
  const p = prog(m.id);
  const prompt = (state.draft || "").trim();
  if (!prompt) { state.error = "프롬프트를 입력해 주세요."; return render(); }
  if ([...prompt].length > MAX_CHARS) { state.error = `최대 ${MAX_CHARS}자까지 보낼 수 있어요.`; return render(); }
  state.error = null;
  state.busy = "Solar가 쓰는 중…";
  render();
  try {
    const run = await call({ kind: "run", missionId: m.id, prompt });
    state.busy = "채점 중…";
    render();
    let judge = null, judgeModel = "";
    try {
      const j = await call({ kind: "judge", missionId: m.id, prompt, output: run.output });
      judge = j.judge;
      judgeModel = j.model;
    } catch { judge = null; }
    const attemptNo = p.attempts.length + 1;
    const score = scoreAttempt(m, run.output, judge, attemptNo);
    const found = detectElements(prompt);
    if (judge) for (const k in judge.elements) found[k] = found[k] || judge.elements[k];
    p.attempts.push({ prompt, output: run.output, model: run.model, mock: run.mock, judgeModel, score, found, feedback: judge && judge.feedback });
    p.best = Math.max(p.best, score.total);
    if (score.cleared) p.cleared = true;
    else if (p.attempts.length >= ATTEMPTS) p.revealed = true;
    state.draftDirty = false;
    state.fresh = true;
  } catch (err) {
    if (err.status === 429 || err.code === "attempt_limit") p.revealed = true;
    if (!err.status || err.status >= 500) { state.online = false; renderStatus(); }
    state.error = err.message;
  } finally {
    state.busy = null;
    render();
  }
}

// ───────── 최종 ─────────
// 6요소 육각형 그래프: 내 사용률(전체 시도 기준)과 모범 프롬프트를 겹쳐 그린다
function radar(me, ref) {
  const cx = 200, cy = 170, R = 110;
  const ang = (i) => ((i * 60 - 90) * Math.PI) / 180;
  const pt = (i, v) => [cx + R * v * Math.cos(ang(i)), cy + R * v * Math.sin(ang(i))].map((n) => n.toFixed(1));
  const poly = (vals) => ELEMENTS.map((el, i) => pt(i, vals[el.key]).join(",")).join(" ");
  const pct = (v) => Math.round(v * 100);
  const rings = [0.25, 0.5, 0.75, 1].map((k) => `<polygon class="rd-ring" points="${poly(Object.fromEntries(ELEMENTS.map((e) => [e.key, k])))}"/>`).join("");
  const axes = ELEMENTS.map((el, i) => { const [x, y] = pt(i, 1); return `<line class="rd-axis ${el.optional ? "opt" : ""}" x1="${cx}" y1="${cy}" x2="${x}" y2="${y}"/><circle class="rd-tip el-${el.key}" cx="${x}" cy="${y}" r="3.5"/>`; }).join("");
  const labels = ELEMENTS.map((el, i) => {
    const [x, y] = pt(i, 1.24);
    const c = Math.cos(ang(i));
    const anchor = Math.abs(c) < 0.2 ? "middle" : c > 0 ? "start" : "end";
    return `<text class="rd-label" x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle"><tspan class="rd-name">${el.name}${el.optional ? "(선택)" : ""}</tspan><tspan class="rd-val" dx="5">${pct(me[el.key])}%</tspan></text>`;
  }).join("");
  const dots = ELEMENTS.map((el, i) => { const [x, y] = pt(i, me[el.key]); return `<circle class="rd-dot" cx="${x}" cy="${y}" r="4.5"/>`; }).join("");
  const hits = ELEMENTS.map((el, i) => { const [x, y] = pt(i, me[el.key]); return `<circle class="rd-hit" cx="${x}" cy="${y}" r="16" tabindex="0" data-tip="${el.name} · 나 ${pct(me[el.key])}% · 모범 ${pct(ref[el.key])}%"><title>${el.name}: 나 ${pct(me[el.key])}%, 모범 프롬프트 ${pct(ref[el.key])}%</title></circle>`; }).join("");
  return `<div class="radar-wrap">
    <svg class="radar" viewBox="0 0 400 340" role="img" aria-label="프롬프트 6요소 사용률 육각형 그래프. ${ELEMENTS.map((e) => `${e.name} ${pct(me[e.key])}%`).join(", ")}">
      ${rings}${axes}
      <text class="rd-tick" x="${cx + 4}" y="${cy - R * 0.5}">50%</text><text class="rd-tick" x="${cx + 4}" y="${cy - R}">100%</text>
      <polygon class="rd-ref" points="${poly(ref)}"/>
      <g class="rd-me-g"><polygon class="rd-me" points="${poly(me)}"/>${dots}</g>
      ${labels}${hits}
    </svg>
    <div class="rd-tooltip" hidden></div>
  </div>`;
}

function viewFinal() {
  const ms = state.missions;
  const total = ms.reduce((a, m) => a + prog(m.id).best, 0);
  const useCount = Object.fromEntries(ELEMENTS.map((e) => [e.key, 0]));
  let attemptsAll = 0;
  ms.forEach((m) => prog(m.id).attempts.forEach((a) => { attemptsAll++; ELEMENTS.forEach((e) => { if (a.found[e.key]) useCount[e.key]++; }); }));
  const me = Object.fromEntries(ELEMENTS.map((e) => [e.key, attemptsAll ? useCount[e.key] / attemptsAll : 0]));
  const refFound = ms.map((m) => detectElements(m.model_prompt));
  const ref = Object.fromEntries(ELEMENTS.map((e) => [e.key, refFound.filter((f) => f[e.key]).length / (ms.length || 1)]));
  // 더 연습할 요소: 핵심 5요소 중 모범 프롬프트보다 30%p 이상 덜 쓴 요소 (차이가 큰 순)
  const weak = CORE.filter((e) => ref[e.key] - me[e.key] >= 0.3).sort((a, b) => me[a.key] - ref[a.key] - (me[b.key] - ref[b.key]));
  const pct = (v) => Math.round(v * 100);
  const cleared = ms.filter((m) => prog(m.id).cleared).length;
  const roleNote = me.role >= 0.7
    ? "역할을 거의 매번 넣었어요. 다음에는 역할 문장을 빼고, 그 자리에 누가 읽는지와 왜 필요한지(맥락)를 더 자세히 써 보세요. 결과가 비슷하거나 더 좋다면 역할은 없어도 되는 거예요."
    : me.role >= 0.3
      ? "역할을 쓴 미션과 안 쓴 미션의 결과를 비교해 보세요. 말투나 관점이 중요한 미션(선배처럼 설명하기, 반장으로 공지 쓰기)에서만 써도 충분해요."
      : "역할을 거의 안 썼어도 괜찮아요. 말투나 관점이 중요한 미션(선배처럼 설명하기, 반장으로 공지 쓰기)에서만 써 보세요.";
  return `
  <section class="hero final">
    <p class="eyebrow">최종 결과</p>
    <h1><span class="num" id="final-num">${total}</span> <small>/ ${ms.length * 110}점</small></h1>
    <p class="lede">${cleared}개 미션 클리어 · 총 ${attemptsAll}번 시도${state.fact.played ? ` · 팩트체크 보너스 ${state.fact.score}점` : ""}</p>
    ${weak.length ? `<p class="callout">더 연습하면 좋은 요소: ${weak.slice(0, 2).map((e) => `<strong class="t-${e.key}">${e.name}</strong>`).join(", ")}<br /><span class="muted">${esc(weak[0].hint)}</span></p>`
      : attemptsAll ? `<p class="callout">핵심 5요소를 고르게 잘 썼어요!</p>` : ""}
  </section>
  ${attemptsAll ? `<section class="card">
    <div class="row-between"><h2>내 프롬프트 6요소 그래프</h2>
      <ul class="rd-legend" aria-label="범례"><li><span class="sw me"></span>내 프롬프트</li><li><span class="sw ref"></span>모범 프롬프트</li></ul></div>
    <p class="muted small">전체 ${attemptsAll}번 시도 중 각 요소를 넣은 비율이에요. 바깥으로 갈수록 자주 썼다는 뜻이에요. 점선은 모범 프롬프트예요.</p>
    <div class="radar-layout">
      ${radar(me, ref)}
      <div>
        <table class="rd-table">
          <thead><tr><th scope="col">요소</th><th scope="col">나</th><th scope="col">모범</th></tr></thead>
          <tbody>${ELEMENTS.map((e) => `<tr class="${weak.includes(e) ? "weak" : ""}"><th scope="row"><span class="dot el-${e.key}"></span>${e.name}${e.optional ? ` <small class="opt">선택</small>` : ""}</th><td>${pct(me[e.key])}%</td><td>${pct(ref[e.key])}%</td></tr>`).join("")}</tbody>
        </table>
        <div class="role-note">
          <p><strong>역할은 왜 '선택'일까요?</strong></p>
          <p>요즘 AI는 "너는 전문가야"라고 하지 않아도 잘 답해요. 역할만 붙여서는 정답률이 꾸준히 오르지 않았다는 연구도 있어요. 그보다 누가 읽는지(맥락), 어떤 모양으로 받을지(형식·예시), 무엇을 피할지(제약)를 구체적으로 쓰는 게 더 효과적이에요.</p>
          <p class="muted">내 역할 사용률 ${pct(me.role)}% — ${roleNote}</p>
        </div>
      </div>
    </div>
  </section>` : ""}
  <section class="review">
    ${ms.map((m) => {
      const p = prog(m.id);
      const last = p.attempts[p.attempts.length - 1];
      const miss = last ? CORE.filter((e) => !last.found[e.key]).map((e) => e.name) : [];
      return `<article class="card rcard">
        <div class="row-between"><span class="lv lv${m.level}">Lv${m.level}</span>${p.cleared ? `<span class="pill ok">클리어</span>` : `<span class="pill">${last ? "미클리어" : "안 함"}</span>`}</div>
        <h3>${esc(m.title)}</h3>
        <p class="r-score">${p.best}점 · ${p.attempts.length}회 시도</p>
        ${last ? `<p class="r-prompt">“${esc(last.prompt.length > 120 ? last.prompt.slice(0, 120) + "…" : last.prompt)}”</p>
          ${elementChips(last.found)}
          ${miss.length ? `<p class="muted small">빠진 요소: ${miss.join(", ")}</p>` : ""}` : ""}
      </article>`;
    }).join("")}
  </section>
  <div class="row-center"><button class="btn primary" id="restart">처음부터 다시</button><button class="btn ghost" data-go="fact">팩트체크 보너스</button></div>`;
}

// ───────── 팩트체크 (정적 세트 · 프록시 장애 시에도 동작) ─────────
function viewFact() {
  const f = state.fact;
  const set = state.facts[f.idx % state.facts.length];
  if (!set) return `<section class="card"><p>팩트체크 문제를 불러오지 못했어요.</p></section>`;
  return `
  <nav class="crumbs"><button class="link" data-go="home">← 처음 화면</button><span>보너스 라운드 ${(f.idx % state.facts.length) + 1} / ${state.facts.length} · ${f.score}점</span></nav>
  <section class="card fact">
    <p class="eyebrow">팩트체크 보너스 라운드</p>
    <h1 class="m-h">AI 설명 속 틀린 문장 2곳을 찾아요</h1>
    <p class="muted">주제: ${esc(set.title)} — 틀렸다고 생각하는 문장을 2개 누르세요.</p>
    <ol class="sentences">
      ${set.sentences.map((s, i) => {
        const picked = f.picked.has(i);
        const cls = f.done ? (s.wrong ? (picked ? "hit" : "miss") : picked ? "false-pick" : "") : picked ? "picked" : "";
        return `<li><button class="sentence ${cls}" data-s="${i}" ${f.done ? "disabled" : ""} aria-pressed="${picked}">${esc(s.text)}</button>
          ${f.done && s.wrong ? `<p class="why">✎ ${esc(s.why)}</p>` : ""}</li>`;
      }).join("")}
    </ol>
    <div class="row-end">
      ${f.done ? `<button class="btn primary" id="fact-next">다음 문제 →</button>` : `<button class="btn primary" id="fact-check" ${f.picked.size === 2 ? "" : "disabled"}>정답 확인 (${f.picked.size}/2)</button>`}
    </div>
    ${f.done ? `<p class="callout">${f.lastHits}곳 맞혔어요! (+${f.lastHits * 5}점)</p>` : ""}
  </section>`;
}

// ───────── 렌더 & 이벤트 ─────────
function render() {
  const views = { home: viewHome, mission: viewMission, final: viewFinal, fact: viewFact };
  $app.innerHTML = (views[state.view] || viewHome)();
  bind();
}

function bind() {
  const $ = (s) => $app.querySelector(s);
  // 홈
  if (state.view === "home") {
    magnetic($("#start"));
    stagger($(".mission-path"));
    stagger($(".flip-grid"), ":scope > *", 50);
    $app.querySelectorAll(".flip").forEach((f) => f.addEventListener("click", () => f.setAttribute("aria-pressed", f.getAttribute("aria-pressed") !== "true")));
    runPromptDemo();
  }
  // 결과가 막 도착한 직후의 연출
  if (state.view === "mission" && state.fresh) {
    state.fresh = false;
    const res = $(".result");
    if (res) {
      stagger(res.querySelector(".output"), ":scope > *", 70);
      stagger($(".checklist"), ":scope > li", 120);
      const s = prog(state.missions[state.current].id).attempts.at(-1).score;
      countUp($("#score-num"), s.total);
      if (s.cleared) setTimeout(() => burst($("#score-num"), { count: 40 }), 450);
      res.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
    }
  }
  if (state.view === "final") {
    const n = $("#final-num");
    countUp(n, +n.textContent, { ms: 1400 });
    stagger($(".review"), ":scope > *", 90);
    requestAnimationFrame(() => $(".radar")?.classList.add("grow"));
    const wrap = $(".radar-wrap"), tip = $(".rd-tooltip");
    wrap?.querySelectorAll(".rd-hit").forEach((h) => {
      const show = () => {
        const r = h.getBoundingClientRect(), w = wrap.getBoundingClientRect();
        tip.textContent = h.dataset.tip;
        tip.hidden = false;
        tip.style.left = r.left - w.left + r.width / 2 + "px";
        tip.style.top = r.top - w.top + "px";
      };
      const hide = () => (tip.hidden = true);
      h.addEventListener("pointerenter", show); h.addEventListener("focus", show);
      h.addEventListener("pointerleave", hide); h.addEventListener("blur", hide);
    });
    if (+n.textContent >= state.missions.length * 88) setTimeout(() => burst(n, { count: 50 }), 600);
  }
  $("#start")?.addEventListener("click", () => {
    const i = state.missions.findIndex((m) => !(prog(m.id).cleared || prog(m.id).revealed));
    if (i === -1) go("final"); else go("mission", { current: i, draft: "", error: null });
  });
  $app.querySelectorAll("[data-mission]").forEach((b) =>
    b.addEventListener("click", () => go("mission", { current: +b.dataset.mission, draft: "", error: null }))
  );
  const ta = $("#prompt");
  if (ta) {
    ta.addEventListener("input", () => {
      state.draft = ta.value;
      state.draftDirty = true;
      const len = [...ta.value].length;
      $("#count").textContent = `${len} / ${MAX_CHARS}자`;
      const ring = $("#limit-ring");
      ring.style.setProperty("--p", Math.min(100, (100 * len) / MAX_CHARS));
      ring.classList.toggle("near", len >= MAX_CHARS * 0.9);
      const found = detectElements(ta.value);
      $("#live-chips").innerHTML = elementChips(found, { prev: state.liveFound });
      $("#meter-box").innerHTML = meter(found);
      state.liveFound = found;
    });
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); });
  }
  $("#send")?.addEventListener("click", send);
  $("#next")?.addEventListener("click", () => go("mission", { current: state.current + 1, draft: "", error: null }));
  $("#restart")?.addEventListener("click", async () => {
    state.progress = {};
    await connect();
    go("home");
  });
  // 팩트체크
  $app.querySelectorAll("[data-s]").forEach((b) =>
    b.addEventListener("click", () => {
      const i = +b.dataset.s, f = state.fact;
      if (f.picked.has(i)) f.picked.delete(i);
      else if (f.picked.size < 2) f.picked.add(i);
      render();
    })
  );
  $("#fact-check")?.addEventListener("click", () => {
    const f = state.fact, set = state.facts[f.idx % state.facts.length];
    f.lastHits = [...f.picked].filter((i) => set.sentences[i].wrong).length;
    f.score += f.lastHits * 5;
    f.played++;
    f.done = true;
    render();
    stagger($app.querySelector(".sentences"), ":scope > li", 60);
    if (f.lastHits === 2) burst($app.querySelector(".callout"), { count: 24 });
  });
  $("#fact-next")?.addEventListener("click", () => {
    Object.assign(state.fact, { idx: state.fact.idx + 1, picked: new Set(), done: false });
    render();
  });
}

// ───────── 시작 ─────────
(async function init() {
  $app.innerHTML = `<div class="empty">불러오는 중…</div>`;
  const [missions, facts] = await Promise.all([
    fetch("data/missions.json").then((r) => r.json()).catch(() => []),
    fetch("data/factcheck.json").then((r) => r.json()).catch(() => []),
  ]);
  state.missions = missions;
  state.facts = facts;
  await connect();
  render();
})();
