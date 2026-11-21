"""디버그 아레나 문제은행 생성기 (Solar API + 자동 검증 파이프라인)

사용법:
    UPSTAGE_API_KEY=... python tools/generate_problems.py [--target 2] [--out public/data/problems.json]

- API 키는 환경변수 UPSTAGE_API_KEY 에서만 읽는다. 키를 출력하거나 파일에 쓰지 않는다.
- Solar 가 만든 문제를 실제 파이썬으로 실행해서
    ① 정답 코드(fixed_code)가 모든 테스트를 통과하고
    ② 버그 코드(buggy_code)가 최소 1개 테스트에서 실패(또는 오류·시간 초과)하는
  문제만 채택한다. 검증하지 못한 문제는 버린다.
- 게임 실행 중에는 API 를 호출하지 않는다. 결과는 정적 JSON 으로 게임에 내장된다.
"""

import argparse
import difflib
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

API_URL = "https://api.upstage.ai/v1/chat/completions"
MODEL = os.environ.get("SOLAR_GEN_MODEL", "solar-pro4")
TOPICS = ["조건문", "반복문", "리스트", "문자열", "함수"]
LEVELS = [1, 2, 3]
BUG_TYPES = {
    1: ["missing-colon", "missing-paren", "indentation", "typo-variable", "missing-quote"],
    2: ["wrong-comparison", "off-by-one", "and-or", "wrong-operator", "wrong-variable", "type-conversion"],
    3: ["missing-return", "index-range", "infinite-loop", "argument-order", "wrong-scope", "mutable-update"],
}
LEVEL_RULE = {
    1: "Lv1 문법 오류: 콜론 누락, 괄호 누락, 들여쓰기 오류, 변수명 오타, 따옴표 누락 중 버그 정확히 1개. 실행하면 SyntaxError/IndentationError/NameError 가 나야 한다.",
    2: "Lv2 연산·논리 오류: 비교 연산자 반대, off-by-one(range 끝값 등), and/or 혼동, 잘못된 연산자, 잘못된 변수 사용 중 버그 1~2개. 문법 오류 없이 실행은 되지만 결과가 틀려야 한다.",
    3: "Lv3 개념 오류: return 누락, 인덱스 범위 초과, 무한 루프(반복 변수 갱신 누락), 함수 인자 순서 뒤바뀜 중 버그 2~3개. 반드시 함수(def)를 하나 이상 쓴다.",
}
TIMEOUT_SEC = 2.0


def ask_solar(topic, level, n, avoid):
    key = os.environ.get("UPSTAGE_API_KEY")
    if not key:
        sys.exit("UPSTAGE_API_KEY 환경변수가 없습니다.")
    schema = {
        "topic": topic,
        "level": level,
        "intent": "정수 n을 입력받아 1부터 n까지의 합을 출력하는 코드",
        "buggy_code": "n = int(input())\ntotal = 0\nfor i in range(1, n):\n    total += i\nprint(total)",
        "fixed_code": "n = int(input())\ntotal = 0\nfor i in range(1, n + 1):\n    total += i\nprint(total)",
        "bugs": [{"line": 3, "type": "off-by-one", "explanation": "range(1, n)은 n을 포함하지 않아서 n이 더해지지 않아요.", "hint": "반복이 마지막 수까지 도는지 확인해 보세요."}],
        "tests": [{"input": "5", "expected_output": "15"}, {"input": "1", "expected_output": "1"}],
        "quiz": {"question": "range(1, n)이 만드는 마지막 수는?", "choices": ["n-1", "n", "n+1", "1"], "answer": 0},
    }
    user = f"""중·고등학교 정보 수업용 파이썬 디버깅 문제를 {n}개 만들어 줘.

[주제] {topic}
[난이도] {LEVEL_RULE[level]}
[bugs.type 에 쓸 수 있는 값] {", ".join(BUG_TYPES[level])}

[규칙]
- 코드는 반드시 5~15줄(빈 줄 제외). 너무 짧으면 입력·계산·출력을 여러 줄로 나눠 5줄 이상으로 만든다. 파이썬 3, import·random·파일 입출력 금지.
- 입력은 input()으로 한 줄에 하나씩 받고, 결과는 print()로 출력한다. 리스트 입력은 "3 1 2"처럼 한 줄에 공백으로 받아 split() 한다.
- fixed_code 는 올바른 코드. buggy_code 는 fixed_code 에 버그만 심은 코드(나머지는 똑같이).
- bugs[].line 은 buggy_code 기준 줄 번호(1부터).
- explanation 은 어디가 왜 틀렸는지 '-요'체 1~2문장. hint 는 답을 직접 말하지 않는 '-요'체 1문장.
- tests 는 4개. 서로 다른 입력, 경계값 1개 포함. 여러 줄 입력은 "\\n"으로 잇는다.
  expected_output 은 fixed_code 가 그 입력으로 실제 출력하는 글자 그대로(여러 줄이면 "\\n"으로 잇기).
  buggy_code 는 최소 1개 테스트에서 틀린 결과나 오류가 나야 한다.
- intent 는 코드가 해야 할 일과 입력·출력 형식을 한 문장으로 쓴다. 버그의 종류나 위치를 암시하는 말(버그, 오류, 누락, 뒤바뀐 등)은 절대 쓰지 않는다.
- quiz 는 이 버그의 원인을 묻는 4지선다. answer 는 정답의 0부터 시작하는 번호.
- 이미 만든 문제와 겹치지 않게: {", ".join(avoid) if avoid else "(없음)"}

아래 형식의 JSON 객체 하나만 출력해. 다른 글자는 쓰지 마.
{{"problems": [{json.dumps(schema, ensure_ascii=False)}]}}"""
    body = json.dumps({
        "model": MODEL,
        "messages": [
            {"role": "system", "content": "너는 고등학교 정보 교사이자 파이썬 전문가다. 반드시 유효한 JSON 객체 하나만 출력한다."},
            {"role": "user", "content": user},
        ],
        "temperature": 0.7,
        "max_tokens": 6000,
    }).encode("utf-8")
    req = urllib.request.Request(API_URL, data=body, headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"  [{topic} Lv{level}] Solar 오류 {e.code}", file=sys.stderr)  # 응답 원문은 남기지 않는다
        return []
    except Exception as e:  # 네트워크 등
        print(f"  [{topic} Lv{level}] 요청 실패 {type(e).__name__}", file=sys.stderr)
        return []
    text = data["choices"][0]["message"]["content"]
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return []
    try:
        return json.loads(m.group(0)).get("problems", [])
    except json.JSONDecodeError:
        return []


def run_code(code, stdin):
    """코드를 별도 프로세스로 실행해 (stdout, 오류여부) 를 돌려준다. 시간 초과는 오류로 본다."""
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "main.py")
        with open(path, "w", encoding="utf-8") as f:
            f.write(code)
        try:
            p = subprocess.run(
                [sys.executable, "-I", "-X", "utf8", path],
                input=stdin if stdin.endswith("\n") else stdin + "\n",
                capture_output=True, text=True, encoding="utf-8", timeout=TIMEOUT_SEC, cwd=d,
            )
        except subprocess.TimeoutExpired:
            return "", "timeout"
        return p.stdout, ("error" if p.returncode != 0 else None)


def norm(s):
    return "\n".join(line.rstrip() for line in s.strip().splitlines())


def changed_lines(buggy, fixed):
    """버그 코드에서 정답 코드와 다른 줄 번호(1부터). 줄이 빠진 경우는 빠진 자리의 바로 앞 줄."""
    b, f = buggy.rstrip().splitlines(), fixed.rstrip().splitlines()
    if len(b) == len(f):  # 줄 수가 같으면 같은 위치끼리 비교하는 것이 가장 정확하다
        return [i + 1 for i, (x, y) in enumerate(zip(b, f)) if x != y]
    out = []
    for tag, i1, i2, _, _ in difflib.SequenceMatcher(a=b, b=f, autojunk=False).get_opcodes():
        if tag in ("replace", "delete"):
            out.extend(range(i1 + 1, i2 + 1))
        elif tag == "insert":
            out.append(max(1, i1))
    return sorted(set(out))


def fix_bug_lines(bugs, buggy, fixed):
    """모델이 줄 번호를 잘못 센 경우 실제로 바뀐 줄로 맞춘다."""
    real = changed_lines(buggy, fixed)
    if not real:
        return bugs
    used = set()
    for b in bugs:
        if b["line"] in real and b["line"] not in used:
            used.add(b["line"])
            continue
        free = [r for r in real if r not in used] or real
        b["line"] = min(free, key=lambda r: abs(r - b["line"]))
        used.add(b["line"])
    return bugs


def validate(p, topic, level):
    """검증 통과 시 정리된 문제, 실패 시 (None, 이유)."""
    try:
        buggy, fixed = p["buggy_code"].rstrip() + "\n", p["fixed_code"].rstrip() + "\n"
        tests, bugs, quiz = p["tests"], p["bugs"], p["quiz"]
        intent = p["intent"].strip()
    except (KeyError, AttributeError, TypeError):
        return None, "스키마 누락"
    if re.search(r"버그|오류|틀린|고치|잘못|누락|뒤바", intent):
        return None, "의도 설명에 버그 힌트가 드러남"
    if buggy.strip() == fixed.strip():
        return None, "버그 코드=정답 코드"
    n_lines = len(buggy.strip().splitlines())
    if not 5 <= n_lines <= 15:
        return None, f"코드 길이 {n_lines}줄"
    if re.search(r"^\s*(import|from)\s", fixed + buggy, re.M):
        return None, "import 사용"
    if not isinstance(tests, list) or len(tests) < 3:
        return None, "테스트 부족"
    if not isinstance(bugs, list) or not bugs:
        return None, "버그 정보 없음"
    for b in bugs:
        if not isinstance(b.get("line"), int) or not 1 <= b["line"] <= n_lines or not b.get("explanation") or not b.get("hint"):
            return None, "버그 줄/설명 오류"
    if not (isinstance(quiz.get("choices"), list) and len(quiz["choices"]) >= 3
            and isinstance(quiz.get("answer"), int) and 0 <= quiz["answer"] < len(quiz["choices"])):
        return None, "퀴즈 형식 오류"

    clean_tests = []
    buggy_failed = False
    for t in tests:
        inp, exp = str(t.get("input", "")), str(t.get("expected_output", ""))
        out, err = run_code(fixed, inp)
        if err or norm(out) != norm(exp):
            return None, "정답 코드가 테스트 실패"  # ① 정답 코드는 모든 테스트 통과
        bout, berr = run_code(buggy, inp)
        if berr or norm(bout) != norm(exp):
            buggy_failed = True
        clean_tests.append({"input": inp, "expected_output": norm(exp)})
    if not buggy_failed:
        return None, "버그 코드가 모든 테스트 통과"  # ② 버그 코드는 최소 1개 실패

    return {
        "topic": topic,
        "level": level,
        "intent": intent,
        "buggy_code": buggy,
        "fixed_code": fixed,
        "bugs": fix_bug_lines([{"line": b["line"], "type": str(b.get("type", "")), "explanation": b["explanation"].strip(), "hint": b["hint"].strip()} for b in bugs], buggy, fixed),
        "tests": clean_tests,
        "quiz": {"question": quiz["question"].strip(), "choices": [str(c) for c in quiz["choices"]], "answer": quiz["answer"]},
    }, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=int, default=2, help="주제·난이도 조합마다 채택할 문제 수")
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--merge", action="store_true", help="기존 problems.json 을 유지하고 모자란 조합만 채운다")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "public", "data", "problems.json"))
    args = ap.parse_args()

    accepted = {(t, l): [] for t in TOPICS for l in LEVELS}
    if args.merge and os.path.exists(args.out):
        with open(args.out, encoding="utf-8") as f:
            for p in json.load(f):
                p.pop("id", None)
                ok, _ = validate(p, p["topic"], p["level"])  # 기존 문제도 다시 검증
                if ok and all(ok["intent"] != q["intent"] for v in accepted.values() for q in v):
                    accepted[(p["topic"], p["level"])].append(ok)
        print(f"기존 문제 {sum(len(v) for v in accepted.values())}개 유지")
    rejected = 0
    for rnd in range(1, args.rounds + 1):
        todo = [(t, l) for (t, l), v in accepted.items() if len(v) < args.target]
        if not todo:
            break
        print(f"라운드 {rnd}: {len(todo)}개 조합 생성 중…")
        with ThreadPoolExecutor(max_workers=5) as ex:
            futs = {k: ex.submit(ask_solar, k[0], k[1], args.target + 1, [p["intent"] for p in accepted[k]]) for k in todo}
        for (t, l), fut in futs.items():
            for p in fut.result():
                if len(accepted[(t, l)]) >= args.target:
                    break
                if any(p.get("intent") == q["intent"] for q in accepted[(t, l)]):
                    continue
                ok, why = validate(p, t, l)
                if ok:
                    accepted[(t, l)].append(ok)
                else:
                    rejected += 1
                    print(f"  버림 [{t} Lv{l}] {why}: {str(p.get('intent', ''))[:40]}")

    problems = []
    for (t, l), v in accepted.items():
        problems.extend(v)
    problems.sort(key=lambda p: (p["level"], TOPICS.index(p["topic"])))
    for i, p in enumerate(problems, 1):
        p["id"] = f"d{i:02d}"
    out = os.path.abspath(args.out)
    with open(out, "w", encoding="utf-8") as f:
        json.dump([{"id": p.pop("id"), **p} for p in problems], f, ensure_ascii=False, indent=1)
    by_level = {l: sum(1 for p in problems if p["level"] == l) for l in LEVELS}
    print(f"\n채택 {len(problems)}개 (Lv1 {by_level[1]}, Lv2 {by_level[2]}, Lv3 {by_level[3]}), 버림 {rejected}개 → {out}")


if __name__ == "__main__":
    main()
