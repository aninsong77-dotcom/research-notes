// ── 참고문헌 파서 · 조립기 ──────────────────────────────────
// 설계: docsPlan/참고문헌-파서/설계.md · 규정: docsPlan/참고문헌-파서/규정.md
//
// 파서(parseRefEntry)는 규정을 전혀 모른다 — 글자를 칸으로 나누기만 한다.
// 조립기(assembleRef)는 규정표(STYLE_*)를 보고 칸을 문장으로 다시 만든다.
// 규정이 바뀌면 표만 바꾼다. 판별에 자신 없는 항목(confidence:'low')은
// 절대 조립하지 않고 원문 그대로 둔다 — "손 안 댐"이 실패가 아니라 기능이다.

// ── ① 파서 ──────────────────────────────────────────────

function _clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

// 저자 블록이 "성, 이니셜." 나열로 깔끔한지 판별해 배열로 쪼갠다.
// 흐트러진 형태(Slaney, Robert B and Ashby...)는 원문을 그대로 둔다.
function _parseAuthors(block, lang) {
    // ⚠️ 영문은 끝 마침표가 마지막 이니셜의 일부다("R. B.") — 떼어내면
    //    형태 검사가 항상 실패한다(실제로 이 때문에 4/7 이 틀어졌다). 콤마만 뗀다.
    const raw = _clean(block).replace(/,\s*$/, '');
    if (!raw) return { authors: null, authorsRaw: '', ok: false };

    if (lang === 'en') {
        // "Smith, J. R., & Lee, K." 형태 — 쉼표+이니셜로 저자를 나눈다
        const CLEAN = /^[A-Z][A-Za-z’'-]+,\s*(?:[A-Z]\.\s*)+(?:,\s*(?:&\s*)?[A-Z][A-Za-z’'-]+,\s*(?:[A-Z]\.\s*)+)*$/;
        // "K., & Lehman" 처럼 & 앞에 쉼표가 이미 있으면 그것까지 같이 지워야 한다
        // (안 그러면 ", ," 로 겹쳐 형태 검사가 깨진다 — 실제로 이 때문에 3건이 틀어졌다).
        const normalized = raw.replace(/,?\s*&\s*/g, ', ').replace(/\.?\s*$/, '. ');
        if (CLEAN.test(normalized)) {
            const authors = normalized.split(/,\s*(?=[A-Z][A-Za-z’'-]+,)/).map(_clean);
            return { authors, authorsRaw: raw, ok: true };
        }
        return { authors: null, authorsRaw: raw, ok: false };
    }
    // 국문 — "홍길동, 김철수" 콤마 나열 (끝 마침표는 있어도 무방하니 마저 뗀다)
    const parts = raw.replace(/\.$/, '').split(/[,，]/).map(_clean).filter(Boolean);
    const isPerson = p => /^[가-힣]{2,5}(\([가-힣]+\))?$/.test(p);
    // 기관 저자(known-issues.md #1) — "한국교육개발원"(7자) 같은 상담·교육심리 분야에
    // 흔한 기관명은 사람 이름 상한(5자)을 넘어가서 여태 확인 필요로 빠졌다. 사람 이름
    // 판별(5자 상한)은 안 건드리고, 흔한 기관명 접미사를 별도 조건으로 추가한다.
    const isOrg = p => /^[가-힣]{2,20}(부|처|청|원|회|단|재단|협회|공단|위원회|연구소|본부)$/.test(p);
    const allKo = parts.every(p => isPerson(p) || isOrg(p));
    if (allKo && parts.length >= 1) return { authors: parts, authorsRaw: raw, ok: true };
    return { authors: null, authorsRaw: raw, ok: false };
}

// 문헌 한 줄 → 칸으로 분해. 실패하거나 자신 없으면 confidence:'low'.
function parseRefEntry(text) {
    const raw = _clean(text);
    const out = { itemType: 'unknown', lang: 'ko', authors: null, authorsRaw: '',
        year: '', yearSuffix: '', title: '', source: '', volume: '', issue: '',
        pages: '', degree: '', doi: '', url: '', confidence: 'low', raw };
    if (!raw) return out;

    const ym = raw.match(/^(.*?)\(\s*(\d{4})([a-z])?\s*\)\.?\s*(.*)$/);
    if (!ym) return out;   // 연도 괄호를 못 찾으면 애초에 참고문헌이 아닐 수 있다

    const authorBlock = ym[1];
    out.year = ym[2];
    out.yearSuffix = ym[3] || '';
    let rest = _clean(ym[4]);
    out.lang = /[가-힣]/.test(authorBlock) ? 'ko' : 'en';

    const a = _parseAuthors(authorBlock, out.lang);
    out.authors = a.authors;
    out.authorsRaw = a.authorsRaw;

    // 제목 = 다음 마침표까지. 마침표가 없으면(원문 오류 가능성) 낮은 신뢰도로 남긴다.
    const dot = rest.search(/\.\s/);
    if (dot < 0) { out.title = rest; return out; }   // confidence 'low' 유지
    out.title = rest.slice(0, dot);
    rest = _clean(rest.slice(dot + 1));

    // ── 유형 판별 ──
    const THESIS = /(석사|박사)\s*학위\s*논\s*문|thesis|dissertation/i;
    const DOI = rest.match(/\b(?:doi\s*:\s*|https?:\/\/(?:dx\.)?doi\.org\/)\s*(10\.\d{4,9}\/\S+?)\.?\s*$/i);
    if (DOI) { out.doi = DOI[1]; rest = _clean(rest.slice(0, DOI.index)); }

    if (THESIS.test(rest)) {
        out.itemType = 'thesis';
        // ⚠️ 국문 "박사"만 검사하면 영문 "Doctoral dissertation"이 항상 석사로 잘못 잡힌다
        // (known-issues.md #2) — 영문 박사 표기(doctoral·Ph.D.)도 같이 본다.
        out.degree = /박사|doctoral|ph\.?\s*d\.?/i.test(rest) ? '박사학위논문' : '석사학위논문';
        // 학위 표기는 "○○대학교 대학원 석사학위논문"(뒤)·"석사학위논문, ○○대학교"(앞)
        // 둘 다 나온다 — 끝(`$`)에만 있다고 가정하면 앞에 오는 경우를 못 걷어내
        // 소속기관 칸에 학위 표기가 그대로 남고, 조립기가 학위 표기를 또 붙여
        // "…한동대학교. 석사학위논문."처럼 중복되는 사고가 있었다. 위치 무관하게 지운다.
        // 영문 학위 단어(Doctoral·dissertation·Master's·thesis)도 같이 지운다 — 하나만 지우면
        // "Doctoral , Harvard University"처럼 남은 단어와 쉼표가 깨진 채로 남았다(known-issues.md #2).
        out.source = _clean(rest.replace(/(석사|박사)?\s*학위\s*논\s*문/i, '')
            .replace(/doctoral|master'?s?|thesis|dissertation|ph\.?\s*d\.?/gi, '')
            .replace(/\s*,\s*(?=,|$)/g, '')      // 단어가 빠지고 남은 빈 쉼표(", ,"·끝 쉼표) 정리
            .replace(/^[,\s]+|[,\s]+$/g, '')
            .replace(/\.$/, ''));
        out.confidence = out.authors ? 'high' : 'low';
        return out;
    }

    // 학술지 — "학술지명, 권(호), 쪽-쪽." 뒤에서부터 찾는다 (호·쉼표 누락 허용)
    const JR = /([^.,;()]{2,60}),\s*(\d+)\s*(?:\(\s*([^)]{1,20})\s*\))?\s*,?\s*(?:[Pp]{1,2}\.?\s*)?(\d+)(?:\s*[-–~]\s*(\d+))?/g;
    let hit = null, m;
    while ((m = JR.exec(rest))) hit = m;
    const NOT_JOURNAL = /https?:|www\.|홈페이지|신문|뉴스|얻음|인출|검색일|Retrieved|["'“”]/;
    if (hit && !NOT_JOURNAL.test(hit[1]) && hit.index + hit[0].length >= rest.length - 3) {
        out.itemType = 'journal';
        out.source = _clean(hit[1]);
        out.volume = hit[2];
        out.issue = hit[3] || '';
        out.pages = hit[5] ? `${hit[4]}-${hit[5]}` : hit[4];
        out.confidence = out.authors ? 'high' : 'low';
        return out;
    }

    // 책 — 학회 규정: 발행지 없이 "…, 출판사." 로 끝난다(APA 7 도 발행지 생략과 일치)
    const BOOK = /^[^.]{2,40}\.?$/;   // 마침표 하나로 끝나는 짧은 나머지 = 출판사
    if (BOOK.test(rest) && rest.length < 60) {
        out.itemType = 'book';
        out.source = _clean(rest.replace(/\.$/, ''));
        out.confidence = out.authors ? 'high' : 'low';
        return out;
    }

    return out;   // 어디에도 안 맞음 — unknown, low
}

// classic script(브라우저)·Node(테스트) 양쪽에서 쓴다 — module 이 없으면 그냥 건너뛴다.
if (typeof module !== 'undefined') module.exports = { parseRefEntry, _parseAuthors, _clean };
