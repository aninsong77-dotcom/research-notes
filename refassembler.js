// ── 참고문헌 조립기 · 규정표 ──────────────────────────────
// parseRefEntry 가 만든 칸을 규정표(STYLE_*)를 보고 문장으로 조립한다.
// 규정이 바뀌면 이 파일의 표만 바꾼다 — assembleRef 함수 자체는 안 바뀐다.

// 영문 학술지명·출판사는 Title Case (규정.md §D) — 논문 제목(sentence case)과는 다르다.
// refassembler.js 는 app.js 보다 먼저 실려도 상관없도록(테스트 단독 실행 포함) 자체 목록을 둔다.
const _TC_MINOR = new Set(['a','an','and','as','at','but','by','for','from','in','into','nor',
    'of','on','or','over','per','so','the','to','up','via','with','yet','vs']);
function titleCaseSource(str) {
    const s = String(str || '');
    if (!s || /[가-힣]/.test(s)) return s;
    let capNext = true;
    return s.split(/(\s+)/).map(tok => {
        if (/^\s+$/.test(tok)) return tok;
        const bare = tok.replace(/[^A-Za-z0-9'-]/g, '');
        const letters = tok.replace(/[^A-Za-z]/g, '');
        const isAcronym = letters.length > 1 && letters === letters.toUpperCase();
        const isMixed = /[a-z][A-Z]/.test(tok);
        let out;
        if (isAcronym || isMixed) out = tok;
        else if (!capNext && _TC_MINOR.has(bare.toLowerCase())) out = tok.toLowerCase();
        else out = tok.replace(/^[A-Za-z]/, ch => ch.toUpperCase());
        capNext = /[:;?!]$/.test(tok);
        return out;
    }).join('');
}

function escHtml(x) {
    return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 저자를 규정 형식으로 이어붙인다. 마지막 저자 앞 접속 방식만 style 이 정한다.
function joinAuthors(list, lang, style) {
    if (!list || !list.length) return '';
    if (list.length === 1) return list[0];
    const sep = lang === 'ko' ? style.authorSepKo : ', ';
    const last = lang === 'ko' ? style.authorLastKo : ', & ';
    if (list.length === 2) return list.join(lang === 'ko' ? style.authorSepKo2 : last.replace(', ', ' & '));
    return list.slice(0, -1).join(sep) + last + list[list.length - 1];
}

// 강조 구간을 만든다. style.emphasis 가 언어별로 'italic' | { font } 를 정한다.
function emphasize(text, lang, style) {
    const rule = style.emphasis[lang];
    const t = escHtml(text);
    if (!rule) return t;
    if (rule === 'italic') return `<i style="font-style:italic">${t}</i>`;
    if (rule.font) return `<span style="font-family:'${rule.font}'">${t}</span>`;
    return t;
}

// ── 규정표 ──────────────────────────────────────────────

// APA 7판 (docsPlan/참고문헌-파서/규정.md §A~D, Purdue OWL 확인)
const STYLE_APA = {
    name: 'APA 7',
    pageDash: '–',
    hangingIndent: { css: 'margin-left:.5in;text-indent:-.5in' },
    authorSepKo: ', ', authorSepKo2: ', ', authorLastKo: ', ',
    emphasis: { ko: 'italic', en: 'italic' },
    thesisBrackets: true,   // [석사학위논문, 대학명]
};

// 한국심리학회지: 상담 및 심리치료 (docsPlan/참고문헌-파서/규정.md, 사용자 제공 원본)
const STYLE_KAPP = {
    name: '한국심리학회(상담및심리치료)',
    pageDash: '-',                                  // 규정 예시가 하이픈
    hangingIndent: { css: 'margin-left:2em;text-indent:-2em' },  // 4칸(대략 2em)
    authorSepKo: ', ', authorSepKo2: ', ', authorLastKo: ', ',
    emphasis: { ko: { font: '맑은 고딕' }, en: 'italic' },        // ⚠️ 국문=고딕, 영문=기울임
    thesisBrackets: false,                          // "대학교 대학원 석사학위논문" 그대로
};

// 학교(대학원) 양식 — 비워둠. null 이면 STYLE_KAPP 를 대신 쓴다.
const STYLE_SCHOOL = null;

function getStyle(name) {
    if (name === 'apa') return STYLE_APA;
    if (name === 'school' && STYLE_SCHOOL) return STYLE_SCHOOL;
    return STYLE_KAPP;   // 기본값
}

// ── ② 조립기 ─────────────────────────────────────────────
// entry.confidence !== 'high' 면 호출 쪽에서 아예 부르지 않아야 한다(원문 유지).
function assembleRef(entry, style) {
    const e = entry;
    const authors = joinAuthors(e.authors, e.lang, style);
    const yr = `(${e.year}${e.yearSuffix})`;

    if (e.itemType === 'journal') {
        const sourceName = e.lang === 'en' ? titleCaseSource(e.source) : e.source;
        const src = emphasize(`${sourceName}, ${e.volume}`, e.lang, style);
        const issue = e.issue ? `(${escHtml(e.issue)})` : '';
        const pages = e.pages.replace(/-/g, style.pageDash);
        const html = `${escHtml(authors)} ${yr}. ${escHtml(e.title)}. ${src}${issue}, ${escHtml(pages)}.`;
        const text = `${authors} ${yr}. ${e.title}. ${sourceName}, ${e.volume}${issue}, ${pages}.`;
        return { html, text };
    }

    if (e.itemType === 'book') {
        const title = emphasize(e.title, e.lang, style);
        const html = `${escHtml(authors)} ${yr}. ${title}. ${escHtml(e.source)}.`;
        const text = `${authors} ${yr}. ${e.title}. ${e.source}.`;
        return { html, text };
    }

    if (e.itemType === 'thesis') {
        const title = emphasize(e.title, e.lang, style);
        const tail = style.thesisBrackets
            ? `[${e.degree}, ${e.source}]`
            : `${e.source} ${e.degree}`;
        const html = `${escHtml(authors)} ${yr}. ${title}. ${escHtml(tail)}.`;
        const text = `${authors} ${yr}. ${e.title}. ${tail}.`;
        return { html, text };
    }

    return null;   // 조립할 수 없는 유형 — 호출 쪽에서 원문 유지
}

if (typeof module !== 'undefined')
    module.exports = { assembleRef, getStyle, STYLE_APA, STYLE_KAPP, joinAuthors, emphasize };
