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
// (53번 본인 프로필 AI 부트스트랩 — 2026-05-14) 묶음당 2~3 짧은 질문 + 일괄 제안
import { callProfileBootstrap } from './aiClient.js';
// (Phase C 2026-05-16) AI 로딩 보강 — 단계 라벨 회전 + progress bar + typing breath
import { THINKING_COPY, typeText, shouldReduceMotion } from './aiThinking.js';
// (#58 후속 2026-05-14) 음력 → 올해 양력 자동 표시
import { parseBirthdayMonthDay, lunarBirthdayToUpcomingSolar } from '../infra/lunarCalendar.js';

const BOOTSTRAP_INTRO_KEY = 'sf-bootstrap-intro-shown';

// 5묶음 정의 — 각 묶음에 속한 본인 카드 필드 + 묶음 안 질문 차례 상한.
//   질문 차례는 LLM 시스템 프롬프트와 클라이언트 카운팅 동시 가드.
//   sfId 는 본문 폼 input id — 추출 후 메인 화면 입력값으로 반영할 때 사용.
const BOOTSTRAP_GROUPS = [
    {
        key: 'id',
        label: '🪪 신분증',
        intro: '먼저 인생 자리 가볍게.',
        fields: [
            { key: 'lifeStage',   label: '인생 단계',    type: 'text', sfId: 'sf-lifestage', hint: '학생/직장인/결혼/부모 등' },
            { key: 'currentCity', label: '현재 도시',    type: 'text', sfId: 'sf-city',      hint: '예: 서울' },
        ],
        maxQuestions: 2,
    },
    {
        key: 'faith',
        label: '⛪ 신앙',
        intro: '신앙 자리 짧게.',
        fields: [
            { key: 'homeChurch',     label: '소속 교회',       type: 'text', sfId: 'sf-church',      hint: '교회 이름' },
            { key: 'faithStartDate', label: '신앙 시작 시점',  type: 'text', sfId: 'sf-faith-start', hint: 'YYYY 또는 자유 텍스트' },
            { key: 'faithTone',      label: '신앙 톤',         type: 'text', sfId: 'sf-faith-tone',  hint: '묵상형/전도형/섬김형 등' },
        ],
        maxQuestions: 3,
    },
    {
        key: 'calling',
        label: '🎯 소명',
        intro: '가치관과 관심사 잠시.',
        fields: [
            { key: 'valueKeywords', label: '가치관 키워드', type: 'csv',  sfId: 'sf-values',    hint: '정직, 사랑 ...' },
            { key: 'lifeMission',   label: '인생 미션',     type: 'text', sfId: 'sf-mission',   hint: '한 줄로' },
            { key: 'interests',     label: '관심사',        type: 'csv',  sfId: 'sf-interests', hint: '독서, 음악 ...' },
        ],
        maxQuestions: 3,
    },
    {
        key: 'selfAwareness',
        label: '🧠 자기 인식',
        intro: '자기 자신을 어떻게 보고 계신지.',
        fields: [
            { key: 'identitySentence',  label: '정체성 한 줄',       type: 'text', sfId: 'sf-identity',   hint: '"나는 ~한 사람"' },
            { key: 'currentChallenges', label: '현재 도전 중인 것',  type: 'csv',  sfId: 'sf-challenges', hint: '도전 1, 도전 2 ...' },
            { key: 'mbti',              label: 'MBTI',               type: 'text', sfId: 'sf-mbti',       hint: '선택 (모르면 패스)' },
        ],
        maxQuestions: 3,
    },
    {
        key: 'strengths',
        label: '✨ 강점·경향',
        intro: '잘하는 자리와 걸리는 자리.',
        fields: [
            { key: 'strengths',  label: '강점',                type: 'text', sfId: 'sf-strengths',  hint: '잘하는 것·은혜받은 부분' },
            { key: 'tendencies', label: '경향 (약점·패턴)',    type: 'text', sfId: 'sf-tendencies', hint: '자주 걸려 넘어지는 패턴' },
        ],
        maxQuestions: 2,
    },
];

// ─── 부트스트랩 상태 ───
let _bootstrapState = null; // null = 닫힘. 객체 = 열림

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
        </header>

        <div class="self-profile-intro">
            <p>
                각 칸 옆 작은 칩(공개 / 친한 사이 / 비공개)을 누르면 공개 두께를 바꿀 수 있어요.
                <strong>지금은 모델만 자리잡혀 있고, 실제로 다른 사람에게 보내는 기능은 공동체 모듈과 함께 열릴 예정</strong>이에요.
            </p>
            <p class="self-profile-snapshot-note">📷 마지막 저장: <strong>${lastUpdated}</strong></p>
        </div>

        <!-- (53번 본인 프로필 AI 부트스트랩 — 2026-05-14) 빈 폼 막막함 해소 -->
        <button type="button" id="sf-bootstrap-launch" class="sf-bootstrap-card">
            <span class="sf-bootstrap-icon">🪄</span>
            <span class="sf-bootstrap-text">
                <strong>AI와 함께 채우기</strong>
                <span class="sf-bootstrap-sub">5묶음 · 묶음당 2~3 짧은 질문 · 5분이면 충분해요</span>
            </span>
            <span class="sf-bootstrap-arrow">→</span>
        </button>

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
                <input type="text" id="sf-birthday" value="${escapeAttr(d.birthday)}"
                    placeholder="${(d.birthdayCalendar === 'lunar') ? '음력 예: 8월 15일' : 'YYYY-MM-DD 또는 자유 텍스트'}">
                <div class="birthday-cal-toggle" role="group" aria-label="달력 종류">
                    <button type="button" class="bcal-chip ${(d.birthdayCalendar || 'solar') === 'solar' ? 'active' : ''}"
                        data-bcal="solar">☀️ 양력</button>
                    <button type="button" class="bcal-chip ${d.birthdayCalendar === 'lunar' ? 'active' : ''}"
                        data-bcal="lunar">🌙 음력</button>
                </div>
                <div id="sf-birthday-solar-hint" class="birthday-solar-hint"></div>
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
            <p class="section-desc-foot">자기 평가예요. 공동체에서 "이런 일은 자신 있어요" 알리고 싶은 칸이라 디폴트가 공개로 잡혀 있어요.</p>
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
    // (디자인 시스템 v1 §27·28·29 2026-05-16) 카피 안 아이콘 제거 — 한국어 라벨만 노출.
    const meta = VISIBILITY_META[currentVal] || VISIBILITY_META.private;
    return `
        <button type="button" class="self-vis-chip" data-field="${field}" data-vis="${currentVal}" title="${meta.hint}">
            ${meta.label}
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
            chip.textContent = VISIBILITY_META[next].label;
            chip.title = VISIBILITY_META[next].hint;
            setVisibility(field, next);
        });
    });

    // 저장 버튼
    const saveBtn = container.querySelector('#sf-save-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => saveDraft(container));
    }

    // (53번) AI 부트스트랩 진입
    const bootstrapBtn = container.querySelector('#sf-bootstrap-launch');
    if (bootstrapBtn) {
        bootstrapBtn.addEventListener('click', () => openBootstrap(container));
    }

    // (#58 2026-05-14) 생일 음력/양력 토글 — 메타만 보존
    // (#58 후속) 음력일 때 input 아래에 "올해 양력: X월 X일" 자동 표시
    const birthInput = container.querySelector('#sf-birthday');
    const solarHint  = container.querySelector('#sf-birthday-solar-hint');

    const refreshSolarHint = async () => {
        if (!solarHint) return;
        const cal = _draft.birthdayCalendar || 'solar';
        const txt = birthInput?.value || '';
        if (cal !== 'lunar' || !txt.trim()) { solarHint.textContent = ''; return; }
        const md = parseBirthdayMonthDay(txt);
        if (!md) { solarHint.textContent = ''; return; }
        solarHint.textContent = '✨ 계산 중...';
        const solar = await lunarBirthdayToUpcomingSolar(md.month, md.day);
        if (!solar) { solarHint.textContent = '✨ 양력 변환을 못 했어요 (윤달이거나 범위 밖일 수 있어요)'; return; }
        const daysLabel = solar.daysUntil === 0 ? '오늘!' : `${solar.daysUntil}일 후`;
        solarHint.textContent = `✨ 양력 ${solar.year}년 ${solar.month}월 ${solar.day}일 — ${daysLabel}`;
    };

    container.querySelectorAll('.birthday-cal-toggle .bcal-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const val = chip.dataset.bcal;
            _draft.birthdayCalendar = val;
            container.querySelectorAll('.birthday-cal-toggle .bcal-chip').forEach(c => {
                c.classList.toggle('active', c.dataset.bcal === val);
            });
            if (birthInput) {
                birthInput.placeholder = val === 'lunar'
                    ? '음력 예: 8월 15일'
                    : 'YYYY-MM-DD 또는 자유 텍스트';
            }
            refreshSolarHint();
        });
    });
    birthInput?.addEventListener('input', () => refreshSolarHint());
    refreshSolarHint();

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

    // 2026-05-14 safety: 이전 버그로 _draft 가 string 으로 깨졌을 수 있어 객체 복구.
    if (!_draft || typeof _draft !== 'object') {
        try { _draft = await ensureSelfCard(dek, _userId); }
        catch (e) { console.error('[selfProfile] _draft 복구 실패:', e); _draft = {}; }
    }

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
//  (53번 본인 프로필 AI 부트스트랩 — 2026-05-14)
//
//  흐름: openBootstrap → 묶음 1 ask 1 → 답변 → ask 2 → 답변 → (maxQ) → extract
//        → 추출 카드 (수정 가능) → "이 묶음 박기" → _draft 업데이트 → 다음 묶음
//        → 마지막 묶음 끝 → saveSelfCard → 모달 닫기 → 메인 화면 새로고침
//
//  사용자가 "건너뛰기" 누르면 그 묶음 비우고 다음으로.
//  X 닫기 누르면 지금까지 박힌 _draft 그대로 (저장 X — 사용자가 직접 메인 저장 버튼).
// ═══════════════════════════════════════════════════════════════════════

function openBootstrap(mainContainer) {
    _bootstrapState = {
        mainContainer,
        groupIdx: 0,
        currentGroup: BOOTSTRAP_GROUPS[0],
        groupQuestionNumber: 0,           // 0 = 시작 전, 1~maxQ = 진행 중
        groupAnswers: [],                 // 현재 묶음 안 [{q, a}]
        phase: 'asking',                  // 'asking' | 'extracting' | 'reviewing' | 'done'
        currentQuestion: '',
        extractions: [],                  // 현재 묶음 추출 결과
        appliedAll: {},                   // 모든 묶음 누적 박힘 {field: value}
        loading: false,
    };

    renderBootstrapOverlay();

    // 첫 호출 안내 한 줄
    let introShown = '0';
    try { introShown = localStorage.getItem(BOOTSTRAP_INTRO_KEY) || '0'; } catch {}
    if (introShown !== '1') {
        document.getElementById('sf-bs-intro')?.classList.remove('hidden');
    }

    // 첫 질문 즉시 호출
    askNextQuestion();
}

/**
 * 모달 오버레이 DOM 생성 — 한 번만, 이후 내용만 갱신.
 */
function renderBootstrapOverlay() {
    let overlay = document.getElementById('sf-bs-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'sf-bs-overlay';
        overlay.className = 'sf-bs-overlay';
        overlay.innerHTML = `
            <div class="sf-bs-panel" role="dialog" aria-modal="true" aria-labelledby="sf-bs-title">
                <header class="sf-bs-head">
                    <div class="sf-bs-mode-chip">AI와 함께 채우기</div>
                    <h2 id="sf-bs-title">본인 프로필 부트스트랩</h2>
                    <button id="sf-bs-close" class="sf-bs-close" type="button" aria-label="닫기">×</button>
                </header>

                <div id="sf-bs-intro" class="sf-bs-intro hidden">
                    <span>적으신 답변은 가명으로 바뀌지 않고 AI에게 그대로 갑니다 (본인 정보라). 결정은 사용자께서 직접 내리세요.</span>
                    <button type="button" id="sf-bs-intro-close" aria-label="안내 닫기">×</button>
                </div>

                <nav class="sf-bs-stepper" id="sf-bs-stepper"></nav>

                <main class="sf-bs-body" id="sf-bs-body"></main>
            </div>
        `;
        document.body.appendChild(overlay);

        // 닫기 / 안내 닫기 위임
        overlay.addEventListener('click', (e) => {
            if (e.target.id === 'sf-bs-close' || e.target.id === 'sf-bs-overlay') {
                closeBootstrap();
            }
            if (e.target.id === 'sf-bs-intro-close') {
                document.getElementById('sf-bs-intro')?.classList.add('hidden');
                try { localStorage.setItem(BOOTSTRAP_INTRO_KEY, '1'); } catch {}
            }
        });

        // ESC 닫기
        document.addEventListener('keydown', (e) => {
            if (!_bootstrapState) return;
            if (e.key === 'Escape') { closeBootstrap(); e.preventDefault(); }
        });
    }

    overlay.classList.remove('hidden');
    document.body.classList.add('sf-bs-open');
    renderStepper();
    renderBody();
}

function renderStepper() {
    const root = document.getElementById('sf-bs-stepper');
    if (!root || !_bootstrapState) return;
    root.innerHTML = BOOTSTRAP_GROUPS.map((g, i) => {
        let cls = 'sf-bs-step';
        if (i < _bootstrapState.groupIdx) cls += ' done';
        else if (i === _bootstrapState.groupIdx) cls += ' active';
        return `<div class="${cls}"><span class="sf-bs-step-num">${i + 1}</span><span class="sf-bs-step-label">${escapeHtml(g.label)}</span></div>`;
    }).join('');
}

function renderBody() {
    const root = document.getElementById('sf-bs-body');
    if (!root || !_bootstrapState) return;

    if (_bootstrapState.phase === 'asking') {
        // (Phase C 2026-05-16 fix) SWAN 라벨 통일 + thinking 자리를 채팅 거품 안 inline 으로.
        const turnsHtml = _bootstrapState.groupAnswers.map(t => `
            <div class="sf-bs-turn sf-bs-turn-ai">
                <span class="sf-bs-turn-label">SWAN</span>
                <div class="sf-bs-turn-text">${escapeHtml(t.q)}</div>
            </div>
            <div class="sf-bs-turn sf-bs-turn-user">
                <span class="sf-bs-turn-label">답</span>
                <div class="sf-bs-turn-text">${escapeHtml(t.a)}</div>
            </div>
        `).join('');

        // SWAN 응답 자리 — currentQuestion 있으면 질문 텍스트, 없으면 thinking inline
        const showThinking = !_bootstrapState.currentQuestion;
        const numLabel = _bootstrapState.currentQuestion
            ? ` · ${_bootstrapState.groupQuestionNumber}/${_bootstrapState.currentGroup.maxQuestions}`
            : '';
        const swanTurnContent = showThinking
            ? `<div class="ai-thinking ai-thinking-sm">
                   <div class="ai-thinking-bar"></div>
                   <span class="ai-thinking-label">${escapeHtml(THINKING_COPY.profileBootstrap[0])}</span>
               </div>`
            : `${escapeHtml(_bootstrapState.currentQuestion)}`;
        const swanTurnHtml = `
            <div class="sf-bs-turn sf-bs-turn-ai" id="sf-bs-current-ai-turn">
                <span class="sf-bs-turn-label">SWAN${numLabel}</span>
                <div class="sf-bs-turn-text" data-bs-turn-text="current">${swanTurnContent}</div>
            </div>
        `;

        const answerWrapHtml = _bootstrapState.currentQuestion ? `
            <div class="sf-bs-answer-wrap">
                <textarea id="sf-bs-answer" class="sf-bs-answer" rows="2"
                    placeholder="한 줄이면 충분해요. '없어요' '잘 모르겠어요'도 OK."
                    ${_bootstrapState.loading ? 'disabled' : ''}></textarea>
                <div class="sf-bs-controls">
                    <button type="button" id="sf-bs-skip" class="sf-bs-text-btn">이 묶음 건너뛰기</button>
                    <button type="button" id="sf-bs-next" class="sf-bs-primary-btn"
                        ${_bootstrapState.loading ? 'disabled' : ''}>
                        ${_bootstrapState.groupQuestionNumber >= _bootstrapState.currentGroup.maxQuestions ? '묶음 정리하기' : '다음 질문'}
                    </button>
                </div>
            </div>
        ` : '';

        root.innerHTML = `
            <div class="sf-bs-group-intro">
                <strong>${escapeHtml(_bootstrapState.currentGroup.label)}</strong>
                <span>· ${escapeHtml(_bootstrapState.currentGroup.intro)}</span>
            </div>
            <div class="sf-bs-conversation">${turnsHtml}${swanTurnHtml}${answerWrapHtml}</div>
        `;

        // 이벤트 바인딩
        document.getElementById('sf-bs-next')?.addEventListener('click', onNextClick);
        document.getElementById('sf-bs-skip')?.addEventListener('click', onSkipGroup);

        // (Phase C 2026-05-16) 새 질문이 막 왔으면 typing breath 적용. textarea 포커스는 typing 끝나면.
        if (_bootstrapState.currentQuestion && _bootstrapState.questionNeedsTyping) {
            _bootstrapState.questionNeedsTyping = false;
            _typeBootstrapQuestion(_bootstrapState.currentQuestion)
                .then(() => setTimeout(() => document.getElementById('sf-bs-answer')?.focus(), 50))
                .catch(() => {});
        } else if (_bootstrapState.currentQuestion) {
            setTimeout(() => document.getElementById('sf-bs-answer')?.focus(), 30);
        }

    } else if (_bootstrapState.phase === 'extracting') {
        root.innerHTML = `
            <div class="sf-bs-loading sf-bs-loading-big">
                <div class="ai-thinking">
                    <div class="ai-thinking-bar"></div>
                    <span class="ai-thinking-label">${escapeHtml(THINKING_COPY.profileBootstrap[0])}</span>
                </div>
            </div>
        `;

    } else if (_bootstrapState.phase === 'reviewing') {
        // 추출 카드 — 각 필드별 값 + 수정 가능 input
        const fieldRows = _bootstrapState.currentGroup.fields.map(f => {
            const ext = _bootstrapState.extractions.find(e => e.field === f.key);
            const val = ext ? (Array.isArray(ext.value) ? ext.value.join(', ') : String(ext.value)) : '';
            const evidence = ext?.evidence ? `<span class="sf-bs-evidence" title="${escapeAttr(ext.evidence)}">💬 근거</span>` : '';
            const confidence = ext?.confidence ? `<span class="sf-bs-conf sf-bs-conf-${ext.confidence}">${ext.confidence}</span>` : '';
            return `
                <div class="sf-bs-review-row">
                    <label>${escapeHtml(f.label)} ${confidence} ${evidence}</label>
                    <input type="text" data-field="${f.key}" data-type="${f.type}" value="${escapeAttr(val)}"
                        placeholder="${escapeAttr(f.hint || '비워두려면 그대로')}">
                </div>
            `;
        }).join('');

        const isLastGroup = _bootstrapState.groupIdx >= BOOTSTRAP_GROUPS.length - 1;
        const primaryLabel = isLastGroup ? '본인 프로필에 박기 (저장)' : '이대로 박고 다음 묶음 →';

        root.innerHTML = `
            <div class="sf-bs-group-intro">
                <strong>${escapeHtml(_bootstrapState.currentGroup.label)}</strong>
                <span>· AI가 정리한 값이에요. 마음에 안 들면 직접 고치셔도 돼요.</span>
            </div>
            <div class="sf-bs-review">${fieldRows || '<p class="sf-bs-empty">이 묶음에서 추출된 값이 없어요. 그대로 넘어가실 수 있어요.</p>'}</div>
            <div class="sf-bs-controls">
                <button type="button" id="sf-bs-back-ask" class="sf-bs-text-btn">대화로 돌아가기</button>
                <button type="button" id="sf-bs-apply" class="sf-bs-primary-btn">${primaryLabel}</button>
            </div>
        `;

        document.getElementById('sf-bs-apply')?.addEventListener('click', onApplyGroup);
        document.getElementById('sf-bs-back-ask')?.addEventListener('click', () => {
            _bootstrapState.phase = 'asking';
            renderBody();
        });

    } else if (_bootstrapState.phase === 'done') {
        root.innerHTML = `
            <div class="sf-bs-done">
                <div class="sf-bs-done-icon">🙏</div>
                <h3>본인 프로필이 한층 풍부해졌어요</h3>
                <p>이제 화면을 닫으시면 메인에서 한 번 더 살펴보실 수 있어요. 언제든 다시 부르셔도 됩니다.</p>
                <button type="button" id="sf-bs-done-close" class="sf-bs-primary-btn">닫기</button>
            </div>
        `;
        document.getElementById('sf-bs-done-close')?.addEventListener('click', closeBootstrap);
    }

    // (Phase C 2026-05-16) 노출된 ai-thinking 자리 단계 라벨 회전 — renderBody 매번 새 element 라 자연 자리잡힘.
    _activateProfileBootstrapRotation();
}

// (Phase C 2026-05-16 fix) SWAN 질문 typing breath — 한 자씩 자연 노출.
//   sf-bs-current-ai-turn 안 data-bs-turn-text="current" 자리만 타깃. 끝나면 textarea 포커스.
async function _typeBootstrapQuestion(fullText) {
    const el = document.querySelector('#sf-bs-current-ai-turn [data-bs-turn-text="current"]');
    if (!el) return;
    if (shouldReduceMotion() || !fullText) {
        el.textContent = fullText || '';
        return;
    }
    el.textContent = '';
    el.classList.add('ai-typing');
    for (let i = 0; i < fullText.length; i++) {
        if (!el.isConnected) return;     // 사용자가 닫았으면 중단
        el.textContent = fullText.slice(0, i + 1);
        await new Promise(r => setTimeout(r, 24));
    }
    el.classList.remove('ai-typing');
}

// (Phase C 2026-05-16) profileBootstrap 단계 라벨 회전 — DOM 안 ai-thinking-label 만 자연 자리.
function _activateProfileBootstrapRotation() {
    const root = document.getElementById('sf-bs-body');
    if (!root) return;
    const labelEl = root.querySelector('.ai-thinking-label');
    if (!labelEl) return;
    const labels = THINKING_COPY.profileBootstrap;
    let stage = 0;
    const timer = setInterval(() => {
        if (!labelEl.isConnected) { clearInterval(timer); return; }
        stage = (stage + 1) % labels.length;
        labelEl.style.opacity = '0';
        setTimeout(() => {
            labelEl.textContent = labels[stage];
            labelEl.style.opacity = '';
        }, 150);
    }, 2500);
}

async function askNextQuestion() {
    if (!_bootstrapState || _bootstrapState.loading) return;
    _bootstrapState.loading = true;
    _bootstrapState.groupQuestionNumber += 1;
    const isLastInGroup = _bootstrapState.groupQuestionNumber >= _bootstrapState.currentGroup.maxQuestions;

    // 현재 메인 폼 값 — currentValues 로 전달
    const currentValues = {};
    for (const f of _bootstrapState.currentGroup.fields) {
        const el = _bootstrapState.mainContainer.querySelector('#' + f.sfId);
        if (el) currentValues[f.key] = el.value || '';
    }

    _bootstrapState.currentQuestion = '';
    renderBody();

    try {
        const { text, fallback } = await callProfileBootstrap({
            mode: 'ask',
            currentGroup: _bootstrapState.currentGroup.key,
            groupLabel: _bootstrapState.currentGroup.label,
            groupFields: _bootstrapState.currentGroup.fields.map(f => ({
                key: f.key, label: f.label, type: f.type, hint: f.hint
            })),
            groupQuestionNumber: _bootstrapState.groupQuestionNumber,
            isLastInGroup,
            previousAnswers: _bootstrapState.groupAnswers.map(t => ({ q: t.q, a: t.a })),
            currentValues,
            userName: _draft?.name || '',
        });

        if (fallback || !text) {
            showToast('SWAN을 지금 부를 수 없어요. 묶음을 건너뛰셔도 돼요.');
            _bootstrapState.currentQuestion = '(질문을 못 받았어요. 건너뛰거나 X로 닫으세요.)';
            _bootstrapState.questionNeedsTyping = false;     // 에러 카피는 typing 없이 즉시 노출
        } else {
            _bootstrapState.currentQuestion = text;
            _bootstrapState.questionNeedsTyping = true;       // 새 질문 — typing breath 한 번
        }
        _bootstrapState.loading = false;
        renderBody();
    } catch (e) {
        console.error('[bootstrap] ask failed:', e);
        showToast('잠시 막혔어요. 한 번 더 시도해 주세요.');
        _bootstrapState.loading = false;
        _bootstrapState.groupQuestionNumber -= 1;  // 차례 복구
        renderBody();
    }
}

async function onNextClick() {
    if (!_bootstrapState || _bootstrapState.loading) return;
    const ans = (document.getElementById('sf-bs-answer')?.value || '').trim();
    if (!ans) {
        showToast('한 줄이라도 적어 주세요. 모르시면 "모르겠어요" 적으셔도 OK.');
        return;
    }

    // 답변 누적
    _bootstrapState.groupAnswers.push({
        q: _bootstrapState.currentQuestion,
        a: ans,
    });
    _bootstrapState.currentQuestion = '';

    // 묶음 끝 — 추출 모드로
    if (_bootstrapState.groupQuestionNumber >= _bootstrapState.currentGroup.maxQuestions) {
        await runExtract();
        return;
    }
    // 다음 질문
    askNextQuestion();
}

async function runExtract() {
    if (!_bootstrapState) return;
    _bootstrapState.phase = 'extracting';
    _bootstrapState.loading = true;
    renderBody();

    const currentValues = {};
    for (const f of _bootstrapState.currentGroup.fields) {
        const el = _bootstrapState.mainContainer.querySelector('#' + f.sfId);
        if (el) currentValues[f.key] = el.value || '';
    }

    try {
        const { extractions, fallback } = await callProfileBootstrap({
            mode: 'extract',
            currentGroup: _bootstrapState.currentGroup.key,
            groupLabel: _bootstrapState.currentGroup.label,
            groupFields: _bootstrapState.currentGroup.fields.map(f => ({
                key: f.key, label: f.label, type: f.type, hint: f.hint
            })),
            groupQuestionNumber: _bootstrapState.groupQuestionNumber,
            isLastInGroup: true,
            previousAnswers: _bootstrapState.groupAnswers.map(t => ({ q: t.q, a: t.a })),
            currentValues,
            userName: _draft?.name || '',
        });

        if (fallback) {
            showToast('AI를 지금 부를 수 없어요. 직접 적으셔도 됩니다.');
            _bootstrapState.extractions = [];
        } else {
            _bootstrapState.extractions = extractions || [];
        }

        _bootstrapState.loading = false;
        _bootstrapState.phase = 'reviewing';
        renderBody();
    } catch (e) {
        console.error('[bootstrap] extract failed:', e);
        showToast('정리가 막혔어요. 직접 박으셔도 됩니다.');
        _bootstrapState.loading = false;
        _bootstrapState.extractions = [];
        _bootstrapState.phase = 'reviewing';
        renderBody();
    }
}

function onSkipGroup() {
    if (!_bootstrapState) return;
    advanceGroup();
}

function onApplyGroup() {
    if (!_bootstrapState) return;
    // reviewing 화면의 input 값 수집해 메인 폼 input + _draft 둘 다 반영
    const rows = document.querySelectorAll('#sf-bs-body .sf-bs-review-row input');
    rows.forEach(input => {
        const field = input.dataset.field;
        const type = input.dataset.type;
        const raw = (input.value || '').trim();
        if (!field) return;

        // 메인 폼 input 갱신
        const fieldDef = _bootstrapState.currentGroup.fields.find(f => f.key === field);
        if (fieldDef) {
            const mainEl = _bootstrapState.mainContainer.querySelector('#' + fieldDef.sfId);
            if (mainEl) mainEl.value = raw;
        }
        // _draft 반영
        if (type === 'csv') {
            _draft[field] = raw ? raw.split(',').map(s => s.trim()).filter(Boolean) : [];
        } else {
            _draft[field] = raw;
        }
        _bootstrapState.appliedAll[field] = _draft[field];
    });
    advanceGroup();
}

async function advanceGroup() {
    if (!_bootstrapState) return;
    const isLast = _bootstrapState.groupIdx >= BOOTSTRAP_GROUPS.length - 1;
    if (isLast) {
        // 마지막 묶음 끝 — 자동 저장
        try {
            const dek = getDEK();
            if (dek && _userId) {
                const saved = await saveSelfCard(dek, _userId, _draft);
                _draft = saved;
                showToast('🙏 본인 프로필이 저장됐어요');
            }
        } catch (e) {
            console.error('[bootstrap] auto-save failed:', e);
            showToast('자동 저장이 막혔어요. 메인 화면 저장 버튼으로 한 번 더 눌러 주세요.');
        }
        _bootstrapState.phase = 'done';
        renderBody();
        renderStepper();
        return;
    }
    // 다음 묶음
    _bootstrapState.groupIdx += 1;
    _bootstrapState.currentGroup = BOOTSTRAP_GROUPS[_bootstrapState.groupIdx];
    _bootstrapState.groupQuestionNumber = 0;
    _bootstrapState.groupAnswers = [];
    _bootstrapState.currentQuestion = '';
    _bootstrapState.extractions = [];
    _bootstrapState.phase = 'asking';
    renderStepper();
    askNextQuestion();
}

function closeBootstrap() {
    const overlay = document.getElementById('sf-bs-overlay');
    if (overlay) overlay.classList.add('hidden');
    document.body.classList.remove('sf-bs-open');
    // 부트스트랩 중 박힌 값들은 메인 폼에 이미 반영됨. 사용자가 메인에서 추가 수정 후 저장 가능.
    _bootstrapState = null;
    // 마지막 저장 시점 표시 갱신
    if (_draft?.lastSelfUpdatedAt) {
        const note = document.querySelector('#view-self-profile .self-profile-snapshot-note');
        if (note) {
            note.innerHTML = `📷 마지막 저장: <strong>${new Date(_draft.lastSelfUpdatedAt).toLocaleString('ko-KR')}</strong>`;
        }
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

        /* ═══ (53번 본인 프로필 AI 부트스트랩 — 2026-05-14) ═══ */

        /* 상단 진입 카드 */
        #view-self-profile .sf-bootstrap-card {
            display: flex;
            align-items: center;
            gap: 14px;
            width: 100%;
            margin: 16px 0;
            padding: 14px 18px;
            background: linear-gradient(135deg,
                var(--bg-secondary, #f4f1ec) 0%,
                var(--bg, #faf7f2) 100%);
            border: 1px solid var(--brand-primary, #6d7666);
            border-radius: 12px;
            cursor: pointer;
            font-family: inherit;
            text-align: left;
            transition: border-color 0.15s ease, transform 0.1s ease;
        }
        #view-self-profile .sf-bootstrap-card:hover {
            border-color: var(--accent, #6d7666);
            transform: translateY(-1px);
        }
        #view-self-profile .sf-bootstrap-icon { font-size: 28px; flex-shrink: 0; }
        #view-self-profile .sf-bootstrap-text { flex: 1; display: flex; flex-direction: column; gap: 2px; }
        #view-self-profile .sf-bootstrap-text strong { font-size: 15px; color: var(--text-primary, #1a1814); }
        #view-self-profile .sf-bootstrap-sub { font-size: 12px; color: var(--ink-secondary, #5d5a52); }
        #view-self-profile .sf-bootstrap-arrow { color: var(--brand-primary, #6d7666); font-size: 18px; flex-shrink: 0; }

        /* 부트스트랩 오버레이 — body 직속 (view-self-profile 밖) */
        .sf-bs-overlay {
            position: fixed;
            inset: 0;
            background: rgba(20, 18, 14, 0.5);
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .sf-bs-overlay.hidden { display: none; }
        body.sf-bs-open { overflow: hidden; }

        .sf-bs-panel {
            background: var(--bg, #faf7f2);
            border-radius: 14px;
            width: 100%;
            max-width: 720px;
            max-height: 90vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
            overflow: hidden;
        }

        .sf-bs-head {
            padding: 16px 20px 12px;
            border-bottom: 1px solid var(--border, #d8d3c8);
            position: relative;
        }
        .sf-bs-mode-chip {
            display: inline-block;
            font-size: 11px;
            color: var(--brand-primary, #6d7666);
            background: var(--bg-secondary, #f4f1ec);
            padding: 2px 8px;
            border-radius: 10px;
            margin-bottom: 6px;
        }
        .sf-bs-head h2 {
            margin: 0;
            font-family: 'Noto Serif KR', serif;
            font-size: 18px;
            font-weight: 400;
            color: var(--text-primary, #1a1814);
        }
        .sf-bs-close {
            position: absolute;
            top: 12px;
            right: 12px;
            background: transparent;
            border: none;
            font-size: 22px;
            color: var(--ink-secondary, #5d5a52);
            cursor: pointer;
            width: 32px;
            height: 32px;
            border-radius: 8px;
        }
        .sf-bs-close:hover { background: var(--bg-secondary, #f4f1ec); color: var(--text-primary, #1a1814); }

        .sf-bs-intro {
            margin: 12px 20px;
            padding: 8px 12px;
            background: var(--bg-secondary, #f4f1ec);
            border-left: 2px solid var(--brand-primary, #6d7666);
            border-radius: 6px;
            font-size: 12px;
            color: var(--ink-secondary, #5d5a52);
            display: flex;
            justify-content: space-between;
            gap: 12px;
            line-height: 1.5;
        }
        .sf-bs-intro.hidden { display: none; }
        .sf-bs-intro button {
            background: transparent;
            border: none;
            cursor: pointer;
            color: var(--ink-secondary, #5d5a52);
            font-size: 14px;
            padding: 0 4px;
            flex-shrink: 0;
        }

        /* 스테퍼 — 5묶음 진행도 */
        .sf-bs-stepper {
            display: flex;
            gap: 8px;
            padding: 12px 20px;
            border-bottom: 1px solid var(--border, #d8d3c8);
            overflow-x: auto;
        }
        .sf-bs-step {
            display: flex;
            align-items: center;
            gap: 6px;
            padding: 4px 10px;
            border-radius: 999px;
            font-size: 12px;
            color: var(--ink-secondary, #5d5a52);
            background: transparent;
            border: 1px solid var(--border, #d8d3c8);
            white-space: nowrap;
            flex-shrink: 0;
        }
        .sf-bs-step.done {
            background: var(--bg-secondary, #f4f1ec);
            color: var(--brand-primary, #6d7666);
            border-color: var(--brand-primary, #6d7666);
        }
        .sf-bs-step.active {
            background: var(--brand-primary, #6d7666);
            color: #fff;
            border-color: var(--brand-primary, #6d7666);
        }
        .sf-bs-step-num {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            background: rgba(0, 0, 0, 0.08);
            border-radius: 50%;
            font-weight: 600;
            font-size: 11px;
        }
        .sf-bs-step.active .sf-bs-step-num { background: rgba(255, 255, 255, 0.2); }

        /* 본문 */
        .sf-bs-body {
            padding: 16px 20px 20px;
            overflow-y: auto;
            flex: 1;
        }
        .sf-bs-group-intro {
            font-size: 13px;
            color: var(--ink-secondary, #5d5a52);
            margin-bottom: 12px;
        }
        .sf-bs-group-intro strong {
            font-family: 'Noto Serif KR', serif;
            font-size: 15px;
            color: var(--text-primary, #1a1814);
            margin-right: 8px;
        }

        .sf-bs-conversation {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .sf-bs-turn {
            padding: 10px 12px;
            border-radius: 8px;
            border: 1px solid var(--border, #d8d3c8);
            background: var(--bg-secondary, #f4f1ec);
            line-height: 1.5;
        }
        .sf-bs-turn-ai { border-left: 3px solid var(--brand-primary, #6d7666); }
        .sf-bs-turn-user { background: transparent; border-left: 3px solid var(--ink-tertiary, #a8a499); }
        .sf-bs-turn-label {
            display: block;
            font-size: 11px;
            color: var(--ink-tertiary, #a8a499);
            margin-bottom: 4px;
        }
        .sf-bs-turn-ai .sf-bs-turn-label { color: var(--brand-primary, #6d7666); }
        .sf-bs-turn-text {
            font-size: 14px;
            color: var(--text-primary, #1a1814);
        }
        .sf-bs-turn-ai .sf-bs-turn-text { font-family: 'Noto Serif KR', serif; font-weight: 400; }

        .sf-bs-answer-wrap { margin-top: 8px; }
        .sf-bs-answer {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid var(--border, #d8d3c8);
            border-radius: 8px;
            background: var(--bg, #faf7f2);
            font-size: 14px;
            font-family: inherit;
            resize: vertical;
        }

        .sf-bs-controls {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 10px;
            gap: 10px;
        }
        .sf-bs-text-btn {
            background: transparent;
            border: none;
            color: var(--ink-secondary, #5d5a52);
            font-size: 12px;
            cursor: pointer;
            padding: 6px 10px;
            border-radius: 6px;
            font-family: inherit;
        }
        .sf-bs-text-btn:hover { color: var(--text-primary, #1a1814); }
        .sf-bs-primary-btn {
            background: var(--brand-primary, #6d7666);
            color: #fff;
            border: none;
            border-radius: 8px;
            padding: 8px 16px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            font-family: inherit;
        }
        .sf-bs-primary-btn:hover { background: var(--accent, #5d6657); }
        .sf-bs-primary-btn:disabled { opacity: 0.5; cursor: wait; }

        /* 로딩 */
        .sf-bs-loading {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 0;
            color: var(--ink-tertiary, #a8a499);
            font-size: 13px;
        }
        .sf-bs-loading-big { justify-content: center; padding: 40px 0; }
        .sf-bs-dots { display: inline-flex; gap: 4px; }
        .sf-bs-dots span {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--brand-primary, #6d7666);
            opacity: 0.4;
            animation: sfBsPulse 1.4s ease-in-out infinite;
        }
        .sf-bs-dots span:nth-child(2) { animation-delay: 0.2s; }
        .sf-bs-dots span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes sfBsPulse {
            0%, 80%, 100% { opacity: 0.2; }
            40% { opacity: 1; }
        }

        /* 리뷰(추출 결과) */
        .sf-bs-review {
            display: flex;
            flex-direction: column;
            gap: 12px;
            margin-bottom: 16px;
        }
        .sf-bs-review-row {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .sf-bs-review-row label {
            font-size: 12px;
            color: var(--ink-secondary, #5d5a52);
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .sf-bs-review-row input {
            padding: 8px 10px;
            border: 1px solid var(--border, #d8d3c8);
            border-radius: 8px;
            background: var(--bg, #faf7f2);
            font-size: 14px;
            font-family: inherit;
        }
        .sf-bs-conf {
            font-size: 10px;
            padding: 1px 6px;
            border-radius: 8px;
            color: #fff;
        }
        .sf-bs-conf-high { background: #6d7666; }
        .sf-bs-conf-medium { background: #a8a499; }
        .sf-bs-conf-low { background: #c8c4b9; }
        .sf-bs-evidence {
            font-size: 11px;
            color: var(--ink-tertiary, #a8a499);
            cursor: help;
        }
        .sf-bs-empty {
            text-align: center;
            color: var(--ink-tertiary, #a8a499);
            font-size: 13px;
            padding: 16px;
        }

        /* 완료 화면 */
        .sf-bs-done {
            text-align: center;
            padding: 40px 20px;
        }
        .sf-bs-done-icon {
            font-size: 48px;
            margin-bottom: 16px;
        }
        .sf-bs-done h3 {
            font-family: 'Noto Serif KR', serif;
            font-size: 18px;
            font-weight: 400;
            margin: 0 0 8px;
            color: var(--text-primary, #1a1814);
        }
        .sf-bs-done p {
            color: var(--ink-secondary, #5d5a52);
            font-size: 13px;
            line-height: 1.6;
            margin: 0 auto 20px;
            max-width: 420px;
        }

        /* 모바일 */
        @media (max-width: 640px) {
            .sf-bs-overlay { padding: 0; }
            .sf-bs-panel { max-height: 100vh; border-radius: 0; max-width: 100%; }
            .sf-bs-stepper { padding: 8px 12px; }
            .sf-bs-body { padding: 12px 16px 16px; }
            .sf-bs-step-label { display: none; }
        }
    `;
    document.head.appendChild(style);
}
