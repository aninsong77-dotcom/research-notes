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
const DB_VERSION = 7;
const STORE_PAPERS = 'papers';
const STORE_PROJECTS = 'projects';
const STORE_MINDMAPS = 'mindmaps';
const STORE_MATERIALS = 'materials';
const STORE_SETTINGS = 'settings';   // 앱 설정(백업 폴더 핸들 등) 보관
const STORE_NOTES = 'notes';         // 아이디어 저장소(메모)
const STORE_PROPOSALS = 'proposals'; // 모형스케치북 미니 프로포절(프로젝트별, key=projectId)

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
    'cloud':      '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
    'cloud-off':  '<path d="m2 2 20 20"/><path d="M5.78 5.78A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.3-.19"/><path d="M21.53 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7 7 0 0 0 10 5.07"/>',
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
    state.proposal = await loadProposal(state.currentProjectId);
    document.getElementById('papers-count').textContent = state.papers.length;
    document.getElementById('materials-count').textContent = state.materials.length;
    document.getElementById('notes-count').textContent = state.notes.length;
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
    const current = state.projects.find(p => p.id === state.currentProjectId);

    container.innerHTML = `
        <div class="project-wrap">
            <button class="project-btn" id="project-btn">
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
            container.style.padding  = '24px';
            container.style.overflow = 'auto';
        }
        S = null; // 마인드맵 상태 초기화
    }

    if (q) {
        if (state.view === 'materials') renderMaterialSearch(q, container);
        else if (state.view === 'notes') renderNotes(container, q);
        else renderSearchResults(q, container);
        return;
    }
    if (state.view === 'home') renderHome(container);
    else if (state.view === 'desk') renderDesk(container);
    else if (state.view === 'catview') renderCatView(container);
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
    const body = flat
        ? `<div class="paper-list">${paperRowsHTML(sortPapers(state.papers), true)}</div>`
        : groupedPapersHTML();

    const dragHint = flat
        ? `<span class="og-summary">⠿ 손잡이를 끌어 순서를 바꿀 수 있어요</span>` : '';

    container.innerHTML = `
        <div class="paper-header pc-row-inline">
            <span class="section-title">논문 ${state.papers.length}편</span>
            ${controls}
            ${dragHint}
        </div>
        ${body}`;

    bindPaperControls(container);
    bindRows(container, flat);
}

// 묶기 기준이 선택됐을 때: 기준값별 접이식 그룹
function groupedPapersHTML() {
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
            <div class="paper-list">${paperRowsHTML(sortPapers(g.papers))}</div>
        </details>`).join('');

    const noValueHTML = noValue.length ? `
        <details class="og-group og-group-none">
            <summary>
                <span class="og-group-name">${escHtml(dimLabel)} 미입력</span>
                <span class="og-group-count">${noValue.length}편</span>
            </summary>
            <div class="paper-list">${paperRowsHTML(sortPapers(noValue))}</div>
        </details>` : '';

    return (groupHTML || `<p class="og-empty-dim">아직 ${escHtml(dimLabel)} 정보가 입력된 논문이 없습니다.</p>`) + noValueHTML;
}

// 한 줄 행 목록 (draggable=true면 끌어다 놓기 손잡이 표시)
function paperRowsHTML(arr, draggable = false) {
    return arr.map(p => paperRowHTML(p, draggable)).join('');
}

function paperRowHTML(paper, draggable = false) {
    const open = state.expandedId === paper.id;
    const meta = [paper.year, firstAuthor(paper)].filter(Boolean).map(escHtml).join(' · ');
    return `
        <div class="paper-row-wrap ${open ? 'open' : ''}" data-id="${paper.id}">
            <div class="paper-row" data-id="${paper.id}" ${draggable ? 'draggable="true"' : ''}>
                ${draggable ? '<span class="pr-grip" title="끌어서 순서 바꾸기">⠿</span>' : ''}
                <span class="pr-caret">▸</span>
                <span class="pr-title">${escHtml(paper.title || '제목 없음')}</span>
                <span class="pr-meta">${meta}</span>
                ${paper.pdfData ? `<span class="pr-icon" title="PDF 있음">${icon('paperclip', 14)}</span>` : ''}
                ${paper.inQuickCite ? `<span class="pr-icon" title="빠른 인용">${icon('zap', 14)}</span>` : ''}
            </div>
            ${open ? paperRowDetailHTML(paper) : ''}
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
        // 간단 변인 태그(paper.variables) + 정밀분석 변수명 둘 다 모아서(중복 제거)
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
                <button type="button" class="btn-primary prd-desk" data-id="${paper.id}">${icon('book-open')} 책상에서 펼치기</button>
                <button type="button" class="btn-secondary prd-view" data-id="${paper.id}">${icon('eye')} 보기</button>
                ${paper.pdfData ? `<button type="button" class="btn-secondary prd-pdf" data-id="${paper.id}">${icon('paperclip')} PDF 열기</button>` : ''}
                <button type="button" class="btn-secondary prd-qc" data-id="${paper.id}">${icon('zap')} ${paper.inQuickCite ? '빠른인용 해제' : '빠른인용'}</button>
                <button type="button" class="btn-delete prd-del" data-id="${paper.id}">${icon('trash')} 삭제</button>
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
                    <div class="ref-text">${escHtml(formatAPA(p))}</div>
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
        const text = getSelectedText();
        if (!text) { showToast('선택된 논문이 없습니다. 포함할 논문을 체크하세요.', 'error'); return; }
        const ok = await copyToClipboard(text);
        showToast(ok ? `${selectedCount}편의 참고문헌이 복사됐습니다. 한글/워드에 붙여넣기 하세요.` : '복사 실패', ok ? 'success' : 'error');
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
            const ok = await copyToClipboard(formatAPA(paper));
            showToast(ok ? '복사됐습니다' : '복사 실패', ok ? 'success' : 'error');
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

// ── APA 7판 참고문헌 형식 생성 ─────────────────────────────
function formatAPA(paper) {
    const authors = paper.authors || '저자 미상';
    const year = paper.year ? `(${paper.year})` : '(연도 미상)';
    const title = paper.title || '제목 없음';
    const source = paper.source || '';
    const volume = paper.volume || '';
    const issue = paper.issue ? `(${paper.issue})` : '';
    const pages = paper.pages || '';
    const doi = paper.doi ? `https://doi.org/${paper.doi.replace(/^https?:\/\/doi\.org\//i, '')}` : '';

    let ref = `${authors} ${year}. ${title}.`;

    if (source) {
        ref += ` ${source}`;
        if (volume) ref += `, ${volume}${issue}`;
        if (pages) ref += `, ${pages}`;
        ref += '.';
    }

    if (doi) ref += ` ${doi}`;

    return ref;
}

// ── 본문 인용 형식 생성 ────────────────────────────────────
function formatInText(paper) {
    if (!paper.authors) return paper.year ? `(${paper.year})` : '';

    const firstAuthor = paper.authors.split(/[,·&]/)[0].trim();
    const authorList = paper.authors.split(/[,·]/).map(a => a.trim()).filter(Boolean);
    const year = paper.year || '';

    let name = firstAuthor;
    if (authorList.length === 2) {
        name = `${authorList[0].trim()}, ${authorList[1].trim()}`;
    } else if (authorList.length >= 3) {
        name = `${firstAuthor} 외`;
    }

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
                <div class="home-card-body">${homeListHTML(homeRecent(state.notes, n => (n.title||'').trim() || (n.content||'').trim().slice(0,40)), '아직 메모가 없어요')}</div>
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
function renderCatView(container) {
    const known = new Set(EXCERPT_CATS.map(([k]) => k));
    const catOf = e => (known.has(e.cat) ? e.cat : 'free');
    const cur = (state.catViewCat && known.has(state.catViewCat)) ? state.catViewCat : EXCERPT_CATS[0][0];
    state.catViewCat = cur;

    const rows = sortPapers(state.papers)
        .map(p => ({ p, items: (p.excerpts || []).filter(e => catOf(e) === cur) }))
        .filter(r => r.items.length);
    const total = rows.reduce((n, r) => n + r.items.length, 0);
    const catOptions = EXCERPT_CATS.map(([k, l]) =>
        `<option value="${k}" ${k === cur ? 'selected' : ''}>${l}</option>`).join('');

    const body = rows.length
        ? rows.map(({ p, items }) => `
            <div class="cv-paper">
                <div class="cv-paper-head">
                    <span class="cv-paper-title">${escHtml(p.title || '제목 없음')}</span>
                    <span class="cv-paper-meta">${escHtml([firstAuthor(p), p.year].filter(Boolean).join(', '))}</span>
                    <button type="button" class="cv-open btn-secondary" data-id="${p.id}">${icon('eye', 14)} 보기</button>
                </div>
                <ul class="cv-ex-list">
                    ${items.map(e => `<li>${escHtml(e.text)}${e.memo ? `<span class="cv-ex-memo"> — ${escHtml(e.memo)}</span>` : ''}</li>`).join('')}
                </ul>
            </div>`).join('')
        : `<div class="empty-state"><div class="empty-icon">${icon('clipboard', 44)}</div><h3>이 분류로 담은 발췌가 없어요</h3><p class="muted">연구 책상에서 논문을 읽으며 「${escHtml(CAT_LABEL[cur] || '')}」(으)로 담아보세요.</p></div>`;

    container.innerHTML = `
        <div class="cv-head">
            <span class="cv-title">분류 모아보기</span>
            <select class="cv-cat-select" id="cv-cat">${catOptions}</select>
            <span class="cv-count">${rows.length}편 · ${total}개</span>
        </div>
        <div class="cv-list">${body}</div>`;

    container.querySelector('#cv-cat')?.addEventListener('change', e => {
        state.catViewCat = e.target.value;
        renderCatView(container);
    });
    container.querySelectorAll('.cv-open').forEach(b =>
        b.addEventListener('click', () => openForm(b.dataset.id, 'view')));
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

// ── 아이디어 저장소(메모) ──────────────────────────────────
function noteMatchesQuery(n, q) {
    return [n.title, n.content].some(f => f && String(f).toLowerCase().includes(q));
}

function renderNotes(container, q = '') {
    let notes = [...state.notes].sort(
        (a, b) => (b.updatedAt || b.addedAt || 0) - (a.updatedAt || a.addedAt || 0));
    if (q) notes = notes.filter(n => noteMatchesQuery(n, q));

    const header = `
        <div class="section-header">
            <span class="section-title">아이디어 메모 ${q ? `검색 결과 ${notes.length}개` : `${state.notes.length}개`}</span>
            <button class="btn-secondary" id="btn-add-note">+ 메모 추가</button>
        </div>`;

    if (notes.length === 0) {
        container.innerHTML = header + `
            <div class="empty-state">
                <div class="empty-icon">${icon('lightbulb', 44)}</div>
                <h3>${q ? '검색 결과가 없습니다' : '저장된 메모가 없습니다'}</h3>
                ${q ? '' : '<p>떠오르는 생각·아이디어를<br><strong>+ 메모 추가</strong>로 자유롭게 적어보세요</p>'}
            </div>`;
    } else {
        container.innerHTML = header + `<div class="notes-grid">${notes.map(noteCardHTML).join('')}</div>`;
    }
    bindNotes(container);
}

function noteCardHTML(n) {
    const when = n.updatedAt || n.addedAt;
    const date = when ? new Date(when).toLocaleDateString('ko-KR') : '';
    return `
        <div class="note-card" data-id="${n.id}">
            <input class="note-title" placeholder="제목(선택)" value="${escHtml(n.title || '')}">
            <textarea class="note-body" placeholder="메모를 입력하세요...">${escHtml(n.content || '')}</textarea>
            <div class="note-foot">
                <span class="note-date">${date}</span>
                <button class="note-del" title="메모 삭제">삭제</button>
            </div>
        </div>`;
}

function bindNotes(container) {
    const addBtn = document.getElementById('btn-add-note');
    if (addBtn) addBtn.onclick = addNote;

    container.querySelectorAll('.note-card').forEach(card => {
        const id = card.dataset.id;
        const titleEl = card.querySelector('.note-title');
        const bodyEl = card.querySelector('.note-body');
        let saveTimer;
        const queueSave = () => {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => saveNote(id, titleEl.value, bodyEl.value), 600);
        };
        titleEl.addEventListener('input', queueSave);
        bodyEl.addEventListener('input', queueSave);
        card.querySelector('.note-del').addEventListener('click', () => deleteNote(id));
    });
}

async function addNote() {
    const note = {
        id: genId(), projectId: state.currentProjectId,
        title: '', content: '', addedAt: Date.now(), updatedAt: Date.now(),
    };
    await dbPut(STORE_NOTES, note);
    state.notes.push(note);
    document.getElementById('notes-count').textContent = state.notes.length;
    renderNotes(document.getElementById('content'));
    document.querySelector(`.note-card[data-id="${note.id}"] .note-body`)?.focus();
}

async function saveNote(id, title, content) {
    const note = state.notes.find(n => n.id === id);
    if (!note) return;
    note.title = title;
    note.content = content;
    note.updatedAt = Date.now();
    await dbPut(STORE_NOTES, note);
}

async function deleteNote(id) {
    if (!confirm('이 메모를 삭제할까요?')) return;
    await dbDelete(STORE_NOTES, id);
    state.notes = state.notes.filter(n => n.id !== id);
    document.getElementById('notes-count').textContent = state.notes.length;
    renderNotes(document.getElementById('content'));
}

// ── 자료(논문이 아닌 자료) 뷰 ──────────────────────────────
function renderMaterials(container) {
    if (state.materials.length === 0) {
        container.innerHTML = `
            <div class="section-header">
                <span class="section-title">자료 0개</span>
                <button class="btn-secondary" id="btn-add-material-inline">+ 자료 추가</button>
            </div>
            <div class="empty-state">
                <div class="empty-icon">${icon('library', 44)}</div>
                <h3>저장된 자료가 없습니다</h3>
                <p>척도, 도서, 웹자료 등 논문이 아닌 자료를<br><strong>+ 자료 추가</strong>로 보관해보세요</p>
            </div>`;
        document.getElementById('btn-add-material-inline').onclick = () => openMaterialForm();
        return;
    }
    const sorted = [...state.materials].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    container.innerHTML = `
        <div class="section-header">
            <span class="section-title">자료 ${state.materials.length}개</span>
            <button class="btn-secondary" id="btn-add-material-inline">+ 자료 추가</button>
        </div>
        <div class="papers-grid">${sorted.map(materialCardHTML).join('')}</div>`;
    document.getElementById('btn-add-material-inline').onclick = () => openMaterialForm();
    bindMaterialCards(container);
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
        <div class="papers-grid">${matches.map(materialCardHTML).join('')}</div>`;
    bindMaterialCards(container);
}

function materialMatchesQuery(m, q) {
    return [m.title, m.authors, m.source, m.note, m.type, m.fileName]
        .some(f => f && String(f).toLowerCase().includes(q));
}

function materialCardHTML(m) {
    return `
        <div class="paper-card material-card" data-id="${m.id}">
            <div class="paper-card-header">
                <div class="paper-title">${escHtml(m.title || '제목 없음')}</div>
                <span class="material-type-badge mt-${escHtml(m.type || '기타')}">${escHtml(m.type || '기타')}</span>
            </div>
            ${m.authors ? `<div class="paper-authors">${escHtml(m.authors)}</div>` : ''}
            ${m.source ? `<div class="material-source">${escHtml(m.source)}</div>` : ''}
            ${m.note ? `<div class="material-note">${escHtml(m.note)}</div>` : ''}
            <div class="paper-card-footer">
                ${m.fileData ? `<span class="paper-has-pdf">${icon('paperclip', 14)} ${escHtml(m.fileName || '첨부파일')}</span>` : '<span></span>'}
            </div>
        </div>`;
}

function bindMaterialCards(container) {
    container.querySelectorAll('.material-card').forEach(card => {
        card.addEventListener('click', () => openMaterialForm(card.dataset.id, 'view'));
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

    let extra = document.getElementById('m-view-file');
    if (extra) extra.remove();
    document.getElementById('modal-material-title').textContent =
        mode === 'view' ? (m?.title || '자료 보기')
        : (state.editingMaterialId ? '자료 수정' : '자료 추가');

    // 보기 모드에서 첨부파일 열기 버튼
    if (mode === 'view' && m?.fileData) {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.id = 'm-view-file'; btn.className = 'btn-pdf';
        btn.style.marginBottom = '14px';
        btn.innerHTML = `${icon('paperclip')} 첨부파일 열기 (${escHtml(m.fileName || '파일')})`;
        btn.onclick = () => openMaterialFile(m);
        const body = document.querySelector('#modal-material .modal-body');
        body.insertBefore(btn, body.firstChild);
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

function openMaterialFile(m) {
    if (!m.fileData) return;
    const blob = new Blob([m.fileData]);
    const url = URL.createObjectURL(blob);
    // 새 탭으로 열되, 다운로드 가능하도록 파일명 지정
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
            <button type="button" class="btn-cite" id="ve-cite">${icon('copy')} ${escHtml(inText || '본문 인용')} 복사</button>
            <button type="button" class="btn-apa-copy" id="ve-apa">${icon('clipboard')} APA 복사</button>
        </div>
        <div class="ve-apa">
            <div class="ve-apa-label">APA 참고문헌</div>
            <div class="ve-apa-text">${escHtml(apaRef) || '<span class="muted">서지정보를 입력하면 생성됩니다</span>'}</div>
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
        const ok = await copyToClipboard(apaRef);
        showToast(ok ? 'APA 참고문헌이 복사됐습니다' : '복사 실패', ok ? 'success' : 'error');
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
function openPdf(paper) {
    if (!paper.pdfData) return;
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
    if (state.view === 'desk' && deskCtx) deskActivate(paperId);                 // 이미 책상이면 바로 전환
    else document.querySelector('.nav-item[data-view="desk"]')?.click();         // 아니면 책상 화면으로 이동
}

// 책상 화면 그리기(.content 안에 렌더) — 논문을 안 열어도 열림
function renderDesk(container) {
    deskTeardown();                       // 이전 책상 리소스/리스너 정리(탭 목록 deskTabs는 보존)
    deskTabs = deskTabs.filter(id => state.papers.some(p => p.id === id));
    const pct = Math.max(25, Math.min(80, parseInt(localStorage.getItem('deskLeftPct') || '60', 10) || 60));
    container.style.padding = '0';
    container.style.overflow = 'hidden';
    container.innerHTML = `
        <div class="desk-view" id="desk-view">
            <div class="desk-topbar">
                <div class="desk-tabs" id="desk-tabs"></div>
                <button type="button" class="desk-sketch" title="모형스케치북으로 — 거기서 「책상」으로 돌아옴">${icon('nodes')} 스케치북</button>
            </div>
            <div class="desk-body">
                <div class="desk-pane desk-left" id="desk-left" style="flex:0 0 ${pct}%"></div>
                <div class="desk-resizer" id="desk-resizer" title="끌어서 폭 조절"></div>
                <div class="desk-pane desk-right" id="desk-right"></div>
            </div>
        </div>`;
    const root = container.querySelector('#desk-view');
    deskCtx = { overlay: root, pdfUrl: null };
    root.querySelector('.desk-sketch').addEventListener('click', () =>
        document.querySelector('.nav-item[data-view="sketch"]')?.click());
    bindDeskResizer(root);

    if (deskActiveId && deskTabs.includes(deskActiveId)) deskActivate(deskActiveId);
    else if (deskTabs.length) deskActivate(deskTabs[0]);
    else deskRenderEmpty();
}

// 논문을 아직 안 펼친 빈 책상 — 왼쪽은 안내, 오른쪽 패널(발표자료 탭)은 그대로 동작
function deskRenderEmpty() {
    if (!deskCtx) return;
    deskActiveId = null;
    const { overlay } = deskCtx;
    if (deskCtx.pdfUrl) { URL.revokeObjectURL(deskCtx.pdfUrl); deskCtx.pdfUrl = null; }
    overlay.querySelector('#desk-left').innerHTML = `
        <div class="desk-empty">
            ${icon('book-open', 46)}
            <h3>연구 책상</h3>
            <p>논문을 펼쳐 읽으며 중요한 문장을 발췌하고,<br>오른쪽에서 발표자료를 정리하는 공간이에요.</p>
            <button type="button" class="btn-primary" id="desk-empty-pick">＋ 논문 펼치기</button>
        </div>`;
    overlay.querySelector('#desk-right').innerHTML = deskRightHTML(null);
    bindDeskRight(overlay, null);
    deskRenderTabs();
    overlay.querySelector('#desk-empty-pick')?.addEventListener('click', deskOpenPicker);
}

// 책상에서 다른 화면으로 나갈 때 리소스 정리 — 펼쳐둔 논문(deskTabs)은 유지
function deskTeardown() {
    if (!deskCtx) return;
    if (deskCtx.onMove) window.removeEventListener('mousemove', deskCtx.onMove);
    if (deskCtx.onUp)   window.removeEventListener('mouseup', deskCtx.onUp);
    if (deskCtx.pdfUrl) URL.revokeObjectURL(deskCtx.pdfUrl);
    deskCtx = null;
}

// 탭 전환 — 왼쪽(PDF/본문)·오른쪽(발췌)을 그 논문으로 갈아끼움
function deskActivate(paperId) {
    if (!deskCtx) return;
    const paper = state.papers.find(p => p.id === paperId);
    if (!paper) return;
    deskActiveId = paperId;
    // 이전 PDF blob URL 정리 후 새로 생성
    if (deskCtx.pdfUrl) { URL.revokeObjectURL(deskCtx.pdfUrl); deskCtx.pdfUrl = null; }
    deskCtx.pdfUrl = paper.pdfData
        ? URL.createObjectURL(new Blob([paper.pdfData], { type: 'application/pdf' }))
        : null;
    const { overlay } = deskCtx;
    overlay.querySelector('#desk-left').innerHTML = deskLeftHTML(paper, deskCtx.pdfUrl);
    overlay.querySelector('#desk-right').innerHTML = deskRightHTML(paper);
    bindDeskRight(overlay, paper);
    deskRenderTabs();
}

// 상단 탭 줄 렌더 + 바인딩
function deskRenderTabs() {
    const { overlay } = deskCtx;
    const tabs = deskTabs, activeId = deskActiveId;
    const tabsEl = overlay.querySelector('#desk-tabs');
    const tabHTML = tabs.map(id => {
        const p = state.papers.find(x => x.id === id);
        if (!p) return '';
        const title = p.title || '제목 없음';
        return `
            <div class="desk-tab ${id === activeId ? 'active' : ''}" data-id="${id}" title="${escHtml(title)}">
                <span class="desk-tab-icon">${p.pdfData ? icon('file-text', 14) : icon('note', 14)}</span>
                <span class="desk-tab-title">${escHtml(title)}</span>
                <button type="button" class="desk-tab-close" data-id="${id}" title="이 논문 닫기">✕</button>
            </div>`;
    }).join('');
    tabsEl.innerHTML = tabHTML +
        `<button type="button" class="desk-tab-add" id="desk-tab-add" title="다른 논문 꺼내기">＋</button>`;

    tabsEl.querySelectorAll('.desk-tab').forEach(t =>
        t.addEventListener('click', e => {
            if (e.target.closest('.desk-tab-close')) return;
            deskActivate(t.dataset.id);
        }));
    tabsEl.querySelectorAll('.desk-tab-close').forEach(b =>
        b.addEventListener('click', e => { e.stopPropagation(); deskCloseTab(b.dataset.id); }));
    tabsEl.querySelector('#desk-tab-add').addEventListener('click', deskOpenPicker);
}

// 탭 닫기 — 마지막 하나를 닫으면 빈 책상(안내 화면)으로
function deskCloseTab(id) {
    const i = deskTabs.indexOf(id);
    if (i < 0) return;
    deskTabs.splice(i, 1);
    if (deskTabs.length === 0) { deskRenderEmpty(); return; }
    if (deskActiveId === id) deskActivate(deskTabs[Math.max(0, i - 1)]);
    else deskRenderTabs();
}

// "＋ 다른 논문 꺼내기" — 현재 프로젝트 논문 중 안 열린 것 고르기
function deskOpenPicker() {
    const { overlay } = deskCtx;
    overlay.querySelector('.desk-picker')?.remove();
    const open = new Set(deskTabs);
    const avail = sortPapers(state.papers.filter(p => !open.has(p.id)));
    const pick = document.createElement('div');
    pick.className = 'desk-picker';
    pick.innerHTML = avail.length
        ? avail.map(p => `
            <button type="button" class="desk-pick-item" data-id="${p.id}">
                <span>${p.pdfData ? icon('file-text', 14) : icon('note', 14)}</span>
                <span class="desk-pick-title">${escHtml(p.title || '제목 없음')}</span>
                <span class="desk-pick-meta">${escHtml([p.year, firstAuthor(p)].filter(Boolean).join(' · '))}</span>
            </button>`).join('')
        : `<div class="desk-pick-empty">더 꺼낼 논문이 없어요.</div>`;
    overlay.querySelector('.desk-topbar').appendChild(pick);
    pick.querySelectorAll('.desk-pick-item').forEach(b =>
        b.addEventListener('click', () => { if (!deskTabs.includes(b.dataset.id)) deskTabs.push(b.dataset.id); pick.remove(); deskActivate(b.dataset.id); }));
    // 바깥 클릭 시 닫기
    const off = e => {
        if (!pick.contains(e.target) && !e.target.closest('#desk-tab-add')) {
            pick.remove();
            document.removeEventListener('mousedown', off);
        }
    };
    setTimeout(() => document.addEventListener('mousedown', off), 0);
}

function deskLeftHTML(paper, pdfUrl) {
    if (pdfUrl) return `<iframe class="desk-pdf" src="${pdfUrl}" title="PDF"></iframe>`;
    // PDF 없음 → 가진 본문 정보로 대체
    const meta = [paper.year, paper.authors, paper.source].filter(Boolean).map(escHtml).join(' · ');
    const blocks = [];
    const sec = (label, val) => { if (val && String(val).trim()) blocks.push(`<h4>${label}</h4><p>${escHtml(val)}</p>`); };
    sec('초록', paper.abstract);
    sec('연구방법', paper.methods);
    sec('주요발견', paper.findings);
    sec('내 메모', paper.myNote);
    return `
        <div class="desk-text">
            <h2>${escHtml(paper.title || '제목 없음')}</h2>
            ${meta ? `<div class="desk-text-meta">${meta}</div>` : ''}
            ${blocks.join('') || `<p class="muted">이 논문엔 PDF도, 입력된 본문도 없어요. ${icon('pencil', 14)} 수정에서 채우거나 PDF를 올려보세요.</p>`}
        </div>`;
}

// 캔버스/패널 사이 핸들을 끌어 왼쪽 폭 조절(전역 비율 localStorage 저장)
function bindDeskResizer(overlay) {
    const left = overlay.querySelector('#desk-left');
    const body = overlay.querySelector('.desk-body');
    const resizer = overlay.querySelector('#desk-resizer');
    let dragging = false;
    resizer.addEventListener('mousedown', e => { dragging = true; e.preventDefault(); document.body.style.userSelect = 'none'; });
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
    const excerptInner = paper ? `
            <div class="desk-right-inner">
                <div class="desk-catch">
                    <div class="desk-catch-head">
                        <span>${icon('clipboard', 14)} 붙여넣기 받는 칸</span>
                    </div>
                    <textarea class="desk-catch-text" placeholder="왼쪽에서 드래그 → 복사(Ctrl+C) → 여기 붙여넣기(Ctrl+V) → 분류 고르고 담기"></textarea>
                    <div class="desk-catch-bar">
                        <span class="desk-cat-label">분류</span>
                        <select class="desk-cat-select" id="desk-cat-select">${cats}</select>
                        <button type="button" class="desk-add btn-primary">담기</button>
                    </div>
                </div>
                <div class="desk-excerpts" id="desk-excerpts">${deskExcerptsHTML(paper)}</div>
            </div>` : `
            <div class="desk-rpanel-empty">
                ${icon('book-open', 34)}
                <p>논문을 펼치면 여기서 중요한 문장을<br>복사해 분류할 수 있어요.</p>
            </div>`;
    return `
        <div class="desk-rtabs">
            <button type="button" class="desk-rtab ${t === 'excerpt' ? 'active' : ''}" data-rtab="excerpt">${icon('clipboard', 15)} 복사붙이기 분류</button>
            <button type="button" class="desk-rtab ${t === 'model' ? 'active' : ''}" data-rtab="model">${icon('bar-chart', 15)} 발표자료 만들기</button>
        </div>
        <div class="desk-rpanel desk-right-top" id="desk-right-top" data-panel="excerpt" ${t === 'excerpt' ? '' : 'hidden'}>${excerptInner}</div>
        <div class="desk-rpanel desk-model-pane" id="desk-model-pane" data-panel="model" ${t === 'model' ? '' : 'hidden'}></div>`;
}

// 하단 "모형 미리보기" — 프로포절 칸·가설·변인을 읽기전용으로 표시(발췌 보낼 때마다 갱신).
// 스케치북 에디터(S)는 안 띄움 → 안전.
function deskModelPreviewHTML() {
    const p = state.proposal || {};
    const field = (key, label) => {
        const v = (p[key] || '').trim();
        return `<div class="dmp-field"><div class="dmp-k">${label}</div><div class="dmp-v ${v ? '' : 'muted'}">${v ? escHtml(v) : '(비어 있음 — 발췌를 보내보세요)'}</div></div>`;
    };
    const hyps = (p.hypotheses || []).filter(h => h && (h.text || '').trim());
    const hypHTML = hyps.length
        ? `<div class="dmp-field"><div class="dmp-k">가설</div><div class="dmp-hyps">${hyps.map((h, i) => `<div class="dmp-hyp"><b>H${i + 1}</b> ${escHtml(h.text)}</div>`).join('')}</div></div>`
        : '';
    const vars = deskCollectVariables();
    const varHTML = `<div class="dmp-field"><div class="dmp-k">변인</div><div class="dmp-vars">${vars.length ? vars.map(v => `<span class="tag tag-variable">${escHtml(v)}</span>`).join('') : '<span class="muted">아직 없음 — 변인 발췌를 보내보세요</span>'}</div></div>`;
    return `
        <div class="desk-model-head">${icon('bar-chart', 14)} 발표자료 만들기 <span class="muted">· 편집은 모형스케치북에서</span></div>
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

// 우측 패널 탭 전환 (복사붙이기 분류 ↔ 발표자료 만들기)
function deskActivateRTab(overlay, tab) {
    deskRTab = tab;
    overlay.querySelectorAll('.desk-rtab').forEach(b =>
        b.classList.toggle('active', b.dataset.rtab === tab));
    overlay.querySelectorAll('.desk-rpanel').forEach(p => {
        p.hidden = (p.dataset.panel !== tab);
    });
    if (tab === 'model') deskRenderModel(overlay);
}

function deskRenderModel(overlay) {
    const pane = overlay.querySelector('#desk-model-pane');
    if (pane) pane.innerHTML = deskModelPreviewHTML();
}

// 카테고리별로 묶어 한눈에 (EXCERPT_CATS 순서)
function deskExcerptsHTML(paper) {
    const list = paper.excerpts || [];
    if (!list.length) {
        return `<div class="desk-ex-empty">아직 담은 게 없어요.<br>왼쪽에서 중요한 문장을 복사해 위 칸에 붙여넣고 담아보세요.</div>`;
    }
    return EXCERPT_CATS.map(([k, label]) => {
        const items = list.filter(e => e.cat === k);
        if (!items.length) return '';
        const cards = items.map(e => {
            const style = e.color ? ` style="border-left:4px solid ${e.color}"` : '';
            const sw = EX_COLORS.map(c =>
                `<button type="button" class="desk-ex-sw ${e.color === c ? 'on' : ''}" data-eid="${e.id}" data-color="${c}" style="background:${c || '#ffffff'}" title="${c ? '색 칠하기' : '색 없음'}"></button>`
            ).join('');
            return `
            <div class="desk-ex-card" data-eid="${e.id}"${style}>
                <div class="desk-ex-text" contenteditable="true" data-eid="${e.id}">${escHtml(e.text)}</div>
                <div class="desk-ex-memo" contenteditable="true" data-eid="${e.id}" data-ph="＋ 메모">${escHtml(e.memo || '')}</div>
                <div class="desk-ex-tools">
                    <div class="desk-ex-swatches">${sw}</div>
                    <div class="desk-ex-tbtns">
                        <button type="button" class="desk-ex-del" data-eid="${e.id}" title="삭제">✕ 삭제</button>
                    </div>
                </div>
            </div>`;
        }).join('');
        return `
            <div class="desk-ex-group">
                <div class="desk-ex-gtitle">
                    <span class="desk-ex-badge cat-${k}">${label}</span>
                    <span class="desk-ex-count">${items.length}</span>
                </div>
                ${cards}
            </div>`;
    }).join('');
}

function bindDeskRight(overlay, paper) {
    // 우측 탭(복사붙이기 분류 ↔ 발표자료 만들기) 전환 — 논문 없어도 동작
    overlay.querySelectorAll('.desk-rtab').forEach(b =>
        b.addEventListener('click', () => deskActivateRTab(overlay, b.dataset.rtab)));
    // 논문 탭 전환 등으로 다시 그려질 때, 발표자료 탭이 켜져 있었으면 내용 채움
    if (deskRTab === 'model') deskRenderModel(overlay);
    // 발췌(복사붙이기) 관련은 논문이 펼쳐져 있을 때만
    if (!paper) return;
    const catSel = overlay.querySelector('#desk-cat-select');
    if (catSel) catSel.addEventListener('change', () => { deskAddCat = catSel.value; });
    overlay.querySelector('.desk-add').addEventListener('click', () => deskAddExcerpt(overlay, paper));
    bindDeskExcerpts(overlay, paper);
}

// 발췌 카드 색(왼쪽 띠). 빈 문자열 = 색 없음
const EX_COLORS = ['', '#fcd34d', '#86efac', '#93c5fd', '#f9a8d4'];

// 발췌 → 모형 보내기 목적지: 프로포절 텍스트칸 4개 + 변인 태그
const EX_SEND_DESTS = [
    ['needs',     '필요성'],
    ['purpose',   '목적'],
    ['theory',    '이론배경'],
    ['subjects',  '대상'],
    ['method',    '방법'],
    ['expected',  '기대효과'],
    ['variables', '변인 태그'],
];

function bindDeskExcerpts(overlay, paper) {
    overlay.querySelectorAll('.desk-ex-del').forEach(b =>
        b.addEventListener('click', () => deskDelExcerpt(overlay, paper, b.dataset.eid)));
    // 본문/메모 인라인 편집 — 포커스 잃을 때 저장(재렌더 안 함: 커서 유지)
    overlay.querySelectorAll('.desk-ex-text').forEach(el =>
        el.addEventListener('blur', () => deskUpdateExcerpt(paper, el.dataset.eid, 'text', el.textContent.trim())));
    overlay.querySelectorAll('.desk-ex-memo').forEach(el =>
        el.addEventListener('blur', () => deskUpdateExcerpt(paper, el.dataset.eid, 'memo', el.textContent.trim())));
    // 색 칠하기 — 저장 후 다시 그려 띠 반영
    overlay.querySelectorAll('.desk-ex-sw').forEach(b =>
        b.addEventListener('click', () => {
            deskUpdateExcerpt(paper, b.dataset.eid, 'color', b.dataset.color);
            deskRenderExcerpts(overlay, paper);
        }));
}

// 발췌 한 조각을 모형(미니프로포절 칸 / 변인 태그)으로 보냄.
// 스케치북 내부 상태 S는 안 건드리고, 저장소(proposals/papers)에만 기록 → 다음에 스케치북 열면 반영.
function deskSendExcerpt(overlay, paper, eid, dest) {
    const e = (paper.excerpts || []).find(x => x.id === eid);
    const text = (e?.text || '').trim();
    if (!text) { showToast('내용이 비어 있어요', 'error'); return; }

    if (dest === 'variables') {
        if (!Array.isArray(paper.variables)) paper.variables = [];
        if (paper.variables.some(v => String(v).toLowerCase() === text.toLowerCase())) {
            showToast('이미 변인 태그에 있어요', 'info');
        } else {
            paper.variables.push(text);
            dbPut(STORE_PAPERS, paper);
            showToast('변인 태그로 보냈어요 — 스케치북 변인 패널에 떠요', 'success');
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
    const ta = overlay.querySelector('.desk-catch-text');
    const text = (ta.value || '').trim();
    if (!text) { ta.focus(); return; }
    if (!Array.isArray(paper.excerpts)) paper.excerpts = [];
    // 같은 카테고리 맨 앞에 오도록 최신순 unshift (paper는 state.papers의 참조 → 메모리도 갱신)
    paper.excerpts.unshift({ id: genId(), cat: deskAddCat, text, memo: '', color: '', createdAt: Date.now() });
    dbPut(STORE_PAPERS, paper);
    ta.value = '';
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
    formVariables = [];
    formTags = [];

    const ids = ['f-title','f-authors','f-year','f-source','f-volume','f-issue',
                 'f-pages','f-doi','f-abstract','f-methods','f-findings','f-note',
                 'doi-input','riss-input'];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    document.getElementById('pdf-filename').textContent = '선택된 파일 없음';

    const paper = editId ? state.papers.find(p => p.id === editId) : null;
    if (paper) {
        const set = (id, val) => { if (val) document.getElementById(id).value = val; };
        set('f-title', paper.title); set('f-authors', paper.authors); set('f-year', paper.year);
        set('f-source', paper.source); set('f-volume', paper.volume); set('f-issue', paper.issue);
        set('f-pages', paper.pages); set('f-doi', paper.doi); set('f-abstract', paper.abstract);
        set('f-methods', paper.methods); set('f-findings', paper.findings); set('f-note', paper.myNote);
        formVariables = [...(paper.variables || [])];
        formTags = [...(paper.tags || [])];
        if (paper.pdfData) document.getElementById('pdf-filename').textContent = paper.pdfFilename || 'PDF 있음';
    }

    renderChips('variables-list', formVariables, 'variable');
    renderChips('tags-list', formTags, 'normal');
    fillAnalysis(paper?.analysis || null);
    applyFormMode(mode, paper);
    document.getElementById('modal-form').style.display = 'flex';
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
    document.querySelector('#modal-form .modal-body').scrollTop = 0;
}

function closeForm() {
    document.getElementById('modal-form').style.display = 'none';
    state.editingId = null;
    state.formMode = 'edit';
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
        volume: val('f-volume'),
        issue: val('f-issue'),
        pages: val('f-pages'),
        doi: val('f-doi'),
        abstract: val('f-abstract'),
        methods: val('f-methods'),
        findings: val('f-findings'),
        myNote: val('f-note'),
        variables: [...formVariables],
        tags: [...formTags],
        analysis: collectAnalysis(),
        pdfData,
        pdfFilename,
        projectId: state.currentProjectId,
        addedAt: state.editingId
            ? (state.papers.find(p => p.id === state.editingId)?.addedAt || Date.now())
            : Date.now(),
        updatedAt: Date.now(),
    };

    const wasEditing = !!state.editingId;
    await dbPut(STORE_PAPERS, paper);
    await loadData();
    renderContent();
    showToast(wasEditing ? '논문이 수정되었습니다' : '논문이 추가되었습니다', 'success');
    // 수정 저장 → 같은 논문 보기 모드로 전환, 새 논문 → 모달 닫기
    if (wasEditing) openForm(paper.id, 'view');
    else closeForm();
}

function readFile(file) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = e => res(e.target.result);
        r.onerror = rej;
        r.readAsArrayBuffer(file);
    });
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

        const fill = (id, v) => { if (v) document.getElementById(id).value = v; };
        fill('f-title', data.title);
        fill('f-authors', data.authors);
        fill('f-year', data.year);
        fill('f-source', data.source);
        fill('f-abstract', data.abstract);
        fill('f-doi', doi);

        showToast('불러왔습니다. 내용이 맞는지 꼭 확인하세요.', 'info');
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btn.innerHTML = '자동 불러오기';
        btn.disabled = false;
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
    const source = item['container-title']?.[0] || item.publisher || '';
    const abstract = (item.abstract || '').replace(/<[^>]+>/g, '');
    return { title, authors, year, source, abstract };
}

// ── 백업 JSON 생성(내보내기·폴더백업 공용) ─────────────────
async function buildBackupJson() {
    const papers = await dbGetAll(STORE_PAPERS);
    const exportable = papers.map(p => ({
        ...p,
        pdfData: p.pdfData ? bufToB64(p.pdfData) : null,
        _pdfEncoded: !!p.pdfData,
    }));
    const materials = await dbGetAll(STORE_MATERIALS);
    const exportableMat = materials.map(m => ({
        ...m,
        fileData: m.fileData ? bufToB64(m.fileData) : null,
        _fileEncoded: !!m.fileData,
    }));
    const notes = await dbGetAll(STORE_NOTES);
    const proposals = await dbGetAll(STORE_PROPOSALS);   // 모형스케치북 미니 프로포절(첨부파일 없음 → 그대로)
    return JSON.stringify(
        { version: 3, exportedAt: Date.now(), papers: exportable, materials: exportableMat, notes, proposals },
        null, 2);
}

// ── 내보내기(다운로드) ─────────────────────────────────────
async function exportData() {
    const json = await buildBackupJson();
    download(json, `연구노트_백업_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
    showToast('데이터를 내보냈습니다', 'success');
}

// ── 폴더 백업: 지정 폴더의 같은 파일에 최신본 덮어쓰기 ──────
const BACKUP_FILENAME = '연구노트_최신백업.json';
const BACKUP_HANDLE_KEY = 'backupDir';
let backupDirHandle = null;
let autoBackupTimer = null;

// 앱 시작 시 저장해둔 백업 폴더 핸들 복원(권한 요청은 안 함)
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
    const json = await buildBackupJson();
    const fh = await backupDirHandle.getFileHandle(BACKUP_FILENAME, { create: true });
    const w = await fh.createWritable();
    await w.write(json);
    await w.close();
}

// "폴더백업" 버튼: 폴더 미지정이면 1회 선택받고, 이후엔 덮어쓰기
async function folderBackup() {
    if (!window.showDirectoryPicker) {
        showToast('이 브라우저는 폴더 백업을 지원하지 않습니다. 내보내기를 사용하세요', 'error');
        return;
    }
    try {
        if (!backupDirHandle) {
            backupDirHandle = await window.showDirectoryPicker({ id: 'researchNotesBackup', mode: 'readwrite' });
            await dbPut(STORE_SETTINGS, { id: BACKUP_HANDLE_KEY, handle: backupDirHandle });
        }
        if (!(await ensureBackupPermission(true))) {
            showToast('백업 폴더 쓰기 권한이 필요합니다', 'error');
            return;
        }
        await writeBackupFile();
        showToast(`백업 완료 — ${BACKUP_FILENAME}`, 'success');
    } catch (err) {
        if (err.name === 'AbortError') return;  // 사용자가 폴더 선택 취소
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
                // 이미 있으면 현재 프로젝트로 재배정만 해서 보이게(데이터 보존)
                if (dup.projectId !== state.currentProjectId) {
                    dup.projectId = state.currentProjectId;
                    await dbPut(STORE_PAPERS, dup);
                }
                continue;
            }
            const paper = { ...p };
            if (p._pdfEncoded && p.pdfData) paper.pdfData = b64ToBuf(p.pdfData);
            delete paper._pdfEncoded;
            paper.projectId = state.currentProjectId;   // 현재 프로젝트로 배정해 바로 보이게
            await dbPut(STORE_PAPERS, paper);
        }
        const existingMat = await dbGetAll(STORE_MATERIALS);
        for (const m of materials) {
            const dup = existingMat.find(e => e.id === m.id);
            if (dup) {
                if (dup.projectId !== state.currentProjectId) {
                    dup.projectId = state.currentProjectId;
                    await dbPut(STORE_MATERIALS, dup);
                }
                continue;
            }
            const mat = { ...m };
            if (m._fileEncoded && m.fileData) mat.fileData = b64ToBuf(m.fileData);
            delete mat._fileEncoded;
            mat.projectId = state.currentProjectId;      // 현재 프로젝트로 배정해 바로 보이게
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
    let binary = '';
    new Uint8Array(buf).forEach(b => { binary += String.fromCharCode(b); });
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
    const lines = DEBUG_LOG.map(d =>
        `[${new Date(d.t).toLocaleTimeString('ko-KR', { hour12: false })}] ${d.level.toUpperCase()}: ${d.msg}`);
    return `=== 연구노트 디버그 로그 ===\n`
        + Object.entries(env).map(([k, v]) => `${k}: ${v}`).join('\n')
        + `\n\n--- 기록 (${DEBUG_LOG.length}건) ---\n`
        + (lines.join('\n') || '(기록된 오류·경고 없음)');
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
    if (!confirm('정말 전부 삭제할까요?\n(백업 파일이 있으면 "받음"으로 복구할 수 있어요)')) return;

    suppressAutoBackup = true;
    try {
        for (const store of [STORE_PAPERS, STORE_MATERIALS, STORE_NOTES, STORE_MINDMAPS, STORE_PROPOSALS, STORE_PROJECTS]) {
            await dbClearStore(store);
        }
        localStorage.removeItem('currentProjectId');
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
      a: '연구 책상에서:\n① PDF 문장을 드래그→복사(Ctrl+C)\n② 오른쪽 「붙여넣기 받는 칸」에 붙여넣기(Ctrl+V)\n③ 분류(예: 연구방법)를 고르고\n④ 「담기」\n그 논문에 항목별로 차곡차곡 쌓여요.' },
    { q: '담은 내용은 어디서 봐요?',
      a: '그 논문의 「보기」를 열면 맨 아래 "담은 발췌"가 항목별로 모여 보이고, 거기서 바로 고치거나 지울 수 있어요.\n또 위쪽 「논문 보기…」 드롭다운으로 어느 화면에서나 꺼내볼 수 있어요.' },
    { q: '분류 모아보기는요?',
      a: '여러 논문을 같은 항목으로 비교해요. 예를 들어 「연구의 필요성」을 고르면 여러 논문의 필요성 발췌가 한눈에 모여요.\n각 논문 「보기」로 세부도 볼 수 있어요.' },
    { q: '모형스케치북은요?',
      a: '연구모형(변인 그림)을 그리는 곳이에요.\n도형 추가 → 드래그로 이동 → 우클릭으로 화살표 연결 → 더블클릭으로 이름 입력.\n「미니 프로포절」에 연구 계획을 적고, 「발표자료 만들기」로 PPT를 내보내고, 「모형 저장」으로 여러 버전을 보관해요.' },
    { q: '아이디어 메뉴는요?',
      a: '「아이디어」는 떠오르는 생각·메모를 자유롭게 적어두는 공간이에요.\n논문과 별개로, 연구하다 떠오른 아이디어를 모아둘 수 있어요.' },
    { q: '논문은 어떻게 추가해요?',
      a: '「논문 추가」 버튼(왼쪽 아래 또는 오른쪽 위)을 눌러요.\nRISS 인용문이나 DOI를 붙여넣어 자동 입력할 수 있고, 「정밀 분석」에서 정독하며 항목을 채울 수 있어요.' },
    { q: '자료 메뉴는요?',
      a: '「자료」는 논문이 아닌 자료를 보관해요 — 척도·도서·웹자료·보고서·강의자료 등.\n파일도 첨부할 수 있어요.' },
    { q: '참고문헌은요?',
      a: '「참고문헌」은 등록한 논문들의 APA 참고문헌을 한 목록으로 보여줘요.\n복사해서 논문 끝에 붙일 수 있어요.' },
    { q: '백업은 어떻게 해요?',
      a: '자료는 이 브라우저에 저장돼요(IndexedDB). 왼쪽 아래에서:\n• 「백업」 = 파일로 자동 저장\n• 「보냄」 = 내보내기\n• 「받음」 = 가져오기\n다른 컴퓨터로 옮길 땐 보냄 → 받음 하세요.' },
    { q: '빠른 인용이 뭐예요?',
      a: '위쪽 「빠른 인용」 버튼을 누르면 작은 창이 떠요.\n논문 목록에서 「빠른 인용」으로 표시해 둔 논문들의 인용을 빠르게 복사할 수 있어요.' },
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
        else openForm(null, 'edit');
    };
    document.getElementById('btn-add').addEventListener('click', addByView);
    document.getElementById('btn-add-top').addEventListener('click', addByView);

    // 검색 모드 토글(키워드만 / 전체단어)
    document.querySelectorAll('#search-mode-toggle .sm-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#search-mode-toggle .sm-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.searchMode = btn.dataset.mode;
            if (state.searchQuery) renderContent();
        });
    });

    // 미니 창 열기
    document.getElementById('btn-open-mini').addEventListener('click', () => {
        window.open('mini.html', '빠른인용',
            'width=400,height=680,resizable=yes,scrollbars=no');
    });

    // 논문 모달 닫기 / 보기↔수정 전환 / 삭제
    document.getElementById('close-form').addEventListener('click', closeForm);
    document.getElementById('btn-cancel-form').addEventListener('click', closeForm);
    document.getElementById('btn-close-view').addEventListener('click', closeForm);
    document.getElementById('btn-switch-edit').addEventListener('click', () => openForm(state.editingId, 'edit'));
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

    // 변인 태그 입력
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

    // PDF 선택
    document.getElementById('btn-pick-pdf').addEventListener('click', () => {
        document.getElementById('f-pdf').click();
    });
    document.getElementById('f-pdf').addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) {
            state.currentPdfFile = file;
            document.getElementById('pdf-filename').textContent = file.name;
        }
    });

    // 폴더백업 / 내보내기 / 가져오기
    document.getElementById('btn-folder-backup').addEventListener('click', folderBackup);
    document.getElementById('btn-export').addEventListener('click', exportData);
    document.getElementById('btn-import').addEventListener('click', () => {
        document.getElementById('import-input').click();
    });
    document.getElementById('import-input').addEventListener('change', e => {
        if (e.target.files[0]) importData(e.target.files[0]);
        e.target.value = '';
    });

    // ESC 키
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeForm(); closeMaterialForm(); closeDebug(); }
    });
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

async function init() {
    await initDB();
    await requestPersistentStorage();
    await loadBackupHandle();
    await initProjects();
    await loadData();
    bindEvents();
    renderProjectSelector();
    renderContent();
}

init().catch(err => {
    document.getElementById('content').innerHTML = `
        <div class="empty-state">
            <div class="empty-icon">${icon('alert', 44)}</div>
            <h3>앱을 시작하지 못했습니다</h3>
            <p>${escHtml(err.message)}</p>
        </div>`;
});
