/**
 * preSurveyForm.js — 1차 베타 사전 설문 풀스크린 카드 폼
 *
 * 2026-05-18 시안 v2: Q1~Q12 12 카드 + 마침 카드 = 13 카드.
 *   온보딩 결(.onboarding-card·.onboarding-card-enter·.onboarding-stepper) 정확 매칭.
 *   진입 애니메이션 + dot stepper 동일.
 *
 * 결정 사항 (사용자 합의, 2026-05-18):
 *   - 풀스크린 카드 (온보딩 결)
 *   - dot stepper 12 + 카드 enter 애니메이션
 *   - 객관식 칩 위 + 자유 텍스트 아래 (사용자 결로 칩 먼저)
 *   - Q1 다중 선택, Q3·Q6-B·Q9-B 자유 텍스트 필수
 *   - [닫기·멈추기] X (베타 진입 시) — 시안 단계엔 임시 [닫기]
 *   - 이전·다음 버튼 + 답변 보존 (state 유지)
 *   - AI 가공·자동 트리거·Firestore 저장은 Phase 2~4 — 시안은 정적 + 콘솔 출력
 */

import { showToast } from './quickReview.js';

// ─── 카탈로그 (v2 합의 12 질문) ─────────────────────────────────
const RAPPORT_COPY = '잠깐, 5~9분 정도 평소 묵상·신앙 흐름 들려주세요.<br>정답은 없어요. 솔직한 한 줄이 가장 큰 선물이에요.';

const QUESTIONS = [
    {
        id: 'Q1',
        title: '요즘 신앙 생활에서<br>가장 마음에 두고 있는 게 뭐예요?',
        chipBlocks: [{
            mode: 'multi',
            hint: '여러 개 골라도 좋아요',
            allowOther: true,
            chips: ['가족·관계 회복', '직장·진로 분별', '말씀 더 깊이 알고 싶음', '기도·묵상 습관 들이기', '끊고 싶은 죄·습관', '봉사·사역 자리', '영적 정체기 회복', '자녀·신앙 교육', '공동체·관계 안 신앙 깊어지기'],
        }],
        freeTextBlocks: [
            { label: '(선택) 한 줄 더 들려주실래요', required: false, rows: 2 },
        ],
    },
    {
        id: 'Q2',
        title: '최근 한 달 묵상·QT를<br>며칠 정도 하셨어요?',
        chipBlocks: [{
            mode: 'single',
            hint: '하나만 골라요',
            allowOther: false,
            chips: ['0일 (못 했어요)', '1~5일 (드물게)', '6~15일 (절반쯤)', '16~25일 (자주)', '26~30일 (거의 매일)'],
        }],
        freeTextBlocks: [
            { label: '(선택) 못 한 날은 보통 어떤 상황이었어요?', required: false, rows: 2 },
        ],
    },
    {
        id: 'Q3',
        title: '묵상 못 한 최근 사례 —<br>가장 큰 원인이 뭐였어요?',
        chipBlocks: [{
            mode: 'multi',
            hint: '여러 개 골라도 좋아요',
            allowOther: true,
            chips: ['시간이 부족했어요', '마음이 산만했어요', '동기·의미 잘 모르겠어요', '피곤·잠이 모자랐어요', '그냥 잊어버렸어요', '영적으로 메말랐어요', '어디서 시작해야 할지 모르겠어요'],
        }],
        freeTextBlocks: [
            { label: '구체적 상황 한 줄 들려주세요 (필수)', required: true, rows: 3 },
        ],
    },
    {
        id: 'Q4',
        title: '그 문제 풀어보려고<br>시도해본 게 있어요?',
        chipBlocks: [{
            mode: 'multi',
            hint: '여러 개 골라도 좋아요',
            allowOther: true,
            chips: ['새 묵상·QT 앱 깔기', '챌린지·N일 도전', '공동체·소그룹 참여', '책·강의·세미나', 'QT집·교재 구독', '멘토링·코칭', '시도 안 했어요'],
        }],
        freeTextBlocks: [
            { label: '(선택) 효과는 어땠어요? 왜 그만뒀거나 유지하고 계세요?', required: false, rows: 2 },
        ],
    },
    {
        id: 'Q5',
        title: '지금 쓰는<br>묵상·성경 앱 있어요?',
        chipBlocks: [
            {
                mode: 'single',
                hint: '주력으로 쓰는 거 하나만 골라요',
                allowOther: true,
                chips: ['생명의삶', '큐티인', '데일리성경', 'YouVersion', 'Glorify', 'Hallow', '종이 QT', '성경 본문만 읽어요', '아무것도 안 써요'],
            },
            {
                mode: 'multi',
                hint: '그 외 가끔 쓰는 게 있다면 (여러 개 OK, 선택)',
                allowOther: false,
                chips: ['생명의삶', '큐티인', '데일리성경', 'YouVersion', 'Glorify', 'Hallow', '종이 QT'],
            },
        ],
        freeTextBlocks: [
            { label: '(선택) 도움 되는 점·아쉬운 점', required: false, rows: 2 },
        ],
    },
    {
        id: 'Q6',
        title: '묵상 끝난 뒤 그 내용이<br>그날 하루로 이어진다고 느끼세요?',
        chipBlocks: [{
            mode: 'single',
            hint: '하나만 골라요',
            allowOther: false,
            chips: ['자주 이어져요', '가끔 이어져요', '거의 안 이어져요', '한 번도 그런 관점으로 생각 안 해봤어요'],
        }],
        freeTextBlocks: [
            { label: '구체적 사례 1개 들려주세요 (필수)', required: true, rows: 3 },
            { label: '(선택) 단절감이나 아쉬움이 있다면 한 줄', required: false, rows: 2 },
        ],
    },
    {
        id: 'Q7',
        title: '평소 할 일·목표 관리할 때<br>쓰는 도구 있어요?',
        chipBlocks: [
            {
                mode: 'multi',
                hint: '여러 개 골라도 좋아요',
                allowOther: true,
                chips: ['구글 캘린더', '네이버 캘린더', '노션·옵시디언', '투두이스트·할 일 앱', '종이 다이어리·플래너', '안 씀'],
            },
            {
                mode: 'single',
                hint: '신앙 생활(묵상·기도·봉사)도 거기 같이 넣어 쓴 적 있어요?',
                allowOther: false,
                chips: ['네, 자주요', '가끔요', '안 넣어요'],
            },
        ],
        freeTextBlocks: [],
    },
    {
        id: 'Q8',
        title: '묵상이나 신앙 관련해서<br>돈·시간 써본 적 있어요?',
        chipBlocks: [{
            mode: 'multi',
            hint: '여러 개 골라도 좋아요',
            allowOther: true,
            chips: ['책 구입', '강의·세미나', '수련회·집회', '유료 묵상·성경 앱', '멘토링·코칭', 'QT집 구독', '없어요'],
        }],
        freeTextBlocks: [
            { label: '(선택) 가장 도움 컸던 거 + 그 이유 한 줄', required: false, rows: 2 },
        ],
    },
    {
        id: 'Q9',
        title: '어떤 가치가 있어야<br>한 달 비용이 의미 있다고 느낄까요?',
        chipBlocks: [{
            mode: 'multi',
            hint: '여러 개 골라도 좋아요',
            allowOther: true,
            chips: ['묵상 습관이 진짜로 자리잡혀야', '깊이 있는 통찰을 줘야', '묵상과 삶이 이어져야', '시간 절약·효율', '공동체와의 연결', '기도 깊이 더해줘야', '신앙 정체기 회복 도와야'],
        }],
        freeTextBlocks: [
            { label: '그런 가치가 있다면 한 달에 얼마까지 쓰실 의향 있어요? (필수)', required: true, rows: 2 },
        ],
    },
    {
        id: 'Q10',
        title: '이번 2주 동안 본인이<br>가장 알아보고 싶은 게 뭐예요?',
        chipBlocks: [{
            mode: 'single',
            hint: '하나만 골라요',
            allowOther: true,
            chips: ['묵상 습관이 정말 들지', '묵상과 삶이 이어지는지', '이 도구가 도움이 되는지', '다른 사람한테 추천할 만한지', '단순 호기심'],
        }],
        freeTextBlocks: [
            { label: '(선택) 자유 의견 한 줄', required: false, rows: 2 },
        ],
    },
    {
        id: 'Q11',
        title: '묵상·신앙 관련 공동체나<br>모임에 지금 참여하고 계세요?',
        chipBlocks: [
            {
                mode: 'multi',
                hint: '여러 개 골라도 좋아요',
                allowOther: true,
                chips: ['교회 예배 참석만', '셀·소그룹·구역', 'QT·묵상 나눔 모임', '사역팀·봉사팀', '큐티 인증·온라인 묵상 공동체', '안 함'],
            },
            {
                mode: 'single',
                hint: '그 자리들이 본인 묵상·신앙 흐름에 도움이 되나요?',
                allowOther: false,
                chips: ['전혀 도움 안 됨', '별로 도움 안 됨', '보통', '도움 됨', '아주 큰 도움'],
            },
        ],
        freeTextBlocks: [
            { label: '(선택) 어떻게 도움 되거나, 어떤 자리가 아쉬운지 한 줄', required: false, rows: 2 },
        ],
    },
    {
        id: 'Q12',
        title: '부부·가족 단위로<br>함께 하는 신앙 자리가 있어요?',
        chipBlocks: [{
            mode: 'multi',
            hint: '여러 개 골라도 좋아요',
            allowOther: true,
            chips: ['부부 함께 묵상·QT', '자녀와 묵상·기도', '가정예배 정기적으로 드림', '부모님과 신앙 나눔', '명절·기념일 가족 묵상', '해당 없음 (미혼·싱글·가족과 신앙 자리 없음)'],
        }],
        freeTextBlocks: [
            { label: '(선택) 그 자리가 본인 신앙에 어떤 결로 닿아 있는지·아쉬운 점', required: false, rows: 2 },
        ],
    },
];

// ─── 모듈 상태 ───────────────────────────────────────────────
let _backdropEl = null;
let _state = null;
let _escHandler = null;

// ─── 진입점 ─────────────────────────────────────────────────
export function openPreSurveyForm() {
    if (_backdropEl) return;

    _state = {
        currentIdx: 0,
        responses: {},
    };

    const backdrop = document.createElement('div');
    backdrop.id = 'presurvey-backdrop';
    backdrop.className = 'presurvey-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.innerHTML = `
        <div class="presurvey-modal" id="presurvey-modal">
            <button type="button" class="presurvey-close-temp" id="presurvey-close-btn" aria-label="시안 닫기 (베타에서는 없어요)">×</button>
            <div class="onboarding-stepper presurvey-stepper" id="presurvey-stepper" aria-label="진행도">
                ${Array.from({ length: QUESTIONS.length }, (_, i) => i + 1).map(n =>
                    `<span class="onboarding-step-dot${n === 1 ? ' active' : ''}" data-step="${n}"></span>`
                ).join('')}
            </div>
            <div class="presurvey-body" id="presurvey-body"></div>
        </div>
    `;

    document.body.appendChild(backdrop);
    _backdropEl = backdrop;

    document.getElementById('presurvey-close-btn').addEventListener('click', closeForm);

    _escHandler = (e) => {
        if (e.key === 'Escape') closeForm();
    };
    document.addEventListener('keydown', _escHandler);

    renderCurrentCard();
}

// ─── 카드 렌더링 ────────────────────────────────────────────
function renderCurrentCard() {
    const body = document.getElementById('presurvey-body');
    if (!body) return;

    const idx = _state.currentIdx;

    if (idx >= QUESTIONS.length) {
        renderFinishCard(body);
    } else {
        renderQuestionCard(body, idx);
    }

    // dot stepper 갱신 (마침 카드면 모두 done)
    updateStepperDots(idx + 1);

    // 카드 enter 애니메이션 (온보딩 결)
    const card = body.querySelector('.onboarding-card');
    if (card) {
        card.classList.add('onboarding-card-enter');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => card.classList.add('onboarding-card-enter-active'));
        });
    }
}

function renderQuestionCard(body, idx) {
    const q = QUESTIONS[idx];
    const stored = _state.responses[q.id] || initResponse(q);
    _state.responses[q.id] = stored;

    const isFirst = idx === 0;
    const isLast = idx === QUESTIONS.length - 1;
    const stepLabel = `${idx + 1} / ${QUESTIONS.length}`;

    body.innerHTML = `
        <div class="onboarding-card presurvey-card-wrap">
            <p class="presurvey-step-count">${stepLabel}</p>
            ${isFirst ? `<p class="presurvey-rapport">${RAPPORT_COPY}</p>` : ''}
            <h2 class="onboarding-title presurvey-question">${q.title}</h2>

            ${renderChipBlocks(q, stored)}
            ${renderFreeTextBlocks(q, stored)}

            <div class="onboarding-actions presurvey-footer">
                <button type="button" class="onboarding-btn presurvey-btn-prev" ${idx === 0 ? 'disabled' : ''}>← 이전</button>
                <button type="button" class="onboarding-btn onboarding-btn-primary presurvey-btn-next">${isLast ? '다 들려줬어요 →' : '다음 →'}</button>
            </div>
        </div>
    `;

    bindCardEvents(body, q);
    updateNextButton(q);
}

function renderChipBlocks(q, stored) {
    if (!q.chipBlocks || q.chipBlocks.length === 0) return '';
    return q.chipBlocks.map((block, blockIdx) => {
        const storedBlock = stored.chipBlocks[blockIdx] || { selected: [], other: '' };
        const chipsHtml = block.chips.map((label) => {
            const isActive = storedBlock.selected.includes(label);
            return `<button type="button" class="presurvey-chip${isActive ? ' presurvey-chip-active' : ''}" data-block="${blockIdx}" data-chip="${escapeAttr(label)}" aria-pressed="${isActive}">${escapeHtml(label)}</button>`;
        }).join('');

        const otherActive = storedBlock.other.length > 0;
        const otherHtml = block.allowOther ? `
            <div class="presurvey-chip-other">
                <button type="button" class="presurvey-chip${otherActive ? ' presurvey-chip-active' : ''}" data-block="${blockIdx}" data-chip="__OTHER__" aria-pressed="${otherActive}">기타</button>
                <input type="text" class="presurvey-chip-other-input" data-block="${blockIdx}" placeholder="자유 입력" maxlength="60" value="${escapeAttr(storedBlock.other)}" ${otherActive ? '' : 'hidden'}>
            </div>
        ` : '';

        return `
            <div class="presurvey-block">
                ${block.hint ? `<p class="presurvey-chip-hint">${escapeHtml(block.hint)}</p>` : ''}
                <div class="presurvey-chip-grid" data-block="${blockIdx}" data-mode="${block.mode}">
                    ${chipsHtml}
                    ${otherHtml}
                </div>
            </div>
        `;
    }).join('');
}

function renderFreeTextBlocks(q, stored) {
    if (!q.freeTextBlocks || q.freeTextBlocks.length === 0) return '';
    return q.freeTextBlocks.map((ft, ftIdx) => {
        const value = stored.freeTextBlocks[ftIdx] || '';
        const isRequired = !!ft.required;
        return `
            <div class="presurvey-block">
                <label class="presurvey-free-label${isRequired ? ' presurvey-free-required' : ''}" for="presurvey-ft-${ftIdx}">${escapeHtml(ft.label)}</label>
                <textarea
                    id="presurvey-ft-${ftIdx}"
                    class="presurvey-free-input"
                    data-ft-idx="${ftIdx}"
                    rows="${ft.rows || 2}"
                    maxlength="${ft.maxLength || 500}"
                    placeholder="">${escapeHtml(value)}</textarea>
            </div>
        `;
    }).join('');
}

function renderFinishCard(body) {
    body.innerHTML = `
        <div class="onboarding-card presurvey-card-wrap presurvey-finish-card">
            <h2 class="onboarding-title presurvey-question">사전 설문 잘 받았어요.<br>12 자리 들려주셔서 고마워요.</h2>
            <p class="presurvey-rapport">시안 단계라 답변은 아직 저장 안 돼요. Phase 2~4 진입하면 AI 가공·자동 저장·관리자 페이지 결과 보기 모두 자리잡혀요.</p>
            <div class="onboarding-actions presurvey-footer presurvey-finish-footer">
                <button type="button" class="onboarding-btn presurvey-btn-prev" id="presurvey-finish-prev">← 이전</button>
                <button type="button" class="onboarding-btn onboarding-btn-primary presurvey-btn-finish">마치기</button>
            </div>
        </div>
    `;
    body.querySelector('#presurvey-finish-prev').addEventListener('click', () => {
        _state.currentIdx -= 1;
        renderCurrentCard();
    });
    body.querySelector('.presurvey-btn-finish').addEventListener('click', () => {
        console.log('[preSurveyForm] 시안 전체 답변:', JSON.parse(JSON.stringify(_state.responses)));
        showToast('사전 설문 시안 잘 받았어요. (콘솔에 전체 답변 출력)');
        closeForm();
    });
}

// ─── 이벤트 바인딩 ──────────────────────────────────────────
function bindCardEvents(body, q) {
    const stored = _state.responses[q.id];

    // 칩 클릭
    body.querySelectorAll('.presurvey-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const blockIdx = parseInt(chip.dataset.block, 10);
            const block = q.chipBlocks[blockIdx];
            const storedBlock = stored.chipBlocks[blockIdx];
            const chipLabel = chip.dataset.chip;

            if (chipLabel === '__OTHER__') {
                // 기타 클릭 = 입력 자리 토글
                const otherInput = body.querySelector(`.presurvey-chip-other-input[data-block="${blockIdx}"]`);
                if (storedBlock.other) {
                    // 이미 입력 있음 → 비우기
                    storedBlock.other = '';
                    otherInput.value = '';
                    otherInput.hidden = true;
                    chip.classList.remove('presurvey-chip-active');
                    chip.setAttribute('aria-pressed', 'false');
                } else {
                    // 비어 있음 → 입력 자리 노출 + focus
                    otherInput.hidden = false;
                    chip.classList.add('presurvey-chip-active');
                    chip.setAttribute('aria-pressed', 'true');
                    setTimeout(() => otherInput.focus(), 30);
                }
            } else if (block.mode === 'single') {
                // 단일 선택 = 새로 갈아끼움
                storedBlock.selected = [chipLabel];
                // 모든 칩 비활성화 후 현재 칩 활성화
                body.querySelectorAll(`.presurvey-chip[data-block="${blockIdx}"]`).forEach(c => {
                    if (c.dataset.chip !== '__OTHER__') {
                        const active = c.dataset.chip === chipLabel;
                        c.classList.toggle('presurvey-chip-active', active);
                        c.setAttribute('aria-pressed', active ? 'true' : 'false');
                    }
                });
            } else {
                // 다중 선택 = toggle
                const idx = storedBlock.selected.indexOf(chipLabel);
                if (idx === -1) {
                    storedBlock.selected.push(chipLabel);
                    chip.classList.add('presurvey-chip-active');
                    chip.setAttribute('aria-pressed', 'true');
                } else {
                    storedBlock.selected.splice(idx, 1);
                    chip.classList.remove('presurvey-chip-active');
                    chip.setAttribute('aria-pressed', 'false');
                }
            }
            updateNextButton(q);
        });
    });

    // 기타 입력
    body.querySelectorAll('.presurvey-chip-other-input').forEach(input => {
        input.addEventListener('input', () => {
            const blockIdx = parseInt(input.dataset.block, 10);
            stored.chipBlocks[blockIdx].other = input.value;
            updateNextButton(q);
        });
    });

    // 자유 텍스트
    body.querySelectorAll('.presurvey-free-input').forEach(ta => {
        ta.addEventListener('input', () => {
            const ftIdx = parseInt(ta.dataset.ftIdx, 10);
            stored.freeTextBlocks[ftIdx] = ta.value;
            updateNextButton(q);
        });
    });

    // 이전·다음
    body.querySelector('.presurvey-btn-prev')?.addEventListener('click', () => {
        if (_state.currentIdx > 0) {
            _state.currentIdx -= 1;
            renderCurrentCard();
        }
    });
    body.querySelector('.presurvey-btn-next')?.addEventListener('click', () => {
        if (!isCardValid(q, stored)) return;
        _state.currentIdx += 1;
        renderCurrentCard();
    });
}

// ─── 헬퍼 ──────────────────────────────────────────────────
function initResponse(q) {
    return {
        chipBlocks: (q.chipBlocks || []).map(() => ({ selected: [], other: '' })),
        freeTextBlocks: (q.freeTextBlocks || []).map(() => ''),
    };
}

function isCardValid(q, response) {
    // 모든 칩 블록 = 최소 1 선택 또는 기타 입력
    if (q.chipBlocks) {
        for (let i = 0; i < q.chipBlocks.length; i++) {
            const storedBlock = response.chipBlocks[i] || { selected: [], other: '' };
            const hasSelection = storedBlock.selected.length > 0 || storedBlock.other.trim().length > 0;
            if (!hasSelection) return false;
        }
    }
    // 필수 자유 텍스트 = 1자 이상
    if (q.freeTextBlocks) {
        for (let i = 0; i < q.freeTextBlocks.length; i++) {
            const ft = q.freeTextBlocks[i];
            if (ft.required) {
                const value = response.freeTextBlocks[i] || '';
                if (value.trim().length === 0) return false;
            }
        }
    }
    return true;
}

function updateNextButton(q) {
    const stored = _state.responses[q.id];
    const nextBtn = document.querySelector('.presurvey-btn-next');
    if (!nextBtn) return;
    nextBtn.disabled = !isCardValid(q, stored);
}

function updateStepperDots(currentStep) {
    document.querySelectorAll('#presurvey-stepper .onboarding-step-dot').forEach(el => {
        const n = parseInt(el.dataset.step, 10);
        el.classList.toggle('active', n === currentStep);
        el.classList.toggle('done', n < currentStep);
    });
}

function closeForm() {
    if (!_backdropEl) return;
    if (_escHandler) {
        document.removeEventListener('keydown', _escHandler);
        _escHandler = null;
    }
    _backdropEl.remove();
    _backdropEl = null;
    _state = null;
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
    return escapeHtml(str);
}
