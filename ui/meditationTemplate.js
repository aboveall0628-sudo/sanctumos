/**
 * meditationTemplate.js — 묵상 노트 템플릿 (2026-05-14 백로그 #23 후속)
 *
 * 정책:
 *   - 단일 사용자 템플릿 (markdown string) — settings/spiritualLock 안 meditationTemplate 필드
 *   - {{scripture}} 마커 위치에 절 본문이 삽입됨
 *   - 마커 없으면 본문이 끝에 append
 *   - 빈 노트 + 템플릿 설정 = 첫 진입 시 자동으로 깔림
 *
 * 적용 흐름:
 *   a2: 오늘 첫 진입 + 노트 비어있음 + 템플릿 존재 → 자동 적용
 *   c3: 절 붙여넣기 시
 *        · 노트 비어있음 → 템플릿 + 본문
 *        · 노트에 마커 있음 → 마커 자리에 본문
 *        · 그 외 → 끝에 append (caret 위치는 markdownEditor 가 잡기)
 */

import { db, doc, getDoc, setDoc, serverTimestamp } from '../data/firebase.js';

export const SCRIPTURE_MARKER = '{{scripture}}';
export const DEFAULT_TEMPLATE = SCRIPTURE_MARKER;

// ═══════════════════════════════════════════════════════════════════════
//  Firestore 읽기·쓰기 (평문 — settings/spiritualLock 안 필드)
// ═══════════════════════════════════════════════════════════════════════

function ref(userId) {
    return doc(db, 'users', userId, 'settings', 'spiritualLock');
}

export async function getMeditationTemplate(userId) {
    if (!userId) return DEFAULT_TEMPLATE;
    try {
        const snap = await getDoc(ref(userId));
        if (snap.exists()) {
            const t = snap.data().meditationTemplate;
            if (typeof t === 'string' && t.length > 0) return t;
        }
    } catch (e) {
        console.warn('[meditationTemplate] read failed:', e);
    }
    return DEFAULT_TEMPLATE;
}

export async function setMeditationTemplate(userId, template) {
    if (!userId) return;
    const value = (typeof template === 'string' && template.length > 0)
        ? template
        : DEFAULT_TEMPLATE;
    await setDoc(ref(userId), {
        meditationTemplate: value,
        updatedAt: serverTimestamp(),
    }, { merge: true });
}

// ═══════════════════════════════════════════════════════════════════════
//  절 본문 → 마크다운 형식
// ═══════════════════════════════════════════════════════════════════════

/**
 * 선택된 절들을 책·장 단위로 묶어 마크다운으로 만든다.
 *
 *   ### 시편 92
 *   ---
 *   1 지존자여 ...
 *   4 여호와여 ...
 *
 *   ### 이사야 20
 *   ---
 *   5 ...
 *
 * @param {Array<{full:string, abbr:string, chapter:string|number, num:number, text:string}>} verses
 * @returns {string} markdown
 */
export function formatScriptureBlocks(verses) {
    if (!Array.isArray(verses) || verses.length === 0) return '';
    const grouped = new Map();   // key = "시편 92"
    const order = [];
    verses.forEach(v => {
        const book = v.full || v.abbr || '';
        const chapter = v.chapter ?? '';
        const head = `${book} ${chapter}`.trim();
        if (!grouped.has(head)) {
            grouped.set(head, []);
            order.push(head);
        }
        grouped.get(head).push({ num: Number(v.num) || 0, text: String(v.text || '').trim() });
    });

    const blocks = [];
    order.forEach(head => {
        const lines = [`### ${head}`, '---'];
        grouped.get(head)
            .sort((a, b) => a.num - b.num)
            .forEach(v => lines.push(`${v.num} ${v.text}`));
        blocks.push(lines.join('\n'));
    });
    return blocks.join('\n\n');
}

// ═══════════════════════════════════════════════════════════════════════
//  적용 로직
// ═══════════════════════════════════════════════════════════════════════

/**
 * 노트의 현재 마크다운 + 새로 들어올 본문 + 사용자 템플릿을 합쳐
 * 최종 마크다운을 반환.
 *
 * 규칙:
 *   1. currentMd 가 비어있고 template 있음:
 *      - template 에 {{scripture}} 마커 있으면 → 마커 자리에 scriptureMd
 *      - 없으면 → template + '\n\n' + scriptureMd
 *   2. currentMd 에 {{scripture}} 마커 있음 → 마커 자리에 scriptureMd
 *   3. 그 외 → currentMd 끝에 빈 줄 + scriptureMd
 *
 * @param {string} currentMd - 노트 현재 markdown
 * @param {string} scriptureMd - 새로 삽입할 절 본문 markdown
 * @param {string} template - 사용자 템플릿 (없으면 DEFAULT)
 * @returns {string}
 */
export function applyScriptureToNote(currentMd, scriptureMd, template) {
    const tmpl = (typeof template === 'string' && template.length > 0) ? template : DEFAULT_TEMPLATE;
    const cur  = (currentMd || '').trim();
    const sc   = (scriptureMd || '').trim();
    if (!sc) return cur;

    // 2) 현재 노트에 마커 있음 → replace
    if (cur.includes(SCRIPTURE_MARKER)) {
        return cur.split(SCRIPTURE_MARKER).join(sc);
    }
    // 1) 빈 노트 + 템플릿
    if (!cur) {
        if (tmpl.includes(SCRIPTURE_MARKER)) {
            return tmpl.split(SCRIPTURE_MARKER).join(sc);
        }
        // 마커 없는 템플릿 — template 가 default 와 다르면 위에 깔고 본문 append
        if (tmpl !== DEFAULT_TEMPLATE) {
            return tmpl + '\n\n' + sc;
        }
        return sc;
    }
    // 3) 그 외 — 끝에 append
    return cur + '\n\n' + sc;
}

/**
 * 첫 진입 자동 적용 (a2):
 *   - 빈 노트 + 템플릿 있고 default 아니면 → 템플릿만 깔기 (본문 자리는 마커 유지)
 *   - 빈 노트 + 템플릿 default → 그대로 빈 노트
 *
 * @param {string} currentMd
 * @param {string} template
 * @returns {string|null} 적용할 markdown (변경 없으면 null)
 */
export function applyTemplateOnFirstEntry(currentMd, template) {
    const cur = (currentMd || '').trim();
    if (cur.length > 0) return null;   // 이미 내용 있음
    const tmpl = (typeof template === 'string' && template.length > 0) ? template : DEFAULT_TEMPLATE;
    if (tmpl === DEFAULT_TEMPLATE) return null;   // 마커만 = 빈 노트 그대로
    return tmpl;
}
