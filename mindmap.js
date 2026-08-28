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
                <details class="mm-menu" name="mm-menu">
                    <summary>도형</summary>
                    <div class="mm-menu-pop">
                        <button class="mm-menu-item" id="mm-add-var" title="관측변인 (사각형)">
                            <svg width="15" height="13" viewBox="0 0 14 12" fill="none"><rect x="1" y="1" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.8"/></svg>
                            관측변인 <span class="mm-mi-sub">사각형</span>
                        </button>
                        <button class="mm-menu-item" id="mm-add-latent" title="잠재변인 (타원)">
                            <svg width="16" height="13" viewBox="0 0 16 12" fill="none"><ellipse cx="8" cy="6" rx="7" ry="5" stroke="currentColor" stroke-width="1.8"/></svg>
                            잠재변인 <span class="mm-mi-sub">타원</span>
                        </button>
                        <button class="mm-menu-item" id="mm-add-idea" title="메모 (둥근 카드)">
                            <svg width="15" height="13" viewBox="0 0 14 12" fill="none"><rect x="1" y="1" width="12" height="10" rx="5" stroke="currentColor" stroke-width="1.8"/><line x1="4" y1="4.5" x2="10" y2="4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="4" y1="7.5" x2="8" y2="7.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                            메모 <span class="mm-mi-sub">카드</span>
                        </button>
                        <div class="mm-menu-div"></div>
                        <button class="mm-menu-item" id="mm-add-group-ellipse" title="변인들을 감싸는 큰 원">
                            <svg width="16" height="13" viewBox="0 0 16 12" fill="none"><ellipse cx="8" cy="6" rx="7" ry="5" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2"/></svg>
                            큰 원 <span class="mm-mi-sub">묶기</span>
                        </button>
                        <button class="mm-menu-item" id="mm-add-group-rect" title="변인들을 감싸는 큰 박스">
                            <svg width="15" height="13" viewBox="0 0 14 12" fill="none"><rect x="1" y="1" width="12" height="10" rx="3" stroke="currentColor" stroke-width="1.6" stroke-dasharray="3 2"/></svg>
                            큰 박스 <span class="mm-mi-sub">묶기</span>
                        </button>
                    </div>
                </details>

                <details class="mm-menu" name="mm-menu">
                    <summary>편집</summary>
                    <div class="mm-menu-pop">
                        <button class="mm-menu-item" id="mm-undo" title="되돌리기">
                            <svg class="mm-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-3.75"/></svg>
                            되돌리기 <span class="mm-mi-sub">Ctrl+Z</span>
                        </button>
                        <button class="mm-menu-item" id="mm-redo" title="다시">
                            <svg class="mm-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.49-3.75"/></svg>
                            다시 <span class="mm-mi-sub">Ctrl+Y</span>
                        </button>
                        <div class="mm-menu-div"></div>
                        <button class="mm-menu-item" id="mm-save-snap" title="현재 모형 저장">
                            <svg class="mm-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                            모형 저장
                        </button>
                        <div class="mm-menu-label" style="display:flex;align-items:center;justify-content:space-between">
                            <span>저장된 모형</span>
                            <button class="mm-snap-del-btn" id="mm-snap-del-sel" style="display:none">선택 삭제</button>
                        </div>
                        <div id="mm-snap-list" class="mm-snap-list-wrap"></div>
                    </div>
                </details>

                <details class="mm-menu" name="mm-menu">
                    <summary>보기</summary>
                    <div class="mm-menu-pop">
                        <button class="mm-menu-item" id="mm-vars-toggle" title="논문에 등록한 변인을 도형으로 가져오기">
                            <svg class="mm-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>
                            변인 태그 가져오기
                        </button>
                        <button class="mm-menu-item" id="mm-style-toggle" title="작업용(컬러) ↔ 학술용(흑백)">
                            <svg class="mm-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            작업용 ↔ 학술용 전환
                        </button>
                    </div>
                </details>

                <details class="mm-menu" name="mm-menu">
                    <summary>내보내기</summary>
                    <div class="mm-menu-pop">
                        <button class="mm-menu-item" id="mm-export-ppt" title="PPT 미리보기 후 .pptx 내보내기">
                            <svg class="mm-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                            발표자료 만들기
                        </button>
                        <button class="mm-menu-item" id="mm-export-png" title="모형을 PNG 그림으로 저장">
                            <svg class="mm-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                            PNG 그림 내보내기
                        </button>
                    </div>
                </details>

                <div class="mm-hint-text" id="mm-hint"></div>
                <div class="mm-tool-right">
                    <button class="mm-btn mm-tool" id="mm-prop-toggle" title="미니 프로포절 패널 열기/닫기">
                        <svg class="mm-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                        미니 프로포절
                    </button>
                    <button class="mm-btn mm-tool" id="mm-open-desk" title="연구 책상 화면으로 이동">
                        <svg class="mm-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                        책상으로
                    </button>
                </div>
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
                        <div class="mm-title-row">
                            <div class="mm-title" id="mm-title" contenteditable="true" spellcheck="false"
                                 data-placeholder="연구모형 제목 — 클릭해서 입력"></div>
                            <button class="mm-title-clear" id="mm-title-clear" title="제목·부제 지우기">✕</button>
                        </div>
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
        sel: null, selAll: false,
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
    const isSel = S.selAll || (S.sel?.type === 'group' && S.sel.id === group.id);
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
    const isSel  = S.selAll || (S.sel?.type === 'node' && S.sel.id === node.id);
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
    if (!from) return;

    // 조절효과 화살표: to가 다른 두 변인 사이의 화살표(엣지) id →
    // 그 경로의 중점을 향해 화살촉이 꽂힌다(도형→화살표 연결).
    let sx, sy, ex, ey, axis;
    if (edge.toEdge) {
        const mid = edgeMidpoint(S.edges.find(e => e.id === edge.to));
        if (!mid) return;                                   // 대상 화살표가 사라졌으면 안 그림
        ({ sx, sy, ex, ey, axis } = endpointsNodeToPoint(from, mid.x, mid.y));
    } else {
        const to = S.nodes.find(n => n.id === edge.to);
        if (!to) return;
        ({ sx, sy, ex, ey, axis } = endpoints(from, to));
    }

    // 학술모드: 색·화살촉만 회색으로 빼고, 점선 패턴은 관계별 그대로 둔다
    // (매개·조절·부적영향의 점선은 흑백에서도 관계를 구분해 주는 표시이므로 유지).
    const academic = mmStyleMode() === 'academic';
    const base  = EDGE_STYLES[edge.label] || EDGE_STYLES['정적영향(+)'];
    const style = academic
        ? { color: ACADEMIC_EDGE.color, marker: ACADEMIC_EDGE.marker, dash: base.dash }
        : base;
    const isSel = S.sel?.type === 'edge' && S.sel.id === edge.id;
    const mx = (sx + ex) / 2;
    const my = (sy + ey) / 2;
    // 기본은 부드러운 곡선(기존 동작). edge.straight면 직선.
    // 곡선은 연결 방향(axis)에 맞춰 끝점으로 들어와야 화살촉이 옳은 쪽을 가리킴.
    //  - 가로 연결: 제어점을 가로 중점(mx)에 → 좌/우로 들어옴
    //  - 세로 연결: 제어점을 세로 중점(my)에 → 위/아래로 들어옴
    // ㄴ자형: 두 노드 아래쪽에서 출발→아래로 내려→수평→올라와서 도착 (U자 우회)
    let d;
    let orthoCoords = null; // 드래그 핸들용 좌표 보관
    if (edge.orthogonal && !edge.toEdge) {
        const { w: fw, h: fh } = nodeSize(from);
        const toNode = S.nodes.find(n => n.id === edge.to);
        const { w: tw, h: th } = nodeSize(toNode || from);
        const bsy = from.y + fh;          // 출발 노드 하단
        const bex = (toNode?.x ?? ex) + tw / 2;  // 도착 노드 하단 중앙 x
        const bey = (toNode?.y ?? ey) + th;       // 도착 노드 하단
        const bsx = from.x + fw / 2;     // 출발 노드 하단 중앙 x
        const offset = edge.orthoOffset ?? 40;
        const drop = Math.max(bsy, bey) + offset; // 두 노드 중 더 낮은 쪽 + 조절 여백
        d = `M ${bsx} ${bsy} L ${bsx} ${drop} L ${bex} ${drop} L ${bex} ${bey}`;
        orthoCoords = { bsx, bex, drop };
    } else {
        d = edge.straight
            ? `M ${sx} ${sy} L ${ex} ${ey}`
            : (axis === 'v'
                ? `M ${sx} ${sy} C ${sx} ${my}, ${ex} ${my}, ${ex} ${ey}`
                : `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ey}, ${ex} ${ey}`);
    }

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
    // 이 경로에 조절 화살표가 꽂혀 있으면 화살촉이 경로 중점을 덮으므로,
    // 라벨을 중앙에서 시작점 쪽(30%)으로 비켜 놓아 가려지지 않게 한다.
    const moderated = !edge.toEdge && S.edges.some(e => e.toEdge && e.to === edge.id);
    const labelT = moderated ? 0.3 : 0.5;
    let lx, ly;
    if (edge.orthogonal && !edge.toEdge) {
        // ㄴ자형: 수평 구간(바닥선) 중점에 레이블
        const toNode2 = S.nodes.find(n => n.id === edge.to);
        const { w: fw2, h: fh2 } = nodeSize(from);
        const { w: tw2, h: th2 } = nodeSize(toNode2 || from);
        const bsx2 = from.x + fw2 / 2;
        const bex2 = (toNode2?.x ?? ex) + tw2 / 2;
        const bsy2 = from.y + fh2;
        const bey2 = (toNode2?.y ?? ey) + th2;
        const drop2 = Math.max(bsy2, bey2) + (edge.orthoOffset ?? 40);
        lx = (bsx2 + bex2) / 2;
        ly = drop2 - 13;
    } else {
        lx = sx + (ex - sx) * labelT;
        ly = sy + (ey - sy) * labelT - 13;
    }
    g.appendChild(el('rect', {
        x: lx - bw / 2, y: ly - 10, width: bw, height: 19,
        rx: 9, fill: 'white',
        stroke: labelColor, 'stroke-width': 1.5, opacity: '1',
        filter: 'drop-shadow(0 0 3px rgba(255,255,255,0.9))',
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

    // ㄴ자형 수평 구간 드래그 — 투명 히트영역만 (커서가 ↕로 바뀌어 드래그 가능함을 알림)
    if (orthoCoords) {
        const { bsx, bex, drop } = orthoCoords;
        const hx1 = Math.min(bsx, bex);
        const hx2 = Math.max(bsx, bex);
        const hit = el('line', {
            x1: hx1, y1: drop, x2: hx2, y2: drop,
            stroke: 'transparent', 'stroke-width': '16',
            cursor: 'ns-resize', 'data-ortho-handle': edge.id,
        });
        g.appendChild(hit);
    }

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

// 화살표(엣지)의 중점 좌표 — 조절 화살표가 꽂힐 지점.
// 대상이 정상 도형↔도형 연결일 때만 계산(조절 화살표끼리는 막음).
function edgeMidpoint(edge) {
    if (!edge || edge.toEdge) return null;
    const from = S.nodes.find(n => n.id === edge.from);
    const to   = S.nodes.find(n => n.id === edge.to);
    if (!from || !to) return null;
    const { sx, sy, ex, ey } = endpoints(from, to);
    return { x: (sx + ex) / 2, y: (sy + ey) / 2 };
}

// 도형 → 임의의 점(px,py)으로 가는 화살표의 시작·끝점.
// 시작점은 도형 테두리 중 대상 방향 면에서 나간다.
function endpointsNodeToPoint(from, px, py) {
    const { w: fw, h: fh } = nodeSize(from);
    const fx = from.x + fw/2, fy = from.y + fh/2;
    const dx = px - fx, dy = py - fy;
    let sx, sy, axis;
    if (Math.abs(dx) >= Math.abs(dy)) {
        axis = 'h';
        sx = dx > 0 ? from.x + fw : from.x; sy = fy;
    } else {
        axis = 'v';
        sx = fx; sy = dy > 0 ? from.y + fh : from.y;
    }
    return { sx, sy, ex: px, ey: py, axis };
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
    document.getElementById('mm-snap-del-sel').onclick = mmDeleteSelectedSnaps;
    document.getElementById('mm-export-png').onclick = mmExport;
    document.getElementById('mm-export-ppt').onclick = mmOpenPPT;
    document.getElementById('mm-open-desk').onclick = reopenDesk;
    // 메뉴 항목 클릭 시 그 메뉴 닫기 (불러오기 select은 제외)
    document.querySelectorAll('.mm-menu').forEach(d => {
        const pop = d.querySelector('.mm-menu-pop');
        if (pop) pop.addEventListener('click', e => { if (e.target.closest('.mm-menu-item')) d.open = false; });
    });
    // 메뉴 바깥을 클릭하면 열린 메뉴 접기 (document에 한 번만 등록)
    if (!window.__mmMenuOutsideBound) {
        window.__mmMenuOutsideBound = true;
        document.addEventListener('mousedown', e => {
            if (e.target.closest('.mm-menu')) return;   // 메뉴 자체 클릭은 제외
            document.querySelectorAll('.mm-menu[open]').forEach(d => { d.open = false; });
        });
    }
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

    // 탭 재진입마다 이 함수가 다시 호출되는데, document/window 리스너는 앱 생애주기 내내 살아있어
    // 가드 없이 매번 등록하면 재진입 횟수만큼 쌓인다(Ctrl+Z 한 번에 여러 단계 취소되는 원인이었음).
    // onKey/resizeBg는 mindmap.js 최상위 함수라 매번 최신 S를 읽으므로 1회만 등록해도 안전.
    if (!window.__mmKeyBound) {
        window.__mmKeyBound = true;
        document.addEventListener('keydown', onKey);
    }
    if (!window.__mmDocMousedownBound) {
        window.__mmDocMousedownBound = true;
        document.addEventListener('mousedown', e => {
            if (!e.target.closest('#mm-rel-popup')) hidePopup();
        });
    }
    if (!window.__mmResizeBound) {
        window.__mmResizeBound = true;
        window.addEventListener('resize', resizeBg);
    }
}

function onDown(e) {
    if (e.button !== 0) return;
    if (S.selAll) { S.selAll = false; mmRender(); mmHint(''); }
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

    // 연결 중 화살표(경로)를 클릭 → 조절효과: 도형이 그 경로를 조절.
    // 화살촉이 다른 두 변인 사이의 화살표에 꽂히는 학술 표준 그림.
    if (S.mode === 'connecting') {
        const teg = e.target.closest('.mm-eg');
        if (teg) {
            const targetEid = teg.dataset.eid;
            const tEdge = S.edges.find(ed => ed.id === targetEid);
            if (tEdge && !tEdge.toEdge && tEdge.from !== S.connectFrom && tEdge.to !== S.connectFrom) {
                addModerationEdge(targetEid);
            } else {
                showToast('조절은 다른 두 도형 사이의 화살표에만 연결할 수 있어요', 'error');
                cancelConnect();
            }
            e.stopPropagation(); e.preventDefault(); return;
        }
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

    // ㄴ자형 수평 핸들 드래그
    if (e.target.dataset.orthoHandle) {
        const eid = e.target.dataset.orthoHandle;
        const edge = S.edges.find(ed => ed.id === eid);
        if (edge) {
            saveHistory();
            S.dragging = { kind: 'orthoHandle', eid, startWy: wy, startOffset: edge.orthoOffset ?? 40 };
            e.stopPropagation(); return;
        }
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
        if (S.dragging.kind === 'orthoHandle') {
            const edge = S.edges.find(ed => ed.id === S.dragging.eid);
            if (edge) {
                const dy = wy - S.dragging.startWy;
                const newOffset = Math.max(10, S.dragging.startOffset + dy);
                edge.orthoOffset = newOffset;
                mmRender();
            }
        } else if (S.dragging.kind === 'group') {
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
    if (S.dragging) {
        if (S.dragging.kind === 'orthoHandle') { mmSaveToDB(); }
        else if (S.dragging.moved) mmSaveToDB();
        S.dragging = null;
    }
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
    mmHint('대상 도형을 클릭 = 일반 연결 | 다른 두 변인 사이의 화살표를 클릭 = 조절효과 (Esc 취소)');
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
    // 리스너를 1회만 등록(위 mmBind 참고)하면서 화면을 떠나도 계속 살아있으므로,
    // 모형스케치북(sketch) 화면이 아닐 때는 무시 — 다른 화면에서 Delete 눌러도 캔버스가 반응하면 안 됨.
    if (typeof state !== 'undefined' && state.view !== 'sketch') return;
    // 텍스트 입력 중(제목·부제 contenteditable, 프로포절·이름 편집 input/textarea)에는
    // 캔버스 단축키(Delete·Ctrl+Z 등)를 무시 — 네이티브 텍스트 편집을 우선한다.
    if (document.activeElement?.isContentEditable) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    // Ctrl+A — 전체 선택
    if ((e.ctrlKey||e.metaKey) && e.key === 'a') {
        e.preventDefault();
        S.selAll = true; S.sel = null; mmRender();
        mmHint('전체 선택됨 — Delete 또는 Backspace로 삭제, Esc로 해제');
        return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (S.selAll) mmDeleteAll();
        else mmDelete();
    }
    if ((e.ctrlKey||e.metaKey) && e.key==='z' && !e.shiftKey) { e.preventDefault(); mmUndo(); }
    if ((e.ctrlKey||e.metaKey) && (e.key==='y'||(e.key==='z'&&e.shiftKey))) { e.preventDefault(); mmRedo(); }
    if (e.key === 'Escape') {
        if (S.selAll) { S.selAll = false; mmRender(); mmHint(''); return; }
        if (S.mode==='placing' || S.mode==='placing-group') {
            S.mode='idle'; S.placingType=null; S.placingGroupShape=null; S.svg.style.cursor=''; mmHint('');
        }
        if (S.mode==='connecting') cancelConnect();
        hidePopup(); cancelEdit();
    }
}

function mmDeleteAll() {
    const total = S.nodes.length + S.edges.length + S.groups.length;
    if (!total) { S.selAll = false; return; }
    if (!confirm(`캔버스의 모든 도형·화살표(${total}개)를 삭제할까요?\nCtrl+Z로 되돌릴 수 있습니다.`)) return;
    saveHistory();
    S.nodes = []; S.edges = []; S.groups = [];
    S.sel = null; S.selAll = false;
    mmSaveToDB(); mmRender(); mmHint('');
    showToast('전체 삭제됐습니다. Ctrl+Z로 되돌릴 수 있어요.', 'info');
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

    mmPlacePopup(popup, cx, cy);

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

// 팝업을 커서 근처에 띄우되 캔버스(cwrap) 밖으로 잘리지 않게 맞춘다.
// 가설이 많아 메뉴가 길어지면 최대 높이를 주고 세로 스크롤(잘림 방지).
function mmPlacePopup(popup, cx, cy) {
    const wrapR = S.cwrap.getBoundingClientRect();
    const M = 10;                                   // 가장자리 여백
    // 먼저 길이 제한(스크롤)부터 적용해야 측정 크기가 실제 표시 크기와 일치
    popup.style.maxHeight = Math.max(120, wrapR.height - M * 2) + 'px';
    popup.style.overflowY = 'auto';
    popup.style.display = 'block';
    popup.style.left = (cx - wrapR.left + 12) + 'px';
    popup.style.top  = (cy - wrapR.top  + 12) + 'px';

    requestAnimationFrame(() => {
        const pr = popup.getBoundingClientRect();
        let left = cx - wrapR.left + 12;
        let top  = cy - wrapR.top  + 12;
        if (pr.right  > wrapR.right)  left = cx - wrapR.left - pr.width  - 12;  // 오른쪽 넘침 → 커서 왼쪽
        if (pr.bottom > wrapR.bottom) top  = cy - wrapR.top   - pr.height - 12;  // 아래 넘침 → 커서 위쪽
        // 그래도 위/왼쪽으로 넘치면 가장자리에 붙여 항상 안에 들어오게
        left = Math.max(M, Math.min(left, wrapR.width  - pr.width  - M));
        top  = Math.max(M, Math.min(top,  wrapR.height - pr.height - M));
        popup.style.left = left + 'px';
        popup.style.top  = top  + 'px';
    });
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
        : `<div class="mm-pop-hint">아래 버튼으로 새 가설을 만들어 연결하세요</div>`}
        <div class="mm-pop-item mm-pop-hypo mm-pop-newhypo" data-act="new-hypo">➕ 새 가설 만들어 연결 (H${hypos.length + 1})</div>
        ${edge.hypoId ? `<div class="mm-pop-item mm-pop-hypo" data-hypo="">⨯ 가설 연결 해제</div>` : ''}`;

    popup.innerHTML = `
        <div class="mm-pop-title">화살표 관계 변경</div>
        ${Object.keys(EDGE_STYLES).map(l => `
            <div class="mm-pop-item ${l === edge.label ? 'mm-pop-active' : ''}" data-rel="${l}" style="--rc:${EDGE_STYLES[l].color}">
                <span class="mm-pop-dot"></span>${l}${l === edge.label ? ' ✓' : ''}
            </div>`).join('')}
        <div class="mm-pop-divider"></div>
        <div class="mm-pop-title">선 모양</div>
        <div class="mm-pop-item ${edge.orthogonal ? '' : (edge.straight ? '' : 'mm-pop-active')}" data-act="set-curve">↝ 곡선${(!edge.straight && !edge.orthogonal) ? ' ✓' : ''}</div>
        <div class="mm-pop-item ${edge.straight ? 'mm-pop-active' : ''}" data-act="toggle-straight">╱ 직선${edge.straight ? ' ✓' : ''}</div>
        <div class="mm-pop-item ${edge.orthogonal ? 'mm-pop-active' : ''}" data-act="toggle-ortho">┘ ㄴ자형 꺾기${edge.orthogonal ? ' ✓' : ''}</div>
        ${hypoSection}
        <div class="mm-pop-divider"></div>
        <div class="mm-pop-item mm-pop-del" data-act="delete">${icon('trash', 14)} 이 화살표 삭제</div>
        <div class="mm-pop-item mm-pop-cancel" data-act="cancel">✕ 닫기</div>`;

    mmPlacePopup(popup, cx, cy);

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
            } else if (act === 'new-hypo') {
                // 새 가설을 프로포절에 추가하고 이 화살표에 바로 연결 → H번호 자동 부여
                if (state && state.proposal) {
                    saveHistory();
                    if (!state.proposal.hypotheses) state.proposal.hypotheses = [];
                    const h = { id: genId(), text: '' };
                    state.proposal.hypotheses.push(h);
                    edge.hypoId = h.id;
                    if (typeof saveProposalNow === 'function') saveProposalNow();
                    mmSaveToDB();
                    mmRenderProp();   // 프로포절 패널 열려 있으면 새 가설 줄도 바로 반영
                    showToast(`H${state.proposal.hypotheses.length} 가설을 만들어 연결했어요`, 'success');
                }
            } else if (act === 'set-curve') {
                saveHistory();
                edge.straight = false; edge.orthogonal = false;
                mmSaveToDB();
            } else if (act === 'toggle-straight') {
                saveHistory();
                edge.straight = true; edge.orthogonal = false;
                mmSaveToDB();
            } else if (act === 'toggle-ortho') {
                saveHistory();
                edge.orthogonal = true; edge.straight = false;
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

// 조절효과 화살표 만들기: connectFrom 도형 → targetEid 화살표(경로).
// label '조절', toEdge:true, 직선으로(경로를 가리키는 그림이 선명하도록).
function addModerationEdge(targetEid) {
    const dup = S.edges.find(ed => ed.toEdge && ed.from === S.connectFrom && ed.to === targetEid);
    if (dup) { showToast('이미 연결된 조절 화살표예요', 'error'); cancelConnect(); return; }
    saveHistory();
    S.edges.push({ id: genId(), from: S.connectFrom, to: targetEid, label: '조절', toEdge: true, straight: true });
    mmSaveToDB();
    cancelConnect();   // mmRender 포함
    showToast('조절효과 화살표를 연결했어요', 'success');
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
        ? `<div class="mm-vp-empty">이 프로젝트 논문에 등록된 변인이 없습니다.<br>논문 추가/수정 화면의 변인 또는 ${icon('bar-chart', 13)} 정밀 분석에서 변인을 입력하면 여기에 모입니다.</div>`
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
            <span>${icon('tag', 14)} 변인 태그</span>
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
    pruneOrphanModEdges();   // 대상 화살표가 사라진 조절 화살표도 같이 정리
    S.sel = null;
    mmSaveToDB(); mmRender();
}

// 대상(경로) 화살표가 더 이상 없는 조절 화살표를 제거한다.
function pruneOrphanModEdges() {
    const ids = new Set(S.edges.filter(e => !e.toEdge).map(e => e.id));
    S.edges = S.edges.filter(e => !e.toEdge || ids.has(e.to));
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
    const nm = name.trim();
    const snapData = () => ({
        nodes:  JSON.parse(JSON.stringify(S.nodes)),
        edges:  JSON.parse(JSON.stringify(S.edges)),
        groups: JSON.parse(JSON.stringify(S.groups)),
        savedAt: Date.now(),
    });
    const existing = S.snapshots.find(s => s.name === nm);
    if (existing) {
        // 같은 이름 → 덮어쓰기 확인 (취소하면 다른 이름으로 다시 저장 안내)
        if (!confirm(`"${nm}" 이름의 모형이 이미 있어요.\n덮어쓸까요?\n\n[취소]를 누르면 다른 이름으로 다시 저장하세요.`)) {
            showToast('덮어쓰기 취소 — 다른 이름으로 다시 저장하세요', 'info');
            return;
        }
        Object.assign(existing, snapData());
    } else {
        S.snapshots.push({ id: genId(), name: nm, ...snapData() });
    }
    await mmSaveToDB();
    mmUpdateSnapList();
    showToast(`"${nm}" ${existing ? '덮어썼습니다' : '저장됐습니다'}`, 'success');
}

function mmLoadSnap(snapId) {
    const snap = S.snapshots.find(s => s.id === snapId);
    if (!snap) return;
    if (!confirm(`"${snap.name}"을 불러올까요?\n현재 캔버스는 Ctrl+Z로 되돌릴 수 있습니다.`)) return;
    saveHistory();
    S.nodes = JSON.parse(JSON.stringify(snap.nodes));
    S.edges = JSON.parse(JSON.stringify(snap.edges));
    S.groups = JSON.parse(JSON.stringify(snap.groups || []));
    S.sel = null;
    mmRender(); mmSaveToDB();
    showToast(`"${snap.name}" 불러왔습니다`, 'success');
}

async function mmDeleteSelectedSnaps() {
    const cbs = document.querySelectorAll('.mm-snap-cb:checked');
    if (!cbs.length) { showToast('삭제할 모형을 선택해주세요.', 'warn'); return; }
    const ids = [...cbs].map(cb => cb.value);
    const names = ids.map(id => S.snapshots.find(s => s.id === id)?.name).filter(Boolean);
    if (!confirm(`모형 ${ids.length}개를 삭제할까요?\n\n${names.join(', ')}`)) return;
    S.snapshots = S.snapshots.filter(s => !ids.includes(s.id));
    await mmSaveToDB();
    mmUpdateSnapList();
    showToast(`모형 ${ids.length}개가 삭제되었습니다.`, 'success');
}

function mmUpdateSnapList() {
    const wrap = document.getElementById('mm-snap-list');
    const delBtn = document.getElementById('mm-snap-del-sel');
    if (!wrap) return;
    const snaps = [...S.snapshots].reverse();
    if (!snaps.length) {
        wrap.innerHTML = '<div class="mm-snap-empty">저장된 모형이 없습니다</div>';
        if (delBtn) delBtn.style.display = 'none';
        return;
    }
    if (delBtn) delBtn.style.display = '';
    wrap.innerHTML = snaps.map(s => {
        const date = s.savedAt ? new Date(s.savedAt).toLocaleDateString('ko-KR', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '';
        return `
        <div class="mm-snap-item">
            <input type="checkbox" class="mm-snap-cb" value="${s.id}">
            <button class="mm-snap-load" data-id="${s.id}" title="이 모형 불러오기">${escHtml(s.name)}</button>
            ${date ? `<span class="mm-snap-date">${date}</span>` : ''}
        </div>`;
    }).join('');
    wrap.querySelectorAll('.mm-snap-load').forEach(btn => {
        btn.addEventListener('click', () => mmLoadSnap(btn.dataset.id));
    });
}

// ── PNG 내보내기 ──────────────────────────────────────────────────────
// 모형을 PNG dataURL로 렌더해서 돌려줌(도형 없으면 null). 다운로드(mmExport)와 PPT(mmExportPPT)가 재사용.
function mmRenderModelPNG() {
  return new Promise((resolve, reject) => {
    if (!S || (S.nodes.length === 0 && S.groups.length === 0)) { resolve(null); return; }

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
        resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('PNG 변환 실패')); };
    img.src = url;
  });
}

// 모형을 PNG 파일로 다운로드 (🖼 버튼)
async function mmExport() {
    let dataUrl;
    try { dataUrl = await mmRenderModelPNG(); }
    catch { showToast('PNG 변환 실패', 'error'); return; }
    if (!dataUrl) { showToast('도형이 없습니다', 'error'); return; }
    const a = document.createElement('a');
    a.download = '연구모형.png'; a.href = dataUrl; a.click();
    showToast('연구모형.png 저장됐습니다', 'success');
}

// ── 📊 PPT 미리보기 + .pptx 내보내기 ─────────────────────────────────
// PptxGenJS는 내보낼 때만 동적 로드(앱 무게 안 늘림). 슬라이드 = 프로포절 + 연구모형 그림.
function loadPptxLib() {
    return new Promise((resolve, reject) => {
        if (window.PptxGenJS) return resolve(window.PptxGenJS);
        const s = document.createElement('script');
        s.src = 'pptxgen.bundle.js';
        s.onload = () => window.PptxGenJS ? resolve(window.PptxGenJS) : reject(new Error('PptxGenJS 전역 없음'));
        s.onerror = () => reject(new Error('pptxgen.bundle.js 를 찾을 수 없어요'));
        document.head.appendChild(s);
    });
}

// 슬라이드 정의 — 지도 양식(미니 프로포절 6장) 기준. body=채운 내용, guide=빈칸 안내문(회색).
function pptSlideDefs() {
    const p = state.proposal || {};
    const hyps = (p.hypotheses || []).filter(h => h && (h.text || '').trim()).map((h, i) => `H${i + 1}. ${h.text.trim()}`);
    const j2 = (a, b) => [a, b].filter(v => v && String(v).trim()).join('\n\n');
    const subj = (p.subjects || '').trim(), meth = (p.method || '').trim();
    return [
        { kind: 'title', title: (p.title || '').trim() || '[연구 제목]', sub: (p.subtitle || '').trim() },
        { kind: 'text', head: '연구의 필요성 및 목적',
          body: j2((p.needs || '').trim(), (p.purpose || '').trim()),
          guide: '이 주제를 연구해야 하는 이유는 무엇인지 서술합니다.\n\n(이 주제가 상담/정신건강 분야에서 왜 중요한지, 선행연구의 한계는 무엇인지, 본 연구에서 그러한 한계를 어떻게 해결하고자 하는지)' },
        { kind: 'text', head: '이론적 배경',
          body: (p.theory || '').trim(),
          guide: '· 주요 연구 변인 개념 정의\n· 연구 변인에 대한 이론 및 선행연구 결과들\n   - 본 연구와 관련되는 주요한 내용들 위주로 제시합니다\n   - 인용한 내용이라면 참고문헌(저자명, 연도)도 표기합니다\n· 선행연구들을 기반으로, 연구자는 어떤 예측을 하였는가?' },
        { kind: 'hyps-model', head: '연구 문제 및 가설',
          items: hyps,
          guide: '본 연구의 문제와 가설(또는 연구질문)을 작성합니다.\n(질적 연구라면 ‘연구 질문’ 기술 / 필요시 연구모형 그림을 제시)' },
        { kind: 'text', head: '연구 방법',
          body: j2(subj ? '◾ 연구대상\n' + subj : '', meth ? '◾ 연구절차 및 분석 방법\n' + meth : ''),
          guide: '· 연구대상\n   - 연령/인원수 등\n· 연구절차 및 분석 방법\n   - 질적연구라면, 자료 수집 방법과 자료 분석 방법 제시\n   - 양적연구라면, 측정도구와 분석방법 제시' },
        { kind: 'text', head: '기대 효과',
          body: (p.expected || '').trim(),
          guide: '본 연구의 결과가 상담 및 심리치료 연구 및 실무 영역에 기여할 수 있는 점은 무엇인지 기술합니다.' },
    ];
}

async function mmOpenPPT() {
    const defs = pptSlideDefs();
    const overlay = document.createElement('div');
    overlay.className = 'ppt-overlay';
    overlay.innerHTML = `
        <div class="ppt-topbar">
            <span class="ppt-title">${icon('bar-chart', 15)} 발표자료 만들기</span>
            <div class="ppt-nav">
                <button type="button" class="ppt-prev" title="이전 슬라이드 (←)">◀ 이전</button>
                <span class="ppt-counter">1 / ${defs.length}</span>
                <button type="button" class="ppt-next" title="다음 슬라이드 (→)">다음 ▶</button>
            </div>
            <div class="ppt-actions">
                <button type="button" class="ppt-export btn-primary">⬇ PPT로 내보내기 (.pptx)</button>
                <button type="button" class="ppt-close btn-secondary">닫기 ✕</button>
            </div>
        </div>
        <div class="ppt-deck ppt-deck-single" id="ppt-deck">
            ${defs.map((d, i) => pptSlideHTML(d, i)).join('')}
        </div>`;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // 한 장씩 넘겨 보기 — 현재 슬라이드만 표시(◀/▶ 버튼·좌우 화살표 키)
    const deck    = overlay.querySelector('#ppt-deck');
    const slides  = [...overlay.querySelectorAll('.ppt-slide')];
    const counter = overlay.querySelector('.ppt-counter');
    const prevBtn = overlay.querySelector('.ppt-prev');
    const nextBtn = overlay.querySelector('.ppt-next');
    let cur = 0;
    const showSlide = i => {
        cur = Math.max(0, Math.min(slides.length - 1, i));
        slides.forEach((s, k) => s.classList.toggle('is-current', k === cur));
        counter.textContent = `${cur + 1} / ${slides.length}`;
        prevBtn.disabled = cur === 0;
        nextBtn.disabled = cur === slides.length - 1;
        deck.scrollTop = 0;
    };
    prevBtn.onclick = () => showSlide(cur - 1);
    nextBtn.onclick = () => showSlide(cur + 1);
    showSlide(0);

    const close = () => { overlay.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); };
    overlay.querySelector('.ppt-close').onclick = close;
    overlay.querySelector('.ppt-export').onclick = () => mmExportPPT(overlay);
    const onKey = e => {
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowLeft')  showSlide(cur - 1);
        else if (e.key === 'ArrowRight') showSlide(cur + 1);
    };
    document.addEventListener('keydown', onKey);

    // 모형 그림은 비동기로 채움
    try {
        const png = await mmRenderModelPNG();
        const holder = overlay.querySelector('.ppt-model-img');
        if (holder) holder.innerHTML = png
            ? `<img src="${png}" alt="연구 모형">`
            : `<div class="ppt-empty">아직 모형(도형)이 없어요 — ${icon('nodes', 13)} 모형에서 그려보세요</div>`;
    } catch {}
}

function pptSlideHTML(d, i) {
    let inner = '';
    if (d.kind === 'title') {
        inner = `<div class="ppt-s-title">${escHtml(d.title)}</div>`
              + (d.sub ? `<div class="ppt-s-sub">— ${escHtml(d.sub)} —</div>` : '')
              + `<div class="ppt-s-presenter">발표자</div>`;
    } else if (d.kind === 'hyps-model') {
        const hyp = d.items.length
            ? d.items.map(t => `<div class="ppt-hyp">${escHtml(t)}</div>`).join('')
            : `<div class="ppt-guide">${escHtml(d.guide)}</div>`;
        inner = `<div class="ppt-s-head">${escHtml(d.head)}</div>`
              + `<div class="ppt-s-body ppt-hm"><div class="ppt-hm-text">${hyp}</div>`
              + `<div class="ppt-model-img"><div class="ppt-muted">모형 불러오는 중…</div></div></div>`;
    } else {
        const body = d.body
            ? `<div>${escHtml(d.body)}</div>`
            : `<div class="ppt-guide">${escHtml(d.guide)}</div>`;
        inner = `<div class="ppt-s-head">${escHtml(d.head)}</div><div class="ppt-s-body">${body}</div>`;
    }
    return `<div class="ppt-slide ${d.kind === 'title' ? 'ppt-slide-title' : ''}"><div class="ppt-slide-no">${i + 1}</div>${inner}</div>`;
}

async function mmExportPPT(overlay) {
    let Pptx;
    try { Pptx = await loadPptxLib(); }
    catch (e) { showToast('PPT 라이브러리 로드 실패: ' + e.message, 'error'); return; }
    showToast('PPT 만드는 중…', 'info');

    const p = state.proposal || {};
    const pptx = new Pptx();
    pptx.layout = 'LAYOUT_WIDE';   // 13.33 x 7.5 inch
    const BLUE = '1a73e8', DARK = '2b2b2b', RED = 'b03a3a', BODY = '333333';
    const W = 13.33;

    const GRAY = '808080';
    const head = (sl, t) => sl.addText(t, { x: 0.6, y: 0.4, w: W - 1.2, h: 0.8, fontSize: 28, bold: true, color: BLUE });
    // 채운 내용은 진하게, 빈칸은 양식 안내문을 회색·이탤릭으로
    const fillOrGuide = (sl, body, guide, y, h) => {
        const has = !!(body && body.trim());
        sl.addText(has ? body : guide, { x: 0.7, y, w: W - 1.4, h, fontSize: has ? 18 : 15,
            color: has ? BODY : GRAY, italic: !has, valign: 'top' });
    };
    const imgDims = dataUrl => new Promise(res => {
        const im = new Image();
        im.onload = () => res({ w: im.naturalWidth || 16, h: im.naturalHeight || 9 });
        im.onerror = () => res({ w: 16, h: 9 });
        im.src = dataUrl;
    });

    for (const d of pptSlideDefs()) {
        const sl = pptx.addSlide();
        if (d.kind === 'title') {
            sl.addText(d.title, { x: 0.5, y: 2.4, w: W - 1, h: 1.6, fontSize: 40, bold: true, align: 'center', color: DARK });
            if (d.sub) sl.addText('— ' + d.sub + ' —', { x: 0.5, y: 4.0, w: W - 1, h: 0.7, fontSize: 22, align: 'center', color: RED });
            sl.addText('발표자', { x: 0.5, y: 6.3, w: W - 1, h: 0.5, fontSize: 16, align: 'center', color: GRAY });
        } else if (d.kind === 'hyps-model') {
            head(sl, d.head);
            fillOrGuide(sl, d.items.join('\n'), d.guide, 1.4, 1.9);
            let png = null;
            try { png = await mmRenderModelPNG(); } catch {}
            if (png) {
                const dm = await imgDims(png);
                const boxW = W - 1.4, boxH = 3.5, boxY = 3.45;
                let iw = boxW, ih = boxW * dm.h / dm.w;
                if (ih > boxH) { ih = boxH; iw = boxH * dm.w / dm.h; }
                sl.addImage({ data: png, x: 0.7 + (boxW - iw) / 2, y: boxY + (boxH - ih) / 2, w: iw, h: ih });
            }
        } else {
            head(sl, d.head);
            fillOrGuide(sl, d.body, d.guide, 1.5, 5.3);
        }
    }
    const fname = ((p.title || '').trim() || '연구_프로포절') + '.pptx';
    try {
        await pptx.writeFile({ fileName: fname });
        showToast('PPT로 내보냈어요 ✅', 'success');
    } catch (e) {
        showToast('PPT 저장 실패: ' + e.message, 'error');
    }
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
// 지도 양식(미니 프로포절 6장) 기준. 순서: 필요성·목적·이론적배경·대상·방법·기대효과 (가설은 아래 별도)
const PROP_FIELDS = [
    ['needs',    '연구 필요성',  '왜 이 연구가 필요한가? 문제의식·배경'],
    ['purpose',  '연구 목적',    '이 연구로 무엇을 밝히려 하는가?'],
    ['theory',   '이론적 배경',  '주요 변인 개념 정의 · 이론/선행연구 결과 · 연구자의 예측'],
    ['subjects', '연구 대상',    '누구를 대상으로? 표본·연령·인원수'],
    ['method',   '연구 방법',    '연구 절차·측정도구·분석 방법 (질적/양적)'],
    ['expected', '기대 효과',    '상담·심리치료 연구/실무에 기여하는 점'],
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
    btn.classList.toggle('active', academic);
    btn.title = academic ? '학술용 보기 (흑백·발표용) — 눌러서 작업용으로' : '작업용 보기 (컬러) — 눌러서 학술용으로';
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

    // 제목 지우기 버튼
    const clearBtn = document.getElementById('mm-title-clear');
    if (clearBtn) {
        clearBtn.onclick = () => {
            tEl.textContent = ''; sEl.textContent = '';
            if (state.proposal) { state.proposal.title = ''; state.proposal.subtitle = ''; queueSaveProposal(); }
            tEl.focus();
        };
    }
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
            <span>${icon('note', 14)} 미니 프로포절</span>
            <button class="mm-prop-reset" id="mm-prop-reset" title="프로포절 전체 초기화">초기화</button>
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

    // 프로포절 초기화
    panel.querySelector('#mm-prop-reset').onclick = async () => {
        if (!confirm('미니 프로포절의 모든 내용을 초기화할까요?\n(가설 포함 전부 삭제됩니다)')) return;
        const blank = { id: state.currentProjectId };
        PROP_FIELDS.forEach(([key]) => { blank[key] = ''; });
        blank.hypotheses = [];
        blank.title = ''; blank.subtitle = '';
        state.proposal = blank;
        await saveProposalNow();
        mmRenderProp();
        mmInitTitle();
        showToast('프로포절을 초기화했습니다.', 'success');
    };

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
