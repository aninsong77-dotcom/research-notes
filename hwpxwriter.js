// ── hwpx 파일을 직접 만든다 ──────────────────────────────────
// 왜: 클립보드 붙여넣기는 한글이 문단 서식(내어쓰기)을 받지 않는 것으로 확인됐다
// (실제 hwpx 를 열어 paraPrIDRef 가 매번 커서 자리의 기존 스타일을 그대로 물려받는
// 것을 봤다 — 우리가 보낸 CSS 는 애초에 읽히지 않는다). 그래서 클립보드를 거치지
// 않고, 처음부터 올바른 문단 스타일이 박힌 진짜 hwpx 파일을 직접 만든다.
// 템플릿(hwpxtemplate.js)은 실제 hwpx 파일에서 그대로 뽑아낸 것이라 구조가 검증돼
// 있다 — 새로 설계한 게 아니라 "실제로 작동하는 파일에 우리 내용만 채워 넣는" 방식.

// ── ZIP(무압축 저장) ─────────────────────────────────────────
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();
function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}
function strToBytes(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    // Node 테스트용 대비
    return Buffer.from(s, 'utf-8');
}
function dosDateTime() {
    const d = new Date();
    const time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() >> 1) & 0x1F);
    const date = (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0xF) << 5) | (d.getDate() & 0x1F);
    return { time, date };
}
// files: [{ name, data: string|Uint8Array }] — method 0(무압축)만 쓴다.
// hwpx 는 압축 없이도 유효한 zip 이면 열 수 있다(원본 mimetype 항목도 무압축이었다).
function buildZip(files) {
    const { time, date } = dosDateTime();
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
        const nameBytes = strToBytes(f.name);
        const data = typeof f.data === 'string' ? strToBytes(f.data) : f.data;
        const crc = crc32(data);
        const local = new Uint8Array(30 + nameBytes.length);
        const dv = new DataView(local.buffer);
        dv.setUint32(0, 0x04034b50, true);
        dv.setUint16(4, 20, true);
        dv.setUint16(6, 0, true);
        dv.setUint16(8, 0, true);         // method 0 = store
        dv.setUint16(10, time, true);
        dv.setUint16(12, date, true);
        dv.setUint32(14, crc, true);
        dv.setUint32(18, data.length, true);
        dv.setUint32(22, data.length, true);
        dv.setUint16(26, nameBytes.length, true);
        dv.setUint16(28, 0, true);
        local.set(nameBytes, 30);
        chunks.push(local, data);

        const cd = new Uint8Array(46 + nameBytes.length);
        const cdv = new DataView(cd.buffer);
        cdv.setUint32(0, 0x02014b50, true);
        cdv.setUint16(4, 20, true);
        cdv.setUint16(6, 20, true);
        cdv.setUint16(8, 0, true);
        cdv.setUint16(10, 0, true);
        cdv.setUint16(12, time, true);
        cdv.setUint16(14, date, true);
        cdv.setUint32(16, crc, true);
        cdv.setUint32(20, data.length, true);
        cdv.setUint32(24, data.length, true);
        cdv.setUint16(28, nameBytes.length, true);
        cdv.setUint32(42, offset, true);
        cd.set(nameBytes, 46);
        central.push(cd);

        offset += local.length + data.length;
    }
    const centralStart = offset;
    let centralSize = 0;
    for (const c of central) centralSize += c.length;

    const end = new Uint8Array(22);
    const edv = new DataView(end.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(8, files.length, true);
    edv.setUint16(10, files.length, true);
    edv.setUint32(12, centralSize, true);
    edv.setUint32(16, centralStart, true);

    const total = chunks.concat(central, [end]);
    let size = 0;
    for (const c of total) size += c.length;
    const out = new Uint8Array(size);
    let p = 0;
    for (const c of total) { out.set(c, p); p += c.length; }
    return out;
}

// ── XML 조립 ─────────────────────────────────────────────
function escXml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// html(apaCleanHtml 로 이미 다듬어진 것 — <i style="font-style:italic">·
// <span class="ref-emph" style="font-family:...">·평문 셋만 있다고 가정)을
// [charPrId, text] 조각으로 쪼갠다. 복사 버튼이 쓰는 것과 같은 html 을 그대로
// 받으므로, 직접 손으로 고친 부분도 똑같이 반영된다.
function htmlToRuns(html) {
    const div = document.createElement('div');
    div.innerHTML = String(html || '');
    const runs = [];
    const push = (id, text) => { if (text) runs.push([id, text]); };
    const walk = (node, charId) => {
        for (const n of node.childNodes) {
            if (n.nodeType === 3) { push(charId, n.nodeValue); continue; }
            if (n.nodeType !== 1) continue;
            const st = n.getAttribute('style') || '';
            if (n.tagName === 'I' || n.tagName === 'EM' || /font-style\s*:\s*italic/i.test(st)) {
                walk(n, 8);   // 이탤릭
            } else if (n.tagName === 'SPAN' && n.classList.contains('ref-emph')) {
                walk(n, 9);   // 맑은 고딕
            } else {
                walk(n, charId);
            }
        }
    };
    walk(div, 7);
    return runs.length ? runs : [[7, div.textContent || '']];
}

// paraStyle: 21(학회 4칸) | 22(APA 0.5in). first=true 인 문단에만 secPr·ctrl 를 싣는다
// (hwpx 규격상 문서에 한 번, 첫 문단에 있어야 한다).
function buildParagraph(runs, paraStyle, first) {
    let body = '';
    if (first) body += `<hp:run charPrIDRef="7">${SECPR_XML}${CTRL_XML}</hp:run>`;
    for (const [id, text] of runs) body += `<hp:run charPrIDRef="${id}"><hp:t>${escXml(text)}</hp:t></hp:run>`;
    // ⚠️ linesegarray(줄바꿈 위치 캐시) 는 일부러 안 넣는다 — 우리가 정확한 값을
    //    계산할 방법이 없고, 한글이 문서를 열 때 스스로 다시 계산해 채워 넣는
    //    캐시 성격의 값이라 없어도 열리는 것으로 알려져 있다(미확인 — 열어서 확인 필요).
    return `<hp:p id="2147483648" paraPrIDRef="${paraStyle}" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">${body}</hp:p>`;
}

function buildSection0(items, paraStyle) {
    let xml = '';
    items.forEach((runs, i) => { xml += buildParagraph(runs, paraStyle, i === 0); });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><hs:sec xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0">${xml}</hs:sec>`;
}

function buildContentHpf(title) {
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><opf:package xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hp10="http://www.hancom.co.kr/hwpml/2016/paragraph" xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hhs="http://www.hancom.co.kr/hwpml/2011/history" xmlns:hm="http://www.hancom.co.kr/hwpml/2011/master-page" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf/" xmlns:ooxmlchart="http://www.hancom.co.kr/hwpml/2016/ooxmlchart" xmlns:hwpunitchar="http://www.hancom.co.kr/hwpml/2016/HwpUnitChar" xmlns:epub="http://www.idpf.org/2007/ops" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" version="" unique-identifier="" id=""><opf:metadata><opf:title>${escXml(title)}</opf:title><opf:language>ko</opf:language><opf:meta name="creator" content="text">연구노트앱</opf:meta><opf:meta name="CreatedDate" content="text">${now}</opf:meta><opf:meta name="ModifiedDate" content="text">${now}</opf:meta></opf:metadata><opf:manifest><opf:item id="header" href="Contents/header.xml" media-type="application/xml"/><opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/><opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest><opf:spine><opf:itemref idref="header" linear="yes"/><opf:itemref idref="section0" linear="yes"/></opf:spine></opf:package>`;
}

// items: [{ html, lang }] (apaCleanHtml 로 다듬어진 html — collectFix() 결과와 동일)
// styleName: 'kapp' | 'apa'
function buildHwpxBlob(items, styleName) {
    const paraStyle = styleName === 'apa' ? 22 : 21;
    const paras = items.map(it => htmlToRuns(it.html));
    const section0 = buildSection0(paras, paraStyle);
    const contentHpf = buildContentHpf('참고문헌 목록');
    const previewText = items.map(it => it.text || '').join('\n').slice(0, 1000);

    const files = [
        { name: 'mimetype', data: MIMETYPE },
        { name: 'version.xml', data: VERSION_XML },
        { name: 'settings.xml', data: SETTINGS_XML },
        { name: 'Contents/header.xml', data: HEADER_XML },
        { name: 'Contents/section0.xml', data: section0 },
        { name: 'Contents/content.hpf', data: contentHpf },
        { name: 'Preview/PrvText.txt', data: previewText },
        { name: 'META-INF/container.xml', data: CONTAINER_XML },
        { name: 'META-INF/container.rdf', data: CONTAINER_RDF },
        { name: 'META-INF/manifest.xml', data: MANIFEST_XML },
    ];
    return buildZip(files);
}

if (typeof module !== 'undefined')
    module.exports = { buildZip, buildHwpxBlob, buildSection0, buildParagraph, buildContentHpf, crc32, escXml };
