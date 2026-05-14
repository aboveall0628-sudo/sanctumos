/**
 * ageTones.js — 나이대 어체 카피 3세트 (단일 출처)
 *
 * (본인 프로필 재기획 트랙 2026-05-14 S-D)
 *
 * 합의:
 *  - Q5 (2026-05-14): 어체 3단 — 청년·중년·노년
 *  - 사용자 명시: "코드 안에 카피 3세트 고정" (정적, LLM 의존 X — 첫 경험은 빨라야)
 *  - "잘못된 나이 입력 시 사용자 직접 조정 옵션" 후속 (S-E 또는 설정 트랙)
 *
 * 나이 경계 (1차 합의 — 베타 후 피드백으로 조정 가능):
 *  - 청년: ~35
 *  - 중년: 36 ~ 60
 *  - 노년: 61 ~
 *
 * R3 (빠르고 정확) 결: 톤은 부드럽고 짧고 정중. 강요·반말·과한 친근감 모두 X.
 *
 * 사용처:
 *  - 온보딩 모달 — 도트 시연 안내, 첫 묵상 권유
 *  - "오늘의 시작" 카드 — 시간대 인사
 *  - 미션 안내 모달 — unlockCopy 보조 톤 (후속)
 *  - LLM 시스템 프롬프트에 ageTone 메타로 전달 (후속, 2차 확장)
 */

export const AGE_TONES = {
    young: {  // ~35
        id: 'young',
        label: '청년',
        bounds: { min: 0, max: 35 },
        // 도트 시연 안내 — R17 결: 도트 3개 입력 끝, 첫 진짜 도트 진입 직전
        dotDemoLead: (nicknameOrName) =>
            `${nicknameOrName}님, 이렇게 매일 작은 점들로 하루를 적어볼 거예요.`,
        // 첫 진짜 도트 권유
        firstDotInvite: '오늘 하루는 어땠어요?',
        // 큐티 수준 분기 안내
        cutiPrompt: '평소 성경 묵상은 어떻게 하시나요?',
        // 온보딩 환영 (모달 첫 카드 위)
        welcomeGreeting: '환영해요!',
        welcomeSub: '몇 가지만 빠르게 알려주시면 시작할 수 있어요.',
        // 시간대 인사 (대시보드·오늘의 시작용)
        morningGreeting: (n) => `${n}님, 좋은 아침이에요`,
        afternoonGreeting: (n) => `${n}님, 오후도 평안하세요`,
        eveningGreeting: (n) => `${n}님, 오늘 하루 수고하셨어요`,
    },

    middle: {  // 36 ~ 60
        id: 'middle',
        label: '중년',
        bounds: { min: 36, max: 60 },
        dotDemoLead: (nicknameOrName) =>
            `${nicknameOrName}님, 매일 하루를 작은 흔적으로 남겨 갑니다.`,
        firstDotInvite: '오늘 하루는 어떠셨습니까?',
        cutiPrompt: '말씀 묵상은 평소 어떻게 하고 계신가요?',
        welcomeGreeting: '잘 오셨습니다.',
        welcomeSub: '시작 전에 몇 가지만 알려주시면 됩니다.',
        morningGreeting: (n) => `${n}님, 평안한 아침입니다`,
        afternoonGreeting: (n) => `${n}님, 오후 시간 어떠신가요`,
        eveningGreeting: (n) => `${n}님, 오늘 하루 평안히 마치시기를`,
    },

    senior: {  // 61 ~
        id: 'senior',
        label: '노년',
        bounds: { min: 61, max: 999 },
        dotDemoLead: (nicknameOrName) =>
            `${nicknameOrName}님, 매일의 자취를 작은 점들로 차곡차곡 남겨 갑니다.`,
        firstDotInvite: '오늘 하루는 어떠하셨습니까?',
        cutiPrompt: '평소 말씀을 어떻게 묵상해 오셨습니까?',
        welcomeGreeting: '귀하신 발걸음, 환영합니다.',
        welcomeSub: '먼저 몇 가지만 여쭤 보겠습니다.',
        morningGreeting: (n) => `${n}님, 평안한 아침 맞이하시기를`,
        afternoonGreeting: (n) => `${n}님, 오후도 평안하시기를`,
        eveningGreeting: (n) => `${n}님, 하루 마무리 평안하시기를`,
    }
};

/**
 * 'YYYY-MM-DD' 또는 'YYYY' birthday → 나이 산출.
 *   잘못된 입력·미입력 시 null 반환.
 */
export function ageFromBirthday(birthday) {
    if (!birthday) return null;
    const m = String(birthday).match(/^(\d{4})/);
    if (!m) return null;
    const birthYear = parseInt(m[1], 10);
    if (!birthYear || birthYear < 1900 || birthYear > 2100) return null;
    const now = new Date();
    let age = now.getFullYear() - birthYear;
    // 월·일 까지 있으면 생일 안 지난 경우 -1
    const md = String(birthday).match(/^\d{4}-(\d{2})-(\d{2})/);
    if (md) {
        const birthMonth = parseInt(md[1], 10);
        const birthDay = parseInt(md[2], 10);
        const nowMonth = now.getMonth() + 1;
        const nowDay = now.getDate();
        if (nowMonth < birthMonth || (nowMonth === birthMonth && nowDay < birthDay)) {
            age -= 1;
        }
    }
    return age;
}

/**
 * 나이 → tone id ('young' | 'middle' | 'senior').
 *   age null/0 일 때 'young' 디폴트 (가장 가벼운 톤).
 */
export function toneIdFromAge(age) {
    if (age == null || age < 0) return 'young';
    if (age <= AGE_TONES.young.bounds.max) return 'young';
    if (age <= AGE_TONES.middle.bounds.max) return 'middle';
    return 'senior';
}

/**
 * birthday 한 줄 → tone 객체 직접 반환 (헬퍼).
 */
export function toneFromBirthday(birthday) {
    return AGE_TONES[toneIdFromAge(ageFromBirthday(birthday))];
}
