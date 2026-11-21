// 디버그 아레나 — 게임 로직
// 문제은행(problems.json)은 Solar로 미리 생성·검증해 둔 정적 데이터이고, 게임 중에는 어떤 API도 호출하지 않는다.
// 학생 코드는 Pyodide(브라우저 안 파이썬)로 실제 실행해서 테스트 케이스로 채점한다.

import { burst, countUp, holdToConfirm, magnetic, reduced, scramble, sleep, stagger } from "/js/motion.js";

const $app = document.getElementById("app");
const $status = document.getElementById("status");

const TOPICS = ["조건문", "반복문", "리스트", "문자열", "함수"];
const LEVELS = [
  { v: "mix", label: "섞어서", sub: "Lv1→Lv3" },
  { v: "1", label: "Lv1", sub: "문법" },
  { v: "2", label: "Lv2", sub: "연산·논리" },
  { v: "3", label: "Lv3", sub: "개념" },
];
const TOPIC_META = {
  랜덤: { glyph: "?", desc: "모든 주제에서 골고루" },
  조건문: { glyph: "if", desc: "if·elif·else 갈림길" },
  반복문: { glyph: "for", desc: "for·while 되풀이" },
  리스트: { glyph: "[ ]", desc: "여러 값을 한 묶음으로" },
  문자열: { glyph: '"ab"', desc: "글자 다루기" },
  함수: { glyph: "def", desc: "def로 묶고 return" },
};
const LEVEL_DESC = {
  mix: "Lv1부터 Lv3까지 골고루 섞어서, 쉬운 문제부터 나와요.",
  1: "문법 — 콜론·괄호·따옴표 누락, 들여쓰기, 변수명 오타. 버그 1개.",
  2: "연산·논리 — 비교 연산자 반대, off-by-one, and/or 혼동. 버그 1~2개.",
  3: "개념 — return 누락, 인덱스 범위 초과, 무한 루프, 인자 순서. 버그 2~3개.",
};
const GAME_SIZE = 5;
const MAX_HINTS = 3;
const TIMEOUT_MS = 4000;

const BUG_LABEL = {
  "missing-colon": "콜론 누락", "missing-paren": "괄호 누락", indentation: "들여쓰기 오류", "typo-variable": "변수명 오타",
  "missing-quote": "따옴표 누락", "wrong-comparison": "비교 연산자 오류", "off-by-one": "경계값 오류(off-by-one)",
  "and-or": "and/or 혼동", "wrong-operator": "연산자 오류", "wrong-variable": "엉뚱한 변수 사용", "type-conversion": "형 변환 누락",
  "missing-return": "return 누락", "index-range": "인덱스 범위 초과", "infinite-loop": "무한 루프", "argument-order": "인자 순서 오류",
  "wrong-scope": "변수 범위 오류", "mutable-update": "값 갱신 오류",
};
const ERR_LABEL = {
  SyntaxError: "문법 오류", IndentationError: "들여쓰기 오류", TabError: "들여쓰기 오류", NameError: "없는 이름(변수·함수)",
  TypeError: "자료형 오류", IndexError: "인덱스 범위 초과", ValueError: "값 오류", ZeroDivisionError: "0으로 나눔",
  EOFError: "입력을 너무 많이 읽음", AttributeError: "없는 기능 사용", KeyError: "없는 키", RecursionError: "재귀가 너무 깊음",
  UnboundLocalError: "값이 없는 지역 변수",
};
const bugLabel = (t) => BUG_LABEL[t] || t || "기타";

const state = { problems: [], view: "home", topic: "랜덤", level: "mix", game: null, py: "loading", running: false };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const norm = (s) => String(s ?? "").replace(/\r/g, "").trim().split("\n").map((l) => l.trimEnd()).join("\n");
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ───────── 파이썬 실행기 (Web Worker) ───────── */
let worker = null;
let pending = null;

function startWorker() {
  state.py = "loading";
  renderStatus();
  worker = new Worker("/debug/py-worker.js");
  worker.onmessage = onWorker;
  worker.onerror = () => { state.py = "fail"; renderStatus(); refreshRunButton(); };
}

function onWorker(ev) {
  const m = ev.data;
  if (m.type === "ready") { state.py = "ready"; renderStatus(); refreshRunButton(); return; }
  if (m.type === "fail") { state.py = "fail"; renderStatus(); refreshRunButton(); return; }
  if (!pending || m.id !== pending.id) return;
  if (m.type === "test") { pending.results[m.index] = { stdout: m.stdout, error: m.error }; armTimer(); }
  if (m.type === "done") { clearTimeout(pending.timer); const p = pending; pending = null; p.resolve(p.results); }
}

function armTimer() {
  clearTimeout(pending.timer);
  pending.timer = setTimeout(onTimeout, TIMEOUT_MS);
}

// 무한 루프 등으로 응답이 없으면 워커를 끝내고 새로 띄운다
function onTimeout() {
  const p = pending;
  pending = null;
  worker.terminate();
  const i = p.results.length;
  p.results[i] = { stdout: "", error: { type: "Timeout", msg: `${TIMEOUT_MS / 1000}초 안에 끝나지 않았어요.`, line: null } };
  for (let j = i + 1; j < p.count; j++) p.results[j] = { skipped: true };
  startWorker();
  p.resolve(p.results);
}

function runTests(code, tests) {
  return new Promise((resolve) => {
    pending = { id: Date.now() + Math.random(), results: [], resolve, count: tests.length };
    worker.postMessage({ id: pending.id, code, tests: tests.map((t) => ({ input: t.input })) });
    armTimer();
  });
}

function renderStatus() {
  const map = {
    loading: ["status mock", "파이썬 준비 중…"],
    ready: ["status on", "파이썬 준비됨 · Pyodide"],
    fail: ["status off", "파이썬을 불러오지 못했어요"],
  };
  [$status.className, $status.textContent] = map[state.py];
}

/* ───────── 게임 상태 ───────── */
function pickProblems() {
  const all = state.problems;
  const lv = state.level === "mix" ? null : +state.level;
  const topicOk = (p) => state.topic === "랜덤" || p.topic === state.topic;
  const tiers = [
    all.filter((p) => topicOk(p) && (!lv || p.level === lv)),
    all.filter((p) => topicOk(p)),
    all.filter((p) => !lv || p.level === lv),
    all,
  ];
  const chosen = [];
  for (const tier of tiers) {
    for (const p of shuffle([...tier])) {
      if (chosen.length >= GAME_SIZE) break;
      if (!chosen.includes(p)) chosen.push(p);
    }
  }
  if (state.level === "mix") {
    // 섞어서: 난이도가 고르게 나오도록 레벨별로 하나씩 먼저 뽑고 쉬운 순으로 정렬
    const byLv = [1, 2, 3].map((l) => shuffle(all.filter((p) => topicOk(p) && p.level === l)));
    const mix = [];
    for (let k = 0; mix.length < GAME_SIZE && k < 10; k++)
      for (const arr of byLv) if (arr[k] && mix.length < GAME_SIZE) mix.push(arr[k]);
    if (mix.length === GAME_SIZE) return mix.sort((a, b) => a.level - b.level);
  }
  return chosen.sort((a, b) => a.level - b.level);
}

function newGame() {
  const list = pickProblems();
  state.game = {
    idx: 0,
    items: list.map((p) => ({ p, code: p.buggy_code, runs: 0, hints: 0, passed: false, gaveUp: false, quiz: null, results: null })),
  };
  state.view = "play";
  render();
}

const cur = () => state.game.items[state.game.idx];

function hintsFor(p) {
  const h = p.bugs.map((b) => b.hint);
  const lines = [...new Set(p.bugs.map((b) => b.line))].sort((a, b) => a - b);
  if (h.length < MAX_HINTS) h.push(`버그는 ${lines.join(", ")}번째 줄 근처에 있어요.`);
  return h.slice(0, MAX_HINTS);
}

function scoreOf(it) {
  if (!it.passed) return { pass: 0, first: 0, quiz: 0, hint: 0, total: 0 };
  const pass = 60;
  const first = it.runs === 1 ? 20 : it.runs === 2 ? 10 : 0;
  const quiz = it.quiz !== null && it.quiz === it.p.quiz.answer ? 20 : 0;
  const hint = -10 * it.hints;
  return { pass, first, quiz, hint, total: Math.max(0, pass + first + quiz + hint) };
}
const totalScore = () => state.game.items.reduce((s, it) => s + scoreOf(it).total, 0);

/* ───────── 화면 ───────── */
function render() {
  if (state.view === "home") renderHome();
  else if (state.view === "play") renderPlay();
  else renderFinal();
  $app.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

function renderHome() {
  const count = (t, l) => state.problems.filter((p) => (t === "랜덤" || p.topic === t) && (l === "mix" || p.level === +l)).length;
  const lvIdx = LEVELS.findIndex((l) => l.v === state.level);
  $app.innerHTML = `
  <section class="d-hero">
    <div class="d-hero-copy">
      <p class="eyebrow">정보 · 파이썬 디버깅 게임</p>
      <h1>버그를 고쳐야<br /><span class="hl" id="hero-hl">테스트가 통과</span>해요</h1>
      <p class="lede">버그가 숨은 파이썬 코드를 직접 고치고 실행해 보세요. 코드는 브라우저 안에서 진짜로 돌아가서, <strong>고친 척은 통하지 않아요.</strong></p>
      <div class="hero-actions">
        <button class="btn primary big" id="start" ${state.problems.length ? "" : "disabled"}>게임 시작 <span aria-hidden="true">→</span></button>
        <a class="btn ghost big" href="#setup">주제·난이도 고르기</a>
      </div>
      <ul class="meta-row" aria-label="게임 정보">
        <li><strong>${GAME_SIZE}</strong>문제</li><li><strong>100</strong>점 / 문제</li><li><strong>${state.problems.length}</strong>문제 은행</li>
      </ul>
    </div>
    <div class="d-demo" aria-hidden="true">
      <div class="demo-win" id="demo" data-step="0">
        <div class="demo-bar"><span></span><span></span><span></span><em>sum.py</em><b class="demo-badge"></b></div>
        <pre class="demo-code"><span>n = int(input())</span><span>total = 0</span><span class="bug">for i in range(1, n<span class="ins"></span>):</span><span>    total += i</span><span>print(total)</span></pre>
        <div class="demo-tests">
          <div class="dt"><span>입력 <code>5</code></span><span>기대 <code>15</code></span><span>출력 <code class="o1">·</code></span><i class="mk"></i></div>
          <div class="dt"><span>입력 <code>1</code></span><span>기대 <code>1</code></span><span>출력 <code class="o2">·</code></span><i class="mk"></i></div>
        </div>
        <div class="demo-run">▶ 실행</div>
      </div>
    </div>
  </section>

  <section class="card setup" id="setup">
    <div class="step-h"><span class="step-n">1</span><h2>주제 고르기</h2></div>
    <div class="topic-grid" role="radiogroup" aria-label="주제">
      ${["랜덤", ...TOPICS].map((t) => `<button class="topic-card" role="radio" data-topic="${t}" aria-checked="${state.topic === t}">
        <span class="t-glyph">${esc(TOPIC_META[t].glyph)}</span>
        <span class="t-name">${t}</span><span class="t-desc">${TOPIC_META[t].desc}</span>
        <span class="t-count" data-count="${t}">${count(t, state.level)}문제</span></button>`).join("")}
    </div>
    <div class="step-h"><span class="step-n">2</span><h2>난이도 고르기</h2></div>
    <div class="seg" role="radiogroup" aria-label="난이도" style="--i:${lvIdx}">
      <span class="seg-ind" aria-hidden="true"></span>
      ${LEVELS.map((l) => `<button role="radio" data-level="${l.v}" aria-checked="${state.level === l.v}"><b>${l.label}</b><small>${l.sub}</small></button>`).join("")}
    </div>
    <p class="seg-desc" id="lv-desc">${LEVEL_DESC[state.level]}</p>
    <div class="setup-foot">
      <p id="summary" class="muted"></p>
      <button class="btn primary big" id="start2" ${state.problems.length ? "" : "disabled"}>이 설정으로 시작 →</button>
    </div>
  </section>

  <section class="rule-tiles" aria-label="점수 규칙">
    <div class="tile"><b>+60</b><span>테스트 모두 통과</span></div>
    <div class="tile"><b>+20</b><span>첫 실행에 통과<small>두 번째는 +10</small></span></div>
    <div class="tile"><b>+20</b><span>버그 원인 퀴즈 정답</span></div>
    <div class="tile neg"><b>−10</b><span>힌트 1개마다<small>최대 3개</small></span></div>
  </section>

  <ol class="flow" aria-label="진행 방법">
    <li><span class="flow-n">1</span><b>읽기</b><span>코드가 해야 할 일과 테스트 케이스를 확인해요.</span></li>
    <li><span class="flow-n">2</span><b>고치기</b><span>에디터에서 버그를 찾아 고쳐요. 막히면 힌트!</span></li>
    <li><span class="flow-n">3</span><b>실행</b><span>테스트를 모두 통과하면 해설과 퀴즈가 열려요.</span></li>
  </ol>
  <p class="muted small center">문제은행은 Upstage Solar로 만들고, 정답 코드는 통과·버그 코드는 실패하는지 실제로 실행해 검증한 문제만 담았어요.</p>`;

  const updateSetup = () => {
    $app.querySelectorAll("[data-topic]").forEach((b) => b.setAttribute("aria-checked", b.dataset.topic === state.topic));
    $app.querySelectorAll("[data-level]").forEach((b) => b.setAttribute("aria-checked", b.dataset.level === state.level));
    $app.querySelectorAll("[data-count]").forEach((el) => (el.textContent = `${count(el.dataset.count, state.level)}문제`));
    $app.querySelector(".seg").style.setProperty("--i", LEVELS.findIndex((l) => l.v === state.level));
    $app.querySelector("#lv-desc").textContent = LEVEL_DESC[state.level];
    const n = count(state.topic, state.level);
    const lv = LEVELS.find((l) => l.v === state.level);
    $app.querySelector("#summary").textContent = `${state.topic} · ${lv.label} ${lv.sub} · ${GAME_SIZE}문제` + (n < GAME_SIZE && state.problems.length ? ` (이 조합은 ${n}문제라 비슷한 문제로 채워요)` : "");
  };
  // 화살표 키로 라디오 그룹 이동
  const radioKeys = (group, attr, setter) => group.addEventListener("keydown", (e) => {
    const items = [...group.querySelectorAll(`[${attr}]`)];
    const i = items.indexOf(document.activeElement);
    if (i < 0 || !["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const n = items[(i + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length];
    n.focus(); setter(n); updateSetup();
  });
  $app.querySelectorAll("[data-topic]").forEach((b) => (b.onclick = () => { state.topic = b.dataset.topic; updateSetup(); }));
  $app.querySelectorAll("[data-level]").forEach((b) => (b.onclick = () => { state.level = b.dataset.level; updateSetup(); }));
  radioKeys($app.querySelector(".topic-grid"), "data-topic", (b) => (state.topic = b.dataset.topic));
  radioKeys($app.querySelector(".seg"), "data-level", (b) => (state.level = b.dataset.level));
  $app.querySelector("#start").onclick = newGame;
  $app.querySelector("#start2").onclick = newGame;
  updateSetup();
  magnetic($app.querySelector("#start"));
  scramble($app.querySelector("#hero-hl"));
  stagger($app.querySelector(".topic-grid"));
  stagger($app.querySelector(".rule-tiles"), ":scope > *", 80);
  runDemo($app.querySelector("#demo"));
}

// 홈 화면 데모: 버그 실행 → 실패 → 고치기 → 통과를 반복해서 보여 준다
async function runDemo(win) {
  if (!win) return;
  const ins = win.querySelector(".ins");
  const o1 = win.querySelector(".o1"), o2 = win.querySelector(".o2");
  const badge = win.querySelector(".demo-badge");
  const set = (step, out1, out2, b) => { win.dataset.step = step; o1.textContent = out1; o2.textContent = out2; badge.textContent = b; };
  if (reduced()) { ins.textContent = " + 1"; set("pass", "15", "1", "모두 통과"); return; }
  while (win.isConnected) {
    ins.textContent = "";
    set("0", "·", "·", "");
    await sleep(1200); if (!win.isConnected) return;
    set("run", "·", "·", "실행 중");
    await sleep(700); if (!win.isConnected) return;
    set("fail", "10", "0", "2개 실패");
    await sleep(1600); if (!win.isConnected) return;
    set("edit", "10", "0", "고치는 중");
    for (const ch of " + 1") { await sleep(170); ins.textContent += ch; }
    await sleep(600); if (!win.isConnected) return;
    set("run", "·", "·", "실행 중");
    await sleep(700); if (!win.isConnected) return;
    set("pass", "15", "1", "모두 통과");
    await sleep(2600);
  }
}

function testRows(it) {
  return it.p.tests
    .map((t, i) => {
      const r = it.results && it.results[i];
      const cls = !r || r.skipped ? "" : r.ok ? "pass" : "fail";
      const mark = !r ? "·" : r.skipped ? "–" : r.ok ? "✓" : "✗";
      return `<tr class="${cls}"><td><code>${esc(t.input) || '<span class="muted">(없음)</span>'}</code></td><td><code>${esc(t.expected_output)}</code></td><td class="res" aria-label="${cls === "pass" ? "통과" : cls === "fail" ? "실패" : "아직"}">${mark}</td></tr>`;
    })
    .join("");
}

function errText(e) {
  if (e.type === "Timeout") return `시간 초과 — ${e.msg} 반복문이 끝나는지(무한 루프) 확인해 보세요.`;
  const where = e.line ? `${e.line}번째 줄에서 ` : "";
  return `${where}${e.type}${ERR_LABEL[e.type] ? ` (${ERR_LABEL[e.type]})` : ""}: ${e.msg}`;
}

function logHtml(it) {
  if (!it.results) return `<p class="muted small">코드를 고친 뒤 <strong>실행</strong>을 누르면 테스트 ${it.p.tests.length}개로 채점해요. (Ctrl+Enter)</p>`;
  if (it.results.every((r) => r.ok)) return `<div class="log-item pass">✓ 테스트 ${it.results.length}개 모두 통과!</div>`;
  const items = [];
  it.results.forEach((r, i) => {
    if (r.ok || r.skipped) return;
    const t = it.p.tests[i];
    if (r.error) {
      items.push(`<div class="log-item fail"><strong>테스트 ${i + 1}</strong> — ${esc(errText(r.error))}</div>`);
    } else {
      items.push(`<div class="log-item fail"><strong>테스트 ${i + 1} 실패</strong>
        <span class="io">입력: ${esc(t.input) || "(없음)"}\n기대 출력: ${esc(t.expected_output)}\n내 출력: ${esc(norm(r.stdout)) || "(아무것도 출력 안 함)"}</span></div>`);
    }
  });
  const passed = it.results.filter((r) => r.ok).length;
  return `<p class="small"><strong>${it.runs}번째 실행</strong> · 통과 ${passed} / ${it.results.length}</p>${items.slice(0, 3).join("")}${items.length > 3 ? `<p class="muted small">그 밖에 ${items.length - 3}개 더 실패</p>` : ""}`;
}

function changedLines(fixed, buggy) {
  const pool = new Map();
  buggy.split("\n").forEach((l) => pool.set(l.trimEnd(), (pool.get(l.trimEnd()) || 0) + 1));
  return fixed.split("\n").map((l) => {
    const k = l.trimEnd();
    if (pool.get(k)) { pool.set(k, pool.get(k) - 1); return false; }
    return k.trim() !== "";
  });
}

function resultHtml(it) {
  if (!it.passed && !it.gaveUp) return "";
  const p = it.p;
  const ch = changedLines(p.fixed_code.trimEnd(), p.buggy_code.trimEnd());
  const codeView = p.fixed_code.trimEnd().split("\n")
    .map((l, i) => `<div class="${ch[i] ? "changed" : ""}"><span class="ln">${i + 1}</span>${esc(l)}</div>`).join("");
  const s = scoreOf(it);
  const quizDone = it.quiz !== null;
  const showScore = it.gaveUp || quizDone;
  const last = state.game.idx === state.game.items.length - 1;
  return `
  <section class="card" id="result" aria-live="polite">
    <h2>${it.passed ? `🎉 통과! <span class="muted">${it.runs}번째 실행에서 모든 테스트를 통과했어요</span>` : "정답 코드와 해설"}</h2>
    <h3>버그 해설</h3>
    <ul class="bug-list">
      ${p.bugs.map((b) => `<li><span class="where">${b.line}번째 줄 · ${esc(bugLabel(b.type))}</span><br>${esc(b.explanation)}</li>`).join("")}
    </ul>
    <details ${it.gaveUp ? "open" : ""}><summary>고친 코드 보기 <span class="muted small">(바뀐 줄 표시)</span></summary><div class="code-view">${codeView}</div></details>
    ${it.passed ? `
    <h3 style="margin-top:16px">버그 퀴즈 <span class="muted small">(+20점)</span></h3>
    <p>${esc(p.quiz.question)}</p>
    <div class="quiz-choices">
      ${p.quiz.choices.map((c, i) => {
        const cls = !quizDone ? "" : i === p.quiz.answer ? "right" : i === it.quiz ? "wrong" : "";
        return `<button data-quiz="${i}" class="${cls}" ${quizDone ? "disabled" : ""}>${i + 1}. ${esc(c)}</button>`;
      }).join("")}
    </div>` : ""}
    ${showScore ? `
    <ul class="breakdown" style="margin-top:16px">
      <li><span>테스트 통과</span><strong>${s.pass}</strong></li>
      <li><span>실행 보너스 (${it.runs}번째 실행)</span><strong>+${s.first}</strong></li>
      <li><span>버그 퀴즈</span><strong>+${s.quiz}</strong></li>
      <li><span>힌트 ${it.hints}개</span><strong>${s.hint}</strong></li>
      <li class="sum"><span><strong>이 문제 점수</strong></span><strong><span id="q-total">${s.total}</span> / 100</strong></li>
    </ul>
    <button class="btn primary" id="next">${last ? "최종 결과 보기" : "다음 문제 →"}</button>` : ""}
  </section>`;
}

function renderPlay() {
  const g = state.game;
  const it = cur();
  const p = it.p;
  const done = it.passed || it.gaveUp;
  const hints = hintsFor(p);
  const errLine = (it.results || []).map((r) => r.error && r.error.line).find(Boolean) || null;
  $app.innerHTML = `
  <nav class="crumbs"><button class="link" data-go="home">← 처음으로</button><span>문제 ${g.idx + 1} / ${g.items.length} · 지금까지 ${totalScore()}점</span></nav>
  <div class="dbg-grid">
    <section class="card">
      <span class="pill">Lv${p.level} · ${esc(p.topic)}</span>
      <p class="muted small" style="margin:12px 0 0">이 코드가 해야 할 일</p>
      <p class="intent">${esc(p.intent)}</p>
      <h3>테스트 케이스</h3>
      <table class="tests"><thead><tr><th>입력</th><th>기대 출력</th><th>결과</th></tr></thead><tbody>${testRows(it)}</tbody></table>
      <p class="muted small">입력이 여러 줄이면 input()이 한 줄씩 차례로 읽어요.</p>
      ${it.hints ? `<h3>힌트</h3><ul class="hint-list">${hints.slice(0, it.hints).map((h) => `<li>💡 ${esc(h)}</li>`).join("")}</ul>` : ""}
    </section>
    <section class="card">
      <div class="editor">
        <div class="gutter" id="gutter" aria-hidden="true"></div>
        <textarea class="code-input" id="code" aria-label="파이썬 코드 편집기" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" ${done ? "readonly" : ""}></textarea>
      </div>
      <div class="toolbar">
        <button class="btn primary" id="run" ${done ? "disabled" : ""}>▶ 실행</button>
        <button class="btn ghost" id="hint" ${done || it.hints >= hints.length ? "disabled" : ""}>💡 힌트 ${it.hints}/${hints.length} <span class="muted small">−10점</span></button>
        <span class="spacer"></span>
        ${done ? "" : `<button class="link" id="reset">↺ 처음 코드로</button><button class="hold" id="giveup" title="꾹 누르고 있으면 정답이 열려요 (이 문제 0점)"><span>꾹 눌러 정답 보기</span></button>`}
      </div>
      <div class="run-log" id="log" aria-live="polite">${logHtml(it)}</div>
    </section>
  </div>
  ${resultHtml(it)}`;

  const ta = $app.querySelector("#code");
  const gutter = $app.querySelector("#gutter");
  ta.value = it.code;
  const syncGutter = () => {
    const n = ta.value.split("\n").length;
    gutter.innerHTML = Array.from({ length: n }, (_, i) => `<span class="${i + 1 === errLine ? "err" : ""}">${i + 1}</span>`).join("");
    ta.rows = Math.max(12, n + 2);
    gutter.scrollTop = ta.scrollTop;
  };
  syncGutter();
  ta.addEventListener("input", () => { it.code = ta.value; syncGutter(); });
  ta.addEventListener("scroll", () => (gutter.scrollTop = ta.scrollTop));
  ta.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); onRun(); return; }
    if (ta.readOnly || e.isComposing) return;
    if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); insertText(ta, "    "); }
    else if (e.key === "Enter") {
      const s = ta.selectionStart;
      const line = ta.value.slice(ta.value.lastIndexOf("\n", s - 1) + 1, s);
      let ind = line.match(/^[ \t]*/)[0];
      if (/:\s*$/.test(line)) ind += "    ";
      e.preventDefault();
      insertText(ta, "\n" + ind);
    }
  });

  $app.querySelector("#run").onclick = onRun;
  $app.querySelector("#hint").onclick = () => { if (it.hints < hints.length) { it.hints++; renderPlay(); } };
  const reset = $app.querySelector("#reset");
  if (reset) reset.onclick = () => { it.code = p.buggy_code; it.results = null; renderPlay(); };
  const giveup = $app.querySelector("#giveup");
  holdToConfirm(giveup, 1200, () => {
    it.gaveUp = true;
    renderPlay();
    $app.querySelector("#result").scrollIntoView({ behavior: "smooth" });
  });
  $app.querySelectorAll("[data-quiz]").forEach((b) => (b.onclick = () => {
    it.quiz = +b.dataset.quiz;
    renderPlay();
    const res = $app.querySelector("#result");
    res.scrollIntoView({ block: "end" });
    if (it.quiz === it.p.quiz.answer) burst(res.querySelector(".quiz-choices .right"), { count: 18 });
    countUp(res.querySelector("#q-total"), scoreOf(it).total, { ms: 700 });
    stagger(res.querySelector(".breakdown"), ":scope > li", 70);
  }));
  const next = $app.querySelector("#next");
  if (next) next.onclick = () => {
    if (state.game.idx < state.game.items.length - 1) { state.game.idx++; state.view = "play"; } else state.view = "final";
    render();
  };
  refreshRunButton();
}

function insertText(ta, text) {
  ta.focus();
  if (!document.execCommand("insertText", false, text)) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end");
    ta.dispatchEvent(new Event("input"));
  }
}

function refreshRunButton() {
  const b = $app.querySelector("#run");
  if (!b || state.view !== "play") return;
  const it = cur();
  const done = it.passed || it.gaveUp;
  b.disabled = done || state.running || state.py !== "ready";
  b.classList.toggle("loading", state.running);
  b.innerHTML = state.running ? `<span class="spin" aria-hidden="true"></span>실행 중…` : state.py === "loading" ? "파이썬 준비 중…" : state.py === "fail" ? "실행 불가" : "▶ 실행";
}

async function onRun() {
  const it = cur();
  if (it.passed || it.gaveUp || state.running || state.py !== "ready") return;
  state.running = true;
  refreshRunButton();
  const raw = await runTests(it.code, it.p.tests);
  state.running = false;
  it.runs++;
  it.results = it.p.tests.map((t, i) => {
    const r = raw[i] || { skipped: true };
    if (r.skipped) return r;
    return { ...r, ok: !r.error && norm(r.stdout) === norm(t.expected_output) };
  });
  if (it.results.every((r) => r.ok)) it.passed = true;
  renderPlay();
  stagger($app.querySelector(".tests tbody"), ":scope > tr", 90);
  stagger($app.querySelector("#log"), ":scope > *", 90);
  if (it.passed) {
    burst($app.querySelector("#run"));
    $app.querySelector("#result").scrollIntoView({ behavior: "smooth" });
  } else {
    $app.querySelector(".editor").classList.add("shake");
    $app.querySelector("#log").scrollIntoView({ block: "nearest" });
  }
}

function renderFinal() {
  const g = state.game;
  const total = totalScore();
  const weak = {};
  g.items.forEach((it) => {
    const s = scoreOf(it);
    if (s.total < 100) it.p.bugs.forEach((b) => (weak[bugLabel(b.type)] = (weak[bugLabel(b.type)] || 0) + 1));
  });
  const weakList = Object.entries(weak).sort((a, b) => b[1] - a[1]);
  $app.innerHTML = `
  <section class="card hero">
    <p class="muted">최종 점수</p>
    <p class="big-score"><span id="final-n">0</span> <span class="muted" style="font-size:1.2rem">/ ${g.items.length * 100}</span></p>
    <p>${g.items.filter((it) => it.passed).length}문제 통과 · 첫 실행 통과 ${g.items.filter((it) => it.passed && it.runs === 1).length}문제 · 퀴즈 정답 ${g.items.filter((it) => it.passed && it.quiz === it.p.quiz.answer).length}개 · 힌트 ${g.items.reduce((s, it) => s + it.hints, 0)}개</p>
    ${weakList.length ? `<p><strong>다시 볼 버그 유형</strong><br>${weakList.map(([k, n]) => `<span class="tag">${esc(k)}${n > 1 ? ` ×${n}` : ""}</span>`).join("")}</p>` : `<p><span class="tag ok">모든 문제 만점!</span></p>`}
    <div class="toolbar"><button class="btn primary" id="again">같은 설정으로 다시</button><button class="btn ghost" data-go="home">주제·난이도 바꾸기</button></div>
  </section>
  <h2>복습 카드</h2>
  <div class="review-grid">
    ${g.items.map((it, i) => {
      const s = scoreOf(it);
      const status = it.gaveUp ? "정답 확인 (0점)" : it.passed ? `${it.runs}번째 실행에 통과` : "풀지 않음";
      return `<article class="card">
        <p class="small muted">문제 ${i + 1} · Lv${it.p.level} · ${esc(it.p.topic)} · <strong>${s.total}점</strong></p>
        <p style="font-weight:700;margin:4px 0 8px">${esc(it.p.intent)}</p>
        <p class="small">${status}${it.hints ? ` · 힌트 ${it.hints}개` : ""}${it.passed ? ` · 퀴즈 ${it.quiz === it.p.quiz.answer ? "정답" : "오답"}` : ""}</p>
        <div>${it.p.bugs.map((b) => `<span class="tag ${s.total === 100 ? "ok" : ""}">${b.line}줄 · ${esc(bugLabel(b.type))}</span>`).join("")}</div>
        <p class="small" style="margin-bottom:0">${esc(it.p.bugs[0].explanation)}</p>
      </article>`;
    }).join("")}
  </div>`;
  $app.querySelector("#again").onclick = newGame;
  countUp($app.querySelector("#final-n"), total, { ms: 1200 });
  stagger($app.querySelector(".review-grid"), ":scope > *", 90);
  if (total >= g.items.length * 80) burst($app.querySelector(".big-score"), { count: 40 });
}

/* ───────── 시작 ───────── */
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-go]");
  if (!t) return;
  if (t.dataset.go === "home") {
    if (state.view === "play" && !confirm("지금 게임을 그만두고 처음으로 갈까요?")) return;
    state.view = "home";
    render();
  }
});

(async function init() {
  startWorker();
  renderHome();
  try {
    const res = await fetch("/data/problems.json");
    state.problems = await res.json();
  } catch {
    state.problems = [];
    $app.insertAdjacentHTML("afterbegin", `<p class="warn" role="alert">문제은행을 불러오지 못했어요. 새로고침해 주세요.</p>`);
  }
  renderHome();
})();
