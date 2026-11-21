// 두 게임이 함께 쓰는 모션 유틸 — 모든 효과는 '동작 줄이기' 설정을 존중한다.

export const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 숫자 카운트업 (점수)
export function countUp(el, to, { ms = 900, from = 0 } = {}) {
  if (!el) return;
  if (reduced()) { el.textContent = to; return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// 글자 스크램블 (제목 강조) — 텍스트만 있는 요소에 쓴다
const GLYPHS = "!<>-_/[]{}=+*^?#01ABCDEFXYZ가나다라마바사아";
export function scramble(el, { ms = 800 } = {}) {
  if (!el || reduced()) return;
  const chars = [...el.textContent];
  const t0 = performance.now();
  const tick = (t) => {
    const k = (t - t0) / ms;
    el.textContent = chars.map((c, i) => (c === " " || k > (i + 1) / chars.length ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join("");
    if (k < 1) requestAnimationFrame(tick);
    else el.textContent = chars.join("");
  };
  requestAnimationFrame(tick);
}

// 축하 파티클 (클리어·통과)
export function burst(anchor, { colors = ["#7c4dff", "#1f7ae0", "#0e9488", "#d97706", "#db2777", "#dc2626"], count = 30 } = {}) {
  if (!anchor || reduced()) return;
  const r = anchor.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const layer = document.createElement("div");
  layer.className = "burst-layer";
  for (let i = 0; i < count; i++) {
    const s = document.createElement("i");
    const a = Math.random() * Math.PI * 2;
    const d = 70 + Math.random() * 120;
    s.style.left = x + "px";
    s.style.top = y + "px";
    s.style.background = colors[i % colors.length];
    s.style.setProperty("--dx", Math.cos(a) * d + "px");
    s.style.setProperty("--dy", Math.sin(a) * d - 50 + "px");
    s.style.setProperty("--r", Math.random() * 600 - 300 + "deg");
    s.style.animationDelay = Math.random() * 80 + "ms";
    layer.appendChild(s);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 1400);
}

// 마우스를 따라 살짝 끌려오는 버튼 (마우스 환경에서만)
export function magnetic(el, strength = 0.22) {
  if (!el || reduced() || !matchMedia("(pointer: fine)").matches) return;
  el.classList.add("magnetic");
  el.addEventListener("pointermove", (e) => {
    const r = el.getBoundingClientRect();
    el.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * strength}px, ${(e.clientY - r.top - r.height / 2) * strength}px)`;
  });
  el.addEventListener("pointerleave", () => (el.style.transform = ""));
}

// 꾹 눌러서 확정하는 버튼 (실수로 누르는 것 방지) — 키보드는 Space/Enter 를 누르고 있으면 된다
export function holdToConfirm(btn, ms, onDone) {
  if (!btn) return;
  let raf = 0;
  let timer = 0;
  let t0 = 0;
  let fired = false;
  const set = (k) => btn.style.setProperty("--p", k);
  const start = (e) => {
    if (btn.disabled || timer) return;
    if (e && e.type === "keydown") e.preventDefault();
    fired = false;
    t0 = performance.now();
    // 확정은 타이머로(화면이 가려져 있어도 정확), 채워지는 효과만 애니메이션 프레임으로
    timer = setTimeout(() => { timer = 0; fired = true; cancelAnimationFrame(raf); set(1); onDone(); }, ms);
    const tick = (t) => { set(Math.min(1, (t - t0) / ms)); if (timer) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  };
  const cancel = () => {
    clearTimeout(timer);
    timer = 0;
    cancelAnimationFrame(raf);
    if (!fired) set(0);
  };
  btn.addEventListener("pointerdown", start);
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => btn.addEventListener(ev, cancel));
  btn.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) start(e); });
  btn.addEventListener("keyup", (e) => { if (e.key === " " || e.key === "Enter") cancel(); });
  btn.addEventListener("click", (e) => e.preventDefault());
}

// 자식 요소를 차례로 등장시킨다 (CSS .reveal 애니메이션 + --i 지연)
export function stagger(container, selector = ":scope > *", step = 60) {
  if (!container) return;
  container.querySelectorAll(selector).forEach((el, i) => {
    el.classList.add("reveal");
    el.style.setProperty("--d", (reduced() ? 0 : i * step) + "ms");
  });
}
