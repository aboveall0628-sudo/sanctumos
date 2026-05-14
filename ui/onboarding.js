/**
 * onboarding.js — 신규 사용자 첫 진입 모달 (Day 0 도트 학교 첫 수업)
 *
 * (본인 프로필 재기획 트랙 2026-05-14 S-D)
 *
 * 합의 (사용자 명시 2026-05-14):
 *   - 화면 자리 = 풀스크린 모달 (열린 집 위에 큰 카드)
 *   - 카드 안 4 단계 = 이름 → 별명 → 생일 → 큐티 수준
 *   - 한 흐름으로 끝까지 (큐티 분기를 별도로 빼지 않음)
 *   - 어체는 코드 안 3세트 (config/ageTones.js)
 *   - 30초 ~ 1분 안에 끝나는 가벼움. R3 결.
 *
 * R17 (도트 학교 첫 수업):
 *   생일 입력 직후 나이대 어체 자동 적응 → 도트 시연 멘트 톤 매칭.
 *
 * R18a (큐티 수준 분기):
 *   🌱 처음이에요 (basic)   → essentials100 트랙 추천
 *   🌿 가끔 해요 (intermediate)
 *   🌳 자주 해요 (advanced)
 *
 * 자동 라우팅:
 *   app.js 잠금 해제 후 ensureSelfCard → selfCard.name 빈 값이면 즉시 showOnboardingModal 호출.
 *   완료 시 onComplete 콜백 (view-today 진입 + 첫 도트 권유).
 */

import { ensureSelfCard, saveSelfCard } from '../data/personRepo.js';
import { AGE_TONES, ageFromBirthday, toneIdFromAge } from '../config/ageTones.js';
import { DEFAULT_TRACK_BY_LEVEL } from '../config/devotionalTracks.js';

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

let _state = null;  // { userId, dek, draft, onComplete }

/**
 * 사용자 첫 진입 모달 표시.
 *
 * @param {Object} opts
 *   - userId: 필수
 *   - dek: 필수 (CryptoKey)
 *   - onComplete: () => void (완료 후 호출, app.js 에서 view-today 진입 트리거)
 *   - existingCard: 옵션 — selfCard 이미 받아왔으면 전달 (한 번 더 안 불러도 됨)
 */
export async function showOnboardingModal({ userId, dek, onComplete, existingCard }) {
    if (!userId || !dek) {
        console.warn('[onboarding] missing userId or dek');
        return;
    }

    closeOnboardingModal();

    const card = existingCard || await ensureSelfCard(dek, userId);
    _state = {
        userId,
        dek,
        onComplete: onComplete || (() => {}),
        draft: {
            name: card.name || '',
            nickname: Array.isArray(card.nicknames) && card.nicknames[0] || '',
            birthday: card.birthday || '',
            devotionalLevel: card.devotionalLevel || null,
        },
        cardSnapshot: card,  // 저장 시 다른 필드 보존
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
          <span class="onboarding-step-dot active" data-step="1"></span>
          <span class="onboarding-step-dot" data-step="2"></span>
          <span class="onboarding-step-dot" data-step="3"></span>
          <span class="onboarding-step-dot" data-step="4"></span>
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
    // 생일 입력 후 어체 변경 — 모달 root 클래스만 갱신, CSS에서 폰트·여백 조정.
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
    updateStepperDots(step);
    const body = document.getElementById('onboarding-body');
    if (!body) return;

    if (step === 1) renderNameStep(body);
    else if (step === 2) renderNicknameStep(body);
    else if (step === 3) renderBirthdayStep(body);
    else if (step === 4) renderCutiStep(body);
    else if (step === 5) renderDemoStep(body);  // 도트 시연 (R17)
}

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
    const updateBtn = () => {
        nextBtn.disabled = !input.value.trim();
    };
    input.addEventListener('input', () => {
        _state.draft.name = input.value.trim();
        updateBtn();
    });
    updateBtn();
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !nextBtn.disabled) nextBtn.click(); });
    nextBtn.addEventListener('click', () => renderStep(2));
}

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
        applyAgeToneClass();  // 나이대 어체 적응
        renderStep(4);
    });
}

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

function renderDemoStep(body) {
    const tone = getTone();
    const callee = _state.draft.nickname || _state.draft.name || '친구';
    const recommendedTrack = DEFAULT_TRACK_BY_LEVEL[_state.draft.devotionalLevel];
    const trackLine = recommendedTrack === 'essentials100'
        ? '“성경 필수 구절 100”으로 가볍게 시작해보실 수 있어요.'
        : (_state.draft.devotionalLevel === 'intermediate'
            ? '오늘 보고 싶은 본문을 자유롭게 펼쳐 보세요.'
            : '진도를 이어가거나, 여러 본문을 동시에 묵상하실 수 있어요.');

    body.innerHTML = `
      <div class="onboarding-card onboarding-card-demo">
        <div class="onboarding-demo-icon">🌟</div>
        <h2 class="onboarding-title">${escapeHtml(tone.dotDemoLead(callee))}</h2>
        <p class="onboarding-sub">${escapeHtml(trackLine)}</p>
        <p class="onboarding-foot">${escapeHtml(tone.firstDotInvite)}</p>
        <div class="onboarding-actions">
          <button type="button" class="onboarding-btn onboarding-btn-text" id="onboarding-back">이전</button>
          <button type="button" class="onboarding-btn onboarding-btn-primary" id="onboarding-finish">시작하기</button>
        </div>
      </div>
    `;
    document.getElementById('onboarding-back').addEventListener('click', () => renderStep(4));
    document.getElementById('onboarding-finish').addEventListener('click', async () => {
        const btn = document.getElementById('onboarding-finish');
        btn.disabled = true;
        btn.textContent = '저장 중...';
        try {
            await persistDraft();
            const cb = _state.onComplete;
            closeOnboardingModal();
            try { cb(); } catch (_) { /* 콜백 실패는 무시 */ }
        } catch (e) {
            console.error('[onboarding] save failed:', e);
            btn.disabled = false;
            btn.textContent = '다시 시도';
        }
    });
}

async function persistDraft() {
    const { userId, dek, draft, cardSnapshot } = _state;
    const nicknames = draft.nickname ? [draft.nickname] : (cardSnapshot.nicknames || []);
    const payload = {
        ...cardSnapshot,
        name: draft.name,
        nicknames,
        birthday: draft.birthday || cardSnapshot.birthday || '',
        devotionalLevel: draft.devotionalLevel || cardSnapshot.devotionalLevel || null,
    };
    await saveSelfCard(dek, userId, payload);
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
 *   app.js init/잠금 해제 후 호출 → true 면 showOnboardingModal.
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
