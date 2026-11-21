# 프롬프트 아레나 (프로토타입)

고 인공지능 기초 "생성형 AI 제대로 활용하기" 수업용 프롬프트 설계 게임. 스펙: [prompt-arena-build-prompt.md](prompt-arena-build-prompt.md)

## 구조
```
public/                     정적 페이지 (Vercel outputDirectory)
  index.html, css/, js/app.js, js/rules.js(체크리스트 규칙·6요소 감지·채점)
  data/missions.json        미션 10개 (스키마 준수)
  data/factcheck.json       팩트체크 보너스 정적 세트 (프록시 장애 시 폴백)
api/solar-proxy.js          Vercel 함수 (POST /api/solar-proxy) — 요청·응답 형식만 맞춤
lib/solar-proxy.js          브라우저 → 함수 → Upstage Solar 핵심 로직 (키는 환경변수에서만)
lib/mock.js                 키 없을 때 로컬 시연용 모의 응답 (SOLAR_MOCK=1)
vercel.json                 출력 폴더·함수 리전(서울 icn1)·보안 헤더(CSP 등)
dev-server.js               vercel CLI 없이 로컬 실행 (vercel.json 헤더도 똑같이 적용)
```

## 로컬 실행
```bash
npm run dev
```
http://localhost:8888 — `.env`에 `UPSTAGE_API_KEY`가 없으면 **데모 모드(모의 응답)**, 있으면 실제 Solar를 호출합니다 (`.env.example` 참고).

## Vercel 배포
1. Vercel에서 이 GitHub 저장소를 가져오기 (Framework Preset: Other, 빌드 명령 없음 — `vercel.json`에 설정됨)
2. Project Settings → Environment Variables에 `UPSTAGE_API_KEY` 등록 (선택: `SOLAR_RUN_MODEL`, `SOLAR_JUDGE_MODEL`, `SESSION_SECRET`) 후 재배포
3. 이후 `main`에 push하면 자동 배포

## 프록시 방어
- 세션 토큰(HMAC 서명): 미션당 실행 3회, 게임당 실행 30회·판정 30회 (미션 수 × 3)(실행 횟수 초과 판정 불가)
- 학생 프롬프트 최대 1,000자, 요청 본문 12KB 제한, 등록된 미션 ID만 허용
- 시스템 프롬프트로 수업 맥락 고정
- 한계: 서버리스 특성상 "새 게임 시작"으로 새 세션을 받을 수 있음. 남용이 걱정되면 Vercel KV·Upstash 등으로 IP별 일일 한도를 추가.

---

## 디버그 아레나 (`/debug/`)

버그가 심어진 파이썬 코드를 고치고, 브라우저 안 파이썬(Pyodide)으로 실제 실행해 테스트 케이스 통과로 채점하는 정보 프로그래밍 게임. 사이트 상단 탭으로 프롬프트 아레나와 오간다.

- `tools/generate_problems.py` — Solar(solar-pro4)로 문제를 만들고 **실제 파이썬으로 실행해 검증**한 문제만 `public/data/problems.json`에 저장
  - ① 정답 코드가 모든 테스트 통과 ② 버그 코드가 최소 1개 테스트에서 실패(오류·시간 초과 포함) ③ 5~15줄, import 금지 ④ 버그 줄 번호를 실제 바뀐 줄로 보정 ⑤ 의도 설명에 버그 힌트가 드러나면 버림
  - 실행: `UPSTAGE_API_KEY=... python tools/generate_problems.py --target 3 --merge` (키는 환경변수에서만 읽음)
- `public/debug/` — 게임 (홈 → 문제 → 결과·퀴즈 → 최종 복습 카드). 게임 중에는 API를 호출하지 않는다.
  - `py-worker.js` — Pyodide 0.26.4를 Web Worker에서 실행, 테스트 입력을 stdin으로 주입하고 stdout을 비교. 4초 넘으면 워커 종료(무한 루프 대응) 후 재시작
- 점수(문제당 100): 통과 60 + 첫 실행 20 / 두 번째 10 + 퀴즈 20 − 힌트 10/개(최대 3)
- 현재 문제은행: 42문제 (조건문·반복문·리스트·문자열·함수 × Lv1~3)
