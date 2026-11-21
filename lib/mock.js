// 로컬 데모용 모의 응답 — SOLAR_MOCK=1 일 때만 쓰인다.
// 실제 배포(UPSTAGE_API_KEY 설정)에서는 사용되지 않는다.
// 프롬프트에 어떤 조건을 썼는지에 따라 출력이 달라지도록 만들어, 게임 루프를 키 없이 시연할 수 있게 한다.

const has = (p, re) => re.test(p);

const ELEMENT_RE = {
  role: /너는|당신은|역할|로서|선생님|선배|반장|전문가/,
  task: /요약|정리|설명|작성|만들|써\s*줘|알려|바꿔/,
  context: /대상|후배|중학생|고등학생|친구들|반 친구|목적|위해|상황/,
  format: /줄|표|열|행|자 이내|글자|항목|목록|형식|문단/,
  example: /예시|예를 들어|예:|다음처럼|다음과 같이/,
  constraint: /단[,\s]|하지 ?마|금지|이내|넘지|반드시|만 써|쓰지 마|덧붙이지/,
};

function run(mission, p) {
  let text;
  switch (mission.id) {
    case "m1": {
      const three = has(p, /3\s*줄|세\s*줄/);
      const kw = has(p, /학습 데이터|패턴|예측|키워드/);
      const faithful = has(p, /없는|덧붙이지|원문|지문에 있는/);
      const lines = kw
        ? [
            "인공지능은 많은 학습 데이터에서 스스로 규칙을 찾아낸다.",
            "고양이 사진처럼 공통된 패턴을 익혀 처음 보는 사진을 예측한다.",
            "학습 데이터가 치우치면 예측도 치우치므로 고르게 모아야 한다.",
          ]
        : [
            "인공지능은 데이터에서 스스로 규칙을 찾는다.",
            "고양이 사진을 보고 귀와 눈의 모양을 익힌다.",
            "데이터가 치우치면 결과도 치우칠 수 있다.",
          ];
      if (!faithful) lines.push("앞으로 인공지능은 모든 직업을 대체하게 될 것이다.");
      if (!three) lines.push("따라서 우리는 인공지능을 잘 이해하고 활용하는 태도가 필요하다.");
      text = lines.join("\n");
      break;
    }
    case "m2": {
      const table = has(p, /표/);
      const three = has(p, /3\s*(개|열)|열.{0,6}3|세\s*(개|열)|이름.{0,10}기능.{0,12}학교/);
      const all = has(p, /모두|전부|네\s*가지|4\s*(개|가지)|빠짐없이|코드 도우미/);
      const rows = [
        ["챗봇", "질문에 대화로 답함", "숙제 계획 세우기"],
        ["이미지 생성", "글을 그림으로 그려 줌", "발표 자료 삽화"],
        ["음성 합성", "글을 목소리로 읽어 줌", "오디오북 제작"],
        ["코드 도우미", "코드를 써 주거나 고쳐 줌", "정보 과제 오류 찾기"],
      ].slice(0, all ? 4 : 3);
      if (!table) {
        text = rows.map((r) => `- ${r[0]}: ${r[1]} (${r[2]})`).join("\n");
      } else if (three) {
        text = ["| 이름 | 기능 | 학교에서 쓰는 법 |", "|---|---|---|", ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
      } else {
        text = ["| 도구 | 설명 |", "|---|---|", ...rows.map((r) => `| ${r[0]} | ${r[1]}, ${r[2]} |`)].join("\n");
      }
      break;
    }
    case "m3": {
      const analogy = has(p, /비유|처럼|예를 들/);
      const short = has(p, /150|짧게|자 이내|두 문장|2문장/);
      const easy = has(p, /전문용어|쉬운 말|쉽게|어려운 말/);
      let parts = [];
      parts.push(
        easy
          ? "머신러닝은 컴퓨터가 많은 예시를 보고 스스로 규칙을 익히는 방법이야."
          : "머신러닝은 알고리즘이 데이터셋으로 모델을 학습시켜 파라미터를 조정하는 방법이야."
      );
      if (analogy) parts.push("마치 네가 문제집을 많이 풀수록 새 문제도 잘 푸는 것처럼 말이야.");
      if (!short)
        parts.push(
          easy
            ? "그래서 사진을 보고 고양이를 알아보거나, 좋아할 만한 영상을 추천해 주기도 해. 요즘은 우리 주변 여러 앱에서 쓰이고 있으니까 한번 찾아보면 재미있을 거야!"
            : "신경망을 쓰면 더 복잡한 패턴도 학습할 수 있고, 학습률과 가중치를 잘 정하는 것이 성능에 중요해. 이런 기술이 추천 서비스나 번역기에도 쓰이고 있어."
        );
      text = parts.join(" ");
      break;
    }
    case "m4": {
      const info = has(p, /날짜|장소|준비물|11월|과천|도시락/);
      const polite = has(p, /존댓말|높임|공손|-요|니다|예의/);
      const short = has(p, /5\s*줄|다섯\s*줄|짧게|이내/);
      const end = polite ? ["입니다.", "바랍니다.", "주세요.", "감사합니다."] : ["이야.", "해!", "챙겨!", "고마워!"];
      const lines = [
        `📢 체험학습 안내${polite ? "입니다." : "!"}`,
        info
          ? `날짜는 11월 27일(목), 장소는 국립과천과학관${end[0]}`
          : `다음 주에 체험학습을 가니 일정을 확인${polite ? "해 주세요." : "해!"}`,
        `오전 8시 40분까지 정문으로 모여 ${end[1]}`,
        info ? `준비물은 도시락, 필기구, 학생증이니 꼭 ${end[2]}` : `준비물은 담임 선생님께 확인${polite ? "해 주세요." : "해!"}`,
      ];
      if (!short) lines.push(`늦으면 버스가 먼저 출발할 수 있으니 시간을 꼭 지켜 ${polite ? "주세요." : "줘!"}`, `궁금한 점은 반장에게 물어봐 ${polite ? "주세요." : "줘!"}`);
      lines.push(`모두 즐거운 체험학습이 되길 ${polite ? "바랍니다." : "바라!"}`);
      text = lines.join("\n");
      break;
    }
    case "m5": {
      const table = has(p, /표/);
      const three = has(p, /3\s*문제|세\s*문제|3\s*개|세\s*개/);
      const topics = has(p, /개인정보/) && has(p, /저작권/);
      const rows = [
        topics
          ? ["친구 사진을 동의 없이 AI 앱에 올려도 된다.", "X", "얼굴 사진도 개인정보라 본인 동의가 필요하다."]
          : ["AI는 항상 정답만 말한다.", "X", "AI도 틀린 정보를 그럴듯하게 만들 수 있다."],
        topics
          ? ["AI가 만든 그림도 저작권을 확인해야 한다.", "O", "학습 자료와 이용약관에 따라 사용 범위가 다르다."]
          : ["AI에게 역할을 줄 수 있다.", "O", "'너는 선생님이야'처럼 역할을 줄 수 있다."],
        ["AI 답변은 출처를 확인하지 않아도 된다.", "X", "환각이 있을 수 있어 출처를 확인해야 한다."],
        ["AI 사용 사실을 밝히는 것이 좋다.", "O", "과제에 AI를 썼다면 밝히는 것이 정직하다."],
      ].slice(0, three ? 3 : 4);
      text = table
        ? ["| 문제 | 정답 | 해설 |", "|---|---|---|", ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n")
        : rows.map((r, i) => `${i + 1}. ${r[0]} (정답: ${r[1]}) — ${r[2]}`).join("\n");
      break;
    }
    default:
      text = "이 게임에서는 수업 미션과 관련된 요청만 할 수 있어요.";
  }
  return { text, model: "mock-solar" };
}

function judge(mission, p, output) {
  const elements = {};
  let n = 0;
  for (const [k, re] of Object.entries(ELEMENT_RE)) {
    elements[k] = re.test(p);
    if (elements[k] && k !== "role") n++; // 역할은 점수에 반영하지 않는다
  }
  const checks = {};
  mission.checklist
    .filter((c) => c.rule === "judge")
    .forEach((c) => {
      if (mission.id === "m1") checks[c.id] = !/모든 직업|대체하게/.test(output);
      else if (mission.id === "m3") checks[c.id] = /처럼|마치|같아/.test(output);
      else checks[c.id] = true;
    });
  const missing = Object.entries(elements)
    .filter(([k]) => k !== "role") // 역할은 선택 요소라 지적하지 않는다
    .filter(([, v]) => !v)
    .map(([k]) => ({ role: "역할", task: "과제", context: "맥락", format: "형식", example: "예시", constraint: "제약" })[k]);
  const quality = Math.min(30, 10 + n * 4);
  const feedback = missing.length
    ? `목표는 대체로 전달됐어요. 프롬프트에 ${missing.slice(0, 2).join("·")} 요소를 더 분명히 쓰면 출력이 더 정확해질 거예요.`
    : "6요소가 고르게 들어간 좋은 프롬프트예요. 출력도 목표에 잘 맞아요.";
  return { text: JSON.stringify({ quality_score: quality, feedback, elements, checks }), model: "mock-solar" };
}

module.exports = { run, judge };
