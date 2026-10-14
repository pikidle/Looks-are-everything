// 가상 후보 100명.
// 시드를 고정한 난수로 만들기 때문에 새로고침해도 항상 같은 후보가 나온다.
(function () {
  const C = window.MATCH_CONFIG;

  function mulberry32(seed) {
    return function () {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const rand = mulberry32(20261014);
  const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
  const pick = arr => arr[Math.floor(rand() * arr.length)];
  const chance = p => rand() < p;

  // pairs: [[값, 비중], ...]
  function weighted(pairs) {
    const total = pairs.reduce((sum, [, w]) => sum + w, 0);
    let r = rand() * total;
    for (const [value, w] of pairs) {
      r -= w;
      if (r < 0) return value;
    }
    return pairs[pairs.length - 1][0];
  }

  // 비중에 따라 중복 없이 n개 뽑기
  function weightedSample(pairs, n) {
    const pool = pairs.slice();
    const out = [];
    while (out.length < n && pool.length) {
      const value = weighted(pool);
      out.push(value);
      pool.splice(pool.findIndex(([v]) => v === value), 1);
    }
    return out;
  }

  // 실제 앱처럼 태그마다 인기도가 다르게 분포하도록 한다. (희귀 태그 가중치가 의미를 갖게)
  const TAG_POPULARITY = {
    여행: 10, 카페: 10, 맛집: 10, 영화: 8, 음악: 8, 드라마: 6, 운동: 6, 게임: 5,
    공연: 4, 전시: 4, 독서: 4, 반려동물: 4, 쇼핑: 4, 요리: 3, 사진: 3, 패션: 3,
    자기계발: 3, 등산: 2, 캠핑: 2, 애니메이션: 1.5,
  };
  const tagPairs = C.TAGS.map(t => [t, TAG_POPULARITY[t] || 3]);

  const regionPairs = C.REGIONS.map(r => [r, { 서울: 30, 경기: 22, 인천: 8 }[r] || 2.5]);

  const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍'];
  const GIVEN = {
    male: ['민준', '서준', '도윤', '예준', '시우', '하준', '지호', '주원', '지훈', '건우', '우진', '현우', '선우', '유준', '정우', '승현', '태윤', '준혁', '도현', '재원'],
    female: ['서연', '서윤', '지우', '하은', '민서', '하윤', '윤서', '지민', '채원', '수아', '지아', '예은', '다은', '유나', '소율', '예린', '수빈', '지원', '나연', '하린'],
  };

  const INTROS = [
    '평일엔 열심히 일하고 주말엔 맛있는 거 찾아다녀요.',
    '조용한 카페에서 책 읽는 시간이 제일 좋아요.',
    '한 번 웃기 시작하면 잘 안 멈춰요.',
    '요즘 러닝에 빠져서 매일 5km씩 뛰고 있어요.',
    '강아지 두 마리랑 살고 있어요. 산책 메이트 구해요.',
    '새로운 곳 가보는 걸 좋아해서 연차는 거의 여행에 써요.',
    '요리하는 걸 좋아해요. 파스타는 자신 있어요.',
    '말수는 적은 편인데 친해지면 수다쟁이가 돼요.',
    '전시회나 공연 보러 다니는 게 취미예요.',
    '퇴근 후 게임 한 판이 소확행이에요.',
    '캠핑 장비 모으는 게 취미가 됐어요.',
    '사진 찍는 걸 좋아해서 어딜 가든 카메라를 챙겨요.',
    '계획 세우는 걸 좋아하는 편이에요.',
    '즉흥 여행을 좋아해요. 금요일 밤에 떠나기도 해요.',
  ];
  const IDEALS = [
    '대화가 잘 통하는 사람이면 좋겠어요.',
    '웃음 코드가 맞는 사람이요.',
    '서로의 시간을 존중해 줄 수 있는 사람.',
    '같이 맛집 탐방할 수 있는 사람이면 좋겠어요.',
    '배려심 깊고 따뜻한 사람이요.',
    '자기 일에 열정이 있는 사람이 멋있어요.',
    '편하게 연락할 수 있는 사람.',
    '주말에 같이 산책할 수 있는 사람이요.',
    '솔직하게 이야기할 수 있는 사람이면 좋겠어요.',
    '취미를 함께 공유할 수 있는 사람.',
  ];

  const usedNames = new Set();
  function uniqueName(gender) {
    for (;;) {
      const name = pick(SURNAMES) + pick(GIVEN[gender]);
      if (!usedNames.has(name)) {
        usedNames.add(name);
        return name;
      }
    }
  }

  const list = [];
  for (let i = 0; i < 100; i++) {
    const gender = i % 2 === 0 ? 'male' : 'female';
    const opposite = gender === 'male' ? 'female' : 'male';
    const age = int(22, 38);

    list.push({
      id: i + 1,
      name: uniqueName(gender),
      gender,
      wantGender: weighted([[opposite, 85], [gender, 8], ['any', 7]]),
      age,
      wantAge: [Math.max(19, age - int(2, 6)), age + int(2, 6)],
      region: weighted(regionPairs),
      regionPref: chance(0.3) ? 'same' : 'any',
      lifestyle: {
        smoking: weighted([[0, 70], [1, 15], [2, 15]]),
        drinking: int(0, 2),
        chronotype: int(0, 2),
        weekend: int(0, 2),
        exercise: int(0, 2),
      },
      tags: weightedSample(tagPairs, int(2, 6)),
      mbti: chance(0.8) ? pick(C.MBTI_TYPES) : null,
      photo: null, // 사진 URL 또는 경로 (예: 'photos/1.jpg'). 없으면 이름 아바타로 표시
      intro: chance(0.7) ? pick(INTROS) : '',
      ideal: chance(0.6) ? pick(IDEALS) : '',
    });
  }

  window.CANDIDATES = list;
})();
