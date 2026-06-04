'use strict';
// ── mindmap.js — 연구모형 마인드맵 에디터 ─────────────────────────────

const MM_STORE = 'mindmaps';

const EDGE_STYLES = {
    '정적영향(+)': { color: '#4285f4', dash: '',      marker: 'marr-blue'   },
    '부적영향(-)': { color: '#d93025', dash: '7 4',   marker: 'marr-red'    },
    '매개':        { color: '#e37400', dash: '12 5',  marker: 'marr-orange' },
    '조절':        { color: '#7b2d8b', dash: '3 4',   marker: 'marr-purple' },
};

// ── 노드 타입 3종 ─────────────────────────────────────────────────────
// variable : 관측변인 (사각형) — 측정된 변인, 설문 문항 등
// latent   : 잠재변인 (타원)  — 잠재적 구성개념 (구조방정식 사용)
// idea     : 메모    (둥근 카드) — 아이디어, 코멘트
const NODE_CFG = {
    variable: { shape:'rect',    fill:'#eaf1ff', stroke:'#4285f4', textColor:'#1a56c4', rx:6,  label:'관측변인', w:152, h:50 },
    latent:   { shape:'ellipse', fill:'#fff3e0', stroke:'#e37400', textColor:'#b46000', label:'잠재변인', w:164, h:64 },
    idea:     { shape:'rect',    fill:'#f1f3f4', stroke:'#9aa0a6', textColor:'#5f6368', rx:12, label:'메모',     w:152, h:50 },
};

// 학술용 보기: 도형은 그대로 두고 색만 흑백(흰 채움·회색 테두리·진회색 글씨)으로,
// 화살표는 가는 회색으로 덮어쓴다. 작업용(기본)은 위 컬러 그대로.
const ACADEMIC_NODE = { fill:'#ffffff', stroke:'#8a8f99', textColor:'#2b2b2b' };
const ACADEMIC_EDGE = { color:'#555555', marker:'marr-gray', dash:'' };

// ── 묶기 도형(그룹) 색상 팔레트 ──────────────────────────────────────
// 변인들을 감싸는 큰 원/박스. 노드 뒤에 깔리고 크기 조절·이동 가능.
const GROUP_COLORS = ['#4285f4', '#34a853', '#a142f4', '#e37400', '#d93025'];

const NS = 'http://www.w3.org/2000/svg';
let S = null;

// ── SVG 요소 생성 헬퍼 ────────────────────────────────────────────────
function el(tag, attrs, text) {
    const e = document.createElementNS(NS, tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    if (text !== undefined) e.textContent = text;
    return e;
}

function nodeSize(node) {
    const cfg = NODE_CFG[node.type] || NODE_CFG.variable;
    return { w: cfg.w, h: cfg.h };
}

// ── 마커 (화살촉) 생성 ────────────────────────────────────────────────
function mkMarkers() {
    const colored = Object.entries(EDGE_STYLES).map(([, s]) => `
        <marker id="${s.marker}" markerWidth="9" markerHeight="6"
                refX="8" refY="3" orient="auto">
            <polygon points="0 0,9 3,0 6" fill="${s.color}"/>
        </marker>`).join('');
    // 학술용 회색 화살촉
    const gray = `
        <marker id="${ACADEMIC_EDGE.marker}" markerWidth="9" markerHeight="6"
                refX="8" refY="3" orient="auto">
            <polygon points="0 0,9 3,0 6" fill="${ACADEMIC_EDGE.color}"/>
        </marker>`;
    return colored + gray;
}

// 현재 보기 모드('work'|'academic'). mmUI는 mmInitProp에서 settings로부터 로드.
function mmStyleMode() {
    return (typeof mmUI !== 'undefined' && mmUI.styleMode === 'academic') ? 'academic' : 'work';
}

// ── 진입점 ───────────────────────────────────────────────────────────
async function initMindmap(container, projectId) {
    container.innerHTML = `
        <div class="mm-wrap">
            <div class="mm-toolbar">
                <span class="mm-tb-label">도형 추가</span>
                <button class="mm-btn mm-btn-var" id="mm-add-var" title="관측변인 — 설문/측정된 변인 (사각형)">
                    <svg width="14" height="12" viewBox="0 0 14 12" fill="none">
                        <rect x="1" y="1" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.8"/>
                    </svg>
                    관측변인
                </button>
                <button class="mm-btn mm-btn-latent" id="mm-add-latent" title="잠재변인 — 구성개념/잠재요인 (타원)">
                    <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
                        <ellipse cx="8" cy="6" rx="7" ry="5" stroke="currentColor" stroke-width="1.8"/>
                    </svg>
                    잠재변인
                </button>
                <button class="mm-btn mm-btn-memo" id="mm-add-idea" title="메모 — 아이디어, 코멘트 (둥근 카드)">
                    <svg width="14" height="12" viewBox="0 0 14 12" fill="none">
                        <rect x="1" y="1" width="12" height="10" rx="5" stroke="currentColor" stroke-width="1.8"/>
                        <line x1="4" y1="4.5" x2="10" y2="4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                        <line x1="4" y1="7.5" x2="8" y2="7.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                    </svg>
                    메모
                </button>
                <div class="mm-sep"></div>
                <span class="mm-tb-label">묶기</span>
                <button class="mm-btn mm-btn-group" id="mm-add-group-ellipse" title="변인들을 감싸는 큰 원 — 크기 조절 가능">
                    <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
                        <ellipse cx="8" cy="6" rx="7" ry="5" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2"/>
                    </svg>
                    큰 원
                </button>
                <button class="mm-btn mm-btn-group" id="mm-add-group-rect" title="변인들을 감싸는 큰 박스 — 크기 조절 가능">
                    <svg width="14" height="12" viewBox="0 0 14 12" fill="none">
                        <rect x="1" y="1" width="12" height="10" rx="3" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2"/>
                    </svg>
                    큰 박스
                </button>
                <div class="mm-sep"></div>
                <button class="mm-btn mm-btn-tags" id="mm-vars-toggle" title="논문에 등록한 변인을 도형으로 가져오기">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                    변인 태그
                </button>
                <div class="mm-sep"></div>
                <button class="mm-btn mm-icon-btn" id="mm-undo" title="되돌리기 (Ctrl+Z)">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.75"/></svg>
                </button>
                <button class="mm-btn mm-icon-btn" id="mm-redo" title="다시 (Ctrl+Y)">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.49-3.75"/></svg>
                </button>
                <div class="mm-sep"></div>
                <button class="mm-btn" id="mm-save-snap">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                    모형 저장
                </button>
                <select class="mm-select" id="mm-snap-list">
                    <option value="">── 저장된 모형 불러오기 ──</option>
                </select>
                <div class="mm-sep"></div>
                <button class="mm-btn mm-btn-style" id="mm-style-toggle" title="보기 전환 — 작업용(컬러) ↔ 학술용(흑백 타원·회색선, 제출·발표용)">🎨 작업용</button>
                <div class="mm-sep"></div>
                <button class="mm-btn mm-btn-export" id="mm-export-png">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    PNG 내보내기
                </button>
                <div class="mm-sep"></div>
                <button class="mm-btn mm-btn-prop" id="mm-prop-toggle" title="미니 프로포절 — 연구 필요성·목적·방법·대상·가설을 옆에 정리">
                    📝 프로포절
                </button>
                <div class="mm-hint-text" id="mm-hint"></div>
            </div>
            <div class="mm-body" id="mm-body">
                <div class="mm-canvas-wrap" id="mm-cwrap">
                    <svg id="mm-svg" xmlns="${NS}">
                        <defs>${mkMarkers()}</defs>
                        <rect id="mm-bg" fill="#f8fafd"/>
                        <g id="mm-world">
                            <g id="mm-groups"></g>
                            <g id="mm-edges"></g>
                            <g id="mm-nodes"></g>
                        </g>
                    </svg>
                    <div class="mm-title-bar" id="mm-title-bar">
                        <div class="mm-title" id="mm-title" contenteditable="true" spellcheck="false"
                             data-placeholder="연구모형 제목 — 클릭해서 입력"></div>
                        <div class="mm-subtitle" id="mm-subtitle" contenteditable="true" spellcheck="false"
                             data-placeholder="부제 (선택)"></div>
                    </div>
                    <div id="mm-var-panel" class="mm-var-panel" style="display:none"></div>
                    <div id="mm-rel-popup" class="mm-rel-popup" style="display:none"></div>
                    <input id="mm-edit-input" class="mm-edit-input" style="display:none"/>
                </div>
                <div class="mm-prop-resizer" id="mm-prop-resizer" style="display:none"></div>
                <aside class="mm-prop-panel" id="mm-prop-panel" style="display:none"></aside>
            </div>
        </div>`;

    S = {
        nodes: [], edges: [], groups: [], snapshots: [],
        history: [], historyIdx: -1,
        sel: null,
        mode: 'idle',
        placingType: null,
        placingGroupShape: null,
        resizing: null,
        connectFrom: null,
        pan: { x: 60, y: 60 }, zoom: 1,
        projectId,
        svg:    container.querySelector('#mm-svg'),
        world:  container.querySelector('#mm-world'),
        groupsG: container.querySelector('#mm-groups'),
        edgesG: container.querySelector('#mm-edges'),
        nodesG: container.querySelector('#mm-nodes'),
        cwrap:  container.querySelector('#mm-cwrap'),
        dragging: null,
        panning:  null,
        editingId: null,
        lastClick: null,
        varAddType: 'variable',   // 변인 태그 패널에서 추가할 도형 종류
    };

    await mmLoad();
    saveHistory();
    mmBind();
    mmRender();
    mmUpdateSnapList();
    mmHint('도형 추가 → 드래그 이동 → 우클릭으로 화살표 연결 → 더블클릭으로 이름 입력 → 화살표 클릭으로 수정·삭제');
    resizeBg();
    await mmInitProp();
}

// ── 렌더링 ───────────────────────────────────────────────────────────
function mmRender() {
    S.groupsG.innerHTML = '';
    S.edgesG.innerHTML = '';
    S.nodesG.innerHTML = '';
    S.world.setAttribute('transform',
        `translate(${S.pan.x},${S.pan.y}) scale(${S.zoom})`);
    S.groups.forEach(renderGroup);
    S.edges.forEach(renderEdge);
    S.nodes.forEach(renderNode);
    mmSyncVarPanel();
}

// ── 묶기 도형(그룹) 렌더 ──────────────────────────────────────────────
// 채움은 클릭이 통과(안의 노드를 그대로 조작) / 라벨 탭·테두리로 선택·이동 / 핸들로 크기조절
function renderGroup(group) {
    const isSel = S.sel?.type === 'group' && S.sel.id === group.id;
    const { x, y, w, h } = group;
    const color = group.color || '#4285f4';
    const g = el('g', { 'data-gid': group.id, class: 'mm-gg' });

    const fillAttrs = { fill: color, 'fill-opacity': 0.08, 'pointer-events': 'none' };
    const lineAttrs = {
        fill: 'none', stroke: color, 'stroke-width': isSel ? 2.8 : 2,
        'stroke-dasharray': '9 6', 'pointer-events': 'stroke', cursor: 'move',
    };
    if (group.shape === 'ellipse') {
        const e = { cx: x + w/2, cy: y + h/2, rx: w/2, ry: h/2 };
        g.appendChild(el('ellipse', { ...e, ...fillAttrs }));
        g.appendChild(el('ellipse', { ...e, ...lineAttrs }));
    } else {
        const r = { x, y, width: w, height: h, rx: 18 };
        g.appendChild(el('rect', { ...r, ...fillAttrs }));
        g.appendChild(el('rect', { ...r, ...lineAttrs }));
    }

    // 라벨 탭(좌상단) — 클릭/드래그로 선택·이동, 빠른 두 번 클릭으로 이름 변경
    const labelText = group.text || '묶음';
    const tabW = Math.min(Math.max(labelText.length * 13 + 24, 56), Math.max(w, 56));
    const tab = el('g', { class: 'mm-gg-tab', cursor: 'move' });
    tab.appendChild(el('rect', {
        x, y: y - 25, width: tabW, height: 24, rx: 8,
        fill: color, 'fill-opacity': isSel ? 1 : 0.88,
    }));
    tab.appendChild(el('text', {
        x: x + tabW/2, y: y - 12,
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        fill: '#fff', 'font-size': '12', 'font-weight': '700',
        'font-family': "'Noto Sans KR', sans-serif", 'pointer-events': 'none',
    }, labelText));
    g.appendChild(tab);

    // 선택 시 우하단 크기조절 핸들
    if (isSel) {
        const hs = 16;
        g.appendChild(el('rect', {
            x: x + w - hs/2, y: y + h - hs/2, width: hs, height: hs, rx: 3,
            fill: '#fff', stroke: color, 'stroke-width': 2.4,
            cursor: 'nwse-resize', 'data-role': 'resize',
        }));
    }

    S.groupsG.appendChild(g);
}

function renderNode(node) {
    const baseCfg = NODE_CFG[node.type] || NODE_CFG.variable;
    // 학술 모드: 도형(shape/rx/w/h)은 유지하고 색만 흑백으로 덮어씀
    const cfg = mmStyleMode() === 'academic'
        ? { ...baseCfg, fill: ACADEMIC_NODE.fill, stroke: ACADEMIC_NODE.stroke, textColor: ACADEMIC_NODE.textColor }
        : baseCfg;
    const { w, h } = nodeSize(node);
    const isSel  = S.sel?.type === 'node' && S.sel.id === node.id;
    const isConn = S.connectFrom === node.id;

    const g = el('g', {
        transform: `translate(${node.x},${node.y})`,
        cursor: 'pointer',
        'data-nid': node.id,
        class: 'mm-ng',
    });

    // 선택 glow
    if (isSel || isConn) {
        if (cfg.shape === 'ellipse') {
            g.appendChild(el('ellipse', {
                cx: w/2, cy: h/2, rx: w/2 + 6, ry: h/2 + 6,
                fill: 'none',
                stroke: isConn ? '#e37400' : '#4285f4',
                'stroke-width': 2.5, opacity: 0.4,
            }));
        } else {
            g.appendChild(el('rect', {
                x: -6, y: -6, width: w + 12, height: h + 12,
                rx: (cfg.rx || 6) + 6,
                fill: 'none',
                stroke: isConn ? '#e37400' : '#4285f4',
                'stroke-width': 2.5, opacity: 0.4,
            }));
        }
    }

    // 노드 도형
    if (cfg.shape === 'ellipse') {
        g.appendChild(el('ellipse', {
            cx: w/2, cy: h/2, rx: w/2, ry: h/2,
            fill: cfg.fill,
            stroke: isSel ? '#4285f4' : cfg.stroke,
            'stroke-width': isSel ? 2.5 : 1.8,
        }));
    } else {
        g.appendChild(el('rect', {
            x: 0, y: 0, width: w, height: h,
            rx: cfg.rx,
            fill: cfg.fill,
            stroke: isSel ? '#4285f4' : cfg.stroke,
            'stroke-width': isSel ? 2.5 : 1.8,
        }));
    }

    // 타입 레이블 (작은 글씨, 왼쪽 상단) — 학술 모드에선 깔끔하게 숨김
    if (mmStyleMode() !== 'academic') {
        const labelX = cfg.shape === 'ellipse' ? w * 0.22 : 10;
        const labelY = cfg.shape === 'ellipse' ? h * 0.28 : 13;
        g.appendChild(el('text', {
            x: labelX, y: labelY,
            fill: cfg.textColor,
            'font-size': '9',
            'font-family': "'Noto Sans KR', sans-serif",
            opacity: '0.5',
            'pointer-events': 'none',
        }, cfg.label));
    }

    // 변인명 텍스트 (중앙)
    const display = node.text || '';
    const placeholder = !node.text;
    g.appendChild(el('text', {
        x: w / 2, y: cfg.shape === 'ellipse' ? h / 2 + 6 : h / 2 + 5,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        fill: placeholder ? '#aaa' : cfg.textColor,
        'font-size': '13.5',
        'font-family': "'Noto Sans KR', sans-serif",
        'font-weight': '600',
        'pointer-events': 'none',
    }, placeholder ? '더블클릭하여 입력' : display));

    S.nodesG.appendChild(g);
}

function renderEdge(edge) {
    const from = S.nodes.find(n => n.id === edge.from);
    const to   = S.nodes.find(n => n.id === edge.to);
    if (!from || !to) return;

    const academic = mmStyleMode() === 'academic';
    const style = academic ? ACADEMIC_EDGE : EDGE_STYLES[edge.label];
    const isSel = S.sel?.type === 'edge' && S.sel.id === edge.id;
    const { sx, sy, ex, ey, axis } = endpoints(from, to);
    const mx = (sx + ex) / 2;
    const my = (sy + ey) / 2;
    // 기본은 부드러운 곡선(기존 동작). edge.straight면 직선.
    // 곡선은 연결 방향(axis)에 맞춰 끝점으로 들어와야 화살촉이 옳은 쪽을 가리킴.
    //  - 가로 연결: 제어점을 가로 중점(mx)에 → 좌/우로 들어옴
    //  - 세로 연결: 제어점을 세로 중점(my)에 → 위/아래로 들어옴
    const d = edge.straight
        ? `M ${sx} ${sy} L ${ex} ${ey}`
        : (axis === 'v'
            ? `M ${sx} ${sy} C ${sx} ${my}, ${ex} ${my}, ${ex} ${ey}`
            : `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ey}, ${ex} ${ey}`);

    const g = el('g', { 'data-eid': edge.id, class: 'mm-eg' });

    // 히트 영역
    g.appendChild(el('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': '14', cursor: 'pointer' }));

    // 실제 선
    g.appendChild(el('path', {
        d, fill: 'none',
        stroke: isSel ? '#333' : style.color,
        'stroke-width': isSel ? 3 : (academic ? 1.6 : 2.2),
        'stroke-dasharray': style.dash,
        'marker-end': `url(#${style.marker})`,
    }));

    // 레이블 — 가설이 연결돼 있으면 그 번호(H1)를 붉게, 아니면 관계 라벨
    const hypoNum    = edgeHypoNum(edge);
    const labelText  = hypoNum ? ('H' + hypoNum) : edge.label;
    const labelColor = hypoNum ? '#b03a3a' : style.color;
    const bw = hypoNum ? 30 : 68;
    const lx = sx + (ex - sx) * 0.5;
    const ly = sy + (ey - sy) * 0.5 - 13;
    g.appendChild(el('rect', {
        x: lx - bw / 2, y: ly - 10, width: bw, height: 19,
        rx: 9, fill: 'white',
        stroke: labelColor, 'stroke-width': 1, opacity: '0.93',
    }));
    g.appendChild(el('text', {
        x: lx, y: ly + 0.5,
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        fill: labelColor,
        'font-size': '10',
        'font-family': "'Noto Sans KR', sans-serif",
        'font-weight': '700',
        'pointer-events': 'none',
    }, labelText));

    S.edgesG.appendChild(g);
}

// 엣지에 연결된 가설의 1-based 번호(H번호). 연결 없음/삭제됨이면 null.
// 번호는 프로포절 가설 순서로 계산 → 재정렬에도 항상 최신.
function edgeHypoNum(edge) {
    if (!edge.hypoId) return null;
    const hs = (typeof state !== 'undefined' && state.proposal?.hypotheses) || [];
    const i = hs.findIndex(h => h.id === edge.hypoId);
    return i >= 0 ? i + 1 : null;
}

// ── 연결 끝점 계산 ────────────────────────────────────────────────────
function endpoints(from, to) {
    const { w: fw, h: fh } = nodeSize(from);
    const { w: tw, h: th } = nodeSize(to);
    const fx = from.x + fw/2, fy = from.y + fh/2;
    const tx = to.x   + tw/2, ty = to.y   + th/2;
    const dx = tx - fx, dy = ty - fy;
    let sx, sy, ex, ey, axis;
    if (Math.abs(dx) >= Math.abs(dy)) {
        axis = 'h';                                    // 가로 연결(좌↔우)
        sx = dx > 0 ? from.x + fw : from.x; sy = fy;
        ex = dx > 0 ? to.x        : to.x + tw; ey = ty;
    } else {
        axis = 'v';                                    // 세로 연결(위↕아래)
        sx = fx; sy = dy > 0 ? from.y + fh : from.y;
        ex = tx; ey = dy > 0 ? to.y        : to.y + th;
    }
    return { sx, sy, ex, ey, axis };
}

// ── 좌표 변환 ─────────────────────────────────────────────────────────
function toWorld(cx, cy) {
    const r = S.svg.getBoundingClientRect();
    return {
        x: (cx - r.left - S.pan.x) / S.zoom,
        y: (cy - r.top  - S.pan.y) / S.zoom,
    };
}

function nodeAt(wx, wy) {
    for (let i = S.nodes.length - 1; i >= 0; i--) {
        const n = S.nodes[i];
        const { w, h } = nodeSize(n);
        const cfg = NODE_CFG[n.type] || NODE_CFG.variable;
        if (cfg.shape === 'ellipse') {
            // 타원 히트 테스트
            const cx = n.x + w/2, cy = n.y + h/2;
            const dx = (wx - cx) / (w/2), dy = (wy - cy) / (h/2);
            if (dx*dx + dy*dy <= 1) return n;
        } else {
            if (wx >= n.x && wx <= n.x + w && wy >= n.y && wy <= n.y + h) return n;
        }
    }
    return null;
}

// ── 이벤트 ───────────────────────────────────────────────────────────
function mmBind() {
    document.getElementById('mm-add-var').onclick    = () => startPlacing('variable');
    document.getElementById('mm-add-latent').onclick = () => startPlacing('latent');
    document.getElementById('mm-add-idea').onclick   = () => startPlacing('idea');
    document.getElementById('mm-add-group-ellipse').onclick = () => startPlacingGroup('ellipse');
    document.getElementById('mm-add-group-rect').onclick    = () => startPlacingGroup('rect');
    document.getElementById('mm-undo').onclick       = mmUndo;
    document.getElementById('mm-redo').onclick       = mmRedo;
    document.getElementById('mm-save-snap').onclick  = mmSaveSnap;
    document.getElementById('mm-snap-list').onchange = e => {
        if (e.target.value) mmLoadSnap(e.target.value);
    };
    document.getElementById('mm-export-png').onclick = mmExport;
    document.getElementById('mm-vars-toggle').onclick = mmToggleVarPanel;
    document.getElementById('mm-prop-toggle').onclick = mmToggleProp;
    document.getElementById('mm-style-toggle').onclick = mmToggleStyle;

    const svg = S.svg;
    svg.addEventListener('mousedown',   onDown);
    svg.addEventListener('mousemove',   onMove);
    svg.addEventListener('mouseup',     onUp);
    svg.addEventListener('mouseleave',  onUp);
    svg.addEventListener('contextmenu', onRight);
    svg.addEventListener('dblclick',    onDbl);
    svg.addEventListener('wheel',       onWheel, { passive: false });

    const inp = document.getElementById('mm-edit-input');
    inp.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { e.preventDefault(); finishEdit(); }
        if (e.key === 'Escape') cancelEdit();
        e.stopPropagation();
    });
    inp.addEventListener('blur', finishEdit);

    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', e => {
        if (!e.target.closest('#mm-rel-popup')) hidePopup();
    });
    window.addEventListener('resize', resizeBg);
}

function onDown(e) {
    if (e.button !== 0) return;
    const ng = e.target.closest('.mm-ng');
    const { x: wx, y: wy } = toWorld(e.clientX, e.clientY);

    if (S.mode === 'placing') {
        saveHistory();
        const { w, h } = nodeSize({ type: S.placingType });
        const node = { id: genId(), type: S.placingType, x: wx - w/2, y: wy - h/2, text: '' };
        S.nodes.push(node);
        S.mode = 'idle'; S.placingType = null;
        S.svg.style.cursor = '';
        mmHint('더블클릭으로 이름 입력 | 우클릭으로 화살표 연결');
        mmRender(); mmSaveToDB();
        setTimeout(() => startEdit(node.id), 30);
        e.stopPropagation(); return;
    }

    if (S.mode === 'placing-group') {
        saveHistory();
        const shape = S.placingGroupShape;
        const dw = 280, dh = 190;
        const color = GROUP_COLORS[S.groups.length % GROUP_COLORS.length];
        const group = { id: genId(), shape, x: wx - dw/2, y: wy - dh/2, w: dw, h: dh, text: '', color };
        S.groups.push(group);
        S.mode = 'idle'; S.placingGroupShape = null; S.svg.style.cursor = '';
        S.sel = { type: 'group', id: group.id };
        mmHint('라벨을 드래그해 이동 | 모서리 핸들로 크기 조절 | 빠른 두 번 클릭으로 이름 입력');
        mmRender(); mmSaveToDB();
        e.stopPropagation(); return;
    }

    if (S.mode === 'connecting' && ng) {
        const tid = ng.dataset.nid;
        if (tid !== S.connectFrom) showPopup(e.clientX, e.clientY, tid);
        else cancelConnect();
        e.stopPropagation(); e.preventDefault(); return;
    }

    if (ng) {
        const nid = ng.dataset.nid;
        const now = Date.now();
        // 같은 도형을 빠르게 두 번 누르면 이름 편집.
        // (선택할 때마다 mmRender로 요소를 다시 그려서 브라우저 dblclick이 안 잡히므로 직접 감지)
        if (S.lastClick && S.lastClick.nid === nid && now - S.lastClick.time < 350) {
            S.lastClick = null;
            e.preventDefault();   // 기본 포커스 이동 차단 → 입력창이 바로 닫히지 않게
            startEdit(nid);
            e.stopPropagation(); return;
        }
        S.lastClick = { nid, time: now };
        const node = S.nodes.find(n => n.id === nid);
        S.sel = { type: 'node', id: nid };
        S.dragging = { nid, ox: wx - node.x, oy: wy - node.y, moved: false };
        mmRender(); e.stopPropagation(); return;
    }

    // 화살표(엣지) 클릭 → 선택 + 관계 변경/삭제 팝업
    const eg = e.target.closest('.mm-eg');
    if (eg) {
        const eid = eg.dataset.eid;
        S.sel = { type: 'edge', id: eid };
        mmRender();
        const edge = S.edges.find(ed => ed.id === eid);
        if (edge) showEdgePopup(edge, e.clientX, e.clientY);
        e.stopPropagation(); return;
    }

    // 묶기 도형(그룹) — 라벨/테두리 클릭으로 선택·이동, 핸들로 크기조절, 빠른 두 번으로 이름
    const gg = e.target.closest('.mm-gg');
    if (gg) {
        const gid = gg.dataset.gid;
        const group = S.groups.find(gr => gr.id === gid);
        if (!group) return;
        S.sel = { type: 'group', id: gid };

        if (e.target.dataset.role === 'resize') {
            saveHistory();
            S.resizing = { gid, sw: group.w, sh: group.h, mx: wx, my: wy };
            mmRender(); e.stopPropagation(); return;
        }
        const now = Date.now();
        if (S.lastClick && S.lastClick.gid === gid && now - S.lastClick.time < 350) {
            S.lastClick = null;
            const name = prompt('묶음 이름:', group.text || '');
            if (name !== null) { saveHistory(); group.text = name.trim(); mmSaveToDB(); }
            mmRender(); e.stopPropagation(); return;
        }
        S.lastClick = { gid, time: now };
        S.dragging = { kind: 'group', gid, ox: wx - group.x, oy: wy - group.y, moved: false };
        mmRender(); e.stopPropagation(); return;
    }

    S.panning = { sx: e.clientX, sy: e.clientY, px: S.pan.x, py: S.pan.y };
    if (S.mode !== 'connecting') { S.sel = null; mmRender(); }
}

function onMove(e) {
    if (S.resizing) {
        const { x: wx, y: wy } = toWorld(e.clientX, e.clientY);
        const group = S.groups.find(g => g.id === S.resizing.gid);
        if (group) {
            group.w = Math.max(80, S.resizing.sw + (wx - S.resizing.mx));
            group.h = Math.max(60, S.resizing.sh + (wy - S.resizing.my));
            mmRender();
        }
        return;
    }
    if (S.dragging) {
        const { x: wx, y: wy } = toWorld(e.clientX, e.clientY);
        if (S.dragging.kind === 'group') {
            const group = S.groups.find(g => g.id === S.dragging.gid);
            if (group) {
                if (!S.dragging.moved) { saveHistory(); S.dragging.moved = true; }
                group.x = wx - S.dragging.ox; group.y = wy - S.dragging.oy; mmRender();
            }
        } else {
            const node = S.nodes.find(n => n.id === S.dragging.nid);
            if (node) {
                if (!S.dragging.moved) { saveHistory(); S.dragging.moved = true; }
                node.x = wx - S.dragging.ox; node.y = wy - S.dragging.oy; mmRender();
            }
        }
    } else if (S.panning) {
        S.pan.x = S.panning.px + (e.clientX - S.panning.sx);
        S.pan.y = S.panning.py + (e.clientY - S.panning.sy);
        S.world.setAttribute('transform', `translate(${S.pan.x},${S.pan.y}) scale(${S.zoom})`);
    }
}

function onUp() {
    if (S.resizing) { mmSaveToDB(); S.resizing = null; }
    if (S.dragging) { if (S.dragging.moved) mmSaveToDB(); S.dragging = null; }
    if (S.panning)  S.panning = null;
}

function onRight(e) {
    e.preventDefault();
    const ng = e.target.closest('.mm-ng');
    if (!ng) return;
    const nid = ng.dataset.nid;
    S.sel = { type: 'node', id: nid };
    S.mode = 'connecting'; S.connectFrom = nid;
    mmRender();
    mmHint('연결할 대상 도형을 클릭하세요 (Esc 취소)');
}

function onDbl(e) {
    const ng = e.target.closest('.mm-ng');
    if (ng) { startEdit(ng.dataset.nid); e.stopPropagation(); }
}

function onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.9;
    const r  = S.svg.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    S.pan.x  = cx - factor * (cx - S.pan.x);
    S.pan.y  = cy - factor * (cy - S.pan.y);
    S.zoom   = Math.min(3, Math.max(0.15, S.zoom * factor));
    S.world.setAttribute('transform', `translate(${S.pan.x},${S.pan.y}) scale(${S.zoom})`);
}

function onKey(e) {
    if (!S) return;
    // 텍스트 입력 중(제목·부제 contenteditable, 프로포절·이름 편집 input/textarea)에는
    // 캔버스 단축키(Delete·Ctrl+Z 등)를 무시 — 네이티브 텍스트 편집을 우선한다.
    if (document.activeElement?.isContentEditable) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Delete' || e.key === 'Backspace') mmDelete();
    if ((e.ctrlKey||e.metaKey) && e.key==='z' && !e.shiftKey) { e.preventDefault(); mmUndo(); }
    if ((e.ctrlKey||e.metaKey) && (e.key==='y'||(e.key==='z'&&e.shiftKey))) { e.preventDefault(); mmRedo(); }
    if (e.key === 'Escape') {
        if (S.mode==='placing' || S.mode==='placing-group') {
            S.mode='idle'; S.placingType=null; S.placingGroupShape=null; S.svg.style.cursor=''; mmHint('');
        }
        if (S.mode==='connecting') cancelConnect();
        hidePopup(); cancelEdit();
    }
}

// ── 텍스트 편집 ───────────────────────────────────────────────────────
function startEdit(nid) {
    const node = S.nodes.find(n => n.id === nid);
    if (!node) return;
    const { w, h } = nodeSize(node);
    S.editingId = nid;

    const svgR  = S.svg.getBoundingClientRect();
    const wrapR = S.cwrap.getBoundingClientRect();
    const sx    = svgR.left + node.x * S.zoom + S.pan.x;
    const sy    = svgR.top  + node.y * S.zoom + S.pan.y;

    const inp = document.getElementById('mm-edit-input');
    inp.value = node.text;
    inp.style.cssText = `
        display: block;
        left:   ${sx - wrapR.left}px;
        top:    ${sy - wrapR.top}px;
        width:  ${w * S.zoom}px;
        height: ${h * S.zoom}px;
        font-size: ${Math.round(13.5 * S.zoom)}px;
        border-radius: ${node.type === 'latent' ? '50%' : (NODE_CFG[node.type]?.rx || 6) + 'px'};
    `;
    inp.focus(); inp.select();
}

function finishEdit() {
    const inp = document.getElementById('mm-edit-input');
    if (!S?.editingId) return;
    const node = S.nodes.find(n => n.id === S.editingId);
    if (node) { node.text = inp.value.trim(); mmSaveToDB(); }
    inp.style.display = 'none';
    S.editingId = null;
    mmRender();
}

function cancelEdit() {
    if (!S) return;
    const inp = document.getElementById('mm-edit-input');
    if (inp) inp.style.display = 'none';
    S.editingId = null;
    mmRender();
}

// ── 관계 팝업 ─────────────────────────────────────────────────────────
function showPopup(cx, cy, targetId) {
    const popup = document.getElementById('mm-rel-popup');
    const wrapR = S.cwrap.getBoundingClientRect();

    popup.innerHTML = `
        <div class="mm-pop-title">화살표 관계 선택</div>
        ${Object.keys(EDGE_STYLES).map(l => `
            <div class="mm-pop-item" data-rel="${l}" style="--rc:${EDGE_STYLES[l].color}">
                <span class="mm-pop-dot"></span>${l}
            </div>`).join('')}
        <div class="mm-pop-divider"></div>
        <div class="mm-pop-item mm-pop-cancel" data-rel="">✕ 취소</div>`;

    popup.style.cssText = `display:block; left:${cx - wrapR.left + 12}px; top:${cy - wrapR.top + 12}px;`;

    requestAnimationFrame(() => {
        const pr = popup.getBoundingClientRect();
        const wr = S.cwrap.getBoundingClientRect();
        if (pr.right  > wr.right)  popup.style.left = (cx - wrapR.left - pr.width  - 12) + 'px';
        if (pr.bottom > wr.bottom) popup.style.top  = (cy - wrapR.top  - pr.height - 12) + 'px';
    });

    popup.querySelectorAll('.mm-pop-item').forEach(item => {
        item.addEventListener('mousedown', e => {
            e.stopPropagation(); hidePopup();
            const rel = item.dataset.rel;
            if (rel) {
                const dup = S.edges.find(ed => ed.from === S.connectFrom && ed.to === targetId);
                if (!dup) {
                    saveHistory();
                    S.edges.push({ id: genId(), from: S.connectFrom, to: targetId, label: rel });
                    mmSaveToDB();
                } else showToast('이미 연결된 도형입니다', 'error');
            }
            cancelConnect();
        });
    });
}

function hidePopup() {
    const p = document.getElementById('mm-rel-popup');
    if (p) p.style.display = 'none';
}

// ── 화살표(엣지) 선택 팝업 — 관계 변경 / 삭제 ────────────────────────────
function showEdgePopup(edge, cx, cy) {
    const popup = document.getElementById('mm-rel-popup');
    const wrapR = S.cwrap.getBoundingClientRect();

    const hypos = (typeof state !== 'undefined' && state.proposal?.hypotheses) || [];
    const hypoSection = `
        <div class="mm-pop-divider"></div>
        <div class="mm-pop-title">가설 연결</div>
        ${hypos.length ? hypos.map((h, i) => `
            <div class="mm-pop-item mm-pop-hypo ${edge.hypoId === h.id ? 'mm-pop-active' : ''}" data-hypo="${h.id}">
                <span class="mm-pop-htag">H${i + 1}</span>${escHtml((h.text || '').slice(0, 16) || '(내용 없음)')}${edge.hypoId === h.id ? ' ✓' : ''}
            </div>`).join('')
        : `<div class="mm-pop-hint">📝 프로포절에서 가설을 먼저 추가하세요</div>`}
        ${edge.hypoId ? `<div class="mm-pop-item mm-pop-hypo" data-hypo="">⨯ 가설 연결 해제</div>` : ''}`;

    popup.innerHTML = `
        <div class="mm-pop-title">화살표 관계 변경</div>
        ${Object.keys(EDGE_STYLES).map(l => `
            <div class="mm-pop-item ${l === edge.label ? 'mm-pop-active' : ''}" data-rel="${l}" style="--rc:${EDGE_STYLES[l].color}">
                <span class="mm-pop-dot"></span>${l}${l === edge.label ? ' ✓' : ''}
            </div>`).join('')}
        ${hypoSection}
        <div class="mm-pop-divider"></div>
        <div class="mm-pop-item" data-act="toggle-straight">${edge.straight ? '↝ 곡선으로' : '╱ 직선으로'}</div>
        <div class="mm-pop-item mm-pop-del" data-act="delete">🗑 이 화살표 삭제</div>
        <div class="mm-pop-item mm-pop-cancel" data-act="cancel">✕ 닫기</div>`;

    popup.style.cssText = `display:block; left:${cx - wrapR.left + 12}px; top:${cy - wrapR.top + 12}px;`;

    requestAnimationFrame(() => {
        const pr = popup.getBoundingClientRect();
        const wr = S.cwrap.getBoundingClientRect();
        if (pr.right  > wr.right)  popup.style.left = (cx - wrapR.left - pr.width  - 12) + 'px';
        if (pr.bottom > wr.bottom) popup.style.top  = (cy - wrapR.top  - pr.height - 12) + 'px';
    });

    popup.querySelectorAll('.mm-pop-item').forEach(item => {
        item.addEventListener('mousedown', e => {
            e.stopPropagation();
            hidePopup();
            const act  = item.dataset.act;
            const rel  = item.dataset.rel;
            const hypo = item.dataset.hypo;   // 가설 항목: id 또는 ''(해제). 해당 없으면 undefined
            if (act === 'delete') {
                saveHistory();
                S.edges = S.edges.filter(ed => ed.id !== edge.id);
                S.sel = null;
                mmSaveToDB();
            } else if (rel && rel !== edge.label) {
                saveHistory();
                edge.label = rel;
                mmSaveToDB();
            } else if (hypo !== undefined) {
                saveHistory();
                edge.hypoId = hypo || null;
                mmSaveToDB();
            } else if (act === 'toggle-straight') {
                saveHistory();
                edge.straight = !edge.straight;
                mmSaveToDB();
            }
            mmRender();
        });
    });
}

function cancelConnect() {
    S.mode = 'idle'; S.connectFrom = null;
    mmHint('도형 추가 → 드래그 이동 → 우클릭으로 화살표 연결 → 더블클릭으로 이름 입력 → 화살표 클릭으로 수정·삭제');
    mmRender();
}

function startPlacing(type) {
    S.mode = 'placing'; S.placingType = type;
    S.svg.style.cursor = 'crosshair';
    const names = { variable:'관측변인', latent:'잠재변인', idea:'메모' };
    mmHint(`캔버스에서 ${names[type]} 도형을 놓을 위치를 클릭하세요 (Esc 취소)`);
}

function startPlacingGroup(shape) {
    S.mode = 'placing-group'; S.placingGroupShape = shape;
    S.svg.style.cursor = 'crosshair';
    mmHint(`캔버스를 클릭해 ${shape === 'ellipse' ? '큰 원' : '큰 박스'}을 놓으세요 — 변인들을 그 안에 넣어 묶을 수 있어요 (Esc 취소)`);
}

// ── 변인 태그 패널 ────────────────────────────────────────────────────
// 현재 프로젝트 논문들에 등록된 변인(일반 변인 태그 + 정밀 분석의 역할별 변수)을
// 모아 보여주고, 클릭하면 캔버스에 도형으로 추가한다.
function mmToggleVarPanel() {
    const panel = document.getElementById('mm-var-panel');
    const open = panel.style.display === 'none';
    if (open) { mmRenderVarPanel(); panel.style.display = 'flex'; }
    else      { panel.style.display = 'none'; }
    document.getElementById('mm-vars-toggle').classList.toggle('active', open);
}

function collectProjectVariables() {
    const papers = (typeof state !== 'undefined' ? state.papers : []) || [];
    const order  = [...VAR_ROLES, ['tags', '변인 태그']];
    const groups = {};
    order.forEach(([role]) => groups[role] = new Map()); // 소문자키 → 표시명(중복 제거)

    papers.forEach(p => {
        const av = p.analysis?.variables;
        if (av) VAR_ROLES.forEach(([role]) => {
            (av[role] || []).forEach(v => {
                const name = (v?.name || '').trim();
                if (name) groups[role].set(name.toLowerCase(), name);
            });
        });
        (p.variables || []).forEach(v => {
            const name = (v || '').trim();
            if (name) groups.tags.set(name.toLowerCase(), name);
        });
    });

    return order
        .map(([role, label]) => ({ role, label, names: [...groups[role].values()] }))
        .filter(g => g.names.length);
}

function mmRenderVarPanel() {
    const panel  = document.getElementById('mm-var-panel');
    const groups = collectProjectVariables();
    const used   = new Set(S.nodes.map(n => (n.text || '').trim().toLowerCase()).filter(Boolean));

    const body = !groups.length
        ? `<div class="mm-vp-empty">이 프로젝트 논문에 등록된 변인이 없습니다.<br>논문 추가/수정 화면의 변인 또는 📊 정밀 분석에서 변인을 입력하면 여기에 모입니다.</div>`
        : groups.map(g => `
            <div class="mm-vp-group">
                <div class="mm-vp-group-label">${escHtml(g.label)} <span>${g.names.length}</span></div>
                <div class="mm-vp-chips">
                    ${g.names.map(name => `
                        <button class="mm-vp-chip ${used.has(name.toLowerCase()) ? 'used' : ''}" data-name="${escHtml(name)}" title="클릭하여 도형 추가">${escHtml(name)}${used.has(name.toLowerCase()) ? ' ✓' : ''}</button>`).join('')}
                </div>
            </div>`).join('');

    const typeOpts = [
        ['variable', '관측변인'], ['latent', '잠재변인'], ['idea', '메모'],
    ];
    panel.innerHTML = `
        <div class="mm-vp-head">
            <span>🏷 변인 태그</span>
            <button class="mm-vp-close" id="mm-vp-close" title="닫기">✕</button>
        </div>
        <div class="mm-vp-typesel">
            <span class="mm-vp-typesel-label">도형</span>
            ${typeOpts.map(([t, label]) => `
                <button class="mm-vp-type-btn mm-vp-type-${t} ${S.varAddType === t ? 'active' : ''}" data-type="${t}">${label}</button>`).join('')}
        </div>
        <div class="mm-vp-hint">변인을 클릭하면 위에서 고른 도형으로 캔버스에 추가됩니다</div>
        <div class="mm-vp-body">${body}</div>`;

    panel.querySelector('#mm-vp-close').onclick = mmToggleVarPanel;
    panel.querySelectorAll('.mm-vp-type-btn').forEach(btn => {
        btn.onclick = () => {
            S.varAddType = btn.dataset.type;
            panel.querySelectorAll('.mm-vp-type-btn').forEach(b =>
                b.classList.toggle('active', b === btn));
        };
    });
    panel.querySelectorAll('.mm-vp-chip').forEach(chip => {
        chip.onclick = () => mmAddVarNode(chip.dataset.name);
    });
}

// 패널이 열린 채 노드가 바뀌면(추가/삭제/undo) 사용 표시만 갱신
function mmSyncVarPanel() {
    const panel = document.getElementById('mm-var-panel');
    if (!panel || panel.style.display === 'none') return;
    const used = new Set(S.nodes.map(n => (n.text || '').trim().toLowerCase()).filter(Boolean));
    panel.querySelectorAll('.mm-vp-chip').forEach(chip => {
        const name = chip.dataset.name;
        const u = used.has(name.trim().toLowerCase());
        chip.classList.toggle('used', u);
        chip.textContent = name + (u ? ' ✓' : '');
    });
}

function mmAddVarNode(text) {
    const type = S.varAddType || 'variable';
    const r = S.svg.getBoundingClientRect();
    const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    const { w, h } = nodeSize({ type });
    const step = (S.nodes.length % 6) * 24;   // 겹치지 않게 살짝 계단식
    saveHistory();
    S.nodes.push({ id: genId(), type, x: c.x - w/2 + step, y: c.y - h/2 + step, text });
    mmSaveToDB();
    mmRender();
    mmSyncVarPanel();
    const label = (NODE_CFG[type] || {}).label || '도형';
    showToast(`"${text}" → ${label} 추가됨`, 'success');
}

// ── 삭제 ─────────────────────────────────────────────────────────────
function mmDelete() {
    if (!S.sel) return;
    saveHistory();
    if (S.sel.type === 'node') {
        S.nodes = S.nodes.filter(n => n.id !== S.sel.id);
        S.edges = S.edges.filter(e => e.from !== S.sel.id && e.to !== S.sel.id);
    } else if (S.sel.type === 'group') {
        S.groups = S.groups.filter(g => g.id !== S.sel.id);
    } else {
        S.edges = S.edges.filter(e => e.id !== S.sel.id);
    }
    S.sel = null;
    mmSaveToDB(); mmRender();
}

// ── 언두/리두 ─────────────────────────────────────────────────────────
function saveHistory() {
    const snap = {
        nodes:  JSON.parse(JSON.stringify(S.nodes)),
        edges:  JSON.parse(JSON.stringify(S.edges)),
        groups: JSON.parse(JSON.stringify(S.groups)),
    };
    S.history = S.history.slice(0, S.historyIdx + 1);
    S.history.push(snap);
    if (S.history.length > 40) S.history.shift();
    S.historyIdx = S.history.length - 1;
}

function mmUndo() {
    if (S.historyIdx <= 0) return;
    S.historyIdx--;
    const h = S.history[S.historyIdx];
    S.nodes = JSON.parse(JSON.stringify(h.nodes));
    S.edges = JSON.parse(JSON.stringify(h.edges));
    S.groups = JSON.parse(JSON.stringify(h.groups || []));
    S.sel = null; mmSaveToDB(); mmRender();
}

function mmRedo() {
    if (S.historyIdx >= S.history.length - 1) return;
    S.historyIdx++;
    const h = S.history[S.historyIdx];
    S.nodes = JSON.parse(JSON.stringify(h.nodes));
    S.edges = JSON.parse(JSON.stringify(h.edges));
    S.groups = JSON.parse(JSON.stringify(h.groups || []));
    S.sel = null; mmSaveToDB(); mmRender();
}

// ── 스냅샷 ───────────────────────────────────────────────────────────
async function mmSaveSnap() {
    const name = prompt('이 모형의 이름을 입력하세요:');
    if (!name?.trim()) return;
    S.snapshots.push({
        id: genId(), name: name.trim(),
        nodes:  JSON.parse(JSON.stringify(S.nodes)),
        edges:  JSON.parse(JSON.stringify(S.edges)),
        groups: JSON.parse(JSON.stringify(S.groups)),
        savedAt: Date.now(),
    });
    await mmSaveToDB();
    mmUpdateSnapList();
    showToast(`"${name.trim()}" 저장됐습니다`, 'success');
}

function mmLoadSnap(snapId) {
    const snap = S.snapshots.find(s => s.id === snapId);
    if (!snap) return;
    if (!confirm(`"${snap.name}"을 불러올까요?\n현재 캔버스는 Ctrl+Z로 되돌릴 수 있습니다.`)) {
        document.getElementById('mm-snap-list').value = ''; return;
    }
    saveHistory();
    S.nodes = JSON.parse(JSON.stringify(snap.nodes));
    S.edges = JSON.parse(JSON.stringify(snap.edges));
    S.groups = JSON.parse(JSON.stringify(snap.groups || []));
    S.sel = null;
    mmRender(); mmSaveToDB();
    document.getElementById('mm-snap-list').value = '';
    showToast(`"${snap.name}" 불러왔습니다`, 'success');
}

function mmUpdateSnapList() {
    const sel = document.getElementById('mm-snap-list');
    if (!sel) return;
    sel.innerHTML = '<option value="">── 저장된 모형 불러오기 ──</option>'
        + [...S.snapshots].reverse().map(s =>
            `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
}

// ── PNG 내보내기 ──────────────────────────────────────────────────────
async function mmExport() {
    if (S.nodes.length === 0 && S.groups.length === 0) { showToast('도형이 없습니다', 'error'); return; }

    const pad = 60;
    const allX = [
        ...S.nodes.flatMap(n => { const {w} = nodeSize(n); return [n.x, n.x + w]; }),
        ...S.groups.flatMap(g => [g.x, g.x + g.w]),
    ];
    const allY = [
        ...S.nodes.flatMap(n => { const {h} = nodeSize(n); return [n.y, n.y + h]; }),
        ...S.groups.flatMap(g => [g.y, g.y + g.h]),
    ];
    const minX = Math.min(...allX) - pad, maxX = Math.max(...allX) + pad;
    const minY = Math.min(...allY) - pad, maxY = Math.max(...allY) + pad;
    const W = maxX - minX, H = maxY - minY;

    const clone = S.svg.cloneNode(true);
    clone.setAttribute('width', W); clone.setAttribute('height', H);
    const bg = clone.querySelector('#mm-bg');
    if (bg) { bg.setAttribute('width', W + Math.abs(minX) * 2); bg.setAttribute('height', H + Math.abs(minY) * 2); }
    const wc = clone.querySelector('#mm-world');
    if (wc) wc.setAttribute('transform', `translate(${-minX},${-minY}) scale(1)`);

    const svgStr = new XMLSerializer().serializeToString(clone);
    const blob   = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url    = URL.createObjectURL(blob);

    const img = new Image();
    img.onload = () => {
        const sc = 2;
        // 제목·부제(있으면 상단에 합성)
        const title    = (state.proposal?.title || '').trim();
        const subtitle = (state.proposal?.subtitle || '').trim();
        const meas = document.createElement('canvas').getContext('2d');
        const maxTextW  = W - 80;
        const titleFont = '800 30px "Noto Sans KR", sans-serif';
        const subFont   = '700 18px "Noto Sans KR", sans-serif';
        const titleLines = title    ? wrapByChar(meas, title, titleFont, maxTextW) : [];
        const subLines   = subtitle ? wrapByChar(meas, '— ' + subtitle + ' —', subFont, maxTextW) : [];
        const titleLH = 40, subLH = 26;
        let headerH = 0;
        if (titleLines.length || subLines.length) {
            headerH = 24 + titleLines.length * titleLH
                    + (subLines.length ? 6 + subLines.length * subLH : 0) + 18;
        }

        const totalH = H + headerH;
        const canvas = document.createElement('canvas');
        canvas.width = W * sc; canvas.height = totalH * sc;
        const ctx = canvas.getContext('2d');
        ctx.scale(sc, sc);
        ctx.fillStyle = '#f8fafd'; ctx.fillRect(0, 0, W, totalH);

        ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        let y = 24;
        if (titleLines.length) {
            ctx.font = titleFont; ctx.fillStyle = '#2b2b2b';
            titleLines.forEach(line => { ctx.fillText(line, W / 2, y); y += titleLH; });
        }
        if (subLines.length) {
            y += 6;
            ctx.font = subFont; ctx.fillStyle = '#b03a3a';
            subLines.forEach(line => { ctx.fillText(line, W / 2, y); y += subLH; });
        }

        ctx.drawImage(img, 0, headerH, W, H);
        URL.revokeObjectURL(url);
        const a = document.createElement('a');
        a.download = '연구모형.png'; a.href = canvas.toDataURL('image/png'); a.click();
        showToast('연구모형.png 저장됐습니다', 'success');
    };
    img.onerror = () => { URL.revokeObjectURL(url); showToast('PNG 변환 실패', 'error'); };
    img.src = url;
}

// 글자 단위 줄바꿈(한글은 공백이 없어 문자 기준이 안전) — PNG 헤더 제목/부제용
function wrapByChar(ctx, text, font, maxW) {
    ctx.font = font;
    if (ctx.measureText(text).width <= maxW) return [text];
    const lines = []; let cur = '';
    for (const ch of text) {
        if (cur && ctx.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ch; }
        else cur += ch;
    }
    if (cur) lines.push(cur);
    return lines;
}

// ── DB ────────────────────────────────────────────────────────────────
async function mmSaveToDB() {
    if (!S || !db) return;
    try {
        await new Promise((res, rej) => {
            const tx  = db.transaction(MM_STORE, 'readwrite');
            const req = tx.objectStore(MM_STORE).put({
                id: S.projectId, nodes: S.nodes, edges: S.edges, groups: S.groups,
                snapshots: S.snapshots, updatedAt: Date.now(),
            });
            req.onsuccess = res; req.onerror = rej;
        });
    } catch (e) { /* silent */ }
}

async function mmLoad() {
    if (!db) return;
    try {
        const data = await new Promise((res, rej) => {
            const tx  = db.transaction(MM_STORE, 'readonly');
            const req = tx.objectStore(MM_STORE).get(S.projectId);
            req.onsuccess = () => res(req.result); req.onerror = rej;
        });
        if (data) {
            S.nodes = data.nodes || []; S.edges = data.edges || [];
            S.groups = data.groups || [];
            S.snapshots = data.snapshots || [];
        }
    } catch (e) { /* store not ready yet */ }
}

// ── 미니 프로포절 패널 (모형스케치북 오른쪽) ──────────────────────────
// 데이터는 app.js의 state.proposal(프로젝트별) + queueSaveProposal()로 저장.
// UI 상태(열림/폭)는 settings store의 'mm-ui' 레코드(전역, 프로젝트 무관).
const MM_UI_KEY = 'mm-ui';
let mmUI = {};

// 텍스트 4칸: [key, 라벨, placeholder]
const PROP_FIELDS = [
    ['needs',    '연구 필요성', '왜 이 연구가 필요한가? 문제의식·배경'],
    ['purpose',  '연구 목적',   '이 연구로 무엇을 밝히려 하는가?'],
    ['method',   '연구 방법',   '연구 설계·분석 방법 (예: 설문조사, 구조방정식)'],
    ['subjects', '연구 대상',   '누구를 대상으로? 표본·모집 방법'],
];

async function mmInitProp() {
    try { mmUI = (await dbGet(STORE_SETTINGS, MM_UI_KEY)) || {}; } catch { mmUI = {}; }
    const panel = document.getElementById('mm-prop-panel');
    if (!panel) return;
    panel.style.flexBasis = clampPropWidth(mmUI.propWidth || 360) + 'px';
    mmBindPropResizer();
    mmRenderProp();
    mmInitTitle();
    mmApplyPropOpen(!!mmUI.propOpen);   // 마지막 상태 복원(기본 닫힘)
    mmSyncStyleBtn();
    mmRender();                          // 복원된 styleMode(학술/작업)를 캔버스에 반영
}

// 작업용 ↔ 학술용 보기 전환
function mmToggleStyle() {
    const next = mmStyleMode() === 'academic' ? 'work' : 'academic';
    mmSaveUI({ styleMode: next });   // mmUI.styleMode 갱신 + 저장
    mmSyncStyleBtn();
    mmRender();
}

function mmSyncStyleBtn() {
    const btn = document.getElementById('mm-style-toggle');
    if (!btn) return;
    const academic = mmStyleMode() === 'academic';
    btn.textContent = academic ? '🎓 학술용' : '🎨 작업용';
    btn.classList.toggle('active', academic);
}

// 캔버스 상단 제목·부제(오버레이). 데이터는 state.proposal.title/subtitle.
function mmInitTitle() {
    const tEl = document.getElementById('mm-title');
    const sEl = document.getElementById('mm-subtitle');
    if (!tEl || !sEl) return;
    const p = state.proposal || {};
    tEl.textContent = p.title || '';
    sEl.textContent = p.subtitle || '';
    tEl.oninput = () => { state.proposal.title = tEl.textContent.trim(); queueSaveProposal(); };
    sEl.oninput = () => { state.proposal.subtitle = sEl.textContent.trim(); queueSaveProposal(); };
    // 제목·부제는 한 줄 의미 — Enter는 줄바꿈 대신 편집 종료. 캔버스로 키 전파 차단.
    [tEl, sEl].forEach(elm => elm.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); elm.blur(); }
        e.stopPropagation();
    }));
}

function clampPropWidth(w) { return Math.min(640, Math.max(280, Math.round(w) || 360)); }

function mmSaveUI(patch) {
    mmUI = { ...mmUI, ...patch, id: MM_UI_KEY };
    try { dbPut(STORE_SETTINGS, mmUI); } catch { /* silent */ }
}

function mmApplyPropOpen(open) {
    document.getElementById('mm-prop-panel').style.display   = open ? 'flex' : 'none';
    document.getElementById('mm-prop-resizer').style.display = open ? 'block' : 'none';
    document.getElementById('mm-prop-toggle').classList.toggle('active', open);
    if (open) requestAnimationFrame(() =>
        document.querySelectorAll('#mm-prop-panel textarea').forEach(autoGrowTA));
    resizeBg();
}

function mmToggleProp() {
    const open = document.getElementById('mm-prop-panel').style.display === 'none';
    mmApplyPropOpen(open);
    mmSaveUI({ propOpen: open });
}

function autoGrowTA(ta) {
    ta.style.height = 'auto';
    ta.style.height = (ta.scrollHeight + 2) + 'px';
}

function mmRenderProp() {
    const panel = document.getElementById('mm-prop-panel');
    if (!panel) return;
    const p = (typeof state !== 'undefined' && state.proposal) ? state.proposal : null;
    if (!p) { panel.innerHTML = ''; return; }

    const textSections = PROP_FIELDS.map(([key, label, ph], i) => `
        <details class="mm-prop-sec" ${i === 0 ? 'open' : ''}>
            <summary>${label}</summary>
            <textarea class="mm-prop-ta" data-key="${key}" rows="2"
                placeholder="${escHtml(ph)}">${escHtml(p[key] || '')}</textarea>
        </details>`).join('');

    const hypos = p.hypotheses || [];
    const hypoSection = `
        <details class="mm-prop-sec" open>
            <summary>가설 <span class="mm-prop-count">${hypos.length}</span></summary>
            <div class="mm-prop-hypos" id="mm-prop-hypos">${hypos.map(hypoRowHTML).join('')}</div>
            <button class="mm-prop-addhypo" id="mm-prop-addhypo">+ 가설 추가</button>
        </details>`;

    panel.innerHTML = `
        <div class="mm-prop-head">
            <span>📝 미니 프로포절</span>
            <button class="mm-prop-close" id="mm-prop-close" title="패널 닫기">✕</button>
        </div>
        <div class="mm-prop-body">${textSections}${hypoSection}</div>`;

    mmBindProp();
}

// 가설 1줄. 번호(H1…)는 순서대로 매기므로 index에서 계산(저장값 아님 → 재정렬에 안전)
function hypoRowHTML(h, i) {
    return `
        <div class="mm-prop-hypo" data-id="${h.id}">
            <span class="mm-prop-hlabel">H${i + 1}</span>
            <textarea class="mm-prop-htext" rows="1" placeholder="가설 내용">${escHtml(h.text || '')}</textarea>
            <button class="mm-prop-hdel" title="이 가설 삭제">✕</button>
        </div>`;
}

function mmBindProp() {
    const panel = document.getElementById('mm-prop-panel');
    panel.querySelector('#mm-prop-close').onclick = mmToggleProp;

    // 텍스트 4칸 — 입력 시 state.proposal에 반영 + 자동저장 + 높이 자동
    panel.querySelectorAll('.mm-prop-ta').forEach(ta => {
        autoGrowTA(ta);
        ta.oninput = () => {
            state.proposal[ta.dataset.key] = ta.value;
            autoGrowTA(ta);
            queueSaveProposal();
        };
    });

    // 가설 추가
    panel.querySelector('#mm-prop-addhypo').onclick = () => {
        state.proposal.hypotheses.push({ id: genId(), text: '' });
        mmRenderProp();
        queueSaveProposal();
        const rows = document.querySelectorAll('#mm-prop-hypos .mm-prop-htext');
        rows[rows.length - 1]?.focus();
    };

    // 가설 줄들
    panel.querySelectorAll('.mm-prop-hypo').forEach(row => {
        const id = row.dataset.id;
        const ta = row.querySelector('.mm-prop-htext');
        autoGrowTA(ta);
        ta.oninput = () => {
            const h = state.proposal.hypotheses.find(x => x.id === id);
            if (h) h.text = ta.value;
            autoGrowTA(ta);
            queueSaveProposal();
        };
        row.querySelector('.mm-prop-hdel').onclick = () => {
            state.proposal.hypotheses = state.proposal.hypotheses.filter(x => x.id !== id);
            // 삭제된 가설에 연결돼 있던 화살표는 연결 해제
            let edgeChanged = false;
            S.edges.forEach(e => { if (e.hypoId === id) { e.hypoId = null; edgeChanged = true; } });
            mmRenderProp();
            queueSaveProposal();
            if (edgeChanged) mmSaveToDB();
            mmRender();   // 뒤 가설 번호가 당겨졌을 수 있으니 화살표 H번호 라벨 갱신
        };
    });
}

function mmBindPropResizer() {
    const resizer = document.getElementById('mm-prop-resizer');
    const panel   = document.getElementById('mm-prop-panel');
    const body    = document.getElementById('mm-body');
    if (!resizer) return;

    const onMove = e => {
        const rect = body.getBoundingClientRect();
        panel.style.flexBasis = clampPropWidth(rect.right - e.clientX) + 'px';
        resizeBg();
    };
    const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        mmSaveUI({ propWidth: parseInt(panel.style.flexBasis, 10) || 360 });
    };
    // 할당(=)이라 initMindmap 재진입 시 핸들러가 덮어써져 중복 누적 없음
    resizer.onmousedown = e => {
        e.preventDefault();
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };
}

// ── 헬퍼 ─────────────────────────────────────────────────────────────
function mmHint(msg) {
    const e = document.getElementById('mm-hint');
    if (e) e.textContent = msg;
}

function resizeBg() {
    if (!S) return;
    const r = S.svg.getBoundingClientRect();
    const bg = document.getElementById('mm-bg');
    if (bg) { bg.setAttribute('width', r.width); bg.setAttribute('height', r.height); }
}
