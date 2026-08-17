// ============================================================
// 내 연구노트 — app.js
// ============================================================

// ── 디버그 로그 (오류·경고 자동 수집) ──────────────────────────
// 사용 중 발생한 오류를 모아 두었다가, 사이드바 "디버그 로그" 버튼으로
// 복사/다운로드해 개발자(클로드)에게 전달할 수 있게 한다.
const DEBUG_LOG = [];
const DEBUG_MAX = 1000;              // 전체 보관 한도 (넘으면 오래된 것부터 자동 삭제)
const DEBUG_INFO_TTL = 15 * 60 * 1000; // 일반 기록(info)은 15분 후 자동 정리 (오류·경고는 유지)

function pushDebug(level, msg) {
    DEBUG_LOG.push({ t: Date.now(), level, msg: String(msg).slice(0, 3000) });
    if (DEBUG_LOG.length > DEBUG_MAX) DEBUG_LOG.shift();
    // 오래된 일반 기록만 자동으로 비움 — 오류·경고는 복사할 때까지 남겨둠
    const cutoff = Date.now() - DEBUG_INFO_TTL;
    for (let i = DEBUG_LOG.length - 1; i >= 0; i--) {
        if (DEBUG_LOG[i].level === 'info' && DEBUG_LOG[i].t < cutoff) DEBUG_LOG.splice(i, 1);
    }
    // error·warn은 localStorage에도 보관 (새로고침 후에도 유지, 최대 50건)
    if (level === 'error' || level === 'warn') {
        try {
            const stored = JSON.parse(localStorage.getItem('debugPersist') || '[]');
            stored.push({ t: Date.now(), level, msg: String(msg).slice(0, 500) });
            if (stored.length > 50) stored.splice(0, stored.length - 50);
            localStorage.setItem('debugPersist', JSON.stringify(stored));
        } catch(e) {}
    }
    if (level === 'error' || level === 'warn') {
        const badge = document.getElementById('debug-badge');
        if (badge) {
            badge.textContent = String((parseInt(badge.textContent, 10) || 0) + 1);
            badge.style.display = 'inline-flex';
        }
    }
}

function fmtDebugArgs(args) {
    return [...args].map(a => {
        if (a instanceof Error) return a.stack || a.message;
        if (a && typeof a === 'object') { try { return JSON.stringify(a); } catch { return String(a); } }
        return String(a);
    }).join(' ');
}

// 전역 오류 후킹 — 가능한 한 일찍 설치
window.addEventListener('error', e => {
    pushDebug('error', `${e.message}  @ ${e.filename}:${e.lineno}:${e.colno}\n${e.error?.stack || ''}`.trim());
});
window.addEventListener('unhandledrejection', e => {
    const r = e.reason;
    pushDebug('error', `Promise 거부: ${r?.stack || r?.message || r}`);
});
['error', 'warn'].forEach(level => {
    const orig = console[level].bind(console);
    console[level] = (...args) => { pushDebug(level, fmtDebugArgs(args)); orig(...args); };
});

// ── IndexedDB 초기화 ────────────────────────────────────────
const DB_NAME = 'ResearchNotesDB';
const DB_VERSION = 9;
const STORE_PAPERS = 'papers';
const STORE_PROJECTS = 'projects';
const STORE_MINDMAPS = 'mindmaps';
const STORE_MATERIALS = 'materials';
const STORE_SETTINGS = 'settings';   // 앱 설정(백업 폴더 핸들 등) 보관
const STORE_NOTES = 'notes';         // 아이디어 저장소(메모)
const STORE_PROPOSALS = 'proposals'; // 모형스케치북 미니 프로포절(프로젝트별, key=projectId)
const STORE_POSTITS = 'postits';     // 포스트잇 캔버스 (프로젝트별)

let db;

function initDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = e => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains(STORE_PAPERS)) {
                d.createObjectStore(STORE_PAPERS, { keyPath: 'id' });
            }
            if (!d.objectStoreNames.contains(STORE_PROJECTS)) {
                d.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
            }
            if (!d.objectStoreNames.contains(STORE_MINDMAPS)) {
                d.createObjectStore(STORE_MINDMAPS, { keyPath: 'id' });
            }
            if (!d.objectStoreNames.contains(STORE_MATERIALS)) {
                d.createObjectStore(STORE_MATERIALS, { keyPath: 'id' });
            }
            if (!d.objectStoreNames.contains(STORE_SETTINGS)) {
                d.createObjectStore(STORE_SETTINGS, { keyPath: 'id' });
            }
            if (!d.objectStoreNames.contains(STORE_NOTES)) {
                d.createObjectStore(STORE_NOTES, { keyPath: 'id' });
            }
            if (!d.objectStoreNames.contains(STORE_PROPOSALS)) {
                d.createObjectStore(STORE_PROPOSALS, { keyPath: 'id' });
            }
            if (!d.objectStoreNames.contains('daily')) {
                d.createObjectStore('daily', { keyPath: 'id' });
            }
            if (!d.objectStoreNames.contains(STORE_POSTITS)) {
                d.createObjectStore(STORE_POSTITS, { keyPath: 'id' });
            }
            pushDebug('info', `DB 업그레이드: v${e.oldVersion} → v${e.newVersion}`);
        };
        req.onsuccess = e => { db = e.target.result; resolve(); };
        req.onerror = e => reject(e.target.error);
    });
}

function dbGetAll(store) {
    return new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbGet(store, id) {
    return new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readonly').objectStore(store).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbPut(store, item) {
    return new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readwrite').objectStore(store).put(item);
        req.onsuccess = () => { resolve(); maybeAutoBackup(store); };
        req.onerror = () => reject(req.error);
    });
}

function dbDelete(store, id) {
    return new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readwrite').objectStore(store).delete(id);
        req.onsuccess = () => { resolve(); maybeAutoBackup(store); };
        req.onerror = () => reject(req.error);
    });
}

// 논문·자료·메모가 바뀌면 자동 백업 예약 (백업 폴더가 지정돼 있을 때만)
// suppressAutoBackup: 전체 삭제 같은 위험 작업 중에는 백업 파일을 덮어쓰지 않게 막음(복구 지점 보존)
let suppressAutoBackup = false;
function maybeAutoBackup(store) {
    if (suppressAutoBackup) return;
    if (store === STORE_PAPERS || store === STORE_MATERIALS || store === STORE_NOTES || store === STORE_PROPOSALS) autoBackup();
}

// 스토어 전체 비우기 (삭제용 — 자동백업 트리거 안 함)
function dbClearStore(store) {
    return new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readwrite').objectStore(store).clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// 브라우저가 데이터를 함부로 지우지 않도록 영구 저장 요청
async function requestPersistentStorage() {
    try {
        if (navigator.storage?.persist) {
            const already = await navigator.storage.persisted();
            const granted = already || await navigator.storage.persist();
            pushDebug('info', `영구 저장: ${granted ? '적용됨' : '미적용'}`);
        }
    } catch (err) {
        pushDebug('warn', `영구 저장 요청 실패: ${err.message}`);
    }
}

// ── 유틸 ───────────────────────────────────────────────────
function genId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function escHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── 아이콘 (단색 라인, Lucide 풍) ──────────────────────────────
// icon('이름') → 인라인 SVG 문자열. stroke=currentColor 라 글자색을 따라감.
// 전역이라 mindmap.js에서도 그대로 사용 가능.
const ICON_PATHS = {
    'file-text':  '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
    'note':       '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M10.4 12.6a2 2 0 1 1 3 3L8 21l-4 1 1-4Z"/>',
    'paperclip':  '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    'zap':        '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    'book-open':  '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    'library':    '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
    'pencil':     '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    'trash':      '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
    'search':     '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    'clipboard':  '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    'lightbulb':  '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>',
    'nodes':      '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>',
    'bar-chart':  '<line x1="12" x2="12" y1="20" y2="10"/><line x1="18" x2="18" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="16"/>',
    'copy':       '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    'link':       '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    'package':    '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
    'image':      '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    'tag':        '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
    'alert':      '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    'check':      '<path d="M20 6 9 17l-5-5"/>',
    'eye':        '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
    'chat':       '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    'bot':        '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
    'key':        '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
    'microscope': '<path d="M6 18h8"/><path d="M3 22h18"/><path d="M14 22a7 7 0 1 0 0-14h-1"/><path d="M9 14h2"/><path d="M9 12a2 2 0 0 1-2-2V6h6v4a2 2 0 0 1-2 2Z"/><path d="M12 6V3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3"/>',
    'cloud':      '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    'cloud-off':  '<path d="m2 2 20 20"/><path d="M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.3-.19"/><path d="M21.53 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 10 5.07"/>',
    'chevron-down': '<path d="m6 9 6 6 6-6"/>',
    'chevron-up':   '<path d="m18 15-6-6-6 6"/>',
    'x':            '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};
function icon(name, size = 16) {
    const p = ICON_PATHS[name];
    if (!p) return '';
    return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

// ── 앱 상태 ────────────────────────────────────────────────
const state = {
    view: 'home',
    searchQuery: '',
    searchMode: 'fulltext',    // 검색 방식: 'fulltext'(전체단어) | 'keyword'(키워드만)
    paperSort: 'recent',       // 논문 정렬: 'recent'|'title'|'year'|'author'
    groupBy: 'none',           // 논문 묶기 기준: 'none' | ORGANIZE_DIMS의 키
    expandedId: null,          // 펼쳐진(아코디언) 논문 id
    rowFields: null,           // 펼침에 보일 항목 키 배열(localStorage 복원, 아래 loadRowFields)
    fieldsOpen: false,         // 「표시」 드롭다운 열림 여부(항목 토글해도 유지)
    papers: [],
    materials: [],
    notes: [],
    proposal: null,            // 현재 프로젝트의 미니 프로포절(모형스케치북)
    projects: [],
    currentProjectId: null,
    editingId: null,
    formMode: 'edit',          // 논문 모달: 'view' | 'edit'
    editingMaterialId: null,
    materialMode: 'edit',      // 자료 모달: 'view' | 'edit'
    materialSelectMode: false,
    materialSelectedIds: new Set(),
    currentPdfFile: null,
    currentMaterialFile: null,
};

let formVariables = [];
let formTags = [];

// 자료(논문이 아닌 자료) 종류
const MATERIAL_TYPES = ['척도', '도서', '웹자료', '보고서', '강의자료', '기타'];

// ── 논문 정밀 분석(정리표) 정의 ────────────────────────────
// 단순 텍스트 필드: 폼 input id → 저장 key
const ANALYSIS_TEXT_FIELDS = {
    'a-type': 'paperType',     'a-school': 'school',       'a-keywords': 'keywords',
    'a-needs': 'needs',        'a-priorlimits': 'priorLimits', 'a-theory': 'theory',
    'a-mainstudies': 'mainStudies', 'a-subjects': 'subjects', 'a-model': 'model',
    'a-program': 'program',    'a-method': 'method',       'a-results': 'results',
    'a-implications': 'implications', 'a-limitations': 'limitations',
    'a-impressive': 'impressive',     'a-further': 'furtherReading',
};

// 변수 역할: [key, 라벨]
const VAR_ROLES = [
    ['independent', '독립변수'], ['mediator', '매개변수'], ['moderator', '조절변수'],
    ['dependent', '종속변수'],   ['control', '통제변수'],
];

// 변수 하위 항목: [data-f, 표시명, placeholder]
const VAR_FIELDS = [
    ['name', '변수명', '변수명'], ['factor', '요인', '하위요인'],
    ['scale', '척도', '척도/문항'], ['reliability', '신뢰도', '신뢰도 α'],
    ['validity', '타당도', '타당도'],
];

// ── 프로젝트 초기화 ────────────────────────────────────────
async function initProjects() {
    state.projects = await dbGetAll(STORE_PROJECTS);

    if (state.projects.length === 0) {
        const defaultProject = { id: genId(), name: '석사논문', createdAt: Date.now() };
        await dbPut(STORE_PROJECTS, defaultProject);
        state.projects = [defaultProject];

        // 기존 논문들을 기본 프로젝트에 배정
        const allPapers = await dbGetAll(STORE_PAPERS);
        for (const paper of allPapers) {
            if (!paper.projectId) {
                paper.projectId = defaultProject.id;
                await dbPut(STORE_PAPERS, paper);
            }
        }
    }

    const saved = localStorage.getItem('currentProjectId');
    state.currentProjectId = (saved && state.projects.find(p => p.id === saved))
        ? saved : state.projects[0].id;
    localStorage.setItem('currentProjectId', state.currentProjectId);
}

// ── 데이터 로드 ────────────────────────────────────────────
async function loadData() {
    const all = await dbGetAll(STORE_PAPERS);
    state.papers = all.filter(p => p.projectId === state.currentProjectId);
    const allMat = await dbGetAll(STORE_MATERIALS);
    state.materials = allMat.filter(m => m.projectId === state.currentProjectId);
    const allNotes = await dbGetAll(STORE_NOTES);
    state.notes = allNotes.filter(n => n.projectId === state.currentProjectId);
    _apaSuffix = apaYearSuffixes(state.papers);   // 같은 저자·같은 해 → 2020a/2020b
    _mmTree = null; // 프로젝트 전환 시 마인드맵 캐시 초기화
    state.proposal = await loadProposal(state.currentProjectId);
    // 백업 폴더가 있고 PDF 없는 논문이 있으면 자동 복원 시도
    setTimeout(autoLoadPdfsFromBackup, 500);
    // 개수 갱신 + 잠금화면에서 숨겼던 뱃지 다시 표시
    [['papers-count', state.papers.length],
     ['materials-count', state.materials.length],
     ['notes-count', state.notes.length]].forEach(([id, n]) => {
        const el = document.getElementById(id);
        if (el) { el.textContent = n; el.style.display = ''; }
    });
}

// ── 미니 프로포절 데이터층 (모형스케치북) ───────────────────
// 프로젝트별 1개(key=projectId). 화면 로직은 mindmap.js, 저장은 여기로 일원화.
function defaultProposal(pid) {
    return {
        id: pid, title: '', subtitle: '',
        needs: '', purpose: '', theory: '', subjects: '', method: '', expected: '',
        hypotheses: [],   // [{ id, label('H1' 자동 재계산), text }]
        updatedAt: 0,
    };
}

async function loadProposal(pid) {
    return (await dbGet(STORE_PROPOSALS, pid)) || defaultProposal(pid);
}

// 프로포절에 내용이 얼마나 들어있는지(가져오기 때 가장 알찬 것 고르기·빈 것 판단용)
function proposalContentScore(p) {
    if (!p) return 0;
    const text = [p.title, p.subtitle, p.needs, p.purpose, p.method, p.subjects].filter(Boolean).join('');
    const hypos = (p.hypotheses || []).map(h => h.text || '').join('');
    return (text + hypos).trim().length;
}

// 입력 중 600ms 디바운스 자동저장(아이디어 메모와 동일 패턴)
let proposalSaveTimer;
function queueSaveProposal() {
    clearTimeout(proposalSaveTimer);
    proposalSaveTimer = setTimeout(saveProposalNow, 600);
}
async function saveProposalNow() {
    if (!state.proposal) return;
    state.proposal.updatedAt = Date.now();
    await dbPut(STORE_PROPOSALS, state.proposal);
}

// ── 프로젝트 전환 ──────────────────────────────────────────
async function switchProject(id) {
    state.currentProjectId = id;
    localStorage.setItem('currentProjectId', id);
    state.searchQuery = '';
    document.getElementById('search-input').value = '';
    state.view = 'home';
    await loadData();
    renderProjectSelector();
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-view="home"]')?.classList.add('active');
    renderContent();
}

// ── 프로젝트 생성 ──────────────────────────────────────────
async function createProject() {
    const name = prompt('새 프로젝트 이름을 입력하세요:');
    if (!name?.trim()) return;
    const project = { id: genId(), name: name.trim(), createdAt: Date.now() };
    await dbPut(STORE_PROJECTS, project);
    state.projects = await dbGetAll(STORE_PROJECTS);
    await switchProject(project.id);
    showToast(`"${project.name}" 프로젝트가 생성됐습니다`, 'success');
}

// ── 프로젝트 이름 변경 ─────────────────────────────────────
async function renameProject(id) {
    const project = state.projects.find(p => p.id === id);
    if (!project) return;
    const name = prompt('새 이름:', project.name);
    if (!name?.trim() || name.trim() === project.name) return;
    project.name = name.trim();
    await dbPut(STORE_PROJECTS, project);
    state.projects = await dbGetAll(STORE_PROJECTS);
    renderProjectSelector();
    showToast('이름이 변경됐습니다', 'success');
}

// ── 프로젝트 삭제 ──────────────────────────────────────────
async function deleteProject(id) {
    if (state.projects.length === 1) {
        showToast('프로젝트가 하나뿐이라 삭제할 수 없습니다', 'error'); return;
    }
    const project = state.projects.find(p => p.id === id);
    const paperCount = (await dbGetAll(STORE_PAPERS)).filter(p => p.projectId === id).length;
    const msg = paperCount > 0
        ? `"${project.name}"을 삭제하면 논문 ${paperCount}편도 함께 삭제됩니다. 계속할까요?`
        : `"${project.name}"을 삭제할까요?`;
    if (!confirm(msg)) return;

    // 해당 프로젝트 논문 삭제
    const all = await dbGetAll(STORE_PAPERS);
    for (const p of all.filter(p => p.projectId === id)) {
        await dbDelete(STORE_PAPERS, p.id);
    }
    await dbDelete(STORE_PROJECTS, id);
    await dbDelete(STORE_PROPOSALS, id);
    state.projects = await dbGetAll(STORE_PROJECTS);

    if (state.currentProjectId === id) {
        await switchProject(state.projects[0].id);
    } else {
        renderProjectSelector();
    }
    showToast('프로젝트가 삭제됐습니다', 'success');
}

// ── 프로젝트 선택기 렌더링 ─────────────────────────────────
function renderProjectSelector() {
    const container = document.getElementById('project-selector');
    container.style.display = '';   // 잠금화면에서 숨겼다면 다시 표시
    const current = state.projects.find(p => p.id === state.currentProjectId);

    container.innerHTML = `
        <div class="project-wrap">
            <button class="project-btn" id="project-btn" title="${escHtml(current?.name || '프로젝트')}">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                <span class="project-name">${escHtml(current?.name || '프로젝트')}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="margin-left:auto;flex-shrink:0"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="project-dropdown" id="project-dropdown" style="display:none">
                ${state.projects.map(p => `
                    <div class="project-dropdown-item ${p.id === state.currentProjectId ? 'active' : ''}" data-id="${p.id}">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;opacity:${p.id === state.currentProjectId ? 1 : 0}"><polyline points="20 6 9 17 4 12"/></svg>
                        <span class="project-item-name">${escHtml(p.name)}</span>
                        <div class="project-item-actions">
                            <button class="project-action-btn" data-action="rename" data-id="${p.id}" title="이름 변경">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
                            </button>
                            <button class="project-action-btn danger" data-action="delete" data-id="${p.id}" title="삭제">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                            </button>
                        </div>
                    </div>`).join('')}
                <div class="project-dropdown-divider"></div>
                <button class="project-dropdown-new" id="project-new">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="flex-shrink:0"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    새 프로젝트
                </button>
            </div>
        </div>`;

    // 드롭다운 토글
    const btn = document.getElementById('project-btn');
    const dropdown = document.getElementById('project-dropdown');
    btn.addEventListener('click', e => {
        e.stopPropagation();
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
    });

    // 프로젝트 선택
    container.querySelectorAll('.project-dropdown-item').forEach(item => {
        item.addEventListener('click', e => {
            if (e.target.closest('.project-item-actions')) return;
            dropdown.style.display = 'none';
            switchProject(item.dataset.id);
        });
    });

    // 이름 변경 / 삭제
    container.querySelectorAll('.project-action-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            dropdown.style.display = 'none';
            if (btn.dataset.action === 'rename') renameProject(btn.dataset.id);
            else if (btn.dataset.action === 'delete') deleteProject(btn.dataset.id);
        });
    });

    // 새 프로젝트
    document.getElementById('project-new').addEventListener('click', () => {
        dropdown.style.display = 'none';
        createProject();
    });

    // 외부 클릭 시 닫기
    document.addEventListener('click', () => { dropdown.style.display = 'none'; }, { once: false });
}

// ── 렌더링 진입점 ──────────────────────────────────────────
function renderContent() {
    // 로그인 게이트 — Firebase 인증이 켜져 있는데 로그아웃 상태면
    // 어떤 경로로 들어오든(시작·버튼클릭·동기화) 내용 대신 잠금화면을 그리고 끝낸다.
    // (인터넷 없어 Firebase가 아예 안 뜬 오프라인 모드에서는 잠그지 않고 로컬 데이터 표시)
    if (typeof fbAuth !== 'undefined' && fbAuth && !currentUser) {
        if (typeof renderLockedScreen === 'function') { renderLockedScreen(); return; }
    }

    const q = state.searchQuery.trim().toLowerCase();
    const container = document.getElementById('content');

    // 추가 버튼 라벨을 현재 화면에 맞춤(우상단·사이드바 둘 다 같은 기능 → 같은 라벨)
    const addLabelText =
        state.view === 'materials' ? '자료 추가' :
        state.view === 'notes' ? '메모 추가' : '논문 추가';
    const addTop = document.getElementById('add-top-label');
    const addSide = document.getElementById('add-side-label');
    if (addTop)  addTop.textContent  = addLabelText;
    if (addSide) addSide.textContent = addLabelText;

    // 탑바 "논문 보기" 드롭다운 — 현재 논문 목록으로 갱신
    refreshPaperJump();

    // 책상에서 다른 화면으로 나가면 책상 리소스 정리(펼쳐둔 논문 목록은 유지)
    if (state.view !== 'desk' && deskCtx) deskTeardown();

    // 모형스케치북·책상 뷰가 아닐 때 스타일 복원(둘은 각자 꽉 찬 레이아웃 사용)
    if (state.view !== 'sketch') {
        if (state.view !== 'desk') {
            // 메모 화면은 작업 공간을 최대한 넓게 쓰도록 여백을 줄이고,
            // 페이지 자체가 늘어나지 않고 보관함·캔버스가 화면 높이를 채운 채
            // 각자 안에서만 스크롤되도록 flex 세로 레이아웃 + overflow hidden 사용
            container.style.padding  = state.view === 'notes' ? '12px' : '24px';
            container.style.overflow = state.view === 'notes' ? 'hidden' : 'auto';
        }
        S = null; // 마인드맵 상태 초기화
    }
    container.style.display = state.view === 'notes' ? 'flex' : '';
    container.style.flexDirection = state.view === 'notes' ? 'column' : '';

    if (q) {
        if (state.view === 'materials') renderMaterialSearch(q, container);
        else if (state.view === 'notes') renderNotes(container, q);
        else renderSearchResults(q, container);
        return;
    }
    if (state.view === 'home') renderHome(container);
    else if (state.view === 'desk') renderDesk(container);
    else if (state.view === 'postit') renderMindmapView(container);
    else if (state.view === 'papers') renderPapers(container);
    else if (state.view === 'materials') renderMaterials(container);
    else if (state.view === 'references') renderReferences(container);
    else if (state.view === 'sketch') renderSketch(container);
    else if (state.view === 'notes') renderNotes(container);
}

// ── 논문 목록 (정렬·묶기·한 줄 + 아코디언 통합) ─────────────
const PAPER_SORTS = [
    ['recent', '최신순'],
    ['title',  '제목순'],
    ['year',   '연도순'],
    ['author', '저자순'],
    ['manual', '내 순서'],
];
// 저자 문자열에서 첫 저자만
function firstAuthor(p) {
    return (p.authors || '').split(/[,，、;·]/)[0].trim();
}

// 현재 정렬 기준으로 정렬한 새 배열
function sortPapers(arr) {
    const a = [...arr];
    if (state.paperSort === 'title')
        return a.sort((x, y) => (x.title || '').localeCompare(y.title || '', 'ko'));
    if (state.paperSort === 'year')
        return a.sort((x, y) => String(y.year || '').localeCompare(String(x.year || ''), 'ko', { numeric: true }));
    if (state.paperSort === 'author')
        return a.sort((x, y) => firstAuthor(x).localeCompare(firstAuthor(y), 'ko'));
    if (state.paperSort === 'manual')   // 끌어다 놓기로 정한 내 순서 (값 없으면 뒤로)
        return a.sort((x, y) => (x.sortOrder ?? 1e9) - (y.sortOrder ?? 1e9) || (y.addedAt || 0) - (x.addedAt || 0));
    return a.sort((x, y) => (y.addedAt || 0) - (x.addedAt || 0)); // recent
}

// 단일 선택 드롭다운(정렬·묶기): 버튼에 현재 선택값 표시, 클릭하면 보기 목록 펼침
//  key = 'sort'|'group' → 항목 버튼 class=pc-${key}, data-${key} (bindPaperControls가 잡음)
function ddSingle(label, key, options, current) {
    const cur = options.find(o => o[0] === current) || options[0];
    const chips = options.map(([k, l]) =>
        `<button class="og-tab pc-${key} ${k === current ? 'active' : ''}" data-${key}="${k}">${l}</button>`
    ).join('');
    return `
        <details class="pc-dd" data-dd="${key}" name="paper-dd">
            <summary><span class="pc-dd-label">${label}</span> <b>${escHtml(cur[1])}</b></summary>
            <div class="pc-dd-pop"><div class="og-tabs">${chips}</div></div>
        </details>`;
}

// 상단 정렬/묶기/표시 컨트롤 바 (전부 작은 드롭다운 한 줄)
function papersControlsHTML() {
    // 묶기 = '안 묶음' + ORGANIZE_DIMS (렌더 시점에 계산 — ORGANIZE_DIMS는 파일 뒤쪽 선언)
    const groupOpts = [['none', '안 묶음'], ...ORGANIZE_DIMS.map(([k, label]) => [k, label])];
    // 표시 항목(펼침에 보일 항목) — 여러 개 선택(체크형)
    const sel = ensureRowFields();
    const fieldTabs = ROW_FIELDS.map(f =>
        `<button class="og-tab pc-field ${sel.includes(f.key) ? 'active' : ''}" data-field="${f.key}">${f.label}</button>`
    ).join('');
    return `
        ${ddSingle('정렬', 'sort', PAPER_SORTS, state.paperSort)}
        ${ddSingle('묶기', 'group', groupOpts, state.groupBy)}
        <details class="pc-dd pc-fields-dd" name="paper-dd" ${state.fieldsOpen ? 'open' : ''}>
            <summary><span class="pc-dd-label">표시</span> <b>${sel.length}개</b></summary>
            <div class="pc-dd-pop"><div class="og-tabs">${fieldTabs}</div></div>
        </details>`;
}

function renderPapers(container) {
    const controls = papersControlsHTML();

    if (state.papers.length === 0) {
        container.innerHTML = `
            <div class="paper-header pc-row-inline">
                <span class="section-title">논문</span>
                ${controls}
            </div>
            <div class="empty-state">
                <div class="empty-icon">${icon('file-text', 44)}</div>
                <h3>저장된 논문이 없습니다</h3>
                <p>위의 <strong>+ 논문 추가</strong> 버튼을 눌러<br>첫 번째 논문을 등록해보세요</p>
            </div>`;
        bindPaperControls(container);
        return;
    }

    // 묶음 없는 평면 목록일 때만 끌어다 놓기 가능
    const flat = state.groupBy === 'none';
    const selectMode = !!state.paperSelectMode;
    const selectedIds = state.paperSelectedIds || new Set();

    const body = flat
        ? `<div class="paper-list">${paperRowsHTML(sortPapers(state.papers), !selectMode, selectMode, selectedIds)}</div>`
        : groupedPapersHTML(selectMode, selectedIds);

    const dragHint = (flat && !selectMode)
        ? `<span class="og-summary">⠿ 손잡이를 끌어 순서를 바꿀 수 있어요</span>` : '';

    const selectBar = selectMode ? `
        <div class="paper-select-bar">
            <button class="btn-sel-all" id="btn-sel-all">전체 선택</button>
            <button class="btn-sel-none" id="btn-sel-none">전체 해제</button>
            <button class="btn-sel-del" id="btn-sel-del">선택 삭제 (${selectedIds.size}편)</button>
            <button class="btn-sel-cancel" id="btn-sel-cancel">취소</button>
        </div>` : '';

    container.innerHTML = `
        <div class="paper-header pc-row-inline">
            <span class="section-title">논문 ${state.papers.length}편</span>
            ${controls}
            <button class="btn-paper-select ${selectMode ? 'active' : ''}" id="btn-paper-select-mode">
                ${selectMode ? '선택 중…' : '선택 삭제'}
            </button>
            ${dragHint}
        </div>
        ${selectBar}
        ${body}`;

    bindPaperControls(container);
    if (!selectMode) bindRows(container, flat);
    bindPaperSelectMode(container);
}

// 묶기 기준이 선택됐을 때: 기준값별 접이식 그룹
function groupedPapersHTML(selectMode = false, selectedIds = new Set()) {
    const [dimKey, dimLabel, dimCls] =
        ORGANIZE_DIMS.find(d => d[0] === state.groupBy) || ORGANIZE_DIMS[0];

    const groups = new Map();
    const noValue = [];
    state.papers.forEach(p => {
        const seen = new Set();
        organizeValues(p, dimKey).forEach(v => {
            const key = v.toLowerCase();
            if (seen.has(key)) return;              // 같은 논문이 한 그룹에 중복되지 않게
            seen.add(key);
            if (!groups.has(key)) groups.set(key, { label: v, papers: [] });
            groups.get(key).papers.push(p);
        });
        if (seen.size === 0) noValue.push(p);       // 이 기준에 값이 없는 논문
    });

    // 편 수 많은 순 → 같으면 가나다 순
    const sorted = [...groups.values()].sort((a, b) =>
        b.papers.length - a.papers.length || a.label.localeCompare(b.label, 'ko'));

    const groupHTML = sorted.map(g => `
        <details class="og-group" open>
            <summary>
                <span class="og-group-name ${dimCls}">${escHtml(g.label)}</span>
                <span class="og-group-count">${g.papers.length}편</span>
            </summary>
            <div class="paper-list">${paperRowsHTML(sortPapers(g.papers), false, selectMode, selectedIds)}</div>
        </details>`).join('');

    const noValueHTML = noValue.length ? `
        <details class="og-group og-group-none">
            <summary>
                <span class="og-group-name">${escHtml(dimLabel)} 미입력</span>
                <span class="og-group-count">${noValue.length}편</span>
            </summary>
            <div class="paper-list">${paperRowsHTML(sortPapers(noValue), false, selectMode, selectedIds)}</div>
        </details>` : '';

    return (groupHTML || `<p class="og-empty-dim">아직 ${escHtml(dimLabel)} 정보가 입력된 논문이 없습니다.</p>`) + noValueHTML;
}

// 한 줄 행 목록 (draggable=true면 끌어다 놓기 손잡이 표시)
function paperRowsHTML(arr, draggable = false, selectMode = false, selectedIds = new Set()) {
    return arr.map(p => paperRowHTML(p, draggable, selectMode, selectedIds)).join('');
}

// 읽기 상태 설정
const READ_STATUS = [
    { key: 'unread',  label: '안읽음', color: '#9e9e9e' },
    { key: 'reading', label: '읽는중', color: '#1976d2' },
    { key: 'read',    label: '읽음',   color: '#388e3c' },
];
function readStatusInfo(paper) {
    return READ_STATUS.find(s => s.key === (paper.readStatus || 'unread')) || READ_STATUS[0];
}

function paperRowHTML(paper, draggable = false, selectMode = false, selectedIds = new Set()) {
    const open = state.expandedId === paper.id;
    const meta = [paper.year, firstAuthor(paper)].filter(Boolean).map(escHtml).join(' · ');
    const checked = selectedIds.has(paper.id);
    const rs = readStatusInfo(paper);
    const varTags = (paper.variables || []).filter(Boolean).slice(0, 4)
        .map(v => `<span class="pr-var-tag">${escHtml(v)}</span>`).join('');
    const statusBadge = `<span class="pr-status-badge" style="background:${rs.color}" title="${rs.label}">${rs.label}</span>`;
    return `
        <div class="paper-row-wrap ${open ? 'open' : ''} ${selectMode && checked ? 'pr-selected' : ''} pr-status-${rs.key}" data-id="${paper.id}">
            <div class="paper-row" data-id="${paper.id}" ${draggable ? 'draggable="true"' : ''}>
                ${selectMode
                    ? `<input type="checkbox" class="pr-checkbox" data-id="${paper.id}" ${checked ? 'checked' : ''}>`
                    : (draggable ? '<span class="pr-grip" title="끌어서 순서 바꾸기">⠿</span>' : '')}
                ${statusBadge}
                <span class="pr-caret" ${selectMode ? 'style="display:none"' : ''}>▸</span>
                <span class="pr-title">${escHtml(paper.title || '제목 없음')}</span>
                <span class="pr-meta">${meta}</span>
                ${varTags ? `<span class="pr-var-tags">${varTags}</span>` : ''}
                ${paper.pdfData ? `<span class="pr-icon" title="PDF 있음">${icon('paperclip', 14)}</span>` : ''}
                ${paper.inQuickCite ? `<span class="pr-icon" title="빠른 인용">${icon('zap', 14)}</span>` : ''}
            </div>
            ${(!selectMode && open) ? paperRowDetailHTML(paper) : ''}
        </div>`;
}

// ── 펼침 상세에 보일 수 있는 항목 정의 ───────────────────────────────
// 각 항목: { key, label, get(paper) → .prd-line HTML 문자열 또는 '' }
// 표시 순서는 이 배열 순서. 사용자가 「표시」에서 켠 항목만(state.rowFields) 노출.
const prdLine = (label, valHtml) => `<div class="prd-line"><span class="prd-k">${label}</span><span class="prd-v">${valHtml}</span></div>`;
// 선택한 항목은 비어 있어도 (미입력)으로 항상 보여줌 → 선택이 적용된 게 눈에 보이게
const prdEmpty = label => `<div class="prd-line"><span class="prd-k">${label}</span><span class="prd-v muted">(미입력)</span></div>`;
const prdText = (label, val) => (val && String(val).trim()) ? prdLine(label, escHtml(val)) : prdEmpty(label);
const prdChips = (label, arr, cls) => {
    const chips = (arr || []).filter(Boolean).map(v => `<span class="tag ${cls}">${escHtml(v)}</span>`).join('');
    return chips ? `<div class="prd-line"><span class="prd-k">${label}</span><span class="prd-chips">${chips}</span></div>` : prdEmpty(label);
};

const ROW_FIELDS = [
    { key: 'biblio',  label: '서지',     get: p => {
        const j = [];
        if (p.source) j.push(escHtml(p.source));
        if (p.volume) j.push(escHtml(p.volume) + (p.issue ? `(${escHtml(p.issue)})` : ''));
        if (p.pages)  j.push(escHtml(p.pages));
        const out = (j.length ? prdLine('학술지', j.join(', ')) : '') + (p.doi ? prdLine('DOI', escHtml(p.doi)) : '');
        return out || prdEmpty('서지');
    }},
    { key: 'keywords', label: '키워드',     get: p => prdChips('키워드', splitMulti(p.analysis?.keywords), 'tag-normal') },
    { key: 'needs',    label: '연구필요성', get: p => prdText('연구필요성', p.analysis?.needs) },
    { key: 'theory',   label: '이론',       get: p => prdText('이론', p.analysis?.theory) },
    { key: 'subjects', label: '연구대상',   get: p => prdText('연구대상', p.analysis?.subjects) },
    { key: 'variables', label: '변인',      get: p => {
        // 간단 태그(paper.variables) + 정밀분석 변수명 둘 다 모아서(중복 제거)
        const a = p.analysis?.variables || {};
        const fromAnalysis = VAR_ROLES.flatMap(([role]) => (a[role] || []).map(v => v && v.name).filter(Boolean));
        const seen = new Set();
        const all = [...(p.variables || []), ...fromAnalysis].filter(v => {
            const k = String(v).toLowerCase();
            if (!v || seen.has(k)) return false;
            seen.add(k); return true;
        });
        return prdChips('변인', all, 'tag-variable');
    }},
    { key: 'varDefs',  label: '변인의 정의', get: p => {
        const v = p.analysis?.variables || {};
        const roles = VAR_ROLES.map(([role, label]) => {
            const items = (v[role] || []).filter(it => it && (it.name || it.factor || it.scale));
            if (!items.length) return '';
            const lis = items.map(it => {
                const extra = [
                    it.factor && '요인 ' + it.factor, it.scale && '척도 ' + it.scale,
                    it.reliability && '신뢰도 ' + it.reliability, it.validity && '타당도 ' + it.validity,
                ].filter(Boolean).map(escHtml).join(', ');
                return `<div class="pvd-item"><b>${escHtml(it.name || '(이름 없음)')}</b>${extra ? ' — ' + extra : ''}</div>`;
            }).join('');
            return `<div class="pvd-role"><span class="pvd-role-name">${label}</span>${lis}</div>`;
        }).filter(Boolean).join('');
        return roles ? `<div class="prd-line prd-line-block"><span class="prd-k">변인의 정의</span><div class="prd-vardefs">${roles}</div></div>` : prdEmpty('변인의 정의');
    }},
    { key: 'method',   label: '연구방법',   get: p => {
        const a = p.analysis || {};
        const vals = [p.methods, a.method, a.program].filter(v => v && String(v).trim()).map(escHtml);
        return vals.length ? prdLine('연구방법', vals.join(' · ')) : prdEmpty('연구방법');
    }},
    { key: 'results',     label: '분석결과', get: p => prdText('분석결과', p.analysis?.results) },
    { key: 'findings',    label: '주요발견', get: p => prdText('주요발견', p.findings) },
    { key: 'implications', label: '시사점',  get: p => prdText('시사점', p.analysis?.implications) },
    { key: 'limitations', label: '한계점',   get: p => prdText('한계점', p.analysis?.limitations) },
    { key: 'abstract',    label: '초록',     get: p => prdText('초록', p.abstract) },
    { key: 'myNote',      label: '내 메모',  get: p => prdText('내 메모', p.myNote) },
    { key: 'tags',        label: '태그',     get: p => prdChips('태그', p.tags, 'tag-normal') },
];
const ROW_FIELDS_DEFAULT = ['keywords', 'needs', 'variables', 'varDefs', 'method'];

function loadRowFields() {
    try {
        const arr = JSON.parse(localStorage.getItem('rowFields') || 'null');
        if (Array.isArray(arr)) return arr;
    } catch {}
    return [...ROW_FIELDS_DEFAULT];
}
function saveRowFields() {
    try { localStorage.setItem('rowFields', JSON.stringify(state.rowFields)); } catch {}
}
function ensureRowFields() {
    if (state.rowFields === null) state.rowFields = loadRowFields();
    return state.rowFields;
}

// 펼친 상세 — 읽기 전용 요약. 보일 항목은 「표시」에서 고름(정밀분석 편집은 '수정' 모달에서)
function paperRowDetailHTML(paper) {
    const sel = ensureRowFields();
    const rows = ROW_FIELDS.filter(f => sel.includes(f.key)).map(f => f.get(paper)).filter(Boolean);
    const bodyHTML = rows.join('')
        || '<div class="prd-line muted">위 「표시」에서 펼침에 보일 항목을 골라주세요.</div>';
    return `
        <div class="paper-row-detail">
            <div class="prd-body">${bodyHTML}</div>
            <div class="prd-actions">
                <button type="button" class="btn-primary prd-desk" data-id="${paper.id}" title="책상 탭에서 PDF·메모 함께 펼치기">${icon('book-open')} 책상에서 펼치기</button>
                <button type="button" class="btn-secondary prd-view" data-id="${paper.id}" title="논문 정리 내용 요약 보기">${icon('eye')} 요약보기</button>
                ${paper.pdfData ? `<button type="button" class="btn-secondary prd-pdf" data-id="${paper.id}" title="저장된 PDF 열기">${icon('paperclip')} PDF 열기</button>` : ''}
                <button type="button" class="btn-secondary prd-qc" data-id="${paper.id}" title="${paper.inQuickCite ? '빠른인용 목록에서 제거' : '빠른인용 목록에 추가 — 사이드바 번개 버튼에서 바로 인용 가능'}">${icon('zap')} ${paper.inQuickCite ? '빠른인용 해제' : '빠른인용'}</button>
                <button type="button" class="btn-delete prd-del" data-id="${paper.id}" title="이 논문 삭제">${icon('trash')} 삭제</button>
            </div>
        </div>`;
}

// 정렬/묶기 컨트롤 바인딩
function bindPaperControls(container) {
    container.querySelectorAll('.pc-sort').forEach(btn => {
        btn.addEventListener('click', () => { state.paperSort = btn.dataset.sort; renderContent(); });
    });
    container.querySelectorAll('.pc-group').forEach(btn => {
        btn.addEventListener('click', () => { state.groupBy = btn.dataset.group; renderContent(); });
    });
    // 드롭다운 열림/닫힘 기억(항목 토글로 다시 그려도 유지)
    const dd = container.querySelector('.pc-fields-dd');
    if (dd) dd.addEventListener('toggle', () => { state.fieldsOpen = dd.open; });
    // 표시 항목 토글(여러 개 선택 가능) — 선택은 localStorage에 기억
    container.querySelectorAll('.pc-field').forEach(btn => {
        btn.addEventListener('click', () => {
            const k = btn.dataset.field;
            const arr = ensureRowFields();
            const i = arr.indexOf(k);
            if (i >= 0) arr.splice(i, 1); else arr.push(k);
            saveRowFields();
            renderContent();
        });
    });
}

// ── 논문 선택 삭제 모드 ───────────────────────────────────────
function bindPaperSelectMode(container) {
    const toggleBtn = container.querySelector('#btn-paper-select-mode');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            state.paperSelectMode = !state.paperSelectMode;
            state.paperSelectedIds = new Set();
            renderContent();
        });
    }

    const cancelBtn = container.querySelector('#btn-sel-cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
        state.paperSelectMode = false;
        state.paperSelectedIds = new Set();
        renderContent();
    });

    const selAllBtn = container.querySelector('#btn-sel-all');
    if (selAllBtn) selAllBtn.addEventListener('click', () => {
        state.paperSelectedIds = new Set(state.papers.map(p => p.id));
        renderContent();
    });

    const selNoneBtn = container.querySelector('#btn-sel-none');
    if (selNoneBtn) selNoneBtn.addEventListener('click', () => {
        state.paperSelectedIds = new Set();
        renderContent();
    });

    // 체크박스 클릭
    container.querySelectorAll('.pr-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            if (!state.paperSelectedIds) state.paperSelectedIds = new Set();
            if (cb.checked) state.paperSelectedIds.add(cb.dataset.id);
            else state.paperSelectedIds.delete(cb.dataset.id);
            // 삭제 버튼 카운트만 갱신
            const delBtn = container.querySelector('#btn-sel-del');
            if (delBtn) delBtn.textContent = `선택 삭제 (${state.paperSelectedIds.size}편)`;
            // 행 선택 스타일 갱신
            const wrap = cb.closest('.paper-row-wrap');
            if (wrap) wrap.classList.toggle('pr-selected', cb.checked);
        });
    });

    const delBtn = container.querySelector('#btn-sel-del');
    if (delBtn) delBtn.addEventListener('click', async () => {
        const ids = [...(state.paperSelectedIds || [])];
        if (ids.length === 0) { showToast('선택된 논문이 없어요', 'info'); return; }
        if (!confirm(`선택한 ${ids.length}편을 삭제할까요?\n이 작업은 되돌릴 수 없어요.`)) return;
        for (const id of ids) await dbDelete(STORE_PAPERS, id);
        state.paperSelectMode = false;
        state.paperSelectedIds = new Set();
        await loadData();
        renderContent();
        showToast(`${ids.length}편이 삭제되었습니다`, 'success');
    });
}

// 행 클릭(펼침/접힘) + 펼친 행의 동작 버튼 + (옵션)끌어다 놓기 바인딩
let dragSrcId = null;        // 끌고 있는 논문 id
let suppressRowClick = false; // 드래그 직후 클릭(펼침) 막기

function bindRows(container, enableDrag = false) {
    container.querySelectorAll('.paper-row').forEach(row => {
        row.addEventListener('click', () => {
            if (suppressRowClick) return;   // 방금 끌어다 놓은 경우 펼침 무시
            const id = row.dataset.id;
            state.expandedId = (state.expandedId === id) ? null : id;   // 한 번에 하나만
            renderContent();
        });
    });
    if (enableDrag) bindRowDrag(container);
    container.querySelectorAll('.prd-desk').forEach(b =>
        b.addEventListener('click', e => { e.stopPropagation(); openDesk(b.dataset.id); }));
    container.querySelectorAll('.prd-view').forEach(b =>
        b.addEventListener('click', e => { e.stopPropagation(); openForm(b.dataset.id, 'view'); }));
    container.querySelectorAll('.prd-pdf').forEach(b =>
        b.addEventListener('click', e => {
            e.stopPropagation();
            const p = state.papers.find(x => x.id === b.dataset.id);
            if (p) openPdf(p);
        }));
    container.querySelectorAll('.prd-del').forEach(b =>
        b.addEventListener('click', e => { e.stopPropagation(); deletePaper(b.dataset.id); }));
    container.querySelectorAll('.prd-qc').forEach(b =>
        b.addEventListener('click', async e => {
            e.stopPropagation();
            const p = state.papers.find(x => x.id === b.dataset.id);
            if (!p) return;
            p.inQuickCite = !p.inQuickCite;
            await dbPut(STORE_PAPERS, p);
            renderContent();
        }));

    // 읽기 상태 배지 클릭 → 순환 변경 (안읽음→읽는중→읽음→안읽음)
    container.querySelectorAll('.pr-status-badge').forEach(badge => {
        badge.addEventListener('click', async e => {
            e.stopPropagation();
            const wrap = badge.closest('.paper-row-wrap');
            const p = state.papers.find(x => x.id === wrap?.dataset.id);
            if (!p) return;
            const order = ['unread', 'reading', 'read'];
            const cur = order.indexOf(p.readStatus || 'unread');
            p.readStatus = order[(cur + 1) % order.length];
            await dbPut(STORE_PAPERS, p);
            renderContent();
        });
    });
}

// 끌어다 놓기(순서 바꾸기) — 평면 목록에서만
function bindRowDrag(container) {
    container.querySelectorAll('.paper-row[draggable="true"]').forEach(row => {
        row.addEventListener('dragstart', e => {
            dragSrcId = row.dataset.id;
            suppressRowClick = true;
            row.closest('.paper-row-wrap')?.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', dragSrcId); } catch (_) {}
        });
        row.addEventListener('dragend', () => {
            container.querySelectorAll('.paper-row-wrap')
                .forEach(w => w.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom'));
            dragSrcId = null;
            // 드래그 직후 발생할 수 있는 click 한 번만 무시
            setTimeout(() => { suppressRowClick = false; }, 0);
        });
    });

    container.querySelectorAll('.paper-row-wrap').forEach(wrap => {
        wrap.addEventListener('dragover', e => {
            if (!dragSrcId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const rect = wrap.getBoundingClientRect();
            const after = e.clientY > rect.top + rect.height / 2;
            wrap.classList.toggle('drag-over-bottom', after);
            wrap.classList.toggle('drag-over-top', !after);
        });
        wrap.addEventListener('dragleave', () => {
            wrap.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        wrap.addEventListener('drop', e => {
            e.preventDefault();
            const targetId = wrap.dataset.id;
            if (!dragSrcId || dragSrcId === targetId) return;
            const rect = wrap.getBoundingClientRect();
            const after = e.clientY > rect.top + rect.height / 2;
            reorderPapers(dragSrcId, targetId, after);
        });
    });
}

// 끌어다 놓은 결과를 sortOrder로 저장하고 '내 순서'로 전환
async function reorderPapers(srcId, targetId, after) {
    const ordered = sortPapers(state.papers);       // 지금 보이는 순서
    const srcIdx = ordered.findIndex(p => p.id === srcId);
    if (srcIdx < 0) return;
    const [moved] = ordered.splice(srcIdx, 1);
    let tIdx = ordered.findIndex(p => p.id === targetId);
    if (tIdx < 0) return;
    if (after) tIdx += 1;
    ordered.splice(tIdx, 0, moved);

    for (let i = 0; i < ordered.length; i++) {       // 새 순서 번호 부여 + 저장
        ordered[i].sortOrder = i;
        await dbPut(STORE_PAPERS, ordered[i]);
    }
    state.paperSort = 'manual';                      // 끌면 '내 순서'로 전환
    renderContent();
    showToast('논문 순서를 저장했어요', 'success');
}

// ── 검색 결과 ──────────────────────────────────────────────
function renderSearchResults(q, container) {
    const matches = state.papers.filter(p => paperMatchesQuery(p, q));

    if (matches.length === 0) {
        container.innerHTML = `
            <div class="search-results-info">
                "<strong>${escHtml(q)}</strong>" 검색 결과 없음
            </div>
            <div class="empty-state">
                <div class="empty-icon">${icon('search', 44)}</div>
                <h3>결과가 없습니다</h3>
                <p>다른 키워드로 검색해보세요</p>
            </div>`;
        return;
    }

    container.innerHTML = `
        <div class="search-results-info">
            "<strong>${escHtml(q)}</strong>" 검색 결과 ${matches.length}편
        </div>
        <div class="paper-list">${paperRowsHTML(sortPapers(matches))}</div>`;

    bindRows(container);
}

function paperMatchesQuery(paper, q) {
    const a = paper.analysis || {};
    // 키워드만 모드: 키워드 필드 + 태그에서만 검색
    if (state.searchMode === 'keyword') {
        return [a.keywords, ...(paper.tags || [])]
            .some(f => f && String(f).toLowerCase().includes(q));
    }
    const analysisVals = Object.values(ANALYSIS_TEXT_FIELDS).map(k => a[k]);
    const varVals = VAR_ROLES.flatMap(([role]) =>
        (a.variables?.[role] || []).flatMap(v => Object.values(v)));
    return [
        paper.title, paper.authors, paper.abstract,
        paper.methods, paper.findings, paper.myNote, paper.source,
        ...(paper.variables || []), ...(paper.tags || []),
        ...analysisVals, ...varVals,
    ].some(f => f && String(f).toLowerCase().includes(q));
}

// ── 참고문헌 뷰 ────────────────────────────────────────────
function renderReferences(container) {
    _apaSuffix = apaYearSuffixes(state.papers);   // 목록을 그릴 때마다 a/b 를 다시 계산
    if (state.papers.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">${icon('clipboard', 44)}</div>
                <h3>저장된 논문이 없습니다</h3>
                <p>논문을 추가하면 여기서 APA 참고문헌 목록을 볼 수 있어요</p>
            </div>`;
        return;
    }

    const sorted = [...state.papers].sort((a, b) => {
        const nameA = (a.authors || '').split(/[,·]/)[0].trim();
        const nameB = (b.authors || '').split(/[,·]/)[0].trim();
        return nameA.localeCompare(nameB, 'ko');
    });

    const selectedCount = sorted.filter(p => p.inReferences).length;

    container.innerHTML = `
        <div class="section-header">
            <span class="section-title">참고문헌 목록 (APA 7판)</span>
            <span class="ref-count-badge">${state.papers.length}편 저장됨 · <strong>${selectedCount}편 선택됨</strong></span>
        </div>
        <div class="ref-toolbar">
            <button class="btn-ref-action" id="btn-copy-all-refs">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:5px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>선택 항목 복사
            </button>
            <button class="btn-ref-action" id="btn-export-refs">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:5px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>파일로 저장
            </button>
            <button class="btn-ref-select-all" id="btn-select-all">모두 선택</button>
            <button class="btn-ref-select-all" id="btn-deselect-all">모두 해제</button>
            <span class="ref-hint">체크한 논문만 복사/저장됩니다</span>
        </div>
        <div class="ref-list">
            ${sorted.map(p => `
                <div class="ref-item ${p.inReferences ? 'ref-selected' : ''}" data-id="${p.id}">
                    <label class="ref-checkbox-label">
                        <input type="checkbox" class="ref-checkbox" data-id="${p.id}"
                            ${p.inReferences ? 'checked' : ''}>
                    </label>
                    <div class="ref-text">${formatAPAParts(p).html}</div>
                    <div class="ref-item-actions">
                        <button class="btn-ref-copy" data-id="${p.id}">복사</button>
                        <button class="btn-ref-intext" data-id="${p.id}">(저자, 연도)</button>
                    </div>
                </div>`).join('')}
        </div>`;

    // 체크박스 상태 저장
    container.querySelectorAll('.ref-checkbox').forEach(cb => {
        cb.addEventListener('change', async () => {
            const paper = state.papers.find(p => p.id === cb.dataset.id);
            if (!paper) return;
            paper.inReferences = cb.checked;
            await dbPut(STORE_PAPERS, paper);
            // 선택 수 업데이트
            const selected = state.papers.filter(p => p.inReferences).length;
            container.querySelector('.ref-count-badge').innerHTML =
                `${state.papers.length}편 저장됨 · <strong>${selected}편 선택됨</strong>`;
            // 행 스타일 업데이트
            const row = cb.closest('.ref-item');
            row.classList.toggle('ref-selected', cb.checked);
        });
    });

    // 모두 선택 / 해제
    document.getElementById('btn-select-all').addEventListener('click', async () => {
        for (const p of state.papers) {
            p.inReferences = true;
            await dbPut(STORE_PAPERS, p);
        }
        renderReferences(container);
    });
    document.getElementById('btn-deselect-all').addEventListener('click', async () => {
        for (const p of state.papers) {
            p.inReferences = false;
            await dbPut(STORE_PAPERS, p);
        }
        renderReferences(container);
    });

    // 선택된 논문만 복사/저장
    const getSelectedText = () => {
        return sorted
            .filter(p => p.inReferences)
            .map(p => formatAPA(p))
            .join('\n\n');
    };

    document.getElementById('btn-copy-all-refs').addEventListener('click', async () => {
        const picked = sorted.filter(p => p.inReferences);
        if (!picked.length) { showToast('선택된 논문이 없습니다. 포함할 논문을 체크하세요.', 'error'); return; }
        const parts = picked.map(formatAPAParts);
        const text = parts.map(p => p.text).join('\n\n');
        // 기울임을 살리려면 HTML도 같이 실어야 한다. 내어쓰기(hanging indent)까지 적용.
        const html = `<div>${parts.map(p =>
            `<p style="margin:0 0 10px;text-indent:-2em;padding-left:2em">${p.html}</p>`).join('')}</div>`;
        const ok = await copyRich(html, text);
        showToast(ok ? `${picked.length}편 복사됐습니다 — 한글/워드에 붙여넣으면 기울임까지 들어갑니다.` : '복사 실패', ok ? 'success' : 'error');
    });

    document.getElementById('btn-export-refs').addEventListener('click', () => {
        const text = getSelectedText();
        if (!text) { showToast('선택된 논문이 없습니다. 포함할 논문을 체크하세요.', 'error'); return; }
        download(text, '참고문헌목록.txt', 'text/plain;charset=utf-8');
        showToast('참고문헌목록.txt 파일로 저장됐습니다', 'success');
    });

    container.querySelectorAll('.btn-ref-copy').forEach(btn => {
        btn.addEventListener('click', async () => {
            const paper = state.papers.find(p => p.id === btn.dataset.id);
            if (!paper) return;
            const { text, html } = formatAPAParts(paper);
            const ok = await copyRich(html, text);
            showToast(ok ? '복사됐습니다 (기울임 포함)' : '복사 실패', ok ? 'success' : 'error');
        });
    });

    container.querySelectorAll('.btn-ref-intext').forEach(btn => {
        btn.addEventListener('click', async () => {
            const paper = state.papers.find(p => p.id === btn.dataset.id);
            if (!paper) return;
            const citation = formatInText(paper);
            const ok = await copyToClipboard(citation);
            showToast(ok ? `${citation} 복사됐습니다` : '복사 실패', ok ? 'success' : 'error');
        });
    });
}

// ══════════════════════════════════════════════════════════════
// APA 7판 참고문헌 — 저자 이름 정리 + 이탤릭(기울임)
// 예전엔 입력한 글자를 그대로 이어붙이기만 해서 영문 논문 형식이 틀렸다.
//   before: John Smith, Mary Jones (2020). Title. Journal, 12(3), 45-67.
//   after : Smith, J., & Jones, M. (2020). Title. Journal, 12(3), 45-67.  (학술지명·권 기울임)
// ══════════════════════════════════════════════════════════════

const isKoreanName = s => /[가-힣]/.test(s);

// 저자 문자열을 사람 단위로 쪼갠다.
// "Smith, J., Jones, M." 와 "John Smith, Mary Jones" 를 둘 다 다룬다.
function splitAuthors(raw) {
    let s = String(raw || '').trim();
    if (!s) return [];
    s = s.replace(/\s+and\s+/gi, ' & ');
    if (s.includes(';')) return s.split(';').map(x => x.trim()).filter(Boolean);

    // 한국어 이름 — 쉼표·가운뎃점으로 나누되, "반두라, A." 처럼 이니셜만 있는 조각은
    // 앞 이름에 도로 붙인다(외국 저자를 한글로 옮겨 적은 경우).
    if (isKoreanName(s)) {
        const ko = s.split(/[,·&]+/).map(x => x.trim()).filter(Boolean);
        const merged = [];
        for (let i = 0; i < ko.length; i++) {
            const next = ko[i + 1];
            if (next && /^(?:[A-Za-z]\.?\s*){1,3}$/.test(next)) { merged.push(`${ko[i]}, ${next}`); i++; }
            else merged.push(ko[i]);
        }
        return merged;
    }

    // 영문: 쉼표로 자른 뒤, "이니셜만 있는 조각"은 앞 조각(성)에 도로 붙인다
    const parts = s.split(/[,&]/).map(x => x.trim()).filter(Boolean);
    const out = [];
    for (let i = 0; i < parts.length; i++) {
        const next = parts[i + 1];
        if (next && /^(?:[A-Z]\.?\s*){1,3}$/.test(next)) {
            out.push(`${parts[i]}, ${next}`);
            i++;
        } else {
            out.push(parts[i]);
        }
    }
    return out;
}

// 한 사람을 APA 형식(Last, F. M.)으로 바꾼다. 한국어 이름은 그대로 둔다.
function apaAuthorName(name) {
    const n = String(name || '').trim().replace(/\s+/g, ' ');
    if (!n) return '';
    if (isKoreanName(n)) return n;

    const initials = arr => arr.map(w => w.replace(/[^A-Za-z]/g, '').charAt(0))
        .filter(Boolean).map(c => c.toUpperCase() + '.').join(' ');

    if (n.includes(',')) {
        // 이미 "Smith, J. M." 또는 "Smith, John" 형태
        const [last, rest = ''] = n.split(',').map(x => x.trim());
        const given = rest.split(/\s+/).filter(Boolean);
        return given.length ? `${last}, ${initials(given)}` : last;
    }
    // "John Michael Smith" → "Smith, J. M."
    const words = n.split(' ').filter(Boolean);
    if (words.length === 1) return words[0];
    const last = words.pop();
    return `${last}, ${initials(words)}`;
}

// 저자 목록을 APA 인원수 규칙에 맞춰 잇는다
function apaAuthorList(raw) {
    const people = splitAuthors(raw).map(apaAuthorName).filter(Boolean);
    if (!people.length) return '';
    const korean = isKoreanName(people[0]);
    if (people.length === 1) return people[0];

    // 21명 이상: 앞 19명 … 마지막 1명 (APA 7)
    let list = people;
    let ellipsis = false;
    if (people.length > 20) {
        list = people.slice(0, 19).concat([people[people.length - 1]]);
        ellipsis = true;
    }
    const head = list.slice(0, -1).join(', ');
    const tail = list[list.length - 1];
    if (ellipsis) return `${head}, ... ${tail}`;
    // 한국어는 & 대신 쉼표로 잇는 것이 일반적
    return korean ? `${head}, ${tail}` : `${head}, & ${tail}`;
}

// APA: 같은 저자가 같은 해에 낸 문헌이 둘 이상이면 연도 뒤에 a·b·c 를 붙인다.
// 본문 인용 (홍길동, 2020a) 과 참고문헌이 같은 글자를 써야 하므로 목록 전체를 보고 한 번에 정한다.
// 반환: { 논문id: 'a' | 'b' … }  — 겹치지 않는 문헌은 아예 들어가지 않는다.
let _apaSuffix = {};   // 논문id → 'a'|'b'… (loadData·참고문헌 그릴 때 갱신)

function apaYearSuffixes(papers) {
    const groups = {};
    (papers || []).forEach(p => {
        if (!p.year) return;
        const first = splitAuthors(p.authors)[0] || '';
        const key = `${apaAuthorName(first)}|${p.year}`;
        (groups[key] = groups[key] || []).push(p);
    });
    const out = {};
    Object.values(groups).forEach(list => {
        if (list.length < 2) return;
        // 제목 순으로 정렬해 a, b, c … (APA 규칙)
        list.slice().sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ko'))
            .forEach((p, i) => { out[p.id] = String.fromCharCode(97 + i); });
    });
    return out;
}

// 자료 유형에 따라 폼에서 필요한 칸만 보여준다. (.apa-x = 기본 숨김, .apa-<유형> = 그 유형에서 표시)
const APA_SOURCE_LABEL = {
    journal: '학술지명',
    thesis:  '수여 기관 <small style="color:var(--text-muted)">— 예: 단국대학교 대학원</small>',
    book:    '총서명 <small style="color:var(--text-muted)">— 없으면 비움</small>',
    chapter: '총서명 <small style="color:var(--text-muted)">— 없으면 비움</small>',
    web:     '사이트명 <small style="color:var(--text-muted)">— 없으면 비움</small>',
    translation: '총서명 <small style="color:var(--text-muted)">— 없으면 비움</small>',
};
function applyItemTypeUI(type) {
    document.querySelectorAll('.apa-x').forEach(el => {
        el.style.display = el.classList.contains('apa-' + type) ? '' : 'none';
    });
    const lbl = document.getElementById('lbl-source');
    if (lbl) lbl.innerHTML = APA_SOURCE_LABEL[type] || '학술지명';
    // 학술지 전용 칸(권·호)은 학술지·챕터에서만 의미가 있다
    ['f-volume', 'f-issue'].forEach(id => {
        const g = document.getElementById(id)?.closest('.form-group');
        if (g) g.style.display = (type === 'journal') ? '' : 'none';
    });
}

// 자료 유형 판별 — 옛 논문에는 itemType이 없으므로 내용으로 추정한다.
function apaItemType(paper) {
    if (paper.itemType) return paper.itemType;
    const hint = `${paper.analysis?.paperType || ''} ${paper.source || ''}`;
    if (/학위논문|석사|박사|dissertation|thesis/i.test(hint)) return 'thesis';
    return 'journal';
}

// 영문 제목을 APA 문장식(첫 글자만 대문자)으로 바꾼다.
// APA 7: 논문·단행본·학위논문 "제목"은 문장식, 학술지명은 단어마다 대문자(그대로 둔다).
// 저장된 제목은 건드리지 않고 참고문헌을 만들 때만 이 함수를 통과시킨다
// → 원본이 보존되므로 규칙이 틀리면 규칙만 고치면 전체가 바로잡힌다.
//
// 보존 규칙: ① 전부 대문자인 낱말(APA·PTSD) ② 대문자가 섞인 낱말(iPhone)
//           ③ 아래 고유명사 목록 ④ 콜론·마침표·물음표 뒤 첫 낱말
// 사람 이름(Bandura 등)은 기계가 알 수 없다 → 그때는 제목 칸을 직접 고치면 된다.
const APA_PROPER = new Set([
    'korea','korean','china','chinese','japan','japanese','taiwan','vietnam',
    'america','american','europe','european','asia','asian','africa','african',
    'australia','australian','britain','british','england','english','france','french',
    'germany','german','spain','spanish','italy','italian','russia','russian',
    'india','indian','canada','canadian','mexico','brazil','netherlands','sweden','norway','finland',
    'seoul','busan','tokyo','beijing','shanghai','london','paris','berlin','york','washington',
    'january','february','march','april','may','june','july',
    'august','september','october','november','december',
    'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
    'covid','covid-19','hiv','aids','oecd','unesco','who','un',
    'facebook','instagram','twitter','youtube','google','tiktok','kakaotalk',
    'christian','christianity','buddhist','buddhism','muslim','islam','confucian',
]);

function toSentenceCase(str) {
    const s = String(str || '').trim();
    if (!s || /[가-힣]/.test(s)) return s;   // 한글 제목은 그대로

    let capNext = true;
    return s.split(/(\s+)/).map(tok => {
        if (/^\s+$/.test(tok)) return tok;

        const bare = tok.replace(/[^A-Za-z0-9-]/g, '');
        const letters = tok.replace(/[^A-Za-z]/g, '');
        const isAcronym = letters.length > 1 && letters === letters.toUpperCase();  // APA, PTSD
        const isMixed   = /[a-z][A-Z]/.test(tok);                                    // iPhone
        const isProper  = APA_PROPER.has(bare.toLowerCase());                        // Korea

        let out;
        if (isAcronym || isMixed) out = tok;
        else if (isProper)        out = tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
        else if (capNext)         out = tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
        else                      out = tok.toLowerCase();

        capNext = /[:.?!]$/.test(tok);   // 콜론·마침표 뒤는 다시 대문자
        return out;
    }).join('');
}

// 편저자 표기 — 영문 "A. Kim & B. Lee (Eds.)", 국문 "김철수, 이영희 (편)"
function apaEditors(raw) {
    const people = splitAuthors(raw);
    if (!people.length) return '';
    const korean = isKoreanName(people[0]);
    if (korean) return `${people.join(', ')} (편)`;
    // 편저자는 이름이 성 앞에 온다: "J. Smith"
    const flip = n => {
        const a = apaAuthorName(n);
        const [last, init = ''] = a.split(',').map(x => x.trim());
        return init ? `${init} ${last}` : last;
    };
    const list = people.map(flip);
    const joined = list.length === 1 ? list[0]
        : `${list.slice(0, -1).join(', ')}${list.length > 2 ? ',' : ''} & ${list[list.length - 1]}`;
    return `${joined} (${list.length > 1 ? 'Eds.' : 'Ed.'})`;
}

// 참고문헌 한 줄을 만든다. { text, html } 둘 다 반환 —
// html 쪽에만 <i>가 들어가고, 이걸 클립보드에 같이 실어야 한글·워드에서 기울임이 살아난다.
function formatAPAParts(paper, suffix) {
    const sfx = suffix || _apaSuffix[paper.id] || '';
    const authors   = apaAuthorList(paper.authors) || '저자 미상';
    const year      = paper.year ? `(${paper.year}${sfx})` : `(연도 미상)`;
    // APA: 논문·책·학위논문 제목은 문장식. 저장값은 안 바꾸고 여기서만 변환한다.
    const title     = toSentenceCase((paper.title || '제목 없음').trim().replace(/\.$/, ''));
    const source    = (paper.source || '').trim();
    const volume    = (paper.volume || '').trim();
    const issue     = (paper.issue || '').trim();
    const pages     = (paper.pages || '').trim().replace(/[-–—~]/g, '–');   // APA는 en dash
    const publisher = (paper.publisher || '').trim();
    const bookTitle = toSentenceCase((paper.bookTitle || '').trim());
    const edition   = (paper.edition || '').trim();
    const url       = (paper.url || '').trim();
    const translator= (paper.translator || '').trim();
    const origYear  = (paper.originalYear || '').trim();
    const doiRaw    = (paper.doi || '').trim();
    const doi = doiRaw ? `https://doi.org/${doiRaw.replace(/^https?:\/\/doi\.org\//i, '')}` : '';

    const type   = apaItemType(paper);
    const korean = /[가-힣]/.test(`${authors}${title}`);
    const IT = t => `<i style="font-style:italic">${t}</i>`;   // 기울임
    const E  = escHtml;

    let text = `${authors} ${year}. `;
    let html = `${E(authors)} ${E(year)}. `;

    if (type === 'thesis') {
        // 저자 (연도). 제목(기울임) [석사학위논문, 기관].
        const hint = `${paper.analysis?.paperType || ''} ${source}`;
        const degree = /박사|doctor/i.test(hint) ? '박사학위논문' : '석사학위논문';
        // "○○대학교 대학원 석사학위논문"이 통째로 들어있으면 학위 표기는 떼고 기관만 남긴다
        const inst = source.replace(/\s*(석사|박사)?\s*학위\s*논문\s*/g, '').trim();
        text += `${title} [${degree}${inst ? `, ${inst}` : ''}].`;
        html += `${IT(E(title))} [${degree}${inst ? `, ${E(inst)}` : ''}].`;

    } else if (type === 'book') {
        // 저자 (연도). 제목(기울임) (판). 출판사.
        text += `${title}`;
        html += `${IT(E(title))}`;
        if (edition) { text += ` (${edition})`; html += ` (${E(edition)})`; }
        text += '.'; html += '.';
        if (publisher) { text += ` ${publisher}.`; html += ` ${E(publisher)}.`; }

    } else if (type === 'chapter') {
        // 저자 (연도). 장 제목. 편저자 (편), 책제목(기울임) (판, pp. 쪽). 출판사.
        const eds = apaEditors(paper.editors);
        const inWord = korean ? '' : 'In ';
        text += `${title}. `;
        html += `${E(title)}. `;
        if (eds) { text += `${inWord}${eds}, `; html += `${inWord}${E(eds)}, `; }
        text += `${bookTitle || source}`;
        html += `${IT(E(bookTitle || source))}`;
        const paren = [edition, pages ? `pp. ${pages}` : ''].filter(Boolean).join(', ');
        if (paren) { text += ` (${paren})`; html += ` (${E(paren)})`; }
        text += '.'; html += '.';
        if (publisher) { text += ` ${publisher}.`; html += ` ${E(publisher)}.`; }

    } else if (type === 'translation') {
        // APA 7 번역서: 원저자 (번역출판연도). 제목(기울임) (역자 역). 출판사. (원저 원년 출판)
        // 본문 인용은 (원저자, 원년/번역년) — formatInText 가 처리한다.
        text += `${title}`;
        html += `${IT(E(title))}`;
        if (edition) { text += ` (${edition})`; html += ` (${E(edition)})`; }
        if (translator) {
            const t = korean ? `${translator} 역` : `${translator}, Trans.`;
            text += ` (${t})`; html += ` (${E(t)})`;
        }
        text += '.'; html += '.';
        if (publisher) { text += ` ${publisher}.`; html += ` ${E(publisher)}.`; }
        if (origYear) {
            const o = korean ? `(원저 ${origYear} 출판)` : `(Original work published ${origYear})`;
            text += ` ${o}`; html += ` ${E(o)}`;
        }

    } else if (type === 'web') {
        // 저자/기관 (연도). 제목(기울임). 발행처. URL
        text += `${title}.`;
        html += `${IT(E(title))}.`;
        if (publisher) { text += ` ${publisher}.`; html += ` ${E(publisher)}.`; }

    } else {
        // 학술지 논문: 저자 (연도). 제목. 학술지명(기울임), 권(기울임)(호), 쪽.
        text += `${title}.`;
        html += `${E(title)}.`;
        if (source) {
            text += ` ${source}`;
            html += ` ${IT(E(source))}`;
            if (volume) {
                text += `, ${volume}${issue ? `(${issue})` : ''}`;
                html += `, ${IT(E(volume))}${issue ? `(${E(issue)})` : ''}`;
            }
            if (pages) { text += `, ${pages}`; html += `, ${E(pages)}`; }
            text += '.'; html += '.';
        }
    }

    // DOI가 있으면 DOI를, 없으면 URL을 끝에 붙인다 (APA 7: 둘 다 쓰지 않는다)
    const tail = doi || url;
    if (tail) { text += ` ${tail}`; html += ` ${E(tail)}`; }
    return { text, html };
}

// 서식(기울임)까지 살려서 복사한다. 실패하면 글자만이라도 복사.
// 서식(기울임)까지 살려서 복사한다.
// ① 화면에 안 보이는 영역에 HTML을 그려 선택 → execCommand('copy')
//    구식이지만 file:// 에서도 확실히 동작하고, 클립보드에 HTML과 글자를 함께 싣는다.
// ② 실패하면 최신 방식(ClipboardItem) → ③ 그것도 안 되면 글자만.
async function copyRich(html, text) {
    // ① 선택 영역 복사 (가장 호환성이 좋음 — 클릭 핸들러 안에서 바로 호출해야 함)
    try {
        const holder = document.createElement('div');
        holder.setAttribute('contenteditable', 'true');
        holder.innerHTML = html;
        // 화면 밖으로 밀되 display:none·opacity:0 은 쓰지 않는다(선택이 안 잡힐 수 있음)
        holder.style.cssText = 'position:fixed;left:-9999px;top:0;white-space:pre-wrap';
        document.body.appendChild(holder);

        const sel = window.getSelection();
        const saved = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        const range = document.createRange();
        range.selectNodeContents(holder);
        sel.removeAllRanges();
        sel.addRange(range);

        const ok = document.execCommand('copy');
        sel.removeAllRanges();
        if (saved) sel.addRange(saved);
        holder.remove();
        if (ok) { pushDebug('info', '서식 복사 성공 (방식: 선택영역)'); return true; }
        pushDebug('warn', '서식 복사(execCommand) 거부됨 — 다음 방식 시도');
    } catch (err) {
        pushDebug('warn', `서식 복사(execCommand) 실패: ${err.message}`);
    }

    // ② 최신 클립보드 방식
    try {
        if (navigator.clipboard?.write && window.ClipboardItem) {
            await navigator.clipboard.write([new ClipboardItem({
                'text/html':  new Blob([html], { type: 'text/html' }),
                'text/plain': new Blob([text], { type: 'text/plain' }),
            })]);
            pushDebug('info', '서식 복사 성공 (방식: ClipboardItem)');
            return true;
        }
    } catch (err) {
        pushDebug('warn', `서식 복사(ClipboardItem) 실패: ${err.message}`);
    }

    // ③ 글자만이라도
    pushDebug('warn', '서식 복사 모두 실패 — 글자만 복사합니다');
    return copyToClipboard(text);
}

// ── APA 7판 참고문헌 형식 생성 (글자만 — 목록 표시·파일 저장용) ────
function formatAPA(paper) {
    return formatAPAParts(paper).text;
}

// ── 본문 인용 형식 생성 ────────────────────────────────────
// ── 본문 인용 (APA 7) ──────────────────────────────────────
// 영문: (Smith, 2020) · (Smith & Jones, 2020) · (Smith et al., 2020)
// 국문: (홍길동, 2020) · (홍길동, 김철수, 2020) · (홍길동 외, 2020)
function formatInText(paper) {
    if (!paper.authors) return paper.year ? `(${paper.year})` : '';
    const people = splitAuthors(paper.authors);
    if (!people.length) return paper.year ? `(${paper.year})` : '';

    const korean = isKoreanName(people[0]);
    // 본문 인용은 성(姓)만 쓴다
    // 본문 인용은 성(姓)만. "반두라, A." 처럼 외국 저자를 한글로 옮긴 경우도 쉼표 앞만 쓴다.
    const surname = p => apaAuthorName(p).split(',')[0].trim();
    // 번역서는 APA 7 규칙상 (원저자, 원출판연도/번역출판연도) 로 쓴다
    const _oy = (paper.originalYear || '').trim();
    const _base = apaItemType(paper) === 'translation' && _oy && paper.year
        ? `${_oy}/${paper.year}` : (paper.year || '');
    const year = _base ? `${_base}${_apaSuffix[paper.id] || ''}` : '';

    let name;
    if (people.length === 1)      name = surname(people[0]);
    else if (people.length === 2) name = korean ? `${surname(people[0])}, ${surname(people[1])}`
                                                : `${surname(people[0])} & ${surname(people[1])}`;
    else                          name = korean ? `${surname(people[0])} 외`
                                                : `${surname(people[0])} et al.`;

    return year ? `(${name}, ${year})` : `(${name})`;
}

// ── 태그/변인 뷰 ───────────────────────────────────────────
// 정리 기준 차원: [key, 라벨, 그룹이름 색상 클래스]
const ORGANIZE_DIMS = [
    ['keyword',  '키워드',     'og-keyword'],
    ['author',   '저자',       'og-author'],
    ['topic',    '주제(태그)', 'og-topic'],
    ['variable', '변인',       'og-variable'],
    ['method',   '연구방법',   'og-method'],
];

// 쉼표(영문/한글)·세미콜론·가운뎃점 등으로 나눠 한 칸씩 정리
function splitMulti(str) {
    return String(str || '')
        .split(/[,，、;·]+/)
        .map(s => s.trim())
        .filter(Boolean);
}

// 한 논문에서 선택한 기준의 값 목록을 뽑아냄
function organizeValues(paper, dimKey) {
    if (dimKey === 'keyword') return splitMulti(paper.analysis?.keywords);
    if (dimKey === 'author')  return splitMulti(paper.authors);
    if (dimKey === 'topic')   return (paper.tags || []).filter(Boolean);
    if (dimKey === 'method') {
        // 논문 폼의 '연구방법' + 정밀 분석의 '분석 방법'을 함께 묶음
        return [...splitMulti(paper.methods), ...splitMulti(paper.analysis?.method)];
    }
    if (dimKey === 'variable') {
        const a = paper.analysis || {};
        const fromAnalysis = VAR_ROLES.flatMap(([role]) =>
            (a.variables?.[role] || []).map(v => v && v.name).filter(Boolean));
        return [...(paper.variables || []), ...fromAnalysis].filter(Boolean);
    }
    return [];
}

// ── 아이디어 / 마인드맵 뷰 ────────────────────────────────
function renderSketch(container) {
    container.style.padding  = '0';
    container.style.overflow = 'hidden';
    initMindmap(container, state.currentProjectId);
}

// ── 홈 대시보드 (2×2 분할: 모형·메모·논문·자료, 누르면 그 화면으로) ─────
function renderHome(container) {
    const p = state.proposal || {};
    const mt = (p.title || '').trim(), ms = (p.subtitle || '').trim();
    const modelPrev = (mt || ms)
        ? `<div class="home-model-title">${escHtml(mt || '(제목 없는 모형)')}</div>`
          + (ms ? `<div class="home-model-sub">— ${escHtml(ms)} —</div>` : '')
        : `<div class="muted">아직 모형이 없어요 — 도형을 그려보세요</div>`;

    container.innerHTML = `
        <div class="home-head">내 연구 홈</div>
        <div class="home-grid">
            <button type="button" class="home-card" data-go="sketch">
                <div class="home-card-head">${icon('nodes')} 모형 스케치</div>
                <div class="home-card-body home-model">${modelPrev}</div>
                <div class="home-card-foot">모형스케치북 열기 →</div>
            </button>
            <button type="button" class="home-card" data-go="notes">
                <div class="home-card-head">${icon('lightbulb')} 아이디어 메모 <span class="home-badge">${state.notes.length}</span></div>
                <div class="home-card-body">${homeListHTML(homeRecent(state.notes, n => (n.title||'').trim() || (n.type === 'todo' ? `☑ 할일 ${(n.items||[]).length}개` : (n.content||'').trim().slice(0,40))), '아직 메모가 없어요')}</div>
                <div class="home-card-foot">아이디어 열기 →</div>
            </button>
            <button type="button" class="home-card" data-go="papers">
                <div class="home-card-head">${icon('file-text')} 논문 목록 <span class="home-badge">${state.papers.length}</span></div>
                <div class="home-card-body">${homeListHTML(homeRecent(state.papers, x => (x.title||'').trim()), '아직 논문이 없어요')}</div>
                <div class="home-card-foot">논문 열기 →</div>
            </button>
            <button type="button" class="home-card" data-go="materials">
                <div class="home-card-head">${icon('library')} 자료 <span class="home-badge">${state.materials.length}</span></div>
                <div class="home-card-body">${homeListHTML(homeRecent(state.materials, x => (x.title||'').trim()), '아직 자료가 없어요')}</div>
                <div class="home-card-foot">자료 열기 →</div>
            </button>
        </div>`;
    container.querySelectorAll('.home-card').forEach(card =>
        card.addEventListener('click', () => goToView(card.dataset.go)));
}

// 최근순 상위 5개의 제목(빈 항목은 대체 문구)
function homeRecent(arr, label) {
    return [...(arr || [])]
        .sort((a, b) => (b.updatedAt || b.addedAt || 0) - (a.updatedAt || a.addedAt || 0))
        .slice(0, 5)
        .map(x => label(x) || '제목 없음');
}
function homeListHTML(items, emptyMsg) {
    if (!items.length) return `<div class="muted">${escHtml(emptyMsg)}</div>`;
    return `<ul class="home-list">${items.map(t => `<li>${escHtml(t)}</li>`).join('')}</ul>`;
}

// 탑바 "논문 보기" 드롭다운 옵션 갱신 (어느 화면에서나 논문 골라 보기 모달 열기)
function refreshPaperJump() {
    const sel = document.getElementById('paper-jump');
    if (!sel) return;
    const opts = sortPapers(state.papers).map(p =>
        `<option value="${p.id}">${escHtml((p.title || '제목 없음').slice(0, 60))}</option>`).join('');
    sel.innerHTML = `<option value="">논문 보기…</option>${opts}`;
}

// ── 분류 모아보기 — 카테고리 하나를 골라 여러 논문의 그 항목 발췌를 한눈에 ──
// 카테고리에 해당하는 논문 필드 값을 꺼냄 (AI 자동 추출 포함)
function catFieldValue(paper, catKey) {
    const cfg = CAT_FIELD[catKey];
    if (!cfg) return null;
    if (cfg.kind === 'top') {
        const v = paper[cfg.key];
        return (v && String(v).trim()) ? String(v).trim() : null;
    }
    if (cfg.kind === 'analysis') {
        const v = paper.analysis?.[cfg.key];
        return (v && String(v).trim()) ? String(v).trim() : null;
    }
    if (cfg.kind === 'array') {
        if (cfg.key === 'variables') {
            // paper.variables + analysis.variables 5역할 합산
            const seen = new Set();
            const out = [];
            (paper.variables || []).forEach(v => { const k = String(v).toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(v); } });
            VAR_ROLES.forEach(([role]) => {
                (paper.analysis?.variables?.[role] || []).forEach(item => {
                    const name = item?.name || item;
                    if (name) { const k = String(name).toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(name); } }
                });
            });
            return out.length ? out : null;
        }
        const arr = paper[cfg.key] || [];
        return arr.length ? [...arr] : null;
    }
    return null;
}

function renderCatView(container) {
    const known = new Set(EXCERPT_CATS.map(([k]) => k));
    const catOf = e => (known.has(e.cat) ? e.cat : 'free');
    const cur = (state.catViewCat && known.has(state.catViewCat)) ? state.catViewCat : EXCERPT_CATS[0][0];
    state.catViewCat = cur;

    // 논문별로: 필드값 + 발췌 중 하나라도 있으면 표시
    const rows = sortPapers(state.papers).map(p => ({
        p,
        fieldVal: catFieldValue(p, cur),
        excerpts: (p.excerpts || []).filter(e => catOf(e) === cur),
    })).filter(r => r.fieldVal || r.excerpts.length);

    const totalEx = rows.reduce((n, r) => n + r.excerpts.length, 0);
    const catOptions = EXCERPT_CATS.map(([k, l]) =>
        `<option value="${k}" ${k === cur ? 'selected' : ''}>${l}</option>`).join('');

    const isArray = Array.isArray(rows[0]?.fieldVal);
    const body = rows.length
        ? rows.map(({ p, fieldVal, excerpts }) => {
            const fieldHTML = fieldVal
                ? (Array.isArray(fieldVal)
                    ? `<div class="cv-field-tags">${fieldVal.map(v => `<span class="tag tag-variable">${escHtml(v)}</span>`).join('')}</div>`
                    : `<div class="cv-field-text">${escHtml(fieldVal)}</div>`)
                : '';
            const exHTML = excerpts.length
                ? `<ul class="cv-ex-list">${excerpts.map(e =>
                    `<li>${escHtml(e.text)}${e.memo ? `<span class="cv-ex-memo"> — ${escHtml(e.memo)}</span>` : ''}</li>`
                ).join('')}</ul>`
                : '';
            return `
            <div class="cv-paper">
                <div class="cv-paper-head">
                    <span class="cv-paper-title">${escHtml(p.title || '제목 없음')}</span>
                    <span class="cv-paper-meta">${escHtml([firstAuthor(p), p.year].filter(Boolean).join(', '))}</span>
                    <button type="button" class="cv-open btn-secondary" data-id="${p.id}">${icon('eye', 14)} 보기</button>
                </div>
                ${fieldHTML}${exHTML}
            </div>`;
        }).join('')
        : `<div class="empty-state"><div class="empty-icon">${icon('clipboard', 44)}</div><h3>이 분류에 내용이 없어요</h3><p class="muted">논문에 「${escHtml(CAT_LABEL[cur] || '')}」 항목을 채우거나, 연구 책상에서 발췌를 담아보세요.</p></div>`;

    // 자료 태그 섹션
    const matsWithTags = state.materials.filter(m =>
        (m.deskTags || []).length > 0 || m.deskMemo?.trim() || (m.deskMemos || []).length > 0);
    const matTagsHTML = matsWithTags.length ? `
        <div class="cv-mat-section">
            <div class="cv-mat-section-title">${icon('library', 14)} 자료 태그 & 메모</div>
            ${matsWithTags.map(m => {
                const tags = (m.deskTags || []).map(t =>
                    `<span class="desk-mat-tag" style="cursor:default">${t.page ? `<span class="desk-mat-tag-page" style="cursor:default">p.${t.page}</span>` : ''}${escHtml(t.label)}</span>`
                ).join('');
                const memos = Array.isArray(m.deskMemos) ? m.deskMemos
                    : (m.deskMemo?.trim() ? [{ page: 0, text: m.deskMemo }] : []);
                const memosHTML = memos.map(memo =>
                    `<div class="cv-mat-memo">${memo.page ? `<span class="cv-mat-memo-page">p.${memo.page}</span> ` : ''}${escHtml(memo.text)}</div>`
                ).join('');
                return `<div class="cv-paper">
                    <div class="cv-paper-head">
                        <span class="cv-paper-title">${escHtml(m.title || '제목 없음')}</span>
                        <span class="cv-paper-meta">${escHtml(m.type || '자료')}</span>
                        <button type="button" class="cv-open-mat btn-secondary" data-id="${m.id}">${icon('eye', 14)} 보기</button>
                    </div>
                    ${tags ? `<div class="cv-mat-tags">${tags}</div>` : ''}
                    ${memosHTML}
                </div>`;
            }).join('')}
        </div>` : '';

    container.innerHTML = `
        <div class="cv-head">
            <span class="cv-title">분류 모아보기</span>
            <select class="cv-cat-select" id="cv-cat">${catOptions}</select>
            <span class="cv-count">${rows.length}편 · 발췌 ${totalEx}개</span>
        </div>
        <div class="cv-list">${body}${matTagsHTML}</div>`;

    container.querySelector('#cv-cat')?.addEventListener('change', e => {
        state.catViewCat = e.target.value;
        renderCatView(container);
    });
    container.querySelectorAll('.cv-open').forEach(b =>
        b.addEventListener('click', () => openForm(b.dataset.id, 'view')));
    container.querySelectorAll('.cv-open-mat').forEach(b =>
        b.addEventListener('click', () => openMaterialForm(b.dataset.id, 'view')));
}

// ── 마인드맵 캔버스 (양방향) ─────────────────────────────────
const MM_COLORS = ['#4a90e2','#e05454','#27ae60','#e67e22','#8e44ad','#16a085'];
const MM_COLOR_LABELS = ['파랑','빨강','초록','주황','보라','청록'];
const MM_NW = 130, MM_NH = 38, MM_HGAP = 72, MM_VGAP = 14;

let _mmTree        = null;
let _mmSel         = null;
let _mmEdit        = false;
let _mmCont        = null;
let _mmZoom        = 1;
let _mmJustDragged = false;

// ── 트리 유틸 ────────────────────────────────────────────────
function mmFind(node, id) {
    if (!node) return null;
    if (node.id === id) return node;
    for (const c of (node.children || [])) { const r = mmFind(c, id); if (r) return r; }
    return null;
}
function mmParent(root, id) {
    if (!root) return null;
    for (const c of (root.children || [])) {
        if (c.id === id) return root;
        const r = mmParent(c, id);
        if (r) return r;
    }
    return null;
}
function mmRemove(node, id) {
    if (!node) return;
    node.children = (node.children || []).filter(c => c.id !== id);
    node.children.forEach(c => mmRemove(c, id));
}
function mmNew(text = '새 노드') {
    return { id: genId(), text, color: MM_COLORS[0], collapsed: false, children: [] };
}
function mmCollect(node, parent = null, out = []) {
    if (!node) return out;
    out.push({ n: node, p: parent });
    if (!node.collapsed) (node.children || []).forEach(c => mmCollect(c, node, out));
    return out;
}
// 노드가 속한 루트 직계 자식의 side 반환 ('r' | 'l')
function mmGetSide(id) {
    for (const c of (_mmTree?.children || [])) {
        if (mmFind(c, id)) return c.side || 'r';
    }
    return 'r';
}

// ── 저장/로드 ────────────────────────────────────────────────
function mmSave() {
    if (!_mmTree || !state.currentProjectId) return;
    dbPut(STORE_POSTITS, { id: 'mm_' + state.currentProjectId, projectId: state.currentProjectId, tree: _mmTree });
}
async function tmmLoad() {
    return new Promise(resolve => {
        const tx = db.transaction(STORE_POSTITS, 'readonly');
        tx.objectStore(STORE_POSTITS).get('mm_' + state.currentProjectId).onsuccess = e => {
            const rec = e.target.result;
            const projName = (state.projects || []).find(p => p.id === state.currentProjectId)?.name || '연구 주제';
            _mmTree = rec?.tree || { id: 'root', text: '중심 주제', color: MM_COLORS[0], collapsed: false, children: [] };
            resolve();
        };
    });
}

// ── 레이아웃 계산 (양방향 트리) ──────────────────────────────
function mmCalcH(node) {
    if (!node) return MM_NH;
    if (node.collapsed || !(node.children || []).length) { node._h = MM_NH; return MM_NH; }
    const total = node.children.reduce((s, c) => s + mmCalcH(c) + MM_VGAP, -MM_VGAP);
    node._h = Math.max(MM_NH, total);
    return node._h;
}
function mmSideH(kids) {
    if (!kids.length) return 0;
    return kids.reduce((s, c) => s + (c._h || MM_NH) + MM_VGAP, -MM_VGAP);
}
// 오른쪽으로 뻗는 서브트리 배치
function mmPosR(node, x, cy) {
    node._x = x; node._y = cy - MM_NH / 2;
    if (node.collapsed || !(node.children || []).length) return;
    let y = cy - (node._h || MM_NH) / 2;
    for (const c of node.children) {
        y += (c._h || MM_NH) / 2;
        mmPosR(c, x + MM_NW + MM_HGAP, y);
        y += (c._h || MM_NH) / 2 + MM_VGAP;
    }
}
// 왼쪽으로 뻗는 서브트리 배치 (rx = 노드 오른쪽 끝 기준)
function mmPosL(node, rx, cy) {
    node._x = rx - MM_NW; node._y = cy - MM_NH / 2;
    if (node.collapsed || !(node.children || []).length) return;
    let y = cy - (node._h || MM_NH) / 2;
    for (const c of node.children) {
        y += (c._h || MM_NH) / 2;
        mmPosL(c, rx - MM_NW - MM_HGAP, y);
        y += (c._h || MM_NH) / 2 + MM_VGAP;
    }
}
// 왼쪽 가지의 최대 깊이 (루트 X 위치 계산용)
function mmLDepth(nodes) {
    if (!nodes.length) return 0;
    return 1 + Math.max(...nodes.map(n =>
        (n.collapsed || !n.children?.length) ? 0 : mmLDepth(n.children)));
}

// ── 렌더링 ───────────────────────────────────────────────────
function renderMindmapView(container) {
    _mmCont = container;
    _mmSel = null; _mmEdit = false;
    tmmLoad().then(mmDraw);
}

function mmDraw(focusId = null) {
    if (!_mmCont || !_mmTree) return;

    const PAD = 40;
    const topNodes = _mmTree.children || [];
    const hasSel = !!_mmSel;
    const toolbarHTML = `
        <button class="btn-primary"   id="mm-add-r"  >${hasSel ? '하위 추가' : '노드 추가'}</button>
        <button class="btn-secondary" id="mm-add-sib"${hasSel ? '' : ' style="display:none"'}>형제 추가</button>
        <button class="btn-secondary" id="mm-rename" ${hasSel ? '' : ' style="display:none"'}>이름 변경</button>
        <button class="btn-secondary" id="mm-del"    ${hasSel ? '' : ' style="display:none"'}>삭제</button>
        <span class="mm-bar-sep"></span>
        <div class="mm-zoom-ctrl">
            <button id="mm-zoom-out" title="축소">−</button>
            <span   id="mm-zoom-label">${Math.round(_mmZoom * 100)}%</span>
            <button id="mm-zoom-in"  title="확대">+</button>
            <button id="mm-zoom-fit" title="전체 보기">⊡</button>
        </div>
        <span class="mm-bar-sep"></span>
        <button class="btn-secondary" id="mm-export">내보내기</button>
        <button class="btn-secondary" id="mm-import">불러오기</button>
        <input type="file" id="mm-import-file" accept=".json" style="display:none">
        <span class="mm-hint"><kbd>Tab</kbd>하위 · <kbd>Enter</kbd>형제 · <kbd>Del</kbd>삭제 · <kbd>F2</kbd>편집 · 드래그 이동 · 휠 확대/축소</span>`;

    // 빈 상태
    if (topNodes.length === 0) {
        _mmCont.innerHTML = `
            <div class="mm-wrap">
                <div class="mm-bar">${toolbarHTML}</div>
                <div class="mm-area" id="mm-area" tabindex="0"
                     style="display:flex;align-items:center;justify-content:center;min-height:260px">
                    <div style="color:var(--text-muted);text-align:center;line-height:2">
                        「노드 추가」를 누르거나 <kbd>Tab</kbd>으로 첫 노드를 추가하세요
                    </div>
                </div>
            </div>`;
        tmmBind(_mmCont);
        return;
    }

    // 위치 없는 노드 → 자동 레이아웃으로 초기 위치 배정 후 저장
    const needsLayout = topNodes.some(n => n.x === undefined);
    if (needsLayout) {
        topNodes.forEach(n => mmCalcH(n));
        let curY = PAD;
        topNodes.forEach(n => { mmPosR(n, PAD, curY + n._h / 2); curY += n._h + MM_VGAP * 2; });
        const assignPos = nd => {
            if (nd.x === undefined) { nd.x = nd._x; nd.y = nd._y; }
            (nd.children || []).forEach(assignPos);
        };
        topNodes.forEach(assignPos);
        mmSave();
    }

    const all  = topNodes.flatMap(n => mmCollect(n));
    const maxX = Math.max(...all.map(({n}) => n.x + MM_NW), 400) + PAD * 2;
    const maxY = Math.max(...all.map(({n}) => n.y + MM_NH), 300) + PAD * 2;

    const nodeEls = all.map(({n}) => {
        const sel   = n.id === _mmSel;
        const hasCh = (n.children || []).length > 0;
        const colBtn = hasCh
            ? `<button class="mm-col-btn" data-id="${n.id}" title="${n.collapsed?'펼치기':'접기'}">${n.collapsed?'▶':'▼'}</button>`
            : '';
        const palette = sel ? `<div class="mm-palette">
            ${MM_COLORS.map((c,i) => `<button class="mm-cdot${n.color===c?' active':''}" data-id="${n.id}"
                data-color="${c}" style="background:${c}" title="${MM_COLOR_LABELS[i]}"></button>`).join('')}
        </div>` : '';
        return `<div class="mm-node${sel?' mm-sel':''}" data-id="${n.id}"
                    style="left:${n.x}px;top:${n.y}px;width:${MM_NW}px;height:${MM_NH}px;
                           border-color:${n.color};${sel?`background:${n.color};`:''}">
            ${colBtn}
            <span class="mm-ntxt" data-id="${n.id}" style="${sel?'color:#fff;':''}">${escHtml(n.text||'(빈 노드)')}</span>
            ${palette}
        </div>`;
    }).join('');

    _mmCont.innerHTML = `
        <div class="mm-wrap">
            <div class="mm-bar">${toolbarHTML}</div>
            <div class="mm-area" id="mm-area" tabindex="0">
                <div id="mm-canvas-wrap" style="width:${maxX*_mmZoom}px;height:${maxY*_mmZoom}px">
                    <div class="mm-canvas" id="mm-canvas"
                         data-nw="${maxX}" data-nh="${maxY}"
                         style="width:${maxX}px;height:${maxY}px;transform:scale(${_mmZoom});transform-origin:0 0">
                        <svg id="mm-svg" style="position:absolute;left:0;top:0;width:${maxX}px;height:${maxY}px;pointer-events:none">${mmBuildEdges(all)}</svg>
                        ${nodeEls}
                    </div>
                </div>
            </div>
        </div>`;

    tmmBind(_mmCont);

    if (focusId) {
        const areaEl = _mmCont.querySelector('#mm-area');
        const el = _mmCont.querySelector(`.mm-node[data-id="${focusId}"]`);
        if (areaEl && el) {
            const nx = parseFloat(el.style.left) * _mmZoom;
            const ny = parseFloat(el.style.top)  * _mmZoom;
            setTimeout(() => {
                areaEl.scrollLeft = Math.max(0, nx - areaEl.clientWidth  / 2 + MM_NW * _mmZoom / 2);
                areaEl.scrollTop  = Math.max(0, ny - areaEl.clientHeight / 2 + MM_NH * _mmZoom / 2);
            }, 0);
        }
    }
}

// ── 이벤트 바인딩 ────────────────────────────────────────────
function tmmBind(container) {
    const area   = container.querySelector('#mm-area');
    const canvas = container.querySelector('#mm-canvas');
    if (area) area.focus();

    // ── 드래그로 노드 이동 ──────────────────────────────────────
    if (canvas) {
        canvas.addEventListener('mousedown', e => {
            if (_mmEdit) return;
            const nodeEl = e.target.closest('.mm-node');
            if (!nodeEl || e.target.closest('button')) return;
            const id = nodeEl.dataset.id;
            const n  = mmFind(_mmTree, id);
            if (!n) return;

            const startMX = e.clientX, startMY = e.clientY;
            const origX = n.x, origY = n.y;
            let hasMoved = false;
            e.preventDefault();

            const onMove = mv => {
                const dx = (mv.clientX - startMX) / _mmZoom;
                const dy = (mv.clientY - startMY) / _mmZoom;
                if (!hasMoved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
                hasMoved = true;
                n.x = Math.max(0, origX + dx);
                n.y = Math.max(0, origY + dy);
                nodeEl.style.left = n.x + 'px';
                nodeEl.style.top  = n.y + 'px';
                const svg = canvas.querySelector('#mm-svg');
                if (svg) svg.innerHTML = mmBuildEdges((_mmTree.children||[]).flatMap(t => mmCollect(t)));
                const nw = parseFloat(canvas.dataset.nw)||800, nh = parseFloat(canvas.dataset.nh)||600;
                const newW = Math.max(nw, n.x+MM_NW+60), newH = Math.max(nh, n.y+MM_NH+60);
                if (newW !== nw || newH !== nh) {
                    canvas.dataset.nw = newW; canvas.dataset.nh = newH;
                    canvas.style.width = newW+'px'; canvas.style.height = newH+'px';
                    const svgEl = canvas.querySelector('#mm-svg');
                    if (svgEl) { svgEl.style.width = newW+'px'; svgEl.style.height = newH+'px'; }
                    const wrap = container.querySelector('#mm-canvas-wrap');
                    if (wrap) { wrap.style.width=(newW*_mmZoom)+'px'; wrap.style.height=(newH*_mmZoom)+'px'; }
                }
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup',  onUp);
                canvas.style.cursor = '';
                if (hasMoved) {
                    _mmJustDragged = true;
                    mmSave(); mmDraw(_mmSel);
                    setTimeout(() => { _mmJustDragged = false; }, 100);
                } else {
                    _mmSel = id; mmDraw(id);
                }
            };
            canvas.style.cursor = 'grabbing';
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup',  onUp);
        });

        canvas.addEventListener('click', e => {
            if (_mmJustDragged) return;
            const colBtn = e.target.closest('.mm-col-btn');
            const cdot   = e.target.closest('.mm-cdot');
            const node   = e.target.closest('.mm-node');
            if (colBtn) {
                const n = mmFind(_mmTree, colBtn.dataset.id);
                if (n) { n.collapsed = !n.collapsed; mmSave(); mmDraw(_mmSel); }
                e.stopPropagation(); return;
            }
            if (cdot) {
                const n = mmFind(_mmTree, cdot.dataset.id);
                if (n) { n.color = cdot.dataset.color; mmSave(); mmDraw(_mmSel); }
                e.stopPropagation(); return;
            }
            if (node && !e.target.closest('button')) { _mmSel = node.dataset.id; mmDraw(_mmSel); return; }
            if (!node) { _mmSel = null; mmDraw(); }
        });

        canvas.addEventListener('dblclick', e => {
            if (_mmJustDragged) return;
            const node = e.target.closest('.mm-node');
            if (!node) return;
            mmDoEdit(node.dataset.id);
        });
    }

    // ── 휠 확대/축소 ─────────────────────────────────────────────
    if (area) {
        area.addEventListener('wheel', e => {
            e.preventDefault();
            const factor  = e.deltaY < 0 ? 1.1 : 0.9;
            const newZoom = Math.max(0.3, Math.min(3, _mmZoom * factor));
            const aRect   = area.getBoundingClientRect();
            const mx = e.clientX - aRect.left, my = e.clientY - aRect.top;
            const cpx = (area.scrollLeft + mx) / _mmZoom;
            const cpy = (area.scrollTop  + my) / _mmZoom;
            _mmZoom = newZoom;
            mmApplyZoom(container);
            area.scrollLeft = cpx * _mmZoom - mx;
            area.scrollTop  = cpy * _mmZoom - my;
        }, { passive: false });

        // ── 키보드 단축키 ──────────────────────────────────────
        area.addEventListener('keydown', e => {
            if (_mmEdit) return;
            const selNode = _mmSel ? mmFind(_mmTree, _mmSel) : null;

            if (e.key === 'Tab') {
                e.preventDefault();
                const parent   = selNode || _mmTree;
                const siblings = parent.children || [];
                const child    = mmNew('새 노드');
                child.color = selNode ? selNode.color : MM_COLORS[_mmTree.children.length % MM_COLORS.length];
                child.x = (selNode?.x ?? 40) + MM_NW + MM_HGAP;
                child.y = siblings.length ? siblings[siblings.length-1].y + MM_NH + MM_VGAP*2 : (selNode?.y ?? 40);
                parent.collapsed = false;
                (parent.children = parent.children || []).push(child);
                _mmSel = child.id; mmSave(); mmDraw(child.id);
                setTimeout(() => mmDoEdit(child.id), 80);
            }
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!_mmSel) return;
                const par = mmParent(_mmTree, _mmSel) || _mmTree;
                const idx = par.children.findIndex(c => c.id === _mmSel);
                const sib = mmNew('새 노드');
                sib.color = selNode?.color || MM_COLORS[0];
                sib.x = selNode?.x ?? 40;
                sib.y = (selNode?.y ?? 40) + MM_NH + MM_VGAP * 2;
                par.children.splice(idx + 1, 0, sib);
                _mmSel = sib.id; mmSave(); mmDraw(sib.id);
                setTimeout(() => mmDoEdit(sib.id), 80);
            }
            if ((e.key === 'Delete' || e.key === 'Backspace') && _mmSel) {
                const par = mmParent(_mmTree, _mmSel);
                mmRemove(_mmTree, _mmSel);
                _mmSel = par && par.id !== 'root' ? par.id : null;
                mmSave(); mmDraw(_mmSel);
            }
            if (e.key === 'F2' && _mmSel) setTimeout(() => mmDoEdit(_mmSel), 30);
        });
    }

    // ── 툴바: 노드 추가/수정/삭제 ──────────────────────────────
    container.querySelector('#mm-add-r')?.addEventListener('click', () => {
        const selNode  = _mmSel ? mmFind(_mmTree, _mmSel) : null;
        const parent   = selNode || _mmTree;
        const siblings = parent.children || [];
        const child    = mmNew('새 노드');
        child.color = selNode ? selNode.color : MM_COLORS[_mmTree.children.length % MM_COLORS.length];
        child.x = (selNode?.x ?? 40) + MM_NW + MM_HGAP;
        child.y = siblings.length ? siblings[siblings.length-1].y + MM_NH + MM_VGAP*2 : (selNode?.y ?? 40);
        parent.collapsed = false;
        (parent.children = parent.children || []).push(child);
        _mmSel = child.id; mmSave(); mmDraw(child.id);
        setTimeout(() => mmDoEdit(child.id), 80);
    });
    container.querySelector('#mm-add-sib')?.addEventListener('click', () => {
        if (!_mmSel) return;
        const selNode = mmFind(_mmTree, _mmSel);
        const par     = mmParent(_mmTree, _mmSel) || _mmTree;
        const idx     = par.children.findIndex(c => c.id === _mmSel);
        const sib     = mmNew('새 노드');
        sib.color = selNode?.color || MM_COLORS[0];
        sib.x = selNode?.x ?? 40;
        sib.y = (selNode?.y ?? 40) + MM_NH + MM_VGAP * 2;
        par.children.splice(idx + 1, 0, sib);
        _mmSel = sib.id; mmSave(); mmDraw(sib.id);
        setTimeout(() => mmDoEdit(sib.id), 80);
    });
    container.querySelector('#mm-rename')?.addEventListener('click', () => {
        if (_mmSel) mmDoEdit(_mmSel);
    });
    container.querySelector('#mm-del')?.addEventListener('click', () => {
        if (!_mmSel) return;
        const par = mmParent(_mmTree, _mmSel);
        mmRemove(_mmTree, _mmSel);
        _mmSel = par && par.id !== 'root' ? par.id : null;
        mmSave(); mmDraw(_mmSel);
    });

    // ── 툴바: 줌 ────────────────────────────────────────────────
    container.querySelector('#mm-zoom-in')?.addEventListener('click', () => {
        _mmZoom = Math.min(3, _mmZoom * 1.2); mmApplyZoom(container);
    });
    container.querySelector('#mm-zoom-out')?.addEventListener('click', () => {
        _mmZoom = Math.max(0.3, _mmZoom / 1.2); mmApplyZoom(container);
    });
    container.querySelector('#mm-zoom-fit')?.addEventListener('click', () => {
        const areaEl = container.querySelector('#mm-area');
        const cvs    = container.querySelector('#mm-canvas');
        if (areaEl && cvs) {
            const nw = parseFloat(cvs.dataset.nw)||800, nh = parseFloat(cvs.dataset.nh)||600;
            _mmZoom = Math.max(0.3, Math.min(1.5, Math.min(areaEl.clientWidth/nw, areaEl.clientHeight/nh) * 0.9));
        }
        mmApplyZoom(container);
        if (area) { area.scrollLeft = 0; area.scrollTop = 0; }
    });

    // ── 툴바: 내보내기/불러오기 ─────────────────────────────────
    container.querySelector('#mm-export')?.addEventListener('click', () => {
        const proj = state.projects.find(p => p.id === state.currentProjectId);
        const name = proj?.name || '마인드맵';
        const data = JSON.stringify({ type: 'mindmap', version: 1, tree: _mmTree }, null, 2);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
        const date = new Date().toLocaleDateString('ko-KR').replace(/\. /g,'-').replace('.','');
        a.download = `${name}_마인드맵_${date}.json`;
        a.click();
        showToast('마인드맵을 내보냈습니다');
    });
    container.querySelector('#mm-import')?.addEventListener('click', () => {
        container.querySelector('#mm-import-file')?.click();
    });
    container.querySelector('#mm-import-file')?.addEventListener('change', e => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            try {
                const data = JSON.parse(ev.target.result);
                if (data.type !== 'mindmap' || !data.tree) throw new Error('마인드맵 파일이 아닙니다');
                if (!confirm('현재 마인드맵을 불러온 파일로 교체할까요?')) return;
                _mmTree = data.tree;
                mmSave(); mmDraw();
                showToast('불러오기 완료');
            } catch (err) { showToast('파일 오류: ' + err.message, 'error'); }
        };
        reader.readAsText(file);
        e.target.value = '';
    });
}

function mmDoEdit(id) {
    if (!_mmCont) return;
    const n = mmFind(_mmTree, id);
    if (!n) return;
    _mmSel = id; _mmEdit = true; mmDraw(id);
    requestAnimationFrame(() => {
        const span = _mmCont.querySelector(`.mm-ntxt[data-id="${id}"]`);
        if (!span) return;
        const inp = document.createElement('input');
        inp.className = 'mm-inp';
        inp.value     = n.text;
        inp.style.color = 'var(--text-primary)';
        span.replaceWith(inp);
        inp.focus(); inp.select();
        const commit = () => {
            const v = inp.value.trim();
            n.text = v || n.text;
            _mmEdit = false; mmSave(); mmDraw(id);
        };
        inp.addEventListener('blur', commit);
        inp.addEventListener('keydown', ev => {
            if (ev.key === 'Enter')  { ev.preventDefault(); commit(); }
            if (ev.key === 'Escape') { _mmEdit = false; mmDraw(_mmSel); }
            ev.stopPropagation();
        });
    });
}
function mmStartEdit(id) { mmDoEdit(id); }

function mmBuildEdges(all) {
    return all.filter(({p}) => p).map(({n, p}) => {
        const x1 = p.x + MM_NW, y1 = p.y + MM_NH / 2;
        const x2 = n.x,          y2 = n.y + MM_NH / 2;
        const mx = (x1 + x2) / 2;
        return `<path fill="none" stroke="${p.color}" stroke-width="2.5" opacity="0.5"
                     d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}"/>`;
    }).join('');
}

function mmApplyZoom(container) {
    const c = container || _mmCont;
    const cvs  = c?.querySelector('#mm-canvas');
    const wrap = c?.querySelector('#mm-canvas-wrap');
    const lbl  = c?.querySelector('#mm-zoom-label');
    if (cvs)  cvs.style.transform = `scale(${_mmZoom})`;
    if (wrap && cvs) {
        const nw = parseFloat(cvs.dataset.nw)||800, nh = parseFloat(cvs.dataset.nh)||600;
        wrap.style.width  = (nw * _mmZoom) + 'px';
        wrap.style.height = (nh * _mmZoom) + 'px';
    }
    if (lbl) lbl.textContent = Math.round(_mmZoom * 100) + '%';
}

// 사이드바 클릭과 동일하게 화면 전환(홈 카드·로고에서 호출)
function goToView(view) {
    state.view = view;
    state.searchQuery = '';
    const si = document.getElementById('search-input'); if (si) si.value = '';
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add('active');
    renderContent();
}

// ── 아이디어 저장소(메모 · 할일) ──────────────────────────────
function noteMatchesQuery(n, q) {
    const items = (n.items || []).map(it => it.text).join(' ');
    return [n.title, n.content, items].some(f => f && String(f).toLowerCase().includes(q));
}

const NOTE_COLORS = [
    { key: 'white',  bg: '#ffffff',  bd: '#e2e8f0' },
    { key: 'yellow', bg: '#fef9c3',  bd: '#fde047' },
    { key: 'green',  bg: '#d1fae5',  bd: '#6ee7b7' },
    { key: 'blue',   bg: '#dbeafe',  bd: '#93c5fd' },
    { key: 'pink',   bg: '#fce7f3',  bd: '#f9a8d4' },
    { key: 'purple', bg: '#ede9fe',  bd: '#c4b5fd' },
];

// 메모·할일에서 자주 쓰는 이모지 — 드롭다운 패널에서 클릭하면 커서 위치에 삽입
const QUICK_EMOJI = ['📌', '⭐', '✅', '🔥', '💡', '⚠️'];
function emojiPickerHTML() {
    return `
        <div class="emoji-picker">
            <button type="button" class="emoji-picker-btn" title="이모지 삽입">🙂</button>
            <div class="emoji-picker-panel">${
                QUICK_EMOJI.map(e => `<button type="button" class="note-emoji-btn" data-emoji="${e}" title="입력창에 삽입">${e}</button>`).join('')
            }</div>
        </div>`;
}
// 이모지 팝업 바깥을 클릭하면 닫힘 (렌더링과 무관하게 한 번만 등록)
document.addEventListener('click', e => {
    if (!e.target.closest('.emoji-picker')) {
        document.querySelectorAll('.emoji-picker-panel.open').forEach(p => p.classList.remove('open'));
    }
});

// 보관함(접힌 메모) 정렬: 'recent'(최근 수정순, 기본) | 'oldest'(오래된순)
function getDockSortMode() {
    return localStorage.getItem('notesDockSort') === 'oldest' ? 'oldest' : 'recent';
}
function setDockSortMode(mode) {
    localStorage.setItem('notesDockSort', mode);
}

function renderNotes(container, q = '') {
    let notes = [...state.notes];
    if (q) notes = notes.filter(n => noteMatchesQuery(n, q));

    const header = `
        <div class="section-header" style="margin-bottom:8px">
            <span class="section-title">아이디어 메모 ${q ? `검색 결과 ${notes.length}개` : `${state.notes.length}개`}</span>
            <div class="notes-add-btns">
                <button class="btn-secondary" id="btn-add-note">+ 메모 추가</button>
                <button class="btn-secondary" id="btn-add-todo">${icon('check', 14)} + 할일 추가</button>
            </div>
        </div>`;

    if (notes.length === 0) {
        container.innerHTML = header + `
            <div class="empty-state">
                <div class="empty-icon">${icon('lightbulb', 44)}</div>
                <h3>${q ? '검색 결과가 없습니다' : '저장된 메모가 없습니다'}</h3>
                ${q ? '' : '<p>떠오르는 생각·아이디어는 <strong>+ 메모 추가</strong>로,<br>할 일 목록은 <strong>+ 할일 추가</strong>로 만들어보세요</p>'}
            </div>`;
    } else {
        container.innerHTML = header + boardHTML(notes);
    }
    bindNotes(container);
}

// 보관함(접힌 메모) + 캔버스(펼쳐진 메모, 자유 위치) — 유일한 배치 방식
function boardHTML(notes) {
    const dockSort = getDockSortMode();
    const collapsedNotes = notes.filter(n => n.collapsed).sort((a, b) => {
        const av = a.updatedAt || a.addedAt || 0, bv = b.updatedAt || b.addedAt || 0;
        return dockSort === 'recent' ? bv - av : av - bv;
    });
    const expandedNotes = notes.filter(n => !n.collapsed).sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
    return `
        <div class="notes-board">
            <div class="notes-dock">
                <div class="notes-dock-head">
                    <span class="notes-dock-title">보관함 ${collapsedNotes.length}</span>
                    <div class="notes-sort-toggle notes-sort-toggle-sm">
                        <button type="button" class="notes-sort-btn${dockSort === 'recent' ? ' active' : ''}" data-docksort="recent">최근순</button>
                        <button type="button" class="notes-sort-btn${dockSort === 'oldest' ? ' active' : ''}" data-docksort="oldest">오래된순</button>
                    </div>
                </div>
                <div class="notes-dock-list">${
                    collapsedNotes.length
                        ? collapsedNotes.map(dockItemHTML).join('')
                        : '<div class="dock-empty">접으면 여기<br>쌓여요</div>'
                }</div>
            </div>
            <div class="notes-canvas">${
                expandedNotes.length
                    ? expandedNotes.map((n, i) => noteCardHTML(n, i)).join('')
                    : '<div class="canvas-empty">보관함 항목을 클릭하거나<br>이 안으로 드래그하면 펼쳐져요</div>'
            }</div>
        </div>`;
}

function dockItemHTML(n) {
    const label = (n.title || '').trim() || (n.type === 'todo' ? '할일' : '메모');
    const c = NOTE_COLORS.find(nc => nc.key === (n.color || 'white')) || NOTE_COLORS[0];
    return `
        <div class="dock-item" draggable="true" data-id="${n.id}" title="클릭하거나 드래그해서 캔버스에 펼치기 — ${escHtml(label)}" style="background:${c.bg};border-color:${c.bd}">
            ${icon(n.type === 'todo' ? 'check' : 'note', 16)}
            <span class="dock-label">${escHtml(label.slice(0, 6))}</span>
        </div>`;
}

function noteCardHTML(n, boardIdx = 0) {
    return n.type === 'todo' ? todoCardHTML(n, boardIdx) : memoCardHTML(n, boardIdx);
}

function noteCdotsHTML(n) {
    return NOTE_COLORS.map(nc =>
        `<button class="note-cdot${nc.key === (n.color || 'white') ? ' active' : ''}"
                 data-color="${nc.key}" title="${nc.key}"
                 style="background:${nc.bg};border-color:${nc.bd}"></button>`
    ).join('');
}

// 캔버스 안에서의 위치 스타일 — 저장된 좌표가 없으면 겹치지 않게 계단식 기본 배치
function boardPositionStyle(n, boardIdx) {
    const x = n.x ?? (20 + (boardIdx % 4) * 300);
    const y = n.y ?? (20 + Math.floor(boardIdx / 4) * 260);
    return `position:absolute;left:${x}px;top:${y}px;width:280px;z-index:${n.zIndex || 1};`;
}

// 현재 캔버스에서 가장 앞에 오는 z-index보다 하나 큰 값 — 방금 만진 메모를 맨 앞으로
function nextZIndex() {
    return Math.max(0, ...state.notes.map(n => n.zIndex || 0)) + 1;
}

// 순서 변경 손잡이 — 캔버스 안 이동·보관함으로 되돌리기용
function dragHandleHTML() {
    return `<span class="card-drag-handle" draggable="true" title="드래그해서 옮기기 (보관함 위로 놓으면 다시 접힘)">⠿</span>`;
}

// 접기/펼치기 버튼 (메모·할일 공통)
function collapseBtnHTML(collapsed) {
    return `<button type="button" class="note-collapse-btn" title="${collapsed ? '펼치기' : '접기'}">${icon(collapsed ? 'chevron-down' : 'chevron-up', 16)}</button>`;
}

function memoCardHTML(n, boardIdx) {
    const when = n.updatedAt || n.addedAt;
    const date = when ? new Date(when).toLocaleDateString('ko-KR') : '';
    const c = NOTE_COLORS.find(c => c.key === (n.color || 'white')) || NOTE_COLORS[0];
    const collapsed = !!n.collapsed;
    return `
        <div class="note-card" data-id="${n.id}" data-type="memo" style="${boardPositionStyle(n, boardIdx)}background:${c.bg};border-color:${c.bd}">
            <div class="note-head">
                ${dragHandleHTML()}
                ${collapseBtnHTML(collapsed)}
                <input class="note-title" placeholder="제목(선택)" value="${escHtml(n.title || '')}">
            </div>
            <div class="note-content">
                <div class="note-tools-row">${emojiPickerHTML()}</div>
                <textarea class="note-body" placeholder="메모를 입력하세요...">${escHtml(n.content || '')}</textarea>
            </div>
            <div class="note-foot">
                <div class="note-cdots">${noteCdotsHTML(n)}</div>
                <span class="note-date">${date}</span>
                <button class="note-del" title="메모 삭제">삭제</button>
            </div>
        </div>`;
}

function todoCardHTML(n, boardIdx) {
    const when = n.updatedAt || n.addedAt;
    const date = when ? new Date(when).toLocaleDateString('ko-KR') : '';
    const c = NOTE_COLORS.find(c => c.key === (n.color || 'white')) || NOTE_COLORS[0];
    const items = n.items || [];
    const doneCount = items.filter(it => it.done).length;
    const collapsed = !!n.collapsed;
    const itemsHTML = items.map(it => `
        <div class="todo-item${it.done ? ' done' : ''}" data-item-id="${it.id}">
            <input type="checkbox" class="todo-check"${it.done ? ' checked' : ''}>
            <span class="todo-text">${escHtml(it.text)}</span>
            <button type="button" class="todo-item-del" title="항목 삭제">${icon('x', 12)}</button>
        </div>`).join('') || `<div class="todo-empty">아직 할일이 없어요</div>`;
    return `
        <div class="note-card todo-card" data-id="${n.id}" data-type="todo" style="${boardPositionStyle(n, boardIdx)}background:${c.bg};border-color:${c.bd}">
            <div class="note-head">
                ${dragHandleHTML()}
                ${collapseBtnHTML(collapsed)}
                <input class="note-title todo-title" placeholder="할일 제목(선택)" value="${escHtml(n.title || '')}">
                <span class="todo-count">${doneCount}/${items.length}</span>
            </div>
            <div class="note-content">
                <div class="todo-items">${itemsHTML}</div>
                <div class="todo-add-row">
                    ${emojiPickerHTML()}
                    <input type="text" class="todo-add-input" placeholder="할일을 입력하고 Enter">
                    <button type="button" class="btn-secondary todo-add-btn">추가</button>
                </div>
                <button type="button" class="todo-cleanup-btn" ${doneCount ? '' : 'disabled'}>완료한 항목 ${doneCount}개 정리</button>
            </div>
            <div class="note-foot">
                <div class="note-cdots">${noteCdotsHTML(n)}</div>
                <span class="note-date">${date}</span>
                <button class="note-del" title="할일 삭제">삭제</button>
            </div>
        </div>`;
}

// 텍스트 입력창(textarea/input)의 커서 위치에 이모지 삽입
function insertAtCursor(el, text) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    el.focus();
    el.selectionStart = el.selectionEnd = start + text.length;
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

function bindNotes(container) {
    const addBtn = document.getElementById('btn-add-note');
    if (addBtn) addBtn.onclick = () => addNote('memo');
    const addTodoBtn = document.getElementById('btn-add-todo');
    if (addTodoBtn) addTodoBtn.onclick = () => addNote('todo');

    // 보관함(접힌 메모) 정렬 토글
    container.querySelectorAll('.notes-sort-btn[data-docksort]').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.docksort;
            if (mode === getDockSortMode()) return;
            setDockSortMode(mode);
            renderNotes(container, (state.searchQuery || '').trim().toLowerCase());
        });
    });

    container.querySelectorAll('.note-card').forEach(card => {
        const id = card.dataset.id;
        const isTodo = card.dataset.type === 'todo';

        // 색상 선택 (메모·할일 공통)
        card.querySelectorAll('.note-cdot').forEach(dot => {
            dot.addEventListener('click', () => {
                const colorKey = dot.dataset.color;
                const c = NOTE_COLORS.find(nc => nc.key === colorKey) || NOTE_COLORS[0];
                card.style.background  = c.bg;
                card.style.borderColor = c.bd;
                card.querySelectorAll('.note-cdot').forEach(d =>
                    d.classList.toggle('active', d.dataset.color === colorKey));
                const note = state.notes.find(n => n.id === id);
                if (note) { note.color = colorKey; note.updatedAt = Date.now(); dbPut(STORE_NOTES, note); }
            });
        });
        card.querySelector('.note-del').addEventListener('click', () => deleteNote(id));

        // 접기/펼치기 (메모·할일 공통)
        card.querySelector('.note-collapse-btn')?.addEventListener('click', () => toggleNoteCollapse(id));

        // 이모지 드롭다운 열기/닫기
        card.querySelectorAll('.emoji-picker-btn').forEach(btn => {
            const panel = btn.nextElementSibling;
            btn.addEventListener('click', () => {
                const willOpen = !panel.classList.contains('open');
                document.querySelectorAll('.emoji-picker-panel.open').forEach(p => p.classList.remove('open'));
                panel.classList.toggle('open', willOpen);
            });
        });

        // 이모지 버튼 → 이 카드에서 가장 최근 포커스된(또는 기본) 입력창에 삽입
        const emojiTarget = card.querySelector(isTodo ? '.todo-add-input' : '.note-body');
        let lastFocused = emojiTarget;
        card.querySelectorAll('.note-title, .note-body, .todo-add-input').forEach(el => {
            el.addEventListener('focus', () => { lastFocused = el; });
        });
        card.querySelectorAll('.note-emoji-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                insertAtCursor(lastFocused || emojiTarget, btn.dataset.emoji);
                btn.closest('.emoji-picker-panel')?.classList.remove('open');
            });
        });

        if (!isTodo) {
            const titleEl = card.querySelector('.note-title');
            const bodyEl = card.querySelector('.note-body');
            let saveTimer;
            const queueSave = () => {
                clearTimeout(saveTimer);
                saveTimer = setTimeout(() => saveNote(id, titleEl.value, bodyEl.value), 600);
            };
            titleEl.addEventListener('input', queueSave);
            bodyEl.addEventListener('input', queueSave);
            return;
        }

        // ── 할일 카드 전용 바인딩 ──
        const titleEl = card.querySelector('.todo-title');
        let titleTimer;
        titleEl.addEventListener('input', () => {
            clearTimeout(titleTimer);
            titleTimer = setTimeout(() => saveTodoTitle(id, titleEl.value), 600);
        });

        const addInput = card.querySelector('.todo-add-input');
        const addItem = () => {
            const text = addInput.value.trim();
            if (!text) return;
            addInput.value = '';
            addTodoItem(id, text);
        };
        card.querySelector('.todo-add-btn').addEventListener('click', addItem);
        addInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addItem(); } });

        const cleanupBtn = card.querySelector('.todo-cleanup-btn');
        if (cleanupBtn) cleanupBtn.addEventListener('click', () => cleanupTodoItems(id));

        card.querySelectorAll('.todo-item').forEach(row => {
            const itemId = row.dataset.itemId;
            row.querySelector('.todo-check').addEventListener('change', e => toggleTodoItem(id, itemId, e.target.checked));
            row.querySelector('.todo-item-del').addEventListener('click', () => deleteTodoItem(id, itemId));
        });
    });

    bindBoardDrag(container);
}

// ── 보관함 ↔ 캔버스 드래그 앤 드롭 + 클릭으로 가운데에 펼치기 ──
function bindBoardDrag(container) {
    const canvas = container.querySelector('.notes-canvas');
    const dock = container.querySelector('.notes-dock');
    if (!canvas) return;
    let draggedId = null;

    container.querySelectorAll('.dock-item').forEach(item => {
        item.addEventListener('dragstart', e => {
            draggedId = item.dataset.id;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', draggedId);
        });
        // 클릭(드래그 없이)하면 캔버스 가운데로 맨 앞에 펼치기 — 이미 가운데에 있던 메모와는
        // 살짝 어긋나게 겹쳐서 새로 편 게 뭔지 한눈에 보이게. 이후엔 손잡이로 자유롭게 옮기면 됨
        item.addEventListener('click', () => {
            const rect = canvas.getBoundingClientRect();
            const cardW = 280, cardH = 160;
            const alreadyOnCanvas = canvas.querySelectorAll('.note-card').length;
            const jitter = (alreadyOnCanvas % 6) * 24;
            const x = Math.max(0, Math.round(canvas.scrollLeft + rect.width / 2 - cardW / 2 + jitter));
            const y = Math.max(0, Math.round(canvas.scrollTop + rect.height / 2 - cardH / 2 + jitter));
            placeNoteOnBoard(item.dataset.id, x, y);
        });
    });
    container.querySelectorAll('.card-drag-handle[draggable="true"]').forEach(handle => {
        handle.addEventListener('dragstart', e => {
            draggedId = handle.closest('.note-card')?.dataset.id || null;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', draggedId || '');
            // 잡는 순간 바로 맨 앞으로 — 옮기는 동안 다른 카드에 가려 안 보이지 않게
            if (draggedId) {
                bringNoteToFront(draggedId);
                const card = handle.closest('.note-card');
                const note = state.notes.find(n => n.id === draggedId);
                if (card && note) card.style.zIndex = String(note.zIndex);
            }
        });
    });
    // 캔버스 위 카드를 그냥 클릭(입력창 제외)해도 맨 앞으로 — 겹쳐 있을 때 찾기 쉽게
    canvas.querySelectorAll('.note-card').forEach(card => {
        card.addEventListener('mousedown', e => {
            if (e.target.closest('input, textarea, button')) return;
            bringNoteToFront(card.dataset.id);
            const note = state.notes.find(n => n.id === card.dataset.id);
            if (note) card.style.zIndex = String(note.zIndex);
        });
    });

    canvas.addEventListener('dragover', e => e.preventDefault());
    canvas.addEventListener('drop', e => {
        e.preventDefault();
        if (!draggedId) return;
        const rect = canvas.getBoundingClientRect();
        const x = Math.max(0, Math.round(e.clientX - rect.left - 140 + canvas.scrollLeft));
        const y = Math.max(0, Math.round(e.clientY - rect.top - 20 + canvas.scrollTop));
        placeNoteOnBoard(draggedId, x, y);
        draggedId = null;
    });

    if (dock) {
        dock.addEventListener('dragover', e => e.preventDefault());
        dock.addEventListener('drop', e => {
            e.preventDefault();
            if (!draggedId) return;
            toggleNoteCollapse(draggedId, true);
            draggedId = null;
        });
    }
}

async function placeNoteOnBoard(id, x, y) {
    const note = state.notes.find(n => n.id === id);
    if (!note) return;
    note.collapsed = false;
    note.x = x;
    note.y = y;
    note.zIndex = nextZIndex();
    note.updatedAt = Date.now();
    await dbPut(STORE_NOTES, note);
    renderNotes(document.getElementById('content'), (state.searchQuery || '').trim().toLowerCase());
}

// 카드를 옮기지 않고 맨 앞으로만 가져오기(클릭·드래그 시작 시 즉시 반응용)
async function bringNoteToFront(id) {
    const note = state.notes.find(n => n.id === id);
    if (!note) return null;
    note.zIndex = nextZIndex();
    await dbPut(STORE_NOTES, note);
    return note.zIndex;
}

async function addNote(type = 'memo') {
    const note = type === 'todo'
        ? { id: genId(), projectId: state.currentProjectId, type: 'todo', title: '', items: [], collapsed: false, addedAt: Date.now(), updatedAt: Date.now() }
        : { id: genId(), projectId: state.currentProjectId, type: 'memo', title: '', content: '', addedAt: Date.now(), updatedAt: Date.now() };
    await dbPut(STORE_NOTES, note);
    state.notes.push(note);
    document.getElementById('notes-count').textContent = state.notes.length;
    renderNotes(document.getElementById('content'));
    const focusSel = type === 'todo' ? '.todo-add-input' : '.note-body';
    document.querySelector(`.note-card[data-id="${note.id}"] ${focusSel}`)?.focus();
}

async function saveNote(id, title, content) {
    const note = state.notes.find(n => n.id === id);
    if (!note) return;
    note.title = title;
    note.content = content;
    note.updatedAt = Date.now();
    await dbPut(STORE_NOTES, note);
}

async function saveTodoTitle(id, title) {
    const note = state.notes.find(n => n.id === id);
    if (!note) return;
    note.title = title;
    note.updatedAt = Date.now();
    await dbPut(STORE_NOTES, note);
}

async function addTodoItem(id, text) {
    const note = state.notes.find(n => n.id === id);
    if (!note) return;
    if (!note.items) note.items = [];
    note.items.push({ id: genId(), text, done: false });
    note.updatedAt = Date.now();
    await dbPut(STORE_NOTES, note);
    renderNotes(document.getElementById('content'), (state.searchQuery || '').trim().toLowerCase());
    document.querySelector(`.note-card[data-id="${id}"] .todo-add-input`)?.focus();
}

async function toggleTodoItem(id, itemId, done) {
    const note = state.notes.find(n => n.id === id);
    const item = note?.items?.find(it => it.id === itemId);
    if (!note || !item) return;
    item.done = done;
    note.updatedAt = Date.now();
    await dbPut(STORE_NOTES, note);
    renderNotes(document.getElementById('content'), (state.searchQuery || '').trim().toLowerCase());
}

async function deleteTodoItem(id, itemId) {
    const note = state.notes.find(n => n.id === id);
    if (!note) return;
    note.items = (note.items || []).filter(it => it.id !== itemId);
    note.updatedAt = Date.now();
    await dbPut(STORE_NOTES, note);
    renderNotes(document.getElementById('content'), (state.searchQuery || '').trim().toLowerCase());
}

async function cleanupTodoItems(id) {
    const note = state.notes.find(n => n.id === id);
    if (!note) return;
    note.items = (note.items || []).filter(it => !it.done);
    note.updatedAt = Date.now();
    await dbPut(STORE_NOTES, note);
    renderNotes(document.getElementById('content'), (state.searchQuery || '').trim().toLowerCase());
}

async function toggleNoteCollapse(id, forceCollapsed) {
    const note = state.notes.find(n => n.id === id);
    if (!note) return;
    note.collapsed = typeof forceCollapsed === 'boolean' ? forceCollapsed : !note.collapsed;
    await dbPut(STORE_NOTES, note);
    renderNotes(document.getElementById('content'), (state.searchQuery || '').trim().toLowerCase());
}

async function deleteNote(id) {
    const note = state.notes.find(n => n.id === id);
    if (!confirm(note?.type === 'todo' ? '이 할일을 삭제할까요?' : '이 메모를 삭제할까요?')) return;
    await dbDelete(STORE_NOTES, id);
    state.notes = state.notes.filter(n => n.id !== id);
    document.getElementById('notes-count').textContent = state.notes.length;
    renderNotes(document.getElementById('content'));
}

// ── 자료(논문이 아닌 자료) 뷰 ──────────────────────────────
// 변인 역할 색깔 정의
const MAT_VAR_ROLES = {
    '독립': { color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
    '종속': { color: '#059669', bg: '#ecfdf5', border: '#a7f3d0' },
    '매개': { color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' },
    '조절': { color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
};

function renderMaterials(container) {
    const selectMode  = !!state.materialSelectMode;
    const selectedIds = state.materialSelectedIds || new Set();

    if (state.materials.length === 0) {
        container.innerHTML = `
            <div class="paper-header pc-row-inline">
                <span class="section-title">자료 0개</span>
                <button class="btn-secondary" id="btn-add-material-inline">+ 자료 추가</button>
            </div>
            <div class="empty-state">
                <div class="empty-icon">${icon('library', 44)}</div>
                <h3>저장된 자료가 없습니다</h3>
                <p>척도, 도서, 웹자료 등을<br><strong>+ 자료 추가</strong>로 보관해보세요</p>
            </div>`;
        document.getElementById('btn-add-material-inline').onclick = () => openMaterialForm();
        return;
    }
    const sorted = [...state.materials].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const selectBar = selectMode ? `
        <div class="paper-select-bar">
            <button class="btn-sel-all"    id="btn-mat-sel-all">전체 선택</button>
            <button class="btn-sel-none"   id="btn-mat-sel-none">전체 해제</button>
            <button class="btn-sel-del"    id="btn-mat-sel-del">선택 삭제 (${selectedIds.size}개)</button>
            <button class="btn-sel-cancel" id="btn-mat-sel-cancel">취소</button>
        </div>` : '';

    container.innerHTML = `
        <div class="paper-header pc-row-inline">
            <span class="section-title">자료 ${state.materials.length}개</span>
            <button class="btn-paper-select ${selectMode ? 'active' : ''}" id="btn-mat-select-mode">
                ${selectMode ? '선택 중…' : '선택 삭제'}
            </button>
            <button class="btn-secondary" id="btn-add-material-inline" style="margin-left:auto">+ 자료 추가</button>
        </div>
        ${selectBar}
        <div class="mat-list">${sorted.map(m => materialRowHTML(m, selectMode, selectedIds)).join('')}</div>`;

    document.getElementById('btn-add-material-inline').onclick = () => openMaterialForm();
    document.getElementById('btn-mat-select-mode').onclick = () => {
        state.materialSelectMode = !state.materialSelectMode;
        state.materialSelectedIds = new Set();
        renderContent();
    };
    if (selectMode) {
        document.getElementById('btn-mat-sel-all').onclick = () => {
            state.materialSelectedIds = new Set(state.materials.map(m => m.id));
            renderContent();
        };
        document.getElementById('btn-mat-sel-none').onclick = () => {
            state.materialSelectedIds = new Set();
            renderContent();
        };
        document.getElementById('btn-mat-sel-cancel').onclick = () => {
            state.materialSelectMode = false;
            state.materialSelectedIds = new Set();
            renderContent();
        };
        document.getElementById('btn-mat-sel-del').onclick = async () => {
            const ids = [...state.materialSelectedIds];
            if (!ids.length) { showToast('선택된 자료가 없습니다.', 'warn'); return; }
            if (!confirm(`자료 ${ids.length}개를 삭제할까요?`)) return;
            for (const id of ids) await dbDelete(STORE_MATERIALS, id);
            state.materialSelectMode = false;
            state.materialSelectedIds = new Set();
            await loadData();
            renderContent();
            showToast(`자료 ${ids.length}개가 삭제되었습니다.`, 'success');
        };
    }
    bindMaterialRows(container);
}

function renderMaterialSearch(q, container) {
    const matches = state.materials.filter(m => materialMatchesQuery(m, q));
    if (matches.length === 0) {
        container.innerHTML = `
            <div class="search-results-info">"<strong>${escHtml(q)}</strong>" 자료 검색 결과 없음</div>
            <div class="empty-state"><div class="empty-icon">${icon('search', 44)}</div><h3>결과가 없습니다</h3></div>`;
        return;
    }
    container.innerHTML = `
        <div class="search-results-info">"<strong>${escHtml(q)}</strong>" 자료 검색 결과 ${matches.length}개</div>
        <div class="mat-list">${matches.map(m => materialRowHTML(m, false, new Set())).join('')}</div>`;
    bindMaterialRows(container);
}

function materialMatchesQuery(m, q) {
    return [m.title, m.authors, m.source, m.note, m.type, m.fileName, m.varRole]
        .some(f => f && String(f).toLowerCase().includes(q));
}

function materialRowHTML(m, selectMode = false, selectedIds = new Set()) {
    const checked = selectedIds.has(m.id);
    const role = m.varRole && MAT_VAR_ROLES[m.varRole];
    const roleTag = role
        ? `<span class="mat-var-role" style="color:${role.color};background:${role.bg};border-color:${role.border}">${m.varRole}</span>`
        : '';
    return `
        <div class="mat-row ${selectMode && checked ? 'mat-selected' : ''}" data-id="${m.id}">
            ${selectMode
                ? `<input type="checkbox" class="mat-checkbox" data-id="${m.id}" ${checked ? 'checked' : ''}>`
                : ''}
            <span class="mat-type-badge mt-${escHtml(m.type || '기타')}">${escHtml(m.type || '기타')}</span>
            <span class="mat-title">${escHtml(m.title || '제목 없음')}</span>
            ${m.authors ? `<span class="mat-authors">${escHtml(m.authors)}</span>` : '<span class="mat-authors"></span>'}
            ${roleTag || '<span></span>'}
            ${m.source ? `<span class="mat-source">${escHtml(m.source)}</span>` : '<span class="mat-source"></span>'}
            ${m.fileData ? `<span class="mat-icon" title="첨부파일 있음">${icon('paperclip', 13)}</span>` : '<span></span>'}
        </div>`;
}

function bindMaterialRows(container) {
    const selectMode = !!state.materialSelectMode;
    container.querySelectorAll('.mat-row').forEach(row => {
        if (selectMode) {
            const cb = row.querySelector('.mat-checkbox');
            if (cb) cb.addEventListener('change', () => {
                if (cb.checked) state.materialSelectedIds.add(cb.dataset.id);
                else state.materialSelectedIds.delete(cb.dataset.id);
                // 삭제 버튼 카운트 갱신
                const delBtn = document.getElementById('btn-mat-sel-del');
                if (delBtn) delBtn.textContent = `선택 삭제 (${state.materialSelectedIds.size}개)`;
                row.classList.toggle('mat-selected', cb.checked);
            });
            row.addEventListener('click', e => {
                if (e.target.type === 'checkbox') return;
                if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
            });
        } else {
            row.addEventListener('click', () => openMaterialForm(row.dataset.id, 'view'));
        }
    });
}

// ── 자료 추가/수정/보기 통합 모달 ───────────────────────────
function openMaterialForm(editId = null, mode = null) {
    mode = mode || (editId ? 'view' : 'edit');
    state.editingMaterialId = editId;
    state.materialMode = mode;
    state.currentMaterialFile = null;

    const m = editId ? state.materials.find(x => x.id === editId) : null;
    document.getElementById('m-type').value = m?.type || '척도';
    document.getElementById('m-varrole').value = m?.varRole || '';
    document.getElementById('m-title').value = m?.title || '';
    document.getElementById('m-authors').value = m?.authors || '';
    document.getElementById('m-source').value = m?.source || '';
    document.getElementById('m-note').value = m?.note || '';
    document.getElementById('mfile-name').textContent =
        m?.fileData ? (m.fileName || '첨부파일 있음') : '선택된 파일 없음';

    applyMaterialMode(mode, m);
    document.getElementById('modal-material').style.display = 'flex';
}

function applyMaterialMode(mode, m) {
    const modal = document.querySelector('#modal-material .modal');
    modal.classList.toggle('view-mode', mode === 'view');
    modal.classList.toggle('edit-mode', mode === 'edit');
    document.querySelectorAll('#material-form input, #material-form textarea').forEach(el => {
        if (el.type !== 'file') el.readOnly = (mode === 'view');
    });
    document.getElementById('m-type').disabled = (mode === 'view');
    document.getElementById('m-varrole').disabled = (mode === 'view');

    document.getElementById('modal-material-title').textContent =
        mode === 'view' ? (m?.title || '자료 보기')
        : (state.editingMaterialId ? '자료 수정' : '자료 추가');

    // 하단 버튼 설정
    const fileBtn = document.getElementById('btn-mat-open-file');
    const deskBtn = document.getElementById('btn-mat-desk');
    fileBtn.style.display = 'none';
    if (mode === 'view' && m) {
        deskBtn.style.display = '';
        deskBtn.onclick = () => { closeMaterialForm(); openDeskMaterial(m.id); };
    } else {
        deskBtn.style.display = 'none';
    }
}

function closeMaterialForm() {
    document.getElementById('modal-material').style.display = 'none';
    state.editingMaterialId = null;
    state.materialMode = 'edit';
}

async function saveMaterial(e) {
    e.preventDefault();
    if (state.materialMode === 'view') return;
    const title = document.getElementById('m-title').value.trim();
    if (!title) { showToast('제목을 입력해주세요', 'error'); return; }

    let fileData = null, fileName = null;
    if (state.editingMaterialId) {
        const ex = state.materials.find(x => x.id === state.editingMaterialId);
        if (ex?.fileData) { fileData = ex.fileData; fileName = ex.fileName; }
    }
    if (state.currentMaterialFile) {
        fileData = await readFile(state.currentMaterialFile);
        fileName = state.currentMaterialFile.name;
    }

    const v = id => document.getElementById(id).value.trim();
    const material = {
        id: state.editingMaterialId || genId(),
        type: document.getElementById('m-type').value,
        title,
        authors: v('m-authors'),
        varRole: document.getElementById('m-varrole').value || '',
        source: v('m-source'),
        note: v('m-note'),
        fileData,
        fileName,
        projectId: state.currentProjectId,
        addedAt: state.editingMaterialId
            ? (state.materials.find(x => x.id === state.editingMaterialId)?.addedAt || Date.now())
            : Date.now(),
        updatedAt: Date.now(),
    };

    const wasEditing = !!state.editingMaterialId;
    await dbPut(STORE_MATERIALS, material);
    await loadData();
    renderContent();
    showToast(wasEditing ? '자료가 수정되었습니다' : '자료가 추가되었습니다', 'success');
    if (wasEditing) openMaterialForm(material.id, 'view');
    else closeMaterialForm();
}

async function deleteMaterial(id) {
    if (!confirm('이 자료를 삭제할까요?')) return;
    await dbDelete(STORE_MATERIALS, id);
    await loadData();
    renderContent();
    closeMaterialForm();
    showToast('자료가 삭제되었습니다', 'success');
}

async function openMaterialFile(m) {
    // 로컬에 파일 없으면 클라우드에서 lazy 다운로드
    if (!m.fileData) {
        if (typeof cloudGetFile === 'function' && currentUser) {
            showToast('파일 다운로드 중…', 'info');
            const data = await cloudGetFile(m.id, m.fileName);
            if (data) {
                m = { ...m, fileData: data };
                await dbPut(STORE_MATERIALS, m);
                const idx = state.materials.findIndex(x => x.id === m.id);
                if (idx >= 0) state.materials[idx] = m;
            }
        }
        if (!m.fileData) return;
    }
    const blob = new Blob([m.fileData]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    if (m.fileName) a.download = m.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ── 보기 모드 부가 정보 (인용·APA·관련 논문) ────────────────
// 통합 모달의 '보기' 모드에서만 폼 위쪽에 표시한다.
function renderViewExtras(paper) {
    const box = document.getElementById('view-extras');
    if (!paper) { box.innerHTML = ''; return; }

    const apaRef = formatAPA(paper);
    const inText = formatInText(paper);
    const related = findRelatedPapers(paper);

    box.innerHTML = `
        <div class="ve-meta">${[paper.authors, paper.year, paper.source].filter(Boolean).map(escHtml).join(' · ') || '<span class="muted">서지정보 없음</span>'}</div>
        <div class="ve-actions">
            ${paper.pdfData ? `<button type="button" class="btn-pdf" id="ve-pdf">${icon('paperclip')} PDF 열기</button>` : ''}
            ${paper.pdfLink ? `<a class="btn-secondary ve-pdflink" href="${escHtml(paper.pdfLink)}" target="_blank" rel="noopener">${icon('link', 14)} 드라이브에서 열기</a>` : ''}
            <button type="button" class="btn-cite" id="ve-cite">${icon('copy')} ${escHtml(inText || '본문 인용')} 복사</button>
            <button type="button" class="btn-apa-copy" id="ve-apa">${icon('clipboard')} APA 복사</button>
        </div>
        <div class="ve-apa">
            <div class="ve-apa-label">APA 참고문헌</div>
            <div class="ve-apa-text">${apaRef ? formatAPAParts(paper).html : '<span class="muted">서지정보를 입력하면 생성됩니다</span>'}</div>
        </div>
        ${related.length ? `
        <div class="ve-related">
            <div class="ve-related-title">${icon('link', 14)} 관련 논문 ${related.length}편</div>
            ${related.map(r => `
                <div class="ve-related-item" data-id="${r.paper.id}">
                    <span class="ve-related-name">${escHtml(r.paper.title || '제목 없음')}${r.paper.year ? ` (${escHtml(r.paper.year)})` : ''}</span>
                    <span class="ve-related-reason">${escHtml(r.reason)}</span>
                </div>`).join('')}
        </div>` : ''}
        ${viewExcerptsHTML(paper)}`;

    if (paper.pdfData) box.querySelector('#ve-pdf').onclick = () => openPdf(paper);
    box.querySelector('#ve-cite').onclick = async () => {
        const ok = await copyToClipboard(inText);
        showToast(ok ? `${inText} 복사됐습니다` : '복사 실패', ok ? 'success' : 'error');
    };
    box.querySelector('#ve-apa').onclick = async () => {
        const { text, html } = formatAPAParts(paper);
        const ok = await copyRich(html, text);
        showToast(ok ? 'APA 참고문헌이 복사됐습니다 (기울임 포함)' : '복사 실패', ok ? 'success' : 'error');
    };
    box.querySelectorAll('.ve-related-item').forEach(el => {
        el.onclick = () => openForm(el.dataset.id, 'view');
    });
    bindViewExcerpts(box, paper);
}

// 보기 모달 — 담은 발췌를 카테고리(=내용 항목)별로 묶어 표시. 미지정/옛 cat은 '자유/기타'로.
function viewExcerptsHTML(paper) {
    const list = paper.excerpts || [];
    if (!list.length) return '';
    const known = new Set(EXCERPT_CATS.map(([k]) => k));
    const catOf = e => (known.has(e.cat) ? e.cat : 'free');
    const groupsHTML = EXCERPT_CATS.map(([k, label]) => {
        const items = list.filter(e => catOf(e) === k);
        if (!items.length) return '';
        const cards = items.map(e => `
            <div class="ve-ex-card" data-eid="${e.id}">
                <div class="ve-ex-text" contenteditable="true" data-eid="${e.id}">${escHtml(e.text)}</div>
                <div class="ve-ex-memo" contenteditable="true" data-eid="${e.id}" data-ph="＋ 메모">${escHtml(e.memo || '')}</div>
                <button type="button" class="ve-ex-del" data-eid="${e.id}" title="이 발췌 삭제">${icon('trash', 13)}</button>
            </div>`).join('');
        return `
            <div class="ve-ex-group">
                <div class="ve-ex-gtitle"><span class="desk-ex-badge">${escHtml(label)}</span><span class="desk-ex-count">${items.length}</span></div>
                ${cards}
            </div>`;
    }).join('');
    return `
        <div class="ve-excerpts">
            <div class="ve-excerpts-title">${icon('clipboard', 14)} 담은 발췌 ${list.length}개 <span class="muted">· 연구 책상에서 분류한 내용</span></div>
            ${groupsHTML}
        </div>`;
}

function bindViewExcerpts(box, paper) {
    box.querySelectorAll('.ve-ex-text, .ve-ex-memo').forEach(el =>
        el.addEventListener('blur', () => {
            const e = (paper.excerpts || []).find(x => x.id === el.dataset.eid);
            if (!e) return;
            const field = el.classList.contains('ve-ex-memo') ? 'memo' : 'text';
            const val = el.textContent.trim();
            if (e[field] !== val) { e[field] = val; dbPut(STORE_PAPERS, paper); }
        }));
    box.querySelectorAll('.ve-ex-del').forEach(b =>
        b.addEventListener('click', () => {
            paper.excerpts = (paper.excerpts || []).filter(x => x.id !== b.dataset.eid);
            dbPut(STORE_PAPERS, paper);
            renderViewExtras(paper);
        }));
}

// ── 관련 논문 ──────────────────────────────────────────────
function findRelatedPapers(paper) {
    const myVars = new Set((paper.variables || []).map(v => v.toLowerCase()));
    const myTags = new Set((paper.tags || []).map(t => t.toLowerCase()));
    const results = [];

    state.papers.forEach(p => {
        if (p.id === paper.id) return;
        const reasons = [];
        const sv = (p.variables || []).filter(v => myVars.has(v.toLowerCase()));
        if (sv.length) reasons.push(`공통 변인: ${sv.join(', ')}`);
        const st = (p.tags || []).filter(t => myTags.has(t.toLowerCase()));
        if (st.length) reasons.push(`공통 태그: ${st.join(', ')}`);
        if (reasons.length) results.push({ paper: p, reason: reasons.join(' · '), score: sv.length * 2 + st.length });
    });

    return results.sort((a, b) => b.score - a.score).slice(0, 5);
}

// ── PDF 열기 ───────────────────────────────────────────────
async function openPdf(paper) {
    // 로컬에 PDF 없으면 클라우드에서 lazy 다운로드
    if (!paper.pdfData) {
        if (typeof cloudGetPdf === 'function' && currentUser) {
            showToast('PDF 다운로드 중…', 'info');
            const data = await cloudGetPdf(paper.id, paper.pdfFilename);
            if (data) {
                paper = { ...paper, pdfData: data };
                await dbPut(STORE_PAPERS, paper);
                const idx = state.papers.findIndex(p => p.id === paper.id);
                if (idx >= 0) state.papers[idx] = paper;
            }
        }
        if (!paper.pdfData) return;
    }
    const blob = new Blob([paper.pdfData], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ── 책상(Desk): 논문을 전체화면으로 펼쳐 읽는 작업공간 ──────────────
// 1단계 = 골격. desk* 네임스페이스, 오버레이를 동적 생성/제거, DB 변경 없음.
// (2단계: 오른쪽 패널에 발췌·메모. 4단계: 스케치북 같이.)
let deskCtx = null;        // 살아있는 DOM 컨텍스트 { overlay, pdfUrl, onMove, onUp, _pct }
let deskTabs = [];         // 책상에 펼쳐둔 논문 id들 (다른 화면 갔다 와도 유지)
let deskActiveId = null;   // 현재 보고 있는 논문 id
let deskMatTabs = [];      // 책상에 펼쳐둔 자료 id들
let deskMatActiveId = null; // 현재 보고 있는 자료 id (논문 활성 중이면 null)
let deskFramePool = {};    // 'p_id' | 'm_id' → { el, pdfUrl } — 한 번 그린 left 패널 재사용

// 모형스케치북의 「책상」 버튼 — 책상 화면으로 돌아가기(펼쳐둔 논문 유지)
function reopenDesk() {
    document.querySelector('.nav-item[data-view="desk"]')?.click();
}

// 논문 목록의 「책상에서 펼치기」 — 책상 화면으로 가서 그 논문을 펼침
function openDesk(paperId) {
    const paper = state.papers.find(p => p.id === paperId);
    if (!paper) return;
    if (!deskTabs.includes(paperId)) deskTabs.push(paperId);
    deskActiveId = paperId;
    deskMatActiveId = null;
    if (state.view === 'desk' && deskCtx) deskActivate(paperId);
    else document.querySelector('.nav-item[data-view="desk"]')?.click();
}

// 자료 목록의 「책상에서 펼치기」
function openDeskMaterial(materialId) {
    const mat = state.materials.find(m => m.id === materialId);
    if (!mat) return;
    if (!deskMatTabs.includes(materialId)) deskMatTabs.push(materialId);
    deskMatActiveId = materialId;
    deskActiveId = null;
    if (state.view === 'desk' && deskCtx) deskActivateMat(materialId);
    else document.querySelector('.nav-item[data-view="desk"]')?.click();
}

// 책상 화면 그리기(.content 안에 렌더) — 논문을 안 열어도 열림
function renderDesk(container) {
    deskTeardown();                       // 이전 책상 리소스/리스너 정리(탭 목록 deskTabs는 보존)
    deskTabs = deskTabs.filter(id => state.papers.some(p => p.id === id));
    deskMatTabs = deskMatTabs.filter(id => state.materials.some(m => m.id === id));
    const pct = Math.max(25, Math.min(80, parseInt(localStorage.getItem('deskLeftPct') || '60', 10) || 60));
    container.style.padding = '0';
    container.style.overflow = 'hidden';
    container.innerHTML = `
        <div class="desk-view" id="desk-view">
            <div class="desk-topbar">
                <div class="desk-tabs" id="desk-tabs"></div>
                <div class="desk-topbar-actions">
                    <button type="button" class="desk-summary" id="desk-summary-btn" title="현재 논문 요약보기">${icon('eye')} 요약보기</button>
                    <button type="button" class="desk-sketch" title="모형스케치북으로 — 거기서 「책상」으로 돌아옴">${icon('nodes')} 스케치북</button>
                </div>
            </div>
            <div class="desk-body">
                <div class="desk-pane desk-left" id="desk-left" style="flex:0 0 ${pct}%">
                    <div class="desk-drag-shield" id="desk-drag-shield"></div>
                </div>
                <div class="desk-resizer" id="desk-resizer" title="끌어서 폭 조절"></div>
                <div class="desk-pane desk-right" id="desk-right"></div>
            </div>
        </div>`;
    const root = container.querySelector('#desk-view');
    deskCtx = { overlay: root, pdfUrl: null };
    root.querySelector('.desk-sketch').addEventListener('click', () =>
        document.querySelector('.nav-item[data-view="sketch"]')?.click());
    root.querySelector('#desk-summary-btn').addEventListener('click', () => {
        if (deskActiveId) openForm(deskActiveId, 'view');
        else if (deskMatActiveId) openMaterialForm(deskMatActiveId, 'view');
    });
    bindDeskResizer(root);

    if (deskActiveId && deskTabs.includes(deskActiveId)) deskActivate(deskActiveId);
    else if (deskMatActiveId && deskMatTabs.includes(deskMatActiveId)) deskActivateMat(deskMatActiveId);
    else if (deskTabs.length) deskActivate(deskTabs[0]);
    else if (deskMatTabs.length) deskActivateMat(deskMatTabs[0]);
    else deskRenderEmpty();
}

// 논문을 아직 안 펼친 빈 책상 — 왼쪽은 안내, 오른쪽 패널(발표자료 탭)은 그대로 동작
function deskRenderEmpty() {
    if (!deskCtx) return;
    deskActiveId = null;
    const { overlay } = deskCtx;
    deskCtx.pdfUrl = null;
    // pool 슬롯들은 유지하되 모두 숨기기
    Object.values(deskFramePool).forEach(({el}) => { el.style.display = 'none'; });
    const left = overlay.querySelector('#desk-left');
    let emptyDiv = left.querySelector('.desk-empty');
    if (!emptyDiv) {
        emptyDiv = document.createElement('div');
        emptyDiv.className = 'desk-empty';
        left.appendChild(emptyDiv);
    }
    emptyDiv.style.display = '';
    emptyDiv.innerHTML = `
        ${icon('book-open', 46)}
        <h3>내 연구책상</h3>
        <p>논문이나 자료를 펼쳐 읽으며 중요한 내용을 발췌하고,<br>오른쪽에서 메모·태그·발표자료를 정리하는 공간이에요.</p>
        <button type="button" class="btn-primary" id="desk-empty-pick">＋ 논문 / 자료 펼치기</button>`;
    overlay.querySelector('#desk-right').innerHTML = deskRightHTML(null);
    bindDeskRight(overlay, null);
    deskRenderTabs();
    overlay.querySelector('#desk-empty-pick')?.addEventListener('click', deskOpenPicker);
}

// 책상에서 다른 화면으로 나갈 때 리소스 정리 — 펼쳐둔 논문(deskTabs)은 유지
// ── 북마크 팝업 ─────────────────────────────────────────────────────────
function openDeskBmPopup(anchorEl, item, storeKey) {
    // 이미 열려있으면 닫기
    const existing = document.getElementById('desk-bm-popup');
    if (existing) { existing.remove(); return; }

    const bookmarks = (item.deskBookmarks || []);
    const totalPages = item.readTotalPages || 0;
    const goalDate = item.readGoalDate || '';
    const currentPage = bookmarks.length ? bookmarks[0].page : 0;

    // 진도 바 — 전체 페이지만 있어도 표시 (0%부터)
    let progressHTML = '';
    if (totalPages > 0) {
        const pct = Math.min(100, Math.round(currentPage / totalPages * 100));
        let goalInfo = '';
        if (goalDate) {
            const today = new Date(); today.setHours(0,0,0,0);
            const goal = new Date(goalDate); goal.setHours(0,0,0,0);
            const daysLeft = Math.ceil((goal - today) / 86400000);
            const pagesLeft = Math.max(0, totalPages - currentPage);
            if (daysLeft > 0 && pagesLeft > 0) {
                goalInfo = `<span class="desk-bm-goal-chip">📅 ${daysLeft}일 남음 · 하루 <b>${Math.ceil(pagesLeft/daysLeft)}p</b></span>`;
            } else if (pagesLeft === 0) {
                goalInfo = `<span class="desk-bm-goal-chip">🎉 완독!</span>`;
            } else {
                goalInfo = `<span class="desk-bm-goal-chip" style="color:var(--danger,#e53935)">⚠️ 목표일 지남</span>`;
            }
        }
        progressHTML = `<div class="desk-bm-progress-wrap">
            <div class="desk-bm-progress-label">
                <span>p.${currentPage} / ${totalPages} <span style="color:var(--primary);font-weight:600">(${pct}%)</span></span>
                ${goalInfo}
            </div>
            <div class="desk-bm-progress-bar"><div class="desk-bm-progress-fill" style="width:${pct}%"></div></div>
        </div>`;
    }

    const bmItems = bookmarks.map((bm, i) => {
        const d = bm.date ? new Date(bm.date).toLocaleDateString('ko-KR', { month:'numeric', day:'numeric' }) : '';
        return `<div class="desk-bm-item">
            <button type="button" class="desk-bm-page" data-page="${bm.page}">p.${bm.page}</button>
            <span class="desk-bm-date">${d}</span>
            <button type="button" class="desk-bm-del" data-idx="${i}">✕</button>
        </div>`;
    }).join('');

    const popup = document.createElement('div');
    popup.id = 'desk-bm-popup';
    popup.className = 'desk-bm-popup';
    popup.innerHTML = `
        <div class="desk-bm-popup-head">
            <span>📌 북마크</span>
            <button type="button" class="desk-bm-popup-close" id="desk-bm-popup-close">✕</button>
        </div>
        ${progressHTML}
        <div class="desk-bm-setup-grid">
            <span class="desk-bm-setup-label">전체 페이지</span>
            <input type="number" class="desk-bm-setup-input-sm" id="desk-bm-total" placeholder="예: 303" min="1" value="${totalPages || ''}">
            <span class="desk-bm-setup-label">완독예상일</span>
            <input type="date" class="desk-bm-setup-input-sm" id="desk-bm-goal" value="${goalDate}">
            <button type="button" class="btn-secondary" id="desk-bm-setup-save" style="grid-column:1/-1;font-size:12px;padding:4px 10px;width:100%">설정 저장</button>
        </div>
        <div class="desk-bm-divider"></div>
        <div class="desk-bm-list">${bmItems || '<div class="desk-bm-empty">아직 북마크 없음</div>'}</div>
        <div class="desk-bm-input-row">
            <input type="number" class="desk-bm-input" id="desk-bm-input" placeholder="현재 페이지" min="1">
            <button type="button" class="btn-primary" id="desk-bm-add">📌</button>
        </div>
        <div class="desk-bm-hint">PDF 뷰어 상단 페이지 번호 입력 후 저장</div>`;

    // 앵커 기준 위치
    const rect = anchorEl.getBoundingClientRect();
    popup.style.top = (rect.bottom + 6) + 'px';
    popup.style.left = rect.left + 'px';
    document.body.appendChild(popup);

    // 바깥 클릭 시 닫기
    const closePopup = (e) => {
        if (!popup.contains(e.target) && e.target !== anchorEl) {
            popup.remove();
            document.removeEventListener('mousedown', closePopup);
        }
    };
    setTimeout(() => document.addEventListener('mousedown', closePopup), 0);

    popup.querySelector('#desk-bm-popup-close').addEventListener('click', () => {
        popup.remove();
        document.removeEventListener('mousedown', closePopup);
    });

    // 설정 저장
    popup.querySelector('#desk-bm-setup-save').addEventListener('click', () => {
        item.readTotalPages = parseInt(popup.querySelector('#desk-bm-total')?.value || '', 10) || 0;
        item.readGoalDate = popup.querySelector('#desk-bm-goal')?.value || '';
        dbPut(storeKey, item);
        const arr = storeKey === STORE_PAPERS ? state.papers : state.materials;
        const idx = arr.findIndex(x => x.id === item.id);
        if (idx >= 0) arr[idx] = item;
        popup.remove();
        document.removeEventListener('mousedown', closePopup);
        openDeskBmPopup(anchorEl, item, storeKey);
        showToast('독서 설정 저장됨', 'success');
    });

    // 북마크 저장
    const saveBm = () => {
        const inp = popup.querySelector('#desk-bm-input');
        const page = parseInt(inp?.value || '', 10);
        if (!page || page < 1) { showToast('페이지 번호를 입력하세요', 'warn'); return; }
        if (!Array.isArray(item.deskBookmarks)) item.deskBookmarks = [];
        item.deskBookmarks.unshift({ page, date: Date.now() });
        dbPut(storeKey, item);
        const arr = storeKey === STORE_PAPERS ? state.papers : state.materials;
        const idx = arr.findIndex(x => x.id === item.id);
        if (idx >= 0) arr[idx] = item;
        popup.remove();
        document.removeEventListener('mousedown', closePopup);
        openDeskBmPopup(anchorEl, item, storeKey);
        showToast(`p.${page} 북마크 저장됨`, 'success');
    };
    popup.querySelector('#desk-bm-add').addEventListener('click', saveBm);
    popup.querySelector('#desk-bm-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveBm(); } });

    // 페이지 이동
    popup.querySelectorAll('.desk-bm-page').forEach(b =>
        b.addEventListener('click', () => deskNavToPage(b.dataset.page)));

    // 북마크 삭제
    popup.querySelectorAll('.desk-bm-del').forEach(b =>
        b.addEventListener('click', () => {
            item.deskBookmarks.splice(Number(b.dataset.idx), 1);
            dbPut(storeKey, item);
            const arr = storeKey === STORE_PAPERS ? state.papers : state.materials;
            const idx = arr.findIndex(x => x.id === item.id);
            if (idx >= 0) arr[idx] = item;
            popup.remove();
            document.removeEventListener('mousedown', closePopup);
            openDeskBmPopup(anchorEl, item, storeKey);
        }));
}

function deskTeardown() {
    if (!deskCtx) return;
    if (deskCtx.onMove) window.removeEventListener('mousemove', deskCtx.onMove);
    if (deskCtx.onUp)   window.removeEventListener('mouseup', deskCtx.onUp);
    Object.values(deskFramePool).forEach(({pdfUrl}) => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); });
    // 필기모드 뒷정리 — 쪽 감시자 해제 + pdf.js가 쥐고 있던 메모리 반환
    Object.values(deskFramePool).forEach(({el}) => {
        const s = deskPenState.get(el);
        if (!s) return;
        if (s.io) { s.io.disconnect(); s.io = null; }
        if (s.pdf) { try { s.pdf.destroy(); } catch (_) {} s.pdf = null; }
    });
    deskFramePool = {};
    deskCtx = null;
}

// 탭 전환 — 왼쪽(PDF/본문)·오른쪽(발췌)을 그 논문으로 갈아끼움
function deskActivate(paperId) {
    if (!deskCtx) return;
    const paper = state.papers.find(p => p.id === paperId);
    if (!paper) return;
    deskActiveId = paperId;
    deskMatActiveId = null;
    const { overlay } = deskCtx;
    const left = overlay.querySelector('#desk-left');
    const key = 'p_' + paperId;

    // empty 안내 + 모든 frame 숨기기
    left.querySelector('.desk-empty')?.remove();
    Object.values(deskFramePool).forEach(({el}) => { el.style.display = 'none'; });

    if (!deskFramePool[key]) {
        const pdfUrl = paper.pdfData
            ? URL.createObjectURL(new Blob([paper.pdfData], { type: 'application/pdf' }))
            : null;
        const startPage = (paper.deskBookmarks || []).length ? paper.deskBookmarks[0].page : 0;
        const el = document.createElement('div');
        el.className = 'desk-frame-slot';
        el.innerHTML = deskLeftHTML(paper, pdfUrl, false, startPage);
        left.appendChild(el);
        deskFramePool[key] = { el, pdfUrl };
        bindDeskLeftToggles(overlay, paper, el);
    }
    deskFramePool[key].el.style.display = '';
    deskCtx.pdfUrl = deskFramePool[key].pdfUrl;

    overlay.querySelector('#desk-right').innerHTML = deskRightHTML(paper);
    bindDeskRight(overlay, paper);
    deskRenderTabs();
}

// 텍스트 ↔ PDF/링크 전환 버튼 바인딩 (slot 단위로 교체 — desk-left 전체 교체 금지)
function bindDeskLeftToggles(overlay, paper, slot) {
    const pdfUrl = deskFramePool['p_' + paper.id]?.pdfUrl || null;
    slot.querySelector('#desk-toggle-text')?.addEventListener('click', () => {
        slot.innerHTML = deskLeftHTML(paper, pdfUrl, true);
        bindDeskLeftToggles(overlay, paper, slot);
    });
    slot.querySelector('#desk-toggle-pdf')?.addEventListener('click', () => {
        slot.innerHTML = deskLeftHTML(paper, pdfUrl, false);
        bindDeskLeftToggles(overlay, paper, slot);
    });
    slot.querySelector('#desk-toggle-link')?.addEventListener('click', () => {
        slot.innerHTML = deskLeftHTML(paper, pdfUrl, false);
        bindDeskLeftToggles(overlay, paper, slot);
    });
    slot.querySelector('#desk-bm-btn')?.addEventListener('click', function() {
        openDeskBmPopup(this, paper, STORE_PAPERS);
    });
    // 액자 → 필기모드 되돌리기
    slot.querySelector('#desk-pen-on')?.addEventListener('click', () => {
        deskPenView = 'pen';
        localStorage.setItem('deskPenView', 'pen');
        slot.innerHTML = deskLeftHTML(paper, pdfUrl, false);
        bindDeskLeftToggles(overlay, paper, slot);
    });
    // 필기모드 화면이면 PDF를 직접 그린다
    if (slot.querySelector('#desk-pen-scroll')) bindDeskPen(overlay, paper, slot);
}

// 상단 탭 줄 렌더 + 바인딩 (논문 + 자료 통합)
function deskRenderTabs() {
    const { overlay } = deskCtx;
    const tabsEl = overlay.querySelector('#desk-tabs');
    const paperTabHTML = deskTabs.map(id => {
        const p = state.papers.find(x => x.id === id);
        if (!p) return '';
        const title = p.title || '제목 없음';
        return `
            <div class="desk-tab ${id === deskActiveId ? 'active' : ''}" data-id="${id}" data-kind="paper" title="${escHtml(title)}">
                <span class="desk-tab-icon">${p.pdfData ? icon('file-text', 14) : icon('note', 14)}</span>
                <span class="desk-tab-title">${escHtml(title)}</span>
                <button type="button" class="desk-tab-close" data-id="${id}" data-kind="paper" title="닫기">✕</button>
            </div>`;
    }).join('');
    const matTabHTML = deskMatTabs.map(id => {
        const m = state.materials.find(x => x.id === id);
        if (!m) return '';
        const title = m.title || '제목 없음';
        return `
            <div class="desk-tab desk-tab-mat ${id === deskMatActiveId ? 'active' : ''}" data-id="${id}" data-kind="material" title="${escHtml(title)}">
                <span class="desk-tab-icon">${icon('library', 14)}</span>
                <span class="desk-tab-title">${escHtml(title)}</span>
                <button type="button" class="desk-tab-close" data-id="${id}" data-kind="material" title="닫기">✕</button>
            </div>`;
    }).join('');
    tabsEl.innerHTML = paperTabHTML + matTabHTML +
        `<button type="button" class="desk-tab-add" id="desk-tab-add" title="논문/자료 꺼내기">＋</button>`;

    tabsEl.querySelectorAll('.desk-tab').forEach(t =>
        t.addEventListener('click', e => {
            if (e.target.closest('.desk-tab-close')) return;
            if (t.dataset.kind === 'material') deskActivateMat(t.dataset.id);
            else deskActivate(t.dataset.id);
        }));
    tabsEl.querySelectorAll('.desk-tab-close').forEach(b =>
        b.addEventListener('click', e => {
            e.stopPropagation();
            if (b.dataset.kind === 'material') deskCloseMatTab(b.dataset.id);
            else deskCloseTab(b.dataset.id);
        }));
    tabsEl.querySelector('#desk-tab-add').addEventListener('click', deskOpenPicker);
}

// 탭 닫기 — 마지막 하나를 닫으면 빈 책상(안내 화면)으로
function deskCloseTab(id) {
    const i = deskTabs.indexOf(id);
    if (i < 0) return;
    deskTabs.splice(i, 1);
    if (deskActiveId === id) deskActiveId = null;
    // pool에서 제거 및 blob URL 해제
    const key = 'p_' + id;
    if (deskFramePool[key]) {
        if (deskFramePool[key].pdfUrl) URL.revokeObjectURL(deskFramePool[key].pdfUrl);
        deskFramePool[key].el.remove();
        delete deskFramePool[key];
    }
    if (deskTabs.length === 0 && deskMatTabs.length === 0) { deskRenderEmpty(); return; }
    if (deskActiveId === null) {
        if (deskTabs.length) deskActivate(deskTabs[Math.max(0, i - 1)]);
        else deskActivateMat(deskMatTabs[0]);
    } else deskRenderTabs();
}

// 자료 탭 닫기
function deskCloseMatTab(id) {
    const i = deskMatTabs.indexOf(id);
    if (i < 0) return;
    deskMatTabs.splice(i, 1);
    if (deskMatActiveId === id) deskMatActiveId = null;
    // pool에서 제거 및 blob URL 해제
    const key = 'm_' + id;
    if (deskFramePool[key]) {
        if (deskFramePool[key].pdfUrl) URL.revokeObjectURL(deskFramePool[key].pdfUrl);
        deskFramePool[key].el.remove();
        delete deskFramePool[key];
    }
    if (deskTabs.length === 0 && deskMatTabs.length === 0) { deskRenderEmpty(); return; }
    if (deskMatActiveId === null && deskActiveId === null) {
        if (deskMatTabs.length) deskActivateMat(deskMatTabs[Math.max(0, i - 1)]);
        else deskActivate(deskTabs[0]);
    } else deskRenderTabs();
}

// "＋" — 현재 프로젝트 논문·자료 중 안 열린 것 고르기
function deskOpenPicker() {
    const { overlay } = deskCtx;
    overlay.querySelector('.desk-picker')?.remove();
    const openP = new Set(deskTabs);
    const openM = new Set(deskMatTabs);
    const availP = sortPapers(state.papers.filter(p => !openP.has(p.id)));
    const availM = [...state.materials].filter(m => !openM.has(m.id)).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const pick = document.createElement('div');
    pick.className = 'desk-picker';
    const paperItems = availP.map(p => `
        <button type="button" class="desk-pick-item" data-id="${p.id}" data-kind="paper">
            <span>${p.pdfData ? icon('file-text', 14) : icon('note', 14)}</span>
            <span class="desk-pick-title">${escHtml(p.title || '제목 없음')}</span>
            <span class="desk-pick-meta">${escHtml([p.year, firstAuthor(p)].filter(Boolean).join(' · '))}</span>
        </button>`).join('');
    const matItems = availM.map(m => `
        <button type="button" class="desk-pick-item" data-id="${m.id}" data-kind="material">
            <span>${icon('library', 14)}</span>
            <span class="desk-pick-title">${escHtml(m.title || '제목 없음')}</span>
            <span class="desk-pick-meta desk-pick-mat-badge">${escHtml(m.type || '자료')}</span>
        </button>`).join('');
    const hasPaper = availP.length > 0, hasMat = availM.length > 0;
    pick.innerHTML = (hasPaper || hasMat)
        ? (hasPaper ? `<div class="desk-pick-section">논문</div>${paperItems}` : '')
          + (hasMat ? `<div class="desk-pick-section">자료</div>${matItems}` : '')
        : `<div class="desk-pick-empty">더 꺼낼 항목이 없어요.</div>`;
    overlay.querySelector('.desk-topbar').appendChild(pick);
    pick.querySelectorAll('.desk-pick-item').forEach(b =>
        b.addEventListener('click', () => {
            pick.remove();
            if (b.dataset.kind === 'material') {
                if (!deskMatTabs.includes(b.dataset.id)) deskMatTabs.push(b.dataset.id);
                deskActivateMat(b.dataset.id);
            } else {
                if (!deskTabs.includes(b.dataset.id)) deskTabs.push(b.dataset.id);
                deskActivate(b.dataset.id);
            }
        }));
    const off = e => {
        if (!pick.contains(e.target) && !e.target.closest('#desk-tab-add')) {
            pick.remove();
            document.removeEventListener('mousedown', off);
        }
    };
    setTimeout(() => document.addEventListener('mousedown', off), 0);
}

// 자료 탭 활성화
function deskActivateMat(materialId) {
    if (!deskCtx) return;
    const mat = state.materials.find(m => m.id === materialId);
    if (!mat) return;
    deskMatActiveId = materialId;
    deskActiveId = null;
    const { overlay } = deskCtx;
    const left = overlay.querySelector('#desk-left');
    const key = 'm_' + materialId;

    // empty 안내 + 모든 frame 숨기기
    left.querySelector('.desk-empty')?.remove();
    Object.values(deskFramePool).forEach(({el}) => { el.style.display = 'none'; });

    if (!deskFramePool[key]) {
        const hasFile = !!mat.fileData;
        const fname = (mat.fileName || '').toLowerCase();
        const isPdf = hasFile && fname.endsWith('.pdf');
        pushDebug('info', `자료책상 활성화 — id:${materialId} fileName:${mat.fileName} hasFile:${hasFile} isPdf:${isPdf}`);
        const pdfUrl = isPdf
            ? URL.createObjectURL(new Blob([mat.fileData], { type: 'application/pdf' }))
            : null;
        const startPage = (mat.deskBookmarks || []).length ? mat.deskBookmarks[0].page : 0;
        const el = document.createElement('div');
        el.className = 'desk-frame-slot';
        el.innerHTML = deskLeftHTMLMaterial(mat, pdfUrl, startPage);
        left.appendChild(el);
        deskFramePool[key] = { el, pdfUrl };
        bindDeskLeftMat(el, mat);
    }
    deskFramePool[key].el.style.display = '';
    deskCtx.pdfUrl = deskFramePool[key].pdfUrl;

    overlay.querySelector('#desk-right').innerHTML = deskRightHTMLMaterial(mat);
    bindDeskRightMaterial(overlay, mat);
    deskRenderTabs();
}

function bindDeskLeftMat(slot, mat) {
    slot.querySelector('#desk-bm-btn')?.addEventListener('click', function() {
        openDeskBmPopup(this, mat, STORE_MATERIALS);
    });
}

// 현재 책상에 펼쳐진 PDF를 특정 페이지로 이동 (새 blob URL 생성 방식 — hash-only 변경은 크롬에서 무시됨)
function deskNavToPage(page) {
    const key = deskActiveId ? 'p_' + deskActiveId : deskMatActiveId ? 'm_' + deskMatActiveId : null;
    if (!key || !deskFramePool[key]) { showToast('PDF가 열려있지 않아요', 'warn'); return; }
    const entry = deskFramePool[key];
    // 필기모드면 스크롤로 이동 — 확대율·현재 위치를 잃지 않는다(액자는 통째로 다시 로드됨)
    if (entry.el.querySelector('#desk-pen-scroll')) {
        if (deskPenGoto(entry.el, +page)) return;
    }
    const iframe = entry.el.querySelector('iframe.desk-pdf');
    if (!iframe) { showToast('PDF 뷰어를 찾을 수 없어요', 'warn'); return; }
    if (entry.pdfUrl) URL.revokeObjectURL(entry.pdfUrl);
    const srcData = deskActiveId
        ? state.papers.find(p => p.id === deskActiveId)?.pdfData
        : state.materials.find(m => m.id === deskMatActiveId)?.fileData;
    if (!srcData) { showToast('PDF 데이터를 찾을 수 없어요', 'warn'); return; }
    const newUrl = URL.createObjectURL(new Blob([srcData], { type: 'application/pdf' }));
    entry.pdfUrl = newUrl;
    deskCtx.pdfUrl = newUrl;
    iframe.src = newUrl + '#page=' + page;
}

// 자료 왼쪽 패널 HTML
function deskLeftHTMLMaterial(mat, pdfUrl, startPage = 0) {
    if (pdfUrl) {
        const src = startPage ? `${pdfUrl}#page=${startPage}` : pdfUrl;
        return `<div class="desk-pdf-wrap">
            <div class="desk-left-toolbar"><button type="button" class="desk-view-toggle" id="desk-bm-btn">📌 북마크</button></div>
            <iframe class="desk-pdf" src="${src}" title="첨부파일"></iframe>
        </div>`;
    }
    // 텍스트 뷰 (첨부 없거나 PDF 아닌 경우)
    const typeLabel = escHtml(mat.type || '자료');
    const authorsLine = mat.authors ? `<div class="desk-txt-meta">${escHtml(mat.authors)}</div>` : '';
    const sourceLine = mat.source ? `<div class="desk-txt-meta">${escHtml(mat.source)}</div>` : '';
    const noteLine = mat.note ? `<div class="desk-txt-body">${escHtml(mat.note).replace(/\n/g, '<br>')}</div>` : '';
    const fileHint = mat.fileData
        ? `<div class="desk-txt-meta" style="margin-top:12px;color:var(--text-muted)">📎 ${escHtml(mat.fileName || '첨부파일')} (PDF 아님 — 미리보기 불가)</div>`
        : '';
    return `<div class="desk-text-view">
        <div class="desk-txt-title"><span class="mat-type-badge mt-${typeLabel}">${typeLabel}</span> ${escHtml(mat.title || '제목 없음')}</div>
        ${authorsLine}${sourceLine}
        <hr style="margin:12px 0;border:none;border-top:1px solid var(--border)">
        ${noteLine || '<div class="desk-txt-meta" style="color:var(--text-muted)">메모 없음</div>'}
        ${fileHint}
    </div>`;
}

// 구글 드라이브 공유 링크 → iframe에 띄울 수 있는 미리보기(preview) URL로 변환
// 예: .../file/d/FILEID/view?usp=sharing  또는  ...?id=FILEID  →  .../file/d/FILEID/preview
function drivePreviewUrl(link) {
    if (!link) return null;
    const m = link.match(/\/file\/d\/([^/?#]+)/) || link.match(/[?&]id=([^&]+)/);
    if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
    return null;
}

// ══════════════════════════════════════════════════════════════
// 필기모드 — PDF를 iframe(액자)이 아니라 앱이 직접 그린다.
// 액자 안은 앱이 들여다볼 수 없어서 드래그·형광펜·현재쪽 인식이 전부 불가능했다.
// 직접 그리면: 드래그 → 그 자리에서 형광펜 + 발췌 저장, 쪽번호 자동, 확대율 유지 이동.
// 로컬에 첨부된 PDF(paper.pdfData)에서만 동작. 드라이브 링크는 액자 방식 유지(CORS).
// ══════════════════════════════════════════════════════════════

// 'pen' = 필기모드, 'frame' = 예전 액자(크롬 기본 뷰어). 사용자가 언제든 전환.
let deskPenView = localStorage.getItem('deskPenView') || 'pen';
// slot(논문 화면) 하나당 렌더 상태 — { pdf, scale, page, token }
const deskPenState = new WeakMap();

// pdf.js는 index.html에서 비동기(import)로 실린다. 새로고침 직후엔 아직 없을 수 있어
// 여기서 window.pdfjsLib를 조건에 넣으면 조용히 액자 모드로 빠져 형광펜이 사라져 보인다.
// → 조건은 "로컬 PDF가 있는가"만 보고, 실제 로드는 deskRenderPen에서 기다린다.
function deskCanPen(paper) {
    return !!(paper && (paper.pdfData || paper.pdfFolderFile));
}

// pdf.js가 실릴 때까지 잠깐 기다린다 (최대 ms)
async function deskWaitPdfjs(ms = 10000) {
    const t0 = Date.now();
    while (!window.pdfjsLib) {
        if (Date.now() - t0 > ms) return false;
        await new Promise(r => setTimeout(r, 100));
    }
    return true;
}

function deskPenHTML(paper, hasText) {
    const textBtn = hasText
        ? `<button type="button" class="desk-view-toggle" id="desk-toggle-text">${icon('note', 13)} 텍스트로 보기</button>`
        : '';
    return `<div class="desk-pen-wrap">
        <div class="desk-left-toolbar desk-pen-toolbar">
            <button type="button" class="desk-view-toggle" id="desk-pen-prev" title="이전 쪽">◀</button>
            <button type="button" class="desk-view-toggle" id="desk-pen-next" title="다음 쪽">▶</button>
            <span class="desk-pen-pageind"><b id="desk-pen-cur">–</b> / <span id="desk-pen-total">–</span> 쪽</span>
            <button type="button" class="desk-view-toggle" id="desk-pen-zoomout" title="축소">－</button>
            <span class="desk-pen-zoom" id="desk-pen-zoomval">100%</span>
            <button type="button" class="desk-view-toggle" id="desk-pen-zoomin" title="확대">＋</button>
            ${textBtn}
            <button type="button" class="desk-view-toggle" id="desk-bm-btn">📌 북마크</button>
            <button type="button" class="desk-view-toggle" id="desk-pen-off" title="예전 방식(크롬 기본 뷰어)으로 보기">액자로</button>
        </div>
        <div class="desk-pen-scroll" id="desk-pen-scroll">
            <div class="desk-pen-loading">PDF를 여는 중…</div>
        </div>
        <div class="desk-pen-pop" id="desk-pen-pop" hidden></div>
    </div>`;
}

// 형광펜 팝업 내용 — 색 4개 + 색 없이 저장
function deskPenPopHTML() {
    const pens = EX_COLORS.filter(Boolean).map(c =>
        `<button type="button" class="desk-pen-pick" data-color="${c}" style="background:${c}" title="이 색으로 형광펜 + 발췌"></button>`).join('');
    return `${pens}<span class="desk-pen-sep"></span>
        <button type="button" class="desk-pen-pick" data-color="" title="색 없이 발췌만 저장">발췌 저장</button>`;
}

// PDF 전체를 캔버스+글자층으로 그린다. scale 변경 시 다시 호출.
async function deskRenderPen(slot, paper, overlay) {
    const scroll = slot.querySelector('#desk-pen-scroll');
    if (!scroll) return;
    let st = deskPenState.get(slot);
    if (!st) { st = { pdf: null, scale: 1.15, page: 1, token: 0 }; deskPenState.set(slot, st); }
    const myToken = ++st.token;   // 렌더 도중 확대/탭전환 시 옛 렌더 폐기

    try {
        if (!st.pdf) {
            if (!window.pdfjsLib && !(await deskWaitPdfjs())) {
                throw new Error('pdf.js가 아직 실리지 않았어요 (인터넷 연결 확인)');
            }
            if (myToken !== st.token) return;
            // 첨부본이 있으면 그걸, 없으면 폴더에서 읽어온다(복사 저장 없음)
            const src = await getPaperPdfBuf(paper);
            if (!src) throw new Error('PDF를 찾을 수 없어요 — 폴더 연결이 끊겼거나 파일 이름이 바뀌었을 수 있어요');
            if (myToken !== st.token) return;
            // ArrayBuffer — pdf.js가 소유권을 가져가 비우는 것을 막으려고 복사본을 넘긴다
            st.pdf = await window.pdfjsLib.getDocument({ data: src.slice(0) }).promise;
        }
        if (myToken !== st.token) return;
        const totalEl = slot.querySelector('#desk-pen-total');
        if (totalEl) totalEl.textContent = st.pdf.numPages;
        scroll.innerHTML = '';
        if (st.io) { st.io.disconnect(); st.io = null; }

        // ── 1) 빈 종이(자리)만 먼저 깔아 스크롤 길이를 확정한다 ──────────
        // 논문 PDF는 쪽 크기가 대부분 같으므로 1쪽 크기를 기준으로 잡고,
        // 실제로 그릴 때 쪽마다 크기가 다르면 그때 바로잡는다.
        const first = await st.pdf.getPage(1);
        if (myToken !== st.token) return;
        const baseVp = first.getViewport({ scale: st.scale });
        const frag0 = document.createDocumentFragment();
        for (let n = 1; n <= st.pdf.numPages; n++) {
            const pageEl = document.createElement('div');
            pageEl.className = 'desk-pen-page';
            pageEl.dataset.page = n;
            pageEl.dataset.done = '0';
            pageEl.style.width = baseVp.width + 'px';
            pageEl.style.height = baseVp.height + 'px';
            frag0.appendChild(pageEl);
        }
        scroll.appendChild(frag0);

        // ── 2) 화면에 보이는(가까워진) 쪽만 실제로 그린다 ────────────────
        // 예전엔 24쪽짜리를 열자마자 24쪽 전부 그려서 한참 멈췄다.
        st.io = new IntersectionObserver(entries => {
            entries.forEach(en => {
                if (!en.isIntersecting) return;
                deskRenderPenPage(st, en.target, paper, myToken);
            });
        }, { root: scroll, rootMargin: '400px 0px' });   // 조금 미리 그려둔다
        scroll.querySelectorAll('.desk-pen-page').forEach(el => st.io.observe(el));
        deskPenSyncPage(slot);
        // 형광펜이 안 보일 때 원인을 가리기 위한 기록 —
        // "저장된 형광펜 0개"면 저장이 안 된 것, "N개"인데 화면에 없으면 그리기가 문제.
        const hlCount = (paper.excerpts || []).filter(e => e.hl && Array.isArray(e.hl.rects) && e.hl.rects.length).length;
        pushDebug('info', `필기모드 렌더 완료 — ${st.pdf.numPages}쪽 / 저장된 형광펜 ${hlCount}개`);
    } catch (err) {
        pushDebug('error', '필기모드 PDF 렌더 실패: ' + (err?.message || err));
        scroll.innerHTML = `<div class="desk-pen-loading">이 PDF는 필기모드로 열 수 없어요.<br>위 「액자로」 버튼을 눌러 예전 방식으로 보세요.</div>`;
    }
}

// 한 쪽을 실제로 그린다 (그림 + 형광펜 + 글자층). 이미 그린 쪽은 건너뛴다.
async function deskRenderPenPage(st, pageEl, paper, myToken) {
    if (!pageEl || pageEl.dataset.done !== '0') return;
    pageEl.dataset.done = '1';   // 중복 렌더 방지 — 먼저 세워둔다
    const n = +pageEl.dataset.page;
    try {
        const page = await st.pdf.getPage(n);
        if (myToken !== st.token) return;
        const viewport = page.getViewport({ scale: st.scale });
        // 1쪽 기준으로 깔아둔 자리와 실제 크기가 다르면 바로잡는다
        pageEl.style.width = viewport.width + 'px';
        pageEl.style.height = viewport.height + 'px';

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        pageEl.appendChild(canvas);

        const hlLayer = document.createElement('div');
        hlLayer.className = 'desk-pen-hl-layer';
        pageEl.appendChild(hlLayer);

        const textLayer = document.createElement('div');
        textLayer.className = 'desk-pen-text-layer';
        pageEl.appendChild(textLayer);

        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        if (myToken !== st.token) return;

        // 글자층 — 캔버스 위에 투명한 글자를 얹어 드래그로 선택할 수 있게 한다.
        // pdf.js 버전별 renderTextLayer API 차이를 피하려고 직접 배치한다.
        const tc = await page.getTextContent();
        if (myToken !== st.token) return;
        const frag = document.createDocumentFragment();
        const spans = [];
        for (const item of tc.items) {
            if (!item.str) continue;
            const tx = window.pdfjsLib.Util.transform(viewport.transform, item.transform);
            const fs = Math.hypot(tx[2], tx[3]);
            if (!fs) continue;
            const s = document.createElement('span');
            s.textContent = item.str;
            s.style.left = tx[4] + 'px';
            s.style.top = (tx[5] - fs) + 'px';
            s.style.fontSize = fs + 'px';
            s.style.fontFamily = item.fontName || 'sans-serif';
            frag.appendChild(s);
            if (item.width) spans.push([s, item.width * st.scale]);
        }
        textLayer.appendChild(frag);

        // 실제 그려진 폭에 맞춰 가로로 늘려/줄여 선택 영역이 글자와 겹치게 맞춘다.
        // ⚠️ 읽기(getBoundingClientRect)와 쓰기(style)를 번갈아 하면 글자 수만큼
        //    화면 재계산이 일어나 매우 느려진다 → 전부 읽은 뒤에 전부 쓴다.
        const widths = spans.map(([s]) => s.getBoundingClientRect().width);
        spans.forEach(([s, want], i) => {
            const got = widths[i];
            if (got > 0) s.style.transform = `scaleX(${want / got})`;
        });

        deskDrawHighlights(pageEl, paper, n);
    } catch (err) {
        pageEl.dataset.done = '0';   // 실패했으면 다시 시도할 수 있게 되돌린다
        pushDebug('warn', `필기모드 ${n}쪽 렌더 실패: ${err?.message || err}`);
    }
}

// 저장된 형광펜 자국을 해당 쪽에 다시 그린다 (비율 좌표 → 픽셀)
function deskDrawHighlights(pageEl, paper, pageNum) {
    const layer = pageEl.querySelector('.desk-pen-hl-layer');
    if (!layer) return;
    layer.innerHTML = '';
    (paper.excerpts || []).forEach(e => {
        if (!e.hl || e.hl.page !== pageNum || !Array.isArray(e.hl.rects)) return;
        e.hl.rects.forEach(r => {
            const d = document.createElement('div');
            d.className = 'desk-pen-hl';
            d.style.left = (r.x * 100) + '%';
            d.style.top = (r.y * 100) + '%';
            d.style.width = (r.w * 100) + '%';
            d.style.height = (r.h * 100) + '%';
            d.style.background = e.color || '#fcd34d';
            d.dataset.eid = e.id;
            d.title = '이 발췌로 이동';
            layer.appendChild(d);
        });
    });
}

// 지금 화면 맨 위에 보이는 쪽을 현재 쪽으로 잡는다
function deskPenSyncPage(slot) {
    const scroll = slot.querySelector('#desk-pen-scroll');
    const st = deskPenState.get(slot);
    if (!scroll || !st) return;
    const top = scroll.getBoundingClientRect().top;
    // 화면 위쪽 경계를 아직 지나지 않은 첫 쪽 = 지금 보고 있는 쪽
    let cur = 1;
    for (const p of scroll.querySelectorAll('.desk-pen-page')) {
        if (p.getBoundingClientRect().bottom > top + 40) { cur = +p.dataset.page; break; }
    }
    st.page = cur;
    const el = slot.querySelector('#desk-pen-cur');
    if (el) el.textContent = cur;
}

function deskPenGoto(slot, n) {
    const scroll = slot.querySelector('#desk-pen-scroll');
    const target = scroll?.querySelector(`.desk-pen-page[data-page="${n}"]`);
    if (!target) return false;
    scroll.scrollTo({ top: target.offsetTop - 8, behavior: 'smooth' });
    return true;
}

function deskPenSetScale(slot, paper, overlay, delta) {
    const st = deskPenState.get(slot);
    if (!st) return;
    st.scale = Math.min(3, Math.max(0.5, +(st.scale + delta).toFixed(2)));
    const z = slot.querySelector('#desk-pen-zoomval');
    if (z) z.textContent = Math.round(st.scale / 1.15 * 100) + '%';
    deskRenderPen(slot, paper, overlay);
}

// 드래그한 글을 형광펜 + 발췌로 저장
function deskPenSaveSelection(slot, paper, overlay, color) {
    const sel = window.getSelection();
    const text = (sel?.toString() || '').trim();
    if (!text) return;
    const range = sel.getRangeAt(0);
    // 선택 영역이 걸쳐 있는 쪽 찾기
    let node = range.startContainer;
    if (node.nodeType === 3) node = node.parentElement;
    const pageEl = node?.closest?.('.desk-pen-page');
    const pageNum = pageEl ? +pageEl.dataset.page : (deskPenState.get(slot)?.page || 0);

    // 형광펜 좌표 — 쪽 크기 대비 비율로 저장(확대율이 달라도 같은 자리에 그려짐)
    let rects = [];
    if (pageEl) {
        const pb = pageEl.getBoundingClientRect();
        rects = Array.from(range.getClientRects())
            .filter(r => r.width > 1 && r.height > 1)
            .map(r => ({
                x: (r.left - pb.left) / pb.width,
                y: (r.top - pb.top) / pb.height,
                w: r.width / pb.width,
                h: r.height / pb.height,
            }));
    }

    if (!Array.isArray(paper.excerpts)) paper.excerpts = [];
    const ex = {
        id: genId(), cat: deskAddCat, text, page: pageNum,
        color: color || '', createdAt: Date.now(),
    };
    if (color && rects.length) ex.hl = { page: pageNum, rects };
    paper.excerpts.unshift(ex);
    dbPut(STORE_PAPERS, paper);
    const idx = state.papers.findIndex(p => p.id === paper.id);
    if (idx >= 0) state.papers[idx] = paper;

    if (pageEl) deskDrawHighlights(pageEl, paper, pageNum);
    deskRenderExcerpts(overlay, paper);
    sel.removeAllRanges();
    slot.querySelector('#desk-pen-pop')?.setAttribute('hidden', '');
    showToast(`p.${pageNum} 발췌 저장 — 「${CAT_LABEL[deskAddCat] || deskAddCat}」`, 'success');
}

function bindDeskPen(overlay, paper, slot) {
    const scroll = slot.querySelector('#desk-pen-scroll');
    const pop = slot.querySelector('#desk-pen-pop');
    if (!scroll || !pop) return;
    pop.innerHTML = deskPenPopHTML();

    deskRenderPen(slot, paper, overlay);

    scroll.addEventListener('scroll', () => deskPenSyncPage(slot), { passive: true });

    // 드래그가 끝나면 선택 위치 바로 위에 형광펜 팝업을 띄운다
    scroll.addEventListener('mouseup', () => {
        setTimeout(() => {
            const sel = window.getSelection();
            const text = (sel?.toString() || '').trim();
            if (!text) { pop.hidden = true; return; }
            const r = sel.getRangeAt(0).getBoundingClientRect();
            const wrapBox = slot.querySelector('.desk-pen-wrap').getBoundingClientRect();
            pop.hidden = false;
            const x = r.left - wrapBox.left + r.width / 2 - pop.offsetWidth / 2;
            pop.style.left = Math.max(6, Math.min(x, wrapBox.width - pop.offsetWidth - 6)) + 'px';
            pop.style.top = Math.max(4, r.top - wrapBox.top - pop.offsetHeight - 8) + 'px';
        }, 0);
    });
    // 팝업 자체를 누를 땐 선택이 풀리지 않게
    pop.addEventListener('mousedown', e => e.preventDefault());
    pop.querySelectorAll('.desk-pen-pick').forEach(b =>
        b.addEventListener('click', () => deskPenSaveSelection(slot, paper, overlay, b.dataset.color)));

    // 형광펜 자국을 누르면 오른쪽 발췌 카드로 안내.
    // 맨 위 글자층이 화면을 덮고 있어 클릭이 형광펜에 닿지 않으므로,
    // 누른 지점이 어느 형광펜 안인지 좌표로 직접 찾는다.
    scroll.addEventListener('click', e => {
        // 글을 드래그한 직후의 클릭은 무시(형광펜 팝업 쪽 동작을 방해하지 않게)
        if ((window.getSelection()?.toString() || '').trim()) return;
        const pageEl = e.target.closest('.desk-pen-page');
        if (!pageEl) return;
        let eid = null;
        for (const d of pageEl.querySelectorAll('.desk-pen-hl')) {
            const r = d.getBoundingClientRect();
            if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
                eid = d.dataset.eid; break;
            }
        }
        if (!eid) return;
        const card = overlay.querySelector(`.desk-mat-memo-text[data-eid="${eid}"]`)?.closest('.desk-mat-memo-item');
        if (card) {
            card.scrollIntoView({ block: 'center', behavior: 'smooth' });
            card.classList.add('desk-ex-flash');
            setTimeout(() => card.classList.remove('desk-ex-flash'), 1200);
        }
    });

    // 형광펜 위에 마우스를 올리면 손가락 커서로 바꿔 "누를 수 있음"을 알린다.
    // 마우스는 초당 수십 번 움직이므로 화면 갱신 주기(rAF)당 한 번만 계산한다.
    let moveQueued = false;
    scroll.addEventListener('mousemove', e => {
        if (moveQueued) return;
        const pageEl = e.target.closest('.desk-pen-page');
        if (!pageEl) return;
        const hls = pageEl.querySelectorAll('.desk-pen-hl');
        if (!hls.length) { pageEl.classList.remove('desk-pen-over-hl'); return; }
        moveQueued = true;
        const { clientX, clientY } = e;
        requestAnimationFrame(() => {
            moveQueued = false;
            let on = false;
            for (const d of hls) {
                const r = d.getBoundingClientRect();
                if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) { on = true; break; }
            }
            pageEl.classList.toggle('desk-pen-over-hl', on);
        });
    });

    const st = () => deskPenState.get(slot);
    slot.querySelector('#desk-pen-prev')?.addEventListener('click', () => deskPenGoto(slot, Math.max(1, (st()?.page || 1) - 1)));
    slot.querySelector('#desk-pen-next')?.addEventListener('click', () => deskPenGoto(slot, (st()?.page || 1) + 1));
    slot.querySelector('#desk-pen-zoomin')?.addEventListener('click', () => deskPenSetScale(slot, paper, overlay, 0.15));
    slot.querySelector('#desk-pen-zoomout')?.addEventListener('click', () => deskPenSetScale(slot, paper, overlay, -0.15));
    slot.querySelector('#desk-pen-off')?.addEventListener('click', () => {
        // 액자(크롬 기본 뷰어)는 브라우저에 복사된 파일이 있어야 띄울 수 있다.
        // 폴더 연결본은 사본이 없으므로 필기모드로만 볼 수 있다.
        if (!paper.pdfData) {
            showToast('폴더에서 연결한 PDF는 필기모드로만 볼 수 있어요 (사본을 안 만들기 때문)', 'info');
            return;
        }
        deskPenView = 'frame';
        localStorage.setItem('deskPenView', 'frame');
        const pdfUrl = deskFramePool['p_' + paper.id]?.pdfUrl || null;
        slot.innerHTML = deskLeftHTML(paper, pdfUrl, false);
        bindDeskLeftToggles(overlay, paper, slot);
        showToast('예전 방식(액자)으로 바꿨어요. 툴바의 「필기모드」로 되돌릴 수 있어요.', 'info');
    });
}

function deskLeftHTML(paper, pdfUrl, forceText = false, startPage = 0) {
    // 필기모드 — 로컬 PDF + pdf.js 준비됨 + 사용자가 켜둔 상태일 때
    if (!forceText && deskPenView === 'pen' && deskCanPen(paper)) {
        const hasTextForPen = !!(paper.fullText?.trim() || paper.abstract?.trim() || paper.methods?.trim() || paper.findings?.trim());
        return deskPenHTML(paper, hasTextForPen);
    }
    const hasText = !!(paper.fullText?.trim() || paper.abstract?.trim() || paper.methods?.trim() || paper.findings?.trim());

    const bmBtn = `<button type="button" class="desk-view-toggle" id="desk-bm-btn">📌 북마크</button>`;

    // 우선순위 1: 로컬 PDF (강제 텍스트 아닐 때)
    if (pdfUrl && !forceText) {
        const textBtn = hasText
            ? `<button type="button" class="desk-view-toggle" id="desk-toggle-text">${icon('note', 13)} 텍스트로 보기</button>`
            : '';
        const src = startPage ? `${pdfUrl}#page=${startPage}` : pdfUrl;
        // 필기모드로 되돌아가는 버튼 (로컬 PDF일 때만)
        const penBtn = deskCanPen(paper)
            ? `<button type="button" class="desk-view-toggle desk-pen-on-btn" id="desk-pen-on" title="드래그로 형광펜·발췌가 되는 필기모드">🖍️ 필기모드</button>`
            : '';
        return `<div class="desk-pdf-wrap">
            <div class="desk-left-toolbar">${penBtn}${textBtn}${bmBtn}</div>
            <iframe class="desk-pdf" src="${src}" title="PDF"></iframe>
        </div>`;
    }

    // 우선순위 2: 링크 (강제 텍스트 아닐 때)
    if (paper.pdfLink && !forceText) {
        const textBtn = hasText
            ? `<button type="button" class="desk-view-toggle" id="desk-toggle-text">${icon('note', 13)} 텍스트로 보기</button>`
            : '';
        const toolbar = `<div class="desk-left-toolbar">${textBtn}${bmBtn}</div>`;
        const preview = drivePreviewUrl(paper.pdfLink);
        if (preview) return `<div class="desk-pdf-wrap">
            ${toolbar}
            <iframe class="desk-pdf" src="${preview}" title="PDF" allow="autoplay"></iframe>
        </div>`;
        return `${toolbar}<div class="desk-link-view">
            <div class="desk-link-icon">🔗</div>
            <div class="desk-link-desc">${escHtml(paper.title || '논문 링크')}</div>
            <a href="${escHtml(paper.pdfLink)}" target="_blank" rel="noopener" class="btn-primary desk-link-open">새 탭에서 열기</a>
            <p class="desk-link-note">이 링크는 보안상 앱 안에서 직접 열 수 없습니다.<br>새 탭에서 열어서 텍스트를 복사할 수 있어요.</p>
        </div>`;
    }

    // 우선순위 3: 텍스트 뷰 (PDF·링크 없거나 forceText=true)
    const backBtns = [];
    if (pdfUrl)          backBtns.push(`<button type="button" class="desk-view-toggle" id="desk-toggle-pdf">${icon('file-text', 13)} PDF로 보기</button>`);
    else if (paper.pdfLink) backBtns.push(`<button type="button" class="desk-view-toggle" id="desk-toggle-link">${icon('link', 13)} 링크로 보기</button>`);
    const toolbar = backBtns.length ? `<div class="desk-left-toolbar">${backBtns.join('')}</div>` : '';

    const meta = [paper.year, paper.authors, paper.source].filter(Boolean).map(escHtml).join(' · ');
    const blocks = [];
    const sec = (label, val) => { if (val && String(val).trim()) blocks.push(`<h4>${label}</h4><p>${escHtml(val)}</p>`); };
    if (paper.fullText && paper.fullText.trim()) {
        blocks.push(`<h4>원문 텍스트</h4><div class="desk-reading">${buildPatternHtml(paper.fullText)}</div>`);
    }
    if (!paper.fullText || !paper.fullText.trim()) {
        sec('초록', paper.abstract);
        sec('연구방법', paper.methods);
        sec('주요발견', paper.findings);
    }
    if (paper.attachedImages && paper.attachedImages.length) {
        const imgs = paper.attachedImages.map(img => `
            <figure class="desk-img-figure">
                <img src="${img.data}" alt="${escHtml(img.desc || '')}" class="desk-img">
                ${img.desc ? `<figcaption>${escHtml(img.desc)}</figcaption>` : ''}
            </figure>`).join('');
        blocks.push(`<h4>첨부 이미지</h4><div class="desk-img-list">${imgs}</div>`);
    }
    sec('내 메모', paper.myNote);
    return `${toolbar}
        <div class="desk-text">
            <h2>${escHtml(paper.title || '제목 없음')}</h2>
            ${meta ? `<div class="desk-text-meta">${meta}</div>` : ''}
            ${blocks.join('') || `<p class="muted">이 논문엔 PDF도, 입력된 본문도 없어요. ${icon('pencil', 14)} 수정에서 채우거나 PDF를 올려보세요.</p>`}
        </div>`;
}

// 캔버스/패널 사이 핸들을 끌어 왼쪽 폭 조절(전역 비율 localStorage 저장)
function bindDeskResizer(overlay) {
    const left    = overlay.querySelector('#desk-left');
    const body    = overlay.querySelector('.desk-body');
    const resizer = overlay.querySelector('#desk-resizer');
    const shield  = overlay.querySelector('#desk-drag-shield');
    let dragging = false;

    resizer.addEventListener('mousedown', e => {
        dragging = true;
        if (shield) shield.style.display = 'block'; // iframe 마우스 이벤트 차단
        e.preventDefault();
        document.body.style.userSelect = 'none';
    });
    const onMove = e => {
        if (!dragging) return;
        const r = body.getBoundingClientRect();
        let pct = ((e.clientX - r.left) / r.width) * 100;
        pct = Math.max(25, Math.min(80, pct));
        left.style.flex = `0 0 ${pct}%`;
        deskCtx._pct = pct;
    };
    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        if (shield) shield.style.display = 'none'; // 차단 해제
        document.body.style.userSelect = '';
        if (deskCtx && deskCtx._pct) localStorage.setItem('deskLeftPct', String(Math.round(deskCtx._pct)));
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    deskCtx.onMove = onMove;
    deskCtx.onUp = onUp;
}

// ── 발췌(긁기) — 오른쪽 패널 (2단계) ────────────────────────────
// 한 조각 = { id, cat, text, memo, color, createdAt }. paper.excerpts[]에 저장.
// DB 버전 안 올림(papers store 스프레드 저장 → 백업/내보내기 자동 포함).
// 분류 카테고리 = 논문 수정폼의 "내용 항목"(서지정보 제외). key는 paper의 필드와 매핑(CAT_FIELD).
const EXCERPT_CATS = [
    ['abstract',     '초록'],
    ['keyword',      '키워드'],
    ['variable',     '변인'],
    ['tag',          '태그'],
    ['method',       '연구방법'],
    ['findings',     '주요 발견/결론'],
    ['note',         '내 메모'],
    ['needs',        '연구의 필요성'],
    ['priorlimits',  '선행연구 한계점'],
    ['theory',       '사용한 이론'],
    ['mainstudies',  '주요 연구'],
    ['subjects',     '연구대상자'],
    ['model',        '연구모형'],
    ['anmethod',     '분석방법'],
    ['results',      '분석결과'],
    ['implications', '시사점·제언'],
    ['limitations',  '한계점'],
    ['impressive',   '인상 깊은 점'],
    ['further',      '더 읽고 싶은 참고문헌'],
    ['free',         '자유/기타'],
];
// 카테고리 key → paper 안의 실제 필드 경로. 보기 모달에서 "해당 항목 아래"에 담은 발췌를 모아 보이기 위함.
// kind: 'top'=paper 직속, 'analysis'=paper.analysis 안, 'tags'=배열 필드
const CAT_FIELD = {
    abstract:     { kind: 'top',      key: 'abstract' },
    keyword:      { kind: 'analysis', key: 'keywords' },
    variable:     { kind: 'array',    key: 'variables' },
    tag:          { kind: 'array',    key: 'tags' },
    method:       { kind: 'top',      key: 'methods' },
    findings:     { kind: 'top',      key: 'findings' },
    note:         { kind: 'top',      key: 'myNote' },
    needs:        { kind: 'analysis', key: 'needs' },
    priorlimits:  { kind: 'analysis', key: 'priorlimits' },
    theory:       { kind: 'analysis', key: 'theory' },
    mainstudies:  { kind: 'analysis', key: 'mainstudies' },
    subjects:     { kind: 'analysis', key: 'subjects' },
    model:        { kind: 'analysis', key: 'model' },
    anmethod:     { kind: 'analysis', key: 'method' },
    results:      { kind: 'analysis', key: 'results' },
    implications: { kind: 'analysis', key: 'implications' },
    limitations:  { kind: 'analysis', key: 'limitations' },
    impressive:   { kind: 'analysis', key: 'impressive' },
    further:      { kind: 'analysis', key: 'further' },
    free:         null,
};
// 카테고리 라벨 빠른 조회
const CAT_LABEL = Object.fromEntries(EXCERPT_CATS);
let deskAddCat = 'keyword';   // 담기 시 선택된 카테고리(세션 유지)
let deskRTab = 'excerpt';     // 우측 패널 탭: 'excerpt'(복사붙이기 분류) | 'model'(발표자료 만들기)

function deskRightHTML(paper) {
    const cats = EXCERPT_CATS.map(([k, l]) =>
        `<option value="${k}" ${k === deskAddCat ? 'selected' : ''}>${l}</option>`
    ).join('');
    const t = deskRTab;
    const infoBlocks = [];
    if (paper?.aiSummary) {
        infoBlocks.push(`<div class="desk-info-section">
            <div class="desk-info-label">${icon('bot', 12)} AI 요약</div>
            <div class="desk-info-text">${escHtml(paper.aiSummary)}</div>
        </div>`);
    }
    if (paper?.abstract) {
        infoBlocks.push(`<div class="desk-info-section">
            <div class="desk-info-label">${icon('file-text', 12)} 초록</div>
            <div class="desk-info-text">${escHtml(paper.abstract)}</div>
        </div>`);
    }
    const vars = [...(paper?.variables || [])];
    if (paper?.analysis?.variables) {
        VAR_ROLES.forEach(([role]) => {
            (paper.analysis.variables[role] || []).forEach(v => {
                const name = v?.name || v;
                if (name && !vars.includes(name)) vars.push(name);
            });
        });
    }
    if (vars.length) {
        infoBlocks.push(`<div class="desk-info-section">
            <div class="desk-info-label">${icon('microscope', 12)} 변인</div>
            <div class="desk-info-tags">${vars.map(v => `<span class="tag tag-variable">${escHtml(v)}</span>`).join('')}</div>
        </div>`);
    }
    const infoHTML = infoBlocks.length ? `
        <details class="desk-info-block" ${infoBlocks.length ? 'open' : ''}>
            <summary class="desk-info-summary">${icon('clipboard', 13)} 논문 개요 <span class="desk-info-count">${infoBlocks.length}개 항목</span></summary>
            <div class="desk-info-body">${infoBlocks.join('')}</div>
        </details>` : '';

    const excerptInner = paper ? `
            <div class="desk-right-inner">
                ${infoHTML}
                <div class="desk-memolist" id="desk-excerpts">${deskExcerptsHTML(paper)}</div>
                <div class="desk-memo-input-wrap">
                    <div class="desk-memo-input-title">메모 입력 <span class="desk-memo-input-hint">Ctrl+Enter 저장</span></div>
                    <textarea class="desk-memo-input" id="desk-memo-input" placeholder="왼쪽 PDF에서 복사한 내용이나 생각을 자유롭게 입력하세요" rows="4"></textarea>
                    <div class="desk-memo-input-bar">
                        <select class="desk-cat-select" id="desk-cat-select" title="라벨">${cats}</select>
                        <input type="number" class="desk-memo-page-input" id="desk-memo-page" placeholder="페이지" min="1">
                        <button type="button" class="desk-add btn-primary">저장</button>
                    </div>
                </div>
            </div>` : `
            <div class="desk-rpanel-empty">
                ${icon('book-open', 34)}
                <p>논문을 펼치면 여기서 중요한 내용을<br>메모하고 라벨로 분류할 수 있어요.</p>
            </div>`;
    // 논문 북마크 패널
    const pbookmarks = (paper?.deskBookmarks || []);
    const pbookmarkItems = pbookmarks.map((bm, i) => {
        const dateStr = bm.date ? new Date(bm.date).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : '';
        return `<div class="desk-bm-item">
            <button type="button" class="desk-bm-page" data-page="${bm.page}" title="${bm.page}페이지로 이동">p.${bm.page}</button>
            <span class="desk-bm-date">${dateStr}</span>
            <button type="button" class="desk-pbm-del" data-idx="${i}" title="삭제">✕</button>
        </div>`;
    }).join('');
    const pTotalPages = paper?.readTotalPages || 0;
    const pGoalDate = paper?.readGoalDate || '';
    const pCurrentPage = pbookmarks.length ? pbookmarks[0].page : 0;
    let pProgressHTML = '';
    if (pTotalPages > 0 && pCurrentPage > 0) {
        const pct = Math.min(100, Math.round(pCurrentPage / pTotalPages * 100));
        let goalInfo = '';
        if (pGoalDate) {
            const today = new Date(); today.setHours(0,0,0,0);
            const goal = new Date(pGoalDate); goal.setHours(0,0,0,0);
            const daysLeft = Math.ceil((goal - today) / 86400000);
            const pagesLeft = Math.max(0, pTotalPages - pCurrentPage);
            if (daysLeft > 0 && pagesLeft > 0) {
                const perDay = Math.ceil(pagesLeft / daysLeft);
                goalInfo = `<div class="desk-bm-goal-info">📅 ${daysLeft}일 남음 &nbsp;·&nbsp; 하루 <b>${perDay}페이지</b> 읽으면 완독</div>`;
            } else if (pagesLeft === 0) {
                goalInfo = `<div class="desk-bm-goal-info">🎉 완독!</div>`;
            } else {
                goalInfo = `<div class="desk-bm-goal-info" style="color:var(--danger,#e53935)">⚠️ 목표일 지남 — ${pagesLeft}페이지 남음</div>`;
            }
        }
        pProgressHTML = `
            <div class="desk-bm-progress-wrap">
                <div class="desk-bm-progress-label">
                    <span>p.${pCurrentPage} / ${pTotalPages}</span>
                    <span>${pct}%</span>
                </div>
                <div class="desk-bm-progress-bar"><div class="desk-bm-progress-fill" style="width:${pct}%"></div></div>
                ${goalInfo}
            </div>`;
    }
    const paperBookmarkPanel = paper ? `
        <div class="desk-bm-wrap">
            <div class="desk-bm-setup">
                <div class="desk-bm-setup-row">
                    <label class="desk-bm-label">전체 페이지</label>
                    <input type="number" class="desk-bm-setup-input" id="desk-pbm-total" placeholder="예: 48" min="1" value="${pTotalPages || ''}">
                </div>
                <div class="desk-bm-setup-row">
                    <label class="desk-bm-label">완독 목표일</label>
                    <input type="date" class="desk-bm-setup-input" id="desk-pbm-goal" value="${pGoalDate}">
                </div>
                <button type="button" class="btn-secondary desk-bm-setup-save" id="desk-pbm-setup-save">설정 저장</button>
            </div>
            ${pProgressHTML}
            <div class="desk-bm-list" id="desk-pbm-list">${pbookmarkItems || '<div class="desk-bm-empty">아직 북마크 없음</div>'}</div>
            <div class="desk-bm-input-row">
                <input type="number" class="desk-bm-input" id="desk-pbm-input" placeholder="현재 페이지 번호" min="1">
                <button type="button" class="btn-primary" id="desk-pbm-add">📌 저장</button>
            </div>
            <div class="desk-bm-hint">크롬 PDF 뷰어 상단의 페이지 번호를 입력하세요</div>
        </div>` : `<div class="desk-rpanel-empty"><p>논문을 펼치면 북마크를 사용할 수 있어요.</p></div>`;

    return `
        <div class="desk-rtabs">
            <button type="button" class="desk-rtab ${t === 'excerpt' ? 'active' : ''}" data-rtab="excerpt" title="PDF 발췌·메모 입력"><span class="desk-rtab-2l">${icon('clipboard', 15)}<span>요약<br>메모</span></span></button>
            <button type="button" class="desk-rtab ${t === 'model' ? 'active' : ''}" data-rtab="model" title="연구 모델·프로포절 작성"><span class="desk-rtab-2l-grid"><span>프</span><span>로</span><span>포</span><span>절</span><span>정</span><span></span><span></span><span>리</span></span></button>
            <button type="button" class="desk-rtab ${t === 'catview' ? 'active' : ''}" data-rtab="catview" title="논문·자료를 카테고리별로 모아보기">${icon('layers', 15)} 모아보기</button>
        </div>
        <div class="desk-rpanel desk-right-top" id="desk-right-top" data-panel="excerpt" ${t === 'excerpt' ? '' : 'hidden'}>${excerptInner}</div>
        <div class="desk-rpanel desk-model-pane" id="desk-model-pane" data-panel="model" ${t === 'model' ? '' : 'hidden'}></div>
        <div class="desk-rpanel desk-catview-pane" id="desk-catview-pane" data-panel="catview" ${t === 'catview' ? '' : 'hidden'}></div>`;
}

// ── 자료 전용 오른쪽 패널 ─────────────────────────────────
let deskMatRTab = 'memo';

// 레거시 deskTags + deskMemo → deskMemos 배열로 통합 (표시 전용, 저장은 최초 조작 시)
function matGetMemos(mat) {
    if (Array.isArray(mat.deskMemos) && mat.deskMemos.length > 0) return mat.deskMemos;
    const out = [];
    // 레거시 태그 → label + text 동일한 메모로
    (mat.deskTags || []).forEach(t => out.push({ id: genId(), label: 'tag', page: t.page || 0, text: t.label }));
    // 레거시 문자열 메모
    if (mat.deskMemo?.trim()) out.push({ id: genId(), label: 'free', page: 0, text: mat.deskMemo });
    return out;
}

// 라벨 select 옵션 (EXCERPT_CATS 전체)
const MAT_MEMO_CATS = EXCERPT_CATS.map(([k, l]) =>
    `<option value="${k}">${l}</option>`).join('');
let matMemoAddCat = 'free';

function deskRightHTMLMaterial(mat) {
    const memos = matGetMemos(mat);
    const hasPdf = !!deskCtx?.pdfUrl;
    const memoItems = memos.map((m, i) => {
        const label = CAT_LABEL[m.label] || m.label || '기타';
        const pageBtn = m.page
            ? `<button type="button" class="desk-mat-memo-page" data-page="${m.page}" title="${m.page}페이지로 이동">p.${m.page}</button>`
            : '';
        return `<div class="desk-mat-memo-item">
            <div class="desk-memo-item-header">
                <span class="desk-ex-label cat-${m.label}">${escHtml(label)}</span>
                ${pageBtn}
                <button type="button" class="desk-mat-memo-del" data-idx="${i}" title="삭제">✕</button>
            </div>
            <div class="desk-mat-memo-text">${escHtml(m.text)}</div>
        </div>`;
    }).join('');

    const cats = EXCERPT_CATS.map(([k, l]) =>
        `<option value="${k}" ${k === matMemoAddCat ? 'selected' : ''}>${l}</option>`).join('');

    const memoPanel = `
        <div class="desk-mat-memolist-wrap">
            <div class="desk-mat-memolist" id="desk-mat-memolist">${memoItems}</div>
            <div class="desk-mat-memo-input-wrap">
                <div class="desk-memo-input-title">메모 입력 <span class="desk-memo-input-hint">Ctrl+Enter 저장</span></div>
                <textarea class="desk-mat-memo-input" id="desk-mat-memo-input" placeholder="읽으면서 드는 생각, 중요한 내용, 활용 계획 등을 자유롭게 입력하세요" rows="4"></textarea>
                <div class="desk-mat-memo-input-bar">
                    <select class="desk-cat-select" id="desk-mat-cat-select" title="라벨">${cats}</select>
                    ${hasPdf ? `<input type="number" class="desk-mat-memo-page-input" id="desk-mat-memo-page" placeholder="페이지" min="1">` : ''}
                    <button type="button" class="btn-primary" id="desk-mat-memo-add">저장</button>
                </div>
            </div>
        </div>`;

    const bookmarks = (mat.deskBookmarks || []);
    const bookmarkItems = bookmarks.map((bm, i) => {
        const dateStr = bm.date ? new Date(bm.date).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : '';
        return `<div class="desk-bm-item">
            <button type="button" class="desk-bm-page" data-page="${bm.page}" title="${bm.page}페이지로 이동">p.${bm.page}</button>
            <span class="desk-bm-date">${dateStr}</span>
            <button type="button" class="desk-bm-del" data-idx="${i}" title="삭제">✕</button>
        </div>`;
    }).join('');

    // 진도 계산
    const totalPages = mat.readTotalPages || 0;
    const goalDate = mat.readGoalDate || '';
    const currentPage = bookmarks.length ? bookmarks[0].page : 0;
    let progressHTML = '';
    if (totalPages > 0 && currentPage > 0) {
        const pct = Math.min(100, Math.round(currentPage / totalPages * 100));
        let goalInfo = '';
        if (goalDate) {
            const today = new Date(); today.setHours(0,0,0,0);
            const goal = new Date(goalDate); goal.setHours(0,0,0,0);
            const daysLeft = Math.ceil((goal - today) / 86400000);
            const pagesLeft = Math.max(0, totalPages - currentPage);
            if (daysLeft > 0 && pagesLeft > 0) {
                const perDay = Math.ceil(pagesLeft / daysLeft);
                goalInfo = `<div class="desk-bm-goal-info">📅 ${daysLeft}일 남음 &nbsp;·&nbsp; 하루 <b>${perDay}페이지</b> 읽으면 완독</div>`;
            } else if (pagesLeft === 0) {
                goalInfo = `<div class="desk-bm-goal-info">🎉 완독!</div>`;
            } else {
                goalInfo = `<div class="desk-bm-goal-info" style="color:var(--danger,#e53935)">⚠️ 목표일 지남 — ${pagesLeft}페이지 남음</div>`;
            }
        }
        progressHTML = `
            <div class="desk-bm-progress-wrap">
                <div class="desk-bm-progress-label">
                    <span>p.${currentPage} / ${totalPages}</span>
                    <span>${pct}%</span>
                </div>
                <div class="desk-bm-progress-bar"><div class="desk-bm-progress-fill" style="width:${pct}%"></div></div>
                ${goalInfo}
            </div>`;
    }

    const bookmarkPanel = `
        <div class="desk-bm-wrap">
            <div class="desk-bm-setup">
                <div class="desk-bm-setup-row">
                    <label class="desk-bm-label">전체 페이지</label>
                    <input type="number" class="desk-bm-setup-input" id="desk-bm-total" placeholder="예: 312" min="1" value="${totalPages || ''}">
                </div>
                <div class="desk-bm-setup-row">
                    <label class="desk-bm-label">완독 목표일</label>
                    <input type="date" class="desk-bm-setup-input" id="desk-bm-goal" value="${goalDate}">
                </div>
                <button type="button" class="btn-secondary desk-bm-setup-save" id="desk-bm-setup-save">설정 저장</button>
            </div>
            ${progressHTML}
            <div class="desk-bm-list" id="desk-bm-list">${bookmarkItems || '<div class="desk-bm-empty">아직 북마크 없음</div>'}</div>
            <div class="desk-bm-input-row">
                <input type="number" class="desk-bm-input" id="desk-bm-input" placeholder="현재 페이지 번호" min="1">
                <button type="button" class="btn-primary" id="desk-bm-add">📌 저장</button>
            </div>
            <div class="desk-bm-hint">크롬 PDF 뷰어 상단의 페이지 번호를 입력하세요</div>
        </div>`;

    return `
        <div class="desk-rpanel desk-mat-memo-pane" id="desk-mat-memo-pane">${memoPanel}</div>`;
}

function bindDeskRightMaterial(overlay, mat) {
    // 메모 추가 (저장 버튼 + Ctrl+Enter)
    const addMemo = () => {
        const ta = overlay.querySelector('#desk-mat-memo-input');
        const text = ta?.value.trim();
        if (!text) return;
        const label = overlay.querySelector('#desk-mat-cat-select')?.value || matMemoAddCat;
        const page = parseInt(overlay.querySelector('#desk-mat-memo-page')?.value || '', 10) || 0;
        // 레거시 마이그레이션: 기존 태그/문자열 메모 → 배열로 전환 후 추가
        if (!Array.isArray(mat.deskMemos) || mat.deskMemos.length === 0) {
            mat.deskMemos = matGetMemos(mat);
            delete mat.deskMemo;
            delete mat.deskTags;
        }
        mat.deskMemos.unshift({ id: genId(), label, page, text });
        dbPut(STORE_MATERIALS, mat);
        const idx = state.materials.findIndex(m => m.id === mat.id);
        if (idx >= 0) state.materials[idx] = mat;
        overlay.querySelector('#desk-right').innerHTML = deskRightHTMLMaterial(mat);
        bindDeskRightMaterial(overlay, mat);
    };
    overlay.querySelector('#desk-mat-memo-add')?.addEventListener('click', addMemo);
    overlay.querySelector('#desk-mat-memo-input')?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); addMemo(); }
    });

    // 메모 삭제
    overlay.querySelectorAll('.desk-mat-memo-del').forEach(b =>
        b.addEventListener('click', () => {
            if (!Array.isArray(mat.deskMemos) || mat.deskMemos.length === 0) {
                mat.deskMemos = matGetMemos(mat);
                delete mat.deskMemo; delete mat.deskTags;
            }
            mat.deskMemos.splice(Number(b.dataset.idx), 1);
            dbPut(STORE_MATERIALS, mat);
            const idx = state.materials.findIndex(m => m.id === mat.id);
            if (idx >= 0) state.materials[idx] = mat;
            overlay.querySelector('#desk-right').innerHTML = deskRightHTMLMaterial(mat);
            bindDeskRightMaterial(overlay, mat);
        }));

    // 메모 페이지 이동
    overlay.querySelectorAll('.desk-mat-memo-page').forEach(b =>
        b.addEventListener('click', () => deskNavToPage(b.dataset.page)));

    // 라벨 드롭다운 상태 유지
    overlay.querySelector('#desk-mat-cat-select')?.addEventListener('change', e => {
        matMemoAddCat = e.target.value;
    });

    // 북마크는 툴바 팝업(openDeskBmPopup)으로 이동
}

// 하단 "모형 미리보기" — 프로포절 칸·가설·변인을 읽기전용으로 표시(발췌 보낼 때마다 갱신).
// 스케치북 에디터(S)는 안 띄움 → 안전.
function deskModelPreviewHTML() {
    const p = state.proposal || {};
    const field = (key, label) => {
        const v = (p[key] || '');
        return `<div class="dmp-field">
            <div class="dmp-k">${label}</div>
            <textarea class="dmp-edit" data-key="${key}" rows="3" placeholder="(비어 있음 — 발췌를 보내거나 직접 입력)">${escHtml(v)}</textarea>
        </div>`;
    };
    const hyps = (p.hypotheses || []).filter(h => h && (h.text || '').trim());
    const hypHTML = hyps.length
        ? `<div class="dmp-field"><div class="dmp-k">가설</div><div class="dmp-hyps">${hyps.map((h, i) => `<div class="dmp-hyp"><b>H${i + 1}</b> ${escHtml(h.text)}</div>`).join('')}</div></div>`
        : '';
    const vars = deskCollectVariables();
    const varHTML = `<div class="dmp-field"><div class="dmp-k">변인</div><div class="dmp-vars">${vars.length ? vars.map(v => `<span class="tag tag-variable">${escHtml(v)}</span>`).join('') : '<span class="muted">아직 없음 — 변인 발췌를 보내보세요</span>'}</div></div>`;
    return `
        <div class="desk-model-head">${icon('bar-chart', 14)} 프로포절 정리</div>
        <div class="desk-model-body">
            ${field('needs', '연구 필요성')}
            ${field('purpose', '연구 목적')}
            ${field('theory', '이론적 배경')}
            ${field('subjects', '연구 대상')}
            ${field('method', '연구 방법')}
            ${field('expected', '기대 효과')}
            ${hypHTML}
            ${varHTML}
        </div>`;
}

// 현재 프로젝트 논문들에서 변인 수집(paper.variables + 정밀분석 변수명, 중복 제거)
function deskCollectVariables() {
    const seen = new Set(); const out = [];
    (state.papers || []).forEach(p => {
        const a = p.analysis?.variables || {};
        const fromAnalysis = VAR_ROLES.flatMap(([role]) => (a[role] || []).map(v => v && v.name).filter(Boolean));
        [...(p.variables || []), ...fromAnalysis].forEach(v => {
            const k = String(v).toLowerCase();
            if (v && !seen.has(k)) { seen.add(k); out.push(v); }
        });
    });
    return out;
}

// 우측 패널 탭 전환 (복사붙이기 분류 ↔ 발표자료 만들기 ↔ 모아보기)
function deskActivateRTab(overlay, tab) {
    deskRTab = tab;
    overlay.querySelectorAll('.desk-rtab').forEach(b =>
        b.classList.toggle('active', b.dataset.rtab === tab));
    overlay.querySelectorAll('.desk-rpanel').forEach(p => {
        p.hidden = (p.dataset.panel !== tab);
    });
    if (tab === 'model') deskRenderModel(overlay);
    if (tab === 'catview') {
        const pane = overlay.querySelector('#desk-catview-pane');
        if (pane) deskRenderCatView(overlay, pane);
    }
}

// 책상 내 모아보기 탭 렌더링
// 논문/자료 "보기" 클릭 시 모달 대신 책상 탭으로 이동
function deskRenderCatView(overlay, container) {
    const known = new Set(EXCERPT_CATS.map(([k]) => k));
    const catOf = e => (known.has(e.cat) ? e.cat : 'free');
    const cur = (state.catViewCat && known.has(state.catViewCat)) ? state.catViewCat : EXCERPT_CATS[0][0];
    state.catViewCat = cur;

    const rows = sortPapers(state.papers).map(p => ({
        p,
        fieldVal: catFieldValue(p, cur),
        excerpts: (p.excerpts || []).filter(e => catOf(e) === cur),
    })).filter(r => r.fieldVal || r.excerpts.length);

    const totalEx = rows.reduce((n, r) => n + r.excerpts.length, 0);
    const catOptions = EXCERPT_CATS.map(([k, l]) =>
        `<option value="${k}" ${k === cur ? 'selected' : ''}>${l}</option>`).join('');

    const body = rows.length
        ? rows.map(({ p, fieldVal, excerpts }) => {
            const fieldHTML = fieldVal
                ? (Array.isArray(fieldVal)
                    ? `<div class="cv-field-tags">${fieldVal.map(v => `<span class="tag tag-variable">${escHtml(v)}</span>`).join('')}</div>`
                    : `<div class="cv-field-text">${escHtml(fieldVal)}</div>`)
                : '';
            const exHTML = excerpts.length
                ? `<ul class="cv-ex-list">${excerpts.map(e =>
                    `<li>${escHtml(e.text)}${e.memo ? `<span class="cv-ex-memo"> — ${escHtml(e.memo)}</span>` : ''}</li>`
                ).join('')}</ul>`
                : '';
            return `
            <div class="cv-paper">
                <div class="cv-paper-head">
                    <span class="cv-paper-title">${escHtml(p.title || '제목 없음')}</span>
                    <span class="cv-paper-meta">${escHtml([firstAuthor(p), p.year].filter(Boolean).join(', '))}</span>
                    <button type="button" class="cv-open btn-secondary" data-id="${p.id}">${icon('eye', 14)} 보기</button>
                </div>
                ${fieldHTML}${exHTML}
            </div>`;
        }).join('')
        : `<div class="empty-state"><div class="empty-icon">${icon('clipboard', 44)}</div><h3>이 분류에 내용이 없어요</h3><p class="muted">논문에 「${escHtml(CAT_LABEL[cur] || '')}」 항목을 채우거나, 연구 책상에서 발췌를 담아보세요.</p></div>`;

    const matsWithTags = state.materials.filter(m =>
        (m.deskTags || []).length > 0 || m.deskMemo?.trim() || (m.deskMemos || []).length > 0);
    const matTagsHTML = matsWithTags.length ? `
        <div class="cv-mat-section">
            <div class="cv-mat-section-title">${icon('library', 14)} 자료 태그 & 메모</div>
            ${matsWithTags.map(m => {
                const tags = (m.deskTags || []).map(t =>
                    `<span class="desk-mat-tag" style="cursor:default">${t.page ? `<span class="desk-mat-tag-page" style="cursor:default">p.${t.page}</span>` : ''}${escHtml(t.label)}</span>`
                ).join('');
                const memos = Array.isArray(m.deskMemos) ? m.deskMemos
                    : (m.deskMemo?.trim() ? [{ page: 0, text: m.deskMemo }] : []);
                const memosHTML = memos.map(memo =>
                    `<div class="cv-mat-memo">${memo.page ? `<span class="cv-mat-memo-page">p.${memo.page}</span> ` : ''}${escHtml(memo.text)}</div>`
                ).join('');
                return `<div class="cv-paper">
                    <div class="cv-paper-head">
                        <span class="cv-paper-title">${escHtml(m.title || '제목 없음')}</span>
                        <span class="cv-paper-meta">${escHtml(m.type || '자료')}</span>
                        <button type="button" class="cv-open-mat btn-secondary" data-id="${m.id}">${icon('eye', 14)} 보기</button>
                    </div>
                    ${tags ? `<div class="cv-mat-tags">${tags}</div>` : ''}
                    ${memosHTML}
                </div>`;
            }).join('')}
        </div>` : '';

    container.innerHTML = `
        <div class="cv-head">
            <span class="cv-title">모아보기</span>
            <select class="cv-cat-select" id="desk-cv-cat">${catOptions}</select>
            <span class="cv-count">${rows.length}편 · 발췌 ${totalEx}개</span>
        </div>
        <div class="cv-list">${body}${matTagsHTML}</div>`;

    container.querySelector('#desk-cv-cat')?.addEventListener('change', e => {
        state.catViewCat = e.target.value;
        deskRenderCatView(overlay, container);
    });
    // 논문 "보기" → 책상 왼쪽 탭으로 열기
    container.querySelectorAll('.cv-open').forEach(b =>
        b.addEventListener('click', () => {
            const paper = state.papers.find(p => p.id === b.dataset.id);
            if (!paper) return;
            if (!deskTabs.includes(b.dataset.id)) deskTabs.push(b.dataset.id);
            deskActivate(b.dataset.id);
            deskRenderTabs();
        }));
    // 자료 "보기" → 책상 왼쪽 자료 탭으로 열기
    container.querySelectorAll('.cv-open-mat').forEach(b =>
        b.addEventListener('click', () => {
            const mat = state.materials.find(m => m.id === b.dataset.id);
            if (!mat) return;
            if (!deskMatTabs.includes(b.dataset.id)) deskMatTabs.push(b.dataset.id);
            deskActivateMat(b.dataset.id);
            deskRenderTabs();
        }));
}

function deskRenderModel(overlay) {
    const pane = overlay.querySelector('#desk-model-pane');
    if (!pane) return;
    pane.innerHTML = deskModelPreviewHTML();
    // textarea 변경 시 proposal에 반영 + 자동 저장
    pane.querySelectorAll('.dmp-edit').forEach(ta => {
        ta.addEventListener('input', () => {
            if (!state.proposal) state.proposal = defaultProposal(state.currentProjectId);
            state.proposal[ta.dataset.key] = ta.value;
            scheduleSaveProposal();
        });
    });
}

// 메모 통합 리스트 — 라벨 배지 + 페이지 + 내용 + 삭제
function deskExcerptsHTML(paper) {
    const list = paper.excerpts || [];
    if (!list.length) {
        return '';
    }
    return list.map(e => {
        const label = CAT_LABEL[e.cat] || e.cat || '기타';
        const pageBtn = e.page
            ? `<button type="button" class="desk-mat-memo-page" data-page="${e.page}" title="${e.page}페이지로 이동">p.${e.page}</button>`
            : '';
        // 색 띠(왼쪽) — e.color 없으면 색 없음
        const band = e.color ? ` style="border-left:4px solid ${e.color}"` : '';
        const dests = `<span class="desk-ex-sendlabel">보낼 곳</span>` + EX_SEND_DESTS.map(([k, l]) =>
            `<button type="button" class="desk-ex-dest" data-eid="${e.id}" data-dest="${k}">${l}</button>`).join('');
        const pens = EX_COLORS.map(c =>
            `<button type="button" class="desk-ex-pen${e.color === c ? ' on' : ''}" data-eid="${e.id}" data-color="${c}"
                style="${c ? `background:${c}` : ''}" title="${c ? '색 지정' : '색 없음'}"></button>`).join('');
        return `<div class="desk-mat-memo-item"${band}>
            <div class="desk-memo-item-header">
                <span class="desk-ex-label cat-${e.cat}">${escHtml(label)}</span>
                ${pageBtn}
                <button type="button" class="desk-ex-del" data-eid="${e.id}" title="삭제">✕</button>
            </div>
            <div class="desk-mat-memo-text" data-eid="${e.id}">${escHtml(e.text)}</div>
            <div class="desk-ex-bar">
                <button type="button" class="desk-ex-send" data-eid="${e.id}">프로포절로 보내기 ▾</button>
                <button type="button" class="desk-ex-editbtn" data-eid="${e.id}">수정</button>
                <span class="desk-ex-pens">${pens}</span>
            </div>
            <div class="desk-ex-sendmenu" data-eid="${e.id}" hidden>${dests}</div>
        </div>`;
    }).join('');
}

function bindDeskRight(overlay, paper) {
    // 우측 탭(복사붙이기 분류 ↔ 발표자료 만들기 ↔ 모아보기) 전환 — 논문 없어도 동작
    overlay.querySelectorAll('.desk-rtab').forEach(b =>
        b.addEventListener('click', () => deskActivateRTab(overlay, b.dataset.rtab)));
    // 논문 탭 전환 등으로 다시 그려질 때, 현재 탭 내용 유지
    if (deskRTab === 'model') deskRenderModel(overlay);
    if (deskRTab === 'catview') {
        const pane = overlay.querySelector('#desk-catview-pane');
        if (pane) deskRenderCatView(overlay, pane);
    }
    // 메모 입력 관련은 논문이 펼쳐져 있을 때만
    if (!paper) return;
    const catSel = overlay.querySelector('#desk-cat-select');
    if (catSel) catSel.addEventListener('change', () => { deskAddCat = catSel.value; });
    overlay.querySelector('.desk-add')?.addEventListener('click', () => deskAddExcerpt(overlay, paper));
    overlay.querySelector('#desk-memo-input')?.addEventListener('keydown', e => {
        if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); deskAddExcerpt(overlay, paper); }
    });

    // 연구책상 아무 데서나 Ctrl+V → 붙여넣은 글이 곧바로 메모칸에 들어가고 커서까지 옮겨줌.
    // (입력칸 안에서 누른 붙여넣기는 건드리지 않는다)
    // overlay는 다시 그려도 유지되므로 중복 등록 방지 플래그를 둔다.
    if (overlay.dataset.pasteBound !== '1') {
        overlay.dataset.pasteBound = '1';
        overlay.addEventListener('paste', ev => {
            const t = ev.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            const text = (ev.clipboardData || window.clipboardData)?.getData('text') || '';
            if (!text.trim()) return;
            const box = overlay.querySelector('#desk-memo-input');
            if (!box) return;
            ev.preventDefault();
            box.value = box.value.trim() ? box.value.trimEnd() + '\n' + text : text;
            box.focus();
            box.setSelectionRange(box.value.length, box.value.length);
            showToast('붙여넣었어요 — Ctrl+Enter로 저장', 'info');
        });
    }

    bindDeskExcerpts(overlay, paper);

    // 북마크는 툴바 팝업(openDeskBmPopup)으로 이동
}

// 발췌 카드 색(왼쪽 띠). 빈 문자열 = 색 없음
const EX_COLORS = ['', '#fcd34d', '#86efac', '#93c5fd', '#f9a8d4'];

// 발췌 → 모형 보내기 목적지: 프로포절 텍스트칸 4개 + 태그
const EX_SEND_DESTS = [
    ['needs',     '필요성'],
    ['purpose',   '목적'],
    ['theory',    '이론배경'],
    ['subjects',  '대상'],
    ['method',    '방법'],
    ['expected',  '기대효과'],
    ['variables', '태그'],
];

function bindDeskExcerpts(overlay, paper) {
    overlay.querySelectorAll('.desk-ex-del').forEach(b =>
        b.addEventListener('click', () => deskDelExcerpt(overlay, paper, b.dataset.eid)));
    // 페이지 이동
    overlay.querySelectorAll('#desk-excerpts .desk-mat-memo-page').forEach(b =>
        b.addEventListener('click', () => deskNavToPage(b.dataset.page)));

    // 「프로포절로 보내기」 — 버튼 누르면 목적지 목록 펼치기
    overlay.querySelectorAll('.desk-ex-send').forEach(b =>
        b.addEventListener('click', () => {
            const menu = overlay.querySelector(`.desk-ex-sendmenu[data-eid="${b.dataset.eid}"]`);
            if (!menu) return;
            // 다른 카드에 열린 메뉴는 닫기
            overlay.querySelectorAll('.desk-ex-sendmenu').forEach(m => { if (m !== menu) m.hidden = true; });
            menu.hidden = !menu.hidden;
        }));
    overlay.querySelectorAll('.desk-ex-dest').forEach(b =>
        b.addEventListener('click', () => deskSendExcerpt(overlay, paper, b.dataset.eid, b.dataset.dest)));

    // 「수정」 — 글 영역을 입력칸으로 바꿨다가, 포커스가 떠나면 저장
    overlay.querySelectorAll('.desk-ex-editbtn').forEach(b =>
        b.addEventListener('click', () => {
            const eid = b.dataset.eid;
            const box = overlay.querySelector(`.desk-mat-memo-text[data-eid="${eid}"]`);
            const ex = (paper.excerpts || []).find(x => x.id === eid);
            if (!box || !ex || box.dataset.editing === '1') return;
            box.dataset.editing = '1';
            const ta = document.createElement('textarea');
            ta.className = 'desk-ex-edit-input';
            ta.value = ex.text;
            box.replaceWith(ta);
            ta.focus();
            ta.setSelectionRange(ta.value.length, ta.value.length);
            const done = () => {
                const v = ta.value.trim();
                if (v) deskUpdateExcerpt(paper, eid, 'text', v);
                deskRenderExcerpts(overlay, paper);
            };
            ta.addEventListener('blur', done, { once: true });
            ta.addEventListener('keydown', ev => {
                if (ev.key === 'Escape') { ev.preventDefault(); ta.removeEventListener('blur', done); deskRenderExcerpts(overlay, paper); }
                if (ev.key === 'Enter' && ev.ctrlKey) { ev.preventDefault(); ta.blur(); }
            });
        }));

    // 색 지정 — 형광펜처럼 카드 왼쪽 띠 색을 고름
    overlay.querySelectorAll('.desk-ex-pen').forEach(b =>
        b.addEventListener('click', () => {
            deskUpdateExcerpt(paper, b.dataset.eid, 'color', b.dataset.color);
            deskRenderExcerpts(overlay, paper);
        }));
}

// 발췌 한 조각을 모형(미니프로포절 칸 / 태그)으로 보냄.
// 스케치북 내부 상태 S는 안 건드리고, 저장소(proposals/papers)에만 기록 → 다음에 스케치북 열면 반영.
function deskSendExcerpt(overlay, paper, eid, dest) {
    const e = (paper.excerpts || []).find(x => x.id === eid);
    const text = (e?.text || '').trim();
    if (!text) { showToast('내용이 비어 있어요', 'error'); return; }

    if (dest === 'variables') {
        if (!Array.isArray(paper.variables)) paper.variables = [];
        if (paper.variables.some(v => String(v).toLowerCase() === text.toLowerCase())) {
            showToast('이미 태그에 있어요', 'info');
        } else {
            paper.variables.push(text);
            dbPut(STORE_PAPERS, paper);
            showToast('태그로 보냈어요 — 스케치북 변인 패널에 떠요', 'success');
        }
    } else {
        if (!state.proposal) state.proposal = defaultProposal(state.currentProjectId);
        const cur = state.proposal[dest] || '';
        state.proposal[dest] = (cur.trim() ? cur.trimEnd() + '\n' : '') + text;
        saveProposalNow();
        const label = { needs: '필요성', purpose: '목적', theory: '이론적 배경', subjects: '대상', method: '방법', expected: '기대 효과' }[dest] || dest;
        showToast(`프로포절 「${label}」 칸으로 보냈어요`, 'success');
    }
    // 발표자료 탭이 켜져 있으면 즉시 갱신(자라는 게 보이게)
    if (deskRTab === 'model') deskRenderModel(overlay);
    const menu = overlay.querySelector(`.desk-ex-sendmenu[data-eid="${eid}"]`);
    if (menu) menu.hidden = true;
}

function deskUpdateExcerpt(paper, eid, field, value) {
    const e = (paper.excerpts || []).find(x => x.id === eid);
    if (!e || e[field] === value) return;
    e[field] = value;
    dbPut(STORE_PAPERS, paper);
}

function deskRenderExcerpts(overlay, paper) {
    const box = overlay.querySelector('#desk-excerpts');
    if (!box) return;
    box.innerHTML = deskExcerptsHTML(paper);
    bindDeskExcerpts(overlay, paper);
}

function deskAddExcerpt(overlay, paper) {
    const ta = overlay.querySelector('#desk-memo-input');
    const text = (ta?.value || '').trim();
    if (!text) { ta?.focus(); return; }
    const page = parseInt(overlay.querySelector('#desk-memo-page')?.value || '', 10) || 0;
    if (!Array.isArray(paper.excerpts)) paper.excerpts = [];
    paper.excerpts.unshift({ id: genId(), cat: deskAddCat, text, page, createdAt: Date.now() });
    dbPut(STORE_PAPERS, paper);
    const idx = state.papers.findIndex(p => p.id === paper.id);
    if (idx >= 0) state.papers[idx] = paper;
    ta.value = '';
    // 페이지 번호는 일부러 지우지 않는다 — 같은 쪽에서 여러 조각을 뽑을 때
    // 매번 다시 타이핑하게 되던 문제. 쪽이 넘어가면 사용자가 직접 고쳐 넣는다.
    // (라벨은 deskAddCat에 남아 있어 이미 유지됨)
    deskRenderExcerpts(overlay, paper);
    ta.focus();
}

function deskDelExcerpt(overlay, paper, eid) {
    paper.excerpts = (paper.excerpts || []).filter(e => e.id !== eid);
    dbPut(STORE_PAPERS, paper);
    deskRenderExcerpts(overlay, paper);
}

// ── 논문 추가/수정/보기 통합 모달 ───────────────────────────
// mode: 'edit'(입력 가능) | 'view'(읽기 전용). 새 논문은 항상 'edit'.
function openForm(editId = null, mode = null) {
    mode = mode || (editId ? 'view' : 'edit');
    state.editingId = editId;
    state.formMode = mode;
    state.currentPdfFile = null;
    state.currentFolderFile = null;
    formVariables = [];
    formTags = [];
    formAttachedImages = [];
    formFullTextHtml = '';

    const ids = ['f-title','f-authors','f-year','f-source','f-volume','f-issue',
                 'f-pages','f-doi','f-pdflink','f-abstract','f-methods','f-findings','f-note',
                 'doi-input','riss-input','f-fulltext',
                 'f-publisher','f-booktitle','f-editors','f-edition','f-url',
                 'f-translator','f-origyear'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const itEl = document.getElementById('f-itemtype');
    if (itEl) itEl.value = 'journal';
    applyItemTypeUI('journal');
    document.getElementById('pdf-filename').textContent = '선택된 파일 없음';

    const paper = editId ? state.papers.find(p => p.id === editId) : null;
    if (paper) {
        const set = (id, val) => { if (val) document.getElementById(id).value = val; };
        set('f-title', paper.title); set('f-authors', paper.authors); set('f-year', paper.year);
        set('f-source', paper.source); set('f-volume', paper.volume); set('f-issue', paper.issue);
        set('f-pages', paper.pages); set('f-doi', paper.doi); set('f-pdflink', paper.pdfLink); set('f-abstract', paper.abstract);
        set('f-methods', paper.methods); set('f-findings', paper.findings); set('f-note', paper.myNote);
        set('f-fulltext', paper.fullText);
        // APA 자료 유형 — 옛 논문은 내용으로 추정한다
        const it = apaItemType(paper);
        if (itEl) itEl.value = it;
        applyItemTypeUI(it);
        set('f-publisher', paper.publisher); set('f-booktitle', paper.bookTitle);
        set('f-editors', paper.editors);     set('f-edition', paper.edition);
        set('f-url', paper.url);
        set('f-translator', paper.translator); set('f-origyear', paper.originalYear);
        formVariables = [...(paper.variables || [])];
        formTags = [...(paper.tags || [])];
        pushDebug('info', `openForm — 제목:${paper.title} pdfData:${paper.pdfData ? paper.pdfData.byteLength+'bytes' : '없음'} fullText길이:${(paper.fullText||'').length}`);
        if (paper.pdfData) document.getElementById('pdf-filename').textContent = paper.pdfFilename || 'PDF 있음';
        else if (paper.pdfFolderFile) document.getElementById('pdf-filename').textContent = `📁 ${paper.pdfFolderFile} (폴더 연결)`;
        // AI 요약 복원
        const aiBox = document.getElementById('ai-summary-result');
        if (aiBox) {
            if (paper.aiSummary) {
                const badge = paper.aiSummaryBasis ? `<div class="ai-basis-badge">📄 ${escHtml(paper.aiSummaryBasis)}</div>` : '';
                aiBox.innerHTML = `${badge}<div class="ai-summary-text">${escHtml(paper.aiSummary)}</div>`;
                aiBox.style.display = 'block';
                const aiBlock = document.getElementById('ai-block');
                if (aiBlock) aiBlock.open = true;
            } else {
                aiBox.textContent = '';
                aiBox.style.display = 'none';
            }
        }
    }

    renderChips('variables-list', formVariables, 'variable');
    renderChips('tags-list', formTags, 'normal');
    fillAnalysis(paper?.analysis || null);
    renderReadStatusButtons(paper?.readStatus || 'unread');
    renderFtImages(paper?.attachedImages || []);
    bindFtImageUpload();
    applyFormMode(mode, paper);
    document.getElementById('modal-form').style.display = 'flex';
    // 새 논문 추가 시: PDF+원문 블록 자동 펼침
    const ftBlock = document.getElementById('fulltext-block');
    if (!editId && mode === 'edit') {
        if (ftBlock) ftBlock.open = true;
    }
    // 모달이 렌더링된 후 스크롤 위치 조정
    requestAnimationFrame(() => {
        const modal = document.querySelector('#modal-form .modal');
        if (!modal) return;
        if (!editId && mode === 'edit') {
            // 새 논문 추가: PDF+원문 블록 상단에 오도록 스크롤
            const ft = document.getElementById('fulltext-block');
            if (ft) modal.scrollTop = ft.offsetTop - 120;
        } else {
            modal.scrollTop = 0;
        }
    });
    // 새 논문 추가 시 제목 칸에 자동 포커스
    if (!editId && mode === 'edit') setTimeout(() => document.getElementById('f-title')?.focus(), 80);
}

// 보기/수정 모드 전환 — 같은 모달에서 입력 가능 여부와 부가 UI를 토글
function applyFormMode(mode, paper) {
    const modal = document.querySelector('#modal-form .modal');
    modal.classList.toggle('view-mode', mode === 'view');
    modal.classList.toggle('edit-mode', mode === 'edit');

    // 모든 입력 칸 읽기전용 토글 (파일 입력 제외)
    document.querySelectorAll('#paper-form input, #paper-form textarea').forEach(el => {
        if (el.type !== 'file') el.readOnly = (mode === 'view');
    });

    document.getElementById('modal-form-title').textContent =
        mode === 'view' ? (paper?.title || '논문 보기')
        : (state.editingId ? '논문 수정' : '논문 추가');

    // 보기 모드: 인용·APA·관련 논문 표시 / 분석 섹션 펼치기
    renderViewExtras(mode === 'view' ? paper : null);
    if (mode === 'view') {
        const block = document.getElementById('analysis-block');
        if (block) block.open = paper ? hasAnalysis(paper) : false;
    }

    // 원문 텍스트 표시 처리
    const ftTextarea = document.getElementById('f-fulltext');
    const ftView     = document.getElementById('f-fulltext-view');
    const ftBlock    = document.getElementById('fulltext-block');
    if (mode === 'view') {
        if (paper?.fullTextHtml && paper.fullTextHtml.trim()) {
            // 서식 HTML이 있으면 div로 표시, textarea 숨김
            if (ftTextarea) ftTextarea.style.display = 'none';
            if (ftView) { ftView.style.display = ''; ftView.innerHTML = paper.fullTextHtml; }
        } else {
            // 서식 없으면 textarea 그대로 (readOnly)
            if (ftTextarea) ftTextarea.style.display = '';
            if (ftView) ftView.style.display = 'none';
        }
        // 보기 모드에서는 항상 접기
        if (ftBlock) ftBlock.open = false;
    } else {
        // 편집 모드: 항상 textarea
        if (ftTextarea) ftTextarea.style.display = '';
        if (ftView) { ftView.style.display = 'none'; ftView.innerHTML = ''; }
    }

    document.querySelector('#modal-form .modal-body').scrollTop = 0;
}

function closeForm() {
    document.getElementById('modal-form').style.display = 'none';
    state.editingId = null;
    state.formMode = 'edit';
}

// ── 읽기 상태 버튼 렌더링 ──────────────────────────────────
function renderReadStatusButtons(current) {
    const container = document.getElementById('read-status-btns');
    if (!container) return;
    container.innerHTML = READ_STATUS.map(s => `
        <button type="button" class="rs-btn ${s.key === current ? 'active' : ''}"
            data-rs="${s.key}" style="--rs-color:${s.color}">
            ${s.label}
        </button>`).join('');
    container.querySelectorAll('.rs-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            container.querySelectorAll('.rs-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // 보기 모드에서도 즉시 저장
            if (state.formMode === 'view' && state.editingId) {
                const paper = state.papers.find(p => p.id === state.editingId);
                if (paper) {
                    paper.readStatus = btn.dataset.rs;
                    await dbPut(STORE_PAPERS, paper);
                    renderContent();
                }
            }
        });
    });
}

// ── 원문 이미지 첨부 ────────────────────────────────────────
let formAttachedImages = []; // [{id, data(base64), desc}]
let formFullTextHtml = '';  // 서식 포함 원문 HTML (텍스트 붙여넣기로 추가 시)
let textAddOriginal = '';     // 서식 정리 전 원본 HTML (↩ 되돌리기용)
let textAddOriginalText = ''; // 붙여넣기 직후 원본 평문 (저장 시 반드시 사용)

function renderFtImages(images) {
    formAttachedImages = images ? [...images] : [];
    const list = document.getElementById('ft-images-list');
    if (!list) return;
    list.innerHTML = formAttachedImages.map((img, i) => `
        <div class="ft-img-item" data-i="${i}">
            <img class="ft-img-thumb" src="${img.data}" alt="첨부 이미지 ${i + 1}">
            <input class="ft-img-desc" type="text" placeholder="설명 입력 (예: Figure 2 — 집단 간 비교 그래프)"
                value="${escHtml(img.desc || '')}" data-i="${i}">
            <button type="button" class="ft-img-del edit-only" data-i="${i}">✕</button>
        </div>`).join('');
    list.querySelectorAll('.ft-img-desc').forEach(inp => {
        inp.addEventListener('input', () => {
            if (formAttachedImages[+inp.dataset.i]) formAttachedImages[+inp.dataset.i].desc = inp.value;
        });
    });
    list.querySelectorAll('.ft-img-del').forEach(btn => {
        btn.addEventListener('click', () => {
            formAttachedImages.splice(+btn.dataset.i, 1);
            renderFtImages(formAttachedImages);
        });
    });
}

function bindFtImageUpload() {
    const btn = document.getElementById('btn-add-ft-image');
    const input = document.getElementById('ft-image-input');
    if (!btn || !input) return;
    // 이전 리스너 제거 후 재등록 (openForm 재호출 시 중복 방지)
    const newBtn = btn.cloneNode(true);
    btn.parentNode.replaceChild(newBtn, btn);
    const newInput = input.cloneNode(true);
    input.parentNode.replaceChild(newInput, input);
    newBtn.addEventListener('click', () => newInput.click());
    newInput.addEventListener('change', async () => {
        for (const file of newInput.files) {
            const data = await new Promise(res => {
                const r = new FileReader();
                r.onload = e => res(e.target.result);
                r.readAsDataURL(file);
            });
            formAttachedImages.push({ id: genId(), data, desc: '' });
        }
        renderFtImages(formAttachedImages);
        newInput.value = '';
    });
}

// ── 태그 칩 렌더링 ─────────────────────────────────────────
function renderChips(containerId, arr, type) {
    const el = document.getElementById(containerId);
    el.innerHTML = arr.map((t, i) => `
        <span class="tag-chip tag-chip-${type}">
            ${escHtml(t)}<button type="button" data-i="${i}">×</button>
        </span>`).join('');
    el.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            const isVar = containerId === 'variables-list';
            (isVar ? formVariables : formTags).splice(+btn.dataset.i, 1);
            renderChips(containerId, isVar ? formVariables : formTags, type);
        });
    });
}

// ── 정밀 분석: 변수 역할 블록 생성 ─────────────────────────
function renderAnalysisVarBlocks() {
    const container = document.getElementById('analysis-vars-container');
    if (!container) return;
    container.innerHTML = VAR_ROLES.map(([role, label]) => `
        <div class="var-role">
            <div class="var-role-head">
                <span class="var-role-title">${label}</span>
                <button type="button" class="var-add-btn" data-role="${role}">+ 추가</button>
            </div>
            <div class="var-rows" id="vrows-${role}"></div>
        </div>`).join('');

    container.querySelectorAll('.var-add-btn').forEach(btn => {
        btn.addEventListener('click', () => addVarRow(btn.dataset.role));
    });
}

// 변수 한 줄(변수명/요인/척도/신뢰도/타당도) 추가
function addVarRow(role, data = {}) {
    const rows = document.getElementById(`vrows-${role}`);
    if (!rows) return;
    const row = document.createElement('div');
    row.className = 'var-row';
    row.innerHTML = VAR_FIELDS.map(([f, , ph]) =>
        `<input type="text" data-f="${f}" placeholder="${ph}" value="${escHtml(data[f] || '')}">`
    ).join('') + `<button type="button" class="var-del" title="이 줄 삭제">×</button>`;
    row.querySelector('.var-del').addEventListener('click', () => row.remove());
    rows.appendChild(row);
}

// 폼 → analysis 객체
function collectAnalysis() {
    const a = {};
    for (const [id, key] of Object.entries(ANALYSIS_TEXT_FIELDS)) {
        a[key] = (document.getElementById(id)?.value || '').trim();
    }
    a.variables = {};
    for (const [role] of VAR_ROLES) {
        a.variables[role] = [...document.querySelectorAll(`#vrows-${role} .var-row`)]
            .map(r => {
                const g = f => r.querySelector(`[data-f="${f}"]`)?.value.trim() || '';
                return { name: g('name'), factor: g('factor'), scale: g('scale'),
                         reliability: g('reliability'), validity: g('validity') };
            })
            .filter(v => Object.values(v).some(Boolean));
    }
    return a;
}

// analysis 객체 → 폼 (null이면 모두 비움)
function fillAnalysis(analysis) {
    const a = analysis || {};
    for (const [id, key] of Object.entries(ANALYSIS_TEXT_FIELDS)) {
        const el = document.getElementById(id);
        if (el) el.value = a[key] || '';
    }
    renderAnalysisVarBlocks();
    const vars = a.variables || {};
    for (const [role] of VAR_ROLES) {
        (vars[role] || []).forEach(v => addVarRow(role, v));
    }
    // 채워진 내용이 있으면 접힌 섹션을 펼쳐서 보여줌
    const block = document.getElementById('analysis-block');
    if (block) {
        const hasData = Object.values(ANALYSIS_TEXT_FIELDS).some(k => (a[k] || '').trim())
            || VAR_ROLES.some(([role]) => (vars[role] || []).length);
        block.open = hasData;
    }
}

// 분석 내용이 하나라도 있는지
function hasAnalysis(paper) {
    const a = paper.analysis;
    if (!a) return false;
    if (Object.values(ANALYSIS_TEXT_FIELDS).some(k => (a[k] || '').trim())) return true;
    return VAR_ROLES.some(([role]) => (a.variables?.[role] || []).length);
}

// ── RISS 인용 텍스트 파싱 ──────────────────────────────────
// 예: 박지선. (2025). 사회비교경향성이 자기은폐에 미치는 영향. 한국심리학회지: 문화 및 사회문제, 31(1), 167-187.
function parseAPACitation(text) {
    text = text.trim().replace(/\s+/g, ' ');
    const result = {};

    // 연도 추출: (2025)
    const yearMatch = text.match(/\((\d{4})\)/);
    if (yearMatch) result.year = yearMatch[1];

    // 저자: 연도 앞 부분
    const yearIdx = text.indexOf(`(${result.year})`);
    if (yearIdx > 0) {
        result.authors = text.slice(0, yearIdx).replace(/\.\s*$/, '').trim();
    }

    // 연도 이후 텍스트 처리
    const afterYear = text.slice(yearIdx + `(${result.year}).`.length).trim();
    const parts = afterYear.split(/\.\s+/);

    if (parts.length >= 1) result.title = parts[0].trim().replace(/\.$/, '');

    // 나머지: 학술지명, 권(호), 페이지
    if (parts.length >= 2) {
        const rest = parts.slice(1).join('. ').trim();
        // 권(호), 페이지 패턴: "학술지명, 31(1), 167-187"
        const journalMatch = rest.match(/^(.+?),\s*(\d+)\((\d+)\),\s*([\d\-–]+)/);
        if (journalMatch) {
            result.source = journalMatch[1].trim();
            result.volume = journalMatch[2];
            result.issue = journalMatch[3];
            result.pages = journalMatch[4];
        } else {
            // 권호 없이 학술지명만 있는 경우
            const simpleMatch = rest.match(/^([^,]+)/);
            if (simpleMatch) result.source = simpleMatch[1].trim().replace(/\.$/, '');
        }
    }

    return result;
}

function applyParsedToForm(data) {
    const set = (id, val) => { if (val) document.getElementById(id).value = val; };
    set('f-title', data.title);
    set('f-authors', data.authors);
    set('f-year', data.year);
    set('f-source', data.source);
    set('f-volume', data.volume);
    set('f-issue', data.issue);
    set('f-pages', data.pages);

    // 자료 유형 자동 판별 — RISS 인용문에는 "○○대학교 대학원 석사학위논문" 같은 말이 들어있다.
    // 한국 논문은 DOI가 없는 경우가 많아, 여기서라도 잡아줘야 사람이 매번 안 고른다.
    const blob = `${data.source || ''} ${data.title || ''}`;
    let guess = '';
    if (/학위\s*논문|석사|박사|dissertation|thesis/i.test(blob))      guess = 'thesis';
    else if (/[^가-힣]역\)|옮김|번역|Trans\./i.test(blob))            guess = 'translation';
    else if (data.volume || data.issue)                                guess = 'journal';
    if (guess) {
        const sel = document.getElementById('f-itemtype');
        if (sel) { sel.value = guess; applyItemTypeUI(guess); }
        const KO = { thesis: '학위논문', translation: '번역서', journal: '학술지 논문' };
        pushDebug('info', `RISS 유형 자동판별: ${KO[guess]}`);
    }
}

// ── 논문 저장 ──────────────────────────────────────────────
async function savePaper(e) {
    e.preventDefault();
    if (state.formMode === 'view') return;   // 보기 모드에서 Enter 등으로 제출되는 것 방지
    const title = document.getElementById('f-title').value.trim();
    if (!title) { showToast('제목을 입력해주세요', 'error'); return; }

    let pdfData = null, pdfFilename = null;
    if (state.editingId) {
        const ex = state.papers.find(p => p.id === state.editingId);
        if (ex?.pdfData) { pdfData = ex.pdfData; pdfFilename = ex.pdfFilename; }
    }
    if (state.currentPdfFile) {
        pdfData = await readFile(state.currentPdfFile);
        pdfFilename = state.currentPdfFile.name;
    }

    // 폴더 연결 — 파일을 복사하지 않고 "폴더 속 이 이름" 만 기억한다
    let pdfFolderFile = null;
    if (state.editingId) {
        pdfFolderFile = state.papers.find(p => p.id === state.editingId)?.pdfFolderFile || null;
    }
    if (state.currentFolderFile) {
        pdfFolderFile = state.currentFolderFile;
        // 폴더 연결로 바꾸면 브라우저에 있던 복사본은 버린다
        // (이게 첨부 → 폴더연결 전환 통로. 안 버리면 사본이 계속 남아 용량을 차지한다)
        pdfData = null;
        pdfFilename = null;
    }

    // 기존 논문을 펼쳐서 폼에 없는 필드(발췌 excerpts·빠른인용·참고문헌·정렬 등) 보존
    const existing = state.editingId ? state.papers.find(p => p.id === state.editingId) : null;
    const val = id => document.getElementById(id).value.trim();
    const paper = {
        ...(existing || {}),
        id: state.editingId || genId(),
        title,
        authors: val('f-authors'),
        year: val('f-year'),
        source: val('f-source'),
        // APA 자료 유형별 항목
        itemType:  document.getElementById('f-itemtype')?.value || 'journal',
        publisher: val('f-publisher'),
        bookTitle: val('f-booktitle'),
        editors:   val('f-editors'),
        edition:   val('f-edition'),
        url:       val('f-url'),
        translator: val('f-translator'),
        originalYear: val('f-origyear'),
        volume: val('f-volume'),
        issue: val('f-issue'),
        pages: val('f-pages'),
        doi: val('f-doi'),
        pdfLink: val('f-pdflink') || null,
        abstract: val('f-abstract'),
        methods: val('f-methods'),
        findings: val('f-findings'),
        myNote: val('f-note'),
        variables: [...formVariables],
        tags: [...formTags],
        analysis: collectAnalysis(),
        readStatus: document.querySelector('.rs-btn.active')?.dataset.rs || existing?.readStatus || 'unread',
        fullText: (document.getElementById('f-fulltext')?.value || '').trim() || existing?.fullText || '',
        fullTextHtml: formFullTextHtml || existing?.fullTextHtml || '',
        attachedImages: formAttachedImages.length ? formAttachedImages : (existing?.attachedImages || []),
        pdfData,
        pdfFilename,
        pdfFolderFile,
        aiSummary: (document.getElementById('ai-summary-result')?.querySelector('.ai-summary-text')?.textContent || document.getElementById('ai-summary-result')?.textContent || '').trim() || existing?.aiSummary || '',
        aiSummaryBasis: existing?.aiSummaryBasis || '',
        projectId: state.currentProjectId,
        addedAt: state.editingId
            ? (state.papers.find(p => p.id === state.editingId)?.addedAt || Date.now())
            : Date.now(),
        updatedAt: Date.now(),
    };

    // ── 중복 논문 체크 ──────────────────────────────────────
    const doi = val('f-doi');
    const duplicate = state.papers.find(p => {
        if (state.editingId && p.id === state.editingId) return false; // 자기 자신 제외
        if (doi && p.doi && doi.trim() && p.doi.trim() &&
            doi.trim().toLowerCase() === p.doi.trim().toLowerCase()) return true;
        const sameTitle = p.title.trim().toLowerCase() === title.toLowerCase();
        const sameAuthors = (p.authors || '').trim().toLowerCase() === (val('f-authors') || '').trim().toLowerCase();
        return sameTitle && sameAuthors;
    });
    if (duplicate) {
        const confirm = window.confirm(
            `⚠️ 이미 저장된 논문과 같아 보여요.\n\n제목: ${duplicate.title}\n저자: ${duplicate.authors || '(없음)'}\n\n그래도 저장할까요?`
        );
        if (!confirm) return;
    }

    const wasEditing = !!state.editingId;
    await dbPut(STORE_PAPERS, paper);
    await loadData();
    renderContent();
    showToast(wasEditing ? '논문이 수정되었습니다' : '논문이 추가되었습니다', 'success');
    // 저장 후 항상 보기 모드로 전환
    openForm(paper.id, 'view');
}

function readFile(file) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = e => res(e.target.result);
        r.onerror = rej;
        r.readAsArrayBuffer(file);
    });
}

// PDF에서 텍스트 추출 (PDF.js 사용)
async function extractPdfText(file) {
    if (!window.pdfjsLib) { pushDebug('warn', 'PDF.js 아직 로드 안 됨'); return ''; }
    try {
        const buf = await readFile(file);
        const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
        let text = '';
        const MAX_PAGES = 40; // 학술논문은 앞 40페이지면 서론~결론 충분
        const limit = Math.min(pdf.numPages, MAX_PAGES);
        for (let i = 1; i <= limit; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            text += content.items.map(item => item.str).join(' ') + '\n';
        }
        const skipped = pdf.numPages - limit;
        pushDebug('info', `PDF 텍스트 추출 완료 — ${limit}/${pdf.numPages}페이지 ${text.length}자${skipped > 0 ? ` (${skipped}페이지 생략)` : ''}`);
        return text.trim();
    } catch(e) {
        pushDebug('warn', 'PDF 텍스트 추출 실패: ' + e.message);
        return '';
    }
}

// PDF 추출 중 인디케이터 표시/숨김
function _showPdfExtractingBadge(nearElId, show) {
    const BADGE_ID = 'pdf-extracting-badge';
    let badge = document.getElementById(BADGE_ID);
    if (show) {
        if (!badge) {
            badge = document.createElement('span');
            badge.id = BADGE_ID;
            badge.className = 'pdf-extracting-badge';
            badge.textContent = '⏳ 텍스트 추출 중…';
        }
        const near = document.getElementById(nearElId);
        near?.parentNode?.insertBefore(badge, near.nextSibling);
    } else {
        badge?.remove();
    }
}

// 빠른추가 모달의 텍스트란에 PDF 자동 추출 채우기 (contenteditable div)
// 빠른 추가 창에서 폴더의 PDF를 고른 뒤 공통으로 하는 일:
// 이름 기억 → 화면 표시 → 제목 비어 있으면 파일명으로 채우기 → 본문 글자 뽑기
async function _useFolderPdfForAdd(name) {
    addChoiceFolderFile = name;
    addChoicePdfFile = null;              // 복사 방식과 겹치지 않게
    const nameEl = document.getElementById('add-pdf-filename');
    if (nameEl) { nameEl.textContent = '📁 ' + name; nameEl.style.display = ''; }
    const titleEl = document.getElementById('add-title');
    if (titleEl && !titleEl.value) titleEl.value = name.replace(/\.pdf$/i, '');
    const file = await getFolderFile(name);
    if (file) await _autoFillAddText(file);
}

async function _autoFillAddText(file) {
    const txtEl = document.getElementById('add-text-input');
    if (!txtEl || txtEl.textContent.trim()) return;
    _showPdfExtractingBadge('add-pdf-filename', true);
    const txt = await extractPdfText(file);
    _showPdfExtractingBadge('add-pdf-filename', false);
    if (txt) { txtEl.textContent = txt; showToast('PDF 텍스트 자동 추출 완료', 'success'); }
    else showToast('텍스트 추출 실패 — 직접 붙여넣기 해주세요', 'warn');
}

// ── 논문 삭제 ──────────────────────────────────────────────
async function deletePaper(id) {
    if (!confirm('이 논문을 삭제할까요?')) return;
    await dbDelete(STORE_PAPERS, id);
    await loadData();
    renderContent();
    closeForm();
    showToast('논문이 삭제되었습니다', 'success');
}

// ── DOI 자동 불러오기 ──────────────────────────────────────
async function lookupDOI() {
    const input = document.getElementById('doi-input').value.trim();
    if (!input) { showToast('DOI를 입력하세요', 'error'); return; }

    const btn = document.getElementById('btn-doi-lookup');
    btn.innerHTML = '<span class="spinner"></span>불러오는 중...';
    btn.disabled = true;

    try {
        const doi = input.replace(/.*doi\.org\//i, '').trim();
        const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
        if (!res.ok) throw new Error('DOI를 찾을 수 없습니다. 한국 논문은 RISS 인용 붙여넣기를 사용하세요.');
        const item = (await res.json()).message;
        const data = parseCrossRef(item);

        applyCrossRefToForm(data, doi, false);   // 직접 누른 경우이므로 덮어쓴다

        const TYPE_KO = { journal: '학술지 논문', thesis: '학위논문', book: '단행본', chapter: '책의 장', web: '웹자료·보고서' };
        showToast(`불러왔습니다 — 유형: ${TYPE_KO[data.itemType] || '학술지 논문'}. 내용이 맞는지 꼭 확인하세요.`, 'info');
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btn.innerHTML = '자동 불러오기';
        btn.disabled = false;
    }
}

// ══════════════════════════════════════════════════════════════
// RIS 파일 읽기 — 도서관·RISS·KCI 의 「내보내기」로 받은 서지정보 파일.
// 한 줄이 "이름표  - 값" 이고, ER 로 논문 한 편이 끝난다. 여러 편이 이어 붙어 있다.
//   TY  - JOUR / AU  - 박은하 / TI  - 제목 / PY  - 2025 / ER  -
// API 와 주는 내용은 같고 통로만 다르다(앱이 받아오는 대신 사용자가 파일로 들고 옴).
// ══════════════════════════════════════════════════════════════

// RIS 자료유형 → 앱의 자료 유형
const RIS_TYPE = {
    JOUR: 'journal', EJOUR: 'journal', CPAPER: 'journal', CONF: 'journal',
    THES: 'thesis',
    BOOK: 'book', EBOOK: 'book', SER: 'book',
    CHAP: 'chapter', ECHAP: 'chapter',
    RPRT: 'web', ELEC: 'web', WEB: 'web', GEN: 'journal',
};

// 한국 사이트의 RIS 는 EUC-KR 로 저장된 경우가 있어 글자가 깨진다.
// UTF-8 로 읽어보고 깨짐 문자(U+FFFD)가 섞이면 EUC-KR 로 다시 읽는다.
async function readTextSmart(file) {
    const buf = await file.arrayBuffer();
    let txt = new TextDecoder('utf-8').decode(buf);
    if (txt.includes('�')) {
        try {
            const alt = new TextDecoder('euc-kr').decode(buf);
            if (!alt.includes('�')) {
                pushDebug('info', 'RIS: EUC-KR 로 다시 읽음');
                return alt;
            }
        } catch (_) { /* 브라우저가 euc-kr 을 모르면 그대로 둔다 */ }
    }
    return txt;
}

// RIS 원문 → 레코드 배열 [{TY:'JOUR', AU:['박은하'], TI:'제목', ...}]
function parseRIS(text) {
    const records = [];
    let cur = null, lastTag = null;
    for (const rawLine of String(text || '').split(/\r?\n/)) {
        const line = rawLine.replace(/^﻿/, '');
        const m = line.match(/^([A-Z][A-Z0-9])\s{2}-\s?(.*)$/);
        if (m) {
            const [, tag, val] = m;
            if (tag === 'TY') { cur = {}; records.push(cur); }
            if (!cur) { cur = {}; records.push(cur); }
            if (tag === 'ER') { cur = null; lastTag = null; continue; }
            (cur[tag] = cur[tag] || []).push(val.trim());
            lastTag = tag;
        } else if (cur && lastTag && line.trim()) {
            // 줄이 길어 다음 줄로 이어진 경우
            const arr = cur[lastTag];
            arr[arr.length - 1] += ' ' + line.trim();
        }
    }
    return records.filter(r => Object.keys(r).length);
}

// RIS 레코드 → 앱의 논문 객체 (id·projectId 는 저장할 때 붙인다)
function risToPaper(r) {
    const one = (...tags) => { for (const t of tags) if (r[t]?.length) return r[t][0]; return ''; };
    const all = (...tags) => { for (const t of tags) if (r[t]?.length) return r[t]; return []; };

    const type = RIS_TYPE[(one('TY') || '').toUpperCase()] || 'journal';
    const authors = all('AU', 'A1').join(', ');
    const editors = all('A2', 'ED').join(', ');
    const title = one('TI', 'T1');
    const container = one('JO', 'JF', 'JA', 'T2');   // 학술지명 또는 책 제목
    const year = (one('PY', 'Y1', 'DA').match(/\d{4}/) || [''])[0];
    const sp = one('SP'), ep = one('EP');
    const pages = one('SE') || (sp && ep ? `${sp}-${ep}` : sp || '');
    const doi = one('DO', 'DOI').replace(/^https?:\/\/doi\.org\//i, '');

    const p = {
        itemType: type,
        title, authors, year,
        source:   type === 'chapter' ? '' : container,
        bookTitle: type === 'chapter' ? container : '',
        editors,
        volume: one('VL'), issue: one('IS'), pages,
        doi, url: one('UR', 'L1'),
        publisher: one('PB'), edition: one('ET'),
        abstract: one('AB', 'N2'),
        tags: all('KW'),
        variables: [], analysis: {},
        myNote: '', methods: '', findings: '',
        readStatus: 'unread',
        fullText: '', fullTextHtml: '', attachedImages: [],
        pdfData: null, pdfFilename: '', pdfFolderFile: null, pdfLink: null,
    };
    // 학위논문인데 기관이 PB 에만 있는 경우 학술지명 칸으로 옮긴다(APA 형식이 여기서 기관을 읽음)
    if (type === 'thesis' && !p.source && p.publisher) { p.source = p.publisher; p.publisher = ''; }
    return p;
}

// RIS 파일을 읽어 미리 보여주고, 고른 것만 저장한다.
// 바로 저장하지 않는 이유: 도서관마다 내보내기 품질이 달라서 권·호·쪽이 비는 경우가 있다.
async function importRisFile(file) {
    let recs;
    try {
        const text = await readTextSmart(file);
        recs = parseRIS(text).map(risToPaper).filter(p => p.title);
    } catch (err) {
        pushDebug('warn', `RIS 읽기 실패: ${err.message}`);
        showToast('파일을 읽지 못했어요', 'error');
        return;
    }
    if (!recs.length) {
        showToast('서지정보를 찾지 못했어요. RIS 형식이 맞는지 확인해 주세요.', 'error');
        return;
    }
    pushDebug('info', `RIS 파싱 — ${recs.length}편 (${file.name})`);

    const TYPE_KO = { journal: '학술지', thesis: '학위논문', book: '단행본', chapter: '책의 장', translation: '번역서', web: '웹자료' };
    const existing = state.papers;
    const rows = recs.map((p, i) => {
        const dup = existing.find(e =>
            (p.doi && e.doi && e.doi.replace(/^https?:\/\/doi\.org\//i, '') === p.doi) ||
            (e.title || '').trim() === p.title.trim());
        const miss = [];
        if (!p.authors) miss.push('저자');
        if (!p.year) miss.push('연도');
        if (p.itemType === 'journal' && !p.source) miss.push('학술지명');
        return `<label class="ris-row${dup ? ' ris-dup' : ''}">
            <input type="checkbox" class="ris-ck" data-i="${i}" ${dup ? '' : 'checked'}>
            <span class="ris-type">${TYPE_KO[p.itemType] || ''}</span>
            <span class="ris-main">
                <b>${escHtml(p.title)}</b>
                <span class="ris-sub">${escHtml([p.authors, p.year, p.source || p.bookTitle].filter(Boolean).join(' · ')) || '<span class="muted">서지정보 부족</span>'}</span>
                ${dup ? '<span class="ris-badge ris-badge-dup">이미 있음</span>' : ''}
                ${miss.length ? `<span class="ris-badge ris-badge-miss">${miss.join('·')} 없음</span>` : ''}
            </span>
        </label>`;
    }).join('');

    const ov = document.createElement('div');
    ov.className = 'modal-overlay ris-overlay';
    ov.innerHTML = `
        <div class="modal ris-modal">
            <div class="modal-header">
                <h2>가져올 논문 고르기 <span class="ris-count">${recs.length}편</span></h2>
                <button type="button" class="modal-close" id="ris-close" title="닫기">✕</button>
            </div>
            <div class="ris-body">
                <div class="ris-tools">
                    <button type="button" class="btn-secondary" id="ris-all">모두 선택</button>
                    <button type="button" class="btn-secondary" id="ris-none">모두 해제</button>
                    <span class="ris-hint">「이미 있음」은 기본으로 꺼져 있습니다. 저장 후 논문을 열어 빠진 칸을 채우세요.</span>
                </div>
                <div class="ris-list">${rows}</div>
                <div class="ris-foot">
                    <button type="button" class="btn-secondary" id="ris-cancel">취소</button>
                    <button type="button" class="btn-primary" id="ris-save">선택한 논문 가져오기</button>
                </div>
            </div>
        </div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    ov.querySelector('#ris-close').onclick = close;
    ov.querySelector('#ris-cancel').onclick = close;
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.querySelector('#ris-all').onclick  = () => ov.querySelectorAll('.ris-ck').forEach(c => c.checked = true);
    ov.querySelector('#ris-none').onclick = () => ov.querySelectorAll('.ris-ck').forEach(c => c.checked = false);

    ov.querySelector('#ris-save').onclick = async () => {
        const picked = [...ov.querySelectorAll('.ris-ck')].filter(c => c.checked).map(c => recs[+c.dataset.i]);
        if (!picked.length) { showToast('고른 논문이 없어요', 'warn'); return; }
        const btn = ov.querySelector('#ris-save');
        btn.disabled = true; btn.textContent = '저장 중…';
        for (const p of picked) {
            await dbPut(STORE_PAPERS, { ...p, id: genId(), projectId: state.currentProjectId,
                                        addedAt: Date.now(), updatedAt: Date.now() });
        }
        pushDebug('info', `RIS 가져오기 완료 — ${picked.length}편 저장`);
        close();
        await loadData();
        renderContent();
        showToast(`${picked.length}편을 가져왔어요. PDF는 논문을 열어 「폴더에서 연결」로 이어주세요.`, 'success');
    };
}

// ── PDF 본문에서 DOI 찾기 ─────────────────────────────────
// DOI는 "10.기관번호/논문번호" 모양이고 논문 표지·각주에 거의 항상 인쇄되어 있다.
// ⚠️ 논문 뒤쪽 참고문헌 목록에는 "다른 논문"의 DOI가 잔뜩 있다.
//    그래서 앞부분(표지·초록)만 본다. 뒤까지 보면 엉뚱한 논문이 들어온다.
const DOI_RE = /\b10\.\d{4,9}\/[^\s"'<>,;)\]}]+/i;

function extractDoiFromText(txt) {
    if (!txt) return '';
    const head = String(txt).slice(0, 4000);
    const m = head.match(DOI_RE);
    if (!m) return '';
    return m[0].replace(/[.,;:)\]}]+$/, '');   // 문장부호가 붙어 잡히는 경우 제거
}

// CrossRef 결과를 폼에 넣는다. onlyEmpty=true 면 이미 적힌 칸은 건드리지 않는다.
function applyCrossRefToForm(data, doi, onlyEmpty) {
    const put = (id, v) => {
        if (!v) return;
        const el = document.getElementById(id);
        if (!el) return;
        if (onlyEmpty && el.value.trim()) return;
        el.value = v;
    };
    put('f-title', data.title);
    put('f-authors', data.authors);
    put('f-year', data.year);
    put('f-source', data.source);
    put('f-abstract', data.abstract);
    put('f-doi', doi);
    put('f-volume', data.volume); put('f-issue', data.issue); put('f-pages', data.pages);
    put('f-publisher', data.publisher); put('f-booktitle', data.bookTitle); put('f-editors', data.editors);

    const sel = document.getElementById('f-itemtype');
    if (sel && data.itemType) { sel.value = data.itemType; applyItemTypeUI(data.itemType); }
}

// PDF를 첨부하면 본문에서 DOI를 찾아 서지정보까지 자동으로 채운다.
// 이미 적혀 있는 칸은 덮어쓰지 않는다(손으로 넣은 내용을 지우지 않으려고).
async function tryAutoDoiFromText(txt) {
    const doiEl = document.getElementById('f-doi');
    if (!doiEl || doiEl.value.trim()) return;      // 이미 DOI가 있으면 그대로 둔다

    const doi = extractDoiFromText(txt);
    if (!doi) { pushDebug('info', 'PDF에서 DOI를 찾지 못함'); return; }

    doiEl.value = doi;
    pushDebug('info', `PDF에서 DOI 발견: ${doi}`);
    showToast(`DOI를 찾았어요 — 서지정보를 불러오는 중…`, 'info');
    try {
        const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
        if (!res.ok) throw new Error(`조회 실패 (${res.status})`);
        const data = parseCrossRef((await res.json()).message);
        applyCrossRefToForm(data, doi, true);
        const TYPE_KO = { journal: '학술지 논문', thesis: '학위논문', book: '단행본', chapter: '책의 장', web: '웹자료·보고서' };
        pushDebug('info', `DOI 자동조회 성공 — 유형:${data.itemType} 제목:${(data.title||'').slice(0,30)}`);
        showToast(`서지정보를 자동으로 채웠어요 (${TYPE_KO[data.itemType] || ''}) — 맞는지 확인해 주세요`, 'success');
    } catch (err) {
        pushDebug('warn', `DOI 자동조회 실패: ${err.message}`);
        showToast('DOI는 찾았지만 정보를 못 불러왔어요 — 「자동 불러오기」를 눌러보세요', 'warn');
    }
}

function parseCrossRef(item) {
    const title = item.title?.[0] || '';
    const authors = (item.author || [])
        .map(a => [a.family, a.given].filter(Boolean).join(' ')).join(', ');
    const year = String(
        item.published?.['date-parts']?.[0]?.[0]
        || item['published-print']?.['date-parts']?.[0]?.[0]
        || item['published-online']?.['date-parts']?.[0]?.[0]
        || ''
    );
    const abstract = (item.abstract || '').replace(/<[^>]+>/g, '');

    // CrossRef 의 type 으로 APA 자료 유형을 자동으로 정한다 (사람이 안 골라도 되게)
    const CR_TYPE = {
        'journal-article': 'journal',
        'proceedings-article': 'journal',
        'book-chapter': 'chapter',
        'book-part': 'chapter',
        'book': 'book',
        'monograph': 'book',
        'edited-book': 'book',
        'reference-book': 'book',
        'dissertation': 'thesis',
        'report': 'web',
        'posted-content': 'web',
    };
    const itemType = CR_TYPE[item.type] || 'journal';

    // 유형에 따라 어느 칸에 넣을지 달라진다
    const container = item['container-title']?.[0] || '';
    const publisher = item.publisher || '';
    const source    = itemType === 'journal' ? container : (itemType === 'chapter' ? '' : container);
    const bookTitle = itemType === 'chapter' ? container : '';
    const editors   = (item.editor || []).map(a => [a.family, a.given].filter(Boolean).join(' ')).join(', ');

    return {
        title, authors, year, abstract, itemType,
        source, publisher, bookTitle, editors,
        volume: item.volume || '',
        issue:  item.issue || '',
        pages:  item.page || '',
        doi:    item.DOI || '',
    };
}

// ── 백업 JSON 생성 ──────────────────────────────────────────
// skipBinary=true: 폴더 자동백업용 — PDF/첨부파일 바이너리 제외 (문자열 크기 초과 방지)
// skipBinary=false: 내보내기 다운로드용 — 전체 포함
async function buildBackupJson(skipBinary = false) {
    const papers = await dbGetAll(STORE_PAPERS);
    pushDebug('info', `백업생성 — 논문${papers.length}편 / PDF있음:${papers.filter(p=>p.pdfData).length}편 / fullText있음:${papers.filter(p=>p.fullText).length}편`);
    const exportable = papers.map(p => ({
        ...p,
        pdfData: (!skipBinary && p.pdfData) ? bufToB64(p.pdfData) : null,
        _pdfEncoded: !!p.pdfData,   // PDF 존재 여부 플래그는 항상 유지
    }));
    const materials = await dbGetAll(STORE_MATERIALS);
    const exportableMat = materials.map(m => ({
        ...m,
        fileData: (!skipBinary && m.fileData) ? bufToB64(m.fileData) : null,
        _fileEncoded: !!m.fileData,
    }));
    const notes = await dbGetAll(STORE_NOTES);
    const proposals = await dbGetAll(STORE_PROPOSALS);
    return JSON.stringify(
        { version: 3, exportedAt: Date.now(), papers: exportable, materials: exportableMat, notes, proposals },
        null, 2);
}

// ── 폴더 백업: 지정 폴더의 같은 파일에 최신본 덮어쓰기 ──────
const BACKUP_FILENAME = '연구노트_최신백업.json';
const BACKUP_HANDLE_KEY = 'backupDir';
let backupDirHandle = null;
let autoBackupTimer = null;

// 앱 시작 시 저장해둔 백업 폴더 핸들 복원(권한 요청은 안 함)
// ══════════════════════════════════════════════════════════════
// 논문 PDF 폴더 연결 — 파일을 브라우저에 복사하지 않고 폴더에서 바로 읽는다.
// 첨부(pdfData)는 PDF를 통째로 브라우저에 복사해 두 벌이 되지만,
// 이 방식은 "폴더 + 파일이름"만 기억하므로 사본이 생기지 않는다.
// 폴더 허락은 한 번만 받으면 그 안의 모든 PDF에 적용된다(몇백 편이어도 1회).
// ══════════════════════════════════════════════════════════════
const PAPERDIR_HANDLE_KEY = 'paperDir';
let paperDirHandle = null;

async function loadPaperDirHandle() {
    try {
        const rec = await dbGet(STORE_SETTINGS, PAPERDIR_HANDLE_KEY);
        if (rec && rec.handle) paperDirHandle = rec.handle;
    } catch (err) {
        pushDebug('warn', `논문 폴더 핸들 로드 실패: ${err.message}`);
    }
}

// 읽기 권한 확인. 브라우저를 껐다 켜면 한 번은 다시 허락을 받아야 한다(보안 규칙).
async function ensurePaperDirPermission(canPrompt) {
    if (!paperDirHandle) return false;
    const opts = { mode: 'read' };
    if ((await paperDirHandle.queryPermission(opts)) === 'granted') return true;
    if (canPrompt && (await paperDirHandle.requestPermission(opts)) === 'granted') return true;
    return false;
}

// 사용자가 논문 폴더를 고른다 (한 번만)
async function pickPaperDir() {
    if (!window.showDirectoryPicker) {
        showToast('이 브라우저는 폴더 연결을 지원하지 않아요. 크롬을 써주세요.', 'error');
        return false;
    }
    try {
        paperDirHandle = await window.showDirectoryPicker({ id: 'researchNotesPapers', mode: 'read' });
        await dbPut(STORE_SETTINGS, { id: PAPERDIR_HANDLE_KEY, handle: paperDirHandle });
        const n = (await listFolderPdfs()).length;
        showToast(`논문 폴더를 연결했어요 — PDF ${n}개를 찾았습니다`, 'success');
        pushDebug('info', `논문 폴더 지정 — PDF ${n}개`);
        return true;
    } catch (err) {
        if (err?.name !== 'AbortError') pushDebug('warn', `논문 폴더 선택 실패: ${err.message}`);
        return false;
    }
}

// 폴더 안의 PDF 파일 이름 목록
async function listFolderPdfs() {
    if (!paperDirHandle || !(await ensurePaperDirPermission(true))) return [];
    const out = [];
    for await (const entry of paperDirHandle.values()) {
        if (entry.kind === 'file' && /\.pdf$/i.test(entry.name)) out.push(entry.name);
    }
    return out.sort((a, b) => a.localeCompare(b, 'ko'));
}

// 폴더의 파일을 File 객체로 얻는다 (텍스트 추출 등에 그대로 쓸 수 있게)
async function getFolderFile(name) {
    if (!paperDirHandle || !name) return null;
    if (!(await ensurePaperDirPermission(true))) return null;
    try {
        return await (await paperDirHandle.getFileHandle(name)).getFile();
    } catch (err) {
        pushDebug('warn', `폴더 파일 열기 실패(${name}): ${err.message}`);
        return null;
    }
}

// 폴더에 이 이름의 파일이 있는지 확인 (끌어다 놓은 파일이 논문 폴더 안인지 판별용)
async function folderHasFile(name) {
    return !!(await getFolderFile(name));
}

// 폴더에서 PDF 하나를 읽어 온다 (복사 저장 없음 — 읽을 때만 메모리에 올림)
async function readFolderPdf(name) {
    if (!paperDirHandle || !name) return null;
    if (!(await ensurePaperDirPermission(true))) return null;
    const fh = await paperDirHandle.getFileHandle(name);
    const file = await fh.getFile();
    return await file.arrayBuffer();
}

// 논문의 PDF 내용을 얻는다 — 첨부본(pdfData)이 있으면 그걸, 없으면 폴더에서.
async function getPaperPdfBuf(paper) {
    if (paper?.pdfData) return paper.pdfData;
    if (paper?.pdfFolderFile) {
        try {
            return await readFolderPdf(paper.pdfFolderFile);
        } catch (err) {
            pushDebug('warn', `폴더 PDF 읽기 실패(${paper.pdfFolderFile}): ${err.message}`);
            return null;
        }
    }
    return null;
}

// 폴더의 PDF 목록에서 하나 고르는 작은 창 (검색 가능 — 몇백 개여도 찾기 쉽게)
async function openFolderPickModal(onPick) {
    if (!paperDirHandle && !(await pickPaperDir())) return;
    const names = await listFolderPdfs();
    if (!names.length) { showToast('폴더에 PDF가 없어요', 'warn'); return; }

    const ov = document.createElement('div');
    ov.className = 'modal-overlay fp-overlay';
    ov.innerHTML = `
        <div class="modal fp-modal">
            <div class="modal-header">
                <h2>폴더에서 PDF 고르기</h2>
                <button type="button" class="modal-close" id="fp-close" title="닫기">✕</button>
            </div>
            <div class="fp-body">
                <input type="text" id="fp-search" class="fp-search" placeholder="파일 이름 검색… (${names.length}개)" autocomplete="off">
                <div class="fp-list" id="fp-list"></div>
                <div class="fp-foot">
                    <button type="button" class="btn-secondary" id="fp-rechoose">다른 폴더 지정</button>
                    <span class="fp-hint">파일은 복사되지 않고 폴더에서 바로 읽습니다</span>
                </div>
            </div>
        </div>`;
    document.body.appendChild(ov);

    const listEl = ov.querySelector('#fp-list');
    const draw = (q = '') => {
        const kw = q.trim().toLowerCase();
        const hit = kw ? names.filter(n => n.toLowerCase().includes(kw)) : names;
        listEl.innerHTML = hit.length
            ? hit.slice(0, 300).map(n => `<button type="button" class="fp-item" data-name="${escHtml(n)}">${escHtml(n)}</button>`).join('')
            : '<div class="fp-empty">찾는 이름이 없어요</div>';
        listEl.querySelectorAll('.fp-item').forEach(b =>
            b.addEventListener('click', () => { close(); onPick(b.dataset.name); }));
    };
    const close = () => ov.remove();
    draw();
    ov.querySelector('#fp-search').addEventListener('input', e => draw(e.target.value));
    ov.querySelector('#fp-close').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.querySelector('#fp-rechoose').addEventListener('click', async () => {
        close();
        if (await pickPaperDir()) openFolderPickModal(onPick);
    });
    setTimeout(() => ov.querySelector('#fp-search')?.focus(), 30);
}

async function loadBackupHandle() {
    try {
        const rec = await dbGet(STORE_SETTINGS, BACKUP_HANDLE_KEY);
        if (rec && rec.handle) backupDirHandle = rec.handle;
    } catch (err) {
        pushDebug('warn', `백업 폴더 핸들 로드 실패: ${err.message}`);
    }
}

// 백업 폴더 쓰기 권한 확인(필요 시 1회 요청)
async function ensureBackupPermission(canPrompt) {
    if (!backupDirHandle) return false;
    const opts = { mode: 'readwrite' };
    if ((await backupDirHandle.queryPermission(opts)) === 'granted') return true;
    if (canPrompt && (await backupDirHandle.requestPermission(opts)) === 'granted') return true;
    return false;
}

// 실제 파일 쓰기(같은 파일명에 덮어쓰기)
async function writeBackupFile() {
    // 폴더 자동백업: PDF 바이너리 제외 (파일 크기 초과 방지)
    const json = await buildBackupJson(true);
    const fh = await backupDirHandle.getFileHandle(BACKUP_FILENAME, { create: true });
    const w = await fh.createWritable();
    await w.write(json);
    await w.close();
}

// "폴더백업" 버튼: 폴더 미지정이면 선택 후 저장. 브라우저 미지원이면 파일 다운로드로 대체
async function folderBackup() {
    pushDebug('info', `백업버튼 클릭 — 핸들:${!!backupDirHandle}`);
    if (!window.showDirectoryPicker) {
        // 브라우저가 폴더 선택을 지원하지 않으면 파일로 바로 내보내기
        const json = await buildBackupJson();
        download(json, `연구노트_백업_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
        showToast('백업 파일을 다운로드했어요', 'success');
        return;
    }
    try {
        const isNew = !backupDirHandle;
        if (isNew) {
            backupDirHandle = await window.showDirectoryPicker({ id: 'researchNotesBackup', mode: 'readwrite' });
            await dbPut(STORE_SETTINGS, { id: BACKUP_HANDLE_KEY, handle: backupDirHandle });
        }
        if (!(await ensureBackupPermission(true))) {
            showToast('백업 폴더 쓰기 권한이 필요합니다', 'error');
            return;
        }
        // 폴더를 처음 지정했고 백업 파일이 있으면 자료 자동 복원
        if (isNew) {
            await _restoreAllFromBackupFile();
        }
        pushDebug('info', '백업 파일 쓰기 시작');
        await writeBackupFile();
        pushDebug('info', '백업 파일 쓰기 완료');
        showToast(`백업 폴더 연결 완료!`, 'success');
        advanceWizardOnFolder();
    } catch (err) {
        if (err.name === 'AbortError') return;
        pushDebug('error', `폴더 백업 실패: ${err.message}`);
        showToast(`백업 실패: ${err.message}`, 'error');
    }
}

// 저장/삭제 후 자동 백업(권한이 이미 있을 때만 조용히, 1.5초 디바운스)
function autoBackup() {
    if (!backupDirHandle) return;
    clearTimeout(autoBackupTimer);
    autoBackupTimer = setTimeout(async () => {
        try {
            if (await ensureBackupPermission(false)) {
                await writeBackupFile();
                pushDebug('info', '자동 백업 완료');
            }
        } catch (err) {
            pushDebug('warn', `자동 백업 실패: ${err.message}`);
        }
    }, 1500);
}

// ── 로그인 후 백업 폴더에서 PDF 자동 복원 ───────────────────
// 권한이 이미 있으면 조용히, 없으면 사이드바에 복원 버튼 표시
async function autoLoadPdfsFromBackup() {
    pushDebug('info', `PDF자동복원 시작 — 폴더핸들:${!!backupDirHandle} 논문수:${state.papers.length}`);
    if (!backupDirHandle) { pushDebug('info', 'PDF자동복원 중단: 폴더핸들 없음'); return; }
    const missingList = state.papers.filter(p => !p.pdfData || !p.fullText);
    const missingMatList = state.materials.filter(m => !m.fileData);
    pushDebug('info', `복원필요논문: ${missingList.length}편 / 복원필요자료: ${missingMatList.length}개`);
    if (missingList.length === 0 && missingMatList.length === 0) { pushDebug('info', '자동복원 중단: 누락 없음'); return; }
    try {
        const perm = await backupDirHandle.queryPermission({ mode: 'read' });
        pushDebug('info', `폴더권한: ${perm}`);
        if (perm === 'granted') {
            await _loadPdfsFromBackupFile(false);
        } else {
            _showPdfRestoreButton();
            pushDebug('info', 'PDF복원 버튼 표시됨');
        }
    } catch(e) {
        pushDebug('warn', 'PDF 자동 로드 확인 실패: ' + e.message);
    }
}

function _showPdfRestoreButton() {
    const existing = document.getElementById('btn-pdf-restore');
    if (existing) return;
    const btn = document.createElement('button');
    btn.id = 'btn-pdf-restore';
    btn.className = 'btn-pdf-restore';
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>PDF 복원하기`;
    btn.title = '백업 폴더 접근을 허용해서 PDF를 복원해요';
    btn.onclick = async () => {
        try {
            const perm = await backupDirHandle.requestPermission({ mode: 'read' });
            if (perm === 'granted') {
                btn.remove();
                await _loadPdfsFromBackupFile(true);
            }
        } catch(e) {
            pushDebug('warn', 'PDF 복원 권한 요청 실패: ' + e.message);
        }
    };
    const footer = document.querySelector('.sidebar-footer');
    if (footer) footer.insertBefore(btn, footer.firstChild);
}

// 폴더 처음 지정 시 — 백업 파일 있으면 텍스트+PDF 전부 자동 복원
async function _restoreAllFromBackupFile() {
    try {
        let fh;
        try { fh = await backupDirHandle.getFileHandle(BACKUP_FILENAME); }
        catch { return; } // 백업 파일 없으면 조용히 종료
        const data = JSON.parse(await (await fh.getFile()).text());

        // 프로젝트 먼저 복원 (논문·자료가 projectId를 참조하므로)
        const existingProjects = await dbGetAll(STORE_PROJECTS);
        for (const proj of (data.projects || [])) {
            if (!existingProjects.find(e => e.id === proj.id))
                await dbPut(STORE_PROJECTS, proj);
        }

        // 논문 복원 — 이미 있는 논문은 fullText·PDF만 업데이트 (Firebase가 이 둘을 안 올림)
        const existingPapers = await dbGetAll(STORE_PAPERS);
        for (const p of (data.papers || [])) {
            const existing = existingPapers.find(e => e.id === p.id);
            if (existing) {
                let changed = false;
                if (!existing.fullText && p.fullText)       { existing.fullText = p.fullText; changed = true; }
                if (!existing.fullTextHtml && p.fullTextHtml) { existing.fullTextHtml = p.fullTextHtml; changed = true; }
                if (!existing.pdfData && p._pdfEncoded && p.pdfData) {
                    existing.pdfData = b64ToBuf(p.pdfData);
                    existing.pdfFilename = p.pdfFilename || existing.pdfFilename;
                    changed = true;
                }
                if (changed) await dbPut(STORE_PAPERS, existing);
                continue;
            }
            const paper = { ...p };
            if (p._pdfEncoded && p.pdfData) paper.pdfData = b64ToBuf(p.pdfData);
            delete paper._pdfEncoded;
            await dbPut(STORE_PAPERS, paper);
        }

        // 자료 복원
        const existingMat = await dbGetAll(STORE_MATERIALS);
        for (const m of (data.materials || [])) {
            if (existingMat.find(e => e.id === m.id)) continue;
            const mat = { ...m };
            if (m._fileEncoded && m.fileData) mat.fileData = b64ToBuf(m.fileData);
            delete mat._fileEncoded;
            await dbPut(STORE_MATERIALS, mat);
        }

        // 메모·프로포절·마인드맵 복원
        const existingNotes = await dbGetAll(STORE_NOTES);
        for (const n of (data.notes || [])) {
            if (!existingNotes.find(e => e.id === n.id)) await dbPut(STORE_NOTES, n);
        }
        const existingProp = await dbGetAll(STORE_PROPOSALS);
        for (const pr of (data.proposals || [])) {
            if (!existingProp.find(e => e.id === pr.id)) await dbPut(STORE_PROPOSALS, pr);
        }
        const existingMm = await dbGetAll(STORE_MINDMAPS);
        for (const mm of (data.mindmaps || [])) {
            if (!existingMm.find(e => e.id === mm.id)) await dbPut(STORE_MINDMAPS, mm);
        }

        await initProjects();
        await loadData();
        renderContent();
        const paperCount = (data.papers || []).length;
        if (paperCount > 0) showToast(`백업에서 논문 ${paperCount}편 등 자료를 불러왔어요!`, 'success');
        pushDebug('info', `백업 자동 복원 완료 — 논문 ${paperCount}편`);
    } catch(e) {
        pushDebug('warn', '백업 자동 복원 실패: ' + e.message);
    }
}

async function _loadPdfsFromBackupFile(showResult) {
    try {
        const fh = await backupDirHandle.getFileHandle(BACKUP_FILENAME);
        const file = await fh.getFile();
        const data = JSON.parse(await file.text());
        const papers = data.papers || [];
        pushDebug('info', `백업파일 논문수:${papers.length} 파일명:${BACKUP_FILENAME}`);
        let count = 0;
        for (const bp of papers) {
            const local = state.papers.find(p => p.id === bp.id);
            pushDebug('info', `백업논문: ${bp.title?.slice(0,15)} pdfEncoded:${bp._pdfEncoded} pdfData:${!!bp.pdfData} fullText:${bp.fullText?.length||0}자 local:${!!local}`);
            if (!local) continue;
            let changed = false;
            const merged = { ...local };
            if (!local.fullText && bp.fullText)           { merged.fullText = bp.fullText; changed = true; }
            if (!local.fullTextHtml && bp.fullTextHtml)   { merged.fullTextHtml = bp.fullTextHtml; changed = true; }
            if (!local.pdfData && bp._pdfEncoded && bp.pdfData) {
                merged.pdfData = b64ToBuf(bp.pdfData);
                merged.pdfFilename = bp.pdfFilename || local.pdfFilename;
                changed = true;
            }
            if (!changed) continue;
            await dbPut(STORE_PAPERS, merged);
            count++;
        }
        // 자료 첨부파일 복원
        const materials = data.materials || [];
        let matCount = 0;
        for (const bm of materials) {
            const local = state.materials.find(m => m.id === bm.id);
            if (!local) continue;
            if (!local.fileData && bm._fileEncoded && bm.fileData) {
                const merged = { ...local, fileData: b64ToBuf(bm.fileData), fileName: bm.fileName || local.fileName };
                await dbPut(STORE_MATERIALS, merged);
                matCount++;
            }
        }
        if (matCount > 0) pushDebug('info', `자료 첨부파일 복원: ${matCount}개`);
        pushDebug('info', `폴더복원 완료 — ${count}편 업데이트`);
        if (count > 0 || matCount > 0) {
            await loadData();
            renderContent();
            const msg = [count > 0 ? `논문 ${count}편` : '', matCount > 0 ? `자료 ${matCount}개` : ''].filter(Boolean).join(', ');
            if (showResult) showToast(`백업에서 ${msg} 복원 완료!`, 'success');
            else pushDebug('info', `자동 복원: ${msg}`);
        }
    } catch(e) {
        pushDebug('warn', 'PDF 복원 실패: ' + e.message);
    }
}

// ── 가져오기 ───────────────────────────────────────────────
async function importData(file) {
    try {
        const data = JSON.parse(await file.text());
        const papers = data.papers || [];
        const materials = data.materials || [];
        const importNotes = data.notes || [];
        const importProposals = data.proposals || [];
        if (!data.papers && !data.materials && !data.notes && !data.proposals) throw new Error('올바른 형식이 아닙니다');
        if (!confirm(`논문 ${papers.length}편, 자료 ${materials.length}개, 메모 ${importNotes.length}개를 가져옵니다. 기존 데이터에 추가됩니다.`)) return;

        const existingPapers = await dbGetAll(STORE_PAPERS);
        for (const p of papers) {
            const dup = existingPapers.find(e => e.id === p.id);
            if (dup) {
                let changed = false;
                // PDF 없는데 백업에 있으면 채워넣기
                if (!dup.pdfData && p._pdfEncoded && p.pdfData) {
                    dup.pdfData = b64ToBuf(p.pdfData);
                    dup.pdfFilename = p.pdfFilename || dup.pdfFilename;
                    changed = true;
                }
                if (!dup.fullText && p.fullText) { dup.fullText = p.fullText; changed = true; }
                if (dup.projectId !== state.currentProjectId) { dup.projectId = state.currentProjectId; changed = true; }
                if (changed) await dbPut(STORE_PAPERS, dup);
                continue;
            }
            const paper = { ...p };
            if (p._pdfEncoded && p.pdfData) paper.pdfData = b64ToBuf(p.pdfData);
            delete paper._pdfEncoded;
            paper.projectId = state.currentProjectId;
            await dbPut(STORE_PAPERS, paper);
        }
        const existingMat = await dbGetAll(STORE_MATERIALS);
        for (const m of materials) {
            const dup = existingMat.find(e => e.id === m.id);
            if (dup) {
                let changed = false;
                // 파일 없는데 백업에 있으면 채워넣기
                if (!dup.fileData && m._fileEncoded && m.fileData) {
                    dup.fileData = b64ToBuf(m.fileData);
                    dup.fileName = m.fileName || dup.fileName;
                    changed = true;
                }
                if (dup.projectId !== state.currentProjectId) { dup.projectId = state.currentProjectId; changed = true; }
                if (changed) await dbPut(STORE_MATERIALS, dup);
                continue;
            }
            const mat = { ...m };
            if (m._fileEncoded && m.fileData) mat.fileData = b64ToBuf(m.fileData);
            delete mat._fileEncoded;
            mat.projectId = state.currentProjectId;
            await dbPut(STORE_MATERIALS, mat);
        }
        const existingNotes = await dbGetAll(STORE_NOTES);
        for (const n of importNotes) {
            const dup = existingNotes.find(e => e.id === n.id);
            if (dup) {
                if (dup.projectId !== state.currentProjectId) {
                    dup.projectId = state.currentProjectId;
                    await dbPut(STORE_NOTES, dup);
                }
                continue;
            }
            await dbPut(STORE_NOTES, { ...n, projectId: state.currentProjectId });
        }
        // 프로포절(프로젝트당 1개, key=projectId) — 백업의 가장 알찬 것을 현재 프로젝트로.
        // 단, 현재 프로젝트에 이미 프로포절이 있으면 덮어쓰지 않음(기존 작업 보호).
        if (importProposals.length) {
            const richest = importProposals.slice()
                .sort((a, b) => proposalContentScore(b) - proposalContentScore(a))[0];
            const current = await loadProposal(state.currentProjectId);
            if (proposalContentScore(current) === 0 && proposalContentScore(richest) > 0) {
                await dbPut(STORE_PROPOSALS, { ...richest, id: state.currentProjectId, updatedAt: Date.now() });
            }
        }
        await loadData();
        renderContent();
        showToast(`논문 ${papers.length}편, 자료 ${materials.length}개, 메모 ${importNotes.length}개를 가져왔습니다`, 'success');
    } catch (err) {
        showToast(`가져오기 실패: ${err.message}`, 'error');
    }
}

function bufToB64(buf) {
    const bytes = new Uint8Array(buf);
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

function b64ToBuf(b64) {
    const binary = atob(b64);
    const buf = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
    return buf.buffer;
}

function download(content, filename, type) {
    const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([content], { type })),
        download: filename,
    });
    a.click();
    URL.revokeObjectURL(a.href);
}

// ── 디버그 리포트 ──────────────────────────────────────────
function buildDebugReport() {
    const env = {
        시각: new Date().toISOString(),
        주소: location.href,
        브라우저: navigator.userAgent,
        DB버전: DB_VERSION,
        현재화면: state.view,
        프로젝트: state.currentProjectId,
        논문수: state.papers.length,
        자료수: state.materials.length,
    };
    const fmtDt = t => {
        const d = new Date(t);
        const date = `${d.getMonth()+1}/${d.getDate()}`;
        const time = d.toLocaleTimeString('ko-KR', { hour12: false });
        return `${date} ${time}`;
    };
    const lines = DEBUG_LOG.map(d =>
        `[${fmtDt(d.t)}] ${d.level.toUpperCase()}: ${d.msg}`);
    let persistedSection = '';
    try {
        const stored = JSON.parse(localStorage.getItem('debugPersist') || '[]');
        if (stored.length) {
            const pLines = stored.map(d => `[${fmtDt(d.t)}] ${d.level.toUpperCase()}: ${d.msg}`);
            persistedSection = `\n\n--- 이전 세션 오류·경고 (localStorage, ${stored.length}건) ---\n` + pLines.join('\n');
        }
    } catch(e) {}
    return `=== 연구노트 디버그 로그 ===\n`
        + Object.entries(env).map(([k, v]) => `${k}: ${v}`).join('\n')
        + `\n\n--- 현재 세션 기록 (${DEBUG_LOG.length}건) ---\n`
        + (lines.join('\n') || '(기록된 오류·경고 없음)')
        + persistedSection;
}

function openDebug() {
    document.getElementById('debug-output').value = buildDebugReport();
    document.getElementById('modal-debug').style.display = 'flex';
}

function closeDebug() {
    document.getElementById('modal-debug').style.display = 'none';
}

// ── 내 데이터 (저장 위치 안내 / 삭제) ──────────────────────
async function openDataInfo() {
    // 영구저장 상태
    let persisted = false;
    try { persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : false; } catch {}
    // 사용 용량
    let usageText = '';
    try {
        if (navigator.storage?.estimate) {
            const est = await navigator.storage.estimate();
            usageText = ` · 약 ${(est.usage / 1048576).toFixed(1)} MB 사용`;
        }
    } catch {}
    const folderText = backupDirHandle
        ? `<strong>'${escHtml(backupDirHandle.name)}'</strong> 폴더에 자동 저장 중`
        : '아직 지정 안 됨 — 사이드바 <strong>백업</strong> 버튼으로 폴더를 골라주세요';

    const proj = state.projects.find(p => p.id === state.currentProjectId);
    const projName = escHtml(proj?.name || '현재');

    document.getElementById('datainfo-body').innerHTML = `
        <div class="di-section">
            <div class="di-title">${icon('package')} 내 데이터는 어디 있나요?</div>
            <ul class="di-list">
                <li><b>브라우저 안</b>(이 컴퓨터): 평소 입력은 여기에 자동 저장돼요.
                    ${persisted
                        ? '<span class="di-ok">영구 저장 보호됨 ✅</span>'
                        : '<span class="di-warn">일반 저장(보호 미적용)</span>'}${usageText}
                    <div class="di-sub">브라우저 내부라 파일로 직접 보이진 않아요. "사이트 데이터 삭제"를 누르면 사라질 수 있어요.</div>
                </li>
                <li><b>백업 파일</b>(눈에 보이는 내 파일): ${folderText}
                    <div class="di-sub">탐색기에서 보이는 <code>연구노트_최신백업.json</code> 파일이에요. 구글드라이브/원드라이브 폴더로 정하면 클라우드에도 보관돼요.</div>
                </li>
                <li><b>클라우드(로그인 시)</b>: ${(typeof currentUser !== 'undefined' && currentUser)
                        ? `<span class="di-ok">${escHtml(currentUser.email || '로그인됨')} 로 동기화 중 ✅</span>`
                        : '<span class="di-warn">로그아웃 상태 — 동기화 꺼짐</span>'}
                    <div class="di-sub">로그인하면 논문·자료·메모·모형의 <b>글자 정보가 클라우드(서버)에 자동 저장</b>돼, 다른 컴퓨터에서 로그인해도 똑같이 보여요.
                    <b>로그아웃하면 이 컴퓨터에선 지워지지만 클라우드엔 남아</b> 다시 로그인하면 복원돼요.
                    단, <b>PDF 원본 파일은 클라우드에 안 올라가요</b>(용량 때문) — PDF는 구글드라이브 공유 링크를 넣어 쓰세요.</div>
                </li>
            </ul>
        </div>
        <div class="di-section di-danger">
            <div class="di-title">${icon('trash')} 데이터 삭제</div>
            <p class="di-sub">삭제 전, 사이드바 <b>백업</b> 또는 <b>보냄</b>으로 한 번 저장해두면 안전해요. 백업 파일이 있으면 <b>받음</b>으로 되살릴 수 있어요.</p>
            <div class="di-actions">
                <button class="btn-delete" id="di-clear-project">'${projName}' 프로젝트만 삭제</button>
                <button class="btn-delete" id="di-wipe-all">전체 초기화(모두 삭제)</button>
            </div>
        </div>`;

    document.getElementById('di-clear-project').onclick = clearCurrentProject;
    document.getElementById('di-wipe-all').onclick = wipeAllData;
    document.getElementById('modal-datainfo').style.display = 'flex';
}

function closeDataInfo() {
    document.getElementById('modal-datainfo').style.display = 'none';
}

async function clearCurrentProject() {
    const proj = state.projects.find(p => p.id === state.currentProjectId);
    const name = proj?.name || '현재';
    if (!confirm(`'${name}' 프로젝트의 논문·자료·메모·모형을 모두 삭제할까요?\n되돌릴 수 없어요.`)) return;
    if (!confirm('정말 삭제할까요?\n(백업 파일이 있으면 "받음"으로 복구할 수 있어요)')) return;

    const pid = state.currentProjectId;
    suppressAutoBackup = true;
    try {
        for (const store of [STORE_PAPERS, STORE_MATERIALS, STORE_NOTES]) {
            const all = await dbGetAll(store);
            for (const item of all) if (item.projectId === pid) await dbDelete(store, item.id);
        }
        await dbDelete(STORE_MINDMAPS, pid);
        await dbDelete(STORE_PROPOSALS, pid);
    } finally { suppressAutoBackup = false; }

    await loadData();
    closeDataInfo();
    renderContent();
    showToast(`'${name}' 프로젝트 데이터를 삭제했습니다`, 'success');
}

async function wipeAllData() {
    if (!confirm('모든 프로젝트의 모든 데이터(논문·자료·메모·모형)를 완전히 삭제하고\n처음 상태로 되돌립니다. 되돌릴 수 없어요.\n\n계속할까요?')) return;
    if (typeof currentUser !== 'undefined' && currentUser
        && !confirm('로그인 중입니다.\n클라우드와 다른 기기(웹·PC)에서도 함께 삭제됩니다.\n\n계속할까요?')) return;
    if (!confirm('정말 전부 삭제할까요?\n\n※ 「백업」 버튼으로 만든 파일에는 PDF가 없습니다.\n   PDF까지 되살리려면 「내보내기」 파일이 필요합니다.')) return;

    const synced = (typeof currentUser !== 'undefined' && !!currentUser);
    suppressAutoBackup = true;
    try {
        // ⚠️ dbClearStore(통째 비우기)만 쓰면 클라우드가 안 지워져서, 새로고침 때
        //    동기화로 전부 되살아난다. 그래서 항목마다 dbDelete 로 지운다 —
        //    dbDelete 는 후킹돼 있어 Firestore 삭제 + 삭제기록(tombstone)까지 남긴다.
        for (const store of [STORE_PAPERS, STORE_MATERIALS, STORE_NOTES, STORE_MINDMAPS, STORE_PROPOSALS, STORE_PROJECTS]) {
            const all = await dbGetAll(store);
            for (const item of all) await dbDelete(store, item.id);
            await dbClearStore(store);   // id 없는 잔여 항목까지 정리
        }
        localStorage.removeItem('currentProjectId');
        pushDebug('info', `전체 삭제 완료 — 클라우드:${synced ? '함께 삭제됨' : '해당없음(비로그인)'}`);
    } finally { suppressAutoBackup = false; }

    showToast('모든 데이터를 삭제했습니다. 새로고침합니다…', 'success');
    setTimeout(() => location.reload(), 800);
}

// ── 토스트 ─────────────────────────────────────────────────
function showToast(msg, type = 'info') {
    document.querySelector('.toast')?.remove();
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3500);
}

// ── 이벤트 바인딩 ──────────────────────────────────────────
// ── 사용 안내 챗봇 (서버/AI 없이 정해진 Q&A) ──────────────────
const GUIDE_INTRO = '안녕하세요! 연구노트 사용 안내예요 😊\n궁금한 걸 아래에서 골라 눌러보세요.';
const GUIDE_TOPICS = [
    { q: '이 앱은 뭐예요?',
      a: '논문을 읽고 정리해서 내 연구(논문 쓰기)를 돕는 앱이에요. 왼쪽 메뉴로 연구 책상·분류 모아보기·모형스케치북·아이디어·논문·자료·참고문헌을 오갈 수 있어요.\n자료는 이 브라우저(이 컴퓨터)에 저장돼요.' },
    { q: '메뉴가 뭐가 있어요?',
      a: '왼쪽 메뉴는:\n• 연구 책상 — 논문 읽으며 발췌·분류\n• 분류 모아보기 — 여러 논문을 항목별로 비교\n• 모형스케치북 — 연구모형 그리기\n• 아이디어 — 자유 메모\n• 논문 / 자료 — 목록 관리\n• 참고문헌 — APA 목록\n좌상단 로고를 누르면 홈으로 가요.' },
    { q: '홈 화면은요?',
      a: '좌상단 「내 연구노트」를 누르면 홈으로 가요.\n홈은 모형·아이디어·논문·자료를 4칸으로 요약해 보여주고, 칸을 누르면 그 화면으로 바로 이동해요.' },
    { q: '연구 책상이 뭐예요?',
      a: '논문을 펼쳐 읽으며 중요한 문장을 발췌하고 분류하는 공간이에요.\n왼쪽엔 PDF, 오른쪽엔 「복사붙이기 분류」와 「발표자료 만들기」 탭이 있어요. 논문을 안 골라도 열려요.' },
    { q: '발췌(분류)는 어떻게 해요?',
      a: '연구책상에서 PDF 문장을 드래그하면 그 자리에 형광펜 4색이 떠요.\n색을 누르면 PDF에 형광펜이 그어지고 동시에 오른쪽에 발췌 카드가 생겨요. 쪽 번호는 자동으로 붙어요.\n\n형광펜을 클릭하면 오른쪽 메모로, 발췌의 「p.12」를 누르면 그 쪽으로 이동해요.\n손으로 쓰는 메모는 오른쪽 아래 칸에 적고 Ctrl+Enter로 저장해요.\n\n발췌 카드에서 「프로포절로 보내기」를 누르면 연구계획서 칸으로 옮겨져요.' },
    { q: '담은 내용은 어디서 봐요?',
      a: '그 논문의 「보기」를 열면 맨 아래 "담은 발췌"가 항목별로 모여 보이고, 거기서 바로 고치거나 지울 수 있어요.\n또 위쪽 「논문 보기…」 드롭다운으로 어느 화면에서나 꺼내볼 수 있어요.' },
    { q: '분류 모아보기는요?',
      a: '여러 논문을 같은 항목으로 비교해요. 예를 들어 「연구의 필요성」을 고르면 여러 논문의 필요성 발췌가 한눈에 모여요.\n각 논문 「보기」로 세부도 볼 수 있어요.' },
    { q: '모형스케치북은요?',
      a: '연구모형(변인 그림)을 그리는 곳이에요.\n도형 추가 → 드래그로 이동 → 우클릭으로 화살표 연결 → 더블클릭으로 이름 입력.\n「미니 프로포절」에 연구 계획을 적고, 「발표자료 만들기」로 PPT를 내보내고, 「모형 저장」으로 여러 버전을 보관해요.' },
    { q: '아이디어 메뉴는요?',
      a: '「아이디어」는 떠오르는 생각·메모를 자유롭게 적어두는 공간이에요.\n논문과 별개로, 연구하다 떠오른 아이디어를 모아둘 수 있어요.' },
    { q: '논문은 어떻게 추가해요?',
      a: '① PDF를 내 논문 폴더에 넣어두고 ② 「논문 추가」 → 「📁 폴더에서 연결」로 파일을 고르면 ③ 앱이 본문에서 DOI를 찾아 제목·저자·학술지·권·호·쪽을 자동으로 채워요.\nRISS 인용문이나 DOI를 붙여넣어 자동 입력할 수 있고, 「정밀 분석」에서 정독하며 항목을 채울 수 있어요.' },
    { q: '자료 메뉴는요?',
      a: '「자료」는 논문이 아닌 자료를 보관해요 — 척도·도서·웹자료·보고서·강의자료 등.\n파일도 첨부할 수 있어요.' },
    { q: '참고문헌은요?',
      a: 'APA 7판 참고문헌을 자동으로 만들어요. 자료 유형(학술지·학위논문·단행본·책의 장·번역서·웹자료)에 맞는 형식으로 나와요.\n\n① 인용한 논문만 체크 → ② 「선택 항목 복사」 → ③ 한글에서 Ctrl+Alt+V → 「HTML 형식」 고르기\n\n⚠️ 그냥 Ctrl+V 하면 학술지명 기울임이 사라져요.' },
    { q: '자료는 어디에 저장되나요?',
      a: '네 곳이에요.\n\n① 내 논문 폴더 — PDF 원본. 내가 관리해요.\n② 브라우저 내부 — 앱이 실제로 읽고 쓰는 원본. 작업 공간이에요.\n③ 백업 폴더 — 글자로 된 건 전부(메모·발췌·형광펜·분석·원문텍스트). 저장 1.5초 뒤 자동으로 써져요. PDF 파일은 안 들어가요.\n④ 클라우드(로그인 시) — 글자로 된 건 전부. PC와 웹이 같은 내용을 봐요.\n\n메모·발췌·형광펜은 세 곳에 있어 안전해요. PDF는 논문 폴더 한 곳뿐이니 그 폴더만 잘 두면 돼요.' },
    { q: '백업 폴더는 어떻게 설정해요?',
      a: '왼쪽 아래 「백업」 버튼을 누르면 폴더를 선택하는 창이 열려요. 딱 한 번만 지정하면 그 다음부터는 논문을 추가하거나 수정할 때마다 자동으로 저장돼요.\n\n어느 폴더를 쓰면 좋을까요?\n• 구글 드라이브 폴더 → 가장 추천! 다른 PC에서도 복원 가능\n• 원드라이브·드롭박스 폴더 → 구글 드라이브와 동일하게 사용 가능\n• 내 PC 일반 폴더 → 같은 PC에서만 사용할 때\n\n글자로 된 자료가 JSON 파일 하나(연구노트_최신백업.json)에 담겨요. PDF 파일은 안 들어가요 — PDF는 내 논문 폴더에 원본이 있으니까요.' },
    { q: 'PDF는 어떻게 저장되나요?',
      a: 'PDF는 앱에 복사되지 않아요. 「폴더에서 연결」을 쓰면 앱은 "내 폴더의 이 파일"이라는 이름만 기억하고, 열 때마다 폴더에서 읽어요.\n\n그래서 PDF는 내 논문 폴더에 한 벌만 있어요. 브라우저 용량을 거의 안 쓰고, PC와 웹이 같은 파일을 봐요.\n\n⚠️ 원본 PDF를 지우거나 파일 이름을 바꾸면 안 돼요. 앱이 이름으로 찾기 때문이에요.\n연결이 끊겨도 메모와 형광펜은 안 사라지고, 다시 연결하면 그대로 되살아나요.\n\n다른 컴퓨터에서는 그 폴더(외장하드·드라이브 등)를 연결하고 폴더를 한 번만 지정하면 돼요.' },
    { q: '로그인이 꼭 필요한가요?',
      a: '아니요, 로그인 없이도 모든 기능을 쓸 수 있어요.\n\n로그인 없이 사용할 때:\n• 백업 폴더만 지정하면 PDF 포함 전체 자료가 안전하게 보관돼요\n• 항상 같은 PC에서 사용한다면 로그인이 필요 없어요\n\n로그인이 도움이 될 때:\n• 여러 기기(집·학교·노트북)에서 서지정보·메모를 바로 보고 싶을 때\n• 브라우저 데이터가 날아가도 텍스트를 자동 복구하고 싶을 때\n\n백업 폴더를 구글 드라이브로 지정하면 로그인 없이도 여러 기기에서 PDF까지 복원할 수 있어요.' },
    { q: '다른 컴퓨터에서도 쓸 수 있나요?',
      a: '네, 가능해요. 방법은 두 가지예요.\n\n방법 1 — 구글 드라이브 백업 폴더 (추천)\n① 구글 드라이브가 설치된 PC에서 백업 폴더를 구글 드라이브 폴더로 지정\n② 다른 PC에서 앱 접속 → 백업 폴더 연결 → PDF 포함 전체 복원\n\n방법 2 — 로그인\n① 로그인하면 서지정보·메모 등 텍스트는 어느 기기서든 자동 복원\n② PDF는 백업 폴더(구글 드라이브)가 있어야 복원됨\n\n두 방법을 함께 쓰면 가장 완전해요.' },
    { q: '백업은 어떻게 해요?',
      a: '평소엔 아무것도 안 해도 돼요. 논문·메모를 저장하면 1.5초 뒤 백업 폴더에 자동으로 써져요.\n「백업」 버튼은 폴더를 처음 정할 때만 누르면 돼요.\n\n「받음」은 반대 방향이에요 — 사고가 났을 때 백업 폴더의 연구노트_최신백업.json 을 골라 되돌려요.\n\n⚠️ 「모두 삭제」는 클라우드와 다른 기기에서도 함께 지워요. 되돌릴 방법은 백업 파일뿐이에요.' },
    { q: '로그인하면 뭐가 좋아요? (클라우드 동기화)',
      a: '왼쪽 맨 아래 「로그인하고 동기화」로 가입·로그인하면:\n• 서지정보·메모·AI요약·발췌 등 텍스트가 클라우드에 자동 저장돼요\n• 다른 컴퓨터에서 같은 계정으로 로그인하면 텍스트가 바로 복원돼요\n• 로그아웃해도 데이터는 안 지워져요 — 잠금화면만 표시돼요\n\n※ PDF·원문텍스트는 용량 때문에 클라우드에 안 올라가요. PDF는 백업 폴더(구글 드라이브 추천)로 관리해요.' },
    { q: 'AI 사용량 한도가 있나요?',
      a: 'Groq 무료 플랜 기준으로 분당 12,000 토큰 한도가 있어요.\n\n논문 한 편 분석에 약 6,000~9,000 토큰이 사용돼요.\n\n효율적으로 사용하는 방법:\n• 논문 한 편씩 차례로 분석하세요 (연속 2편 이상이면 1분 대기)\n• PDF가 첨부된 논문은 원문 전체를 분석해서 더 정확해요\n• 오류가 나면 1분 기다렸다가 다시 누르면 돼요\n\n사용량이 부족하면 Groq에서 유료 플랜을 선택하거나, API 키를 새로 발급받으면 초기화돼요.' },
    { q: 'AI 전체 분석은 어떻게 써요?',
      a: '논문을 열고 수정 모드에서 「🤖 AI 전체 분석」 버튼을 누르면 돼요.\n\nAI가 논문을 읽고 아래 항목들을 자동으로 채워줘요:\n• AI 요약 (연구목적·방법·결과·시사점)\n• 연구의 필요성\n• 주요 선행연구\n• 주요 이론\n• 연구방법\n• 주요 결과\n• 한계점\n• 시사점·제언\n\n이미 내용이 있는 칸은 덮어쓸지 물어봐요. 완료 후 자동 저장돼요.\n\n⚠️ AI 결과는 부정확할 수 있으니 반드시 원문과 대조해 확인하세요.' },
    { q: '빠른 인용이 뭐예요?',
      a: '사이드바 「빠른 인용 창 열기」를 누르면 작은 창이 떠요. 한글 옆에 두고 논문 쓰면서 쓰는 창이에요.\n\n저장된 논문이 전부 나와요. 검색해서 「(저자, 연도)」를 누르면 본문 인용이, 「APA」를 누르면 참고문헌 한 줄이 복사돼요.' },
];

function openGuide() {
    if (document.querySelector('.guide-overlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'guide-overlay';
    overlay.innerHTML = `
        <div class="guide-chat">
            <div class="guide-head">
                <span>${icon('bot')} 사용 안내 챗봇</span>
                <button type="button" class="guide-close" title="닫기">✕</button>
            </div>
            <div class="guide-msgs" id="guide-msgs"></div>
            <div class="guide-chips" id="guide-chips"></div>
        </div>`;
    document.body.appendChild(overlay);

    const msgs = overlay.querySelector('#guide-msgs');
    const addMsg = (who, text) => {
        const d = document.createElement('div');
        d.className = `guide-msg guide-msg-${who}`;
        d.innerHTML = escHtml(text).replace(/\n/g, '<br>');
        msgs.appendChild(d);
        msgs.scrollTop = msgs.scrollHeight;
    };
    addMsg('bot', GUIDE_INTRO);

    overlay.querySelector('#guide-chips').innerHTML =
        GUIDE_TOPICS.map((t, i) => `<button type="button" class="guide-chip" data-i="${i}">${escHtml(t.q)}</button>`).join('');
    overlay.querySelectorAll('.guide-chip').forEach(b =>
        b.addEventListener('click', () => {
            const t = GUIDE_TOPICS[+b.dataset.i];
            addMsg('user', t.q);
            setTimeout(() => addMsg('bot', t.a), 160);
        }));

    const close = () => overlay.remove();
    overlay.querySelector('.guide-close').addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
}

function bindEvents() {
    // 사이드바 접기/펴기 (앱 전체 — .sidebar에 collapsed 클래스만 토글)
    initSidebarToggle();

    // 좌상단 "내 연구노트" 로고 — 누르면 항상 메인(홈)으로
    document.querySelector('.logo')?.addEventListener('click', () => goToView('home'));

    // 사용 안내 챗봇 버튼
    document.getElementById('guide-btn')?.addEventListener('click', openGuide);

    // 탑바 "논문 보기" 드롭다운 — 어느 화면에서나 논문 골라 정리 내용 보기
    document.getElementById('paper-jump')?.addEventListener('change', e => {
        const id = e.target.value;
        if (id) { openForm(id, 'view'); e.target.value = ''; }
    });

    // 사이드바 네비
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.view = btn.dataset.view;
            state.searchQuery = '';
            document.getElementById('search-input').value = '';
            renderContent();
        });
    });

    // 검색
    let searchTimer;
    document.getElementById('search-input').addEventListener('input', e => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            state.searchQuery = e.target.value.trim();
            renderContent();
        }, 200);
    });

    // 추가 버튼 — 현재 화면에 맞춰 논문/자료/메모 추가
    const addByView = () => {
        if (state.view === 'materials') openMaterialForm();
        else if (state.view === 'notes') addNote();
        else openForm(null, 'edit');   // 논문 추가 → 바로 편집 창 열기
    };
    document.getElementById('btn-add').addEventListener('click', addByView);
    document.getElementById('btn-add-top').addEventListener('click', addByView);

    // 사용법 모달
    // 사용법 목차 — 항목을 누르면 그 섹션으로 이동하고 잠깐 테두리로 표시
    document.querySelectorAll('.help-toc-item').forEach(b =>
        b.addEventListener('click', () => {
            const sec = document.getElementById(b.dataset.go);
            if (!sec) return;
            sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
            sec.classList.add('help-jump');
            setTimeout(() => sec.classList.remove('help-jump'), 1300);
        }));

    // 스크롤에 따라 지금 보고 있는 항목을 목차에 표시 (위키처럼 위치를 알 수 있게)
    const helpScroller = document.querySelector('#modal-help .modal');
    if (helpScroller) {
        helpScroller.addEventListener('scroll', () => {
            const top = helpScroller.getBoundingClientRect().top + 80;
            let cur = null;
            document.querySelectorAll('.help-section').forEach(sec => {
                if (sec.getBoundingClientRect().top <= top) cur = sec.id;
            });
            document.querySelectorAll('.help-toc-item').forEach(b =>
                b.classList.toggle('on', b.dataset.go === cur));
        }, { passive: true });
    }

    document.getElementById('btn-help-guide').addEventListener('click', () => {
        document.getElementById('modal-help').style.display = 'flex';
        const hint = document.getElementById('help-scroll-hint');
        // .modal이 실제 스크롤 컨테이너
        const scrollEl = document.querySelector('#modal-help .modal');
        hint.classList.remove('hidden');
        scrollEl.onscroll = () => {
            const atBottom = scrollEl.scrollTop + scrollEl.clientHeight >= scrollEl.scrollHeight - 10;
            hint.classList.toggle('hidden', atBottom);
        };
    });
    document.getElementById('btn-help-close').addEventListener('click', () => {
        document.getElementById('modal-help').style.display = 'none';
    });
    document.getElementById('modal-help').addEventListener('click', e => {
        if (e.target === document.getElementById('modal-help'))
            document.getElementById('modal-help').style.display = 'none';
    });

    // 검색 모드 토글(키워드만 / 전체단어 / RISS)
    document.querySelectorAll('#search-mode-toggle .sm-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#search-mode-toggle .sm-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.searchMode = btn.dataset.mode;
            if (state.searchQuery) renderContent();
        });
    });

    // 미니 창 열기
    let _miniWin = null;
    document.getElementById('btn-open-mini').addEventListener('click', () => {
        // ?v= 를 붙여야 mini.html 을 고쳐도 크롬이 옛 것을 캐시로 쓰지 않는다.
        // 창이 이미 열려 있으면 focus 만 하면 옛 코드가 그대로 떠 있으므로 주소를 다시 넣어 새로 읽힌다.
        const miniUrl = 'mini.html?v=20260817p';
        // file:// 에서는 열린 창의 주소를 밖에서 바꾸는 게 막힐 수 있다.
        // 그래서 주소 바꾸기가 안 되면 창을 닫고 새로 연다(그래야 고친 코드가 읽힌다).
        if (_miniWin && !_miniWin.closed) {
            let moved = false;
            try { _miniWin.location.replace(miniUrl); moved = true; } catch (_) {}
            if (moved) { _miniWin.focus(); return; }
            try { _miniWin.close(); } catch (_) {}
            _miniWin = null;
        }
        _miniWin = window.open(miniUrl, '_blank',
            'width=300,height=600,resizable=yes,scrollbars=no');
    });

    // 논문 모달 닫기 / 보기↔수정 전환 / 삭제
    document.getElementById('close-form').addEventListener('click', closeForm);
    document.getElementById('btn-cancel-form').addEventListener('click', closeForm);
    // 상단 sticky 바 버튼
    document.getElementById('sbar-close').addEventListener('click', closeForm);
    document.getElementById('sbar-cancel').addEventListener('click', closeForm);
    document.getElementById('sbar-delete').addEventListener('click', () =>
        document.getElementById('btn-delete-paper').click());
    document.getElementById('sbar-edit').addEventListener('click', () => {
        const paper = state.papers.find(p => p.id === state.editingId);
        state.formMode = 'edit';
        applyFormMode('edit', paper);
    });
    document.getElementById('sbar-save').addEventListener('click', () =>
        document.getElementById('paper-form').requestSubmit());

    document.getElementById('btn-close-view').addEventListener('click', closeForm);
    document.getElementById('btn-switch-edit').addEventListener('click', () => {
        // 현재 폼 내용(AI 추출 변인 포함) 유지하면서 모드만 전환
        const paper = state.editingId ? state.papers.find(p => p.id === state.editingId) : null;
        state.formMode = 'edit';
        applyFormMode('edit', paper);
    });
    document.getElementById('btn-delete-paper').addEventListener('click', () => {
        if (state.editingId) deletePaper(state.editingId);
    });
    document.getElementById('modal-form').addEventListener('click', e => {
        if (e.target.id === 'modal-form') closeForm();
    });

    // 폼 제출
    document.getElementById('paper-form').addEventListener('submit', savePaper);

    // 자료 모달
    document.getElementById('close-material').addEventListener('click', closeMaterialForm);
    document.getElementById('btn-cancel-material').addEventListener('click', closeMaterialForm);
    document.getElementById('btn-close-material-view').addEventListener('click', closeMaterialForm);
    document.getElementById('btn-switch-material-edit').addEventListener('click', () => openMaterialForm(state.editingMaterialId, 'edit'));
    document.getElementById('btn-delete-material').addEventListener('click', () => {
        if (state.editingMaterialId) deleteMaterial(state.editingMaterialId);
    });
    document.getElementById('modal-material').addEventListener('click', e => {
        if (e.target.id === 'modal-material') closeMaterialForm();
    });
    document.getElementById('material-form').addEventListener('submit', saveMaterial);
    document.getElementById('btn-pick-mfile').addEventListener('click', () => document.getElementById('m-file').click());
    document.getElementById('m-file').addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) {
            state.currentMaterialFile = file;
            document.getElementById('mfile-name').textContent = file.name;
        }
    });

    // 내 데이터 (저장 위치 / 삭제)
    document.getElementById('btn-datainfo').addEventListener('click', openDataInfo);
    document.getElementById('close-datainfo').addEventListener('click', closeDataInfo);
    document.getElementById('modal-datainfo').addEventListener('click', e => {
        if (e.target.id === 'modal-datainfo') closeDataInfo();
    });

    // 디버그 로그
    document.getElementById('btn-debug').addEventListener('click', openDebug);
    document.getElementById('close-debug').addEventListener('click', closeDebug);
    document.getElementById('modal-debug').addEventListener('click', e => {
        if (e.target.id === 'modal-debug') closeDebug();
    });
    document.getElementById('btn-debug-copy').addEventListener('click', async () => {
        const ok = await copyToClipboard(document.getElementById('debug-output').value);
        showToast(ok ? '디버그 로그를 복사했습니다 — 채팅에 붙여넣어 주세요' : '복사 실패', ok ? 'success' : 'error');
    });
    document.getElementById('btn-debug-download').addEventListener('click', () => {
        download(buildDebugReport(), `연구노트_디버그_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`, 'text/plain');
    });
    document.getElementById('btn-debug-clear').addEventListener('click', () => {
        DEBUG_LOG.length = 0;
        const badge = document.getElementById('debug-badge');
        badge.textContent = '0'; badge.style.display = 'none';
        document.getElementById('debug-output').value = buildDebugReport();
        showToast('디버그 로그를 비웠습니다', 'success');
    });

    // DOI 불러오기
    document.getElementById('btn-doi-lookup').addEventListener('click', lookupDOI);
    document.getElementById('doi-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); lookupDOI(); }
    });

    // RISS 인용 파싱
    document.getElementById('btn-riss-parse').addEventListener('click', () => {
        const text = document.getElementById('riss-input').value.trim();
        if (!text) { showToast('RISS 인용 텍스트를 붙여넣어 주세요', 'error'); return; }
        const data = parseAPACitation(text);
        if (!data.title) { showToast('형식을 인식하지 못했습니다. 직접 입력해 주세요.', 'error'); return; }
        applyParsedToForm(data);
        showToast('입력됐습니다. 내용을 확인하고 필요하면 수정하세요.', 'success');
    });

    // 태그 입력
    document.getElementById('variables-input').addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const v = e.target.value.trim();
        if (v && !formVariables.includes(v)) {
            formVariables.push(v);
            renderChips('variables-list', formVariables, 'variable');
        }
        e.target.value = '';
    });

    // 일반 태그 입력
    document.getElementById('tags-input').addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const v = e.target.value.trim();
        if (v && !formTags.includes(v)) {
            formTags.push(v);
            renderChips('tags-list', formTags, 'normal');
        }
        e.target.value = '';
    });

    // 드라이브 폴더 열기
    document.getElementById('btn-open-drive').addEventListener('click', () => {
        const saved = localStorage.getItem('driveFolderUrl');
        if (saved) {
            window.open(saved, '_blank', 'noopener');
        } else {
            const url = prompt('구글 드라이브 폴더 링크를 입력하세요.\n(한 번만 입력하면 다음부터 바로 열려요)');
            if (url && url.startsWith('http')) {
                localStorage.setItem('driveFolderUrl', url);
                window.open(url, '_blank', 'noopener');
            }
        }
    });

    // PDF 선택
    // 자료 유형 바꾸면 필요한 칸만 보이게
    document.getElementById('f-itemtype')?.addEventListener('change', e => applyItemTypeUI(e.target.value));

    // 폴더에서 연결 — 복사 없이 이름만 기억
    document.getElementById('btn-link-folder')?.addEventListener('click', () => {
        openFolderPickModal(async name => {
            state.currentFolderFile = name;
            const el = document.getElementById('pdf-filename');
            if (el) el.textContent = `📁 ${name} (폴더 연결)`;
            showToast('폴더의 PDF와 연결했어요 — 저장을 눌러 반영하세요', 'success');

            // 원문 텍스트가 비어 있으면 뽑아 넣고, 그 안에서 DOI를 찾아 서지정보까지 채운다
            const ftEl = document.getElementById('f-fulltext');
            if (!ftEl || ftEl.value.trim()) return;
            const file = await getFolderFile(name);
            if (!file) return;
            _showPdfExtractingBadge('pdf-filename', true);
            const txt = await extractPdfText(file);
            _showPdfExtractingBadge('pdf-filename', false);
            if (txt) {
                ftEl.value = txt;
                showToast('PDF 텍스트 자동 추출 완료', 'success');
                await tryAutoDoiFromText(txt);
            } else {
                showToast('텍스트 추출 실패 — 직접 붙여넣기 해주세요', 'warn');
            }
        });
    });
    // 폴더백업 / 가져오기
    document.getElementById('btn-folder-backup').addEventListener('click', folderBackup);
    document.getElementById('btn-import').addEventListener('click', () => {
        document.getElementById('import-input').click();
    });
    document.getElementById('import-input').addEventListener('change', e => {
        const f = e.target.files[0];
        e.target.value = '';
        if (!f) return;
        // 한 버튼으로 두 가지를 받는다 — 앱 백업(.json)과 도서관 서지정보(.ris)
        if (/\.(ris|txt|nbib|enw)$/i.test(f.name)) importRisFile(f);
        else if (/\.json$/i.test(f.name))          importData(f);
        else showToast('읽을 수 없는 형식이에요. 백업 파일(.json) 또는 서지정보 파일(.ris)을 골라주세요.', 'error');
    });

    // 논문 추가 — 통합 모달
    document.getElementById('close-add-choice').addEventListener('click', closeAddChoice);
    document.getElementById('modal-add-choice').addEventListener('click', e => {
        if (e.target.id === 'modal-add-choice') closeAddChoice();
    });
    document.getElementById('btn-add-cancel').addEventListener('click', closeAddChoice);
    document.getElementById('btn-add-save').addEventListener('click', addChoiceSave);
    // 폴더에서 연결 — PDF를 복사하지 않고 논문 폴더의 파일을 가리킨다
    document.getElementById('btn-add-pdf-pick').addEventListener('click', () => {
        openFolderPickModal(async name => await _useFolderPdfForAdd(name));
    });
    document.getElementById('add-pdf-dropzone').addEventListener('dragover', e => {
        e.preventDefault(); e.currentTarget.classList.add('drag-over');
    });
    document.getElementById('add-pdf-dropzone').addEventListener('dragleave', e => {
        e.currentTarget.classList.remove('drag-over');
    });
    document.getElementById('add-pdf-dropzone').addEventListener('drop', async e => {
        e.preventDefault(); e.currentTarget.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (!file || file.type !== 'application/pdf') { showToast('PDF 파일만 가능합니다.', 'warn'); return; }
        // 끌어다 놓은 파일이 논문 폴더 안에 있는지 이름으로 확인한다.
        // 브라우저는 경로를 알려주지 않으므로 이름으로만 판별할 수 있다.
        if (!paperDirHandle) {
            showToast('먼저 「폴더에서 연결」로 논문 폴더를 한 번 지정해 주세요', 'warn');
            return;
        }
        if (!(await folderHasFile(file.name))) {
            showToast(`「${file.name}」이(가) 논문 폴더에 없어요. 폴더로 옮긴 뒤 다시 놓아주세요.`, 'warn');
            return;
        }
        await _useFolderPdfForAdd(file.name);
    });
    document.getElementById('btn-add-text-analyze').addEventListener('click', aiAnalyzeForAddForm);

    // AI 설정
    document.getElementById('btn-ai-settings').addEventListener('click', openAiSettings);
    document.getElementById('close-ai-settings').addEventListener('click', closeAiSettings);
    document.getElementById('btn-ai-key-cancel').addEventListener('click', closeAiSettings);
    document.getElementById('btn-ai-key-save').addEventListener('click', saveAiKey);
    document.getElementById('modal-ai-settings').addEventListener('click', e => {
        if (e.target.id === 'modal-ai-settings') closeAiSettings();
    });

    // AI 분석 버튼 (상단 고정 버튼 하나로 통합)
    document.getElementById('btn-ai-summarize-quick').addEventListener('click', aiAnalyzePaper);
    // btn-ai-extract 제거됨 — aiAnalyzePaper()에 통합

    // ESC 키
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeForm(); closeMaterialForm(); closeDebug(); closeAiSettings(); }
    });
}

// ── Groq AI ─────────────────────────────────────────────────
const GEMINI_LS_KEY = 'gemini_api_key';

function openAiSettings() {
    const key = localStorage.getItem(GEMINI_LS_KEY) || '';
    const inp = document.getElementById('ai-key-input');
    if (inp) inp.value = key;
    document.getElementById('modal-ai-settings').style.display = 'flex';
}
function closeAiSettings() {
    document.getElementById('modal-ai-settings').style.display = 'none';
}
function saveAiKey() {
    const key = (document.getElementById('ai-key-input')?.value || '').trim();
    if (key) {
        localStorage.setItem(GEMINI_LS_KEY, key);
        showToast('API 키가 저장되었습니다. AI 기능을 사용할 수 있습니다.', 'success');
    } else {
        localStorage.removeItem(GEMINI_LS_KEY);
        showToast('API 키가 삭제되었습니다.', 'info');
    }
    closeAiSettings();
}

// Rate limit 에러 메시지에서 실제 대기시간 추출
function parseRateWait(msg) {
    // "Please try again in 53m15.072s" 또는 "in 22.405s" 형태 파싱
    const m = msg.match(/try again in\s+(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i);
    if (!m) return null;
    const h = parseInt(m[1] || 0), min = parseInt(m[2] || 0), sec = Math.ceil(parseFloat(m[3] || 0));
    if (h > 0) return `${h}시간 ${min}분 후`;
    if (min > 0) return `${min}분 ${sec}초 후`;
    return `${sec}초 후`;
}

async function callGemini(parts) {
    const key = localStorage.getItem(GEMINI_LS_KEY);
    if (!key) { openAiSettings(); throw new Error('API 키를 먼저 입력해주세요.'); }
    // parts 배열에서 텍스트만 합쳐서 Groq에 전달
    const prompt = parts.map(p => p.text || '').join('\n').trim();
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({
            model: 'openai/gpt-oss-120b',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3
        })
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error?.message || `HTTP ${resp.status}`);
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || '';
}

// 현재 논문 정보로 프롬프트 parts 배열 구성 (Groq는 텍스트만 지원)
function buildPaperParts(promptText) {
    return [{ text: promptText }];
}

// 전문에서 섹션 감지 후 예산 내 최대한 채워서 반환
function extractPaperSections(text) {
    const TOTAL_BUDGET = 10000; // 전체 전송 한도 — 한국어 1~1.5자/토큰, 12000 TPM 내 안전값
    if (text.length <= TOTAL_BUDGET) return { mode: '전문', parts: [{ label: '전문', text }] };

    // 짧은 줄(≤55자)에 키워드가 포함되면 섹션 제목으로 판단 — 번호 형식 무관
    const INTRO_KW = ['서론', '들어가며', '들어가는 말', '서언', '연구의 필요성', '연구 필요성', 'introduction'];
    const CONC_KW  = ['결론', '논의', '시사점', '종합', '나가며', '나가는 말', 'conclusion', 'discussion'];

    function findSectionPos(kws) {
        const lines = text.split('\n');
        let pos = 0;
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.length > 0 && trimmed.length <= 55) {
                const lower = trimmed.toLowerCase();
                if (kws.some(k => lower.includes(k))) return pos;
            }
            pos += line.length + 1;
        }
        return -1;
    }

    const introPos = findSectionPos(INTRO_KW);
    const concPos  = findSectionPos(CONC_KW);
    const introMatch = introPos >= 0 ? { index: introPos } : null;
    const concMatch  = concPos  >= 0 ? { index: concPos  } : null;

    // 서론: 최대 2,500자
    const introStart = introMatch ? introMatch.index : 0;
    const introEnd   = introMatch ? introMatch.index + Math.min(2500, concMatch ? concMatch.index - introMatch.index : 2500) : 2000;
    const introText  = text.slice(introStart, introEnd);

    // 결론: 최대 3,500자
    const concStart     = concMatch ? concMatch.index : text.length - 3000;
    const conclusionText = text.slice(concStart, concStart + 3500);

    // 남은 예산으로 중간 본문(방법·결과) 채우기
    const usedSoFar   = introText.length + conclusionText.length;
    const middleBudget = Math.max(0, TOTAL_BUDGET - usedSoFar);
    const middleRaw    = text.slice(introEnd, concStart);
    const middleText   = middleRaw.slice(0, middleBudget).trim();

    const parts = [];
    parts.push({ label: '서론', text: introText });
    if (middleText) parts.push({ label: '본문(연구방법·결과)', text: middleText });
    parts.push({ label: concMatch ? '결론·논의' : '말미', text: conclusionText });

    const midPages = Math.round(middleText.length / 1000);
    const modeLabel = (introMatch && concMatch) ? `서론·결론 섹션 자동감지 + 본문 약 ${midPages}페이지 추가`
                    : concMatch                 ? `결론 섹션 자동감지 + 본문 약 ${midPages}페이지 추가 (서론 미감지)`
                    : introMatch                ? `서론 섹션 자동감지 + 본문 약 ${midPages}페이지 추가 (결론 미감지)`
                    :                             `섹션 미감지 — 앞뒤 내용 추출`;
    return { mode: modeLabel, parts };
}

async function aiSummarizePaper() {
    const paper    = state.editingId ? state.papers.find(p => p.id === state.editingId) : null;
    const title    = document.getElementById('f-title')?.value?.trim() || paper?.title || '';
    const abstract = document.getElementById('f-abstract')?.value?.trim() || paper?.abstract || '';
    const fullText = document.getElementById('f-fulltext')?.value?.trim() || paper?.fullText || '';
    if (!title && !abstract && !fullText) {
        showToast('요약할 내용이 없습니다. 초록 또는 원문 텍스트를 입력해주세요.', 'warn'); return;
    }
    const btn = document.getElementById('btn-ai-summarize-quick');
    const origText = btn?.innerHTML || '';
    if (btn) { btn.disabled = true; btn.textContent = '요약 중…'; }

    // 섹션 감지 및 예산 내 텍스트 구성
    // 초록도 예산에 포함 — 한국어 ~1자/토큰, 프롬프트 오버헤드 감안해 초록 800자 상한
    const abstractTrimmed = abstract ? abstract.slice(0, 800) : '';

    const sec = fullText ? extractPaperSections(fullText) : null;
    const textBasis = abstractTrimmed && !fullText ? '초록 기반'
                    : abstractTrimmed && sec       ? `초록 + ${sec.mode}`
                    : sec                          ? sec.mode
                    :                                '초록 기반';

    let textParts = '';
    if (abstractTrimmed) textParts += `【초록】\n${abstractTrimmed}\n\n`;
    if (sec) {
        for (const p of sec.parts) textParts += `【${p.label}】\n${p.text}\n\n`;
    }

    const prompt = `다음 논문을 한국어로 요약해주세요.\n\n제목: ${title}\n\n${textParts}\n아래 형식으로 작성해주세요 (마크다운 없이 텍스트만):\n[연구 목적] (1-2문장)\n[연구 방법] (1-2문장)\n[주요 결과] (2-3문장)\n[시사점] (1문장)`;
    try {
        const result = await callGemini(buildPaperParts(prompt));
        const box = document.getElementById('ai-summary-result');
        if (box) {
            box.innerHTML = `<div class="ai-basis-badge">📄 ${escHtml(textBasis)}</div><div class="ai-summary-text">${escHtml(result)}</div>`;
            box.style.display = 'block';
        }
        const aiBlock = document.getElementById('ai-block');
        if (aiBlock) aiBlock.open = true;

        // 요약 결과와 원문 텍스트를 즉시 자동 저장 (저장 버튼 안 눌러도 유지)
        if (state.editingId) {
            const existing = state.papers.find(p => p.id === state.editingId);
            if (existing) {
                const curFullText = (document.getElementById('f-fulltext')?.value || '').trim() || existing.fullText || '';
                const updated = { ...existing, fullText: curFullText, aiSummary: result, aiSummaryBasis: textBasis, updatedAt: Date.now() };
                await dbPut(STORE_PAPERS, updated);
                const idx = state.papers.findIndex(p => p.id === state.editingId);
                if (idx >= 0) state.papers[idx] = updated;
                pushDebug('info', 'aiSummarize 자동저장 완료');
            }
        }
        showToast('AI 요약 완료 (자동 저장됨)', 'success');
        pushDebug('info', 'aiSummarize 완료');
    } catch(e) {
        const msg = e.message || '';
        const isTooLarge = msg.includes('too large') || msg.includes('Request too large') || msg.toLowerCase().includes('reduce');
        const isRate = msg.includes('429') || msg.toLowerCase().includes('rate') || msg.includes('quota');
        showToast(isTooLarge
            ? '논문이 너무 길어요 — 서론·결론 섹션 제목(예: "서론", "결론", "논의")이 있는지 확인해 주세요. 섹션이 감지되면 핵심 부분만 추출해 요약할 수 있어요.'
            : isRate
            ? `요청이 너무 많아요 — ${parseRateWait(msg) || '잠시 후'} 다시 시도해 주세요.`
            : 'AI 요약 실패: ' + msg, 'error');
        pushDebug('error', 'aiSummarizePaper: ' + msg);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = origText; }
    }
}

// ── AI 전체 분석 (요약 + 정밀 분석 칸 자동 채우기) ────────────
async function aiAnalyzePaper() {
    const paper   = state.editingId ? state.papers.find(p => p.id === state.editingId) : null;
    const title   = document.getElementById('f-title')?.value?.trim() || '';
    const abstract = document.getElementById('f-abstract')?.value?.trim() || paper?.abstract || '';
    const fullText = document.getElementById('f-fulltext')?.value?.trim() || paper?.fullText || '';
    if (!fullText && !abstract) {
        showToast('원문 텍스트 또는 초록이 필요해요. 먼저 PDF를 첨부하거나 원문을 입력해 주세요.', 'warn'); return;
    }
    const btn = document.getElementById('btn-ai-summarize-quick');
    if (btn) { btn.disabled = true; btn.textContent = '분석 중…'; }

    // 섹션 자동 감지로 서론·결론·방법·결과 부분 추출 (150페이지도 대응)
    const extracted = fullText ? extractPaperSections(fullText) : null;
    const bodyText = extracted
        ? extracted.parts.map(p => `[${p.label}]\n${p.text}`).join('\n\n')
        : (abstract || '').slice(0, 8000);
    const sectionNote = extracted ? `(${extracted.mode})` : '';
    const titleLine = title ? `제목: ${title}` : '';
    const titleInstruction = title ? '' : '※ 제목이 제공되지 않았습니다. 본문 첫 부분에서 논문 제목을 직접 찾아 title 필드에 넣어주세요.\n';
    const prompt = `다음 논문을 읽고 아래 항목들을 JSON 형식으로만 응답해주세요. 해당 내용이 없으면 빈 문자열("")로 두세요. JSON 외 다른 텍스트는 쓰지 마세요.
${titleInstruction}
${titleLine}${abstract ? `초록: ${abstract.slice(0,500)}\n` : ''}본문 ${sectionNote}:
${bodyText}

응답 형식 (JSON만):
{
  "title": "논문 제목 (원문 그대로)",
  "authors": "저자명 (쉼표로 구분)",
  "year": "출판연도 (4자리 숫자, 없으면 빈 문자열)",
  "source": "학술지명 또는 출처 (없으면 빈 문자열)",
  "abstract": "논문 초록 (없으면 빈 문자열)",
  "summary": "[연구 목적] ...\n[연구 방법] ...\n[주요 결과] ...\n[시사점] ...",
  "keywords": "키워드1, 키워드2, 키워드3 (논문의 키워드 또는 주요어 그대로, 없으면 빈 문자열)",
  "needs": "연구의 필요성·배경 (2-3문장)",
  "priorlimits": "선행연구의 한계점 (1-2문장, 없으면 빈 문자열)",
  "theory": "사용한 주요 이론·개념 (저자, 연도 포함, 없으면 빈 문자열)",
  "mainstudies": "핵심 인용 선행연구 (1-2문장, 없으면 빈 문자열)",
  "subjects": "연구대상자 (예: 대학생 300명)",
  "model": "연구모형 (예: 매개모형, 없으면 빈 문자열)",
  "method": "분석 방법 (예: 구조방정식, Bootstrapping)",
  "results": "주요 연구결과 (3-4문장)",
  "limitations": "연구의 한계점 (1-2문장, 없으면 빈 문자열)",
  "implications": "시사점·제언 (2-3문장)",
  "독립변인": ["변인명1"],
  "종속변인": ["변인명1"],
  "매개변인": [],
  "조절변인": []
}`;

    try {
        const raw = await callGemini(buildPaperParts(prompt));
        // JSON 파싱 (응답에 ```json ... ``` 감싸인 경우도 처리)
        const jsonStr = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        let parsed;
        try { parsed = JSON.parse(jsonStr); }
        catch { throw new Error('AI 응답을 파싱하지 못했어요. 다시 시도해 주세요.\n' + raw.slice(0, 200)); }

        // 기본 항목 채우기 (빈 칸만)
        const setIfEmpty = (id, val) => {
            if (!val) return;
            const el = document.getElementById(id);
            if (el && !el.value.trim()) el.value = val;
        };
        setIfEmpty('f-title',   parsed.title);
        setIfEmpty('f-authors', parsed.authors);
        setIfEmpty('f-year',    parsed.year);
        setIfEmpty('f-source',  parsed.source);
        setIfEmpty('f-abstract', parsed.abstract);

        // AI 요약 박스 채우기
        if (parsed.summary) {
            const box = document.getElementById('ai-summary-result');
            if (box) {
                box.innerHTML = `<div class="ai-basis-badge">📄 AI 전체 분석</div><div class="ai-summary-text">${escHtml(parsed.summary)}</div>`;
                box.style.display = 'block';
            }
            const caution = document.getElementById('ai-caution-msg');
            if (caution) caution.style.display = '';
        }

        // 정밀 분석 칸 채우기 (무조건 덮어쓰기)
        const fieldMap = {
            keywords: 'a-keywords',
            needs: 'a-needs',
            priorlimits: 'a-priorlimits',
            theory: 'a-theory',
            mainstudies: 'a-mainstudies',
            subjects: 'a-subjects',
            model: 'a-model',
            method: 'a-method',
            results: 'a-results',
            limitations: 'a-limitations',
            implications: 'a-implications'
        };
        let filled = 0;
        for (const [key, elId] of Object.entries(fieldMap)) {
            if (!parsed[key]) continue;
            const el = document.getElementById(elId);
            if (!el) continue;
            el.value = parsed[key];
            filled++;
        }

        // 변인 자동 추출
        const varRoleMap = { '독립변인':'independent', '종속변인':'dependent', '매개변인':'mediator', '조절변인':'moderator' };
        let addedVars = 0;
        for (const [roleName] of Object.entries(varRoleMap)) {
            for (const raw of (parsed[roleName] || [])) {
                const name = typeof raw === 'string' ? raw.trim() : (raw?.name || String(raw));
                if (name && !formVariables.includes(name)) { formVariables.push(name); addedVars++; }
            }
        }
        if (addedVars > 0) renderChips('variables-list', formVariables, 'variable');

        // 정밀 분석 섹션 펼치기
        const block = document.getElementById('analysis-block');
        if (block) block.open = true;

        // 자동 저장
        if (state.editingId) {
            const existing = state.papers.find(p => p.id === state.editingId);
            if (existing) {
                const updates = { aiSummary: parsed.summary || existing.aiSummary, aiSummaryBasis: 'AI 전체 분석' };
                for (const [key, elId] of Object.entries(fieldMap)) {
                    const storeKey = ANALYSIS_TEXT_FIELDS[elId];
                    if (storeKey) updates[storeKey] = document.getElementById(elId)?.value || '';
                }
                await dbPut(STORE_PAPERS, { ...existing, ...updates, updatedAt: Date.now() });
                const idx = state.papers.findIndex(p => p.id === state.editingId);
                if (idx >= 0) state.papers[idx] = { ...state.papers[idx], ...updates };
            }
        }

        // AI 완료 후 PDF+원문 블록 자동 접기
        const ftBlockAi = document.getElementById('fulltext-block');
        if (ftBlockAi) ftBlockAi.open = false;

        showToast(`AI 분석 완료! 요약 + ${filled}개 항목, 변인 ${addedVars}개를 채웠어요.`, 'success');
        // Groq 무료 플랜 사용량 안내 (분당 12,000 토큰 한도)
        setTimeout(() => showToast('💡 Groq 무료 플랜은 분당 12,000 토큰 한도예요. 연속 사용 시 1분 대기 후 다시 시도하세요.', 'info'), 2000);
        pushDebug('info', `AI 전체분석 완료 — ${filled}개 항목`);
    } catch(e) {
        const msg = e.message || '';
        const isRate = msg.includes('429') || msg.toLowerCase().includes('rate');
        showToast(isRate ? `요청이 너무 많아요 — ${parseRateWait(msg) || '잠시 후'} 다시 시도해 주세요.` : 'AI 자동 채우기 실패: ' + msg, 'error');
        pushDebug('error', 'aiAnalyzePaper: ' + msg);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-1px;margin-right:4px"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>AI 분석'; }
    }
}

async function aiExtractPaper() {
    const paper    = state.editingId ? state.papers.find(p => p.id === state.editingId) : null;
    const title    = document.getElementById('f-title')?.value?.trim() || paper?.title || '';
    const abstract = document.getElementById('f-abstract')?.value?.trim() || paper?.abstract || '';
    const fullText = document.getElementById('f-fulltext')?.value?.trim() || paper?.fullText || '';
    pushDebug('info', `aiExtract 시작 — 제목:${title.slice(0,20)} 초록길이:${abstract.length} 원문길이:${fullText.length}`);
    if (!abstract && !fullText) {
        showToast('초록 또는 원문 텍스트가 있어야 자동추출이 가능합니다.', 'warn'); return;
    }
    const btn = document.getElementById('btn-ai-extract');
    const origText = btn?.textContent || '';
    if (btn) { btn.disabled = true; btn.textContent = '추출 중…'; }

    const prompt = `다음 논문에서 변인과 연구 방법을 추출해주세요.\n제목: ${title}\n${abstract ? '초록: ' + abstract + '\n' : ''}${fullText ? '본문(일부): ' + fullText.slice(0, 1200) : ''}\n`
        + `\n반드시 아래 JSON 형식으로만 답하세요 (다른 설명 없이):
{
  "독립변인": ["변인명1"],
  "종속변인": ["변인명1"],
  "매개변인": [],
  "조절변인": [],
  "연구대상": "예: 대학생 300명",
  "분석방법": "예: 구조방정식모형(SEM)",
  "연구모형": "예: 매개모형"
}`;
    try {
        const raw = await callGemini(buildPaperParts(prompt));
        pushDebug('info', 'aiExtract 원본응답: ' + raw.slice(0, 500));
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('AI가 잘못된 형식으로 응답했습니다.');
        const data = JSON.parse(jsonMatch[0]);
        pushDebug('info', 'aiExtract 파싱결과: ' + JSON.stringify(data).slice(0, 300));
        const setEl = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
        setEl('a-subjects', data['연구대상']);
        setEl('a-method',   data['분석방법']);
        setEl('a-model',    data['연구모형']);
        const varRoleMap = { '독립변인':'independent', '종속변인':'dependent', '매개변인':'mediator', '조절변인':'moderator' };
        let added = 0;
        for (const [roleName, roleKey] of Object.entries(varRoleMap)) {
            for (const raw of (data[roleName] || [])) {
                const name = typeof raw === 'string' ? raw.trim() : (raw?.name || raw?.변인명 || String(raw));
                if (!name) continue;
                if (!formVariables.includes(name)) {
                    formVariables.push(name);
                    added++;
                }
            }
        }
        renderChips('variables-list', formVariables, 'variable');
        const analysisBlock = document.getElementById('analysis-block');
        if (analysisBlock) analysisBlock.open = true;
        showToast(`자동추출 완료! 변인 ${added}개 추가됨.`, 'success');
    } catch(e) {
        showToast('자동추출 실패: ' + e.message, 'error');
        pushDebug('error', 'aiExtractPaper: ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = origText; }
    }
}

// ── 논문 추가 통합 모달 ─────────────────────────────────────
let addChoicePdfFile = null;
let addChoiceFolderFile = null;   // 폴더 연결로 고른 PDF 파일 이름
let addChoiceAiData  = null;   // AI 분석으로 추출된 부가정보(초록·변인 등) 저장

function openAddChoice() {
    addChoicePdfFile = null;
    addChoiceFolderFile = null;
    addChoiceAiData  = null;
    document.getElementById('modal-add-choice').style.display = 'flex';
    setTimeout(() => document.getElementById('add-title')?.focus(), 80);
}

function closeAddChoice() {
    document.getElementById('modal-add-choice').style.display = 'none';
    addChoicePdfFile = null;
    addChoiceFolderFile = null;
    addChoiceAiData  = null;
    ['add-title','add-authors','add-year','add-link-url'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
    });
    const nameEl = document.getElementById('add-pdf-filename');
    if (nameEl) { nameEl.textContent = ''; nameEl.style.display = 'none'; }
    const fileEl = document.getElementById('add-pdf-file');
    if (fileEl) fileEl.value = '';
    const textEl = document.getElementById('add-text-input');
    if (textEl) textEl.innerHTML = '';
}

// 중복 논문 검사 — 같은 제목+저자 또는 같은 DOI가 있으면 해당 논문 반환
function findDuplicatePaper(title, authors, doi) {
    const t = (title || '').trim().toLowerCase();
    const a = (authors || '').trim().toLowerCase();
    const d = (doi || '').trim().toLowerCase();
    return state.papers.find(p => {
        if (d && p.doi && d === p.doi.trim().toLowerCase()) return true;
        if (!t) return false;
        return t === p.title.trim().toLowerCase() && a === (p.authors || '').trim().toLowerCase();
    });
}

// 통합 저장 — PDF·링크·텍스트 중 하나 이상 + 제목 필수
async function addChoiceSave() {
    const title   = (document.getElementById('add-title').value || '').trim()
                    || (addChoiceFolderFile ? addChoiceFolderFile.replace(/\.pdf$/i, '')
                        : addChoicePdfFile ? addChoicePdfFile.name.replace(/\.pdf$/i, '') : '');
    const authors = (document.getElementById('add-authors').value || '').trim();
    const year    = (document.getElementById('add-year').value || '').trim();
    const url     = (document.getElementById('add-link-url').value || '').trim();
    const textEl  = document.getElementById('add-text-input');
    const text    = (textEl?.innerText || '').trim();

    if (!title) { showToast('제목을 입력해주세요.', 'warn'); document.getElementById('add-title')?.focus(); return; }
    if (!addChoicePdfFile && !addChoiceFolderFile && !url && !text) {
        showToast('PDF, 링크, 텍스트 중 하나 이상을 입력해주세요.', 'warn'); return;
    }
    const dup = findDuplicatePaper(title, authors, '');
    if (dup && !window.confirm(`⚠️ 같은 제목의 논문이 이미 있습니다.\n\n"${dup.title}"\n\n그래도 추가할까요?`)) return;

    const btn = document.getElementById('btn-add-save');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중…'; }
    try {
        let pdfData = null, pdfFilename = '';
        const pdfFolderFile = addChoiceFolderFile || null;   // 폴더 연결(복사 없음)
        if (!pdfFolderFile && addChoicePdfFile) {
            pdfData = await readFile(addChoicePdfFile);
            pdfFilename = addChoicePdfFile.name;
            pushDebug('info', `addChoiceSave PDF 복사 — 파일명:${pdfFilename} 크기:${pdfData?.byteLength ?? 0}bytes`);
        }
        if (pdfFolderFile) pushDebug('info', `addChoiceSave 폴더 연결 — ${pdfFolderFile}`);
        pushDebug('info', `addChoiceSave 저장 시작 — 제목:${title} PDF있음:${!!pdfData} 텍스트길이:${text.length}`);
        const ai = addChoiceAiData || {};
        const paper = {
            id: genId(), projectId: state.currentProjectId,
            title, authors, year,
            source:   ai.source   || '',
            abstract: ai.abstract || '',
            findings: ai.summary  || '',
            methods:  ai.연구방법 || '',
            myNote: '', doi: '', pdfLink: url || null,
            volume: '', issue: '', pages: '',
            variables: ai.variables || [], tags: [], analysis: {},
            readStatus: 'unread',
            fullText: text, fullTextHtml: '', attachedImages: [],
            pdfData, pdfFilename, pdfFolderFile,
            addedAt: Date.now(), updatedAt: Date.now(),
        };
        await dbPut(STORE_PAPERS, paper);
        await loadData();
        renderContent();
        closeAddChoice();
        showToast('논문이 추가되었습니다!', 'success');
        openForm(paper.id, 'view');
    } catch(e) {
        showToast('저장 실패: ' + e.message, 'error');
        pushDebug('error', 'addChoiceSave: ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = '저장'; }
    }
}

// AI 분석 — 폼 필드 자동 채우기 (저장은 하지 않음)
async function aiAnalyzeForAddForm() {
    const textEl = document.getElementById('add-text-input');
    const text   = (textEl?.innerText || '').trim();
    if (!text) { showToast('텍스트를 먼저 붙여넣으세요.', 'warn'); return; }
    const btn = document.getElementById('btn-add-text-analyze');
    const origLabel = btn?.textContent || '';
    if (btn) { btn.disabled = true; btn.textContent = 'AI 분석 중…'; }
    const prompt = `다음 논문 텍스트에서 정보를 추출하세요. 없는 항목은 빈 값으로 두세요.

[텍스트]
${text.slice(0, 1500)}

반드시 아래 JSON 형식으로만 답하세요 (설명 없이):
{
  "title": "논문 제목",
  "authors": "저자명1, 저자명2",
  "year": "2024",
  "source": "학술지명 또는 대학명",
  "abstract": "초록 원문",
  "summary": "연구 목적·방법·주요결과 요약 3-5문장",
  "연구방법": "연구방법 한 줄",
  "독립변인": ["변인명"],
  "종속변인": ["변인명"],
  "매개변인": [],
  "조절변인": []
}`;
    try {
        const raw = await callGemini([{ text: prompt }]);
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('AI가 잘못된 형식으로 응답했습니다.');
        const data = JSON.parse(jsonMatch[0]);
        // 변인 추출
        const variables = [];
        for (const key of ['독립변인','종속변인','매개변인','조절변인']) {
            for (const v of (data[key] || [])) {
                const name = typeof v === 'string' ? v.trim() : String(v);
                if (name && !variables.includes(name)) variables.push(name);
            }
        }
        addChoiceAiData = { ...data, variables };
        // 폼 필드 채우기 (이미 입력된 값은 덮어쓰지 않음)
        const setIfEmpty = (id, val) => { const el = document.getElementById(id); if (el && !el.value.trim() && val) el.value = val; };
        setIfEmpty('add-title',   data.title);
        setIfEmpty('add-authors', data.authors);
        setIfEmpty('add-year',    data.year);
        showToast('AI 분석 완료! 제목·저자를 확인한 뒤 저장하세요.', 'success');
        pushDebug('info', 'aiAnalyzeForAddForm 완료');
    } catch(e) {
        showToast('AI 분석 실패: ' + e.message, 'error');
        pushDebug('error', 'aiAnalyzeForAddForm: ' + e.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = origLabel; }
    }
}

// 패턴 기반 서식 — 내용 손상 없이 HTML 문자열 반환
function buildPatternHtml(text) {
    const lines = text.split(/\r?\n/);
    const out = [];
    let i = 0;

    while (i < lines.length) {
        const raw = lines[i];
        const line = raw.trim();
        if (!line) { i++; continue; }

        // 표: 탭 구분 행이 2줄 이상 연속
        if (/\t/.test(raw)) {
            const tableLines = [];
            while (i < lines.length && (/\t/.test(lines[i]) || !lines[i].trim())) {
                if (lines[i].trim()) tableLines.push(lines[i]);
                i++;
            }
            if (tableLines.length >= 2) {
                out.push('<table>');
                tableLines.forEach((tl, ti) => {
                    const cells = tl.split('\t').map(c => c.trim()).filter(c => c !== '');
                    const tag = ti === 0 ? 'th' : 'td';
                    out.push('<tr>' + cells.map(c => `<${tag}>${escHtml(c)}</${tag}>`).join('') + '</tr>');
                });
                out.push('</table>');
            } else {
                tableLines.forEach(tl => out.push(`<p>${escHtml(tl.trim())}</p>`));
            }
            continue;
        }

        // 글머리 목록
        if (/^[-•·○◦]\s+/.test(line)) {
            const items = [];
            while (i < lines.length && /^[-•·○◦]\s+/.test(lines[i].trim())) {
                items.push(lines[i].trim().replace(/^[-•·○◦]\s+/, ''));
                i++;
            }
            out.push('<ul>' + items.map(s => `<li>${escHtml(s)}</li>`).join('') + '</ul>');
            continue;
        }

        // 번호 항목: 짧으면 소제목, 길면 번호 목록
        if (/^\d+[.)]\s+\S/.test(line)) {
            if (line.length <= 55) {
                out.push(`<h3>${escHtml(line)}</h3>`);
                i++;
            } else {
                const items = [];
                while (i < lines.length && /^\d+[.)]\s+\S/.test(lines[i].trim())) {
                    items.push(lines[i].trim().replace(/^\d+[.)]\s+/, ''));
                    i++;
                }
                out.push('<ol>' + items.map(s => `<li>${escHtml(s)}</li>`).join('') + '</ol>');
            }
            continue;
        }

        // 한글 번호 항목 (가. 나. 다. / (1) (2) 등) → 소제목
        if (/^([가나다라마바사아자차카타파하][.)] |\([가나다]\) |\(\d+\) )/.test(line) && line.length <= 60) {
            out.push(`<h3>${escHtml(line)}</h3>`);
            i++;
            continue;
        }

        // 제목 패턴
        const isKorChapter = /^(제?\s*\d+\s*[장절편]\s*[\.\s]|[Ⅰ-Ⅹ]+[\.\s])/.test(line);
        const isShortHeading = line.length <= 50 && !/[.,:;?)】』\]"]$/.test(line) && line.split(/\s+/).length <= 7;
        const isCircledNum = /^[①-⑳]/.test(line);

        if (isKorChapter) {
            out.push(`<h2>${escHtml(line)}</h2>`);
        } else if (isCircledNum || (isShortHeading && line.length >= 3)) {
            out.push(`<h3>${escHtml(line)}</h3>`);
        } else {
            out.push(`<p>${escHtml(line)}</p>`);
        }
        i++;
    }
    return out.join('');
}

// 패턴 서식을 contenteditable에 적용 (미리보기용)
function patternFormatTextAdd(el, text) {
    el.innerHTML = buildPatternHtml(text);
    showToast('서식 정리 완료. 원본은 ↩ 원본 클릭.', 'success');
}

// 원본 되돌리기
function restoreTextAddOriginal() {
    if (!textAddOriginal) { showToast('저장된 원본이 없습니다.', 'warn'); return; }
    const el = document.getElementById('text-add-input');
    if (el) el.innerHTML = textAddOriginal;
    showToast('원본으로 복원했습니다.', 'info');
}


// ── 앱 시작 ────────────────────────────────────────────────
// 사이드바 접기 상태는 localStorage('sidebarCollapsed')에 보관(앱 전체, 프로젝트 무관)
function initSidebarToggle() {
    const btn = document.getElementById('sidebar-toggle');
    const sidebar = document.querySelector('.sidebar');
    if (!btn || !sidebar) return;
    if (localStorage.getItem('sidebarCollapsed') === '1') sidebar.classList.add('collapsed');
    btn.onclick = () => {
        const collapsed = sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
        // 사이드바 폭이 바뀌면 모형스케치북 캔버스 크기도 다시 맞춤(전환 애니메이션 후)
        if (typeof resizeBg === 'function') setTimeout(resizeBg, 220);
    };
}

// ── 3단계 온보딩 wizard ────────────────────────────────────
const _wi = (path, size=18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const WIZARD_LOGO = `<svg viewBox="0 0 72 72" width="56" height="56" fill="none"><rect width="72" height="72" rx="18" fill="#EFF6FF"/><rect x="14" y="14" width="34" height="44" rx="4" fill="#fff" stroke="#3B82F6" stroke-width="2"/><line x1="21" y1="25" x2="41" y2="25" stroke="#BFDBFE" stroke-width="2" stroke-linecap="round"/><line x1="21" y1="32" x2="41" y2="32" stroke="#BFDBFE" stroke-width="2" stroke-linecap="round"/><line x1="21" y1="39" x2="34" y2="39" stroke="#BFDBFE" stroke-width="2" stroke-linecap="round"/><path d="M38 46 L53 31 a3 3 0 0 1 4.2 4.2 L42 50 L37 51 Z" fill="#3B82F6" stroke="#3B82F6" stroke-width="1" stroke-linejoin="round"/><path d="M50 33 L54 37" stroke="#93C5FD" stroke-width="1.5"/></svg>`;

function _wizardStepBar(current) {
    return `<div class="wizard-step-bar">
        ${[1,2,3].map(n => `
            <div class="wizard-step-item ${n < current ? 'done' : n === current ? 'active' : ''}">
                <div class="wizard-step-circle">${n < current ? _wi('<path d="M20 6 9 17l-5-5"/>',12) : n}</div>
                <span>${['로그인','백업 폴더','AI 설정'][n-1]}</span>
            </div>
            ${n < 3 ? '<div class="wizard-step-line ' + (n < current ? 'done' : '') + '"></div>' : ''}
        `).join('')}
    </div>`;
}

function showWizard(startStep) {
    let overlay = document.getElementById('onboarding-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'onboarding-overlay';
        document.body.appendChild(overlay);
    }
    _renderWizardStep(overlay, startStep);
}

function _renderWizardStep(overlay, step) {
    overlay.dataset.wizardStep = step;
    let bodyHtml = '';
    let footerHtml = '';

    if (step === 1) {
        bodyHtml = `
            <div class="wizard-header">
                <div class="onboarding-logo">${WIZARD_LOGO}</div>
                <h2>내 연구노트에 오신 것을 환영해요!</h2>
                <p class="onboarding-sub">논문 관리 · AI 요약 · 마인드맵을 한 곳에서</p>
            </div>
            <div class="onboarding-body">
                <div class="onboarding-section">
                    <h3>${_wi('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>')} 내 연구노트란?</h3>
                    <p>논문을 PDF째 붙여넣고 서지정보·메모·AI요약을 한 곳에서 관리해요. 마인드맵으로 변인 구조도 그릴 수 있어요.</p>
                </div>
                <div class="onboarding-section">
                    <h3>${_wi('<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>')} 로그인하면 뭐가 좋아요?</h3>
                    <p>로그인하면 서지정보·메모가 클라우드에 자동 저장돼서 다른 기기에서도 바로 볼 수 있어요. 로그인 없이도 이 기기에서 모든 기능을 쓸 수 있어요.</p>
                </div>
            </div>`;
        footerHtml = `
            <button id="wz-login" class="btn-primary">${_wi('<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',16)} 로그인 / 회원가입</button>
            <button id="wz-skip1" class="btn-secondary">로그인 없이 시작할게요</button>`;
    } else if (step === 2) {
        bodyHtml = `
            <div class="wizard-header">
                <h2>백업 폴더를 지정해 주세요</h2>
                <p class="onboarding-sub">논문을 저장할 때마다 PDF 포함 자동으로 백업돼요</p>
            </div>
            <div class="onboarding-body">
                <div class="onboarding-section">
                    <h3>${_wi('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>')} 어느 폴더든 지정할 수 있어요</h3>
                    <div class="onboarding-tip">
                        <strong>${_wi('<path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>',15)} 폴더 선택 가이드</strong>
                        <ul>
                            <li><b>내 PC 폴더</b> — 이 컴퓨터에서만 쓸 때 가장 간단해요</li>
                            <li><b>구글 드라이브 폴더</b> — 여러 기기에서 PDF까지 복원 가능 (추천)</li>
                            <li>원드라이브·드롭박스도 구글 드라이브와 동일하게 사용 가능해요</li>
                        </ul>
                    </div>
                </div>
            </div>`;
        footerHtml = `
            <button id="wz-folder" class="btn-primary">${_wi('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',16)} 폴더 지정하기</button>
            <button id="wz-skip2" class="btn-secondary">나중에 할게요</button>`;
    } else if (step === 3) {
        const hasKey = !!localStorage.getItem(GEMINI_LS_KEY);
        bodyHtml = `
            <div class="wizard-header">
                <h2>AI 요약 설정</h2>
                <p class="onboarding-sub">Groq API 키를 입력하면 논문 AI 요약 기능을 쓸 수 있어요</p>
            </div>
            <div class="onboarding-body">
                <div class="onboarding-section">
                    <h3>${_wi('<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>')} Groq API 키 입력</h3>
                    <div class="onboarding-tip">
                        <strong>🔑 API 키 발급 방법 (무료)</strong>
                        <ul>
                            <li><a href="https://console.groq.com" target="_blank" rel="noopener" style="color:var(--accent)">console.groq.com</a> 접속 → 구글 계정으로 가입</li>
                            <li>왼쪽 메뉴 <b>API Keys</b> → <b>Create API Key</b> 클릭</li>
                            <li>생성된 키(gsk_로 시작)를 복사해서 아래에 붙여넣기</li>
                        </ul>
                    </div>
                    <input id="wz-api-key" type="password" placeholder="gsk_..." value="${escHtml(localStorage.getItem(GEMINI_LS_KEY)||'')}"
                        style="width:100%;margin-top:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px;font-family:inherit;background:var(--bg);color:var(--text);box-sizing:border-box;"/>
                    ${hasKey ? '<p style="font-size:12px;color:#16a34a;margin-top:6px">✓ API 키가 저장되어 있어요</p>' : ''}
                </div>
            </div>`;
        footerHtml = `
            <button id="wz-save-ai" class="btn-primary">${_wi('<path d="M20 6 9 17l-5-5"/>',16)} 저장하고 시작하기</button>
            <button id="wz-skip3" class="btn-secondary">나중에 할게요</button>`;
    }

    overlay.innerHTML = `
        <div class="onboarding-modal">
            ${_wizardStepBar(step)}
            ${bodyHtml}
            <div class="onboarding-footer">${footerHtml}</div>
        </div>`;

    // 버튼 이벤트
    if (step === 1) {
        overlay.querySelector('#wz-login').onclick = () => {
            if (typeof openAuthModal === 'function') openAuthModal();
        };
        overlay.querySelector('#wz-skip1').onclick = () => _renderWizardStep(overlay, 2);
    } else if (step === 2) {
        overlay.querySelector('#wz-folder').onclick = async () => {
            await folderBackup();
            // folderBackup 성공 시 advanceWizardOnFolder()가 호출됨
        };
        overlay.querySelector('#wz-skip2').onclick = () => _renderWizardStep(overlay, 3);
    } else if (step === 3) {
        overlay.querySelector('#wz-save-ai').onclick = () => {
            const key = (overlay.querySelector('#wz-api-key')?.value || '').trim();
            if (key) { localStorage.setItem(GEMINI_LS_KEY, key); showToast('API 키 저장 완료!', 'success'); }
            overlay.remove();
        };
        overlay.querySelector('#wz-skip3').onclick = () => {
            overlay.remove();
        };
    }
}

// 로그인 완료 시 auth.js에서 호출
function advanceWizardOnLogin() {
    const overlay = document.getElementById('onboarding-overlay');
    if (overlay && overlay.dataset.wizardStep === '1') _renderWizardStep(overlay, 2);
}

// 폴더 지정 완료 시 folderBackup()에서 호출
function advanceWizardOnFolder() {
    localStorage.setItem('onboardingComplete', '1'); // 폴더 지정 = 온보딩 핵심 완료
    const overlay = document.getElementById('onboarding-overlay');
    if (overlay && overlay.dataset.wizardStep === '2') _renderWizardStep(overlay, 3);
}

function showOnboarding() {
    // 로그인 상태면 2단계부터, 아니면 1단계부터
    const isLoggedIn = typeof currentUser !== 'undefined' && !!currentUser;
    const startStep = isLoggedIn ? 2 : 1;
    showWizard(startStep);
}

async function init() {
    await initDB();
    await requestPersistentStorage();
    await loadBackupHandle();
    await loadPaperDirHandle();   // 논문 PDF 폴더(복사 없이 읽기)

    await initProjects();
    await loadData();
    bindEvents();
    renderProjectSelector();
    renderContent();
    // 백업 폴더 미설정이면 항상 wizard 표시
    if (!backupDirHandle) {
        setTimeout(showOnboarding, 600);
    }
}

init().catch(err => {
    document.getElementById('content').innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">${icon('alert', 44)}</div>
            <h3>앱을 시작하지 못했습니다</h3>
            <p>${escHtml(err.message)}</p>
        </div>`;
});
