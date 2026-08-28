// ── 참고문헌 파서·조립기 회귀 테스트 ──────────────────────────
// 실행: node --test refparser.test.js
// 대상: refparser.js(글자→칸 분해) · refassembler.js(칸→문장 조립)
//
// 이 테스트는 "규정대로 완벽히 동작하는지"가 아니라 "지금 동작을 고정해서,
// 앞으로 고칠 때 실수로 망가뜨리면 바로 알아챌 수 있게" 하는 안전망이다.
// 알려진 미완성 항목(known-issues.md)은 test.skip 으로 표시하고 이유를 남긴다 —
// 조용히 빠뜨리지 않는다는 이 프로젝트의 원칙(규정.md §G)을 테스트에도 적용.

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRefEntry } = require('./refparser.js');
const {
    assembleRef, STYLE_KAPP, STYLE_APA,
    joinAuthors, sentenceCaseTitle, titleCaseSource,
} = require('./refassembler.js');

// ══════════════════════════════════════════════════════════
// parseRefEntry — 정상 케이스 (규정.md 예시 문장 기반)
// ══════════════════════════════════════════════════════════

test('국문 학술지 — 규정.md [학회]⑤ 예시', () => {
    const e = parseRefEntry(
        '이진희, 윤호균 (2001). 통찰명상 중의 경험내용에 대한 질적 분석: 알아차림을 중심으로. ' +
        '한국심리학회지: 상담 및 심리치료, 13(2), 105-120.');
    assert.equal(e.itemType, 'journal');
    assert.equal(e.confidence, 'high');
    assert.deepEqual(e.authors, ['이진희', '윤호균']);
    assert.equal(e.year, '2001');
    assert.equal(e.title, '통찰명상 중의 경험내용에 대한 질적 분석: 알아차림을 중심으로');
    assert.equal(e.source, '한국심리학회지: 상담 및 심리치료');
    assert.equal(e.volume, '13');
    assert.equal(e.issue, '2');
    assert.equal(e.pages, '105-120');
});

test('영문 학술지 — 규정.md [학회]⑤ 예시(3인 저자, &)', () => {
    const e = parseRefEntry(
        'Hackett, G., Bets, N. E., & Romac, D. S. (1990). Effects of verbal and mathematics ' +
        'task performance on task and career self-efficacy and interest. ' +
        'Journal of Counseling Psychology, 37(2), 169-177.');
    assert.equal(e.itemType, 'journal');
    assert.equal(e.lang, 'en');
    assert.deepEqual(e.authors, ['Hackett, G.', 'Bets, N. E.', 'Romac, D. S.']);
    assert.equal(e.source, 'Journal of Counseling Psychology');
    assert.equal(e.pages, '169-177');
});

test('국문 단행본 — 규정.md [학회]③ 예시(발행지 없음)', () => {
    const e = parseRefEntry('조성호 (2000). 경계선 성격장애. 학지사.');
    assert.equal(e.itemType, 'book');
    assert.equal(e.confidence, 'high');
    assert.equal(e.title, '경계선 성격장애');
    assert.equal(e.source, '학지사');
});

test('영문 단행본 — 규정.md [학회]④ 예시(발행지 없음)', () => {
    const e = parseRefEntry('Kline, R. B. (1998). Principles and practice of structural equation modeling. The Guilford Press.');
    assert.equal(e.itemType, 'book');
    assert.equal(e.source, 'The Guilford Press');
});

test('국문 학위논문(석사) — 규정.md [학회]⑥ 예시', () => {
    const e = parseRefEntry(
        '황선정 (1998). 수식관 명상이 중학생의 충동성, 불안, 주의집중에 미치는 효과. ' +
        '가톨릭대학교 일반대학원 석사학위논문.');
    assert.equal(e.itemType, 'thesis');
    assert.equal(e.degree, '석사학위논문');
    assert.equal(e.source, '가톨릭대학교 일반대학원');
});

test('국문 학위논문(박사) — 박사/석사 구분', () => {
    const e = parseRefEntry('박철수 (2021). 박사 학위 표기 확인. 고려대학교 대학원 박사학위논문.');
    assert.equal(e.itemType, 'thesis');
    assert.equal(e.degree, '박사학위논문');
});

test('학위논문 — PDF 줄바꿈으로 "논"·"문" 사이에 공백 낀 경우 (2026-08-18 실제 버그 회귀 방지)', () => {
    // 8/18 세션에서 "학위논/문"처럼 PDF 추출 시 줄바꿈이 글자 사이에 끼어 판별 실패했던 것과
    // 같은 부류. refparser.js의 THESIS 정규식은 \s* 로 공백을 이미 허용하므로 정상 처리돼야 한다.
    const e = parseRefEntry('김영희 (2019). 줄바꿈 예시. 서울대학교 대학원 석사학위논\n문.');
    assert.equal(e.itemType, 'thesis');
    assert.equal(e.degree, '석사학위논문');
    assert.equal(e.source, '서울대학교 대학원');
});

test('저자 4인 이상 — 국문 학술지', () => {
    const e = parseRefEntry('이수진, 박민아, 김지현, 최윤서 (2015). 네 명 이상 저자 국문. 상담학연구, 16(3), 45-60.');
    assert.equal(e.confidence, 'high');
    assert.deepEqual(e.authors, ['이수진', '박민아', '김지현', '최윤서']);
});

test('저자 4인 이상 — 영문 학술지(쉼표+& 혼합)', () => {
    const e = parseRefEntry('Kim, S., Lee, J., Park, M., & Choi, H. (2015). Four authors example. Counseling Studies, 16(3), 45-60.');
    assert.equal(e.confidence, 'high');
    assert.deepEqual(e.authors, ['Kim, S.', 'Lee, J.', 'Park, M.', 'Choi, H.']);
});

test('DOI 포함 학술지 — doi: 표기 분리', () => {
    const e = parseRefEntry('김도윤 (2019). DOI 포함 예시 연구. 상담학연구, 20(1), 1-15. doi:10.1234/abcd.2019.01');
    assert.equal(e.doi, '10.1234/abcd.2019.01');
    assert.equal(e.itemType, 'journal');
    assert.equal(e.pages, '1-15');
});

// ══════════════════════════════════════════════════════════
// parseRefEntry — 비정상·경계 케이스 ("손 안 댐" 원칙 확인)
// 판별에 자신 없으면 confidence:'low'로 원문을 그대로 두는 게 설계 의도.
// ══════════════════════════════════════════════════════════

test('빈 문자열 — 예외 없이 low 반환', () => {
    const e = parseRefEntry('');
    assert.equal(e.confidence, 'low');
    assert.equal(e.authors, null);
});

test('연도 괄호가 아예 없음 — low 반환, 크래시 없음', () => {
    const e = parseRefEntry('저자만 있고 연도 표기가 없는 이상한 문장입니다');
    assert.equal(e.confidence, 'low');
    assert.equal(e.year, '');
});

test('재인용 표기(연도 뒤에 콤마+재인용 문구) — 연도 패턴이 안 맞아 low', () => {
    // 규정.md §E: "이복동(1970, 권양희, 1998에서 재인용)" 형태. 괄호 안이 단순 "(dddd)"가
    // 아니라서 연도 정규식이 아예 안 걸린다 — 잘못 조립하지 않고 원문을 지키는 게 맞는 동작.
    const e = parseRefEntry('이복동 (2010, 권양희, 1998에서 재인용). 재인용 예시.');
    assert.equal(e.confidence, 'low');
    assert.equal(e.year, '');
});

test('기관 저자(영문) — 현재는 저자로 인식 못 함 (알려진 한계, known-issues.md #1)', () => {
    const e = parseRefEntry('The Regulation Body (2020). 기관 저자 예시 연구. 정책연구, 3(1), 1-20.');
    assert.equal(e.authors, null);       // ⚠️ 앞으로 기관 저자 지원 추가 시 이 값이 바뀌어야 함
    assert.equal(e.confidence, 'low');
});

test('기관 저자(국문, 5자 초과) — 정상 인식 (2026-08-28 수리, known-issues.md #1)', () => {
    const e = parseRefEntry('한국교육개발원 (2020). 기관 저자 예시 연구. 정책연구, 3(1), 1-20.');
    assert.equal(e.confidence, 'high');
    assert.deepEqual(e.authors, ['한국교육개발원']);
});

test('공동 기관 저자(국문 2곳) — 정상 인식', () => {
    const e = parseRefEntry('여성가족부, 보건복지부 (2019). 공동 기관 저자 예시. 정책연구, 4(2), 10-25.');
    assert.deepEqual(e.authors, ['여성가족부', '보건복지부']);
});

test('사람 이름(5자 이하) — 기관 판별 추가 후에도 회귀 없이 정상 처리', () => {
    const e = parseRefEntry('홍길동 (2020). 회귀 확인용. 상담학연구, 1(1), 1-5.');
    assert.deepEqual(e.authors, ['홍길동']);
    assert.equal(e.confidence, 'high');
});

test('영문 박사학위논문("Doctoral dissertation") — degree·source 정상 인식 (2026-08-28 수리, known-issues.md #2)', () => {
    const e = parseRefEntry('Smith, J. (2015). Examining resilience in adolescents. Doctoral dissertation, Harvard University.');
    assert.equal(e.degree, '박사학위논문');
    assert.equal(e.source, 'Harvard University');
});

test('영문 석사학위논문("Master\'s thesis") — degree 정상 인식', () => {
    const e = parseRefEntry("Lee, K. (2012). A study on adolescent anxiety. Master's thesis, Yonsei University.");
    assert.equal(e.degree, '석사학위논문');
    assert.equal(e.source, 'Yonsei University');
});

// ══════════════════════════════════════════════════════════
// assembleRef — 스타일별 조립 (KAPP=한국상담심리학회 / APA=APA7)
// ══════════════════════════════════════════════════════════

test('학술지 — KAPP 스타일은 쪽 구분을 하이픈으로 유지 (규정.md §F-2)', () => {
    const e = parseRefEntry('이진희, 윤호균 (2001). 알아차림 연구. 한국심리학회지: 상담 및 심리치료, 13(2), 105-120.');
    const a = assembleRef(e, STYLE_KAPP);
    assert.match(a.text, /105-120/);
    assert.doesNotMatch(a.text, /105–120/);   // 엔대시로 바뀌면 안 됨
});

test('학술지 — APA 스타일은 쪽 구분을 엔대시로 변환', () => {
    const e = parseRefEntry('Hackett, G. (1990). Title. Journal of X, 37(2), 169-177.');
    const a = assembleRef(e, STYLE_APA);
    assert.match(a.text, /169–177/);
});

test('국문 단행본 — KAPP 스타일 강조는 맑은 고딕 (기울임 아님, 규정.md §B)', () => {
    const e = parseRefEntry('조성호 (2000). 경계선 성격장애. 학지사.');
    const a = assembleRef(e, STYLE_KAPP);
    assert.match(a.html, /class="ref-emph" style="font-family:'맑은 고딕'"/);
    assert.doesNotMatch(a.html, /font-style:italic/);
});

test('영문 단행본 — 어느 스타일이든 강조는 이탤릭', () => {
    const e = parseRefEntry('Kline, R. B. (1998). Principles. The Guilford Press.');
    const a = assembleRef(e, STYLE_KAPP);
    assert.match(a.html, /font-style:italic/);
});

test('영문 단행본 — 출판사명 Title Case 적용 (2026-08-28 수리, known-issues.md #3)', () => {
    const e = parseRefEntry('Kline, R. B. (1998). Principles. the guilford press.');
    const a = assembleRef(e, STYLE_KAPP);
    assert.match(a.text, /The Guilford Press/);
});

test('국문 단행본 — 출판사명은 원문 그대로(Title Case 적용 안 됨)', () => {
    const e = parseRefEntry('조성호 (2000). 경계선 성격장애. 학지사.');
    const a = assembleRef(e, STYLE_KAPP);
    assert.match(a.text, /학지사\.$/);
});

test('국문 학위논문 — KAPP 스타일은 대괄호 없이 "대학 학위" 형태 (규정.md §C-3)', () => {
    const e = parseRefEntry('황선정 (1998). 수식관 명상 효과. 가톨릭대학교 일반대학원 석사학위논문.');
    const a = assembleRef(e, STYLE_KAPP);
    assert.match(a.text, /가톨릭대학교 일반대학원 석사학위논문\.$/);
    assert.doesNotMatch(a.text, /\[/);   // 대괄호 없어야 함
});

test('국문 학위논문 — APA 스타일은 대괄호 사용 (학회와 다름)', () => {
    const e = parseRefEntry('황선정 (1998). 수식관 명상 효과. 가톨릭대학교 일반대학원 석사학위논문.');
    const a = assembleRef(e, STYLE_APA);
    assert.match(a.text, /\[석사학위논문, 가톨릭대학교 일반대학원\]\.$/);
});

// ══════════════════════════════════════════════════════════
// 조립기 헬퍼 함수 단위 테스트
// ══════════════════════════════════════════════════════════

test('joinAuthors — 국문 2인은 쉼표로만 연결', () => {
    assert.equal(joinAuthors(['홍길동', '김철수'], 'ko', STYLE_KAPP), '홍길동, 김철수');
});

test('joinAuthors — 영문 2인은 &로 연결', () => {
    assert.equal(joinAuthors(['Kim, S.', 'Lee, J.'], 'en', STYLE_APA), 'Kim, S. & Lee, J.');
});

test('joinAuthors — 영문 3인 이상은 쉼표 나열 + ", & " (겹침 버그 없음 확인)', () => {
    // refassembler.js:77~78 주석에 있는 ', & '.replace(', ',' & ') 겹침 버그의 회귀 방지.
    const out = joinAuthors(['Kim, S.', 'Lee, J.', 'Park, M.'], 'en', STYLE_APA);
    assert.equal(out, 'Kim, S., Lee, J., & Park, M.');
    assert.doesNotMatch(out, /& &/);
});

test('sentenceCaseTitle — 콜론 뒤 첫 글자만 다시 대문자', () => {
    assert.equal(
        sentenceCaseTitle('effects of mindfulness: a meta-analysis of studies'),
        'Effects of mindfulness: A meta-analysis of studies');
});

test('sentenceCaseTitle — 고유명사는 문장 중간이어도 대문자 유지', () => {
    assert.equal(sentenceCaseTitle('a study of korean adolescents in seoul'), 'A study of Korean adolescents in Seoul');
});

test('titleCaseSource — 관사·전치사는 소문자, 나머지는 대문자', () => {
    assert.equal(
        titleCaseSource('journal of counseling and the psychology of adolescence'),
        'Journal of Counseling and the Psychology of Adolescence');
});

test('assembleRef — confidence가 low인 항목은 호출부에서 걸러야 함(계약 확인용 메모)', () => {
    // assembleRef 자체는 confidence를 안 보므로, 이 테스트는 "low인 항목을 실수로 조립기에
    // 넘기면 안 된다"는 계약을 문서화하는 용도다. 실제 가드는 화면 쪽(app.js)에 있다.
    const e = parseRefEntry('저자불명 (2020). 이상한 원문.');
    assert.equal(e.confidence, 'low');
});
