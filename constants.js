// 앱 전체에서 쓰는 선택지와 점수 배점.
// 배점을 바꾸고 싶으면 WEIGHTS만 고치면 화면의 로직 설명까지 함께 바뀐다.
window.MATCH_CONFIG = {
  REGIONS: [
    '서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종',
    '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주',
  ],

  TAGS: [
    '여행', '카페', '맛집', '영화', '드라마', '음악', '공연', '전시', '독서', '게임',
    '운동', '등산', '요리', '사진', '반려동물', '패션', '캠핑', '쇼핑', '애니메이션', '자기계발',
  ],

  // options는 순서가 있는 척도다. 인덱스 차이로 "몇 칸 차이"를 계산한다.
  LIFESTYLE: [
    { key: 'smoking', label: '흡연', question: '담배는 피우세요?', options: ['안 함', '가끔', '함'] },
    { key: 'drinking', label: '음주', question: '술은 얼마나 드세요?', options: ['안 함', '가끔', '자주'] },
    { key: 'chronotype', label: '생활 리듬', question: '아침형인가요, 저녁형인가요?', options: ['아침형', '중간', '저녁형'] },
    { key: 'weekend', label: '주말', question: '주말엔 주로 어떻게 보내세요?', options: ['집에 있는 편', '반반', '밖에 나가는 편'] },
    { key: 'exercise', label: '운동', question: '운동은 얼마나 하세요?', options: ['거의 안 함', '주 1~2회', '주 3회 이상'] },
  ],

  MBTI_TYPES: [
    'ISTJ', 'ISFJ', 'INFJ', 'INTJ', 'ISTP', 'ISFP', 'INFP', 'INTP',
    'ESTP', 'ESFP', 'ENFP', 'ENTP', 'ESTJ', 'ESFJ', 'ENFJ', 'ENTJ',
  ],

  // 연애에서 중요하게 여기는 순서를 고르는 항목
  VALUES: ['키', '외모', '성격', '자산', '학력'],

  // 외모 자기평가(1~10점) 구간. label은 화면 표시용, name은 점수 근거에 쓰는 이름.
  LOOKS_TIERS: [
    { max: 3, label: '아쉬운 편', name: '못생김' },
    { max: 7, label: '보통', name: '보통' },
    { max: 10, label: '잘생기고 예쁜 편', name: '잘생김·예쁨' },
  ],

  TOP_N: 10,    // 추천 인원
  PODIUM_N: 3,  // 그중 크게 보여줄 상위 인원 (나머지는 '더보기')

  WEIGHTS: {
    lifestyleByDiff: [8, 4, 0],    // 문항당 점수: 같음 / 한 칸 차이 / 두 칸 차이 (5문항, 최대 40)
    interests: 30,                 // 희귀도 가중 다이스 계수 × 30
    values: 15,                    // 가치관 순위가 비슷한 정도 × 15
    region: 5,                     // 같은 시·도면 만점
    looks: 5,                      // 외모 자기평가가 같은 구간이면 만점
    mbti: { EI: 2, NS: 2, TF: 1 }, // E/I 다름, N/S 같음, T/F 같음
  },
};
