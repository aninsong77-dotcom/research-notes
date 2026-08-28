# 참고문헌 파서 — 알려진 미해결 항목

> Phase A(테스트 작성) 중 발견한 3건은 **2026-08-28에 전부 수리 완료**.
> `refparser.test.js` 34개 전부 통과(skip 0개). 아래는 수리 기록으로 남겨둠.

## #1. 기관 저자 미지원 → ✅ 수리 완료
- `refparser.js` 국문 저자 판별이 `[가-힣]{2,5}`(사람 이름 상한)만 있어 "한국교육개발원"(7자)
  같은 기관명이 low로 빠지던 문제.
- 수리: `isPerson`(기존 5자 상한 그대로 유지)과 별개로 `isOrg` 판별을 추가
  (`…부|처|청|원|회|단|재단|협회|공단|위원회|연구소|본부` 접미사, 2~20자).
  사람 이름 판별은 안 건드려서 회귀 없음.
- 확인: 단독 기관("한국교육개발원")·공동 기관("여성가족부, 보건복지부") 둘 다 정상.
- 미포함(의도적으로 범위 밖): 영문 기관 저자("American Psychological Association" 류)는
  이번에 안 건드림 — 영문은 쉼표+이니셜 구조 자체가 없어 판별 방식이 달라야 하고,
  원래 발견 사례도 국문 위주였음.

## #2. 영문 박사학위논문 degree 오판정 + source 깨짐 → ✅ 수리 완료
- `refparser.js` degree 판정이 국문 "박사"만 검사해 영문 "Doctoral dissertation"이 항상
  석사로 잘못 표시되고, source 정리도 "dissertation"만 지워 "Doctoral , Harvard University"
  처럼 깨지던 문제.
- 수리: 판정 정규식에 `doctoral|ph\.?\s*d\.?` 추가. source 정리에 영문 학위 단어
  (`doctoral|master'?s?|thesis|dissertation|ph\.?\s*d\.?`) 제거 + 빈 쉼표 정리 단계 추가.
- 확인: "Doctoral dissertation" → 박사학위논문/"Harvard University", "Master's thesis" →
  석사학위논문/"Yonsei University" 둘 다 정상.

## #3. 영문 단행본 출판사명 Title Case 미적용 → ✅ 수리 완료
- `refassembler.js` book 분기가 학술지 분기와 달리 `titleCaseSource()`를 안 거쳐서 소문자
  출판사명이 그대로 나가던 문제(규정.md §D 위반).
- 수리: book 분기에도 `e.lang === 'en'`일 때 `titleCaseSource(e.source)` 적용. 국문은
  그대로(변경 안 함).
- 확인: "the guilford press" → "The Guilford Press", 국문 "학지사"는 원문 그대로 유지 확인.

---

## 절차 참고 (다음에 비슷한 걸 고칠 때)
- 정규식 하나 고칠 때마다 `node 테스트실행.js`로 **전체** 재확인 후 다음으로 진행(회귀 방지).
- 세 건 다 수리 후 34개 테스트 전부 통과, skip 0. 새로 발견되는 항목은 이 문서 형식대로
  추가하고, 원인·재현 테스트·확인 근거를 남길 것.
