/**
 * onboarding.js — 신규 사용자 첫 진입 모달 (Day 0 도트 학교 첫 수업)
 *
 * (본인 프로필 재기획 트랙 2026-05-14 S-D / 2026-05-15 S-D 후속 대확장)
 *
 * 최종 흐름 (2026-05-15 S-E7 갱신):
 *   [1/9] 이름
 *   [2/9] 별명
 *   [3/9] 생일      → 나이대 어체 자동 적응
 *   [4/9] 큐티 수준  🌱🌿🌳
 *   [5/9] 성경 번역본 (개역개정 디폴트, 다른 번역본은 "준비 중")
 *   [6/9] 묵상 트랙 (S-E7 신규) — 큐티 수준별 추천 + 한 권 통독·100구절·4파트·신약 등
 *   [7/9] 폰트 크기 (시스템 + 성경 본문 별도 슬라이더, 즉시 미리보기)
 *   [8/9] 기본 원칙 (추천 1개 자동 채움 + 수정 가능)
 *   [9/9] 첫 묵상 한 절 (선택한 트랙·책 따라 추천 본문 + 클릭으로 에디터에 옮기기 + 한 줄)
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
    RECOMMENDED_TRACKS_BY_LEVEL, ONE_BOOK_QUICK_PICKS, firstMeditationForTrack,
    // (베타 슬림 v1 A 묶음 2026-05-18) 도시·타임존
    CITY_PRESETS, TIMEZONE_OPTIONS, detectBrowserTimezone,
} from '../config/onboardingDefaults.js';
import {
    setActivePlanId, addUserPlan, getActivePlan,
} from './scriptureSettings.js';
import {
    SYSTEM_FONT_SIZES, getSystemFontScale, setSystemFontScale, applySystemFontScale,
} from '../config/systemFont.js';
import {
    FONT_SIZES as SCRIPTURE_FONT_SIZES,
    getScriptureSettings, setFontSize as setScriptureFontSize, applyFontSizeToCSS as applyScriptureFontToCSS,
} from './scriptureSettings.js';
import { savePrinciple } from '../data/principlesRepo.js';
import { saveRecord, getRecord } from '../data/baseRepo.js';
import { getActiveMissionIds, MISSION_CATALOG } from '../config/missionCatalog.js';
// (2026-05-18 후속) 온보딩 SWAN 말풍선 타이핑 — "AI가 실제로 물어보는 것처럼"
import { typeText, shouldReduceMotion, setTextInstant } from './aiThinking.js';

// (베타 슬림 v1 A 묶음 2026-05-18 / 후속 의사결정 카드 제거) 10 step 재번호:
//   1=SWAN 인사 · 2=이름 · 3=별명 · 4=생일+양/음력 · 5=도시·타임존
//   6=큐티 수준 · 7=성경 번역본 · 8=묵상 트랙 · 9=폰트 · 10=첫 묵상
//   원칙 step 은 사용자 명시 "미션으로 해도 될 것 같음" — 카탈로그·미션으로 이동.
const TOTAL_STEPS = 10;

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
        recommendation: '성경 한 권 통독',
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

// (2026-05-18 후속) SWAN 말풍선 헬퍼 — "실제로 AI가 물어보는 것처럼" 톤.
//   각 step body.innerHTML 첫 줄에 자연 자리잡힘. render 후 activateSwanTyping() 자동 호출.
function swanBubbleHTML(message) {
    return `
      <div class="onboarding-swan-bubble onboarding-swan-bubble-typing" data-swan-typing>
        <span class="onboarding-swan-icon" aria-hidden="true">🦢</span>
        <span class="onboarding-swan-text" data-swan-message="${escapeAttr(message || '')}"></span>
      </div>
    `;
}

// (2026-05-18 후속) 생각하는 척 애니메이션 — typing 시작 직전 점 3개 떴다 사라짐.
//   사용자 명시 "약간 좀 생각하는 척 하는 애니메이션 추가".
//   챗봇 톤(0.6~1.0s thinking) → 텍스트 한 자씩 타이핑.
function showSwanThinking(textEl) {
    textEl.innerHTML = `
      <span class="swan-thinking-dots" aria-label="생각하는 중">
        <span></span><span></span><span></span>
      </span>
    `;
}

async function activateSwanTyping() {
    const reduce = shouldReduceMotion();
    const card = document.querySelector('.onboarding-card');
    if (!card) return;

    // (사용자 명시 2026-05-18) AI가 말 끝나야 본문(옵션 카드·입력·버튼) 등장.
    //   카드 안 swan-bubble·hero 다음 형제 요소를 잠시 숨김 → typing 끝나면 fade-in.
    card.classList.add('onboarding-card-swan-locked');

    const tasks = [];

    // 카드별 swan-bubble — thinking 0.7s → typing (delay 55ms, 사용자 명시 "타이핑 빠름" 반영)
    const bubbles = Array.from(document.querySelectorAll('.onboarding-swan-bubble-typing'));
    bubbles.forEach(bubble => {
        const textEl = bubble.querySelector('.onboarding-swan-text');
        if (!textEl) return;
        const msg = textEl.dataset.swanMessage || '';
        if (reduce) {
            setTextInstant(textEl, msg);
            return;
        }
        tasks.push((async () => {
            showSwanThinking(textEl);
            await new Promise(r => setTimeout(r, 700));
            await typeText(textEl, msg, { delay: 55 });
        })());
    });

    // hero greeting (step 1) — 살짝 더 긴 thinking 0.9s + 더 천천히 타이핑(delay 80ms)
    const hero = document.querySelector('[data-swan-hero]');
    if (hero) {
        const msg = hero.dataset.swanMessage || '';
        if (reduce) {
            setTextInstant(hero, msg);
        } else {
            tasks.push((async () => {
                showSwanThinking(hero);
                await new Promise(r => setTimeout(r, 900));
                await typeText(hero, msg, { delay: 80 });
            })());
        }
    }

    if (reduce) {
        card.classList.remove('onboarding-card-swan-locked');
        return;
    }

    // 모든 typing 끝나길 기다린 후 본문 fade-in
    await Promise.all(tasks);
    // 살짝 호흡 — typing 끝났을 때 바로 등장이 아니라 0.2초 정도 여백
    await new Promise(r => setTimeout(r, 200));
    card.classList.remove('onboarding-card-swan-locked');
}

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
            // (베타 슬림 v1 A 묶음 2026-05-18) 양/음력 토글 + 사는 지역 + 타임존
            birthdayLunar: !!card.birthdayLunar,
            city: card.city || '',
            timezone: card.timezone || detectBrowserTimezone(),
            devotionalLevel: card.devotionalLevel || null,
            bibleVersion: card.bibleVersion || DEFAULT_BIBLE_VERSION,
            systemFont: initialSystemFont,
            scriptureFont: initialScriptureFont,
            // (의사결정 제거 후속 2026-05-18) 원칙 — 사용자 명시 "미션으로 해도 될 것 같음".
            //   온보딩에서 자동 등록 X. 사용자가 미션 카탈로그에서 첫 원칙 직접 등록.
            principleTitle: '',
            principleBody: '',
            // (S-E7) 묵상 트랙 — step 6 에서 큐티 수준 따라 추천. 'one-book' 선택 시 oneBookAbbr 채워짐.
            selectedTrack: null,         // 'essentials100' | 'preset-4parts' | 'preset-newtestament' | 'one-book' | 'custom'
            oneBookAbbr: null,           // 'one-book' 선택 시 책 약자 ('시'·'요'·'빌'·'잠'·'창')
            // 첫 묵상 — step 9 에서 트랙 따라 자동 셋업
            meditationNote: '',
            // step 9 시점 사용자가 본 본문 (저장 시 함께 박힘)
            meditationScripture: null,
            // 본문 카드 [옮기기] 눌렀는지 — 에디터에 마크다운 박혔는지
            verseInsertedIntoNote: false,
        },
        snapshots: {
            initialSystemFont,
            initialScriptureFont,
        },
        cardSnapshot: card,
    };

    // (2026-05-18 후속) 다시보기 닫기 버튼 — 신규 사용자(name 빈 값)는 닫기 X.
    //   재시청(name 자리잡혀 있음) 시만 우상단 X 버튼 노출 → 저장 없이 원래 화면 복귀.
    const isReplay = !!(card && card.name && card.name.trim());

    const backdrop = document.createElement('div');
    backdrop.className = 'onboarding-backdrop';
    backdrop.id = 'onboarding-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-labelledby', 'onboarding-title');
    backdrop.innerHTML = `
      <div class="onboarding-modal age-tone-young" id="onboarding-modal">
        ${isReplay ? `
          <button type="button" class="onboarding-close-btn" id="onboarding-close-btn"
                  aria-label="안내 닫기 — 원래 화면으로 돌아가기" title="원래 화면으로">
            <span aria-hidden="true">×</span>
          </button>
        ` : ''}
        <div class="onboarding-stepper" id="onboarding-stepper" aria-label="진행도">
          ${Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map(n =>
            `<span class="onboarding-step-dot${n === 1 ? ' active' : ''}" data-step="${n}"></span>`
          ).join('')}
        </div>
        <div class="onboarding-body" id="onboarding-body"></div>
      </div>
    `;
    document.body.appendChild(backdrop);

    // 닫기 버튼 — 저장 없이 모달만 닫고 원래 화면 그대로 보여줌.
    if (isReplay) {
        document.getElementById('onboarding-close-btn')?.addEventListener('click', () => {
            closeOnboardingModal();
            // onComplete 는 호출 X — 사용자가 어디서 띄웠든 그 화면 그대로 유지.
        });
    }

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

    // (베타 슬림 v1 A 묶음 / 후속 의사결정 제거 2026-05-18) 10 step 재번호 dispatch.
    if (step === 1) renderSwanIntroStep(body);        // SWAN 첫 인사
    else if (step === 2) renderNameStep(body);
    else if (step === 3) renderNicknameStep(body);
    else if (step === 4) renderBirthdayStep(body);    // 양/음력 토글
    else if (step === 5) renderLocationStep(body);    // 도시·타임존
    else if (step === 6) renderCutiStep(body);
    else if (step === 7) renderBibleVersionStep(body);
    else if (step === 8) renderTrackStep(body);       // 묵상 트랙
    else if (step === 9) renderFontStep(body);
    else if (step === 10) renderMeditationStep(body); // 첫 묵상 한 절
    else if (step === 99) renderFinishCard(body);

    // (2026-05-18 후속) 모든 step 공통: 카드 enter 애니메이션 + SWAN 말풍선 타이핑.
    const card = body.querySelector('.onboarding-card');
    if (card) {
        card.classList.add('onboarding-card-enter');
        // 다음 프레임에 enter 트랜지션 트리거 — 자연 fade-in + slide-up
        requestAnimationFrame(() => {
            requestAnimationFrame(() => card.classList.add('onboarding-card-enter-active'));
        });
    }
    activateSwanTyping();
}

// ─── Step 1: 🦢 SWAN 첫 인사 (베타 슬림 v1 A 묶음 2026-05-18) ─────────
// 사용자 명시: "시작하자마자 AI 보조가 들어가는 앱이구나" 첫인상.
// 챗 *기분* 톤만 — 카드 형식 그대로 + SWAN 말풍선 한 줄.
function renderSwanIntroStep(body) {
    body.innerHTML = `
      <div class="onboarding-card onboarding-card-swan-hero onboarding-card-swan-hero-simple">
        <h2 class="onboarding-swan-hero-greeting" id="onboarding-title"
            data-swan-hero
            data-swan-message="안녕하세요,&#10;말씀이 삶으로 옮겨가도록 도와드리는&#10;묵상 보조 AI, SWAN이에요."></h2>
        <div class="onboarding-actions">
          <button type="button" class="onboarding-btn onboarding-btn-primary onboarding-btn-block" id="onboarding-next">다음</button>
        </div>
      </div>
    `;
    document.getElementById('onboarding-next').addEventListener('click', () => renderStep(2));
}

// ─── Step 2: 이름 ─────────────────────────────────────────
function renderNameStep(body) {
    const tone = getTone();
    body.innerHTML = `
      <div class="onboarding-card">
        ${swanBubbleHTML('어떻게 불러드릴까요? 이름이나 자주 쓰시는 이름이면 돼요.')}
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
    nextBtn.addEventListener('click', () => renderStep(3));
}

// ─── Step 3: 별명 ─────────────────────────────────────────
function renderNicknameStep(body) {
    body.innerHTML = `
      <div class="onboarding-card">
        ${swanBubbleHTML(`${_state.draft.name || '친구'}님, 더 친근하게 부를 별명도 있으세요?`)}
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
    // (베타 슬림 v1 A 묶음 2026-05-18) step 재번호 — nickname: back=2(name) · skip/next=4(birthday)
    document.getElementById('onboarding-back').addEventListener('click', () => renderStep(2));
    document.getElementById('onboarding-skip').addEventListener('click', () => {
        _state.draft.nickname = '';
        renderStep(4);
    });
    document.getElementById('onboarding-next').addEventListener('click', () => renderStep(4));
}

// ─── Step 4: 생일 + 양/음력 토글 (베타 슬림 v1 A 묶음 2026-05-18) ────
function renderBirthdayStep(body) {
    const isLunar = !!_state.draft.birthdayLunar;
    body.innerHTML = `
      <div class="onboarding-card">
        ${swanBubbleHTML('생일도 알려주실래요? 나이대에 맞는 말투로 인사하려고요.')}
        <h2 class="onboarding-title">생일이 언제이신가요?</h2>
        <p class="onboarding-sub">양력·음력 골라서 적으실 수 있어요. 정확한 날짜 모르면 연도만 적어도 돼요.</p>
        <div class="onboarding-birthday-toggle" role="radiogroup" aria-label="양력 또는 음력">
          <button type="button" class="onboarding-toggle-chip${!isLunar ? ' selected' : ''}"
                  role="radio" aria-checked="${!isLunar}" data-lunar="false">양력</button>
          <button type="button" class="onboarding-toggle-chip${isLunar ? ' selected' : ''}"
                  role="radio" aria-checked="${isLunar}" data-lunar="true">음력</button>
        </div>
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
    // 양/음력 토글
    document.querySelectorAll('.onboarding-toggle-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            _state.draft.birthdayLunar = btn.dataset.lunar === 'true';
            document.querySelectorAll('.onboarding-toggle-chip').forEach(b => {
                const checked = b === btn;
                b.classList.toggle('selected', checked);
                b.setAttribute('aria-checked', checked ? 'true' : 'false');
            });
        });
    });
    // (베타 슬림 v1 A 묶음) back=3(nickname) · skip/next=5(location 신규)
    document.getElementById('onboarding-back').addEventListener('click', () => renderStep(3));
    document.getElementById('onboarding-skip').addEventListener('click', () => {
        _state.draft.birthday = '';
        renderStep(5);
    });
    document.getElementById('onboarding-next').addEventListener('click', () => {
        applyAgeToneClass();
        renderStep(5);
    });
}

// ─── Step 5: 사는 지역 + 타임존 (베타 슬림 v1 A 묶음 2026-05-18) ─────
// 사용자 명시: "사는 지역에 따라 시간 다르게 하는 기능 온보딩에서 설정"
// 도시 칩 5개(서울·도쿄·홍콩·파리·LA) + 다른 곳(타임존 드롭다운).
function renderLocationStep(body) {
    const draftCity = _state.draft.city || '';
    const draftTz = _state.draft.timezone || detectBrowserTimezone();
    const showTzDropdown = draftCity === 'other' || !CITY_PRESETS.find(c => c.id === draftCity);

    body.innerHTML = `
      <div class="onboarding-card">
        ${swanBubbleHTML('어디서 같이 가는 중이세요? 알람·일정 시간 맞춰드리려고요.')}
        <h2 class="onboarding-title">사는 지역이 어디예요?</h2>
        <p class="onboarding-sub">시간대 자동으로 맞춰드릴게요. 자주 가는 도시가 없으면 "다른 곳"으로 골라주세요.</p>
        <div class="onboarding-city-grid" role="radiogroup" aria-label="사는 지역">
          ${CITY_PRESETS.map(c => `
            <button type="button"
                    class="onboarding-city-chip${draftCity === c.id ? ' selected' : ''}"
                    role="radio" aria-checked="${draftCity === c.id}"
                    data-city="${escapeAttr(c.id)}">
              <span class="onboarding-city-flag">${escapeHtml(c.flag)}</span>
              <span class="onboarding-city-label">${escapeHtml(c.label)}</span>
              ${c.offset ? `<span class="onboarding-city-offset">UTC${escapeHtml(c.offset)}</span>` : ''}
            </button>
          `).join('')}
        </div>
        <div id="onboarding-tz-wrap" class="onboarding-tz-wrap${showTzDropdown ? '' : ' hidden'}">
          <label for="onboarding-tz-select" class="onboarding-tz-label">시간대를 골라주세요</label>
          <select id="onboarding-tz-select" class="onboarding-input">
            ${TIMEZONE_OPTIONS.map(opt => `
              <option value="${escapeAttr(opt.id)}"${opt.id === draftTz ? ' selected' : ''}>${escapeHtml(opt.label)}</option>
            `).join('')}
          </select>
        </div>
        <div class="onboarding-actions onboarding-actions-split">
          <button type="button" class="onboarding-btn onboarding-btn-text" id="onboarding-back">이전</button>
          <div class="onboarding-actions-right">
            <button type="button" class="onboarding-btn onboarding-btn-secondary" id="onboarding-skip">나중에</button>
            <button type="button" class="onboarding-btn onboarding-btn-primary" id="onboarding-next">다음</button>
          </div>
        </div>
      </div>
    `;

    const tzWrap = document.getElementById('onboarding-tz-wrap');
    const tzSelect = document.getElementById('onboarding-tz-select');

    document.querySelectorAll('.onboarding-city-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            const cityId = btn.dataset.city;
            const preset = CITY_PRESETS.find(c => c.id === cityId);
            _state.draft.city = cityId;
            if (preset && preset.timezone) {
                _state.draft.timezone = preset.timezone;
                tzWrap.classList.add('hidden');
            } else {
                // "다른 곳" — 드롭다운 노출 + 디폴트는 브라우저 감지값
                tzWrap.classList.remove('hidden');
                if (!_state.draft.timezone) {
                    _state.draft.timezone = detectBrowserTimezone();
                    tzSelect.value = _state.draft.timezone;
                }
            }
            document.querySelectorAll('.onboarding-city-chip').forEach(b => {
                const checked = b === btn;
                b.classList.toggle('selected', checked);
                b.setAttribute('aria-checked', checked ? 'true' : 'false');
            });
        });
    });
    tzSelect.addEventListener('change', () => {
        _state.draft.timezone = tzSelect.value;
    });

    // back=4(birthday) · skip/next=6(cuti)
    document.getElementById('onboarding-back').addEventListener('click', () => renderStep(4));
    document.getElementById('onboarding-skip').addEventListener('click', () => {
        // 도시 비워두되 타임존은 자동 감지값 유지
        _state.draft.city = '';
        renderStep(6);
    });
    document.getElementById('onboarding-next').addEventListener('click', () => renderStep(6));
}

// ─── Step 6: 큐티 수준 ────────────────────────────────────
function renderCutiStep(body) {
    const tone = getTone();
    body.innerHTML = `
      <div class="onboarding-card">
        ${swanBubbleHTML('평소 묵상은 어느 정도 하세요? 마음에 닿는 깊이로 시작 자리를 골라드릴게요.')}
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
    // (베타 슬림 v1 A 묶음) cuti: back=5(location) · next=7(bible)
    document.getElementById('onboarding-back').addEventListener('click', () => renderStep(5));
    nextBtn.addEventListener('click', () => renderStep(7));
}

// ─── Step 7: 성경 번역본 ──────────────────────────────────
function renderBibleVersionStep(body) {
    body.innerHTML = `
      <div class="onboarding-card">
        ${swanBubbleHTML('어떤 성경으로 읽으시나요? 지금은 개역개정으로 만나실 수 있어요.')}
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
    // (베타 슬림 v1 A 묶음) bible: back=6(cuti) · next=8(track)
    document.getElementById('onboarding-back').addEventListener('click', () => renderStep(6));
    document.getElementById('onboarding-next').addEventListener('click', () => renderStep(8));
}

// ─── Step 8: 묵상 트랙 (S-E7 신규) ────────────────────────
function renderTrackStep(body) {
    const level = _state.draft.devotionalLevel || 'basic';
    const rec = RECOMMENDED_TRACKS_BY_LEVEL[level] || RECOMMENDED_TRACKS_BY_LEVEL.basic;

    // 'one-book' 이미 선택된 상태에서 다시 들어오면 책 picker 그대로 노출.
    const showBookPicker = _state.draft.selectedTrack === 'one-book' && !_state.draft.oneBookAbbr;

    body.innerHTML = `
      <div class="onboarding-card onboarding-card-track">
        ${swanBubbleHTML('어디서부터 묵상하실래요? 선택하신 수준에 맞춰 추천해드릴게요.')}
        <h2 class="onboarding-title">어디서부터 묵상하실래요?</h2>
        <p class="onboarding-sub">선택하신 수준에 맞춘 추천이에요. 마음에 닿는 자리로 골라 보세요. 나중에 언제든 바꿀 수 있어요.</p>

        <div class="onboarding-track-primary">
          <button type="button" class="onboarding-track-card onboarding-track-card-primary${_state.draft.selectedTrack === rec.primary.id ? ' selected' : ''}"
                  data-track="${escapeAttr(rec.primary.id)}">
            <span class="onboarding-track-badge">추천</span>
            <span class="onboarding-track-icon" aria-hidden="true">${escapeHtml(rec.primary.icon)}</span>
            <span class="onboarding-track-label">${escapeHtml(rec.primary.label)}</span>
            <span class="onboarding-track-desc">${escapeHtml(rec.primary.desc)}</span>
          </button>
        </div>

        <p class="onboarding-track-others-head">다른 결도 둘러볼래요?</p>
        <div class="onboarding-track-options">
          ${rec.options.map(opt => `
            <button type="button"
                    class="onboarding-track-card${_state.draft.selectedTrack === opt.id ? ' selected' : ''}${opt.highlight ? ' onboarding-track-card-highlight' : ''}${opt.preparing ? ' disabled' : ''}"
                    data-track="${escapeAttr(opt.id)}"
                    ${opt.preparing ? 'aria-disabled="true"' : ''}>
              <span class="onboarding-track-icon" aria-hidden="true">${escapeHtml(opt.icon)}</span>
              <span class="onboarding-track-label">
                ${escapeHtml(opt.label)}
                ${opt.preparing ? '<span class="onboarding-track-chip-coming">곧 열려요</span>' : ''}
              </span>
              <span class="onboarding-track-desc">${escapeHtml(opt.desc)}</span>
              ${opt.preparing ? '<span class="onboarding-track-coming-foot">1차 베타 후 열어볼 자리예요.</span>' : ''}
            </button>
          `).join('')}
        </div>

        <div id="onboarding-book-picker" class="onboarding-book-picker"${showBookPicker ? '' : ' hidden'}>
          <p class="onboarding-book-picker-head">어떤 책을 통독하실까요?</p>
          <div class="onboarding-book-grid">
            ${ONE_BOOK_QUICK_PICKS.map(b => `
              <button type="button" class="onboarding-book-card${_state.draft.oneBookAbbr === b.abbr ? ' selected' : ''}"
                      data-book-abbr="${escapeAttr(b.abbr)}">
                <span class="onboarding-book-icon" aria-hidden="true">📖</span>
                <span class="onboarding-book-label">${escapeHtml(b.label)}</span>
                <span class="onboarding-book-desc">${escapeHtml(b.desc)}</span>
              </button>
            `).join('')}
          </div>
        </div>

        <div class="onboarding-actions onboarding-actions-split">
          <button type="button" class="onboarding-btn onboarding-btn-text" id="onboarding-back">이전</button>
          <button type="button" class="onboarding-btn onboarding-btn-primary" id="onboarding-next" disabled>다음</button>
        </div>
      </div>
    `;

    const nextBtn = document.getElementById('onboarding-next');
    const picker = document.getElementById('onboarding-book-picker');

    const updateBtn = () => {
        const track = _state.draft.selectedTrack;
        if (!track) { nextBtn.disabled = true; return; }
        if (track === 'one-book' && !_state.draft.oneBookAbbr) { nextBtn.disabled = true; return; }
        nextBtn.disabled = false;
    };
    updateBtn();

    document.querySelectorAll('.onboarding-track-card').forEach(btn => {
        btn.addEventListener('click', () => {
            // (S-E7.2) preparing 트랙은 클릭 무시 — 시각적 비활성 + 안내만.
            if (btn.classList.contains('disabled')) return;
            const track = btn.dataset.track;
            _state.draft.selectedTrack = track;
            // 다른 트랙 누르면 책 선택 초기화
            if (track !== 'one-book') _state.draft.oneBookAbbr = null;
            document.querySelectorAll('.onboarding-track-card').forEach(b => b.classList.toggle('selected', b === btn));
            // 'one-book' 누르면 책 picker 노출
            if (picker) picker.hidden = track !== 'one-book';
            updateBtn();
        });
    });

    document.querySelectorAll('.onboarding-book-card').forEach(btn => {
        btn.addEventListener('click', () => {
            _state.draft.oneBookAbbr = btn.dataset.bookAbbr;
            document.querySelectorAll('.onboarding-book-card').forEach(b => b.classList.toggle('selected', b === btn));
            updateBtn();
        });
    });

    // (베타 슬림 v1 A 묶음) track: back=7(bible) · next=9(font)
    document.getElementById('onboarding-back').addEventListener('click', () => renderStep(7));
    nextBtn.addEventListener('click', () => renderStep(9));
}

// ─── Step 9: 폰트 크기 ────────────────────────────────────
function renderFontStep(body) {
    body.innerHTML = `
      <div class="onboarding-card">
        ${swanBubbleHTML('글씨 크기는 어떻게 보이세요? 고르시면 바로 화면이 바뀌어요.')}
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
    // (의사결정 제거 후속 2026-05-18) font: back=8(track) · next=10(meditation으로 직접 — principle 빈 자리)
    document.getElementById('onboarding-back').addEventListener('click', () => renderStep(8));
    document.getElementById('onboarding-next').addEventListener('click', () => renderStep(10));
}

// ─── Step 10: 기본 원칙 ────────────────────────────────────
function renderPrincipleStep(body) {
    body.innerHTML = `
      <div class="onboarding-card">
        <h2 class="onboarding-title">의사결정 때 기댈 원칙 하나 정해요</h2>
        <p class="onboarding-sub">기본으로 추천 원칙 하나를 미리 채워둘게요. 그대로 두셔도 좋고, 본인 마음에 맞게 고쳐도 좋아요.</p>

        <label class="onboarding-label" for="onboarding-principle-title">원칙 제목</label>
        <textarea class="onboarding-textarea onboarding-textarea-compact" id="onboarding-principle-title"
                  rows="2" maxlength="120"
                  placeholder="짧게 한두 줄로">${escapeHtml(_state.draft.principleTitle)}</textarea>

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
    // (베타 슬림 v1 A 묶음) principle: back=9(font) · next=11(meditation)
    document.getElementById('onboarding-back').addEventListener('click', () => renderStep(9));
    document.getElementById('onboarding-next').addEventListener('click', () => renderStep(11));
}

// ─── Step 9: 첫 묵상 한 절 + 본문 클릭 → 에디터 (S-E7) ────
function renderMeditationStep(body) {
    const tone = getTone();
    // (S-E7) 선택한 트랙·책 따라 첫 본문 자동 추천.
    const trackKey = _state.draft.selectedTrack === 'one-book' && _state.draft.oneBookAbbr
        ? `one-book:${_state.draft.oneBookAbbr}`
        : _state.draft.selectedTrack;
    const passage = firstMeditationForTrack(trackKey, _state.draft.devotionalLevel);
    _state.draft.meditationScripture = passage;
    _state.draft.verseInsertedIntoNote = false;

    body.innerHTML = `
      <div class="onboarding-card onboarding-card-meditation">
        ${swanBubbleHTML('마지막이에요. 오늘 한 절 같이 만나볼까요?')}
        <h2 class="onboarding-title">${escapeHtml(tone.firstDotInvite || '오늘 한 절 만나볼까요?')}</h2>
        <p class="onboarding-sub">실제 묵상하는 것처럼 한 번 해볼까요. 본문을 노트로 옮기고, 떠오른 한 줄을 적어 보세요.</p>

        <div class="onboarding-verse-card onboarding-verse-card-interactive" id="onboarding-verse-card">
          <span class="onboarding-verse-ref">📖 ${escapeHtml(passage.ref)}</span>
          <p class="onboarding-verse-text" id="onboarding-verse-text">${escapeHtml(passage.text)}</p>
          <button type="button" class="onboarding-verse-insert-btn" id="onboarding-verse-insert">
            📋 묵상 노트로 옮기기
          </button>
        </div>

        <div id="onboarding-existing-meditation-notice" class="onboarding-existing-notice" hidden>
          <p>오늘 이미 묵상 적으신 게 있어요. 여기 적으시는 한 줄은 <strong>기존 묵상 끝에 추가</strong>돼요. 덮어쓰지 않아요.</p>
        </div>

        <label class="onboarding-label" for="onboarding-meditation-note">📝 묵상 노트</label>
        <textarea class="onboarding-textarea onboarding-meditation-textarea" id="onboarding-meditation-note"
                  rows="6" maxlength="800"
                  placeholder="위 [묵상 노트로 옮기기]를 누르면 본문이 여기로 들어와요. 그 아래에 떠오른 한 줄을 적어 보세요.">${escapeHtml(_state.draft.meditationNote)}</textarea>

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
    const insertBtn = document.getElementById('onboarding-verse-insert');

    noteEl.addEventListener('input', () => { _state.draft.meditationNote = noteEl.value; });

    // (2026-05-18 후속) 마크다운 마커(`### `) 제거 — 사용자 명시 "실제로 에디터처럼 보이게".
    //   본문은 평문으로 자리잡고, 사용자가 그 아래에 한 줄 적을 자리만 남김.
    insertBtn.addEventListener('click', () => {
        const block = `${passage.ref}\n${passage.text}\n\n`;
        const current = noteEl.value;
        // 이미 본문이 있으면 중복 X — 끝에 한 줄 띄움.
        if (current.includes(passage.text)) {
            noteEl.focus();
            // 커서를 끝으로
            noteEl.setSelectionRange(noteEl.value.length, noteEl.value.length);
            return;
        }
        // 빈 노트면 본문이 처음, 아니면 끝에 append
        noteEl.value = current.trim() ? `${current.trimEnd()}\n\n${block}` : block;
        _state.draft.meditationNote = noteEl.value;
        _state.draft.verseInsertedIntoNote = true;
        // 버튼 상태 — 옮긴 후 시각 갱신
        insertBtn.classList.add('inserted');
        insertBtn.textContent = '✓ 노트로 옮겼어요';
        // 사용자 한 줄 적기 자리로 포커스
        noteEl.focus();
        noteEl.setSelectionRange(noteEl.value.length, noteEl.value.length);
    });

    // 오늘 묵상 이미 있는지 비동기 체크 — 있으면 안내 카드 노출, 합치기 모드로 작동
    checkExistingMeditation().catch(() => {});
    // (의사결정 제거 후속 2026-05-18) meditation: back=9(font로 직접 — principle 빈 자리)
    document.getElementById('onboarding-back').addEventListener('click', () => renderStep(9));
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
          <p class="onboarding-finish-missions-sub">하다 보면 자연스럽게 마쳐져요. 부담 갖지 마세요.</p>
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

        <p class="onboarding-finish-cta">미션은 사용하시다 보면 자연스럽게 하나씩 열려요. 부담 없이 둘러보세요.</p>

        <div class="onboarding-finish-freemium">
          <span class="onboarding-finish-freemium-icon">🌱</span>
          <div class="onboarding-finish-freemium-body">
            <p class="onboarding-finish-freemium-title">베타 버전이에요.</p>
            <p class="onboarding-finish-freemium-sub">
              14일 동안 자유롭게 둘러보실 수 있어요.<br>
              불편한 부분이나 개선되어야 할 부분이 있다면<br>
              우하단의 버튼을 통해 SWAN에게 알려주세요.
            </p>
          </div>
        </div>

        <div class="onboarding-actions">
          <button type="button" class="onboarding-btn onboarding-btn-primary" id="onboarding-go-today">오늘 화면으로</button>
        </div>
      </div>
    `;
    document.getElementById('onboarding-go-today').addEventListener('click', () => {
        const cb = _state.onComplete;
        closeOnboardingModal();
        // 어디서 모달을 띄웠든(가입 직후·설정 재시연 모두) 같은 결로 오늘 화면 진입.
        try {
            if (typeof window.__sanctumSwitchView === 'function') window.__sanctumSwitchView('today');
        } catch (_) {}
        try { cb(); } catch (_) {}
    });
}

/**
 * 오늘 묵상 이미 있는지 확인 — 있으면 step 8 안내 카드 노출 + _state 에 기존 content 박힘.
 * persistAll 시 합치기 모드(기존 끝에 한 줄 append)로 작동.
 */
async function checkExistingMeditation() {
    if (!_state) return;
    const { userId, dek } = _state;
    const today = new Date().toISOString().slice(0, 10);
    const id = `meditation_${userId}_${today}`;
    try {
        const existing = await getRecord(dek, 'meditations', id);
        const existingContent = (existing && typeof existing.content === 'string') ? existing.content : '';
        const existingPrayer = (existing && typeof existing.prayer === 'string') ? existing.prayer : '';
        _state.draft.existingMeditationContent = existingContent;
        _state.draft.existingMeditationPrayer = existingPrayer;
        // 안내 카드 — 기존 content 있을 때만 노출
        if (existingContent.trim()) {
            const notice = document.getElementById('onboarding-existing-meditation-notice');
            if (notice) notice.hidden = false;
        }
    } catch (e) {
        // 처음 가입한 사용자는 도큐먼트 자체가 없어 에러 — 무시.
        _state.draft.existingMeditationContent = '';
        _state.draft.existingMeditationPrayer = '';
    }
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
        // (베타 슬림 v1 A 묶음 2026-05-18) 양/음력 + 도시 + 타임존
        birthdayLunar: !!draft.birthdayLunar,
        city: draft.city || cardSnapshot.city || '',
        timezone: draft.timezone || cardSnapshot.timezone || 'Asia/Seoul',
        devotionalLevel: draft.devotionalLevel || cardSnapshot.devotionalLevel || null,
        bibleVersion: draft.bibleVersion || DEFAULT_BIBLE_VERSION,
    };
    await saveSelfCard(dek, userId, cardPayload);

    // 2) 폰트 — localStorage 영속화 (이미 미리보기로 적용된 값 박기)
    try {
        setSystemFontScale(draft.systemFont);
        setScriptureFontSize(draft.scriptureFont);
    } catch (e) { console.warn('[onboarding] font persist failed:', e?.message || e); }

    // 2.5) (S-E7) 묵상 트랙 — scriptureSettings localStorage 에 활성 계획 박음.
    //      'one-book' 은 addUserPlan 으로 사용자 정의 계획을 만든 뒤 활성화.
    try {
        const track = draft.selectedTrack;
        if (track === 'essentials100') {
            // essentials100 은 별도 트랙 카탈로그. scriptureSettings PRESETS 안에는 없음 —
            //   해당 트랙은 큐티 수준별 추천 본문 흐름만 따로 살림. activePlanId 는 디폴트(preset-4parts) 유지.
            //   추후 essentials100 을 PRESET 으로 박는 트랙 별도.
        } else if (track === 'preset-4parts' || track === 'preset-newtestament') {
            setActivePlanId(track);
        } else if (track === 'one-book' && draft.oneBookAbbr) {
            const pick = ONE_BOOK_QUICK_PICKS.find(b => b.abbr === draft.oneBookAbbr);
            if (pick) {
                // scriptureSettings.addUserPlan 시그니처: books = [[abbr, full, chapters], ...]
                //   addUserPlan 안에서 자동으로 activePlanId 갱신 — setActivePlanId 별도 호출 X.
                addUserPlan({
                    name: `${pick.label} 통독`,
                    books: [[pick.abbr, pick.label, pick.chapters]],
                });
            }
        } else if (track === 'custom') {
            // 사용자가 추후 설정에서 직접 만들 자리. 디폴트 유지.
        }
    } catch (e) { console.warn('[onboarding] track persist failed:', e?.message || e); }

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

    // 4) 첫 묵상 — 한 줄 적었으면 meditations 컬렉션에 저장.
    //    ⚠️ 단일 encryptedPayload 결로 sensitive 필드는 통째 덮어쓰니, 기존 묵상을 먼저 합쳐서 박음.
    //    합치기 모드: 기존 content + "\n\n" + 새 한 줄. prayer 는 그대로 보존.
    const note = (draft.meditationNote || '').trim();
    if (note && draft.meditationScripture) {
        try {
            const id = `meditation_${userId}_${today}`;
            // 단계 진입 시 캐시된 기존 값이 없을 수도 있어 한 번 더 안전하게 읽기.
            let existingContent = draft.existingMeditationContent;
            let existingPrayer = draft.existingMeditationPrayer;
            if (existingContent === undefined || existingPrayer === undefined) {
                try {
                    const existing = await getRecord(dek, 'meditations', id);
                    existingContent = (existing && typeof existing.content === 'string') ? existing.content : '';
                    existingPrayer = (existing && typeof existing.prayer === 'string') ? existing.prayer : '';
                } catch (_) {
                    existingContent = '';
                    existingPrayer = '';
                }
            }
            const trimmedExisting = (existingContent || '').trimEnd();
            const mergedContent = trimmedExisting
                ? `${trimmedExisting}\n\n${note}`
                : note;
            await saveRecord(dek, 'meditations', {
                id,
                userId,
                date: today,
                // scriptureRef: 기존이 있으면 보존 (사용자가 이미 본 본문 우선), 없을 때만 추천 본문 박음.
                scriptureRef: (await safeGetExistingScriptureRef(dek, userId, today)) || draft.meditationScripture.ref,
                content: mergedContent,
                prayer: existingPrayer || '',
            }, id);
            // meditation_first_save 미션 — saveMeditationDoc 안 트리거와 동일 의미로 여기서도 클리어.
            await markMissionComplete(dek, userId, 'meditation_first_save', { signal: 'onboarding' });
        } catch (e) { console.warn('[onboarding] saveMeditation failed:', e?.message || e); }
    }
}

/** 오늘 묵상의 기존 scriptureRef 한 번 더 읽기 (덮어쓰기 방지용 안전망). */
async function safeGetExistingScriptureRef(dek, userId, today) {
    try {
        const existing = await getRecord(dek, 'meditations', `meditation_${userId}_${today}`);
        return existing && typeof existing.scriptureRef === 'string' && existing.scriptureRef
            ? existing.scriptureRef
            : null;
    } catch (_) {
        return null;
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
