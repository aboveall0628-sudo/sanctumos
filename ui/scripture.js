/**
 * scripture.js — 매일성경 4파트 통독 렌더링
 *
 * 레거시 script.js의 BIBLE_METADATA + 챕터 계산 + verse 렌더 로직을
 * ESM 모듈로 이전. bibleData.js가 노출하는 window.BIBLE_DATA를 소비.
 *
 * 4파트 (시가서/모세오경+대선지서/역사서+소선지서/신약) 동시 진행 + 1년 1독.
 */

import { getActivePlan } from './scriptureSettings.js';

const BIBLE_METADATA = {
    parts: [
        {
            id: 1, name: '파트1: 시가서', desc: '욥기 ~ 아가',
            books: [
                ['욥', '욥기', 42], ['시', '시편', 150], ['잠', '잠언', 31],
                ['전', '전도서', 12], ['아', '아가', 8],
            ],
        },
        {
            id: 2, name: '파트2: 모세오경 + 대선지서', desc: '창세기 ~ 신명기, 이사야 ~ 다니엘',
            books: [
                ['창', '창세기', 50], ['출', '출애굽기', 40], ['레', '레위기', 27],
                ['민', '민수기', 36], ['신', '신명기', 34],
                ['사', '이사야', 66], ['렘', '예레미야', 52], ['애', '예레미야 애가', 5],
                ['겔', '에스겔', 48], ['단', '다니엘', 12],
            ],
        },
        {
            id: 3, name: '파트3: 역사서 + 소선지서', desc: '여호수아 ~ 에스더, 호세아 ~ 말라기',
            books: [
                ['수', '여호수아', 24], ['삿', '사사기', 21], ['룻', '룻기', 4],
                ['삼상', '사무엘상', 31], ['삼하', '사무엘하', 24],
                ['왕상', '열왕기상', 22], ['왕하', '열왕기하', 25],
                ['대상', '역대상', 29], ['대하', '역대하', 36],
                ['라', '에스라', 10], ['느', '느헤미야', 13], ['에', '에스더', 10],
                ['호', '호세아', 14], ['욜', '요엘', 3], ['암', '아모스', 9],
                ['옵', '오바댜', 1], ['요나', '요나', 4], ['미', '미가', 7],
                ['나', '나훔', 3], ['합', '하박국', 3], ['습', '스바냐', 3],
                ['학', '학개', 2], ['슥', '스가랴', 14], ['말', '말라기', 4],
            ],
        },
        {
            id: 4, name: '파트4: 신약 전체', desc: '마태복음 ~ 요한계시록',
            books: [
                ['마', '마태복음', 28], ['막', '마가복음', 16], ['눅', '누가복음', 24],
                ['요', '요한복음', 21], ['행', '사도행전', 28],
                ['롬', '로마서', 16], ['고전', '고린도전서', 16], ['고후', '고린도후서', 13],
                ['갈', '갈라디아서', 6], ['엡', '에베소서', 6], ['빌', '빌립보서', 4],
                ['골', '골로새서', 4], ['살전', '데살로니가전서', 5], ['살후', '데살로니가후서', 3],
                ['딤전', '디모데전서', 6], ['딤후', '디모데후서', 4], ['딛', '디도서', 3],
                ['몬', '빌레몬서', 1], ['히', '히브리서', 13], ['약', '야고보서', 5],
                ['벧전', '베드로전서', 5], ['벧후', '베드로후서', 3],
                ['요일', '요한1서', 5], ['요이', '요한2서', 1], ['요삼', '요한3서', 1],
                ['유', '유다서', 1], ['계', '요한계시록', 22],
            ],
        },
    ],
};

// 통독 진도 앵커: 2026-05-08을 시작으로 각 파트의 시작 인덱스
const ANCHOR_DATE = new Date('2026-05-08T00:00:00');
const ANCHOR_INDICES = { 1: 84, 2: 200, 3: 17, 4: 63 };

// IndexedDB 캐시 (bible.json 원격 파일 캐시용)
const DB_NAME = 'BibleAlimiDB';
const STORE_NAME = 'bibleData';
const REMOTE_URL = 'https://raw.githubusercontent.com/aboveall0628-sudo/bible-data/refs/heads/main/bible.json';

let _bibleData = null;

/**
 * 성경 데이터 로드: window.BIBLE_DATA(번들) → IndexedDB 캐시 → 원격 fetch
 */
export async function loadBibleData() {
    if (_bibleData) return _bibleData;

    // 1순위: bibleData.js가 노출한 전역
    if (typeof window.BIBLE_DATA === 'object' && window.BIBLE_DATA !== null) {
        _bibleData = window.BIBLE_DATA;
        return _bibleData;
    }

    // 2순위: IndexedDB 캐시
    try {
        const cached = await loadFromIndexedDB();
        if (cached) { _bibleData = cached; return _bibleData; }
    } catch { /* continue */ }

    // 3순위: 원격
    try {
        const res = await fetch(REMOTE_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        _bibleData = await res.json();
        saveToIndexedDB(_bibleData).catch(() => {});
        return _bibleData;
    } catch (e) {
        console.error('Bible data load failed:', e);
        throw e;
    }
}

function loadFromIndexedDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (e) => e.target.result.createObjectStore(STORE_NAME);
        req.onsuccess = () => {
            const tx = req.result.transaction(STORE_NAME, 'readonly');
            const get = tx.objectStore(STORE_NAME).get('bible');
            get.onsuccess = () => resolve(get.result || null);
            get.onerror = () => reject();
        };
        req.onerror = () => reject();
    });
}

function saveToIndexedDB(data) {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onsuccess = () => {
            const tx = req.result.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(data, 'bible');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject();
        };
        req.onerror = () => reject();
    });
}

/**
 * 앵커 날짜로부터 N일 후의 챕터 인덱스 계산
 */
function calculateOffset(date) {
    const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const anchor = new Date(ANCHOR_DATE.getFullYear(), ANCHOR_DATE.getMonth(), ANCHOR_DATE.getDate());
    return Math.floor((target - anchor) / (1000 * 60 * 60 * 24));
}

function getChapterForPart(part, offset) {
    const partChapters = [];
    part.books.forEach(([abbr, full, chapters]) => {
        for (let c = 1; c <= chapters; c++) partChapters.push({ abbr, chapter: c, full });
    });
    const startIndex = ANCHOR_INDICES[part.id] || 0;
    const total = partChapters.length;
    const idx = ((startIndex + offset) % total + total) % total;
    return { info: partChapters[idx], index: idx, total };
}

function getVersesForChapter(abbr, chapter) {
    if (!_bibleData) return [];
    const prefix = `${abbr}${chapter}:`;
    const verses = [];
    Object.keys(_bibleData).forEach(key => {
        if (key.startsWith(prefix)) {
            const vNum = parseInt(key.split(':')[1]);
            if (!isNaN(vNum)) verses.push({ num: vNum, text: _bibleData[key].trim() });
        }
    });
    verses.sort((a, b) => a.num - b.num);
    return verses;
}

/**
 * 특정 날짜의 4파트 통독 분량을 #meditation-content에 렌더
 * @param {Date} date
 */
export async function renderScriptureForDate(date) {
    const container = document.getElementById('meditation-content');
    if (!container) return;

    if (!_bibleData) {
        try { await loadBibleData(); }
        catch {
            container.innerHTML = `
                <div class="meditation-error">
                    말씀을 가져오지 못했어요. Ctrl+Shift+R로 한 번 새로고침해 볼까요?
                </div>
            `;
            return;
        }
    }

    container.innerHTML = '';

    const plan = getActivePlan();
    const visibleParts = BIBLE_METADATA.parts.filter(p => plan.parts.includes(p.id));

    if (visibleParts.length === 0) {
        container.innerHTML = `
            <div class="meditation-error">
                표시할 파트가 없어요. <strong>설정 → 말씀 본문</strong>에서 묵상 계획을 골라 주세요.
            </div>
        `;
        return;
    }

    visibleParts.forEach(part => {
        const { info, index, total } = getChapterForPart(part, calculateOffset(date));
        const verses = getVersesForChapter(info.abbr, info.chapter);
        const partEl = document.createElement('div');
        partEl.className = 'reading-part';

        const passageContainer = document.createElement('div');
        passageContainer.className = 'passage-container';

        passageContainer.innerHTML = `
            <div class="passage-header">
                <span class="passage-title">${info.full || info.abbr} ${info.chapter}장</span>
                <span class="passage-meta">${part.name.replace('파트','P')} · ${index + 1}/${total}</span>
            </div>
            <div class="verse-list">
                ${verses.map(v => `
                    <div class="verse-item"
                         data-abbr="${info.abbr}" data-full="${info.full || info.abbr}"
                         data-chapter="${info.chapter}" data-num="${v.num}">
                        <span class="verse-num">${v.num}</span>
                        <span class="verse-text">${v.text}</span>
                    </div>
                `).join('') || '<div style="color:var(--text-secondary);font-size:12px">잠깐만요, 본문을 가져오는 중이에요...</div>'}
            </div>
        `;

        // 헤더 클릭으로 접기/펴기
        passageContainer.querySelector('.passage-header').addEventListener('click', () => {
            passageContainer.classList.toggle('collapsed');
        });

        // 구절 클릭 → 토글 선택
        passageContainer.querySelectorAll('.verse-item').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                el.classList.toggle('selected');
                updateCopyButton();
            });
        });

        partEl.appendChild(passageContainer);
        container.appendChild(partEl);
    });

    ensureStickyCopyBar(container);
    updateCopyButton();
}

/**
 * 설정에서 표시할 파트가 바뀌면 같은 날짜로 다시 그림.
 * (날짜는 #calendar-input이 들고 있음 — 그게 비면 오늘.)
 */
let _settingsListenerBound = false;
export function bindScriptureSettingsListener() {
    if (_settingsListenerBound) return;
    _settingsListenerBound = true;
    window.addEventListener('sanctum:scripture-settings-changed', () => {
        const input = document.getElementById('calendar-input');
        const dateStr = input?.value;
        const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
        renderScriptureForDate(d).catch(() => {});
    });
}

/**
 * 묵상 노트 카드 안 하단에 sticky 복사 바를 만들어 둠 (한 번만)
 * 카드 안에서 스크롤할 때 따라옴.
 */
function ensureStickyCopyBar(scriptureContainer) {
    const noteSection = document.getElementById('section-meditation');
    if (!noteSection) return;
    let bar = document.getElementById('scripture-copy-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'scripture-copy-bar';
        bar.className = 'scripture-copy-bar';
        bar.innerHTML = `
            <button id="scripture-copy-to-note" class="primary-btn" disabled
                    title="위에서 구절을 톡 누르면 활성화돼요">
                📋 고른 구절을 묵상 노트에 붙여넣기 (0개)
            </button>
        `;
        noteSection.appendChild(bar);
    }
    // 매 렌더마다 핸들러 재바인딩 — clone-replace로 이전 리스너 제거
    const oldBtn = bar.querySelector('#scripture-copy-to-note');
    const newBtn = oldBtn.cloneNode(true);
    oldBtn.parentNode.replaceChild(newBtn, oldBtn);
    newBtn.addEventListener('click', () => copySelectedToNote(scriptureContainer));
}

function updateCopyButton() {
    const btn = document.getElementById('scripture-copy-to-note');
    if (!btn) return;
    const count = document.querySelectorAll('#meditation-content .verse-item.selected').length;
    btn.textContent = `📋 고른 구절을 묵상 노트에 붙여넣기 (${count}개)`;
    btn.disabled = count === 0;
}

function copySelectedToNote(container) {
    const selected = container.querySelectorAll('.verse-item.selected');
    if (selected.length === 0) return;

    // 선택된 구절을 (책 풀네임 + 장) 단위로 묶어 정리
    // 형식:
    //   이사야 17
    //   12 슬프다 ...
    //   13 열방이 ...
    const grouped = new Map();   // key = "이사야 17"
    const order = [];
    selected.forEach(el => {
        const full = el.dataset.full || el.dataset.abbr || '';
        const chapter = el.dataset.chapter || '';
        const num = parseInt(el.dataset.num || '0');
        const text = el.querySelector('.verse-text')?.textContent || '';
        const head = `${full} ${chapter}`;
        if (!grouped.has(head)) {
            grouped.set(head, []);
            order.push(head);
        }
        grouped.get(head).push({ num, text });
    });

    const lines = [];
    order.forEach(head => {
        lines.push(head);
        grouped.get(head)
            .sort((a, b) => a.num - b.num)
            .forEach(v => lines.push(`${v.num} ${v.text}`));
        lines.push('');
    });

    const noteText = lines.join('\n').replace(/\n+$/, '');

    const editor = document.getElementById('meditation-note');
    if (!editor) return;

    const existing = editor.innerText.replace(/\n+$/, '');
    editor.innerText = existing
        ? existing + '\n\n' + noteText + '\n'
        : noteText + '\n';

    // 자동 저장 디바운스 발동
    editor.dispatchEvent(new Event('input', { bubbles: true }));

    // 선택 해제 + 노트로 스크롤 + 포커스 + 커서 끝으로
    selected.forEach(el => el.classList.remove('selected'));
    updateCopyButton();
    editor.scrollIntoView({ behavior: 'smooth', block: 'center' });

    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

export { BIBLE_METADATA };
