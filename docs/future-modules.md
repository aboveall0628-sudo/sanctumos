# 🌌 Future Modules — 인물·경제 모듈 영적 안전장치

> 인물(persons)과 경제(transactions) 모듈은 **v2 이후**에 활성화될 예정.
> 그 전에 영적·윤리적 안전장치를 미리 설계해 둔다.

---

## 0. 왜 미리 적어두는가

이 두 모듈은 사용자의 **가장 약한 곳**을 다룬다:

- **인물 모듈** — 가까운 사람을 라벨링하는 도구가 되면 관계가 차가워질 수 있다
- **경제 모듈** — 돈으로 사람을 평가하기 시작하면 영적 거울이 회계 장부로 변질될 수 있다

→ 코드를 짜기 전에 **하지 말아야 할 것**을 먼저 못 박아둔다.

---

## 1. 인물 모듈 (persons / interactions)

### 데이터 모델 (예약, 비활성)
```js
persons: {
    plaintext: ['id', 'userId', 'createdAt', 'lastInteractionAt'],
    encrypted: ['name', 'relationship', 'notes', 'tags']
}
interactions: {
    plaintext: ['id', 'userId', 'date', 'sentimentBucket'],
    encrypted: ['personId', 'content', 'context']
}
```

### 영적 안전장치

#### ⚠️ 자기 모순 메모 (2026-05)
실제 `persons` 컬렉션은 `stance` (ally / neutral / caution / adversary 4단계) 라벨을 가진다.
"인물 라벨링 금지" 원칙과 정면 충돌. 다음 회차에서 처리할 것:
- `adversary` 라벨을 톤 다운 (예: "주의 필요" / "기도 중") 또는 제거
- 또는 stance 자체를 사용자 비공개 메모로 강등 (UI 노출 제한)

#### ❌ 금지 사항
- **인물별 평점/만족도 수치화** — "엄마: 3.2점" 같은 비교 금지
- **랭킹/리더보드** — "이번 달 가장 안 만난 사람"처럼 비교 금지
- **자동 분류 추천** — AI가 "이 사람은 부정적"이라고 라벨링 X
- **인물 단위 통계 카드** — 대시보드에 "사람별 시간 분포" 같은 막대 그래프 X

#### ✅ 허용 사항
- 만남 기록 (시간, 한 줄 메모) — 일기처럼 기록만
- 가까운 사람의 생일 같은 정적 정보
- 사용자가 직접 적은 기도 제목과의 연결
- "이 사람을 위한 기도" 묶음 보기

#### AI 프롬프트 가이드
```
인물 데이터를 분석할 때:
- 평점 매기지 마세요
- "이 사람은 ~한 사람"처럼 단정 X
- 대신 "이 만남에서 이런 패턴이 보여요" 가설 톤
- 인물 이름은 P_001 마스킹 토큰으로 들어옵니다 — 그 토큰 그대로 사용
```

---

## 2. 경제 모듈 (accounts / assets / liabilities / transactions / snapshots)

### 데이터 모델 — 현재 적용본
> 이 문서의 초기 스케치(2 컬렉션)는 **2026-05** 에 7 컬렉션 모델로 확장됐다.
> 권위 있는 정의는 `config/encryptionPolicy.js` 에 있고, 아래는 그 요약이다.
> 코드 변경 시 본 문서를 함께 갱신할 것.

| 컬렉션 | 평문 (검색용) | 암호화 (본인만) |
|---|---|---|
| `accounts` | `id, type, currency, isPrimary` | `name, institution` |
| `assetCategories` | `id, kind` | `name` |
| `assets` | `id, categoryId, currentValueBucket, lastValuationAt` | `label, details, exactValue` |
| `liabilities` | `id, type, principalBucket` | `details, interestRate, exactPrincipal` |
| `transactions` | `id, date, direction, amountBucket, category, subCategory, incomeType, expenseType` | `exactAmount, description, accountId, linkedAssetId, linkedLiabilityId, linkedDotId, linkedPersonIds, linkedOrgIds` |
| `cashflowSnapshots` | `id, month, savingsRate, passiveRatio` | `totalsExact, breakdownExact, aiInsights` |
| `netWorthSnapshots` | `id, month, netWorthBucket` | `totalsExact, breakdownExact` |

**핵심 패턴**: bucket(상대값)은 평문, exact(절대값)은 암호화. 통계·검색은 bucket 으로, 절대값은 본인만 봐도 충분.

### 영적 안전장치

#### ❌ 금지 사항
- **자산 합산 큰 숫자 노출** — "총 자산: ₩XXXXXXXX" 디폴트 표시 X
- **부채 비율 카드** — 율법적 압박감 유발
- **소비 카테고리 랭킹** — "이번 달 가장 많이 쓴 곳"으로 자기 비난 유도 X
- **AI가 절약 권하기** — "이 항목을 줄이세요" 명령형 X

#### ✅ 허용 사항
- 거래 시점에 묵상 노트 1줄 묶기 ("이 지출이 내 마음에 어떻게 닿는가")
- amountBucket으로 상대값 분류 (소액/중액/고액 — 절대값 숨김)
- 사용자 명시 요청 시에만 통계 보여주기 (디폴트 숨김)
- 십일조·헌금 같은 영적 약속 추적 (사용자가 자발적으로 입력 시)

#### 표시 디폴트
- **금액 단위는 평소 마스킹** (`[중액]` 형태, 클릭 시에만 노출)
- **민감 모드**(`👁`)에서는 모든 금액 블러 처리
- **대시보드는 비교 지표 디폴트 숨김** — "자세히 보기" 토글로만 노출

#### AI 프롬프트 가이드
```
경제 데이터를 분석할 때:
- 절약/투자/검소 같은 가치 평가 단어 사용 금지
- 금액은 amountBucket(소액/중액/고액)으로만 들어옵니다
- "이 거래가 어떤 마음에서 나왔을까"를 함께 살피는 톤
- 결단은 사용자가 말씀과 기도 안에서 내림 — AI는 단지 거울
```

---

## 3. 통합: 인물 + 경제 + 시간

도트 데이터에 이미 슬롯이 예약되어 있다 (`config/encryptionPolicy.js`):

```js
dots: {
    encrypted: [
        ...,
        'linkedPersonIds',       // 이 시간에 함께 있던 사람
        'linkedOrgIds',          // 이 시간이 속한 조직 활동
        'linkedTransactionIds',  // 이 시간에 일어난 거래
    ]
}
```

### 활성화 시 시나리오 (미래)
- "교회 봉사 시간 → linkedPersonIds: 함께한 사람들 + linkedOrgIds: 교회"
- "친구와 식사 → linkedPersonIds: 친구 + linkedTransactionIds: 결제 내역"
- 이렇게 시간·관계·돈이 한 점에서 만남

### 영적 의미
> 시간을 어디에 쓰고, 누구와 함께 있었고, 어떻게 청지기로서 살았는지 — 한 거울 안에서 정직하게 마주.

이 통합은 **비교를 위한 도구가 아니라 회개를 위한 거울**이다. 모든 UI는 이 원칙에서 벗어나지 않는다.

---

## 4. 활성화 체크리스트 (v2 진입 전)

활성화하려면 다음을 먼저:

- [ ] 인물·경제 모듈의 영적 안전장치 코드 리뷰 통과
- [ ] AI 프롬프트에 "비교/평가/명령형 금지" 명시
- [ ] 디폴트 숨김 옵션 (`민감 모드` 통합)
- [ ] 사용자 신뢰 검증 — 베타 테스터 5명에게 "이 카드/지표가 영적 압박을 주나요?" 인터뷰
- [ ] CHANGELOG에 v2 진입 기록 + 사용자 동의 모달

---

## 5. 영적 톤 점검 도구

`docs/security.md`에 더해, 모든 새 기능은 다음 질문을 통과해야 한다:

1. 이 기능이 **비교**를 부추기는가? — 그렇다면 디폴트 숨김으로
2. 이 기능이 **율법주의**를 강화하는가? — 그렇다면 톤 재작성
3. 이 기능이 **사용자가 결단을 내리는 자리**를 빼앗는가? — 그렇다면 가설/거울로 후퇴
4. 이 기능이 **하나님 앞**이 아니라 **사람 앞**에 자기를 내세우게 하는가? — 그렇다면 폐기

> AI는 가설 제시까지만, 결단은 사용자가 말씀과 기도 안에서.
