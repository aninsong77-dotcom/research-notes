# 참고문헌 파서 — 알려진 미해결 항목

> Phase A(테스트 작성) 중 발견. 그 자리에서 고치지 않고 여기 기록 + `refparser.test.js`에
> `test.skip`으로 재현 케이스만 남겨둠(규정.md §G 원칙: "못 하거나 안 한 건 조용히 넘어가지 않는다").
> 고칠 때는 skip을 해제해서 통과하는지로 확인하면 됨.

## #1. 기관 저자 미지원
- `refparser.js:35` 국문 저자 판별이 `[가-힣]{2,5}`로 5자 제한 → "한국교육개발원"(7자) 같은
  기관명이 자동 조립 안 됨(confidence 'low'로 빠짐). 영문도 마찬가지("The Regulation Body").
- 재현: `refparser.test.js`의 "기관 저자(영문)"(통과, 현재 동작 확인용) /
  "기관 저자(국문, 5자 초과)"(skip)
- 고칠 방향: `…부|처|청|원|회|단|재단|협회|공단|위원회` 류 패턴을 별도 분기로 추가,
  `authorType:'org'`로 구분(길이만 늘리면 사람 이름 오인식 증가하므로 지양).

## #2. 영문 박사학위논문 degree 오판정 + source 깨짐
- `refparser.js:74` `out.degree = /박사/.test(rest) ? '박사학위논문' : '석사학위논문'` 가
  국문 "박사"만 검사 → 영문 "Doctoral dissertation"은 항상 석사로 잘못 표시됨.
- 같은 줄 근처 source 정리 로직도 "dissertation"만 지우고 "Doctoral"·쉼표가 남아
  `"Doctoral , Harvard University"`처럼 깨짐.
- 재현: `refparser.test.js` "영문 박사학위논문…"(skip)
- 고칠 방향: `/박사|doctoral|ph\.?d/i` 로 국문·영문 둘 다 검사. source 정리 정규식에
  `doctoral|master'?s?`도 같이 제거 대상에 포함.

## #3. 영문 단행본 출판사명 Title Case 미적용
- `refassembler.js:151~156` book 분기가 학술지 분기(140줄)와 달리 `titleCaseSource()`를
  안 거침 → 원문이 소문자 출판사명이면 그대로 나감. 규정.md §D "출판사는 각 단어 첫 글자
  대문자" 위반.
- 재현: `refparser.test.js` "영문 단행본 — 출판사명이 Title Case로…"(skip)
- 고칠 방향: `const sourceOut = e.lang === 'en' ? titleCaseSource(e.source) : e.source;`
  로 바꾸고 `escHtml(sourceOut)` 사용. (코드점검-20260820 결과 ⑦번과 동일 항목)

---

## 이번 Phase A에서 "확인했지만 문제없음"으로 결론난 것
- 학위논문 판별의 줄바꿈 공백 허용(`\s*논\s*문`) — 8/18에 겪은 것과 같은 부류 사례로
  실제 테스트해본 결과 이미 정상 동작함(회귀 방지용 테스트로 고정해둠).
- 저자 3인 이상(국문·영문) 쉼표+& 조합 — 정상.
- `joinAuthors`의 `', & &'` 겹침 버그(과거 사고) — 회귀 없음 확인.
- 재인용 표기·연도 없음·빈 문자열 — 전부 안전하게 low/원문유지로 처리됨, 크래시 없음.
