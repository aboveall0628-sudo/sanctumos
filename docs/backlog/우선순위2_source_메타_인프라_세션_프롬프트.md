# 우선순위 2 — Source 메타 인프라 세션 프롬프트
**작성일**: 2026-05-13
**용도**: 별도 세션에서 source 메타 인프라 작업할 때 첫 입력으로 사용

---

## 사용법
새 세션을 열고 아래 프롬프트를 복사해 첫 메시지로 붙여넣으세요.

---

## 프롬프트 본문 (복사용)

```
Sanctum OS의 정직성 인프라 — source 메타 필드 추가 작업을 시작합니다.

## 작업 맥락

2026-05-13 기획 세션에서 합의된 묶음 A 정책:
"필드별 source 메타 — 'self_report' / 'calendar_sync' / 'device' / 'helper_input' / 'ai_inferred'"

이건 자기합리화 방지 시스템(B-6)의 토대 인프라. 한 번 안 깔면 나중에 마이그레이션 지옥이라 다른 큰 기능들 진입 전에 먼저 박아둬야 함.

## 작업 목표

1. **도트 모델에 source 필드 추가** (가장 우선)
2. 기존 도트 일괄 마이그레이션 (기본값 'self_report')
3. data/gcalSync.js 등 자동 생성 코드 수정 — 캘린더에서 만든 도트는 'calendar_sync'로 표시
4. 추후 다른 모델(원칙/판례/메모 등)에도 동일 패턴 확장 가능하게 준비 (이번엔 도트만)

## source 값 분류 (5가지 enum)
- `self_report` — 사용자가 직접 입력한 것
- `calendar_sync` — 외부 캘린더(GCal 등)에서 자동 가져온 것
- `device` — 디바이스 측정값 (걸음수, 수면 등 미래 통합 대비)
- `helper_input` — 조력자(다른 사람)가 입력한 것 (미래)
- `ai_inferred` — AI가 추론한 것 (미래)

## 필수 참조

세션 시작 시 다음을 확인:
- `docs/backlog/목표_워크플로우_일일의식_기획서.md` (§11 정직성 인프라)
- 메모리 `feedback_evaluation_vs_causation.md` — 평가보다 인과
- 메모리 `feedback_organism_architecture.md` — 거대한 유기체
- 메모리 `feedback_return_to_word.md` — 묵상으로 돌아가기
- 메모리 `reference_encryption_format.md` — 단일 encryptedPayload 블롭 방식
- 코드: `data/gcalSync.js` — 캘린더 동기화 코드
- 코드: 도트 데이터 모델 정의 위치 (탐색 필요)

## 작업 흐름 (Rule 9 준수)

큰 변경 전 질의응답으로 합의:
1. **마이그레이션 전략** — 기존 도트가 몇 개인지 먼저 확인. 일괄 vs 점진적 마이그레이션 결정
2. **enum 값 확정** — 5가지면 충분한지, 또는 미래 확장 위해 더 둘지
3. **암호화 영향** — source 필드도 암호화 대상인지 (메타 vs 본문 구분)
4. **gcalSync.js 수정 범위** — 신규 도트만 vs 기존 캘린더 도트도 소급 적용

## 완료 기준

- [ ] 도트 모델에 source 필드 정의됨
- [ ] 기존 도트 일괄 마이그레이션 완료 (기본값 self_report)
- [ ] 캘린더 동기화 도트는 자동으로 source: calendar_sync 박힘
- [ ] 코드 변경 후 직접 테스트 (브라우저에서 도트 생성·캘린더 동기화 둘 다)
- [ ] 커밋 + main 푸시 (Sanctum OS 정책)
- [ ] 메모리 project_status.md 갱신

## 환경
- 작업 디렉토리: c:\Users\MSI\Desktop\개발\Sanctum OS
- 셸: PowerShell
- 기술 스택: Vanilla JS PWA, Firebase (biblealimi)
- 배포: main 푸시 = 즉시 GitHub Pages 반영

## 이 세션의 목표

도트 모델에 source 메타를 박고, 캘린더 동기화부터 자동 분류되도록 만들기.
다른 모델(원칙/판례 등) 확장은 이번 세션 X — 도트만 완료하고 다음 세션으로.

먼저 현재 도트 모델 정의 위치와 기존 도트 개수를 확인하고, 마이그레이션 전략을 질의응답으로 합의한 뒤 시작하세요.
```

---

## 세션 종료 시 업데이트해야 할 메모리
- project_status.md → source 메타 인프라 완료 추가
- 필요 시 새 reference 메모로 "source 값 분류 정의" 박기
