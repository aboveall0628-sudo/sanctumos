/**
 * selfProfile.js — 1차 베타 본인 프로필 (v70, 2026-05-18 재작성)
 *
 * 사용자 명시 합의 (2026-05-18):
 *   - 카드 2장: 나 / 묵상 (다짐 카드 제거)
 *   - 인라인 즉시 편집 (값 클릭 또는 [편집] → 입력 필드 → 저장·취소)
 *   - AI 부트스트랩 카드(🪄) 제거 — 13 step 온보딩이 이미 대화형
 *   - 능력 8축·Big5 슬라이더 노출 X (Q4 = 2차 베타 전 결정으로 연기)
 *   - R10 마음 톤·기도·간증 노출 X (2차 베타 전 결정)
 *   - MBTI·관심사 등 13 step 외 자리 X — 가입할 때 받은 12 값만
 *   - 이모지·국기 X. lucide 아이콘은 유지 (사용자 명시 "루시드는 냅둬, 아이콘 자리 전부 루시드로")
 *
 * 데이터 모델 — persons 컬렉션 안 isSelf=true 카드 1장 (변경 없음).
 *
 * 표시 필드:
 *   나 카드 — name · nicknames · birthday(+birthdayLunar) · city(+timezone)
 *   묵상 카드 — devotionalLevel · bibleVersion
 *
 * 저장: 인라인 [저장] 클릭 시 _draft 갱신 → saveSelfCard 호출.
 */

import { getDEK } from './lockScreen.js';
import { ensureSelfCard, saveSelfCard } from '../data/personRepo.js';
import { showToast } from './quickReview.js';
import { CITY_PRESETS, BIBLE_VERSIONS } from '../config/onboardingDefaults.js';

// ─── 모듈 상태 ───
let _userId = null;
let _draft = null;

// ─── 라벨 카탈로그 ───
const FIELD_LABELS = {
    name: '이름',
    nicknames: '별명',
    birthday: '생일',
    city: '사는 지역',
    devotionalLevel: '큐티 수준',
    bibleVersion: '성경 번역본',
};

const DEVOTIONAL_LEVEL_LABELS = {
    basic: '처음 (1절 묵상)',
    intermediate: '가끔 (단락)',
    advanced: '자주 (한 권 통독)',
};

// ═══════════════════════════════════════════════════════════════════════
//  진입점
// ═══════════════════════════════════════════════════════════════════════

export async function renderSelfProfileView(userId) {
    _userId = userId;
    injectStylesOnce();
    const container = document.getElementById('view-self-profile');
    if (!container) return;

    const dek = getDEK();
    if (!dek) {
        container.innerHTML = lockedTemplate();
        return;
    }

    container.innerHTML = loadingTemplate();
    try {
        _draft = await ensureSelfCard(dek, userId);
        container.innerHTML = pageTemplate(_draft);
        bindEvents(container);
        renderLucideIcons();
    } catch (e) {
        console.error('[selfProfile] load failed:', e);
        container.innerHTML = errorTemplate(e?.message || '알 수 없는 오류');
    }
}

function renderLucideIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  템플릿
// ═══════════════════════════════════════════════════════════════════════

function lockedTemplate() {
    return `<div class="sf-state-card">잠금이 풀려야 보입니다.</div>`;
}
function loadingTemplate() {
    return `<div class="sf-state-card">불러오는 중...</div>`;
}
function errorTemplate(msg) {
    return `<div class="sf-state-card">불러오기 실패: ${escapeHtml(msg)}</div>`;
}

function pageTemplate(d) {
    return `
        <header class="page-header">
            <h1><i class="page-icon" data-lucide="user-circle"></i> 내 프로필</h1>
        </header>
        <div class="sf-cards">
            ${identityCardHtml(d)}
            ${meditationCardHtml(d)}
            ${referralCardHtml(d)}
        </div>
    `;
}

/**
 * (2026-05-18 v75) 내 추천 링크 카드 — 친구 초대 자리.
 *   referralCode 가 박힌 시점부터 노출. 같은 카드가 설정 [안내] 카테고리에도 자리잡힘.
 */
function referralCardHtml(d) {
    const code = d.referralCode;
    if (!code) {
        // 코드 아직 생성 안 됨(레거시 또는 일시 실패) — 카드 자체 숨김
        return '';
    }
    const url = referralUrl(code);
    const count = Number(d.referralCount || 0);
    return `
        <section class="sf-card">
            <h2 class="sf-card-title">
                <i class="sf-card-icon" data-lucide="link"></i> 내 추천 링크
            </h2>
            <p class="sf-referral-desc">
                친구나 가족과 함께하고 싶을 때 이 링크를 보내주세요. 함께 베타에 합류하시면 ${escapeHtml(d.nicknames?.[0] || d.name || '나')}님 페이지에 "${count}명 함께함" 자리에 +1 돼요.
            </p>
            <div class="sf-referral-row">
                <input type="text" class="sf-referral-url" id="sf-referral-url" value="${escapeAttr(url)}" readonly>
                <button type="button" class="sf-referral-copy" id="sf-referral-copy">복사</button>
            </div>
            <p class="sf-referral-count">
                <strong>${count}명</strong> 함께하셨어요
            </p>
        </section>
    `;
}

function referralUrl(code) {
    // 도메인은 현재 host. dev/메인 자연 적응. 운영 도메인 박히면 자동 sanctumos.kr.
    const origin = (typeof window !== 'undefined' && window.location)
        ? `${window.location.origin}${window.location.pathname.replace(/index\.html$/, '')}`
        : '/';
    return `${origin}?ref=${encodeURIComponent(code)}`;
}

function identityCardHtml(d) {
    return `
        <section class="sf-card">
            <h2 class="sf-card-title">
                <i class="sf-card-icon" data-lucide="user"></i> 나
            </h2>
            ${rowHtml('name', formatName(d), false)}
            ${rowHtml('nicknames', formatNicknames(d), false)}
            ${rowHtml('birthday', formatBirthday(d), false)}
            ${rowHtml('city', formatCity(d), false)}
        </section>
    `;
}

function meditationCardHtml(d) {
    return `
        <section class="sf-card">
            <h2 class="sf-card-title">
                <i class="sf-card-icon" data-lucide="book-open"></i> 묵상
            </h2>
            ${rowHtml('devotionalLevel', formatDevotionalLevel(d), false)}
            ${rowHtml('bibleVersion', formatBibleVersion(d), false)}
        </section>
    `;
}

function rowHtml(field, displayValue, isEditing) {
    if (isEditing) return '';
    const isEmpty = !displayValue;
    return `
        <div class="sf-row" data-field="${field}">
            <span class="sf-label">${FIELD_LABELS[field] || field}</span>
            <span class="sf-value" data-display>
                ${isEmpty ? '<span class="sf-empty">아직 없어요</span>' : escapeHtml(displayValue)}
            </span>
            <button type="button" class="sf-edit-btn" data-edit>편집</button>
        </div>
    `;
}

// ═══════════════════════════════════════════════════════════════════════
//  표시 값 포맷터
// ═══════════════════════════════════════════════════════════════════════

function formatName(d) {
    return (d.name || '').trim();
}
function formatNicknames(d) {
    return (Array.isArray(d.nicknames) ? d.nicknames : []).join(', ').trim();
}
function formatBirthday(d) {
    const b = (d.birthday || '').trim();
    if (!b) return '';
    return b + (d.birthdayLunar ? ' (음력)' : ' (양력)');
}
function formatCity(d) {
    const cityId = d.city;
    if (cityId) {
        const c = CITY_PRESETS.find(p => p.id === cityId);
        if (c) return c.label;
    }
    return (d.currentCity || '').trim();
}
function formatDevotionalLevel(d) {
    return DEVOTIONAL_LEVEL_LABELS[d.devotionalLevel] || '';
}
function formatBibleVersion(d) {
    const v = BIBLE_VERSIONS.find(b => b.id === d.bibleVersion);
    return v ? v.label : '';
}

// ═══════════════════════════════════════════════════════════════════════
//  이벤트
// ═══════════════════════════════════════════════════════════════════════

function bindEvents(container) {
    container.querySelectorAll('.sf-row').forEach((row) => {
        const editBtn = row.querySelector('[data-edit]');
        if (editBtn) editBtn.addEventListener('click', () => enterEditMode(row));
    });

    // (v75) 내 추천 링크 — 복사 버튼
    const copyBtn = container.querySelector('#sf-referral-copy');
    const urlInput = container.querySelector('#sf-referral-url');
    if (copyBtn && urlInput) {
        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(urlInput.value);
                copyBtn.textContent = '복사됨';
                setTimeout(() => { copyBtn.textContent = '복사'; }, 1500);
            } catch (e) {
                // 폴백 — 인라인 select
                urlInput.select();
                document.execCommand('copy');
                copyBtn.textContent = '복사됨';
                setTimeout(() => { copyBtn.textContent = '복사'; }, 1500);
            }
        });
    }
}

function enterEditMode(row) {
    const field = row.dataset.field;
    if (!field) return;

    const currentValue = _draft[field];

    row.innerHTML = `
        <span class="sf-label">${FIELD_LABELS[field] || field}</span>
        <span class="sf-value sf-value-editing">
            ${editorHtml(field, currentValue)}
        </span>
        <button type="button" class="sf-save-btn" data-save>저장</button>
        <button type="button" class="sf-cancel-btn" data-cancel>취소</button>
    `;

    const input = row.querySelector('input,select');
    input?.focus();
    if (input && input.tagName === 'INPUT') input.select?.();

    row.querySelector('[data-save]')?.addEventListener('click', () => saveField(row, field));
    row.querySelector('[data-cancel]')?.addEventListener('click', () => cancelEdit(row, field));

    // Enter 키 = 저장
    row.querySelectorAll('input').forEach((el) => {
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); saveField(row, field); }
            else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(row, field); }
        });
    });
}

function editorHtml(field, currentValue) {
    if (field === 'name') {
        return `<input type="text" class="sf-input" value="${escapeAttr(currentValue || '')}" placeholder="이름">`;
    }
    if (field === 'nicknames') {
        const csv = Array.isArray(currentValue) ? currentValue.join(', ') : '';
        return `<input type="text" class="sf-input" value="${escapeAttr(csv)}" placeholder="쉼표로 구분">`;
    }
    if (field === 'birthday') {
        const isLunar = !!_draft.birthdayLunar;
        return `
            <div class="sf-birthday-editor">
                <input type="text" class="sf-input" value="${escapeAttr(currentValue || '')}" placeholder="YYYY-MM-DD">
                <label class="sf-lunar-toggle">
                    <input type="checkbox" data-lunar ${isLunar ? 'checked' : ''}>
                    <span>음력</span>
                </label>
            </div>
        `;
    }
    if (field === 'city') {
        const options = CITY_PRESETS.map(p =>
            `<option value="${p.id}" ${p.id === currentValue ? 'selected' : ''}>${escapeHtml(p.label)}</option>`
        ).join('');
        return `<select class="sf-select"><option value="">선택 안 함</option>${options}</select>`;
    }
    if (field === 'devotionalLevel') {
        const levels = [
            ['basic', '처음 (1절 묵상)'],
            ['intermediate', '가끔 (단락)'],
            ['advanced', '자주 (한 권 통독)'],
        ];
        const options = levels.map(([id, label]) =>
            `<option value="${id}" ${id === currentValue ? 'selected' : ''}>${escapeHtml(label)}</option>`
        ).join('');
        return `<select class="sf-select"><option value="">선택 안 함</option>${options}</select>`;
    }
    if (field === 'bibleVersion') {
        const options = BIBLE_VERSIONS.map(v => {
            const disabled = v.id !== 'krv' ? 'disabled' : '';
            const suffix = v.id !== 'krv' ? ' (준비 중)' : '';
            return `<option value="${v.id}" ${v.id === currentValue ? 'selected' : ''} ${disabled}>${escapeHtml(v.label)}${suffix}</option>`;
        }).join('');
        return `<select class="sf-select">${options}</select>`;
    }
    return `<input type="text" class="sf-input" value="${escapeAttr(currentValue || '')}">`;
}

function cancelEdit(row, field) {
    const currentValue = _draft[field];
    const display = (() => {
        if (field === 'name') return formatName(_draft);
        if (field === 'nicknames') return formatNicknames(_draft);
        if (field === 'birthday') return formatBirthday(_draft);
        if (field === 'city') return formatCity(_draft);
        if (field === 'devotionalLevel') return formatDevotionalLevel(_draft);
        if (field === 'bibleVersion') return formatBibleVersion(_draft);
        return String(currentValue || '');
    })();

    row.outerHTML = rowHtml(field, display, false);
    rebindRowByField(field);
}

async function saveField(row, field) {
    const dek = getDEK();
    if (!dek) {
        showToast('잠금이 풀려야 저장돼요.', 'error');
        return;
    }

    const input = row.querySelector('input.sf-input, select.sf-select');
    if (!input) return;

    const raw = (input.value || '').trim();

    if (field === 'name') {
        _draft.name = raw;
    } else if (field === 'nicknames') {
        _draft.nicknames = raw.split(',').map(s => s.trim()).filter(Boolean);
    } else if (field === 'birthday') {
        _draft.birthday = raw;
        const lunarCheck = row.querySelector('[data-lunar]');
        if (lunarCheck) _draft.birthdayLunar = lunarCheck.checked;
    } else if (field === 'city') {
        _draft.city = raw;
        const c = CITY_PRESETS.find(p => p.id === raw);
        if (c && c.timezone) _draft.timezone = c.timezone;
    } else if (field === 'devotionalLevel') {
        _draft.devotionalLevel = raw || null;
    } else if (field === 'bibleVersion') {
        _draft.bibleVersion = raw || 'krv';
    } else {
        _draft[field] = raw;
    }

    _draft.lastSelfUpdatedAt = new Date().toISOString();

    try {
        await saveSelfCard(dek, _userId, _draft);
        showToast('저장됐어요.', 'success');
        // 새 화면 그리기 — 같은 카드 모양 그대로
        const container = document.getElementById('view-self-profile');
        if (container) {
            container.innerHTML = pageTemplate(_draft);
            bindEvents(container);
            renderLucideIcons();
        }
    } catch (e) {
        console.error('[selfProfile] save failed:', e);
        showToast('저장 실패: ' + (e?.message || '알 수 없음'), 'error');
    }
}

function rebindRowByField(field) {
    const row = document.querySelector(`.sf-row[data-field="${field}"]`);
    if (!row) return;
    const editBtn = row.querySelector('[data-edit]');
    if (editBtn) editBtn.addEventListener('click', () => enterEditMode(row));
}

// ═══════════════════════════════════════════════════════════════════════
//  유틸
// ═══════════════════════════════════════════════════════════════════════

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function escapeAttr(s) {
    return escapeHtml(s);
}

// ═══════════════════════════════════════════════════════════════════════
//  스타일 (한 번만 주입)
// ═══════════════════════════════════════════════════════════════════════

function injectStylesOnce() {
    if (document.getElementById('sf-styles-v70')) return;
    const style = document.createElement('style');
    style.id = 'sf-styles-v70';
    style.textContent = `
        /* (v70 2026-05-18) 본인 프로필 카드 2장 — 아이콘 0, 단순 라벨·값 */
        .sf-state-card {
            padding: var(--sp-5);
            background: var(--surface-card);
            border: 1px solid var(--line);
            border-radius: var(--radius-lg);
            color: var(--text-secondary);
            font-size: 14px;
            text-align: center;
        }
        .sf-cards {
            display: flex;
            flex-direction: column;
            gap: var(--sp-4);
            max-width: 720px;
        }
        .sf-card {
            background: var(--surface-card);
            border: 1px solid var(--line);
            border-radius: var(--radius-lg);
            padding: var(--sp-5);
            box-shadow: var(--shadow-sm);
        }
        .sf-card-title {
            font-family: var(--font-serif);
            font-size: 18px;
            font-weight: 600;
            color: var(--text-primary);
            margin: 0 0 var(--sp-4);
            padding: 0 0 var(--sp-3);
            border-bottom: 1px solid var(--line);
            letter-spacing: -0.01em;
            display: flex;
            align-items: center;
            gap: var(--sp-2);
        }
        .sf-card-icon {
            width: 18px;
            height: 18px;
            stroke-width: 1.75;
            color: var(--brand-primary);
            flex-shrink: 0;
        }
        .sf-row {
            display: grid;
            grid-template-columns: 110px 1fr auto auto;
            align-items: center;
            gap: var(--sp-3);
            padding: 12px 0;
            border-bottom: 1px solid var(--line);
            min-height: 44px;
        }
        .sf-row:last-child { border-bottom: 0; }
        .sf-label {
            font-size: 13px;
            color: var(--text-secondary);
        }
        .sf-value {
            font-size: 14px;
            color: var(--text-primary);
            min-width: 0;
            word-break: break-word;
        }
        .sf-value-editing {
            display: flex;
            align-items: center;
            gap: var(--sp-2);
        }
        .sf-empty {
            color: var(--ink-secondary);
            font-style: italic;
            font-size: 13px;
        }
        .sf-edit-btn,
        .sf-save-btn,
        .sf-cancel-btn {
            background: transparent;
            border: 1px solid var(--line);
            border-radius: var(--radius);
            padding: 4px 10px;
            font-size: 12px;
            color: var(--text-secondary);
            cursor: pointer;
            transition: background var(--ease), color var(--ease), border-color var(--ease);
            white-space: nowrap;
        }
        .sf-edit-btn:hover,
        .sf-cancel-btn:hover {
            background: var(--accent-soft);
            color: var(--text-primary);
            border-color: var(--accent-soft);
        }
        .sf-save-btn {
            background: var(--accent);
            color: var(--surface-card, #fff);
            border-color: var(--accent);
        }
        .sf-save-btn:hover {
            opacity: 0.9;
        }
        .sf-input,
        .sf-select {
            padding: 6px 10px;
            font-size: 14px;
            border: 1px solid var(--line);
            border-radius: var(--radius);
            background: var(--bg);
            color: var(--text-primary);
            width: 100%;
            box-sizing: border-box;
            font-family: inherit;
        }
        .sf-birthday-editor {
            display: flex;
            align-items: center;
            gap: var(--sp-2);
            flex-wrap: wrap;
        }
        .sf-birthday-editor .sf-input { width: auto; max-width: 160px; }
        .sf-lunar-toggle {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 13px;
            color: var(--text-secondary);
            cursor: pointer;
        }
        @media (max-width: 767px) {
            .sf-row {
                grid-template-columns: 80px 1fr auto;
            }
            .sf-cancel-btn {
                grid-column: 1 / -1;
                justify-self: end;
                margin-top: 4px;
            }
        }

        /* (v75 2026-05-18) 내 추천 링크 카드 톤 */
        .sf-referral-desc {
            margin: 0 0 var(--sp-3);
            font-size: 13px;
            color: var(--text-secondary);
            line-height: 1.5;
        }
        .sf-referral-row {
            display: flex;
            align-items: center;
            gap: var(--sp-2);
            margin: 0 0 var(--sp-3);
        }
        .sf-referral-url {
            flex: 1;
            padding: 8px 10px;
            font-size: 13px;
            border: 1px solid var(--line);
            border-radius: var(--radius);
            background: var(--bg);
            color: var(--text-primary);
            font-family: inherit;
            min-width: 0;
        }
        .sf-referral-copy {
            padding: 8px 14px;
            background: var(--accent);
            color: var(--surface-card, #fff);
            border: 1px solid var(--accent);
            border-radius: var(--radius);
            font-size: 13px;
            font-family: inherit;
            cursor: pointer;
            white-space: nowrap;
            transition: opacity var(--ease);
        }
        .sf-referral-copy:hover { opacity: 0.9; }
        .sf-referral-count {
            margin: 0;
            font-size: 13px;
            color: var(--text-secondary);
        }
        .sf-referral-count strong {
            color: var(--text-primary);
            font-weight: 600;
        }
    `;
    document.head.appendChild(style);
}
