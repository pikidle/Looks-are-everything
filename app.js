(function () {
  const C = window.MATCH_CONFIG;
  const W = C.WEIGHTS;
  const CANDIDATES = window.CANDIDATES;
  const $ = sel => document.querySelector(sel);

  const esc = s => String(s).replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
  const round1 = n => Math.round(n * 10) / 10;
  const fmt = n => round1(n).toFixed(1).replace(/\.0$/, '');
  const GENDER_LABEL = { male: '남성', female: '여성', any: '상관없음' };

  const LIFESTYLE_MAX = W.lifestyleByDiff[0] * C.LIFESTYLE.length;
  const MBTI_MAX = W.mbti.EI + W.mbti.NS + W.mbti.TF;

  // ---------- 태그 희귀도 ----------
  // 후보 전체에서 적게 선택된 태그일수록 값이 크다. (IDF 방식, +1은 0으로 나누기 방지용 보정)
  const tagCount = Object.fromEntries(C.TAGS.map(t => [t, 0]));
  CANDIDATES.forEach(c => c.tags.forEach(t => { tagCount[t] += 1; }));
  const N = CANDIDATES.length;
  const RARITY = Object.fromEntries(C.TAGS.map(t => [t, Math.log((N + 1) / (tagCount[t] + 1)) + 1]));
  const rarityOf = tags => tags.reduce((sum, t) => sum + RARITY[t], 0);
  const isRare = t => tagCount[t] / N <= window.MatchLLM.CONFIG.rareShare;

  // ---------- 프로필 사진 ----------
  // 사진은 서버로 보내지 않고, 브라우저 메모리의 임시 URL(blob:)로만 보여준다.
  const MAX_PHOTO_MB = 10;
  let photoUrl = null;

  function setPhoto(url) {
    photoUrl = url;
    const preview = $('#photo-preview');
    preview.innerHTML = url ? `<img src="${url}" alt="내 프로필 사진">` : '사진 없음';
    preview.classList.toggle('placeholder', !url);
    $('#photo-remove').hidden = !url;
  }

  function setupPhoto() {
    const input = $('#photo');
    const error = $('#photo-error');
    const fail = msg => { error.textContent = msg; error.hidden = false; };

    input.addEventListener('change', () => {
      const file = input.files[0];
      input.value = ''; // 같은 파일을 다시 골라도 change가 일어나도록
      if (!file) return;
      error.hidden = true;
      if (!file.type.startsWith('image/')) return fail('이미지 파일만 올릴 수 있어요.');
      if (file.size > MAX_PHOTO_MB * 1024 * 1024) return fail(`${MAX_PHOTO_MB}MB 이하의 사진을 올려 주세요.`);

      // 브라우저가 실제로 그릴 수 있는 형식인지 확인한 뒤 적용 (예: HEIC는 대부분 실패)
      const url = URL.createObjectURL(file);
      const probe = new Image();
      probe.onload = () => setPhoto(url);
      probe.onerror = () => {
        URL.revokeObjectURL(url);
        fail('이 사진 형식은 표시할 수 없어요. JPG, PNG, WebP 파일을 올려 주세요.');
      };
      probe.src = url;
    });

    $('#photo-remove').addEventListener('click', () => setPhoto(null));
  }

  // 사진이 없으면 이름 글자와, 이름에서 뽑은 색으로 대신 표시한다.
  function avatar(photo, label, size) {
    if (photo) return `<img class="avatar ${size}" src="${esc(photo)}" alt="${esc(label)} 사진">`;
    const hue = [...label].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 0);
    return `<div class="avatar ${size} initial" style="--hue:${hue}" role="img" aria-label="${esc(label)} (사진 없음)">${esc(label.slice(-2))}</div>`;
  }

  // ---------- 1. 질문 (한 화면에 한 질문) ----------
  function choices(name, options, cls = '') {
    return `<div class="choices ${cls}">${options.map(([value, label]) => `
      <label class="choice"><input type="radio" name="${name}" value="${value}"><span>${label}</span></label>`).join('')}
    </div>`;
  }

  const BIO_HINT = '선택이에요. 적어두면 상대방이 나를 더 잘 알 수 있고, 매칭에도 도움이 돼요.';

  // auto: 하나를 고르면 자동으로 다음 질문으로 넘어간다.
  // optional: 비워 두면 '다음' 대신 '건너뛰기' 버튼이 보인다.
  const STEPS = [
    {
      title: '먼저, 이름과 사진을 알려 주세요',
      hint: '사진은 이 브라우저 안에서만 쓰이고 어디에도 업로드되지 않아요.',
      body: `
        <input class="text-input name-input" type="text" name="name" maxlength="20" placeholder="이름" aria-label="이름" autocomplete="given-name">
        <div class="photo-field">
          <div id="photo-preview" class="avatar avatar-xl placeholder">사진 없음</div>
          <div class="photo-actions">
            <label class="btn">
              사진 선택
              <input type="file" id="photo" class="visually-hidden" accept="image/jpeg,image/png,image/webp,image/gif">
            </label>
            <button type="button" id="photo-remove" class="btn ghost" hidden>삭제</button>
          </div>
          <p id="photo-error" class="field-error" hidden></p>
        </div>`,
      validate: p => (!p.name ? '이름을 입력해 주세요.' : !p.photo ? '프로필 사진을 올려 주세요.' : ''),
    },
    {
      title: '성별이 어떻게 되세요?',
      auto: true,
      body: choices('gender', [['male', '남성'], ['female', '여성']]),
      validate: p => (p.gender ? '' : '성별을 선택해 주세요.'),
    },
    {
      title: '나이가 어떻게 되세요?',
      body: `
        <div class="big-input">
          <input type="number" name="age" min="19" max="99" inputmode="numeric" placeholder="28" aria-label="내 나이">
          <span>세</span>
        </div>`,
      validate: p => (p.age >= 19 && p.age <= 99 ? '' : '나이는 19~99 사이로 입력해 주세요.'),
    },
    {
      title: '몇 살 정도의 상대를 원하세요?',
      body: `
        <div class="big-input">
          <input type="number" name="wantAgeMin" min="19" max="99" inputmode="numeric" placeholder="25" aria-label="원하는 최소 나이">
          <span>~</span>
          <input type="number" name="wantAgeMax" min="19" max="99" inputmode="numeric" placeholder="31" aria-label="원하는 최대 나이">
          <span>세</span>
        </div>`,
      onEnter: prefillAgeRange,
      validate: p => {
        const [lo, hi] = p.wantAge;
        return lo >= 19 && hi <= 99 && lo <= hi ? '' : '19~99 사이로, 최소 나이가 최대 나이보다 크지 않게 입력해 주세요.';
      },
    },
    {
      title: '어디에 살고 계세요?',
      auto: true,
      body: choices('region', C.REGIONS.map(r => [r, r]), 'grid'),
      validate: p => (p.region ? '' : '사는 지역을 선택해 주세요.'),
    },
    {
      title: '상대는 어디에 살아도 괜찮으세요?',
      auto: true,
      body: choices('regionPref', [['same', '같은 시·도에 사는 분만'], ['any', '어디든 괜찮아요']]),
      validate: p => (p.regionPref ? '' : '하나를 선택해 주세요.'),
    },
    ...C.LIFESTYLE.map(q => ({
      title: q.question,
      auto: true,
      body: choices(q.key, q.options.map((o, i) => [i, o])),
      validate: p => (Number.isNaN(p.lifestyle[q.key]) ? '하나를 선택해 주세요.' : ''),
    })),
    {
      title: '요즘 관심 있는 것들을 골라 주세요',
      hint: '원하는 만큼 골라 주세요. 많이 고른다고 점수가 오르지는 않아요.',
      body: `
        <div class="choices tags">${C.TAGS.map(t => `
          <label class="choice"><input type="checkbox" name="tags" value="${t}"><span>${t}</span></label>`).join('')}
        </div>
        <p class="counter" id="tag-count">0개 선택</p>`,
      validate: p => (p.tags.length ? '' : '관심사를 1개 이상 골라 주세요.'),
    },
    {
      title: '연애에서 중요한 순서대로 눌러 주세요',
      hint: '가장 중요한 것부터 차례로 누르면 번호가 매겨져요. 다시 누르면 취소돼요.',
      body: `
        <div class="rank-pick" id="rank-pick">${C.VALUES.map(v => `
          <button type="button" class="rank-item" data-value="${v}"><span class="rank-no"></span><span>${v}</span></button>`).join('')}
        </div>
        <input type="hidden" name="values" id="values-input">
        <button type="button" class="btn ghost rank-reset" id="rank-reset">다시 고르기</button>`,
      validate: p => (p.values.length === C.VALUES.length ? '' : `${C.VALUES.length}가지를 모두 순서대로 눌러 주세요.`),
    },
    {
      title: '자신의 외모는 어떻다고 생각하시나요?',
      hint: `1~3점 ${C.LOOKS_TIERS[0].label} · 4~7점 ${C.LOOKS_TIERS[1].label} · 8~10점 ${C.LOOKS_TIERS[2].label}`,
      auto: true,
      body: choices('looks', Array.from({ length: 10 }, (_, i) => [i + 1, `${i + 1}`]), 'grid scale'),
      validate: p => (Number.isNaN(p.looks) ? '점수를 하나 골라 주세요.' : ''),
    },
    {
      title: 'MBTI를 알려 주세요',
      hint: '재미로만 참고해요. 모르면 넘어가도 괜찮아요.',
      auto: true,
      body: choices('mbti', [...C.MBTI_TYPES.map(t => [t, t]), ['', '잘 모르겠어요']], 'grid mbti'),
      validate: () => '',
    },
    {
      title: '나를 한 줄로 소개해 주세요',
      hint: BIO_HINT,
      optional: true,
      body: '<input class="text-input" type="text" name="intro" maxlength="80" placeholder="예: 주말엔 맛집 찾아다니는 걸 좋아해요.">',
      validate: () => '',
    },
    {
      title: '어떤 사람을 만나고 싶은지 한 줄로 적어 주세요',
      hint: BIO_HINT,
      optional: true,
      body: '<input class="text-input" type="text" name="ideal" maxlength="80" placeholder="예: 대화가 잘 통하는 사람이면 좋겠어요.">',
      validate: () => '',
    },
  ];

  // 나이를 입력했으면 원하는 나이 범위를 ±3세로 미리 채워 둔다.
  function prefillAgeRange() {
    const f = $('#profile-form');
    const age = Number(f.age.value);
    if (age >= 19 && !f.wantAgeMin.value && !f.wantAgeMax.value) {
      f.wantAgeMin.value = Math.max(19, age - 3);
      f.wantAgeMax.value = Math.min(99, age + 3);
    }
  }

  function buildWizard() {
    $('#wizard-pages').innerHTML = STEPS.map((s, i) => `
      <section class="q-page" hidden>
        <p class="q-count">Q${i + 1}</p>
        <h2 class="q-title">${s.title}</h2>
        ${s.hint ? `<p class="q-hint">${s.hint}</p>` : ''}
        <div class="q-body">${s.body}</div>
        <p class="q-error" role="alert" hidden></p>
      </section>`).join('');
    $('#intro-meta').textContent = `질문 ${STEPS.length}개 · 약 2분`;
  }

  function readProfile() {
    const fd = new FormData($('#profile-form'));
    const num = key => (fd.get(key) === null || fd.get(key) === '' ? NaN : Number(fd.get(key)));
    return {
      name: (fd.get('name') || '').trim(),
      gender: fd.get('gender'),
      // 상대 성별은 따로 묻지 않고 내 성별의 반대로 정한다.
      wantGender: { male: 'female', female: 'male' }[fd.get('gender')] || null,
      age: num('age'),
      wantAge: [num('wantAgeMin'), num('wantAgeMax')],
      region: fd.get('region'),
      regionPref: fd.get('regionPref'),
      lifestyle: Object.fromEntries(C.LIFESTYLE.map(q => [q.key, num(q.key)])),
      tags: fd.getAll('tags'),
      values: (fd.get('values') || '').split(',').filter(Boolean),
      looks: num('looks'),
      mbti: fd.get('mbti') || null,
      photo: photoUrl,
      intro: (fd.get('intro') || '').trim(),
      ideal: (fd.get('ideal') || '').trim(),
    };
  }

  // ---------- 2-1. 필터 (양방향) ----------
  const genderOk = (wanter, target) => wanter.wantGender === 'any' || wanter.wantGender === target.gender;
  const ageOk = (wanter, target) => target.age >= wanter.wantAge[0] && target.age <= wanter.wantAge[1];
  const regionOk = (a, b) => (a.regionPref === 'same' || b.regionPref === 'same' ? a.region === b.region : true);

  function filterReason(me, c) {
    if (!genderOk(me, c) || !genderOk(c, me)) return 'gender';
    if (!ageOk(me, c) || !ageOk(c, me)) return 'age';
    if (!regionOk(me, c)) return 'region';
    return null;
  }

  // ---------- 2-2. 점수 ----------
  function scoreLifestyle(me, c) {
    let same = 0;
    let near = 0;
    let pts = 0;
    const lines = C.LIFESTYLE.map(q => {
      const diff = Math.abs(me.lifestyle[q.key] - c.lifestyle[q.key]);
      if (diff === 0) same++;
      if (diff === 1) near++;
      pts += W.lifestyleByDiff[diff];
      return `${q.label}: 나 '${q.options[me.lifestyle[q.key]]}' · 상대 '${q.options[c.lifestyle[q.key]]}' → ${W.lifestyleByDiff[diff]}점`;
    });
    return {
      title: '라이프스타일', pts, max: LIFESTYLE_MAX,
      summary: `${C.LIFESTYLE.length}문항 중 ${same}개 일치, ${near}개 한 칸 차이`,
      lines,
    };
  }

  function scoreInterests(me, c) {
    const common = me.tags.filter(t => c.tags.includes(t));
    const mine = rarityOf(me.tags);
    const theirs = rarityOf(c.tags);
    const shared = rarityOf(common);
    const ratio = (2 * shared) / (mine + theirs);
    const pts = round1(ratio * W.interests);
    return {
      title: '관심사', pts, max: W.interests,
      summary: common.length
        ? `겹친 태그 ${common.length}개 (희귀도 가중 다이스 계수 ${ratio.toFixed(2)})`
        : '겹친 태그 없음',
      lines: [
        common.length
          ? `겹친 태그: ${common.map(t => `${t}(희귀도 ${RARITY[t].toFixed(2)})`).join(', ')}`
          : '겹친 태그가 없어요.',
        `계산: 2 × ${shared.toFixed(2)} ÷ (나 ${mine.toFixed(2)} + 상대 ${theirs.toFixed(2)}) = ${ratio.toFixed(2)}`,
        `${ratio.toFixed(2)} × ${W.interests} = ${fmt(pts)}점`,
      ],
      common,
    };
  }

  // 두 사람의 순위가 얼마나 비슷한지: 항목별 순위 차이를 모두 더한 값(풋룰 거리)을 최대값으로 나눠 뒤집는다.
  // 5개 항목이면 순위 차이 합의 최대는 12 (완전히 거꾸로일 때).
  const VALUES_MAX_DIST = Math.floor((C.VALUES.length ** 2) / 2);
  function scoreValues(me, c) {
    const dist = C.VALUES.reduce((sum, v) => sum + Math.abs(me.values.indexOf(v) - c.values.indexOf(v)), 0);
    const ratio = 1 - dist / VALUES_MAX_DIST;
    const pts = round1(ratio * W.values);
    const sameTop = me.values[0] === c.values[0];
    return {
      title: '가치관', pts, max: W.values,
      summary: sameTop ? `둘 다 '${c.values[0]}'을(를) 가장 중요하게 생각함` : `순위 차이 합 ${dist} / 최대 ${VALUES_MAX_DIST}`,
      lines: [
        `나: ${me.values.join(' > ')}`,
        `상대: ${c.values.join(' > ')}`,
        `계산: (1 - ${dist} ÷ ${VALUES_MAX_DIST}) × ${W.values} = ${fmt(pts)}점`,
      ],
    };
  }

  const looksTier = score => C.LOOKS_TIERS.findIndex(t => score <= t.max);
  function scoreLooks(me, c) {
    const mine = C.LOOKS_TIERS[looksTier(me.looks)];
    const theirs = C.LOOKS_TIERS[looksTier(c.looks)];
    const same = mine === theirs;
    return {
      title: '외모 구간', pts: same ? W.looks : 0, max: W.looks,
      summary: same ? `둘 다 '${mine.name}' 구간` : '다른 구간',
      lines: [
        `외모 자기평가: 나 ${me.looks}점(${mine.name}) · 상대 ${c.looks}점(${theirs.name})`,
        same ? `같은 구간 → ${W.looks}점` : '다른 구간 → 0점',
      ],
    };
  }

  function scoreRegion(me, c) {
    const same = me.region === c.region;
    return {
      title: '지역', pts: same ? W.region : 0, max: W.region,
      summary: same ? `둘 다 ${c.region}` : `나 ${me.region} · 상대 ${c.region}`,
      lines: [same ? `같은 시·도 → ${W.region}점` : '다른 시·도 → 0점'],
    };
  }

  function scoreMbti(me, c) {
    const base = { title: 'MBTI', max: MBTI_MAX };
    if (!me.mbti || !c.mbti) {
      return { ...base, pts: 0, summary: '한쪽 이상 미입력', lines: ['둘 다 MBTI를 입력했을 때만 계산해요.'] };
    }
    const ei = me.mbti[0] !== c.mbti[0];
    const ns = me.mbti[1] === c.mbti[1];
    const tf = me.mbti[2] === c.mbti[2];
    const pts = (ei ? W.mbti.EI : 0) + (ns ? W.mbti.NS : 0) + (tf ? W.mbti.TF : 0);
    return {
      ...base, pts,
      summary: `나 ${me.mbti} · 상대 ${c.mbti}`,
      lines: [
        `E/I ${ei ? '다름' : '같음'} → ${ei ? W.mbti.EI : 0}점`,
        `N/S ${ns ? '같음' : '다름'} → ${ns ? W.mbti.NS : 0}점`,
        `T/F ${tf ? '같음' : '다름'} → ${tf ? W.mbti.TF : 0}점`,
      ],
    };
  }

  function score(me, c) {
    // 순서 주의: 관심사는 parts[1]에 있어야 한다. (겹친 태그 강조에 사용)
    const parts = [
      scoreLifestyle(me, c), scoreInterests(me, c), scoreValues(me, c),
      scoreRegion(me, c), scoreLooks(me, c), scoreMbti(me, c),
    ];
    const total = round1(parts.reduce((sum, p) => sum + p.pts, 0));
    return { candidate: c, parts, total };
  }

  function recommend(me) {
    const dropped = { gender: 0, age: 0, region: 0 };
    const passed = [];
    CANDIDATES.forEach(c => {
      const reason = filterReason(me, c);
      if (reason) dropped[reason]++;
      else passed.push(score(me, c));
    });
    passed.sort((a, b) => b.total - a.total || a.candidate.id - b.candidate.id);
    return { dropped, passedCount: passed.length, top: passed.slice(0, C.TOP_N) };
  }

  // ---------- 3. 결과 화면 ----------
  function renderMe(me) {
    const bio = [
      me.intro ? `<p><b>자기소개</b> ${esc(me.intro)}</p>` : '',
      me.ideal ? `<p><b>이상형</b> ${esc(me.ideal)}</p>` : '',
    ].join('');
    return `
      <div class="me">
        <div class="me-head">
          ${avatar(me.photo, me.name, 'avatar-lg')}
          <div>
            <p class="me-label">내 프로필</p>
            <h3>${esc(me.name)}</h3>
            <p class="meta">${me.age}세 · ${GENDER_LABEL[me.gender]} · ${esc(me.region)}${me.mbti ? ` · ${me.mbti}` : ''}</p>
          </div>
        </div>
        <div class="tag-list">${me.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
        ${bio || '<p class="muted">자기소개를 쓰지 않았어요. 쓰면 상대방이 나를 더 잘 알 수 있어요.</p>'}
      </div>`;
  }

  const metaOf = c => `${c.age}세 · ${GENDER_LABEL[c.gender]} · ${esc(c.region)}${c.mbti ? ` · ${c.mbti}` : ''}`;
  const bestPart = result => result.parts.slice().sort((a, b) => b.pts - a.pts)[0];
  const AI_BOX = `
    <div class="ai-reason" hidden>
      <p class="ai-label">AI 추천 이유</p>
      <div class="ai-text"></div>
    </div>`;

  // 항목별 점수 막대 + 근거, 태그, 자기소개. TOP 3 카드와 4위 이하 목록이 함께 쓴다.
  function detailHtml(result) {
    const c = result.candidate;
    const common = result.parts[1].common;
    const parts = result.parts.map(p => `
      <details>
        <summary>
          <span class="part-title">${p.title}</span>
          <span class="bar"><i style="width:${(p.pts / p.max) * 100}%"></i></span>
          <span class="part-pts">${fmt(p.pts)} / ${p.max}</span>
        </summary>
        <p class="part-summary">${esc(p.summary)}</p>
        <ul>${p.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
      </details>`).join('');
    const tags = c.tags.map(t => `<span class="tag${common.includes(t) ? ' match' : ''}">${esc(t)}</span>`).join('');
    return `
      <div class="breakdown">${parts}</div>
      <div class="tag-list">${tags}</div>
      <div class="bio">
        <p><b>자기소개</b> ${c.intro ? esc(c.intro) : '<span class="muted">작성하지 않았어요</span>'}</p>
        <p><b>이상형</b> ${c.ideal ? esc(c.ideal) : '<span class="muted">작성하지 않았어요</span>'}</p>
      </div>`;
  }

  // 1~3위: 큰 사진, 메달, 차오르는 점수 링으로 강조한다. --delay로 순서대로 등장시킨다.
  function renderPodiumCard(result, i) {
    const c = result.candidate;
    const best = bestPart(result);
    const common = result.parts[1].common;
    return `
      <article class="podium-card rank-${i + 1}" data-index="${i}" style="--delay:${i * 180}ms">
        <div class="podium-head">
          <div class="pic">
            ${avatar(c.photo, c.name, i === 0 ? 'avatar-podium' : 'avatar-lg')}
            <span class="medal" aria-label="${i + 1}위">${i + 1}</span>
          </div>
          <div class="podium-who">
            <h3>${esc(c.name)}</h3>
            <p class="meta">${metaOf(c)}</p>
          </div>
          <div class="score-ring" style="--p:${result.total}">
            <strong data-count="${result.total}">0</strong><span>점</span>
          </div>
        </div>
        ${common.length ? `<div class="tag-list">${common.map(t => `<span class="tag match">${esc(t)}</span>`).join('')}</div>` : ''}
        ${best.pts > 0 ? `<p class="highlight">가장 큰 점수를 받은 항목: <b>${best.title}</b> (${fmt(best.pts)} / ${best.max})</p>` : ''}
        ${AI_BOX}
        <details class="more-detail">
          <summary>점수 자세히 보기</summary>
          ${detailHtml(result)}
        </details>
      </article>`;
  }

  // 4위 이하: 한 줄로 접어 두고, 누르면 상세가 펼쳐진다.
  function renderRow(result, i) {
    const c = result.candidate;
    return `
      <details class="rank-row" data-index="${i}" style="--delay:${(i - C.PODIUM_N) * 60}ms">
        <summary>
          <span class="row-rank">${i + 1}</span>
          ${avatar(c.photo, c.name, 'avatar-sm')}
          <span class="row-who"><b>${esc(c.name)}</b><small>${metaOf(c)}</small></span>
          <span class="row-score"><span class="bar"><i style="width:${result.total}%"></i></span><b>${fmt(result.total)}</b></span>
        </summary>
        <div class="row-body">${AI_BOX}${detailHtml(result)}</div>
      </details>`;
  }

  function renderResults(me, rec) {
    if (!rec.top.length) {
      return '<p class="empty">조건을 모두 만족하는 후보가 없어요. 나이 범위를 넓히거나 거리를 \'어디든 괜찮아요\'로 바꿔 보세요.</p>';
    }
    const podium = rec.top.slice(0, C.PODIUM_N);
    const rest = rec.top.slice(C.PODIUM_N);
    return `
      <p class="results-sub">조건을 통과한 ${rec.passedCount}명 중 가장 잘 맞는 분들이에요</p>
      <div class="podium">${podium.map(renderPodiumCard).join('')}</div>
      ${rest.length ? `
        <div class="rest" id="rest" hidden>
          <h3 class="rest-title">${C.PODIUM_N + 1}위 ~ ${C.PODIUM_N + rest.length}위</h3>
          ${rest.map((r, k) => renderRow(r, C.PODIUM_N + k)).join('')}
        </div>
        <button type="button" class="btn ghost more-btn" id="more" data-count="${rest.length}">
          ${C.PODIUM_N + 1}위 ~ ${C.PODIUM_N + rest.length}위 더보기 (${rest.length}명)
        </button>` : ''}`;
  }

  // 점수 숫자가 0부터 올라가는 애니메이션. 카드 등장 순서(--delay)에 맞춰 시작한다.
  function countUp(root) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.querySelectorAll('.score-ring [data-count]').forEach((el, i) => {
      const target = Number(el.dataset.count);
      if (reduce) { el.textContent = fmt(target); return; }
      const delay = i * 180 + 200;
      const duration = 1100;
      // 탭이 백그라운드면 requestAnimationFrame이 멈추므로, 끝날 시간에는 최종값을 확실히 넣어 둔다.
      setTimeout(() => { el.textContent = fmt(target); }, delay + duration + 50);
      let t0 = null;
      const tick = now => {
        if (t0 === null) t0 = now + delay;
        const k = Math.min(1, Math.max(0, (now - t0) / duration));
        el.textContent = fmt(target * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  function renderLogic(me, rec) {
    const rarityRows = C.TAGS.slice()
      .sort((a, b) => RARITY[b] - RARITY[a])
      .map(t => `<span class="tag${me.tags.includes(t) ? ' match' : ''}">${t} <small>${tagCount[t]}명 · ${RARITY[t].toFixed(2)}</small></span>`)
      .join('');

    return `
      <h2>이렇게 골랐어요</h2>

      <div class="step">
        <h3><span class="num">1</span>조건 필터 (양방향)</h3>
        <p>나의 조건과 <b>상대의 조건</b>을 모두 만족해야 후보가 돼요. 하나라도 어긋나면 점수를 계산하지 않고 제외해요.</p>
        <ul>
          <li><b>성별</b>: 상대가 내 반대 성별이고, 상대가 원하는 성별도 내 성별이어야 함</li>
          <li><b>나이</b>: 상대가 내 범위 안에 있고, 나도 상대 범위 안에 있어야 함</li>
          <li><b>지역</b>: 둘 중 한 명이라도 '같은 시·도만'을 골랐다면 같은 지역이어야 함</li>
        </ul>
        <div class="funnel">
          <span>전체 <b>${N}</b>명</span>
          <span>성별 탈락 <b>${rec.dropped.gender}</b></span>
          <span>나이 탈락 <b>${rec.dropped.age}</b></span>
          <span>지역 탈락 <b>${rec.dropped.region}</b></span>
          <span class="pass">통과 <b>${rec.passedCount}</b>명</span>
        </div>
      </div>

      <div class="step">
        <h3><span class="num">2</span>궁합 점수 (100점 만점)</h3>
        <table>
          <thead><tr><th>항목</th><th>배점</th><th>계산 방식</th></tr></thead>
          <tbody>
            <tr><td>라이프스타일</td><td>${LIFESTYLE_MAX}</td><td>${C.LIFESTYLE.length}문항 × ${W.lifestyleByDiff[0]}점. 같으면 ${W.lifestyleByDiff[0]}점, 한 칸 차이 ${W.lifestyleByDiff[1]}점, 두 칸 차이 ${W.lifestyleByDiff[2]}점</td></tr>
            <tr><td>관심사</td><td>${W.interests}</td><td>희귀도 가중 다이스 계수 × ${W.interests}</td></tr>
            <tr><td>가치관</td><td>${W.values}</td><td>${C.VALUES.join('·')}의 중요도 순위가 비슷할수록 높음. (1 - 순위 차이 합 ÷ ${VALUES_MAX_DIST}) × ${W.values}</td></tr>
            <tr><td>지역</td><td>${W.region}</td><td>같은 시·도면 ${W.region}점</td></tr>
            <tr><td>외모 구간</td><td>${W.looks}</td><td>외모 자기평가(1~10점)가 같은 구간이면 ${W.looks}점. 구간: 1~3 · 4~7 · 8~10</td></tr>
            <tr><td>MBTI</td><td>${MBTI_MAX}</td><td>E/I 다름 ${W.mbti.EI}점, N/S 같음 ${W.mbti.NS}점, T/F 같음 ${W.mbti.TF}점 (재미용, 둘 다 입력 시)</td></tr>
          </tbody>
        </table>

        <h4>관심사 점수는 왜 이렇게 계산하나요?</h4>
        <p class="formula">관심사 점수 = 2 × (겹친 태그의 희귀도 합) ÷ (내 태그 희귀도 합 + 상대 태그 희귀도 합) × ${W.interests}</p>
        <ul>
          <li><b>다이스 계수</b>: 겹친 개수를 그대로 세면 태그를 많이 고를수록 점수가 올라가요. 양쪽이 고른 전체 태그 수로 나누면 많이 고를수록 분모도 커져서 점수를 부풀릴 수 없어요.</li>
          <li><b>희귀도 가중치</b>: 누구나 고르는 태그보다 드문 태그가 겹칠 때 더 특별한 공통점이라고 봐요. 희귀도 = ln((후보 수 + 1) ÷ (그 태그를 고른 후보 수 + 1)) + 1</li>
        </ul>
        <p class="muted">태그별 선택 인원과 희귀도 (내가 고른 태그는 강조 표시)</p>
        <div class="tag-list">${rarityRows}</div>

        <h4>가치관 점수는 어떻게 계산하나요?</h4>
        <p class="formula">가치관 점수 = (1 - 항목별 순위 차이의 합 ÷ ${VALUES_MAX_DIST}) × ${W.values}</p>
        <ul>
          <li>예: 나는 성격을 1위, 상대는 3위로 골랐다면 그 항목의 차이는 2예요. ${C.VALUES.length}개 항목의 차이를 모두 더해요.</li>
          <li>순서가 완전히 같으면 차이 합이 0이라 만점, 완전히 거꾸로면 ${VALUES_MAX_DIST}라 0점이에요.</li>
        </ul>
      </div>

      <div class="step">
        <h3><span class="num">3</span>정렬</h3>
        <p>필터를 통과한 후보를 총점이 높은 순서로 정렬해서 상위 ${C.TOP_N}명을 추천하고, 그중 1~${C.PODIUM_N}위는 크게 보여줘요. 사진, 자기소개, 이상형은 점수에 반영하지 않고 보여주기만 해요. 외모는 사진이 아니라 본인이 매긴 자기평가 구간만 점수에 써요.</p>
      </div>

      <div class="step">
        <h3><span class="num">4</span>AI 추천 이유 (로컬 LLM)</h3>
        <p>점수 계산이 끝나면 코드가 두 사람의 <b>공통점만</b> 문장으로 정리해서 이 PC의 로컬 LLM에 넘겨요. LLM은 그 공통점을 자연스럽게 엮는 역할만 하고, 점수나 순위에는 관여하지 않아요. 사진은 넘기지 않아요.</p>
        <ul>
          <li>만들어진 문장은 해요체, 금지어(완벽·운명 등), 한자·영어·숫자 포함 여부를 코드로 검사해요.</li>
          <li>규칙을 어기면 한 번 다시 쓰게 하고, 그래도 안 되면 공통점 목록을 그대로 보여줘요.</li>
        </ul>
        <p id="ai-status" class="ai-status">로컬 AI 연결을 확인하고 있어요…</p>
      </div>`;
  }

  // ---------- AI 추천 이유 (로컬 LLM) ----------
  const LLM = window.MatchLLM;
  let aiRun = null; // 진행 중인 생성. 답변을 수정하면 취소한다.

  function setAi(box, state, text) {
    box.dataset.state = state;
    box.querySelector('.ai-text').textContent = text;
  }

  // 규칙을 끝내 지키지 못하면 모델 문장 대신 공통점 목록을 보여준다.
  function setAiFacts(box, facts) {
    box.dataset.state = 'facts';
    box.querySelector('.ai-label').textContent = '공통점 요약';
    const list = document.createElement('ul');
    facts.forEach(f => {
      const li = document.createElement('li');
      li.textContent = f;
      list.appendChild(li);
    });
    box.querySelector('.ai-text').replaceChildren(list);
  }

  function renderAiStatus(status) {
    const el = $('#ai-status');
    if (!el) return;
    const model = LLM.CONFIG.model;
    if (status.ok) {
      el.dataset.state = 'ok';
      el.textContent = `로컬 AI(${model})가 연결되어 있어요. 추천 이유는 이 PC 안에서만 만들어지고 외부로 전송되지 않아요.`;
    } else if (status.reason === 'no-model') {
      el.dataset.state = 'off';
      el.textContent = `Ollama는 실행 중이지만 ${model} 모델이 없어요. 터미널에서 'ollama pull ${model}'을 실행해 주세요.`;
    } else {
      // 서버가 꺼져 있는 것과 접근 허용(CORS)이 안 된 것은 브라우저에서 구분할 수 없어서 둘 다 안내한다.
      el.dataset.state = 'off';
      el.innerHTML = `
        <b>로컬 AI가 연결되지 않아 기본 설명만 보여드려요.</b><br>
        Ollama가 설치된 PC라면 아래 두 가지를 확인해 주세요.
        <ol>
          <li>Ollama가 실행 중인지 (작업 표시줄이나 메뉴 막대의 Ollama 아이콘)</li>
          <li>이 사이트의 접근을 허용했는지: <code>OLLAMA_ORIGINS</code>에 <code>${esc(location.origin)}</code> 등록 후 Ollama 재시작</li>
        </ol>
        <a href="https://github.com/pikidle/Looks-are-everything#다른-pc에서-ai-추천-이유-켜기" target="_blank" rel="noopener">설정 방법 자세히 보기</a>`;
    }
  }

  // CPU에서는 한 번에 하나씩만 생성할 수 있어서, 요청을 줄 세워(chain) 차례로 처리한다.
  // TOP 3는 결과가 뜨자마자, 4위 이하는 펼쳤을 때만 줄에 넣는다.
  function queueAi(index) {
    const ctx = aiRun;
    if (!ctx || !ctx.status || !ctx.status.ok || ctx.queued.has(index)) return;
    ctx.queued.add(index);
    const box = document.querySelector(`#results [data-index="${index}"] .ai-reason`);
    box.hidden = false;
    setAi(box, 'waiting', ctx.queued.size === 1 ? 'AI 모델을 불러오고 있어요' : '차례를 기다리고 있어요');
    ctx.chain = ctx.chain.then(() => explainInto(ctx, box, ctx.top[index]));
  }

  async function explainInto(ctx, box, result) {
    if (ctx.ctrl.signal.aborted) return;
    if (ctx.done > 0) setAi(box, 'waiting', 'AI가 추천 이유를 쓰고 있어요');
    try {
      const out = await LLM.explain(
        { me: ctx.me, candidate: result.candidate, parts: result.parts, isRare },
        {
          signal: ctx.ctrl.signal,
          onToken: text => setAi(box, 'streaming', text),
          onRetry: () => setAi(box, 'waiting', '문장을 한 번 더 다듬고 있어요'),
        },
      );
      if (ctx.ctrl.signal.aborted) return;
      if (out.source === 'llm') setAi(box, 'done', out.text);
      else if (out.source === 'fallback') setAiFacts(box, out.facts);
      else box.hidden = true;
    } catch (err) {
      if (ctx.ctrl.signal.aborted) return;
      setAi(box, 'error', 'AI 설명을 만들지 못했어요. Ollama가 실행 중인지 확인해 주세요.');
    } finally {
      ctx.done++;
    }
  }

  async function runAi(me, top) {
    if (aiRun) aiRun.ctrl.abort();
    const ctx = { me, top, status: null, ctrl: new AbortController(), chain: Promise.resolve(), queued: new Set(), done: 0 };
    aiRun = ctx;

    ctx.status = await LLM.checkAvailable();
    if (ctx.ctrl.signal.aborted) return;
    renderAiStatus(ctx.status);
    for (let i = 0; i < Math.min(C.PODIUM_N, top.length); i++) queueAi(i);
    // 연결 확인 중에 이미 펼쳐 둔 4위 이하가 있으면 이어서 처리한다.
    document.querySelectorAll('#results .rank-row[open]').forEach(row => queueAi(Number(row.dataset.index)));
  }

  // ---------- 화면 전환 + 진행도 게이지 ----------
  const pages = () => [...document.querySelectorAll('.q-page')];
  let current = -1;
  let autoTimer = null;

  function setProgress(done) {
    const pct = (done / STEPS.length) * 100;
    $('#progress-fill').style.width = `${pct}%`;
    $('#progress-label').textContent = `${done} / ${STEPS.length}`;
    $('#progress').setAttribute('aria-valuenow', Math.round(pct));
  }

  function updateNextLabel() {
    const step = STEPS[current];
    const last = current === STEPS.length - 1;
    const input = pages()[current].querySelector('.text-input');
    const empty = step.optional && input && !input.value.trim();
    $('#next').textContent = last ? '결과 보기' : empty ? '건너뛰기' : '다음';
  }

  function show(index, dir) {
    const all = pages();
    if (current >= 0) all[current].hidden = true;
    current = index;
    const page = all[index];
    page.hidden = false;
    page.querySelector('.q-error').hidden = true;
    // 넘기는 방향으로 슬라이드. 클래스를 뗐다 붙여 애니메이션을 다시 재생한다.
    page.classList.remove('enter-next', 'enter-prev');
    void page.offsetWidth;
    page.classList.add(dir < 0 ? 'enter-prev' : 'enter-next');

    if (STEPS[index].onEnter) STEPS[index].onEnter();
    $('#prev').hidden = index === 0;
    updateNextLabel();
    setProgress(index);

    const input = page.querySelector('input[type="number"], input[type="text"]');
    if (input) input.focus({ preventScroll: true });
  }

  function next() {
    clearTimeout(autoTimer);
    const error = STEPS[current].validate(readProfile());
    const box = pages()[current].querySelector('.q-error');
    if (error) {
      box.textContent = error;
      box.hidden = false;
      box.classList.remove('shake');
      void box.offsetWidth;
      box.classList.add('shake');
      return;
    }
    if (current === STEPS.length - 1) finish();
    else show(current + 1, 1);
  }

  function prev() {
    clearTimeout(autoTimer);
    if (current > 0) show(current - 1, -1);
  }

  function start() {
    if (aiRun) aiRun.ctrl.abort();
    $('#intro').hidden = true;
    $('#results').hidden = true;
    $('#logic').hidden = true;
    $('#profile-form').hidden = false;
    $('#progress').hidden = false;
    show(0, 1);
  }

  // 게이지가 100%까지 차는 걸 보여준 뒤 결과로 넘어간다.
  function finish() {
    setProgress(STEPS.length);
    const me = readProfile();
    const rec = recommend(me);
    $('#results').innerHTML = `
      <div class="results-head">
        <h2>${esc(me.name)}님과 잘 맞는 TOP ${Math.min(C.PODIUM_N, rec.top.length) || ''}</h2>
        <button type="button" class="btn ghost" id="restart">답변 수정하기</button>
      </div>
      ${renderResults(me, rec)}
      ${renderMe(me)}`;
    $('#logic').innerHTML = renderLogic(me, rec);

    setTimeout(() => {
      $('#profile-form').hidden = true;
      $('#progress').hidden = true;
      $('#results').hidden = false;
      $('#logic').hidden = false;
      window.scrollTo({ top: 0 });
      countUp($('#results'));
      runAi(me, rec.top);
    }, 650);
  }

  function setupWizard() {
    const form = $('#profile-form');
    $('#start').addEventListener('click', start);
    $('#next').addEventListener('click', next);
    $('#prev').addEventListener('click', prev);
    $('#results').addEventListener('click', e => {
      if (e.target.id === 'restart') start();
      const more = e.target.closest('#more');
      if (more) {
        const rest = $('#rest');
        rest.hidden = !rest.hidden;
        more.textContent = rest.hidden
          ? `${C.PODIUM_N + 1}위 ~ ${C.PODIUM_N + Number(more.dataset.count)}위 더보기 (${more.dataset.count}명)`
          : '접기';
        if (!rest.hidden) rest.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    // <details>의 toggle 이벤트는 버블링되지 않아서 캡처 단계에서 받는다.
    $('#results').addEventListener('toggle', e => {
      if (e.target.matches('.rank-row') && e.target.open) queueAi(Number(e.target.dataset.index));
    }, true);

    form.addEventListener('submit', e => e.preventDefault());
    form.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.matches('input[type="number"], input[type="text"]')) {
        e.preventDefault();
        next();
      }
    });
    // 답을 고치기 시작하면 이전 오류 문구는 지운다.
    const clearError = () => {
      if (current >= 0) pages()[current].querySelector('.q-error').hidden = true;
    };
    form.addEventListener('input', () => {
      clearError();
      if (current >= 0) updateNextLabel();
    });
    form.addEventListener('change', e => {
      clearError();
      if (e.target.name === 'tags') {
        $('#tag-count').textContent = `${form.querySelectorAll('input[name="tags"]:checked').length}개 선택`;
      }
      // 선택형 질문은 고른 게 잠깐 보이도록 살짝 기다렸다가 넘긴다.
      if (e.target.type === 'radio' && STEPS[current].auto) {
        const index = current;
        clearTimeout(autoTimer);
        autoTimer = setTimeout(() => { if (current === index) next(); }, 320);
      }
    });
  }

  // 연애 가치관 순위: 누른 순서대로 번호를 매긴다. 다시 누르면 빠지고 뒤 번호가 하나씩 당겨진다.
  function setupRankPick() {
    const order = [];
    const input = $('#values-input');
    const render = () => {
      document.querySelectorAll('#rank-pick .rank-item').forEach(btn => {
        const n = order.indexOf(btn.dataset.value);
        btn.classList.toggle('picked', n >= 0);
        btn.setAttribute('aria-pressed', String(n >= 0));
        btn.querySelector('.rank-no').textContent = n >= 0 ? n + 1 : '';
      });
      input.value = order.join(',');
      input.dispatchEvent(new Event('input', { bubbles: true })); // 오류 문구를 지우고 버튼 문구를 갱신
    };
    $('#rank-pick').addEventListener('click', e => {
      const btn = e.target.closest('.rank-item');
      if (!btn) return;
      const i = order.indexOf(btn.dataset.value);
      if (i >= 0) order.splice(i, 1);
      else order.push(btn.dataset.value);
      render();
      // 다 고르면 마지막 번호가 보이도록 잠깐 기다렸다가 넘긴다.
      if (order.length === C.VALUES.length) {
        const index = current;
        clearTimeout(autoTimer);
        autoTimer = setTimeout(() => { if (current === index) next(); }, 450);
      }
    });
    $('#rank-reset').addEventListener('click', () => {
      order.length = 0;
      render();
    });
  }

  buildWizard();
  setupPhoto();
  setupRankPick();
  setupWizard();
})();
