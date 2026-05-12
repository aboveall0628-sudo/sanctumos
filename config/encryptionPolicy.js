/**
 * encryptionPolicy.js — 데이터 컬렉션별 등급 및 필드 정책
 *
 * 이 정책은 v2 앱 전역에서 참조되며, 어떤 필드가 암호화되어야 하는지 명시합니다.
 * 평문 필드(plaintext)는 Firestore 인덱싱 및 쿼리 용도로만 사용해야 합니다.
 */

export const POLICY = {
    dots: {
        plaintext: [
            'id', 'userId', 'date', 'timeSlot', 'durationSlots',
            'executionSatisfaction',
            'outcomeSatisfaction', 'executed', 'labelIds',
            'amountBucket', 'sentimentBucket', 'createdAt',
            // 활동 카테고리 (2026-05-12) — 시간 분석용 큰 분류. id만 평문, 라벨/아이콘은 클라이언트에서 메타 매핑.
            'category'
        ],
        encrypted: [
            'plannedTask', 'actualTask', 'reason', 'notes',
            'linkedScriptureId', 'linkedPrincipleIds', 'linkedGoalId',
            'linkedTransactionIds', 'linkedPersonIds', 'linkedOrgIds',
            // 도트별 인물/조직 만족도 ({ personId: 1-5 }, { orgId: 1-5 })
            'personRatings', 'orgRatings'
        ]
    },
    meditations: {
        plaintext: ['id', 'userId', 'date', 'scriptureRef', 'createdAt'],
        encrypted: ['content', 'decisions', 'prayer']
    },
    // memos: v1 빌드의 묵상 컬렉션. meditations와 동일 구조로 마이그레이션됨.
    memos: {
        plaintext: ['id', 'userId', 'date', 'scriptureRef', 'createdAt'],
        encrypted: ['content', 'decisions', 'prayer']
    },
    principles: {
        plaintext: ['id', 'userId', 'category', 'pinned', 'active', 'createdAt', 'updatedAt'],
        encrypted: ['title', 'body', 'triggerKeywords', 'derivedFromDotIds']
    },
    goals: {
        plaintext: [
            'id', 'userId', 'period', 'parentGoalId',
            'startDate', 'endDate', 'progress', 'status', 'createdAt',
            // daily 목표를 시간표(오늘 화면)에 박을 수 있도록 시간 슬롯 필드 추가.
            // 기존 decisions 모델을 그대로 흡수 — daily 외 period 에선 항상 null.
            'timeSlot', 'durationSlots', 'placedAt', 'gcalEventId', 'order'
        ],
        encrypted: ['title', 'description', 'notes', 'scriptureRef']
    },
    // ───────── v3 Reports 모듈 (5계층 진단 전용) ─────────
    // docs/reports-spec.md + docs/reports-tone-guide.md 기준
    // - stats는 평문 (인덱싱·쿼리 가능, 수치 계산은 코드가 담당)
    // - AI 산문·관찰·가설·묵상 질문은 모두 암호화 (개인적 진단 내용)
    // - keyPatterns/suggestedPrinciples는 v2 호환 유지 — 새 코드는 사용 X
    dayReports: {
        plaintext: ['id', 'userId', 'period', 'startDate', 'endDate', 'stats', 'drillDownChildIds', 'createdAt'],
        encrypted: [
            'aiSummary',                 // AI 산문 (그림자의 윤곽)
            'observations',              // 일간 관찰 1개 (가설 아님)
            'questionsForMeditation',    // 묵상에 가져갈 질문 1~2개
            'userNotes',
            // v2 호환 (deprecated — 새 코드는 사용 X):
            'keyPatterns', 'suggestedPrinciples'
        ]
    },
    weekReports: {
        plaintext: ['id', 'userId', 'period', 'startDate', 'endDate', 'stats', 'drillDownChildIds', 'createdAt'],
        encrypted: [
            'aiSummary',
            'hypotheses',                // 가설 2~3개 (반복 횟수 표기 필수)
            'decisionFlow',              // A3 — 결단의 흐름 추상화 (라벨 명시 X)
            'questionsForMeditation',    // 묵상 질문 3개
            'userNotes',
            'keyPatterns', 'suggestedPrinciples'
        ]
    },
    monthReports: {
        plaintext: ['id', 'userId', 'period', 'startDate', 'endDate', 'stats', 'drillDownChildIds', 'createdAt'],
        encrypted: [
            'aiSummary',
            'hypotheses',                // 가설 3~5개 (2주+ 반복)
            'patternsObserved',          // A1 — 이번 달 자주 관찰된 패턴 N개 (도트 ID 노출 X)
            'decisionFlow',
            'questionsForMeditation',    // 묵상 질문 4~5개
            'userNotes',
            'keyPatterns', 'suggestedPrinciples'
        ]
    },
    quarterReports: {
        plaintext: ['id', 'userId', 'period', 'startDate', 'endDate', 'stats', 'drillDownChildIds', 'createdAt'],
        encrypted: [
            'aiSummary',
            'hypotheses',                // 가설 5~7개 (3개월 일관성)
            'decisionFlow',
            'principleValidation',       // 분기 검증 결과 (promote/archive)
            'questionsForMeditation',
            'userNotes',
            'keyPatterns', 'suggestedPrinciples'
        ]
    },
    yearReports: {
        plaintext: ['id', 'userId', 'period', 'startDate', 'endDate', 'stats', 'drillDownChildIds', 'createdAt'],
        encrypted: [
            'aiSummary',
            'hypotheses',                // 가설 7~10개 (4분기 일관성, 원칙급)
            'decisionFlow',
            'principleValidation',       // 연간 원칙 정착/archive 일괄
            'questionsForMeditation',    // 묵상 질문 5개
            'userNotes',
            'keyPatterns', 'suggestedPrinciples'
        ]
    },
    // 리포트 Q&A 응답 누적 (A3 확장)
    // 사용자가 리포트에 "왜 X였어?"를 물으면 AI 흐름 응답을 여기 저장
    // 다음 묵상 화면에 자동 노출
    reportQuestions: {
        plaintext: ['id', 'userId', 'reportId', 'reportType', 'askedAt', 'createdAt'],
        encrypted: ['question', 'observationFlow', 'returnToMeditation']
    },
    // 통독 진행률: 챕터/날짜는 평문(통계 가능), 메모만 암호화
    bibleProgress: {
        plaintext: ['id', 'userId', 'partId', 'chapterIndex', 'date', 'completed', 'createdAt'],
        encrypted: ['note', 'highlightVerseIds']
    },
    // 알람·메모 (Phase E-7) — 상단 종 아이콘 패널
    // type/read/dueDate 평문(필터·정렬·뱃지 카운트), 내용·targetParams 만 암호화
    reminders: {
        plaintext: [
            'id', 'userId', 'type', 'read', 'dueDate', 'targetView',
            'createdAt', 'readAt'
        ],
        encrypted: ['title', 'body', 'targetParams']
    },
    // 결단: 시간 슬롯/배치 상태는 평문(타임라인 그리드 계산), 본문/링크는 암호화
    decisions: {
        plaintext: ['id', 'userId', 'date', 'timeSlot', 'durationSlots', 'placedAt', 'order', 'createdAt', 'gcalEventId'],
        encrypted: ['text', 'linkedScriptureId', 'linkedGoalId', 'linkedPrincipleId']
    },

    // ═══════════════════════════════════════════════════════════════
    //  v3.0 신규 — 사용자 서브컬렉션(users/{uid}/<col>) 으로 저장됨
    //  영적 안전장치: docs/future-modules.md 참조 (인물 라벨링 금지 등)
    // ═══════════════════════════════════════════════════════════════

    // ── 인물·조직 모듈 ──
    persons: {
        plaintext: [
            'id', 'relation', 'innerCircle', 'stance', 'isPinned', 'isFallback',
            'lastInteractionAt', 'createdAt', 'updatedAt'
        ],
        encrypted: [
            'name', 'nicknames', 'avatarUrl',
            'bigFive',          // {O,C,E,A,N} 0-100, 노출 시 비교/라벨링 위험으로 암호화
            'competencies',     // {analysis, ...} 0-100
            'relationship',     // {closeness, trust, friendliness, importance} 1-5
            'stanceHistory',    // [{from, to, changedAt, reason, prayerDone}]
            'meaningfulVerse',  // 이 사람을 위한 말씀
            'knownFacts', 'sensitivities',
            'notes', 'strengths', 'tendencies',
            // 친한 사람 한정 기념일/생일 — 사적 정보로 암호화
            'birthday', 'anniversaries',
            // (v3 2026-05-12) 첫 평가 1회 보존 — 첫인상 비교용
            'firstImpression'
        ]
    },
    organizations: {
        plaintext: [
            'id', 'type', 'stance', 'friendliness', 'trust', 'importance', 'riskLevel',
            'createdAt', 'updatedAt'
        ],
        encrypted: [
            'name', 'memberPersonIds', 'meaningfulVerse', 'notes', 'stanceHistory',
            'foundedDate', 'anniversaries',
            'firstImpression' // (v3 2026-05-12) 첫 평가 1회 보존
        ]
    },
    interactions: {
        plaintext: ['id', 'dotId', 'date', 'sentiment', 'createdAt'],
        encrypted: ['personIds', 'orgIds', 'summary', 'moves', 'feelings', 'lessons', 'factsLearned']
    },

    // ── 경제 모듈 ──
    accounts: {
        plaintext: ['id', 'type', 'currency', 'isPrimary', 'createdAt'],
        encrypted: ['name', 'institution']
    },
    assetCategories: {
        plaintext: ['id', 'kind', 'createdAt'],
        encrypted: ['name']
    },
    assets: {
        plaintext: ['id', 'categoryId', 'currentValueBucket', 'lastValuationAt', 'createdAt'],
        encrypted: ['label', 'details', 'exactValue']
    },
    liabilities: {
        plaintext: ['id', 'type', 'principalBucket', 'createdAt'],
        encrypted: ['details', 'interestRate', 'exactPrincipal']
    },
    transactions: {
        plaintext: [
            'id', 'date', 'direction', 'amountBucket',
            'category', 'subCategory', 'incomeType', 'expenseType',
            'createdAt'
        ],
        encrypted: [
            'exactAmount', 'description', 'accountId',
            'linkedAssetId', 'linkedLiabilityId',
            'linkedDotId', 'linkedPersonIds', 'linkedOrgIds'
        ]
    },
    cashflowSnapshots: {
        plaintext: ['id', 'month', 'savingsRate', 'passiveRatio', 'createdAt'],
        encrypted: ['totalsExact', 'breakdownExact', 'aiInsights']
    },
    netWorthSnapshots: {
        plaintext: ['id', 'month', 'netWorthBucket', 'createdAt'],
        encrypted: ['totalsExact', 'breakdownExact']
    },

    // ── 영적 잠금 모듈 ──
    spiritualTokens: {
        plaintext: [
            'id', 'issuedAt', 'mode', 'wordPassageRef',
            'eveningClosed', 'eveningClosedAt', 'nextDayPrep', 'nextDayPassageRef',
            'createdAt'
        ],
        encrypted: ['meditationNote', 'prayerNote', 'oneLineToGod', 'nextDayDecisions']
    },
    retreatSessions: {
        plaintext: [
            'id', 'type', 'startDate', 'endDate', 'dailyLockMode',
            'autoCloseEvening', 'createdAt', 'closedAt'
        ],
        encrypted: ['location', 'purpose', 'reflectionPayload']
    },

    // ── 단일 문서 설정 ──
    // settings/{docName} 패턴으로 사용. 키는 'spiritualLock' 등.
    spiritualLockSettings: {
        plaintext: [
            'id', 'morningSlotTime', 'morningSlotDuration',
            'eveningSlotTime', 'eveningSlotDuration', 'eveningCutoffHour',
            'skipQuotaPerDay', 'sabbathDates', 'sabbathQuotaPerMonth',
            'alarmEnabled', 'minimumMeditationLength', 'streakVisible',
            'updatedAt'
        ],
        encrypted: []
    },
};

/**
 * 컬렉션 path → 정책 키 추출
 * 예) 'users/abc/persons' → 'persons'
 *     'users/abc/settings/spiritualLock' → 'spiritualLockSettings'
 *     'goals' → 'goals'
 */
export function policyKeyFromPath(path) {
    if (!path) return null;
    const parts = path.split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    // settings/{docName} 같은 단일 문서 패턴 처리
    if (parts.length >= 2 && parts[parts.length - 2] === 'settings') {
        return `${last}Settings`; // 'spiritualLock' → 'spiritualLockSettings'
    }
    return last;
}
