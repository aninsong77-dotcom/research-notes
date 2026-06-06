// ── Firebase 로그인 (compat SDK, 빌드 없이 CDN) ──────────────────
// app.js 전역(icon, escHtml, showToast, pushDebug)을 호출 시점에 사용. index.html에서 app.js 다음에 로드.
const firebaseConfig = {
    apiKey: "AIzaSyA8Cz0ZT9_jQZXWen2n2qkx-K8yZz0AyVM",
    authDomain: "blue-study-note.firebaseapp.com",
    projectId: "blue-study-note",
    storageBucket: "blue-study-note.firebasestorage.app",
    messagingSenderId: "582073428497",
    appId: "1:582073428497:web:71cfc4735c6887eb3f5fb0"
};

let fbAuth = null;
let currentUser = null;

function authLog(level, msg) {
    if (typeof pushDebug === 'function') pushDebug(level, msg);
    else if (level === 'error') console.error(msg);
}

function initAuth() {
    const box = document.getElementById('auth-box');
    // 인터넷이 없거나 CDN 차단 시 firebase 전역이 없음 → 로그인만 비활성, 앱은 정상 동작
    if (typeof firebase === 'undefined' || !firebase.initializeApp) {
        if (box) box.innerHTML = `<div class="auth-offline">${icon('cloud-off', 14)} 오프라인 — 로그인은 인터넷 연결 시</div>`;
        return;
    }
    try {
        firebase.initializeApp(firebaseConfig);
        fbAuth = firebase.auth();
        fbAuth.onAuthStateChanged(user => {
            currentUser = user;
            renderAuthBox();
        });
    } catch (e) {
        authLog('error', 'Firebase 초기화 실패: ' + (e.message || e));
        if (box) box.innerHTML = `<div class="auth-offline">로그인 사용 불가</div>`;
    }
}

// 로그인 상태에 따라 사이드바 하단 영역 토글
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

// 흔한 Firebase 오류를 한국어로
function authErrMsg(err) {
    const c = (err && err.code) || '';
    if (c.includes('invalid-email')) return '이메일 형식이 올바르지 않아요';
    if (c.includes('weak-password') || c.includes('missing-password')) return '비밀번호는 6자 이상이어야 해요';
    if (c.includes('email-already-in-use')) return '이미 가입된 이메일이에요 — 로그인해 보세요';
    if (c.includes('user-not-found')) return '가입되지 않은 이메일이에요 — 먼저 회원가입하세요';
    if (c.includes('wrong-password') || c.includes('invalid-credential')) return '이메일 또는 비밀번호가 틀렸어요';
    if (c.includes('too-many-requests')) return '시도가 너무 많아요 — 잠시 후 다시';
    if (c.includes('network')) return '인터넷 연결을 확인하세요';
    return '실패: ' + ((err && err.message) || c || '알 수 없는 오류');
}

function openAuthModal() {
    if (!fbAuth) { showToast('로그인 준비가 안 됐어요 (인터넷 확인)', 'error'); return; }
    if (document.querySelector('.auth-overlay')) return;

    let mode = 'login';          // 'login' | 'signup'
    let emailVal = '';
    const overlay = document.createElement('div');
    overlay.className = 'auth-overlay';
    document.body.appendChild(overlay);

    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    const submit = () => {
        const email = overlay.querySelector('#auth-email-in').value.trim();
        const pw = overlay.querySelector('#auth-pw-in').value;
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

// DOM 준비됨(스크립트가 body 끝) → 바로 초기화
initAuth();
