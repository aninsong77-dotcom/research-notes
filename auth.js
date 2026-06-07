// ── Firebase 로그인 + Firestore/Storage 동기화 ─────────────────────────
// index.html에서 app.js 다음에 로드. app.js 전역(icon, escHtml, showToast,
// pushDebug, dbGetAll, dbPut, dbDelete, db, state, loadData, renderContent) 공유.

const firebaseConfig = {
    apiKey: "AIzaSyA8Cz0ZT9_jQZXWen2n2qkx-K8yZz0AyVM",
    authDomain: "blue-study-note.firebaseapp.com",
    projectId: "blue-study-note",
    storageBucket: "blue-study-note.firebasestorage.app",
    messagingSenderId: "582073428497",
    appId: "1:582073428497:web:71cfc4735c6887eb3f5fb0"
};

let fbAuth    = null;   // Firebase Authentication
let fbDb      = null;   // Firestore (텍스트/메타데이터)
let fbStorage = null;   // Firebase Storage (PDF·첨부파일)
let currentUser = null;
let _syncBusy = false;  // 전체 동기화 중에는 개별 cloud 호출 막기

function authLog(level, msg) {
    if (typeof pushDebug === 'function') pushDebug(level, msg);
    else if (level === 'error') console.error(msg);
}

// ── 초기화 ─────────────────────────────────────────────────────────────
function initAuth() {
    const box = document.getElementById('auth-box');
    if (typeof firebase === 'undefined' || !firebase.initializeApp) {
        if (box) box.innerHTML = `<div class="auth-offline">${icon('cloud-off', 14)} 오프라인 — 로그인은 웹에서만</div>`;
        // Firebase 없으면 인증 불필요 → 오버레이 바로 제거
        const ov = document.getElementById('auth-pending-overlay');
        if (ov) ov.remove();
        return;
    }
    try {
        firebase.initializeApp(firebaseConfig);
        fbAuth    = firebase.auth();
        fbDb      = firebase.firestore();
        fbStorage = null;   // Storage 미사용 — Spark 무료플랜 서울 리전은 무료 한도 없음

        fbAuth.onAuthStateChanged(user => {
            const wasLoggedIn = !!currentUser;
            currentUser = user;

            // 인증 상태 확정 → 로딩 오버레이 제거
            const ov = document.getElementById('auth-pending-overlay');
            if (ov) ov.remove();

            renderAuthBox();
            if (user && !wasLoggedIn) {
                fullSync();   // 새로 로그인할 때만 전체 동기화
            } else if (!user) {
                // 로그아웃(또는 미로그인) → 로컬 데이터 삭제 후 잠금 화면
                // 데이터는 Firestore에 있으므로 다음 로그인 시 복원됨
                if (wasLoggedIn) {
                    clearLocalData().then(renderLockedScreen);
                } else {
                    renderLockedScreen();
                }
            }
        });

        patchDbFunctions();   // dbPut/dbDelete 후킹
    } catch (e) {
        authLog('error', 'Firebase 초기화 실패: ' + (e.message || e));
        if (box) box.innerHTML = `<div class="auth-offline">로그인 사용 불가</div>`;
    }
}

// ── 로그아웃 시 로컬 데이터 삭제 ───────────────────────────────────
async function clearLocalData() {
    if (typeof db === 'undefined' || !db) return;
    for (const store of SYNC_STORES) {
        try {
            await new Promise((res, rej) => {
                const req = db.transaction(store, 'readwrite').objectStore(store).clear();
                req.onsuccess = res;
                req.onerror = () => rej(req.error);
            });
        } catch (e) {
            authLog('warn', `로컬 삭제 실패 (${store}): ${e.message}`);
        }
    }
    // 메모리 상태도 초기화 (app.js state 공유)
    if (typeof state !== 'undefined') {
        state.papers = [];
        state.materials = [];
    }
    authLog('info', '로그아웃 — 로컬 데이터 삭제 완료');
}

// ── 로그인 잠금 화면 ────────────────────────────────────────────
function renderLockedScreen() {
    // 사이드바 개수 뱃지(논문·자료·아이디어)도 숨김 — 잠금 상태에서 "몇 개 있는지"까지 가린다.
    // 로그인해서 내용을 보일 때 loadData()가 다시 보이게 함.
    ['papers-count', 'materials-count', 'notes-count'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    const container = document.getElementById('content');
    if (!container) return;
    container.innerHTML = `
        <div class="auth-locked-screen">
            <div class="auth-locked-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color:var(--text-muted)"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </div>
            <h2>로그인하면 연구 기록을 볼 수 있어요</h2>
            <p>내 논문, 자료, 메모는 로그인 후에 표시됩니다.</p>
            <button type="button" class="btn-primary" style="margin-top:6px" onclick="openAuthModal()">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:6px"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>
                로그인하고 동기화
            </button>
        </div>`;
}

// ── 사이드바 하단 UI ────────────────────────────────────────────────────
function renderAuthBox() {
    const box = document.getElementById('auth-box');
    if (!box) return;
    if (currentUser) {
        box.innerHTML = `
            <div class="auth-in">
                <span class="auth-email" title="${escHtml(currentUser.email || '')}">${icon('cloud', 14)} ${escHtml(currentUser.email || '로그인됨')}</span>
                <button type="button" class="auth-logout" id="auth-logout">로그아웃</button>
            </div>`;
        box.querySelector('#auth-logout').addEventListener('click', () => {
            fbAuth.signOut().then(() => showToast('로그아웃했어요', 'info'));
        });
    } else {
        box.innerHTML = `<button type="button" class="auth-login-btn" id="auth-login-btn">${icon('cloud', 15)} 로그인하고 동기화</button>`;
        box.querySelector('#auth-login-btn').addEventListener('click', openAuthModal);
    }
}

// ── 오류 메시지 한국어 변환 ──────────────────────────────────────────────
function authErrMsg(err) {
    const c = (err && err.code) || '';
    if (c.includes('invalid-email'))            return '이메일 형식이 올바르지 않아요';
    if (c.includes('weak-password') || c.includes('missing-password')) return '비밀번호는 6자 이상이어야 해요';
    if (c.includes('email-already-in-use'))     return '이미 가입된 이메일이에요 — 로그인해 보세요';
    if (c.includes('user-not-found'))           return '가입되지 않은 이메일이에요 — 먼저 회원가입하세요';
    if (c.includes('wrong-password') || c.includes('invalid-credential')) return '이메일 또는 비밀번호가 틀렸어요';
    if (c.includes('too-many-requests'))        return '시도가 너무 많아요 — 잠시 후 다시';
    if (c.includes('network'))                  return '인터넷 연결을 확인하세요';
    return '실패: ' + ((err && err.message) || c || '알 수 없는 오류');
}

// ── 로그인/회원가입 모달 ─────────────────────────────────────────────────
function openAuthModal() {
    if (!fbAuth) { showToast('로그인 준비가 안 됐어요 (인터넷 확인)', 'error'); return; }
    if (document.querySelector('.auth-overlay')) return;

    let mode = 'login';
    let emailVal = '';
    const overlay = document.createElement('div');
    overlay.className = 'auth-overlay';
    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    const submit = () => {
        const email = overlay.querySelector('#auth-email-in').value.trim();
        const pw    = overlay.querySelector('#auth-pw-in').value;
        if (!email || !pw) { showToast('이메일과 비밀번호를 입력하세요', 'error'); return; }
        const btn = overlay.querySelector('#auth-submit');
        btn.disabled = true; btn.textContent = '잠시만요…';
        const p = mode === 'signup'
            ? fbAuth.createUserWithEmailAndPassword(email, pw)
            : fbAuth.signInWithEmailAndPassword(email, pw);
        p.then(() => {
            close();
            showToast(mode === 'signup' ? '가입하고 로그인했어요!' : '로그인했어요!', 'success');
        }).catch(err => {
            authLog('warn', '로그인 오류: ' + (err.code || err.message));
            showToast(authErrMsg(err), 'error');
            btn.disabled = false;
            btn.textContent = mode === 'login' ? '로그인' : '가입하고 로그인';
        });
    };

    const render = () => {
        overlay.innerHTML = `
            <div class="auth-modal">
                <div class="auth-modal-head">
                    <span>${icon('cloud')} ${mode === 'login' ? '로그인' : '회원가입'}</span>
                    <button type="button" class="auth-x" title="닫기">✕</button>
                </div>
                <div class="auth-modal-body">
                    <label>이메일</label>
                    <input type="email" id="auth-email-in" placeholder="example@email.com" value="${escHtml(emailVal)}" autocomplete="username">
                    <label>비밀번호 <small>(6자 이상)</small></label>
                    <input type="password" id="auth-pw-in" placeholder="비밀번호" autocomplete="${mode === 'login' ? 'current-password' : 'new-password'}">
                    <button type="button" class="auth-submit btn-primary" id="auth-submit">${mode === 'login' ? '로그인' : '가입하고 로그인'}</button>
                    <div class="auth-switch">
                        ${mode === 'login'
                            ? '계정이 없나요? <button type="button" id="auth-toswitch">회원가입</button>'
                            : '이미 계정이 있나요? <button type="button" id="auth-toswitch">로그인</button>'}
                    </div>
                </div>
            </div>`;
        overlay.querySelector('.auth-x').addEventListener('click', close);
        overlay.querySelector('#auth-submit').addEventListener('click', submit);
        overlay.querySelector('#auth-pw-in').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
        overlay.querySelector('#auth-toswitch').addEventListener('click', () => {
            emailVal = overlay.querySelector('#auth-email-in').value;
            mode = (mode === 'login') ? 'signup' : 'login';
            render();
            overlay.querySelector('#auth-email-in').focus();
        });
    };
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    render();
    overlay.querySelector('#auth-email-in').focus();
}

// ════════════════════════════════════════════════════════════════════════
//  Firestore — 텍스트/메타데이터 동기화
// ════════════════════════════════════════════════════════════════════════

const SYNC_STORES = ['papers', 'materials', 'notes', 'projects', 'mindmaps', 'proposals'];

// PDF·파일 바이너리 제거 후 Firestore에 올릴 수 있는 객체 반환
function stripBinary(store, item) {
    const obj = { ...item };
    if (store === 'papers')    delete obj.pdfData;
    if (store === 'materials') delete obj.fileData;
    return obj;
}

// Firestore 컬렉션 참조
function colRef(store) {
    if (!fbDb || !currentUser) return null;
    return fbDb.collection('users').doc(currentUser.uid).collection(store);
}

// 단일 항목 Firestore에 저장 (fire-and-forget)
function cloudPut(store, item) {
    if (!fbDb || !currentUser || !SYNC_STORES.includes(store)) return;
    const obj = { ...stripBinary(store, item), updatedAt: Date.now() };
    colRef(store).doc(String(obj.id)).set(obj)
        .catch(e => authLog('warn', `Firestore 저장 실패 (${store}): ${e.message}`));
    // PDF·파일은 Firebase Storage에 별도 저장
    if (store === 'papers'    && item.pdfData)  cloudPutFile('papers',    item.id, item.pdfData,  item.pdfFilename);
    if (store === 'materials' && item.fileData) cloudPutFile('materials', item.id, item.fileData, item.fileName);
}

// 삭제 기록(tombstone) 컬렉션 참조
function tombRef() {
    if (!fbDb || !currentUser) return null;
    return fbDb.collection('users').doc(currentUser.uid).collection('_tombstones');
}

// 단일 항목 Firestore에서 삭제 + 삭제 기록 남기기 (fire-and-forget)
function cloudDelete(store, id) {
    if (!fbDb || !currentUser || !SYNC_STORES.includes(store)) return;
    colRef(store).doc(String(id)).delete()
        .catch(e => authLog('warn', `Firestore 삭제 실패 (${store}): ${e.message}`));
    // 삭제 기록 — 다른 기기에서 로그인할 때 이 항목이 살아나지 않도록
    tombRef().doc(`${store}_${id}`).set({ store, id: String(id), deletedAt: Date.now() })
        .catch(e => authLog('warn', `삭제 기록 저장 실패 (${store}/${id}): ${e.message}`));
}

// ════════════════════════════════════════════════════════════════════════
//  Firebase Storage — PDF·첨부파일 동기화
// ════════════════════════════════════════════════════════════════════════

// Storage 경로: users/{uid}/papers/{id}  또는  users/{uid}/materials/{id}
function stgRef(kind, id, filename) {
    if (!fbStorage || !currentUser) return null;
    const ext = (filename && filename.includes('.')) ? ('.' + filename.split('.').pop()) : '';
    return fbStorage.ref(`users/${currentUser.uid}/${kind}/${id}${ext}`);
}

// 파일 업로드 (fire-and-forget)
function cloudPutFile(kind, id, data, filename) {
    if (!fbStorage || !currentUser || !data) return;
    const ref = stgRef(kind, id, filename);
    if (!ref) return;
    ref.put(new Blob([data]))
        .catch(e => authLog('warn', `Storage 업로드 실패 (${kind}/${id}): ${e.message}`));
}

// PDF 다운로드 — 로컬에 없을 때 열기 직전 lazy 호출
async function cloudGetPdf(paperId, filename) {
    if (!fbStorage || !currentUser) return null;
    try {
        const ref = stgRef('papers', paperId, filename || 'paper.pdf');
        const url = await ref.getDownloadURL();
        const buf = await fetch(url).then(r => r.arrayBuffer());
        authLog('info', `PDF 다운로드 완료 (${paperId})`);
        return buf;
    } catch (e) {
        authLog('warn', `PDF 다운로드 실패 (${paperId}): ${e.message}`);
        return null;
    }
}

// 자료 파일 다운로드 — lazy
async function cloudGetFile(materialId, filename) {
    if (!fbStorage || !currentUser) return null;
    try {
        const ref = stgRef('materials', materialId, filename || 'file');
        const url = await ref.getDownloadURL();
        const buf = await fetch(url).then(r => r.arrayBuffer());
        authLog('info', `파일 다운로드 완료 (${materialId})`);
        return buf;
    } catch (e) {
        authLog('warn', `파일 다운로드 실패 (${materialId}): ${e.message}`);
        return null;
    }
}

// ════════════════════════════════════════════════════════════════════════
//  전체 동기화 — 로그인 직후 로컬 ↔ 클라우드 병합
// ════════════════════════════════════════════════════════════════════════

async function fullSync() {
    if (!fbDb || !currentUser) return;
    _syncBusy = true;
    authLog('info', '전체 동기화 시작');

    // 사이드바에 "동기화 중…" 표시
    const box = document.getElementById('auth-box');
    if (box) {
        const em = box.querySelector('.auth-email');
        if (em) em.innerHTML = `${icon('cloud', 14)} 동기화 중…`;
    }

    // 삭제 기록 먼저 읽기 — store별 삭제된 ID 목록
    const tombMap = {}; // { store: Set<id> }
    try {
        const tsnap = await tombRef().get();
        tsnap.forEach(doc => {
            const { store, id } = doc.data();
            if (!tombMap[store]) tombMap[store] = new Set();
            tombMap[store].add(String(id));
        });
    } catch (e) {
        authLog('warn', '삭제 기록 읽기 실패: ' + e.message);
    }

    let uploadCount = 0, downloadCount = 0;

    for (const store of SYNC_STORES) {
        try {
            const deleted = tombMap[store] || new Set();

            // 로컬 데이터 읽기
            const localItems = await dbGetAll(store);
            const localMap = {};
            localItems.forEach(i => { localMap[String(i.id)] = i; });

            // 로컬에 남아있는 삭제 기록 항목 정리 (다른 기기에서 지운 것)
            for (const id of deleted) {
                if (localMap[id]) {
                    const req = db.transaction(store, 'readwrite').objectStore(store).delete(id);
                    await new Promise((res, rej) => { req.onsuccess = res; req.onerror = () => rej(req.error); });
                    delete localMap[id];
                }
            }

            // Firestore 데이터 읽기
            const snap = await colRef(store).get();
            const remoteMap = {};
            snap.forEach(doc => { remoteMap[doc.id] = doc.data(); });

            // 로컬 → Firestore (삭제된 항목 제외, 로컬이 더 새롭거나 클라우드에 없는 항목)
            for (const [id, local] of Object.entries(localMap)) {
                if (deleted.has(id)) continue;
                const remote = remoteMap[id];
                if (!remote || (local.updatedAt || 0) >= (remote.updatedAt || 0)) {
                    const obj = { ...stripBinary(store, local), updatedAt: local.updatedAt || Date.now() };
                    await colRef(store).doc(id).set(obj);
                    uploadCount++;
                    // PDF·파일도 Storage에 올리기
                    if (store === 'papers'    && local.pdfData)  cloudPutFile('papers',    id, local.pdfData,  local.pdfFilename);
                    if (store === 'materials' && local.fileData) cloudPutFile('materials', id, local.fileData, local.fileName);
                }
            }

            // Firestore → 로컬 (삭제된 항목 제외, 클라우드에만 있거나 클라우드가 더 새로운 항목)
            for (const [id, remote] of Object.entries(remoteMap)) {
                if (deleted.has(id)) continue;
                const local = localMap[id];
                if (!local || (remote.updatedAt || 0) > (local.updatedAt || 0)) {
                    // pdfData/fileData 없음(클라우드엔 저장 안 함) — PDF는 열 때 lazy 다운로드
                    const tx = db.transaction(store, 'readwrite').objectStore(store).put(remote);
                    await new Promise((res, rej) => { tx.onsuccess = res; tx.onerror = () => rej(tx.error); });
                    downloadCount++;
                }
            }
        } catch (e) {
            authLog('error', `동기화 실패 (${store}): ${e.message}`);
        }
    }

    _syncBusy = false;
    authLog('info', `동기화 완료: ↑${uploadCount} ↓${downloadCount}`);

    // 동기화 도중 로그아웃됐으면 화면 갱신 없이 종료 (잠금화면 유지)
    if (!currentUser) return;

    renderAuthBox();

    // 로그인 직후엔 잠금화면이 떠 있을 수 있으므로 항상 내용으로 새로 그린다.
    if (typeof loadData === 'function') await loadData();
    if (!currentUser) return;   // loadData 기다리는 사이에 로그아웃된 경우
    if (typeof renderContent === 'function') renderContent();

    showToast(downloadCount > 0 ? `동기화 완료! (받아온 항목 ${downloadCount}개)` : '클라우드에 저장 완료!', 'success');
}

// ════════════════════════════════════════════════════════════════════════
//  dbPut / dbDelete 후킹 — 저장·삭제 시 클라우드도 자동 반영
// ════════════════════════════════════════════════════════════════════════

function patchDbFunctions() {
    const _origPut    = window.dbPut;
    const _origDelete = window.dbDelete;

    window.dbPut = async function(store, item) {
        // 로그인 중이면 updatedAt 타임스탬프 추가
        const stored = (currentUser && !_syncBusy) ? { ...item, updatedAt: Date.now() } : item;
        const result = await _origPut(store, stored);
        if (currentUser && !_syncBusy) cloudPut(store, stored);
        return result;
    };

    window.dbDelete = async function(store, id) {
        const result = await _origDelete(store, id);
        if (currentUser && !_syncBusy) cloudDelete(store, id);
        return result;
    };
}

// DOM 준비됨(스크립트가 body 끝) → 바로 초기화
initAuth();
