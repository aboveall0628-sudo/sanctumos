/**
 * onboarding.js — 신규 사용자 첫 진입 모달 (Day 0 도트 학교 첫 수업)
 *
 * (본인 프로필 재기획 트랙 2026-05-14 S-D / 2026-05-15 S-D 후속 대확장)
 *
 * 최종 흐름 (2026-05-15 합의):
 *   [1/8] 이름
 *   [2/8] 별명
 *   [3/8] 생일      → 나이대 어체 자동 적응
 *   [4/8] 큐티 수준  🌱🌿🌳
 *   [5/8] 성경 번역본 (개역개정 디폴트, 다른 번역본은 "준비 중")
 *   [6/8] 폰트 크기 (시스템 + 성경 본문 별도 슬라이더, 즉시 미리보기)
 *   [7/8] 기본 원칙 (추천 1개 자동 채움 + 수정 가능)
 *   [8/8] 첫 묵상 한 절 (큐티 수준 따라 추천 본문 1절 + 한 줄 적기)
 *     ↓
 *   [마침 카드]
 *     · 방금 완료 항목 요약
 *     · 🎯 14일 동안 천천히 열릴 미션 카탈로그 안내
 *     · [의사결정 한 번 해볼게요] / [오늘로 갈게요]
 *
 * 핵심 결:
 *   - R3 "빠르고 정확": 30초~3분 안에 끝나는 가벼움 유지
 *   - 풀사이클(인물·조직·경제·시간표·평가·리포트)은 R7 미션 시스템이 14일 자연 분산
 *   - 묵상은 "걸어다니는 성경" 정체성을 첫날 한 번 시연하는 자리
 *
 * 자동 라우팅:
 *   app.js 잠금 해제 후 ensureSelfCard → selfCard.name 빈 값이면 즉시 showOnboardingModal.
 */

import { ensureSelfCard, saveSelfCard, markMissionComplete } from '../data/personRepo.js';
import { AGE_TONES, ageFromBirthday, toneIdFromAge } from '../config/ageTones.js';
import { DEFAULT_TRACK_BY_LEVEL } from '../config/devotionalTracks.js';
import {
    BIBLE_VERSIONS, DEFAULT_BIBLE_VERSION,
    RECOMMENDED_PRINCIPLE, firstMeditationForLevel,
} from '../config/onboardingDefaults.js';
import {
    SYSTEM_FONT_SIZES, getSystemFontScale, setSystemFontScale, applySystemFontScale,
} from '../config/systemFont.js';
import {
    FONT_SIZES as SCRIPTURE_FONT_SIZES,
    getScriptureSettings, setFontSize as setScriptureFontSize, applyFontSizeToCSS as applyScriptureFontToCSS,
} from './scriptureSettings.js';
import { savePrinciple } from '../data/principlesRepo.js';
import { saveRecord } from '../data/baseRepo.js';
import { getActiveMissionIds, MISSION_CATALOG } from '../config/missionCatalog.js';

const TOTAL_STEPS = 8;

const CUTI_LEVELS = [
    {
        id: 'basic',
        icon: '🌱',
        title: '처음이에요',
        sub: '말씀 묵상이 처음이거나, 가벼운 한 절부터 시작하고 싶어요.',
        recommendation: '"성경 필수 구절 100" 트랙으로 시작',
    },
    {
        id: 'intermediate',
        icon: '🌿',
        title: '가끔 해요',
        sub: '평소 단락 단위로 묵상하고 있어요.',
        recommendation: '자유 본문 선택',
    },
    {
        id: 'advanced',
        icon: '🌳',
        title: '자주 해요',
        sub: '매일 묵상 중이고, 진도가 있어요. 여러 본문을 동시에 보기도 해요.',
        recommendation: '진도 이어가기 + 다중 본문 자유',
    },
];

let _state = null;  // { userId, dek, draft, onComplete, snapshots }

/**
 * 사용자 첫 진입 모달 표시.
 *
 * @param {Object} opts
 *   - userId: 필수
 *   - dek: 필수 (CryptoKey)
 *   - onComplete: () => void
 *   - existingCard: 옵션
 */
export async function showOnboardingModal({ userId, dek, onComplete, existingCard }) {
    if (!userId || !dek) {
        console.warn('[onboarding] missing userId or dek');
        return;
    }

    closeOnboardingModal();

    const card = existingCard || await ensureSelfCard(dek, userId);

    // 폰트 미리보기 시작값 저장 — 사용자가 "이전" 누르거나 모달 닫으면 원복 가능하게
    const initialSystemFont = getSystemFontScale();
    const initialScriptureFont = getScriptureSettings().fontSize;

    _state = {
        userId,
        dek,
        onComplete: onComplete || (() => {}),
        draft: {
            name: card.name || '',
            nickname: Array.isArray(card.nicknames) && card.nicknames[0] || '',
            birthday: card.birthday || '',
            devotionalLevel: card.devotionalLevel || null,
            bibleVersion: card.bibleVersion || DEFAULT_BIBLE_VERSION,
            systemFont: initialSystemFont,
            scriptureFont: initialScriptureFont,
            // 원칙 — 추천 디폴트로 미리 채움
            principleTitle: RECOMMENDED_PRINCIPLE.title,
            principleBody: RECOMMENDED_PRINCIPLE.body,
            // 첫 묵상 — step 8 에서 큐티 수준 따라 자동 셋업
            meditationNote: '',
            // step 8 시점 사용자가 본 본문 (저장 시 함께 박힘)
            meditationScripture: null,
        },
        snapshots: {
            initialSystemFont,
            initialScriptureFont,
        },
        cardSnapshot: card,
    };

    const backdrop = document.createElement('div');
    backdrop.className = 'onboarding-backdrop';
    backdrop.id = 'onboarding-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-labelledby', 'onboarding-title');
    backdrop.innerHTML = `
      <div class="onboarding-modal age-tone-young" id="onboarding-modal">
        <div class="onboarding-stepper" id="onboarding-stepper" aria-label="진행도">
          ${Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(n =>
            `<span class="onboarding-step-dot${n === 1 ? ' active' : ''}" data-step="${n}"></span>`
          ).join('')}
        </div>
        <div class="onboarding-body" id="onboarding-body"></div>
      </div>
    `;
    document.body.appendChild(backdrop);

    renderStep(1);
}

export function closeOnboardingModal() {
    const existing = document.getElementById('onboarding-backdrop');
    if (existing) existing.remove();
    _state = null;
}

function updateStepperDots(currentStep) {
    document.querySelectorAll('#onboarding-stepper .onboarding-step-dot').forEach(el => {
        const n = parseInt(el.dataset.step, 10);
        el.classList.toggle('active', n === currentStep);
        el.classList.toggle('done', n < currentStep);
    });
}

function applyAgeToneClass() {
    const modal = document.getElementById('onboarding-modal');
    if (!modal) return;
    const age = ageFromBirthday(_state?.draft?.birthday);
    const toneId = toneIdFromAge(age);
    modal.classList.remove('age-tone-young', 'age-tone-middle', 'age-tone-senior');
    modal.classList.add(`age-tone-${toneId}`);
}

function getTone() {
    const age = ageFromBirthday(_state?.draft?.birthday);
    return AGE_TONES[toneIdFromAge(age)];
}

function renderStep(step) {
    if (step >= 1 && step <= TOTAL_STEPS) updateStepperDots(step);
    const body = document.getElementById('onboarding-body');
    if (!body) return;

    if (step === 1) renderNameStep(body);
    else if (step === 2) renderNicknameStep(body);
    else if (step === 3) renderBirthdayStep(body);
    else if (step === 4) renderCutiStep(body);
    else if (step === 5) renderBibleVersionStep(body);
    else if (step === 6) renderFontStep(body);
    else if (step === 7) renderPrincipleStep(body);
    else if (step === 8) renderMeditationStep(body);
    else if (step === 99) renderFinishCard(body);
}

// ─── Step 1: 이름 ─────────────────────────────────────────
function renderNameStep(body) {
    const tone = getTone();
    body.innerHTML = `
      <div class="onboarding-card">
        <p class="onboarding-greeting">${escapeHtml(tone.welcomeGreeting)}</p>
        <p class="onboarding-sub">${escapeHtml(tone.welcomeSub)}</p>
        <h2 class="onboarding-title" id="onboarding-title">어떻게 불러드릴까요?</h2>
        <label class="onboarding-label">이름 또는 자주 쓰는 이름</label>
        <input type="text" class="onboarding-input" id="onboarding-name"
               value="${escapeAttr(_state.draft.name)}"
               placeholder="예: 김선재" maxlength="40" autofocus />
        <div class="onboarding-actions">
          <button type="button" class="onboarding-btn onboarding-btn-primary" id="onboarding-next">다음</button>
        </div>
      </div>
    `;
    const input = document.getElementById('onboarding-name');
    const nextBtn = document.getElementById('onboarding-next');
    const updateBtn = () => { nextBtn.disabled = !input.value.trim(); };
    input.addEventListener('input', () => {
        _state.draft.name = input.value.trim();
        updateBtn();
    });
    updateBtn();
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !nextBtn.disabled) nextBtn.click(); });
    nextBtn.addEventListener('click', () => renderStep(2));
}

// ─── Step 2: 별명 ─────────────────────────────────────────
function renderNicknameStep(body) {
    body.innerHTML = `
      <div class="onboarding-card">
        <h2 class="onboarding-title">${escapeHtml(_state.draft.name)}님, 별명도 있으세요?</h2>
        <p class="onboarding-sub">아침에 가장 듣고 싶은 호칭이 있다면 적어보세요. (선택)</p>
        <input type="text" class="onboarding-input" id="onboarding-nickname"
               value="${escapeAttr(_state.draft.nickname)}"
               placeholder="예: 선재, 형제님, 자매님" maxlength="40" autofocus />
        <div class="onboarding-actions onboarding-actions-split">
          <button type="button" class="onboarding-btn onboarding-btn-text" id="onboarding-back">이전</button>
          <div class="onboarding-actions-right">
            <button type="button" class="onboarding-btn onboarding-btn-secondary" id="onboarding-skip">건너뛰기</button>
            <button type="button" class="onboarding-btn onboarding-btn-primary" id="onboarding-next">다음</button>
          </div>
        </div>
      </div>
    `;
    const input = document.getElementById('onboarding-nickname');
    input.addEventListener('input', () => { _state.draft.nickname = input.value.trim(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('onboarding-next').click(); });
    document.getElementById('onboarding-back').addEventListener('click', () => renderStep(1));
    document.getElementById('onboarding-skip').addEventListener('click', () => {
        _state.draft.nickname = '';
        renderStep(3);
    });
    document.getElementById('onboarding-next').addEventListener('click', () => renderStep(3));
}

// ─── Step 3: 생일 ─────────────────────────────────────────
function renderBirthdayStep(body) {
    body.innerHTML = `
      <div class="onboarding-card">
        <h2 class="onboarding-title">생일이 언제이신가요?</h2>
        <p class="onboarding-sub">나이대에 맞는 말투로 안내해드릴게요. 정확한 날짜 모르면 연도만 적어도 돼요.</p>
        <input type="date" class="onboarding-input" id="onboarding-birthday"
               value="${escapeAttr(_state.draft.birthday)}"
               max="${new Date().toISOString().slice(0, 10)}" />
        <div class="onboarding-actions onboarding-actions-split">
          <button type="button" class="onboarding-btn onboarding-btn-text" id="onboarding-back">이전</button>
          <div class="onboarding-actions-right">
            <button type="button" class="onboarding-btn onboarding-btn-secondary" id="onboarding-skip">나중에</button>
            <button type="button" class="onboarding-btn onboarding-btn-primary" id="onboarding-next">다음</button>
          </div>
        </div>
      </div>
    `;
    const input = document.getElementById('onboarding-birthday');
    input.addEventListener('input', () => { _state.draft.birthday = input.value; });
    document.getElementById('onboarding-back').addEventListener('click', () => renderStep(2));
    document.getElementById('onboarding-skip').addEventListener('click', () => {
        _state.draft.birthday = '';
        renderStep(4);
    });
    document.getElementById('onboarding-next').addEventListener('click', () => {
        applyAgeToneClass();
        renderStep(4);
    });
}

// ─── Step 4: 큐티 수준 ────────────────────────────────────
function renderCutiStep(body) {
    const tone = getTone();
    body.innerHTML = `
      <div class="onboarding-card">
        <h2 class="onboarding-title">${escapeHtml(tone.cutiPrompt)}</h2>
        <p class="onboarding-sub">평소 묵상 깊이에 맞춰 시작 자리를 정해드려요. 나중에 언제든 바꿀 수 있어요.</p>
        <div class="onboarding-cuti-cards" role="radiogroup" aria-label="큐티 수준">
          ${CUTI_LEVELS.map(lv => `
            <button type="button" class="onboarding-cuti-card${_state.draft.devotionalLevel === lv.id ? ' selected' : ''}"
                    data-level="${escapeAttr(lv.id)}" role="radio"
                    aria-checked="${_state.draft.devotionalLevel === lv.id}">
              <span class="onboarding-cuti-icon">${escapeHtml(lv.icon)}</span>
              <span class="onboarding-cuti-title">${escapeHtml(lv.title)}</span>
              <span class="onboarding-cuti-sub">${escapeHtml(lv.sub)}</span>
              <span class="onboarding-cuti-rec">${escapeHtml(lv.recommendation)}</span>
            </button>
          `).join('')}
        </div>
        <div class="onboarding-actions onboarding-actions-split">
          <button type="button" class="onboarding-btn onboarding-btn-text" id="onboarding-back">이전</button>
          <button type="button" class="onboarding-btn onboarding-btn-primary" id="onboarding-next" disabled>다음</button>
        </div>
      </div>
    `;
    const nextBtn = document.getElementById('onboarding-next');
    const updateBtn = () => { nextBtn.disabled = !_state.draft.devotionalLevel; };
    updateBtn();
    document.querySelectorAll('.onboarding-cuti-card').forEach(btn => {
        btn.addEventListener('click', () => {
            _state.draft.devotionalLevel = btn.dataset.level;
            document.querySelectorAll('.onboarding-cuti-card').forEach(b => {
                b.classList.toggle('selected', b === btn);
                b.setAttribute('aria-checked', b === btn);
            });
            updateBtn();
        });
    });
    document.getElementById('onboarding-back').addEventListener('click', () => renderStep(3));
    nextBtn.addEventListener('click', () => renderStep(5));
}

// ─── Step 5: 성경 번역본 ──────────────────────────────────
function renderBibleVersionStep(body) {
    body.innerHTML = `
      <div class="onboarding-card">
        <h2 class="onboarding-title">어떤 성경으로 묵상하시나요?</h2>
        <p class="onboarding-sub">지금은 개역개정으로 만나실 수 있어요. 다른 번역본도 곧 준비 중이에요.</p>
        <div class="onboarding-bible-list" role="radiogroup" aria-label="성경 번역본">
          ${BIBLE_VERSIONS.map(v => `
            <button type="button"
                    class="onboarding-bible-card${_state.draft.bibleVersion === v.id ? ' selected' : ''}${v.preparing ? ' disabled' : ''}"
                    data-version="${escapeAttr(v.id)}"
                    role="radio"
                    aria-checked="${_state.draft.bibleVersion === v.id}"
                    ${v.preparing ? 'aria-disabled="true"' : ''}>
              <span class="onboarding-bible-name">
                ${escapeHtml(v.label)}
                ${v.preparing ? '<span class="onboarding-chip">준비 중</span>' : ''}
              </span>
              <span class="onboarding-bible-desc">${escapeHtml(v.desc)}</span>
            </button>
          `).join('')}
        </div>
        <div class="onboarding-actions onboarding-actions-split">
          <button type="button" class="onboarding-btn onboarding-btn-text" id="onboarding-back">이전</button>
          <button type="button" class="onboarding-btn onboarding-btn-primary" id="onboarding-next">다음</button>
        </div>
      </div>
    `;
    document.querySelectorAll('.onboarding-bible-card').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.version;
            const opt = BIBLE_VERSIONS.find(v => v.id === id);
            if (!opt || opt.preparing) return;
            _state.draft.bibleVersion = id;
            document.querySelectorAll('.onboarding-bible-card').forEach(b => {
                b.classList.toggle('selected', b === btn);
                b.setAttribute('aria-checked', b === btn);
            });
        });
    });
    document.getElementById('onboarding-back').addEventListener('click', () => renderStep(4));
    document.getElementById('onboarding-next').addEventListener('click', () => renderStep(6));
}

// ─── Step 6: 폰트 크기 ────────────────────────────────────
function renderFontStep(body) {
    body.innerHTML = `
      <div class="onboarding-card">
        <h2 class="onboarding-title">글자 크기를 정해볼까요?</h2>
        <p class="onboarding-sub">고르는 즉시 화면에 미리 보여요. 마음 편한 크기로 정하세요.</p>

        <div class="onboarding-font-group">
          <label class="onboarding-label">시스템 글자 크기 — 헤더·카드·라벨</label>
          <div class="onboarding-font-row" id="onboarding-system-font-row">
            ${Object.entries(SYSTEM_FONT_SIZES).map(([id, cfg]) => `
              <button type="button"
                      class="onboarding-font-chip${_state.draft.systemFont === id ? ' selected' : ''}"
                      data-system="${escapeAttr(id)}">
                <span class="onboarding-font-label">${escapeHtml(cfg.label)}</span>
                <span class="onboarding-font-desc">${escapeHtml(cfg.desc)}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="onboarding-font-group">
          <label class="onboarding-label">성경 본문 글자 크기 — 묵상 화면</label>
          <div class="onboarding-font-row" id="onboarding-scripture-font-row">
            ${Object.entries(SCRIPTURE_FONT_SIZES).map(([id, cfg]) => `
              <button type="button"
                      class="onboarding-font-chip${_state.draft.scriptureFont === id ? ' selected' : ''}"
                      data-scripture="${escapeAttr(id)}">
                <span class="onboarding-font-label">${escapeHtml(cfg.label)}</span>
                <span class="onboarding-font-sample" style="font-size:${cfg.verse}px; line-height:${cfg.lineHeight};">
                  태초에 하나님이 천지를 창조하시니라
                </span>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="onboarding-actions onboarding-actions-split">
          <button type="button" class="onboarding-btn onboarding-btn-text" id="onboarding-back">이전</button>
          <button type="button" class="onboarding-btn onboarding-btn-primary" id="onboarding-next">다음</button>
        </div>
      </div>
    `;
    document.querySelectorAll('#onboarding-system-font-row .onboarding-font-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.system;
            _state.draft.systemFont = id;
            applySystemFontScale(id);
            document.querySelectorAll('#onboarding-system-font-row .onboarding-font-chip').forEach(b => {
                b.classList.toggle('selected', b === btn);
            });
        });
    });
    document.querySelectorAll('#onboarding-scripture-font-row .onboarding-font-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.scripture;
            _state.draft.scriptureFont = id;
            applyScriptureFontToCSS(id);
            document.querySelectorAll('#onboarding-scripture-font-row .onboarding-font-chip').forEach(b => {
                b.classList.toggle('selected', b === btn);
            });
        });
    });
    document.getElementById('onboarding-back').addEventListener('click', () => renderStep(5));
    document.getElementById('onboarding-next').addEventListener('click', () => renderStep(7));
}

// ─── Step 7: 기본 원칙 ────────────────────────────────────
function renderPrincipleStep(body) {
    body.innerHTML = `
      <div class="onboarding-card">
        <h2 class="onboarding-title">의사결정 때 기댈 원칙 하나 정해요</h2>
        <p class="onboarding-sub">기본으로 추천 원칙 하나를 미리 채워둘게요. 그대로 두셔도 좋고, 본인 마음에 맞게 고쳐도 좋아요.</p>

        <label class="onboarding-label" for="onboarding-principle-title">원칙 제목</label>
        <input type="text" class="onboarding-input" id="onboarding-principle-title"
               value="${escapeAttr(_state.draft.principleTitle)}"
               placeholder="짧은 한 줄로" maxlength="80" />

        <label class="onboarding-label" for="onboarding-principle-body">원칙 본문</label>
        <textarea class="onboarding-textarea" id="onboarding-principle-body"
                  rows="4" maxlength="400"
                  placeholder="이 원칙이 어떤 자리에서 작동하는지 한두 문장으로">${escapeHtml(_state.draft.principleBody)}</textarea>

        <div class="onboarding-actions onboarding-actions-split">
          <button type="button" class="onboarding-btn onboarding-btn-text" id="onboarding-back">이전</button>
          <button type="button" class="onboarding-btn onboarding-btn-primary" id="onboarding-next">다음</button>
        </div>
      </div>
    `;
    const titleEl = document.getElementById('onboarding-principle-title');
    const bodyEl = document.getElementById('onboarding-principle-body');
    titleEl.addEventListener('input', () => { _state.draft.principleTitle = titleEl.value; });
    bodyEl.addEventListener('input', () => { _state.draft.principleBody = bodyEl.value; });
    document.getElementById('onboarding-back').addEventListener('click', () => renderStep(6));
    document.getElementById('onboarding-next').addEventListener('click', () => renderStep(8));
}

// ─── Step 8: 첫 묵상 한 절 ────────────────────────────────
function renderMeditationStep(body) {
    const tone = getTone();
    const passage = firstMeditationForLevel(_state.draft.devotionalLevel);
    _state.draft.meditationScripture = passage;
    body.innerHTML = `
      <div class="onboarding-card onboarding-card-meditation">
        <h2 class="onboarding-title">${escapeHtml(tone.firstDotInvite || '오늘 한 절 만나볼까요?')}</h2>
        <p class="onboarding-sub">선택하신 큐티 수준에 맞는 추천 본문이에요. 한 줄 적어 보시는 것만으로 첫 묵상이 자리잡아요.</p>

        <div class="onboarding-verse-card">
          <span class="onboarding-verse-ref">${escapeHtml(passage.ref)}</span>
          <p class="onboarding-verse-text" id="onboarding-verse-text">${escapeHtml(passage.text)}</p>
        </div>

        <label class="onboarding-label" for="onboarding-meditation-note">이 한 절을 보며 떠오른 한 줄</label>
        <textarea class="onboarding-textarea" id="onboarding-meditation-note"
                  rows="3" maxlength="400"
                  placeholder="짧은 감상·기도·결단·궁금증 — 무엇이든 한 줄이면 충분해요.">${escapeHtml(_state.draft.meditationNote)}</textarea>

        <div class="onboarding-actions onboarding-actions-split">
          <button type="button" class="onboarding-btn onboarding-btn-text" id="onboarding-back">이전</button>
          <div class="onboarding-actions-right">
            <button type="button" class="onboarding-btn onboarding-btn-secondary" id="onboarding-skip">나중에 적을게요</button>
            <button type="button" class="onboarding-btn onboarding-btn-primary" id="onboarding-finish">저장하고 마무리</button>
          </div>
        </div>
      </div>
    `;
    const noteEl = document.getElementById('onboarding-meditation-note');
    noteEl.addEventListener('input', () => { _state.draft.meditationNote = noteEl.value; });
    document.getElementById('onboarding-back').addEventListener('click', () => renderStep(7));
    document.getElementById('onboarding-skip').addEventListener('click', async () => {
        _state.draft.meditationNote = '';
        await persistAll();
        renderStep(99);
    });
    document.getElementById('onboarding-finish').addEventListener('click', async () => {
        const finishBtn = document.getElementById('onboarding-finish');
        finishBtn.disabled = true;
        finishBtn.textContent = '저장 중...';
        try {
            await persistAll();
            renderStep(99);
        } catch (e) {
            console.error('[onboarding] persistAll failed:', e);
            finishBtn.disabled = false;
            finishBtn.textContent = '다시 시도';
        }
    });
}

// ─── 마침 카드 ────────────────────────────────────────────
function renderFinishCard(body) {
    const tone = getTone();
    const callee = _state.draft.nickname || _state.draft.name || '친구';
    // 진행도 stepper 자리에 "완료" 시각
    document.querySelectorAll('#onboarding-stepper .onboarding-step-dot').forEach(el => {
        el.classList.remove('active');
        el.classList.add('done');
    });

    // 14일 안에 자연 열릴 미션 카탈로그 (deferred 제외, 자기 자신 카드 미션은 이미 완료)
    const missions = getActiveMissionIds()
        .map(id => ({ id, ...MISSION_CATALOG[id] }))
        .slice(0, 10);

    body.innerHTML = `
      <div class="onboarding-card onboarding-card-finish">
        <div class="onboarding-finish-celebrate">🎉</div>
        <h2 class="onboarding-title">${escapeHtml(callee)}님, 첫 한 바퀴 끝났어요</h2>
        <p class="onboarding-sub">방금 자리잡은 것들 — 신분증·추천 원칙·첫 묵상 한 절. 천천히 같이 가요.</p>

        <div class="onboarding-finish-missions">
          <p class="onboarding-finish-missions-title">🎯 14일 동안 천천히 열릴 미션들</p>
          <p class="onboarding-finish-missions-sub">하다 보면 자연스럽게 클리어돼요. 부담 갖지 마세요.</p>
          <div class="onboarding-finish-missions-grid">
            ${missions.map(m => `
              <div class="onboarding-mission-mini">
                <span class="onboarding-mission-icon">${escapeHtml(m.icon)}</span>
                <div class="onboarding-mission-text">
                  <span class="onboarding-mission-title">${escapeHtml(m.title)}</span>
                  <span class="onboarding-mission-hint">${escapeHtml(m.hint)}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <p class="onboarding-finish-cta">방금 정한 원칙으로 첫 의사결정 한 번 해보실래요?</p>
        <div class="onboarding-actions onboarding-actions-split">
          <button type="button" class="onboarding-btn onboarding-btn-secondary" id="onboarding-go-today">오늘 화면으로</button>
          <button type="button" class="onboarding-btn onboarding-btn-primary" id="onboarding-go-decision">의사결정 해볼게요</button>
        </div>
      </div>
    `;
    document.getElementById('onboarding-go-today').addEventListener('click', () => {
        const cb = _state.onComplete;
        closeOnboardingModal();
        try { cb(); } catch (_) {}
    });
    document.getElementById('onboarding-go-decision').addEventListener('click', async () => {
        const userId = _state.userId;
        const cb = _state.onComplete;
        closeOnboardingModal();
        try { cb(); } catch (_) {}
        try {
            const { openDecisionGate } = await import('./decisionGate.js');
            await openDecisionGate({ userId, mode: 'free' });
        } catch (e) {
            console.warn('[onboarding] openDecisionGate failed:', e?.message || e);
        }
    });
}

// ─── 저장 — 마지막 단계에서 일괄 ──────────────────────────
async function persistAll() {
    const { userId, dek, draft, cardSnapshot } = _state;
    const today = new Date().toISOString().slice(0, 10);

    // 1) selfCard — name·nickname·birthday·devotionalLevel·bibleVersion 저장
    const nicknames = draft.nickname ? [draft.nickname] : (cardSnapshot.nicknames || []);
    const cardPayload = {
        ...cardSnapshot,
        name: draft.name,
        nicknames,
        birthday: draft.birthday || cardSnapshot.birthday || '',
        devotionalLevel: draft.devotionalLevel || cardSnapshot.devotionalLevel || null,
        bibleVersion: draft.bibleVersion || DEFAULT_BIBLE_VERSION,
    };
    await saveSelfCard(dek, userId, cardPayload);

    // 2) 폰트 — localStorage 영속화 (이미 미리보기로 적용된 값 박기)
    try {
        setSystemFontScale(draft.systemFont);
        setScriptureFontSize(draft.scriptureFont);
    } catch (e) { console.warn('[onboarding] font persist failed:', e?.message || e); }

    // 3) 원칙 — 제목·본문 비어있지 않으면 savePrinciple
    const pTitle = (draft.principleTitle || '').trim();
    const pBody = (draft.principleBody || '').trim();
    if (pTitle && pBody) {
        try {
            const id = `principle_${userId}_${Date.now()}`;
            await savePrinciple(dek, {
                id,
                userId,
                title: pTitle,
                body: pBody,
                category: RECOMMENDED_PRINCIPLE.category,
                strength: RECOMMENDED_PRINCIPLE.strength,
                source: RECOMMENDED_PRINCIPLE.source,
                createdBy: RECOMMENDED_PRINCIPLE.createdBy,
                pinned: true,
                active: true,
            });
        } catch (e) { console.warn('[onboarding] savePrinciple failed:', e?.message || e); }
    }

    // 4) 첫 묵상 — 한 줄 적었으면 meditations 컬렉션에 저장 (meditation_first_save 미션 자동 클리어는 별도)
    const note = (draft.meditationNote || '').trim();
    if (note && draft.meditationScripture) {
        try {
            const id = `meditation_${userId}_${today}`;
            await saveRecord(dek, 'meditations', {
                id,
                userId,
                date: today,
                scriptureRef: draft.meditationScripture.ref,
                content: note,
                prayer: '',
            }, id);
            // meditation_first_save 미션 — saveMeditationDoc 안 트리거와 동일 의미로 여기서도 박힘.
            await markMissionComplete(dek, userId, 'meditation_first_save', { signal: 'onboarding' });
        } catch (e) { console.warn('[onboarding] saveMeditation failed:', e?.message || e); }
    }
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
function escapeAttr(s) { return escapeHtml(s); }

/**
 * onboarding 필요 여부 판단 — selfCard.name 빈 값이면 true.
 */
export async function needsOnboarding(dek, userId) {
    if (!dek || !userId) return false;
    try {
        const card = await ensureSelfCard(dek, userId);
        return !card || !card.name || !card.name.trim();
    } catch (e) {
        console.warn('[onboarding] needsOnboarding check failed:', e?.message || e);
        return false;
    }
}
