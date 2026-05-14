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
            // (경제 트랙 1.a 2026-05-14) 도트 종류 — 'schedule'(일정, 디폴트) | 'event'(점 도트).
            //   schedule: 시간 구간(timeSlot·durationSlots) + 평가. event: 한 시점(eventTimestamp), 거래·말·자동결제.
            //   기존 도트는 모두 schedule 디폴트(saveDot 안에서 자동 박힘).
            'kind',
            // (경제 트랙 1.a) 이벤트 도트 시점 — ISO 'YYYY-MM-DDTHH:mm:ss'. schedule 도트는 null. 같은 날 시간순 정렬 키.
            'eventTimestamp',
            // 활동 카테고리 (2026-05-12) — 시간 분석용 큰 분류. id만 평문, 라벨/아이콘은 클라이언트에서 메타 매핑.
            'category',
            // (워크플로우 트랙 2026-05-13) 실행자 3구분 — self|helper|external.
            // 평문: 통계·집계용 (예: "이번 주 self가 직접 처리한 비율"). 인물 식별은 helperPersonId(암호화).
            'executor',
            // (워크플로우 트랙 2026-05-13) 도트의 출처 메타. 우선순위 2 정직성 인프라의 새 필드 적용.
            // self_report|calendar_sync|device|helper_input|ai_inferred
            'source'
        ],
        encrypted: [
            'plannedTask', 'actualTask', 'reason', 'notes',
            'linkedScriptureId', 'linkedPrincipleIds', 'linkedGoalId',
            'linkedTransactionIds', 'linkedPersonIds', 'linkedOrgIds',
            // (경제 트랙 1.a 2026-05-14) 이벤트 도트(kind='event') 전용 payload.
            //   eventType: 'transaction'(거래) | 'speech'(누가 한 말) | 'other'. 미래 확장 가능.
            //   eventNote: 자유 텍스트 메모. eventType별 디테일은 linked* 필드로 연결.
            'eventType', 'eventNote',
            // 도트별 인물/조직 만족도 ({ personId: 1-5 }, { orgId: 1-5 })
            'personRatings', 'orgRatings',
            // (워크플로우 트랙 2026-05-13) 어느 워크플로우 스텝에서 분배됐는가
            'linkedWorkflowStepId',
            // (워크플로우 트랙 2026-05-13) 그 시점 목표 스냅샷 참조 — goalsRepo와 직결
            'goalVersionId',
            // (워크플로우 트랙 2026-05-13) executor=helper 때 인물 카드 ID
            'helperPersonId'
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
        plaintext: [
            'id', 'userId', 'category', 'pinned', 'active', 'createdAt', 'updatedAt',
            // (B-1 트랙 2026-05-13) 원칙 강도. UI 라벨: "핵심/주요/참고" (config/principleEnums.js)
            'strength',
            // (B-1) 원칙 의미축 출처: user_value | scripture | book | ai_drafted_user_confirmed
            // dot.source 와 의미축이 다름 — 도트는 데이터 출처, 원칙은 가치 출처.
            'source',
            // (B-1) 만든 주체. 'user' 또는 'ai_drafted_user_confirmed'
            'createdBy'
        ],
        encrypted: [
            'title', 'body', 'triggerKeywords', 'derivedFromDotIds',
            // (B-1) 적용 조건 자유 텍스트 ("친구가 부탁할 때만" 등)
            'conditions',
            // (B-1) source=scripture/book 일 때 출처 메타
            'scriptureRef', 'bookRef',
            // (B-1) 양방향 인과 가지 — 이 원칙이 적용된 판례 / 도트
            'linkedPrecedentIds', 'linkedDotIds',
            // (B-1) 수정 로그: [{ revisedAt, previousBody, previousStrength, reason, triggeredBy:{type,reference} }]
            'revisionLog'
        ]
    },
    // (B-1 트랙 2026-05-13) 판례 — 의사결정 시스템 핵심.
    // "평가보다 인과" 원칙: evaluation/outcome/satisfaction 필드 없음.
    // 그때 상황 + 그때 결정 + 그 시점 원칙 스냅샷 + 인과 가지(linked*) 만.
    precedents: {
        plaintext: [
            'id', 'userId',
            'decidedAt',                 // 결정 시각 (timestamp)
            'createdAt',
            // 작성 주체: 'user' 또는 'ai_drafted_user_confirmed'
            'source',
            // 묵상 훅 — 결정 전 기도/묵상 함께 했는지 (boolean)
            'prayerLogged'
        ],
        encrypted: [
            'situation',                 // 그때 상황
            'decision',                  // 그때 결정 내용
            'contextNote',               // 자유 메모 (평가 아닌 "그때 그 결")
            'principlesAtTime',          // [{ principleId, strengthAtTime, bodyAtTime }] 시점 스냅샷
            'linkedPrincipleIds',        // 적용된 원칙들 (양방향)
            'linkedDotIds',              // 결정 이후 발생한 도트들 (1차는 빈 배열, 후속 자동 박힘)
            'linkedPrecedentIds',        // 이 판례에서 파생된 후속 판례
            'linkedGoalId',              // 이 결정으로 만들거나 수정한 목표
            'linkedGoalVersionId',       // 그 시점 GoalVersion id (R2 — 도피 행동화 추적 직결)
            'linkedScriptureId',         // 묵상 훅 — 함께 본 말씀
            'revisionLog',               // 판례 본문 수정 시
            // (B-2 트랙 2026-05-13) 소크라테스 대화 — [{ q, a, askedAt, mode }] 시퀀스.
            //   mode: 'question'(AI 질문) | 'opinion'(AI 의견 모드 응답) | 'summary'(정리 단락)
            //   a: 사용자 답변 (mode==='opinion'·'summary' 일 땐 null).
            //   몇 달 뒤 같은 판례 다시 열어보면 당시 사고도 함께 보임 — 자기 인식 자산.
            'socraticDialogue'
        ]
    },
    goals: {
        plaintext: [
            'id', 'userId', 'period', 'parentGoalId',
            'startDate', 'endDate', 'progress', 'status', 'createdAt',
            // daily 목표를 시간표(오늘 화면)에 박을 수 있도록 시간 슬롯 필드 추가.
            // 기존 decisions 모델을 그대로 흡수 — daily 외 period 에선 항상 null.
            'timeSlot', 'durationSlots', 'placedAt', 'gcalEventId', 'order',
            // (워크플로우 트랙 2026-05-13) 자동 버전 트래킹. 변경 감지될 때 ++ 되고 새 GoalVersion 생성.
            // 도트는 자신이 분배될 때의 currentVersion 을 goalVersionId 로 박는다.
            'currentVersion',
            // (워크플로우 트랙 2026-05-13) 출처 메타
            'source'
        ],
        encrypted: ['title', 'description', 'notes', 'scriptureRef']
    },
    // (워크플로우 트랙 2026-05-13) 목표의 시점 스냅샷 — 방법 A (별도 컬렉션 v1/v2/v3)
    // docId = `${goalId}_v${versionNumber}`. 도트의 goalVersionId 가 여길 가리킨다.
    // snapshotData 는 그 시점 목표 객체 전체를 그대로 보존 (압축은 v1 단계에선 안 함).
    goalVersions: {
        plaintext: [
            'id', 'userId', 'goalId', 'versionNumber',
            'validFrom', 'validTo',  // validTo=null 이면 현재 활성 버전
            'source', 'createdAt',
            // (B-1 트랙 2026-05-13) 이 버전을 만든 판례 id. 의사결정 게이트가 채움.
            // 자동 감지/시드 등 게이트 미경유면 null.
            'sourcePrecedentId'
        ],
        encrypted: [
            'snapshotData',          // 그 시점 목표 전체 (title/description/parentGoalId/...)
            'revisionReason'         // (B-1) 의사결정 게이트가 채움. 자동 감지 시엔 빈 값.
        ]
    },
    // (워크플로우 트랙 2026-05-13) 워크플로우 — 목표를 도트로 분해하는 다리
    // steps 는 객체 배열이라 통째로 encrypted (linkedDotIds 도 안에 들어감 — 도트 ID 노출 차단)
    workflows: {
        plaintext: [
            'id', 'userId', 'parentGoalId',
            'goalVersionAtCreate',   // 어떤 버전의 목표에서 만든 워크플로우인가
            'status',                // active | archived
            'source',                // self_report|ai_inferred (합작이라 어느 쪽 초안인지)
            'createdAt', 'updatedAt'
        ],
        encrypted: [
            'title',
            'steps',                 // [{ id, order, title, estimatedDots, executor, status, linkedDotIds }]
            'generatedByDecision',   // 합작 시 AI 초안의 출처 판례
            'revisionLog',           // [{ at, summary, by }]
            'notes'
        ]
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
        // seenAt: 다음 아침 게이트에 노출된 후 mark — plaintext 메타.
        plaintext: ['id', 'userId', 'reportId', 'reportType', 'askedAt', 'seenAt', 'createdAt'],
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
    // (B-4 본인 프로필 트랙 2026-05-13) persons 컬렉션 안에 isSelf=true 카드 1장으로 본인 프로필 흡수.
    //   - 인물 화면(view-persons)은 isSelf 자동 제외, 본인 카드는 별도 화면(view-self-profile).
    //   - 본인 전용 필드(lifeStage·신앙·소명·자기 인식·visibility)는 모두 사적이라 암호화.
    //   - isSelf, lastSelfUpdatedAt 두 개만 평문 — 본인 카드 식별·시점 정렬용.
    //   - 영적 은사 필드는 1차에서 제외, 공동체 모듈 진입 시 재기획 (project_gifts_talents_serving.md).
    persons: {
        plaintext: [
            'id', 'relation', 'innerCircle', 'stance', 'isPinned', 'isFallback',
            'lastInteractionAt', 'createdAt', 'updatedAt',
            // (B-4 본인 프로필 트랙) 본인 카드 식별·필터
            'isSelf',
            // (B-4 본인 프로필 트랙) 본인 프로필 마지막 저장 시점 — 5y/10y 리포트 base 시점 인덱싱용
            'lastSelfUpdatedAt',
            // ─── (본인 프로필 재기획 트랙 2026-05-14 S-A) 평문 메타 ───
            // (R12) 본인 카드 자동 정렬 메타 — 사이드바·리스트에서 본인이 자동 위로 정렬
            //   의사결정·도트가 스테이터스 변화를 감지하면 갱신 (자세한 트리거 회로는 후속)
            'displayOrder',
            // (R17) 큐티 수준 — 'basic'(🌱 기초) | 'intermediate'(🌿 성장) | 'advanced'(🌳 깊이)
            //   Day 0 큐티 수준 분기에서 박힘. localStorage scriptureSettings.cutiLevel 와 양방향 동기화.
            //   기기 동기화 필요 → personRepo.devotionalLevel 이 우선, localStorage 는 캐시·fallback.
            'devotionalLevel',
            // (R18) 미션 진행도 평문 요약 — { person:true, org:false, ... } 모듈별 클리어 표
            //   상세 진행 상태(tutorialState 안)는 암호화. 이 자리는 잠금 가드용 빠른 평문 체크.
            //   사이드바 nav-* 진입 가드에서 한 번 평문 비교로 차단·통과 결정.
            'missionStatus',
            // (R19) GA4 익명 식별자 — 베타 사용자 흐름 추적 가명화 토큰
            //   사용자 답·도트·기도 본문은 절대 GA4 로 보내지 않음. 익명 ID 만 페이로드.
            //   사용자 동의(베타 가입 시) 후 발급. 미동의면 null.
            'gaAnonymousId',
            // (S-D 후속 2026-05-15) 사용자가 읽는 성경 번역본 id.
            //   현재 본문 데이터는 'krv'(개역개정) 단일. 다른 옵션은 자리만(preparing=true).
            //   기기 동기화용 — 폰·PC 어디서 들어와도 같은 번역본. 평문이라 사이드바·헤더 표기에 빠르게 사용.
            'bibleVersion'
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
            // (2026-05-14 #58) 생일 달력 종류 — 'solar'(양력, 디폴트) | 'lunar'(음력).
            //   "아빠 생일 음력이라 그거 지켜야 함" 사용자 명시. 1차는 메타만 보존.
            //   자동 양력 변환·알람은 별도 트랙 (lunar-calendar 라이브러리 필요).
            'birthdayCalendar',
            // (2026-05-14 #58 후속) 생일 알람 명시 활성 — true 면 innerCircle 아니어도 발화.
            //   false/null 이면 innerCircle 기반 디폴트.
            //   "특수하게 케어하는 사람들도 알람 가능하게" 사용자 명시.
            'birthdayAlertEnabled',
            // (v3 2026-05-12) 첫 평가 1회 보존 — 첫인상 비교용
            'firstImpression',
            // ─── (B-4 본인 프로필 트랙 2026-05-13) isSelf=true 카드 전용 ───
            'lifeStage',          // 🪪 인생 단계 — 'student'|'employee'|'married'|'parent'|... 자유 텍스트 허용
            'currentCity',        // 🪪 현재 도시
            'homeChurch',         // ⛪ 소속 교회 이름
            'faithStartDate',     // ⛪ 신앙 시작 시점 (자유 텍스트 또는 'YYYY' / 'YYYY-MM')
            'faithTone',          // ⛪ '묵상형'|'전도형'|'섬김형'|... (자유 텍스트)
            'valueKeywords',      // 🎯 가치관 키워드 ['정직', '사랑', ...]
            'lifeMission',        // 🎯 인생 미션 한 줄
            'interests',          // 🎯 관심사 ['독서', '음악', ...]
            'identitySentence',   // 🧠 "나는 ... 사람" 정체성 한 줄
            'currentChallenges',  // 🧠 현재 도전 중인 것 ['도전 1', ...]
            'mbti',               // 🧠 MBTI 'INTJ' 등 (선택)
            // 🎚️ visibility 정책 — 필드별 디폴트 + 사용자 토글 결과
            //   { fieldName: 'public'|'shared'|'private' }
            //   디폴트는 ui/selfProfile.js 상수로 박혀 있고, 사용자가 바꾼 결과만 여기 저장
            'profileVisibility',
            // 📷 시점 스냅샷 (1차엔 모델 자리만 — 자동 보존 로직은 5y/10y·B-1 트랙)
            'profileVersionIds',   // [profileVersions docId, ...] — 1차엔 비어 있음
            // (B-4 데이터 인프라 트랙 2026-05-15) 점수 시점 스냅샷 시퀀스 — R15 추이 시각화 입력.
            //   shape: [{ capturedAt, bigFive, competencies, relationship, trigger, deltaPeak }]
            //   - trigger: 'auto_change' | 'manual' | 'weekly_baseline'
            //   - deltaPeak: 변화 폭 (가장 큰 단일 축 변화량 — 가지 굵기 시각화용)
            //   - 자동 추가 조건: 어떤 축이라도 ±5 이상 변화 + 마지막 스냅샷 7일 이상 지남
            //   - 본인 카드(isSelf=true) 도 같은 회로 (단 변화율 절반 — 자기합리화 방지)
            //   - 시간 가중치 적용: 최근 3개월 도트 70% / 그 이전 30%
            //   - 만점 회피 곡선: 점수 70+ 면 변화율 둔화 / 90+ 거의 안 움직임
            //   - "능력" 라벨은 *함께 느낀 만족도* 임을 UI 톤에 표기 권장 (본인 프로필 재기획 트랙 이슈)
            'scoreSnapshots',
            // ─── (본인 프로필 재기획 트랙 2026-05-14 S-A) 사적 차원 ───
            // (R10) 간증 — 사람·관계에 대한 하나님의 역사 기록. 유다·요셉 비유.
            //   사용자가 명시 박은 글만 (자동 추출 X). AI 가 의사결정 시 과거 사례로 활용 가능.
            //   shape: [{date:'YYYY-MM-DD', personId?:string, title?:string, body:string, createdAt}]
            //   personId 가 있으면 인물 카드 안에서 노출, 없으면 본인 카드 안 일반 간증.
            'testimony',
            // (R15) 관계 추이 timeline — "관계 사진첩" 모델 B (2026-05-14 (a) 합의)
            //   shape: [{date:'YYYY-MM-DD', event:string, sentiment:'warm'|'cool'|'neutral'|'hurt', note:string, linkedDotIds:string[], linkedPrecedentIds:string[]}]
            //   인물 카드별 항목 (본인 카드 안에는 본인 스테이터스 변화 추이).
            //   "관계의 가지가 뻗어나가는 추이" R15 결 — 자동 점수화 X, sentiment·event·note 모두 사용자 입력만.
            //   linkedDotIds/linkedPrecedentIds 책갈피 자리 (R11 도트↔인물 매핑 자연 흡수).
            'relationshipHistory',
            // (R17) 묵상 진도 사적 — 큐티 수준별 어디까지 묵상했는지 사용자별 위치
            //   shape: { lastPart?:string, lastChapter?:number, lastVerse?:number, lastReadAt?:'YYYY-MM-DD' }
            //   scriptureSettings (localStorage) 와 양방향 동기화 — 기기 변경 시 이 자리가 진실.
            'devotionalProgress',
            // (R18) 튜토리얼 상태 사적 — 미션 진행 디테일·완료 시점·완료 카피
            //   shape: { [missionId]: { completedAt, signal, contextDotId? } }
            //   사이드바 잠금 가드는 평문 missionStatus 만 보고 결정. 이 자리는 졸업식·리포트 시드용.
            'tutorialState'
        ]
    },
    // (B-4 본인 프로필 트랙 2026-05-13) 본인 프로필 시점 스냅샷 — 1차엔 컬렉션 자리만 박아둠.
    //   자동 보존 트리거(의사결정 게이트·분기·연 등)는 5y/10y 리포트 트랙 / B-1 의사결정 트랙에서 정교화.
    profileVersions: {
        plaintext: [
            'id', 'userId', 'versionNumber', 'capturedAt', 'createdAt',
            // 자동 보존 트리거 분류 (2026-05-14 S-A 확장):
            //   'manual'           — 사용자 명시 캡처
            //   'auto_quarter'     — 분기 자동 (후속)
            //   'decision_gate'    — 분별의 자리에서 자동 (후속)
            //   'graduation'       — 가입 +14일 종료 시점 자동 보존 (Q7 (b) 합의 — Day 14 종료)
            //   'mission_milestone'— 마일스톤 미션 클리어 시 (후속, 졸업식 풀스크린 카드와 별개)
            'trigger'
        ],
        encrypted: [
            'snapshotData',  // 그 시점 본인 카드 전체 (인물 카드 + 본인 전용 필드)
            'note'           // 사용자가 명시 박은 메모 (선택)
        ]
    },
    organizations: {
        plaintext: [
            'id', 'type', 'stance', 'friendliness', 'trust', 'importance', 'riskLevel',
            'createdAt', 'updatedAt',
            // (v5 2026-05-12) 1차 분류 multi-select — 한 곳이 여러 역할(people/membership/regular/visit)을 동시에 가질 수 있음.
            // type 필드는 v4 호환을 위해 plaintext에 남겨두지만 새 코드는 roles를 우선 사용.
            'roles',
            // (v4) 사람 모임 세부(subType) + 장소 활동 메타(activityType)
            'subType', 'activityType'
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
            'linkedDotId', 'linkedPersonIds', 'linkedOrgIds',
            // (경제 트랙 1.a 2026-05-14) 매매 거래(incomeType='trade') 의사결정 흔적.
            //   "이거 왜 그랬는지 → 무슨 교훈 → 다음에 뭘 조심 → 원칙 세울 수 있게" 사용자 명시.
            //   tradeReason: 왜 매수·매도했나. tradeLesson: 무엇을 배웠나.
            //   linkedPrecedentId: 📜 "분별의 자리로" 옵션으로 연결된 판례 id (자동 호출 X).
            'tradeReason', 'tradeLesson', 'linkedPrecedentId',
            // (경제 트랙 1.a) 이체 거래(direction='transfer') 전용.
            //   recipient: 받는 곳 자유 텍스트 (외부 이체 시 메모 필수, 자동완성 캐시 키).
            //   transferFromAccountId / transferToAccountId: 내부 이체 시 양쪽 통장.
            //   외부 이체는 transferToAccountId=null + recipient만 채움 → 지출 합계 자동 합산.
            'recipient', 'transferFromAccountId', 'transferToAccountId'
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
            // (2026-05-13 HC#1 N7) 매일 묵상 알람 시각 — "HH:MM" 형식.
            // dailyAlarmEnabled 가 true 일 때만 reminderGenerator 가 발화.
            'dailyAlarmEnabled', 'dailyAlarmTime',
            // (2026-05-14 #58 후속) 생일 알람 며칠 전 발화 — 배열, 예: [7, 3, 0].
            //   innerCircle 인물 + 본인 대상. 디폴트 [7, 3, 0] (1일 전 없음).
            //   빈 배열이면 생일 알람 전체 비활성.
            'birthdayAlarmDays',
            // (2026-05-14 #23 후속) 묵상 템플릿 — 사용자 정의 마크다운.
            //   {{scripture}} 마커 위치에 절 본문이 삽입됨. 미설정 시 default = '{{scripture}}'.
            'meditationTemplate',
            // (B-5 트랙 Phase 1 2026-05-14) 회복의 자리 모드 — 'cute'(귀여움·디지소울 톤) | 'calm'(차분·묵상 톤) | 'off'(완전 끔).
            //   디폴트 'calm'. UI 톤 분기 (recoveryGate 모달).
            //   사용자 명시: "무조건 귀여워야 함, 아무런 해 끼치지 않게" + "묵상으로 자연 돌아가게".
            'recoveryTone',
            'updatedAt'
        ],
        encrypted: []
    },
    // 경제 모듈 설정 (Phase F) — bucket 임계값 등.
    // 임계값 자체는 라이프스타일 분류 기준일 뿐이라 평문 OK.
    economySettings: {
        plaintext: [
            'id', 'smallMax', 'mediumMax', 'largeMax',
            // (경제 트랙 1.a 2026-05-14) 사용자 기본 통화 — 시작 시 1회 설정 (KRW·EUR·USD·...).
            //   환율 변환·실시간 시세는 베타 후 트랙 2. 1차는 단일 통화 가정 + 표시만.
            'defaultCurrency',
            'updatedAt'
        ],
        encrypted: []
    },
    // (B-5 트랙 Phase 1 알 단계, 2026-05-14) 회복의 자리 메모 — 자기 인식·기도·다시 결심 보관.
    //   가이드 별: "양치기 소년 = 정죄 X / 회복으로 이끄는 게임 ✓" (사용자 명시).
    //   자기 자신만 자동 감지 (마 7:1~5 들보 먼저). 타인 자동 감지 X.
    //   patternKey 평문 — "broken_promise_3" / "broken_promise_5" 등 패턴 식별자(통계 가능).
    //   tone 평문 — 'cute' | 'calm' (사용자 모드, 저장 시점 톤 보존).
    //   content/prayerNote/linkedDotIds 암호화 — 사적 인식.
    recoveryMemos: {
        plaintext: [
            'id', 'userId', 'createdAt', 'patternKey', 'tone', 'source'
        ],
        encrypted: [
            'content',        // 사용자 자기 인식 메모 자유 텍스트
            'prayerNote',     // 같은 자리에 기도 적은 게 있으면
            'linkedDotIds',   // 감지된 도트들 (자기 인식 자료)
            'linkedScriptureId' // 묵상 훅 (선택)
        ]
    },
    // (2026-05-13 HC#1 추모비) 폐기된 목표의 추모비 — 목표·도트·기간·기여·내러티브 보존.
    // 1차: 도트 삭제 X, 목표 status='archived'. contributions·representativeDots·
    // aiNarrativeSummary 는 다음 트랙(B-4·B-1·AI 진단) 후 채움.
    extinguishedGoalMemorials: {
        plaintext: [
            'id', 'userId', 'goalId',
            'extinguishedAt',  // 'YYYY-MM-DD'
            'createdAt',
            'duration',        // { startDate, endDate, daysElapsed }
            'dotStats',        // { total, completed, partial, skipped, replaced, ... }
            'source'           // self_report(X 버튼) | ai_inferred(미래 B-1 게이트)
        ],
        encrypted: [
            'goalSnapshot',
            'representativeDots',
            'contributions',
            'aiNarrativeSummary',
            'triggeredByPrecedentId',
            'userNote'
        ]
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
