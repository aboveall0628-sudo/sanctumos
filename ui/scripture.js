/**
 * scripture.js — 매일성경 4파트 통독 렌더링
 *
 * 레거시 script.js의 BIBLE_METADATA + 챕터 계산 + verse 렌더 로직을
 * ESM 모듈로 이전. bibleData.js가 노출하는 window.BIBLE_DATA를 소비.
 *
 * 4파트 (시가서/모세오경+대선지서/역사서+소선지서/신약) 동시 진행 + 1년 1독.
 */

import {
    getActivePlan, getPartOverride,
    getProgressMode, getPartPosition, setPartPosition,
    getPartLastRead, setPartLastRead, clearPartLastRead,
} from './scriptureSettings.js';
import { renderDailyBibleLink } from './suDaily.js';
// (2026-05-14 #23 후속) 절 → 마크다운 변환 + 사용자 템플릿 적용
import { formatScriptureBlocks, applyScriptureToNote, getMeditationTemplate } from './meditationTemplate.js';
import { getMarkdown, setMarkdown } from './markdownEditor.js';

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

/**
 * Phase E-8/B-2: PRESET / user plan을 같은 모양의 partLike[] 로 정규화.
 * partLike = { id, name, books: [[abbr, full, chapters], ...] }
 * - PRESET: plan.parts(number[])를 BIBLE_METADATA.parts에서 매핑
 * - user:   plan.books를 그대로 묶어 단일 파트 (id = plan.id + '/p1')
 */
export function resolvePlanParts(plan) {
    if (!plan) return [];
    // user plan 식별: parts 없고 books가 있음
    if (Array.isArray(plan.books) && !Array.isArray(plan.parts)) {
        return [{
            id: plan.id + '/p1',
            name: plan.name,
            books: plan.books,
        }];
    }
    // PRESET
    if (!Array.isArray(plan.parts)) return [];
    return plan.parts
        .map(pid => {
            const p = BIBLE_METADATA.parts.find(x => x.id === pid);
            return p ? { id: p.id, name: p.name, books: p.books } : null;
        })
        .filter(Boolean);
}

/**
 * 파트의 펼쳐진 (책, 장) 시퀀스 반환 — 매 호출마다 계산하지만 4파트라 가벼움.
 */
function flattenPartChapters(part) {
    const out = [];
    part.books.forEach(([abbr, full, chapters]) => {
        for (let c = 1; c <= chapters; c++) out.push({ abbr, chapter: c, full });
    });
    return out;
}

/**
 * (2026-05-13) "이사야 20" / "요한복음 2" / "사 20" / "요 2" 등 자유 입력 파싱.
 * @returns {{book:string, chapter:number}|null}
 */
function parseBookChapter(raw) {
    if (!raw) return null;
    // 마지막 숫자 = 장 번호, 그 앞 텍스트 = 책 이름
    const m = raw.match(/^(.+?)[\s]*(\d+)\s*(?:장)?$/);
    if (!m) return null;
    const book = m[1].trim();
    const chapter = parseInt(m[2], 10);
    if (!book || isNaN(chapter) || chapter < 1) return null;
    return { book, chapter };
}

/**
 * (2026-05-13) 4파트 전체에서 책 이름 + 장 매칭 — abbr/full 둘 다 검색.
 * @returns {{partId:number, idx:number}|null}
 */
function findChapterAcrossParts({ book, chapter }) {
    const bookKey = book.replace(/\s+/g, '');
    for (const part of BIBLE_METADATA.parts) {
        const chapters = flattenPartChapters(part);
        for (let i = 0; i < chapters.length; i++) {
            const c = chapters[i];
            const abbrMatch = c.abbr === bookKey;
            const fullMatch = c.full === bookKey;
            // full 이름 일부 매칭 — "요한복음" 입력 시 "요한복음" full 매칭 OK,
            // "이사야" 입력 시 "이사야" full 매칭 OK.
            if ((abbrMatch || fullMatch) && c.chapter === chapter) {
                return { partId: part.id, idx: i };
            }
        }
    }
    return null;
}

/**
 * 특정 날짜에 보일 (책, 장) 인덱스 계산.
 * - override가 없으면: ANCHOR_DATE / ANCHOR_INDICES 기반 (기본 4파트 통독)
 * - override가 있으면: override.anchorDate에 override.{abbr,chapter}이 보이고
 *   그 뒤로 매일 한 장씩 진행
 *
 * @param {{id:number, books:Array}} part
 * @param {Date} date
 * @param {{abbr:string, chapter:number, anchorDate:string}|null} override
 */
function getChapterForPart(part, date, override, planId = null) {
    const partChapters = flattenPartChapters(part);
    const total = partChapters.length;

    // Phase E-8/E: manual 모드면 저장된 position을 그대로 사용 (없으면 calendar로 시드).
    if (planId && getProgressMode() === 'manual') {
        let pos = getPartPosition(planId, part.id);
        if (pos === null) {
            pos = computeCalendarIndex(part, date, override, partChapters, total);
            setPartPosition(planId, part.id, pos);
        }
        const idx = ((pos % total) + total) % total;
        return { info: partChapters[idx], index: idx, total, mode: 'manual' };
    }

    // calendar 모드 (기본)
    const idx = computeCalendarIndex(part, date, override, partChapters, total);
    return { info: partChapters[idx], index: idx, total, mode: 'calendar' };
}

function computeCalendarIndex(part, date, override, partChapters, total) {
    let startIndex, offset;
    if (override) {
        const found = partChapters.findIndex(x => x.abbr === override.abbr && x.chapter === override.chapter);
        startIndex = found >= 0 ? found : 0;
        const anchor = new Date(override.anchorDate + 'T00:00:00');
        const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        const anchorMid = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
        offset = Math.floor((target - anchorMid) / (1000 * 60 * 60 * 24));
    } else {
        startIndex = ANCHOR_INDICES[part.id] || 0;
        offset = calculateOffset(date);
    }
    return ((startIndex + offset) % total + total) % total;
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
    const visibleParts = resolvePlanParts(plan);

    if (visibleParts.length === 0) {
        container.innerHTML = `
            <div class="meditation-error">
                표시할 파트가 없어요. <strong>설정 → 말씀 본문</strong>에서 묵상 계획을 골라 주세요.
            </div>
        `;
        return;
    }

    const mode = getProgressMode();
    const todayStr = toLocalISO(new Date());

    // Phase E-8/E-2: manual 모드 롤오버 — 어제 "다 읽었어요" 도장이 찍힌 파트는
    // 오늘 들어오는 순간 자동으로 다음 장으로 한 칸 이동.
    if (mode === 'manual') {
        visibleParts.forEach(part => {
            const lastRead = getPartLastRead(plan.id, part.id);
            if (!lastRead) return;
            if (lastRead >= todayStr) return; // 오늘이거나 미래(말도 안되지만) 도장은 유지
            const partChapters = flattenPartChapters(part);
            const total = partChapters.length;
            const curPos = getPartPosition(plan.id, part.id);
            const baseline = typeof curPos === 'number'
                ? curPos
                : computeCalendarIndex(part, date, getPartOverride(plan.id, part.id), partChapters, total);
            const nextPos = Math.min(baseline + 1, total - 1);
            setPartPosition(plan.id, part.id, nextPos);
            clearPartLastRead(plan.id, part.id);
        });
    }
    visibleParts.forEach(part => {
        const override = getPartOverride(plan.id, part.id);
        const { info, index, total } = getChapterForPart(part, date, override, plan.id);
        const verses = getVersesForChapter(info.abbr, info.chapter);
        const partEl = document.createElement('div');
        partEl.className = 'reading-part';

        const passageContainer = document.createElement('div');
        passageContainer.className = 'passage-container';

        const readToday = mode === 'manual' && getPartLastRead(plan.id, part.id) === todayStr;
        const manualBtnHtml = mode === 'manual'
            ? `<div class="passage-footer">
                   <button class="passage-read-btn ${readToday ? 'done' : ''}" type="button"
                           data-part="${part.id}" ${readToday ? 'disabled' : ''}>
                       <i data-lucide="check" class="passage-read-btn-icon"></i>
                       <span>${readToday ? '오늘 다 읽었어요 ✓' : '이 장 다 읽었어요'}</span>
                   </button>
                   <span class="passage-read-hint">${readToday
                       ? '내일 들어오면 다음 장이 떠요'
                       : '오늘 분량 끝. 누르면 다음 장은 내일 자동으로 떠요.'}</span>
               </div>`
            : '';

        // (2026-05-13 즉효 fix) manual 모드에서 자동 롤오버가 어긋났을 때를 위한 수동 진입 버튼.
        //   본문 헤더 우측에 작은 "→ 다음 장" + "📖 어디로?" 버튼 노출.
        //   본격 롤오버 로직 디버그는 별도 매듭.
        const manualJumpHtml = mode === 'manual'
            ? `<button type="button" class="passage-jump-pick" data-part="${part.id}" title="책·장 직접 입력">📖</button>
               <button type="button" class="passage-jump-next" data-part="${part.id}" title="다음 장으로 이동">다음 장 →</button>`
            : '';

        passageContainer.innerHTML = `
            <div class="passage-header">
                <span class="passage-title">${info.full || info.abbr} ${info.chapter}장</span>
                <span class="passage-meta">${part.name.replace('파트','P')} · ${index + 1}/${total}</span>
                ${manualJumpHtml}
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
            ${manualBtnHtml}
        `;

        // 헤더 클릭으로 접기/펴기
        passageContainer.querySelector('.passage-header').addEventListener('click', () => {
            passageContainer.classList.toggle('collapsed');
        });

        // (2026-05-13) "다음 장 →" 즉시 진입 — manual 모드 자동 롤오버 어긋났을 때 사용자 직접 이동
        const jumpBtn = passageContainer.querySelector('.passage-jump-next');
        if (jumpBtn) {
            jumpBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const partChapters = flattenPartChapters(part);
                const max = partChapters.length;
                const curPos = getPartPosition(plan.id, part.id);
                const baseline = typeof curPos === 'number' ? curPos : index;
                const nextPos = Math.min(baseline + 1, max - 1);
                setPartPosition(plan.id, part.id, nextPos);
                clearPartLastRead(plan.id, part.id);
                renderScriptureForDate(date).catch(() => {});
            });
        }

        // (2026-05-13) "📖 어디로?" — 책·장 직접 입력으로 즉시 점프.
        //   사용자가 어느 파트 헤더에서든 입력 가능. 4파트 전체에서 책 매칭 → 해당 파트로 점프.
        const pickBtn = passageContainer.querySelector('.passage-jump-pick');
        if (pickBtn) {
            pickBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const answer = window.prompt('어디로 갈까요? 예: "이사야 20", "여호수아 24", "요한복음 2"');
                if (!answer || !answer.trim()) return;
                const target = parseBookChapter(answer.trim());
                if (!target) {
                    alert('"이사야 20" 같은 형식으로 입력해 주세요.');
                    return;
                }
                const found = findChapterAcrossParts(target);
                if (!found) {
                    alert(`"${answer}"을(를) 4파트에서 찾지 못했어요. 책 이름이나 장 번호를 다시 확인해 주세요.`);
                    return;
                }
                setPartPosition(plan.id, found.partId, found.idx);
                clearPartLastRead(plan.id, found.partId);
                renderScriptureForDate(date).catch(() => {});
            });
        }

        // 구절 클릭 → 토글 선택
        passageContainer.querySelectorAll('.verse-item').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                el.classList.toggle('selected');
                updateCopyButton();
            });
        });

        // Phase E-8/E-2: manual 모드 — "다 읽었어요" 도장만 찍음.
        // 본문은 그대로, 버튼은 비활성. 다음 장은 다음 날 들어왔을 때 롤오버로.
        const readBtn = passageContainer.querySelector('.passage-read-btn');
        if (readBtn) {
            readBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (readBtn.disabled) return;
                setPartLastRead(plan.id, part.id, todayStr);
                // 본문 그대로 — 버튼 UI만 즉시 갱신
                readBtn.classList.add('done');
                readBtn.disabled = true;
                const labelSpan = readBtn.querySelector('span');
                if (labelSpan) labelSpan.textContent = '오늘 다 읽었어요 ✓';
                const hint = passageContainer.querySelector('.passage-read-hint');
                if (hint) hint.textContent = '내일 들어오면 다음 장이 떠요';
            });
        }

        partEl.appendChild(passageContainer);
        container.appendChild(partEl);
    });

    // Phase E-8/C: 본문 카드 맨 아래 "매일성경 사이트 바로가기" 링크 (설정 토글로 on/off)
    renderDailyBibleLink(container);

    ensureStickyCopyBar(container);
    updateCopyButton();
}

/**
 * Phase E-8/D: 통독 진도 자동 계산 — 별도 "완료 체크" 없이 anchor만으로 보람을 채움.
 *
 * 규칙:
 *  - PRESET part: 기본 ANCHOR_DATE(2026-05-08) + ANCHOR_INDICES[partId] 기준.
 *    한국 매일성경 일정에 따라 모든 사용자가 같은 출발선이라 가정.
 *  - override가 있는 PRESET part: override.anchorDate + override 시작 (abbr,chapter) 기준.
 *  - user plan part: 시작점 override가 addUserPlan에서 자동으로 박혀 있음. 그 anchor 기준.
 *
 * "본 챕터 수" = 시퀀스에서의 누적 인덱스 + 1 (시작점 포함, 오늘까지). total을 넘지 않음.
 */
export function computePlanProgress(plan) {
    if (!plan) return { parts: [], totalDone: 0, totalAll: 0, percent: 0, isEmpty: true };
    const parts = resolvePlanParts(plan).map(part => progressForPart(plan, part));
    const totalDone = parts.reduce((s, p) => s + p.done, 0);
    const totalAll = parts.reduce((s, p) => s + p.total, 0);
    const percent = totalAll === 0 ? 0 : Math.round((totalDone / totalAll) * 100);
    return {
        parts,
        totalDone,
        totalAll,
        percent,
        isEmpty: totalDone === 0,
    };
}

function progressForPart(plan, part) {
    const partChapters = flattenPartChapters(part);
    const total = partChapters.length;
    const override = getPartOverride(plan.id, part.id);

    // Phase E-8/E: manual 모드 — 저장된 position이 곧 진도. 없으면 calendar 시뮬레이션 fallback.
    if (getProgressMode() === 'manual') {
        const pos = getPartPosition(plan.id, part.id);
        if (pos !== null) {
            // position은 "지금 보고 있는 인덱스" — 본 누적은 그 위치까지(시작점 기준).
            const startIdx = resolveStartIndex(part, override, partChapters);
            const done = Math.max(0, Math.min(total, pos - startIdx + 1));
            const percent = total === 0 ? 0 : Math.round((done / total) * 100);
            return { id: part.id, label: part.name || '내 계획', done, total, percent };
        }
        // position 없음 — calendar로 떨어짐 (시드 전)
    }

    // calendar 모드 (또는 manual인데 아직 시드 전)
    let anchor, startIndex;
    if (override) {
        anchor = new Date(override.anchorDate + 'T00:00:00');
        const found = partChapters.findIndex(x => x.abbr === override.abbr && x.chapter === override.chapter);
        startIndex = found >= 0 ? found : 0;
    } else if (typeof part.id === 'number' && ANCHOR_INDICES[part.id] !== undefined) {
        anchor = ANCHOR_DATE;
        startIndex = ANCHOR_INDICES[part.id];
    } else {
        anchor = startOfToday();
        startIndex = 0;
    }
    const today = startOfToday();
    const anchorMid = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
    const daysElapsed = Math.floor((today - anchorMid) / (1000 * 60 * 60 * 24));
    const cumulative = Math.max(0, startIndex + daysElapsed + 1);
    const done = Math.min(total, cumulative);
    const percent = total === 0 ? 0 : Math.round((done / total) * 100);

    return { id: part.id, label: part.name || '내 계획', done, total, percent };
}

function resolveStartIndex(part, override, partChapters) {
    if (override) {
        const found = partChapters.findIndex(x => x.abbr === override.abbr && x.chapter === override.chapter);
        return found >= 0 ? found : 0;
    }
    if (typeof part.id === 'number' && ANCHOR_INDICES[part.id] !== undefined) {
        return ANCHOR_INDICES[part.id];
    }
    return 0;
}

function startOfToday() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toLocalISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * Phase E-8/E: 활성 plan의 각 파트 partPosition을 오늘 calendar 결과로 시드.
 * manual 모드를 처음 켜는 순간 호출 → 갑자기 진도가 줄어들지 않도록 함.
 * 이미 position이 박혀 있는 파트는 건드리지 않음.
 */
export function seedManualPositionsFromCalendar() {
    const plan = getActivePlan();
    if (!plan) return;
    const parts = resolvePlanParts(plan);
    const today = startOfToday();
    parts.forEach(part => {
        const existing = getPartPosition(plan.id, part.id);
        if (existing !== null) return; // 사용자가 이미 움직여둔 건 건드리지 않음
        const override = getPartOverride(plan.id, part.id);
        const partChapters = flattenPartChapters(part);
        const idx = computeCalendarIndex(part, today, override, partChapters, partChapters.length);
        setPartPosition(plan.id, part.id, idx);
    });
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

// (2026-05-14 #23 후속) 절 → 마크다운 [### 책장 + --- + 절 본문] 형식 + 사용자 템플릿 적용.
//   - 빈 노트 + 템플릿 마커 있음 → 마커 자리에 본문
//   - 노트에 마커 있음 → 마커 replace
//   - 그 외 → 끝에 append (caret 위치는 markdownEditor 가 잡음)
async function copySelectedToNote(container) {
    const selected = container.querySelectorAll('.verse-item.selected');
    if (selected.length === 0) return;

    const verses = Array.from(selected).map(el => ({
        full:    el.dataset.full || el.dataset.abbr || '',
        abbr:    el.dataset.abbr || '',
        chapter: el.dataset.chapter || '',
        num:     parseInt(el.dataset.num || '0'),
        text:    el.querySelector('.verse-text')?.textContent || '',
    }));

    const scriptureMd = formatScriptureBlocks(verses);

    const editor = document.getElementById('meditation-note');
    if (!editor) return;

    // 사용자 ID 조회 — app.js 가 window.currentUserId 로 노출
    const userId = (typeof window !== 'undefined' && window.currentUserId) || null;
    let template = '{{scripture}}';
    if (userId && userId !== 'anonymous') {
        try { template = await getMeditationTemplate(userId); } catch {}
    }

    const cur = getMarkdown(editor);
    const next = applyScriptureToNote(cur, scriptureMd, template);
    setMarkdown(editor, next);

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
