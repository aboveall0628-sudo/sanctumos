/**
 * selfProfile.js — B-4 본인 프로필 1차 (2026-05-13)
 *
 * 본인 카드 = persons 컬렉션 안 isSelf=true 카드 1장.
 * 인물 화면(view-persons)에는 자동 제외, 본인 카드만 이 화면에서 다룸.
 *
 * 구성:
 *   - 정체성 1층: 이름·별명·생일
 *   - Big5 (자기 평가, 5축 슬라이더 + 모르겠어요)
 *   - 능력 8축 (자기 평가, 슬라이더)
 *   - 강점·경향(약점)·meaningfulVerse·notes (인물 카드 공통)
 *   - 🪪 신분증 묶음: lifeStage, currentCity
 *   - ⛪ 신앙 묶음: homeChurch, faithStartDate, faithTone (영적 은사 제외 — 공동체 모듈 진입 시 별도)
 *   - 🎯 소명 묶음: valueKeywords, lifeMission, interests
 *   - 🧠 자기 인식 묶음: identitySentence, currentChallenges, mbti
 *   - 🎚️ 필드별 visibility 토글 (public / shared / private)
 *   - 📷 시점 스냅샷: 1차엔 lastSelfUpdatedAt 표시만, 자동 보존 로직은 다음 트랙
 *
 * 정체성 원칙:
 *   - 평가보다 인과: 자동 점수화 X, 모든 값은 사용자가 직접 입력
 *   - 묵상으로 돌아가기: meaningfulVerse 칸은 항상 노출
 *   - 거대한 유기체: 본인 카드도 persons 컬렉션 공통 모델 — 도트·인물 모듈과 자연 연결
 */

import { getDEK } from './lockScreen.js';
import { ensureSelfCard, saveSelfCard } from '../data/personRepo.js';
import { showToast } from './quickReview.js';

// ─── 상수: 본인 전용 visibility 디폴트 ───
// 사용자가 카드 안에서 칩 클릭으로 바꿀 수 있고, 변경 결과만 profileVisibility 객체에 저장됨.
const VISIBILITY_DEFAULT = {
    // 인물 카드 공통
    name: 'public',
    nicknames: 'shared',
    birthday: 'shared',
    bigFive: 'shared',
    competencies: 'public',         // 공동체 매력 어필 핵심
    strengths: 'public',
    tendencies: 'private',          // 약점은 깊은 정보
    meaningfulVerse: 'shared',
    notes: 'private',
    // 본인 전용
    lifeStage: 'public',
    currentCity: 'public',
    homeChurch: 'public',
    faithStartDate: 'shared',
    faithTone: 'shared',
    valueKeywords: 'public',
    lifeMission: 'shared',
    interests: 'public',
    identitySentence: 'public',
    currentChallenges: 'private',   // B-6 자기합리화 방지와 직결
    mbti: 'public',
};

const VISIBILITY_META = {
    public:  { icon: '🌍', label: '공개',     hint: '소그룹·자기소개·P2P 첫 인사' },
    shared:  { icon: '🤝', label: '친한 사이', hint: '친구·팀원에게만' },
    private: { icon: '🔒', label: '비공개',   hint: '본인·멘토만' },
};

const VISIBILITY_ORDER = ['public', 'shared', 'private']; // 칩 클릭 시 다음 단계로 순환

const BIGFIVE_KEYS = [
    { k: 'O', name: '개방성', hint: '새로움 · 호기심' },
    { k: 'C', name: '성실성', hint: '책임 · 계획' },
    { k: 'E', name: '외향성', hint: '에너지 방향' },
    { k: 'A', name: '우호성', hint: '협력 · 신뢰' },
    { k: 'N', name: '신경증', hint: '정서 안정 ↔ 불안' },
];

const COMPETENCY_KEYS = [
    ['analysis',      '분석'],
    ['execution',     '실행'],
    ['creativity',    '창의'],
    ['communication', '소통'],
    ['leadership',    '리더십'],
    ['empathy',       '공감'],
    ['expertise',     '전문성'],
    ['stamina',       '체력'],
];

const SLIDER_LEVELS = [0, 25, 50, 75, 100];

// ─── 모듈 상태 ───
let _userId = null;
let _draft = null;   // 편집 중 본인 카드 사본

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
    } catch (e) {
        console.error('[selfProfile] load failed:', e);
        container.innerHTML = errorTemplate(e?.message || '알 수 없는 오류');
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  템플릿
// ═══════════════════════════════════════════════════════════════════════

function lockedTemplate() {
    return `
        <div class="page-header">
            <h1><i class="page-icon" data-lucide="user-circle"></i> 내 프로필</h1>
            <p class="subtitle">잠금이 해제되면 본인 프로필을 편집하실 수 있어요.</p>
        </div>
    `;
}

function loadingTemplate() {
    return `<div class="loading-state"><p>본인 카드를 불러오고 있어요…</p></div>`;
}

function errorTemplate(msg) {
    return `
        <div class="page-header">
            <h1><i class="page-icon" data-lucide="user-circle"></i> 내 프로필</h1>
            <p class="subtitle">불러오는 중 문제가 생겼어요: ${escapeHtml(msg)}</p>
        </div>
    `;
}

function pageTemplate(d) {
    const v = (field) => visibilityChipHtml(field, getVisibility(d, field));
    const lastUpdated = d.lastSelfUpdatedAt
        ? new Date(d.lastSelfUpdatedAt).toLocaleString('ko-KR')
        : '아직 저장 안 됨';

    return `
        <header class="page-header">
            <h1><i class="page-icon" data-lucide="user-circle"></i> 내 프로필</h1>
            <p class="subtitle">"나는 누구인가" 한 자리에 모아두는 카드예요. 5년·10년 회고의 기준점이 됩니다.</p>
        </header>

        <div class="self-profile-intro">
            <p>
                각 칸 옆 작은 칩(🌍 / 🤝 / 🔒)을 누르면 공개 두께를 바꿀 수 있어요.
                <strong>지금은 모델만 자리잡혀 있고, 실제로 다른 사람에게 보내는 기능은 공동체 모듈과 함께 열릴 예정</strong>이에요.
            </p>
            <p class="self-profile-snapshot-note">📷 마지막 저장: <strong>${lastUpdated}</strong></p>
        </div>

        <!-- 정체성 1층 -->
        <section class="card-section self-section">
            <h2 class="section-title"><i class="section-icon" data-lucide="user"></i> 기본 정체성</h2>
            <div class="self-field">
                <label>이름 ${v('name')}</label>
                <input type="text" id="sf-name" value="${escapeAttr(d.name)}" placeholder="본명">
            </div>
            <div class="self-field">
                <label>별명 (쉼표로 구분) ${v('nicknames')}</label>
                <input type="text" id="sf-nicknames" value="${escapeAttr((d.nicknames || []).join(', '))}" placeholder="별명1, 별명2">
            </div>
            <div class="self-field">
                <label>생일 ${v('birthday')}</label>
                <input type="text" id="sf-birthday" value="${escapeAttr(d.birthday)}" placeholder="YYYY-MM-DD 또는 자유 텍스트">
            </div>
        </section>

        <!-- 정체성 한 줄 -->
        <section class="card-section self-section">
            <h2 class="section-title"><i class="section-icon" data-lucide="quote"></i> 정체성 한 줄</h2>
            <div class="self-field">
                <label>"나는 어떤 사람인가" ${v('identitySentence')}</label>
                <textarea id="sf-identity" rows="2" placeholder="예: 말씀 앞에서 정직하려 애쓰는 한 사람">${escapeHtml(d.identitySentence)}</textarea>
            </div>
        </section>

        <!-- 🪪 신분증 묶음 -->
        <section class="card-section self-section">
            <h2 class="section-title">🪪 신분증</h2>
            <div class="self-field">
                <label>현재 인생 단계 ${v('lifeStage')}</label>
                <input type="text" id="sf-lifestage" value="${escapeAttr(d.lifeStage)}" placeholder="학생 / 직장인 / 결혼 / 부모 / 은퇴 등">
            </div>
            <div class="self-field">
                <label>현재 도시 ${v('currentCity')}</label>
                <input type="text" id="sf-city" value="${escapeAttr(d.currentCity)}" placeholder="예: 서울">
            </div>
        </section>

        <!-- ⛪ 신앙 묶음 (영적 은사 제외 — 공동체 모듈 진입 시) -->
        <section class="card-section self-section">
            <h2 class="section-title">⛪ 신앙</h2>
            <p class="section-desc-foot">
                💡 영적 은사·재능·섬김 이력은 공동체 모듈 진입 시 별도로 깊이 풀 예정이에요.
                (잘못 박으면 다른 분들이 시험에 들 수 있어 신중하게 가고 있어요.)
            </p>
            <div class="self-field">
                <label>소속 교회 ${v('homeChurch')}</label>
                <input type="text" id="sf-church" value="${escapeAttr(d.homeChurch)}" placeholder="교회 이름">
            </div>
            <div class="self-field">
                <label>신앙 시작 시점 ${v('faithStartDate')}</label>
                <input type="text" id="sf-faith-start" value="${escapeAttr(d.faithStartDate)}" placeholder="YYYY 또는 자유 텍스트">
            </div>
            <div class="self-field">
                <label>신앙 톤 ${v('faithTone')}</label>
                <input type="text" id="sf-faith-tone" value="${escapeAttr(d.faithTone)}" placeholder="묵상형 / 전도형 / 섬김형 / 기도 중심 등">
            </div>
        </section>

        <!-- 🎯 소명 묶음 -->
        <section class="card-section self-section">
            <h2 class="section-title">🎯 소명</h2>
            <div class="self-field">
                <label>가치관 키워드 (쉼표로 구분) ${v('valueKeywords')}</label>
                <input type="text" id="sf-values" value="${escapeAttr((d.valueKeywords || []).join(', '))}" placeholder="정직, 사랑, 진실, 인내 ...">
            </div>
            <div class="self-field">
                <label>인생 미션 한 줄 ${v('lifeMission')}</label>
                <textarea id="sf-mission" rows="2" placeholder="예: 걸어다니는 성경으로 살기">${escapeHtml(d.lifeMission)}</textarea>
            </div>
            <div class="self-field">
                <label>관심사 (쉼표로 구분) ${v('interests')}</label>
                <input type="text" id="sf-interests" value="${escapeAttr((d.interests || []).join(', '))}" placeholder="독서, 음악, 산책 ...">
            </div>
        </section>

        <!-- 🧠 자기 인식 묶음 -->
        <section class="card-section self-section">
            <h2 class="section-title">🧠 자기 인식</h2>
            <div class="self-field">
                <label>현재 도전 중인 것 (쉼표로 구분) ${v('currentChallenges')}</label>
                <input type="text" id="sf-challenges" value="${escapeAttr((d.currentChallenges || []).join(', '))}" placeholder="새벽 묵상 회복, 게으름 다스리기 ...">
            </div>
            <div class="self-field">
                <label>MBTI ${v('mbti')}</label>
                <input type="text" id="sf-mbti" value="${escapeAttr(d.mbti)}" placeholder="선택, 예: INTJ" maxlength="4">
            </div>
        </section>

        <!-- 강점·경향 -->
        <section class="card-section self-section">
            <h2 class="section-title"><i class="section-icon" data-lucide="sparkles"></i> 강점 · 경향</h2>
            <div class="self-field">
                <label>강점 ${v('strengths')}</label>
                <textarea id="sf-strengths" rows="3" placeholder="잘하는 것·은혜받은 부분">${escapeHtml(d.strengths)}</textarea>
            </div>
            <div class="self-field">
                <label>경향 (약점·반복되는 패턴) ${v('tendencies')}</label>
                <textarea id="sf-tendencies" rows="3" placeholder="자주 걸려 넘어지는 패턴">${escapeHtml(d.tendencies)}</textarea>
            </div>
        </section>

        <!-- Big5 -->
        <section class="card-section self-section">
            <h2 class="section-title"><i class="section-icon" data-lucide="layers"></i> 성격 (Big 5)</h2>
            <p class="section-desc-foot">슬라이더는 자기 평가예요. 모르겠으면 "모르겠어요"를 체크해 50으로 두세요.</p>
            ${v('bigFive')}
            ${BIGFIVE_KEYS.map(b => sliderBlockHtml('bigfive', b.k, b.name, b.hint, d.bigFive?.[b.k])).join('')}
        </section>

        <!-- 능력 8축 -->
        <section class="card-section self-section">
            <h2 class="section-title"><i class="section-icon" data-lucide="award"></i> 능력</h2>
            <p class="section-desc-foot">자기 평가예요. 공동체에서 "이런 일은 자신 있어요" 알리고 싶은 칸이라 디폴트가 🌍 공개로 잡혀 있어요.</p>
            ${v('competencies')}
            ${COMPETENCY_KEYS.map(([k, name]) => sliderBlockHtml('comp', k, name, '', d.competencies?.[k])).join('')}
        </section>

        <!-- meaningfulVerse + notes -->
        <section class="card-section self-section">
            <h2 class="section-title"><i class="section-icon" data-lucide="book-open"></i> 의미 있는 말씀 · 메모</h2>
            <div class="self-field">
                <label>나에게 의미 있는 말씀 ${v('meaningfulVerse')}</label>
                <textarea id="sf-verse" rows="2" placeholder="예: 시편 23편 1절">${escapeHtml(d.meaningfulVerse)}</textarea>
            </div>
            <div class="self-field">
                <label>메모 (본인만 보는 자유 노트) ${v('notes')}</label>
                <textarea id="sf-notes" rows="4" placeholder="아무도 안 보는 자리예요. 자유롭게.">${escapeHtml(d.notes)}</textarea>
            </div>
        </section>

        <!-- 저장 -->
        <div class="self-profile-save-bar">
            <button id="sf-save-btn" class="primary-btn">
                <i data-lucide="save" class="btn-icon"></i> 저장
            </button>
            <span id="sf-save-status" class="self-save-status"></span>
        </div>
    `;
}

function sliderBlockHtml(group, key, name, hint, currentVal) {
    const val = (currentVal === null || currentVal === undefined) ? null : currentVal;
    const unknown = val === null;
    return `
        <div class="self-slider-block" data-group="${group}" data-key="${key}">
            <div class="self-slider-head">
                <strong>${escapeHtml(name)}</strong>
                ${hint ? `<span class="self-slider-hint">${escapeHtml(hint)}</span>` : ''}
                <label class="self-slider-unknown">
                    <input type="checkbox" class="sf-unknown-check" ${unknown ? 'checked' : ''}>
                    모르겠어요
                </label>
            </div>
            <div class="self-slider-row">
                ${SLIDER_LEVELS.map(lv => `
                    <button type="button" class="self-slider-step ${val === lv ? 'active' : ''}" data-val="${lv}" ${unknown ? 'disabled' : ''}>${lv}</button>
                `).join('')}
            </div>
        </div>
    `;
}

function visibilityChipHtml(field, currentVal) {
    const meta = VISIBILITY_META[currentVal] || VISIBILITY_META.private;
    return `
        <button type="button" class="self-vis-chip" data-field="${field}" data-vis="${currentVal}" title="${meta.label} — ${meta.hint}">
            ${meta.icon}
        </button>
    `;
}

// ═══════════════════════════════════════════════════════════════════════
//  바인딩
// ═══════════════════════════════════════════════════════════════════════

function bindEvents(container) {
    // 슬라이더 step 클릭
    container.querySelectorAll('.self-slider-step').forEach(btn => {
        btn.addEventListener('click', () => {
            const block = btn.closest('.self-slider-block');
            const group = block.dataset.group;
            const key = block.dataset.key;
            const val = Number(btn.dataset.val);
            applySliderValue(group, key, val);
            block.querySelectorAll('.self-slider-step').forEach(b => b.classList.toggle('active', b === btn));
        });
    });

    // 모르겠어요 체크박스
    container.querySelectorAll('.sf-unknown-check').forEach(cb => {
        cb.addEventListener('change', () => {
            const block = cb.closest('.self-slider-block');
            const group = block.dataset.group;
            const key = block.dataset.key;
            const isUnknown = cb.checked;
            const steps = block.querySelectorAll('.self-slider-step');
            steps.forEach(s => {
                s.disabled = isUnknown;
                if (isUnknown) s.classList.remove('active');
            });
            applySliderValue(group, key, isUnknown ? null : 50);
            if (!isUnknown) {
                const mid = block.querySelector('.self-slider-step[data-val="50"]');
                if (mid) mid.classList.add('active');
            }
        });
    });

    // visibility 칩 클릭 — public → shared → private → public 순환
    container.querySelectorAll('.self-vis-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const field = chip.dataset.field;
            const cur = chip.dataset.vis;
            const next = VISIBILITY_ORDER[(VISIBILITY_ORDER.indexOf(cur) + 1) % VISIBILITY_ORDER.length];
            chip.dataset.vis = next;
            chip.textContent = VISIBILITY_META[next].icon;
            chip.title = `${VISIBILITY_META[next].label} — ${VISIBILITY_META[next].hint}`;
            setVisibility(field, next);
        });
    });

    // 저장 버튼
    const saveBtn = container.querySelector('#sf-save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => saveDraft(container));
    }

    if (typeof window.__sanctumRenderLucide === 'function') window.__sanctumRenderLucide();
}

function applySliderValue(group, key, val) {
    if (group === 'bigfive') {
        if (!_draft.bigFive) _draft.bigFive = { O: null, C: null, E: null, A: null, N: null };
        _draft.bigFive[key] = val;
    } else if (group === 'comp') {
        if (!_draft.competencies) _draft.competencies = {};
        _draft.competencies[key] = val;
    }
}

function getVisibility(d, field) {
    return (d.profileVisibility && d.profileVisibility[field]) || VISIBILITY_DEFAULT[field] || 'private';
}

function setVisibility(field, val) {
    if (!_draft.profileVisibility) _draft.profileVisibility = {};
    _draft.profileVisibility[field] = val;
}

async function saveDraft(container) {
    const dek = getDEK();
    if (!dek) { showToast('🔒 잠금이 걸려 있어요'); return; }

    // 입력값 수집
    _draft.name = container.querySelector('#sf-name')?.value.trim() || '';
    _draft.nicknames = splitCsv(container.querySelector('#sf-nicknames')?.value);
    _draft.birthday = container.querySelector('#sf-birthday')?.value.trim() || '';
    _draft.identitySentence = container.querySelector('#sf-identity')?.value.trim() || '';
    _draft.lifeStage = container.querySelector('#sf-lifestage')?.value.trim() || '';
    _draft.currentCity = container.querySelector('#sf-city')?.value.trim() || '';
    _draft.homeChurch = container.querySelector('#sf-church')?.value.trim() || '';
    _draft.faithStartDate = container.querySelector('#sf-faith-start')?.value.trim() || '';
    _draft.faithTone = container.querySelector('#sf-faith-tone')?.value.trim() || '';
    _draft.valueKeywords = splitCsv(container.querySelector('#sf-values')?.value);
    _draft.lifeMission = container.querySelector('#sf-mission')?.value.trim() || '';
    _draft.interests = splitCsv(container.querySelector('#sf-interests')?.value);
    _draft.currentChallenges = splitCsv(container.querySelector('#sf-challenges')?.value);
    _draft.mbti = (container.querySelector('#sf-mbti')?.value.trim() || '').toUpperCase();
    _draft.strengths = container.querySelector('#sf-strengths')?.value.trim() || '';
    _draft.tendencies = container.querySelector('#sf-tendencies')?.value.trim() || '';
    _draft.meaningfulVerse = container.querySelector('#sf-verse')?.value.trim() || '';
    _draft.notes = container.querySelector('#sf-notes')?.value.trim() || '';

    const status = container.querySelector('#sf-save-status');
    if (status) status.textContent = '저장 중…';

    try {
        const saved = await saveSelfCard(dek, _userId, _draft);
        _draft = saved;
        if (status) status.textContent = `✓ 저장됨 (${new Date(saved.lastSelfUpdatedAt).toLocaleTimeString('ko-KR')})`;
        showToast('🙋 본인 프로필이 저장됐어요');
        // 마지막 저장 시점 표시 갱신
        const note = container.querySelector('.self-profile-snapshot-note');
        if (note) {
            note.innerHTML = `📷 마지막 저장: <strong>${new Date(saved.lastSelfUpdatedAt).toLocaleString('ko-KR')}</strong>`;
        }
    } catch (e) {
        console.error('[selfProfile] save failed:', e);
        if (status) status.textContent = '저장 실패';
        showToast('저장 중 문제가 생겼어요');
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  유틸
// ═══════════════════════════════════════════════════════════════════════

function splitCsv(v) {
    if (!v) return [];
    return v.split(',').map(s => s.trim()).filter(Boolean);
}

function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/"/g, '&quot;');
}

// ═══════════════════════════════════════════════════════════════════════
//  일회성 CSS 주입 — 디자인 시스템 점검 트랙에서 style.css 로 흡수 예정
// ═══════════════════════════════════════════════════════════════════════
function injectStylesOnce() {
    if (document.getElementById('self-profile-styles')) return;
    const style = document.createElement('style');
    style.id = 'self-profile-styles';
    style.textContent = `
        #view-self-profile .self-profile-intro {
            background: var(--bg-secondary, #f4f1ec);
            border-left: 3px solid var(--brand-primary, #6d7666);
            padding: 12px 16px;
            border-radius: 8px;
            margin-bottom: 16px;
            font-size: 13px;
            color: var(--ink-secondary, #5d5a52);
            line-height: 1.6;
        }
        #view-self-profile .self-profile-snapshot-note {
            margin-top: 8px;
            font-size: 12px;
        }
        #view-self-profile .self-section { margin-bottom: 16px; }
        #view-self-profile .self-field {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin: 10px 0;
        }
        #view-self-profile .self-field label {
            font-size: 12px;
            color: var(--ink-secondary, #5d5a52);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        #view-self-profile .self-field input[type="text"],
        #view-self-profile .self-field textarea {
            padding: 8px 10px;
            border: 1px solid var(--border, #d8d3c8);
            border-radius: 8px;
            background: var(--bg, #faf7f2);
            color: var(--text-primary, #1a1814);
            font-size: 14px;
            font-family: inherit;
            resize: vertical;
        }
        #view-self-profile .self-vis-chip {
            border: 1px solid var(--border, #d8d3c8);
            background: var(--bg, #faf7f2);
            border-radius: 999px;
            width: 22px;
            height: 22px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            cursor: pointer;
            padding: 0;
            line-height: 1;
        }
        #view-self-profile .self-vis-chip:hover {
            background: var(--bg-secondary, #f0ece4);
        }
        #view-self-profile .self-slider-block {
            margin: 10px 0;
            padding: 10px;
            background: var(--bg-secondary, #f4f1ec);
            border-radius: 8px;
        }
        #view-self-profile .self-slider-head {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 6px;
            flex-wrap: wrap;
        }
        #view-self-profile .self-slider-hint {
            font-size: 11px;
            color: var(--ink-secondary, #5d5a52);
        }
        #view-self-profile .self-slider-unknown {
            margin-left: auto;
            font-size: 11px;
            color: var(--ink-secondary, #5d5a52);
            display: flex;
            align-items: center;
            gap: 4px;
            cursor: pointer;
        }
        #view-self-profile .self-slider-row {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
        }
        #view-self-profile .self-slider-step {
            padding: 4px 12px;
            border: 1px solid var(--border, #d8d3c8);
            background: var(--bg, #faf7f2);
            border-radius: 6px;
            font-size: 12px;
            cursor: pointer;
            color: var(--text-primary, #1a1814);
        }
        #view-self-profile .self-slider-step:hover:not(:disabled) {
            background: var(--bg-secondary, #f0ece4);
        }
        #view-self-profile .self-slider-step.active {
            background: var(--brand-primary, #6d7666);
            color: #fff;
            border-color: var(--brand-primary, #6d7666);
        }
        #view-self-profile .self-slider-step:disabled {
            opacity: 0.4;
            cursor: not-allowed;
        }
        #view-self-profile .self-profile-save-bar {
            position: sticky;
            bottom: 0;
            background: var(--bg, #faf7f2);
            padding: 16px 0;
            border-top: 1px solid var(--border, #d8d3c8);
            display: flex;
            align-items: center;
            gap: 12px;
            margin-top: 24px;
            z-index: 10;
        }
        #view-self-profile .self-save-status {
            font-size: 12px;
            color: var(--ink-secondary, #5d5a52);
        }
    `;
    document.head.appendChild(style);
}
