// 로컬 LLM(Ollama)으로 추천 이유를 자연스러운 문장으로 풀어 쓴다.
// 점수 계산에는 관여하지 않는다. 이미 계산된 공통점을 문장으로 엮는 역할만 한다.
// Ollama가 없거나 응답이 규칙을 어기면 공통점 목록을 그대로 보여준다.
window.MatchLLM = (function () {
  const CONFIG = {
    endpoint: 'http://localhost:11434',
    model: 'exaone3.5:2.4b', // 다른 모델로 바꾸려면 여기만 고치면 된다 (예: 'exaone3.5:7.8b')
    rareShare: 0.07,         // 후보의 7% 이하가 고른 태그를 '드문 취미'로 본다
    maxFacts: 5,
    retries: 1,              // 규칙 위반 시 다시 생성하는 횟수
    timeoutMs: 90000,
    options: { temperature: 0.4, top_p: 0.9, repeat_penalty: 1.1, num_predict: 160, num_ctx: 2048 },
  };

  // ---------- 프롬프트 ----------
  // 소형 모델은 규칙 설명보다 예시를 더 잘 따라 하므로, 짧은 규칙 + 모범 답안 2개로 구성한다.
  const SYSTEM_PROMPT = [
    '너는 소개팅 앱에서 추천 이유를 쓰는 작가야.',
    '[공통점]에 적힌 내용만 엮어서, 회원님에게 이 상대를 추천한 이유를 2문장으로 써.',
    '',
    '규칙:',
    "- 해요체로만 쓴다. 모든 문장은 '요'로 끝난다.",
    "- 상대는 [부르는 이름]으로 부르고, 회원님과 상대를 함께 말할 때는 '두 분'이라고 쓴다. '당신', '우리', '그녀'는 쓰지 않는다.",
    '- [공통점]에 없는 내용은 절대 지어내지 않는다. 다른 점은 말하지 않는다.',
    "- '드문 취미'가 있으면 첫 문장에 쓰고, 많은 사람이 고르지 않는 취미라 특별하다고 말한다.",
    '- 숫자, 한자, 영어, 이모지, 느낌표를 쓰지 않는다. MBTI 유형은 써도 된다.',
    "- '완벽', '운명', '천생연분', '최고', '최적' 같은 과장된 말을 쓰지 않는다.",
    '- 설명 문장만 출력한다.',
  ].join('\n');

  const EXAMPLES = [
    {
      user: factsMessage('하윤님', [
        '둘 다 담배를 피우지 않아요',
        '둘 다 저녁형이에요',
        '둘 다 주말엔 집에서 쉬는 편이에요',
        '함께 좋아하는 것: 영화, 게임',
        '둘 다 부산에 살아서 만나기 편해요',
      ]),
      assistant: '두 분 모두 저녁형에 주말엔 집에서 쉬는 걸 좋아해서 생활 리듬이 잘 맞아요. 영화와 게임이라는 공통 취미도 있고 같은 부산에 살아서, 하윤님과는 부담 없이 자주 만날 수 있을 거예요.',
    },
    {
      user: factsMessage('지호님', [
        '함께 좋아하는 것: 등산(드문 취미), 사진(드문 취미)',
        '둘 다 술은 가끔 마셔요',
      ]),
      assistant: '지호님은 등산과 사진처럼 많은 사람이 고르지 않는 취미를 두 분이 함께 좋아해서 추천했어요. 술도 둘 다 가끔 즐기는 편이라, 만나면 나눌 이야기가 많을 거예요.',
    },
  ];

  function factsMessage(callName, facts) {
    return `[부르는 이름] ${callName}\n[공통점]\n${facts.map(f => `- ${f}`).join('\n')}`;
  }

  // ---------- 공통점 → 자연스러운 문장 ----------
  // 모델이 원시 데이터를 해석하다 틀리지 않도록, 공통점만 코드가 미리 문장으로 만든다.
  // null은 넘기지 않는 항목이다. ('둘 다 운동을 거의 안 함'은 모델이 사족을 붙이기 쉬워서 뺀다)
  const SAME_PHRASES = {
    smoking: ['둘 다 담배를 피우지 않아요', '둘 다 담배를 가끔 피워요', '둘 다 담배를 피워요'],
    drinking: ['둘 다 술을 마시지 않아요', '둘 다 술은 가끔 마셔요', '둘 다 술자리를 즐기는 편이에요'],
    chronotype: ['둘 다 아침형이에요', '둘 다 아침형과 저녁형의 중간이에요', '둘 다 저녁형이에요'],
    weekend: ['둘 다 주말엔 집에서 쉬는 편이에요', '둘 다 주말엔 집과 밖을 반반 오가요', '둘 다 주말엔 밖에 나가는 편이에요'],
    exercise: [null, '둘 다 운동을 가끔 해요', '둘 다 운동을 꾸준히 자주 해요'],
  };

  // 한국 이름은 첫 글자를 성으로 보고 뗀다. (김수아 → 수아님)
  const callNameOf = name => `${name.length >= 3 ? name.slice(1) : name}님`;

  // 받침에 따라 을/를을 붙인다. (성격을, 키를)
  const withEul = word => {
    const code = word.charCodeAt(word.length - 1) - 0xac00;
    return `${word}${code >= 0 && code <= 11171 && code % 28 ? '을' : '를'}`;
  };

  function buildFacts({ me, candidate: c, parts, isRare }) {
    const facts = [];
    const common = me.tags.filter(t => c.tags.includes(t))
      .sort((a, b) => Number(isRare(b)) - Number(isRare(a)));
    if (common.length) {
      facts.push(`함께 좋아하는 것: ${common.map(t => (isRare(t) ? `${t}(드문 취미)` : t)).join(', ')}`);
    }
    // 연애 가치관. 외모 자기평가는 문장으로 언급하면 불편할 수 있어 넘기지 않는다.
    const values = parts.find(p => p.title === '가치관');
    if (me.values && c.values && me.values[0] === c.values[0]) {
      facts.push(`둘 다 연애에서 ${withEul(c.values[0])} 가장 중요하게 생각해요`);
    } else if (values && values.pts >= values.max * 0.75) {
      facts.push('연애에서 중요하게 여기는 순서가 비슷해요');
    }
    Object.keys(SAME_PHRASES).forEach(key => {
      if (me.lifestyle[key] === c.lifestyle[key]) {
        const phrase = SAME_PHRASES[key][c.lifestyle[key]];
        if (phrase) facts.push(phrase);
      }
    });
    if (me.region === c.region) facts.push(`둘 다 ${c.region}에 살아서 만나기 편해요`);
    const mbti = parts.find(p => p.title === 'MBTI');
    if (me.mbti && c.mbti && mbti && mbti.pts >= 3) {
      facts.push(`MBTI 궁합이 좋은 편이에요 (회원님 ${me.mbti}, ${callNameOf(c.name)} ${c.mbti})`);
    }
    return facts.slice(0, CONFIG.maxFacts);
  }

  // ---------- 응답 검사 ----------
  const BANNED = ['당신', '우리', '그녀', '완벽', '운명', '천생연분', '최고', '최적', '환상', '보장'];

  // 따옴표·머리말을 떼고, 3문장까지만 남기고, 길이 제한으로 끊긴 마지막 문장은 버린다.
  function clean(text) {
    let t = text.trim().replace(/^["'“‘「]+|["'”’」]+$/g, '').replace(/^(추천 이유|설명)\s*[:：]\s*/, '');
    const sentences = (t.match(/[^.?!]+[.?!]?/g) || []).map(s => s.trim()).filter(Boolean);
    if (sentences.length > 1 && !/[.?!]$/.test(sentences[sentences.length - 1])) sentences.pop();
    return sentences.slice(0, 3).join(' ');
  }

  // 규칙을 어긴 이유를 돌려준다. 문제가 없으면 빈 문자열.
  function violation(text) {
    if (text.length < 20) return '너무 짧음';
    if (text.length > 250) return '너무 김';
    if (/[㐀-䶿一-鿿]/.test(text)) return '한자 포함';
    if (/[A-Za-z]/.test(text.replace(/MBTI|\b[EI][NS][TF][JP]\b/g, ''))) return '영어 포함'; // MBTI 표기는 허용
    if (/\p{Extended_Pictographic}/u.test(text)) return '이모지 포함';
    if (/[!\d]/.test(text)) return '느낌표나 숫자 포함';
    const banned = BANNED.find(w => text.includes(w));
    if (banned) return `금지어 '${banned}'`;
    if (/술[은을도과]?\s*(안\s*)?피우/.test(text)) return "'술을 피우다' 오용"; // 담배와 술을 합칠 때 자주 틀린다
    const sentences = text.match(/[^.?!]+[.?!]?/g) || [];
    if (!sentences.every(s => /(요|죠)[.?]?$/.test(s.trim()))) return '해요체가 아닌 문장';
    return '';
  }

  // ---------- Ollama 호출 ----------
  async function fetchWithTimeout(url, opts = {}, ms = 2500) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    if (opts.signal) opts.signal.addEventListener('abort', () => ctrl.abort());
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  // { ok: true } 또는 { ok: false, reason: 'no-server' | 'no-model' }
  async function checkAvailable() {
    try {
      const res = await fetchWithTimeout(`${CONFIG.endpoint}/api/tags`);
      if (!res.ok) return { ok: false, reason: 'no-server' };
      const { models = [] } = await res.json();
      return models.some(m => m.name === CONFIG.model || m.model === CONFIG.model)
        ? { ok: true }
        : { ok: false, reason: 'no-model' };
    } catch {
      return { ok: false, reason: 'no-server' };
    }
  }

  // 스트리밍으로 받아 onToken(지금까지의 글)을 계속 호출하고, 최종 글을 돌려준다.
  async function stream(messages, signal, onToken) {
    const res = await fetchWithTimeout(`${CONFIG.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: CONFIG.model, messages, stream: true, options: CONFIG.options }),
      signal,
    }, CONFIG.timeoutMs);
    if (!res.ok) throw new Error(`Ollama 응답 오류 ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const chunk = JSON.parse(line);
        if (chunk.error) throw new Error(chunk.error);
        text += chunk.message ? chunk.message.content : '';
        onToken(text);
      }
    }
    return text;
  }

  // 추천 이유를 만든다. 결과: { source: 'llm' | 'fallback' | 'none', text, facts, reason }
  async function explain(input, { signal, onToken = () => {}, onRetry = () => {} } = {}) {
    const facts = buildFacts(input);
    if (!facts.length) return { source: 'none', facts };

    const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
    EXAMPLES.forEach(ex => messages.push({ role: 'user', content: ex.user }, { role: 'assistant', content: ex.assistant }));
    messages.push({ role: 'user', content: factsMessage(callNameOf(input.candidate.name), facts) });

    let reason = '';
    for (let attempt = 0; attempt <= CONFIG.retries; attempt++) {
      if (attempt > 0) onRetry(reason);
      const text = clean(await stream(messages, signal, onToken));
      reason = violation(text);
      if (!reason) return { source: 'llm', text, facts };
    }
    return { source: 'fallback', facts, reason };
  }

  return { CONFIG, checkAvailable, explain, buildFacts, violation, clean };
})();
