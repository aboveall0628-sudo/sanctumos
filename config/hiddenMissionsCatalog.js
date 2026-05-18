/**
 * hiddenMissionsCatalog.js — 히든 미션·이스터에그 트랙 v1 카탈로그
 *
 * (히든 미션 트랙 2026-05-15 — Rule 9 3 라운드 13건 합의 완료)
 *
 * 정체성:
 *   베타 코호트 + 14일 튜토리얼 미션 100% 클리어한 졸업생만 발견하는 만렙 시스템.
 *   정식 사용자한텐 시스템 자체 없음 (영구 차별점).
 *
 * 전체 흐름 (시간 순서):
 *   Day 14 100% 클리어 → 졸업식 → SWAN 사후 설문(전원) → ✨ 안내
 *     → 다음 날 묵상 후 HM-1 발현 → 클리어 → ✨ 다음 안내 → 다다음 묵상 후 HM-2 → ... HM-5
 *
 * 1차 베타 시점:
 *   HM-1 만 status='active'. HM-2~5 는 status='deferred' (UI 안 보임).
 *   HM-1 반응 받은 뒤 v2 에서 단계 확장 (책상 결정 금지 피드백 정합).
 *
 * 보상 시점 분기 (F (c) 정책):
 *   1차 베타 = 정체성·콘텐츠만 (뱃지·잠금해제). 영구 혜택(무료 이용권 등)은 정식 출시 후 활성.
 *   1차 베타엔 "미래 약속" 카드로만 표시.
 *
 * 발현 시점 (G (3) 결정):
 *   meditation_completed 이벤트 hook → 다음 묵상 후 자연 발현.
 *   "하루를 보내고 말씀을 다시 묵상한 사람한테만 다음 자리가 열려요" 결.
 *
 * 데이터 수집 윤리 (I (1)):
 *   - 소스 메타 자동 마킹: source='hidden_mission_hm-01' 자동 자리.
 *   - 익명 응답 토글: anonymousResponse=true 면 testerId 해시화.
 *   - 1차 베타 종료 후 수동 라벨링 (genuine | reward_motivated | mixed).
 *
 * 의존성:
 *   - persons.plaintext.hiddenMissionUnlocked·hiddenMissionsCleared (encryptionPolicy.js)
 *   - persons.encrypted.hiddenMissionAnswers (encryptionPolicy.js)
 *   - hiddenMissionsRepo.checkUnlock, submitHiddenMission (data/)
 *   - ui/hiddenMission.js 모달
 *   - ui/settings.js ✨ 진입 카드
 *
 * 미루기:
 *   - 7. 졸업식 → 히든 미션 연결 회로 (SWAN 트랙 A 의 cohortId·사후 설문 완료 hook 자리잡힌 뒤)
 *   - 8. functions/llmProxy task: hiddenMissionExtract (자유 응답 자동 구조화, 베타 후 결정)
 */

export const HIDDEN_MISSIONS = {
    'hm-01': {
        id: 'hm-01',
        order: 1,
        icon: '🌱',
        title: '베타 개척자의 한 마디 — 다음 사람을 위해',
        // 1차 베타 활성. HM-1 반응 보고 HM-2~5 단계 확장.
        status: 'active',
        // 카테고리: 'survey' | 'interview' | 'content' | 'meditation' | 'invite'
        category: 'survey',
        // 잠금해제 조건 — checkUnlock 헬퍼가 모두 만족 여부 확인.
        unlockCondition: {
            cohort: 'beta_v1',                   // 베타 코호트 (SWAN 트랙 A 진입 후 활성)
            requiresAllMissionsClear: true,       // missionStatus 7 모듈 전부 'completed'
            requiresPostSurveyComplete: true,     // 사후 설문 완료 후 발현 (SWAN 트랙 A)
            prerequisiteHiddenMission: null,      // 첫 미션이라 선행 X
        },
        // 발현 트리거 — 잠금해제된 뒤 어떤 시점에 카드 노출되는가.
        triggerEvent: 'meditation_completed',
        // 첫 발현 안내 카드 — 사후 설문 완료 직후 노출 (G 결정).
        unlockAnnounceCard: {
            title: '✨ 히든 미션이 열렸어요',
            body: '당신은 100% 클리어한 졸업자예요. 내일 묵상 끝낼 때쯤 ✨ 표시를 보세요. 다음 사람을 위한 한 마디를 남기는 자리예요.',
            cta: '알겠어요',
        },
        // 본문 — 사용자가 다음 묵상 완료 후 만나는 카드.
        intro: {
            headline: '🌱 베타 개척자의 한 마디 — 다음 사람을 위해',
            subtitle: '14일 함께해주셔서 감사해요.',
            body: '곧 들어올 친구한테 어떤 점 알려주고 싶으세요? 짧게 한 줄도 좋고, 길게 풀어내셔도 좋아요.',
        },
        // 자유 응답 질문 — 회고·간증 톤 (K1 (2) 결정).
        questions: [
            {
                id: 'q1_memorable_moment',
                label: '14일 동안 가장 마음에 남는 순간 하나만 떠올려본다면?',
                placeholder: '한 줄도 좋고, 편지처럼 길게도 좋아요',
                type: 'longtext',
                required: false,
            },
            {
                id: 'q2_one_line_recommend',
                label: '이 앱을 한 줄로 친구한테 설명한다면 어떻게 말할 거예요?',
                placeholder: '예: "묵상이 하루로 이어지더라"',
                type: 'longtext',
                required: false,
            },
            {
                id: 'q3_community_value',
                label: '공동체·소그룹에서 같이 써본다면 어떤 자리에 쓰고 싶어요?',
                placeholder: '예배 준비, 소그룹 나눔, 새가족 교육 등 자유롭게',
                type: 'longtext',
                required: false,
            },
        ],
        // 공개·비공개 토글 (K (B) 결정) — 1차 베타엔 저장만, 노출은 정식 출시 후.
        sharingOption: {
            enabled: true,
            consentLabel: '이 답변을 다음에 들어올 사용자한테 보여주기 OK',
            displayNameOptions: [
                { value: 'real', label: '내 이름으로' },
                { value: 'nickname', label: '별명으로' },
                { value: 'anonymous', label: '익명으로' },
            ],
            note: '정식 출시 후 "베타 개척자들의 한 마디" 자리에 노출돼요. 1차 베타엔 저장만 해두고 노출 시점에 다시 알려드릴게요.',
        },
        // 익명 토글 (I (1) 결정) — 공개 동의와 별개로 분석 시 신원 분리 옵션.
        anonymousOption: {
            enabled: true,
            // (디자인 시스템 v1 §31 2026-05-16) 카피 안 아이콘 제거 + 짧은 라벨.
            label: '익명으로 답하기',
            description: '답변은 풀에 합쳐지지만 누가 적었는지 분리돼요. 솔직한 답 안전망이에요.',
        },
        // 보상 시점 분기 (F (c) 결정).
        rewardTier: {
            betaImmediate: {
                badge: '베타 개척자 — 길 닦은 사람',
                badgeIcon: '🌱',
                copy: '다음 사람을 위해 길을 닦아주셨어요.',
            },
            postLaunchActivated: {
                feature: '베타 개척자들의 한 마디 자리 노출 (공개 동의한 사람만)',
                copy: '정식 출시 후 다음 사용자한테 당신의 한 마디가 닿아요.',
            },
        },
        // 클리어 후 안내 카드 — 다음 미션 알림 (G 결정).
        afterClearCard: {
            title: '✨ 다음 발견이 있어요',
            body: '내일 묵상 끝낼 때쯤 다시 ✨ 표시를 보세요. 다음 자리가 기다리고 있어요.',
            cta: '알겠어요',
        },
        estimatedMinutes: 10,
    },

    // ─── HM-2~5: 1차 베타엔 deferred. HM-1 반응 받고 v2 활성 결정. ───

    'hm-02': {
        id: 'hm-02',
        order: 2,
        icon: '🎤',
        title: '개발자 인터뷰 자발 신청',
        status: 'deferred',
        category: 'interview',
        unlockCondition: {
            cohort: 'beta_v1',
            requiresAllMissionsClear: true,
            requiresPostSurveyComplete: true,
            prerequisiteHiddenMission: 'hm-01',
        },
        triggerEvent: 'meditation_completed',
        intro: {
            headline: '🎤 개발자 인터뷰 자발 신청',
            subtitle: '30분, 줌이나 전화로 편하게',
            body: '이 앱 만든 사람이 직접 듣고 싶어요. 시간 후보를 골라주시면 일정 잡아드려요.',
        },
        questions: [
            {
                id: 'q1_preferred_slots',
                label: '편한 시간대 후보 3개 (자유 형식)',
                placeholder: '예: 평일 저녁 / 토요일 오전',
                type: 'longtext',
            },
            {
                id: 'q2_channel',
                label: '줌·전화 중 어느 쪽이 편하세요?',
                type: 'choice',
                options: ['줌', '전화', '상관없음'],
            },
            {
                id: 'q3_memo',
                label: '미리 알려두고 싶은 거 있어요? (선택)',
                placeholder: '예: 특정 기능 깊이 얘기하고 싶음',
                type: 'longtext',
                required: false,
            },
        ],
        sharingOption: { enabled: false },
        anonymousOption: { enabled: false },
        rewardTier: {
            betaImmediate: {
                badge: '1:1 동행 친구',
                badgeIcon: '🎤',
                copy: '직접 만나서 얘기 나누는 사이가 됐어요.',
            },
            postLaunchActivated: {
                feature: '영구 무료 이용권',
                copy: '정식 출시 후 본인 계정에 영구 무료 이용권이 자리잡혀요.',
            },
        },
        afterClearCard: {
            title: '✨ 다음 발견이 있어요',
            body: '내일 묵상 끝낼 때쯤 다시 ✨ 표시를 보세요.',
            cta: '알겠어요',
        },
        estimatedMinutes: 5,
    },

    'hm-03': {
        id: 'hm-03',
        order: 3,
        icon: '📖',
        title: '개발자 간증 — 이 앱이 시작된 자리',
        status: 'deferred',
        category: 'content',
        unlockCondition: {
            cohort: 'beta_v1',
            requiresAllMissionsClear: true,
            requiresPostSurveyComplete: true,
            prerequisiteHiddenMission: 'hm-02',
        },
        triggerEvent: 'meditation_completed',
        intro: {
            headline: '📖 개발자 간증 — 이 앱이 시작된 자리',
            subtitle: '베타 개척자만 읽을 수 있는 자리',
            body: '이 앱이 어떻게 시작됐는지, 어떤 묵상이 어떤 기능을 낳았는지, 당신께 직접 쓴 편지예요.',
        },
        // 본문은 콘텐츠 잠금해제 — 별도 콘텐츠 파일 또는 Firestore 문서 참조.
        contentRef: 'devblog/genesis_letter_v1',
        questions: [],
        sharingOption: { enabled: false },
        anonymousOption: { enabled: false },
        rewardTier: {
            betaImmediate: {
                badge: null,
                badgeIcon: '📖',
                copy: '읽기 자체가 보상이에요. "걸어다니는 성경" 정체성을 함께 나눠요.',
            },
            postLaunchActivated: null,
        },
        afterClearCard: {
            title: '✨ 다음 발견이 있어요',
            body: '내일 묵상 끝낼 때쯤 다시 ✨ 표시를 보세요.',
            cta: '알겠어요',
        },
        estimatedMinutes: 8,
    },

    'hm-04': {
        id: 'hm-04',
        order: 4,
        icon: '🕊️',
        title: '베타 개척자 전용 7일 묵상 시리즈',
        status: 'deferred',
        category: 'meditation',
        unlockCondition: {
            cohort: 'beta_v1',
            requiresAllMissionsClear: true,
            requiresPostSurveyComplete: true,
            prerequisiteHiddenMission: 'hm-03',
        },
        triggerEvent: 'meditation_completed',
        intro: {
            headline: '🕊️ 베타 개척자 전용 7일 묵상 시리즈',
            subtitle: '"광야의 길 닦는 사람" 7일 트랙',
            body: '일반 묵상 카탈로그엔 없는 본문·기도문이에요. 7일 동안 천천히 함께해요.',
        },
        contentRef: 'meditation_tracks/pioneer_7day_v1',
        questions: [],
        sharingOption: { enabled: false },
        anonymousOption: { enabled: false },
        rewardTier: {
            betaImmediate: {
                badge: '광야의 길 닦는 사람',
                badgeIcon: '🕊️',
                copy: '특별 묵상 트랙이 영구 잠금해제됐어요.',
            },
            postLaunchActivated: null,
        },
        afterClearCard: {
            title: '✨ 마지막 발견이 있어요',
            body: '내일 묵상 끝낼 때쯤 다시 ✨ 표시를 보세요. 퀘스트 체인의 종착이에요.',
            cta: '알겠어요',
        },
        estimatedMinutes: 7 * 10, // 7일 × 약 10분
    },

    'hm-05': {
        id: 'hm-05',
        order: 5,
        icon: '🤝',
        title: '친구 한 명 초대 — 2차 베타 시드',
        status: 'deferred',
        category: 'invite',
        unlockCondition: {
            cohort: 'beta_v1',
            requiresAllMissionsClear: true,
            requiresPostSurveyComplete: true,
            prerequisiteHiddenMission: 'hm-04',
        },
        triggerEvent: 'meditation_completed',
        intro: {
            headline: '🤝 친구 한 명 초대 — 다음 길을 함께',
            subtitle: '2차 베타 초대 코드 1장',
            body: '당신이 닦은 길 위에 함께 걸을 친구 한 명을 초대해주세요. 본인이 직접 추천하는 자리예요.',
        },
        questions: [
            {
                id: 'q1_invitee_name',
                label: '초대할 친구 이름 (별명도 OK)',
                placeholder: '예: 영희, 영희야 등',
                type: 'text',
            },
            {
                id: 'q2_invite_message',
                label: '친구한테 한 마디 (초대 메시지)',
                placeholder: '예: 14일 해보니까 ___ 이래서, 너도 한 번 해볼래?',
                type: 'longtext',
            },
            {
                id: 'q3_recommend_reason',
                label: '왜 이 친구한테 추천하고 싶었어요? (선택)',
                placeholder: '예: 분별이 필요한 시기라서',
                type: 'longtext',
                required: false,
            },
        ],
        sharingOption: { enabled: false },
        anonymousOption: { enabled: false },
        rewardTier: {
            betaImmediate: {
                badge: '공동체 시드',
                badgeIcon: '🤝',
                copy: '다음 베타의 첫 씨앗이 됐어요.',
                permanentNickname: '공동체 시드',
            },
            postLaunchActivated: {
                feature: '추가 무료 이용권',
                copy: '정식 출시 후 본인 계정에 추가 무료 이용권이 자리잡혀요.',
            },
        },
        afterClearCard: {
            title: '🎉 퀘스트 체인 완주',
            body: '5건 모두 함께해주셔서 감사해요. 정식 출시 때 다시 만나요.',
            cta: '여정 마무리',
        },
        estimatedMinutes: 10,
    },
};

/**
 * 활성 히든 미션 ID 배열 (status='active' 만).
 *   1차 베타엔 ['hm-01'] 만 반환.
 *   UI 노출·다음 미션 발현 회로에서 사용.
 */
export function getActiveHiddenMissionIds() {
    return Object.entries(HIDDEN_MISSIONS)
        .filter(([_, m]) => m.status === 'active')
        .sort((a, b) => a[1].order - b[1].order)
        .map(([id]) => id);
}

/**
 * 다음 발현 후보 — 현재 클리어된 미션 다음 순서의 active 미션.
 *   예: cleared=['hm-01'] → 다음 후보 'hm-02' (단 status='deferred' 면 null 반환).
 *   메시지: "다음 발견이 있어요" 안내를 보낼지 결정.
 */
export function getNextHiddenMission(clearedIds = []) {
    const allIds = Object.keys(HIDDEN_MISSIONS).sort((a, b) =>
        HIDDEN_MISSIONS[a].order - HIDDEN_MISSIONS[b].order
    );
    for (const id of allIds) {
        if (clearedIds.includes(id)) continue;
        const m = HIDDEN_MISSIONS[id];
        if (m.status !== 'active') return null; // deferred 만나면 체인 종료
        // 선행 미션이 클리어돼야 다음 발현
        if (m.unlockCondition.prerequisiteHiddenMission &&
            !clearedIds.includes(m.unlockCondition.prerequisiteHiddenMission)) {
            return null;
        }
        return m;
    }
    return null;
}

/**
 * 특정 히든 미션 조회 헬퍼.
 */
export function getHiddenMission(missionId) {
    return HIDDEN_MISSIONS[missionId] || null;
}

/**
 * 1차 베타 시점 활성 카탈로그 — 1건 (HM-1) 만 노출.
 *   v2 에서 HM-2~5 단계 활성 시 자동 확장.
 */
export function getActiveCount() {
    return getActiveHiddenMissionIds().length;
}
