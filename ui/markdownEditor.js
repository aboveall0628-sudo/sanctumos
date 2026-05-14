/**
 * markdownEditor.js — 묵상·기도 노트 인라인 포맷 에디터 (백로그 #23, 갈래 C 1차)
 *
 * 적용 대상: contenteditable div (meditation-note · prayer-note)
 * 1차 범위 (이번 세션):
 *   - 인라인: 볼드 / 기울임 / 취소선
 *   - 블록 헤딩: H1 / H2 / H3 / 일반 문단
 *   - 가로줄(hr)
 *   - 노션 표준 단축키
 *   - 줄 시작 마크다운 자동 변환 (# / ## / ### / ---)
 *   - 인라인 마크다운 자동 변환 (**X** / *X* / ~~X~~)
 *   - 우클릭 컨텍스트 메뉴 (단축키 라벨 항상 노출)
 *
 * 저장 모델: Markdown string
 *   - editor.innerHTML ↔ markdown 변환 (htmlToMarkdown / markdownToHtml)
 *   - 기존 plain text 노트는 그대로 호환 (마크다운 안 깨짐)
 *
 * 다음 매듭 (백로그 #23 후속):
 *   - 리스트 (1. 2. 3. / - / *)
 *   - 토글 (>)
 *   - 노션식 블록 모델
 */

// ═══════════════════════════════════════════════════════════════════════
//  공개 API
// ═══════════════════════════════════════════════════════════════════════

/**
 * contenteditable element 에 마크다운 에디터 기능 부착.
 * 같은 element 에 중복 부착 차단.
 * @param {HTMLElement} editor - contenteditable=true 인 div
 * @param {Object} [opts]
 * @param {Function} [opts.onChange] - 내용 변경 시 호출 (markdown string 인자)
 */
export function bindMarkdownEditor(editor, opts = {}) {
    if (!editor) return;
    if (editor.dataset.mdBound === '1') return;
    editor.dataset.mdBound = '1';
    const onChange = typeof opts.onChange === 'function' ? opts.onChange : () => {};

    // 단축키
    editor.addEventListener('keydown', (e) => handleKeydown(e, editor, onChange));
    // 마크다운 자동 변환 (입력 후)
    editor.addEventListener('input', () => {
        runInlineMarkdownTransforms(editor);
        runBlockMarkdownTransforms(editor);
        onChange(getMarkdown(editor));
    });
    // 우클릭 메뉴
    editor.addEventListener('contextmenu', (e) => handleContextMenu(e, editor, onChange));
    // paste 는 todayView 에서 별도 처리 — 여기선 안 건드림
}

/**
 * editor 의 현재 내용을 markdown string 으로 반환.
 */
export function getMarkdown(editor) {
    if (!editor) return '';
    return htmlToMarkdown(editor.innerHTML).trim();
}

/**
 * markdown string 으로 editor 채우기 (로드 시).
 * 빈 문자열이거나 마크다운 패턴 없으면 그대로 텍스트로.
 */
export function setMarkdown(editor, md) {
    if (!editor) return;
    editor.innerHTML = markdownToHtml(md || '');
}

// ═══════════════════════════════════════════════════════════════════════
//  단축키
// ═══════════════════════════════════════════════════════════════════════

function handleKeydown(e, editor, onChange) {
    // (2026-05-14 #23 2차) Enter 자동 이어쓰기 — 리스트·토글 안에서 Enter
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (handleToggleEnter(editor, onChange)) {
            e.preventDefault();
            return;
        }
        if (handleListEnter(editor, onChange)) {
            e.preventDefault();
            return;
        }
    }

    // (2026-05-14 #23 2차) Tab / Shift+Tab — 리스트 들여쓰기 / 내어쓰기 (노션식)
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (handleListTab(editor, e.shiftKey, onChange)) {
            e.preventDefault();
            return;
        }
    }

    const cmdKey = e.ctrlKey || e.metaKey;
    if (!cmdKey) return;
    const k = (e.key || '').toLowerCase();

    // Ctrl+Alt+0~3 = 블록 변환
    if (e.altKey) {
        if (k === '1') { e.preventDefault(); setBlockTag(editor, 'H1'); onChange(getMarkdown(editor)); return; }
        if (k === '2') { e.preventDefault(); setBlockTag(editor, 'H2'); onChange(getMarkdown(editor)); return; }
        if (k === '3') { e.preventDefault(); setBlockTag(editor, 'H3'); onChange(getMarkdown(editor)); return; }
        if (k === '0') { e.preventDefault(); setBlockTag(editor, 'DIV'); onChange(getMarkdown(editor)); return; }
        return;
    }

    // (2026-05-14 #23 2차) 노션 표준 단축키 — Ctrl+Shift+7 번호, Ctrl+Shift+8 점
    if (e.shiftKey && k === '7') {
        e.preventDefault();
        toggleList(editor, 'OL');
        onChange(getMarkdown(editor));
        return;
    }
    if (e.shiftKey && k === '8') {
        e.preventDefault();
        toggleList(editor, 'UL');
        onChange(getMarkdown(editor));
        return;
    }
    // Ctrl+Shift+S = 취소선
    if (e.shiftKey && k === 's') {
        e.preventDefault();
        document.execCommand('strikeThrough');
        onChange(getMarkdown(editor));
        return;
    }
    // Ctrl+B / Ctrl+I
    if (k === 'b') {
        e.preventDefault();
        document.execCommand('bold');
        onChange(getMarkdown(editor));
        return;
    }
    if (k === 'i') {
        e.preventDefault();
        document.execCommand('italic');
        onChange(getMarkdown(editor));
        return;
    }
}

// (2026-05-14 #23 2차) summary 안 또는 details body 안에서 Enter 처리
//   - summary 끝 Enter → details 안 body div 만들고 caret 이동 (본문이 details 자식이 되도록)
//   - body 안 빈 줄 Enter → details 밖으로 빠져나감 (토글 종료)
function handleToggleEnter(editor, onChange) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === 3) node = node.parentElement;
    // case 1: caret 이 summary 안
    let summary = node;
    while (summary && summary !== editor && summary.tagName !== 'SUMMARY') summary = summary.parentElement;
    if (summary && summary !== editor) {
        const details = summary.parentElement;
        if (!details || details.tagName !== 'DETAILS') return false;
        // details 안에 새 body 줄 추가 (이미 있으면 그 끝)
        const newLine = document.createElement('div');
        newLine.innerHTML = '<br>';
        details.appendChild(newLine);
        const r = document.createRange();
        r.selectNodeContents(newLine);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
        onChange(getMarkdown(editor));
        return true;
    }
    // case 2: caret 이 details 안 body 줄 (summary 가 아닌 다른 자식)
    let inDetailsBody = null;
    let cur = node;
    while (cur && cur !== editor) {
        if (cur.tagName === 'DETAILS') { inDetailsBody = cur; break; }
        cur = cur.parentElement;
    }
    if (inDetailsBody) {
        // 빈 줄에서 Enter → details 밖으로 빠져나가는 새 div
        const text = (node.textContent || '').trim();
        if (text === '') {
            const empty = document.createElement('div');
            empty.innerHTML = '<br>';
            inDetailsBody.parentNode.insertBefore(empty, inDetailsBody.nextSibling);
            // 빈 줄 노드 제거
            if (node !== summary && node.tagName === 'DIV' && !node.querySelector('summary')) {
                node.remove();
            }
            const r = document.createRange();
            r.selectNodeContents(empty);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
            onChange(getMarkdown(editor));
            return true;
        }
    }
    return false;
}

// (2026-05-14 #23 2차) Tab / Shift+Tab — 리스트 항목 들여쓰기·내어쓰기 (노션식)
//   Tab: 현재 li 를 이전 li 의 자식 ul/ol 로 옮김 (없으면 새 nested 생성)
//   Shift+Tab: 현재 li 를 부모 li 의 다음 sibling 으로 (이미 root 면 무동작)
function handleListTab(editor, isShift, onChange) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === 3) node = node.parentElement;
    let li = node;
    while (li && li !== editor && li.tagName !== 'LI') li = li.parentElement;
    if (!li || li === editor) return false;
    const parentList = li.parentElement;
    if (!parentList || !/^(UL|OL)$/.test(parentList.tagName)) return false;

    if (isShift) {
        // outdent — 부모 li 의 다음 sibling 으로
        const parentLi = parentList.parentElement;
        if (!parentLi || parentLi.tagName !== 'LI') return false; // 이미 최상위
        const grandList = parentLi.parentElement;
        if (!grandList || !/^(UL|OL)$/.test(grandList.tagName)) return false;
        grandList.insertBefore(li, parentLi.nextSibling);
        // 빈 parentList 제거
        if (parentList.querySelectorAll(':scope > li').length === 0) parentList.remove();
        moveCaretToEnd(sel, li);
        onChange(getMarkdown(editor));
        return true;
    } else {
        // indent — 이전 li 의 자식 ul/ol 로
        const prev = li.previousElementSibling;
        if (!prev || prev.tagName !== 'LI') return false; // 첫 항목 — indent 불가
        const listTag = parentList.tagName.toLowerCase();
        let nestedList = prev.querySelector(`:scope > ${listTag}`);
        if (!nestedList) {
            nestedList = document.createElement(listTag);
            prev.appendChild(nestedList);
        }
        nestedList.appendChild(li);
        moveCaretToEnd(sel, li);
        onChange(getMarkdown(editor));
        return true;
    }
}

// (2026-05-14 #23 2차) 빈 li 에서 Enter — 노션식 흐름:
//   · nested 안이면 한 단계 outdent (부모 li 다음 sibling 으로)
//   · root level 이면 리스트 종료 (일반 div 로 빠져나감)
// 사용자가 nested 깊이만큼 연속 Enter → 결국 일반 문단으로 빠져나감
function handleListEnter(editor, onChange) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return false;
    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === 3) node = node.parentElement;
    let li = node;
    while (li && li !== editor && li.tagName !== 'LI') li = li.parentElement;
    if (!li || li === editor) return false;
    const text = (li.textContent || '').trim();
    if (text !== '') return false; // 내용 있으면 기본 동작 (새 li)
    const parentList = li.parentElement; // UL/OL
    if (!parentList || !/^(UL|OL)$/.test(parentList.tagName)) return false;

    // nested 안인지 체크 — parentList 의 부모가 LI 면 nested
    const parentLi = parentList.parentElement;
    if (parentLi && parentLi.tagName === 'LI') {
        const grandList = parentLi.parentElement;
        if (grandList && /^(UL|OL)$/.test(grandList.tagName)) {
            // outdent — 빈 li 를 parentLi 다음 sibling 으로
            grandList.insertBefore(li, parentLi.nextSibling);
            if (parentList.querySelectorAll(':scope > li').length === 0) parentList.remove();
            moveCaretToEnd(sel, li);
            onChange(getMarkdown(editor));
            return true;
        }
    }

    // root level 빈 li — 리스트 종료
    const empty = document.createElement('div');
    empty.innerHTML = '<br>';
    parentList.parentNode.insertBefore(empty, parentList.nextSibling);
    li.remove();
    if (parentList.querySelectorAll(':scope > li').length === 0) parentList.remove();
    const sel2 = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(empty);
    r.collapse(true);
    sel2.removeAllRanges();
    sel2.addRange(r);
    onChange(getMarkdown(editor));
    return true;
}

// (2026-05-14 #23 2차) 단축키로 리스트 토글 — 현재 블록을 UL/OL 로 변환
function toggleList(editor, listTag) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === 3) node = node.parentElement;
    // 이미 같은 list 안이면 li 만 풀어 div 로
    let li = node;
    while (li && li !== editor && li.tagName !== 'LI') li = li.parentElement;
    if (li && li !== editor) {
        const list = li.parentElement;
        if (list && list.tagName === listTag) {
            // 풀기 — li 내용을 div 로 추출 후 li 제거
            const div = document.createElement('div');
            while (li.firstChild) div.appendChild(li.firstChild);
            list.parentNode.insertBefore(div, list.nextSibling);
            li.remove();
            if (list.querySelectorAll(':scope > li').length === 0) list.remove();
            moveCaretToEnd(sel, div);
            return;
        }
    }
    // 현재 블록을 li 로 wrap
    let block = node;
    while (block && block !== editor && !/^(H1|H2|H3|DIV|P|LI)$/.test(block.tagName)) {
        block = block.parentElement;
    }
    if (!block || block === editor) return;
    const text = block.textContent || '';
    const list = document.createElement(listTag.toLowerCase());
    const newLi = document.createElement('li');
    newLi.textContent = text;
    list.appendChild(newLi);
    block.parentNode.replaceChild(list, block);
    moveCaretToEnd(sel, newLi);
}

// 현재 caret 이 들어있는 블록 element 를 새 tag 로 교체
function setBlockTag(editor, tag) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    let node = range.startContainer;
    if (node.nodeType === 3) node = node.parentElement;
    // editor 안의 직속 블록 찾기 (h1/h2/h3/div/p)
    let block = node;
    while (block && block !== editor && !/^(H1|H2|H3|DIV|P)$/.test(block.tagName)) {
        block = block.parentElement;
    }
    if (!block || block === editor) {
        // 블록이 없으면 editor 직속 텍스트 — div 로 감싸기
        const wrap = document.createElement(tag.toLowerCase());
        while (editor.firstChild) wrap.appendChild(editor.firstChild);
        editor.appendChild(wrap);
        return;
    }
    if (block.tagName === tag) return; // 이미 같은 tag
    const replacement = document.createElement(tag.toLowerCase());
    while (block.firstChild) replacement.appendChild(block.firstChild);
    block.parentNode.replaceChild(replacement, block);
    // caret 복원
    try {
        const newRange = document.createRange();
        newRange.selectNodeContents(replacement);
        newRange.collapse(false);
        sel.removeAllRanges();
        sel.addRange(newRange);
    } catch {}
}

// ═══════════════════════════════════════════════════════════════════════
//  마크다운 자동 변환 (입력 중)
// ═══════════════════════════════════════════════════════════════════════

// 줄 시작 `# ` / `## ` / `### ` / `---` / `- ` / `1. ` / `> ` 처리
function runBlockMarkdownTransforms(editor) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const node = sel.getRangeAt(0).startContainer;
    if (node.nodeType !== 3) return;
    const block = findBlockAncestor(node, editor);
    if (!block || block === editor) return;
    const text = block.textContent || '';

    // 헤딩 — 줄 시작 # / ## / ### + 공백
    const headingMatch = text.match(/^(#{1,3})\s(.*)$/);
    if (headingMatch && /^(DIV|P)$/.test(block.tagName)) {
        const level = headingMatch[1].length;
        const h = document.createElement('h' + level);
        h.textContent = headingMatch[2];
        block.parentNode.replaceChild(h, block);
        moveCaretToEnd(sel, h);
        return;
    }
    // 가로줄 — `---`
    if (text === '---' && /^(DIV|P)$/.test(block.tagName)) {
        const hr = document.createElement('hr');
        const after = document.createElement('div');
        after.innerHTML = '<br>';
        block.parentNode.replaceChild(hr, block);
        hr.parentNode.insertBefore(after, hr.nextSibling);
        moveCaretToStart(sel, after);
        return;
    }
    // (2026-05-14 #23 2차) 점 리스트 — `- ` 또는 `* `
    const ulMatch = text.match(/^[-*]\s(.*)$/);
    if (ulMatch && /^(DIV|P)$/.test(block.tagName)) {
        const ul = document.createElement('ul');
        const li = document.createElement('li');
        li.textContent = ulMatch[1];
        ul.appendChild(li);
        block.parentNode.replaceChild(ul, block);
        moveCaretToEnd(sel, li);
        return;
    }
    // 번호 리스트 — `1. `
    const olMatch = text.match(/^(\d+)\.\s(.*)$/);
    if (olMatch && /^(DIV|P)$/.test(block.tagName)) {
        const ol = document.createElement('ol');
        const li = document.createElement('li');
        li.textContent = olMatch[2];
        // 시작 번호 보존 (1 이 아니면)
        const startNum = parseInt(olMatch[1], 10);
        if (!isNaN(startNum) && startNum !== 1) ol.setAttribute('start', String(startNum));
        ol.appendChild(li);
        block.parentNode.replaceChild(ol, block);
        moveCaretToEnd(sel, li);
        return;
    }
    // 토글 — `> ` 줄 시작 (본문 자리도 미리 — Enter 시 거기로 떨어짐)
    const tgMatch = text.match(/^>\s(.*)$/);
    if (tgMatch && /^(DIV|P)$/.test(block.tagName)) {
        const details = document.createElement('details');
        details.open = true;
        const summary = document.createElement('summary');
        summary.textContent = tgMatch[1];
        const body = document.createElement('div');
        body.innerHTML = '<br>';
        details.appendChild(summary);
        details.appendChild(body);
        block.parentNode.replaceChild(details, block);
        moveCaretToEnd(sel, summary);
        return;
    }
}

function moveCaretToEnd(sel, el) {
    try {
        const r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
    } catch {}
}
function moveCaretToStart(sel, el) {
    try {
        const r = document.createRange();
        r.selectNodeContents(el);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
    } catch {}
}

// 인라인 `**X**` / `*X*` / `~~X~~` 자동 변환 — caret 직전 패턴만 체크
function runInlineMarkdownTransforms(editor) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== 3) return;
    const offset = range.startOffset;
    const text = node.nodeValue || '';
    const before = text.slice(0, offset);

    // 가장 가까운 닫는 패턴 한 개만 처리 (한 번 입력에 한 번 변환)
    // 우선순위: ~~ > ** > * (긴 마커 먼저)
    const patterns = [
        { open: '~~', close: '~~', tag: 's' },
        { open: '**', close: '**', tag: 'strong' },
        { open: '*',  close: '*',  tag: 'em' },
        { open: '_',  close: '_',  tag: 'em' },
    ];
    for (const p of patterns) {
        if (!before.endsWith(p.close)) continue;
        // 닫는 마커 직전에 같은 길이의 여는 마커가 있는지 — 텍스트 내용 1자 이상
        const innerStart = before.lastIndexOf(p.open, before.length - p.close.length - 1);
        if (innerStart < 0) continue;
        const inner = before.slice(innerStart + p.open.length, before.length - p.close.length);
        if (!inner || inner.length === 0) continue;
        // ** 가 * 와 충돌 — open === close 같으니 두 마커가 서로 다른 위치인지 확인
        if (innerStart + p.open.length === before.length - p.close.length) continue;
        // 변환: text 의 [innerStart..offset] 구간을 <tag>inner</tag> 로 교체
        const wrap = document.createElement(p.tag);
        wrap.textContent = inner;
        const after = node.nodeValue.slice(offset);
        // 노드 분리
        const beforeText = text.slice(0, innerStart);
        node.nodeValue = beforeText;
        const parent = node.parentNode;
        const afterNode = document.createTextNode(after);
        parent.insertBefore(wrap, node.nextSibling);
        parent.insertBefore(afterNode, wrap.nextSibling);
        // caret 을 afterNode 시작으로
        try {
            const r = document.createRange();
            r.setStart(afterNode, 0);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
        } catch {}
        return;
    }
}

function findBlockAncestor(node, editor) {
    let cur = node.nodeType === 3 ? node.parentElement : node;
    while (cur && cur !== editor && !/^(H1|H2|H3|DIV|P)$/.test(cur.tagName)) {
        cur = cur.parentElement;
    }
    return cur;
}

// ═══════════════════════════════════════════════════════════════════════
//  우클릭 컨텍스트 메뉴
// ═══════════════════════════════════════════════════════════════════════

let _activeMenu = null;

function handleContextMenu(e, editor, onChange) {
    e.preventDefault();
    closeContextMenu();
    const menu = document.createElement('div');
    menu.className = 'md-context-menu';
    menu.innerHTML = `
        <button type="button" data-cmd="bold">          <span class="md-mi-icon"><b>B</b></span>볼드        <kbd>Ctrl+B</kbd></button>
        <button type="button" data-cmd="italic">        <span class="md-mi-icon"><i>I</i></span>기울임      <kbd>Ctrl+I</kbd></button>
        <button type="button" data-cmd="strikeThrough"> <span class="md-mi-icon"><s>S</s></span>취소선      <kbd>Ctrl+Shift+S</kbd></button>
        <div class="md-menu-sep"></div>
        <button type="button" data-block="H1">          <span class="md-mi-icon">H1</span>제목 1      <kbd>Ctrl+Alt+1</kbd></button>
        <button type="button" data-block="H2">          <span class="md-mi-icon">H2</span>제목 2      <kbd>Ctrl+Alt+2</kbd></button>
        <button type="button" data-block="H3">          <span class="md-mi-icon">H3</span>제목 3      <kbd>Ctrl+Alt+3</kbd></button>
        <button type="button" data-block="DIV">         <span class="md-mi-icon">¶</span>일반 문단   <kbd>Ctrl+Alt+0</kbd></button>
        <div class="md-menu-sep"></div>
        <button type="button" data-list="UL">           <span class="md-mi-icon">•</span>점 리스트   <kbd>Ctrl+Shift+8</kbd></button>
        <button type="button" data-list="OL">           <span class="md-mi-icon">1.</span>번호 리스트 <kbd>Ctrl+Shift+7</kbd></button>
        <button type="button" data-action="toggle">     <span class="md-mi-icon">▸</span>토글 블록</button>
        <div class="md-menu-sep"></div>
        <button type="button" data-action="hr">         <span class="md-mi-icon">─</span>가로줄 넣기</button>
    `;
    document.body.appendChild(menu);
    // 위치 보정 — 뷰포트 안으로
    const x = Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 8);
    const y = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 8);
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';
    _activeMenu = menu;

    // 버튼 클릭 핸들러 — mousedown 으로 selection 잃기 전에 처리
    menu.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('mousedown', (ev) => {
            ev.preventDefault(); // 포커스 이동 차단 — selection 유지
        });
        btn.addEventListener('click', () => {
            const cmd = btn.dataset.cmd;
            const block = btn.dataset.block;
            const list = btn.dataset.list;
            const action = btn.dataset.action;
            editor.focus();
            if (cmd)   document.execCommand(cmd);
            if (block) setBlockTag(editor, block);
            if (list)  toggleList(editor, list);
            if (action === 'hr') insertHr(editor);
            if (action === 'toggle') insertToggle(editor);
            onChange(getMarkdown(editor));
            closeContextMenu();
        });
    });

    // 외부 클릭 / Esc 닫기
    setTimeout(() => {
        document.addEventListener('mousedown', closeOnOutside, true);
        document.addEventListener('keydown', closeOnEsc, true);
    }, 0);
}

function closeOnOutside(e) {
    if (_activeMenu && !_activeMenu.contains(e.target)) closeContextMenu();
}
function closeOnEsc(e) {
    if (e.key === 'Escape') closeContextMenu();
}
function closeContextMenu() {
    if (_activeMenu) {
        _activeMenu.remove();
        _activeMenu = null;
        document.removeEventListener('mousedown', closeOnOutside, true);
        document.removeEventListener('keydown', closeOnEsc, true);
    }
}

// (2026-05-14 #23 2차) 토글 블록 삽입 — <details><summary>제목</summary><div>본문</div></details>
//   본문 div 를 미리 만들어 두어 사용자가 본문 입력하면 details 안에 자식으로 들어감 (토글 닫혀도 숨김 정상)
function insertToggle(editor) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const details = document.createElement('details');
    details.open = true;
    const summary = document.createElement('summary');
    summary.textContent = '제목';
    const body = document.createElement('div');
    body.innerHTML = '<br>';
    details.appendChild(summary);
    details.appendChild(body);
    range.deleteContents();
    range.insertNode(details);
    moveCaretToEnd(sel, summary);
}

function insertHr(editor) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const hr = document.createElement('hr');
    const after = document.createElement('div');
    after.innerHTML = '<br>';
    range.deleteContents();
    range.insertNode(after);
    range.insertNode(hr);
    try {
        const r = document.createRange();
        r.setStart(after, 0);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
    } catch {}
}

// ═══════════════════════════════════════════════════════════════════════
//  Markdown ↔ HTML 변환 (1차 — 인라인 + 헤딩 + hr 만)
// ═══════════════════════════════════════════════════════════════════════

/**
 * editor.innerHTML → Markdown string.
 * 1차 범위: <strong>·<em>·<s>·<h1~3>·<hr>·<br>·<div>/<p>.
 */
export function htmlToMarkdown(html) {
    if (!html) return '';
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return walkNode(tmp).replace(/\n{3,}/g, '\n\n').trim();
}

function walkNode(node) {
    if (node.nodeType === 3) return node.nodeValue || '';
    let out = '';
    for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === 3) {
            out += child.nodeValue || '';
            continue;
        }
        if (child.nodeType !== 1) continue;
        const tag = child.tagName;
        // (2026-05-14 #23 후속) 마커 칩 역변환 — data-marker="scripture" 인 span → {{scripture}}
        if (tag === 'SPAN' && child.dataset && child.dataset.marker === 'scripture') {
            out += '{{scripture}}';
            continue;
        }
        // (2026-05-14 #23 2차) 리스트·토글 — nested 재귀 (들여쓰기 2 스페이스)
        if (tag === 'UL') { out += '\n' + walkListItems(child, '- ', '') + '\n'; continue; }
        if (tag === 'OL') { out += '\n' + walkListItems(child, null, '') + '\n'; continue; }
        if (tag === 'DETAILS') {
            const summary = child.querySelector(':scope > summary');
            const summaryText = summary ? walkNode(summary).trim() : '';
            // summary 제외한 나머지 children
            let body = '';
            for (const c of Array.from(child.childNodes)) {
                if (c === summary) continue;
                if (c.nodeType === 3) body += c.nodeValue || '';
                else if (c.nodeType === 1) body += walkNode(c);
            }
            // 토글 본문 줄마다 '> ' prefix (간단 모델 — 1차)
            const bodyLines = body.split('\n').filter(l => l.trim() !== '');
            const prefixed = bodyLines.length > 0
                ? '\n' + bodyLines.map(l => '> ' + l).join('\n')
                : '';
            out += `\n> ${summaryText}${prefixed}\n`;
            continue;
        }
        const inner = walkNode(child);
        switch (tag) {
            case 'STRONG': case 'B': out += '**' + inner + '**'; break;
            case 'EM': case 'I':     out += '*'  + inner + '*';  break;
            case 'S': case 'STRIKE': case 'DEL': out += '~~' + inner + '~~'; break;
            case 'H1': out += '\n# '   + inner + '\n'; break;
            case 'H2': out += '\n## '  + inner + '\n'; break;
            case 'H3': out += '\n### ' + inner + '\n'; break;
            case 'HR': out += '\n---\n'; break;
            case 'BR': out += '\n'; break;
            case 'DIV': case 'P':
                out += (out && !out.endsWith('\n') ? '\n' : '') + inner + '\n';
                break;
            case 'SUMMARY': case 'LI':
                // DETAILS / UL/OL 경로에서 처리. 단독 들어오면 텍스트로
                out += inner;
                break;
            default:
                out += inner;
        }
    }
    return out;
}

// ul/ol 안의 li 들을 마크다운 줄로 — nested 재귀 + indent 들여쓰기
function walkListItems(listEl, bulletPrefix, indent) {
    const items = Array.from(listEl.querySelectorAll(':scope > li'));
    const out = [];
    items.forEach((li, i) => {
        // li 의 텍스트 자식 + nested ul/ol 분리
        let inner = '';
        let nested = '';
        for (const c of Array.from(li.childNodes)) {
            if (c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL')) {
                const subPrefix = c.tagName === 'UL' ? '- ' : null;
                nested += '\n' + walkListItems(c, subPrefix, indent + '  ');
            } else if (c.nodeType === 3) {
                inner += c.nodeValue || '';
            } else if (c.nodeType === 1) {
                inner += walkNode(c);
            }
        }
        const prefix = bulletPrefix !== null ? bulletPrefix : `${i + 1}. `;
        out.push(indent + prefix + inner.trim() + nested);
    });
    return out.join('\n');
}

/**
 * Markdown string → HTML.
 * 1차 범위 그대로. 기존 plain text 도 안 깨짐 (마크다운 패턴 없으면 줄바꿈만 div 로).
 * (2026-05-14) {{scripture}} 마커는 시각 칩 "📖 말씀 본문" 으로 렌더.
 */
export function markdownToHtml(md) {
    if (!md) return '';
    const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = md.split('\n');
    const out = [];

    // (2026-05-14 #23 2차) 연속 리스트·토글 그룹화
    let i = 0;
    while (i < lines.length) {
        const raw = lines[i];
        const line = raw;

        // hr
        if (/^---\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

        // heading
        const h = line.match(/^(#{1,3})\s+(.*)$/);
        if (h) {
            const level = h[1].length;
            out.push(`<h${level}>${inlineMd(escape(h[2]))}</h${level}>`);
            i++; continue;
        }

        // 토글(>) — 첫 줄은 summary, 그 다음 연속된 '> ' 줄은 모두 본문
        const tg = line.match(/^>\s+(.*)$/);
        if (tg) {
            const summary = tg[1];
            const bodyLines = [];
            let j = i + 1;
            while (j < lines.length) {
                const m = lines[j].match(/^>\s+(.*)$/);
                if (!m) break;
                bodyLines.push(m[1]);
                j++;
            }
            const bodyHtml = bodyLines.length > 0
                ? bodyLines.map(b => `<div>${inlineMd(escape(b))}</div>`).join('')
                : '<div><br></div>';   // 본문 자리 미리 — 사용자가 본문 입력하면 details 안 자식으로
            out.push(`<details open><summary>${inlineMd(escape(summary))}</summary>${bodyHtml}</details>`);
            i = j;
            continue;
        }

        // (2026-05-14 #23 2차) 점/번호 리스트 — 들여쓰기 인식 스택 기반 nested 파서
        const LIST_LINE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;
        const firstListMatch = line.match(LIST_LINE);
        if (firstListMatch) {
            const rootIndent = firstListMatch[1].length;
            const rootIsOrdered = /\d+\./.test(firstListMatch[2]);
            const rootList = document.createElement(rootIsOrdered ? 'ol' : 'ul');
            const stack = [{ list: rootList, indent: rootIndent }];
            while (i < lines.length) {
                const m = lines[i].match(LIST_LINE);
                if (!m) break;
                const lineIndent = m[1].length;
                const isOrdered = /\d+\./.test(m[2]);
                const content = m[3];
                // 스택 정리 — 현재 indent 보다 깊은 스택 pop
                while (stack.length > 1 && stack[stack.length - 1].indent > lineIndent) {
                    stack.pop();
                }
                if (stack[stack.length - 1].indent < lineIndent) {
                    // 새 nested — 이전 li 안에 자식 list
                    const parentList = stack[stack.length - 1].list;
                    const lastLi = parentList.lastElementChild;
                    if (lastLi) {
                        const newList = document.createElement(isOrdered ? 'ol' : 'ul');
                        lastLi.appendChild(newList);
                        stack.push({ list: newList, indent: lineIndent });
                    }
                }
                const list = stack[stack.length - 1].list;
                const li = document.createElement('li');
                li.innerHTML = inlineMd(escape(content));
                list.appendChild(li);
                i++;
            }
            out.push(rootList.outerHTML);
            continue;
        }

        // 일반 줄
        if (line.trim() === '') {
            out.push('<div><br></div>');
        } else {
            out.push(`<div>${inlineMd(escape(line))}</div>`);
        }
        i++;
    }
    return out.join('');
}

function inlineMd(text) {
    // (2026-05-14 #23 후속) 마커 칩 — {{scripture}} 패턴을 styled span 으로 (contenteditable=false 라 한 묶음 단위 선택·삭제)
    let s = text;
    s = s.replace(/\{\{scripture\}\}/g,
        '<span class="md-marker-scripture" contenteditable="false" data-marker="scripture" title="이 자리에 말씀 본문이 들어가요">📖 말씀 본문</span>');
    // 인라인 마크다운 → HTML (긴 마커 먼저)
    s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    s = s.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<em>$1</em>');
    return s;
}
