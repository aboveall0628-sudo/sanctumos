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

// 줄 시작 `# ` / `## ` / `### ` / `---` 처리
function runBlockMarkdownTransforms(editor) {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const node = sel.getRangeAt(0).startContainer;
    if (node.nodeType !== 3) return; // 텍스트 노드만
    const block = findBlockAncestor(node, editor);
    if (!block || block === editor) return;
    const text = block.textContent || '';

    // 헤딩 변환 — 줄 시작에 # / ## / ### + 공백
    const headingMatch = text.match(/^(#{1,3})\s(.*)$/);
    if (headingMatch && /^(DIV|P)$/.test(block.tagName)) {
        const level = headingMatch[1].length;
        const rest = headingMatch[2];
        const h = document.createElement('h' + level);
        h.textContent = rest;
        block.parentNode.replaceChild(h, block);
        // caret 끝으로
        try {
            const r = document.createRange();
            r.selectNodeContents(h);
            r.collapse(false);
            sel.removeAllRanges();
            sel.addRange(r);
        } catch {}
        return;
    }
    // 가로줄 — 줄이 정확히 `---` 일 때 hr 로 교체
    if (text === '---' && /^(DIV|P)$/.test(block.tagName)) {
        const hr = document.createElement('hr');
        const after = document.createElement('div');
        after.innerHTML = '<br>';
        block.parentNode.replaceChild(hr, block);
        hr.parentNode.insertBefore(after, hr.nextSibling);
        try {
            const r = document.createRange();
            r.selectNodeContents(after);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
        } catch {}
    }
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
            const action = btn.dataset.action;
            editor.focus();
            if (cmd)   document.execCommand(cmd);
            if (block) setBlockTag(editor, block);
            if (action === 'hr') insertHr(editor);
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
            default:
                out += inner;
        }
    }
    return out;
}

/**
 * Markdown string → HTML.
 * 1차 범위 그대로. 기존 plain text 도 안 깨짐 (마크다운 패턴 없으면 줄바꿈만 div 로).
 */
export function markdownToHtml(md) {
    if (!md) return '';
    // 인라인 변환을 위해 escape 먼저
    const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = md.split('\n');
    const out = [];
    for (let raw of lines) {
        const line = raw;
        // 줄 단위 블록 패턴
        if (/^---\s*$/.test(line)) { out.push('<hr>'); continue; }
        const h = line.match(/^(#{1,3})\s+(.*)$/);
        if (h) {
            const level = h[1].length;
            out.push(`<h${level}>${inlineMd(escape(h[2]))}</h${level}>`);
            continue;
        }
        if (line.trim() === '') {
            out.push('<div><br></div>');
        } else {
            out.push(`<div>${inlineMd(escape(line))}</div>`);
        }
    }
    return out.join('');
}

function inlineMd(text) {
    // 인라인 마크다운 → HTML (긴 마커 먼저)
    let s = text;
    s = s.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    s = s.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<em>$1</em>');
    return s;
}
