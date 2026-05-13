# 트랙 2 Phase 2~4 세션 프롬프트
**작성일**: 2026-05-13
**용도**: 별도 세션에서 트랙 2 Phase 2~4 작업할 때 첫 입력으로 사용
**컨텍스트**: 이 문서를 그대로 또는 일부 복사해 새 세션에서 시작

---

## 사용법

새 세션을 열고 아래 프롬프트를 복사해 첫 메시지로 붙여넣으세요. 클로드는 메모리에서 추가 컨텍스트를 자동 로드합니다.

---

## 프롬프트 본문 (복사용)

```
Sanctum OS의 트랙 2 (이메일 복구 + 비밀번호 정책) Phase 2부터 이어서 작업합니다.

## 트랙 2 전체 맥락
- Sanctum OS는 E2EE PWA. 24단어 BIP39 한국어 128단어 기반 시드로 데이터 암호화.
- 문제: 24단어 시드 분실 시 데이터 영구 손실. 사용자가 입력 귀찮음 호소.
- 트랙 1(부분 인증) 폐기: 21비트 엔트로피로 약화되어 GPU 몇 분에 뚫림.
- 트랙 2(이메일 복구) 채택: E2EE 유지형 설계 Y.

## 채택된 설계 Y (반드시 준수)
- 시드를 Firebase Secrets KMS 키로 암호화 저장
- 사용자가 이메일 인증 통과 후 **60초만 복호화 권한** 부여
- 서버는 평문 시드를 절대 갖지 않음
- 24단어 슬롯과 이메일 슬롯 **병행 가능** (Q2=B 결정)
- 비밀번호 정책: 8자+ 영대/소/숫자/특수, 소문자 의무 (Q3=b 결정)
- 마이그레이션 시 비밀번호 + 이메일 둘 다 강요 (Q4 결정)

## 외부 인프라
- Gmail App Password (SendGrid 미채택)
- Firebase Secrets 간이 키 (GCP KMS 미채택)
- SMTP 자격 발급은 사용자 직접 작업

## Phase 1 완료 사항 (커밋 0667f44, 2026-05-11)
- 비밀번호 정책 v2 적용
- 신규 파일: crypto/passwordPolicy.js
- 적용 위치 3곳: 가입 / 설정 / 마이그레이션
- users 문서에 passwordPolicyVersion: 2 기록

## Phase 2 작업 내용 (이번 세션 시작)
**목표**: 클라이언트 측 이메일 복구 슬롯 생성

1. 신규 파일: crypto/emailRecoverySlot.js
   - 시드 → DEK → 이메일 기반 추가 슬롯으로 wrap
   - 단일 encryptedPayload 블롭 방식 (Sanctum OS 표준)
2. users 문서에 두 필드 추가:
   - wrappedDEK_email (이메일 슬롯으로 감싼 DEK)
   - wrappedDEK_email_iv (초기화 벡터)
3. 24단어 슬롯과 병행 가능하게 설계
4. 가입/설정 흐름에서 이메일 등록 시 자동 슬롯 생성
5. 클라이언트 측만 다룸 — Cloud Functions는 Phase 3에서

## Phase 3 작업 내용 (Phase 2 검증 후 진행)
- Cloud Functions 4개 신규 작성:
  - emailRecoveryRequest (복구 요청 접수)
  - emailRecoveryVerify (이메일 인증 코드 검증)
  - emailRecoveryRedeemSeed (60초 권한으로 시드 복호화)
  - emailRecoveryRotateSeed (복구 후 시드 회전)
- Gmail App Password 환경 변수 등록 필요 (사용자 작업)
- Firebase Secrets KMS 키 등록 필요 (사용자 작업)

## Phase 4 작업 내용 (Phase 3 후)
- 마이그레이션 강요 흐름 완성
- 기존 사용자가 로그인 시 이메일 미등록이면 강제 등록
- passwordPolicyVersion < 2 사용자에 비밀번호 정책 강요

## 시작 시 확인 사항
1. 현재 git 상태 + 마지막 커밋 확인
2. Phase 1 commit 0667f44가 main에 있는지 확인
3. 메모리의 reference_encryption_format.md 확인 — 단일 encryptedPayload 블롭 방식 사용, _enc 접미사 아님
4. 메모리의 feedback_firestore_index_pattern.md 확인 — composite index 의존 금지
5. 메모리의 feedback_push_first.md 확인 — Sanctum OS는 수정 직후 main에 push

## 작업 흐름 (Rule 9 준수)
- 각 작업 시작 전 기획 확인 + 질의응답으로 합의 후 시작
- Phase 2 안에서도 큰 변경 전 사용자 동의 필수
- 비유로 설명, 트레이드오프 정직하게, 검증 체크리스트 제공

## 환경
- 작업 디렉토리: c:\Users\MSI\Desktop\개발\Sanctum OS
- 셸: PowerShell
- 기술 스택: Vanilla JS PWA, Firebase (biblealimi 프로젝트), GitHub Pages
- 배포: main 푸시 = 즉시 GitHub Pages 반영

## OAuth 경고 (해결 필요 시)
GCP Console → biblealimi → OAuth 동의 화면 → Test users에 aboveall0628@gmail.com 추가

## 이 세션의 목표
Phase 2를 끝까지 완료한다. 가능하면 Phase 3 진입 직전까지.
Phase 2 완료 기준:
- crypto/emailRecoverySlot.js 작성 완료
- 가입/설정 흐름 연동
- 기존 사용자 호환성 확보 (24단어 슬롯만 있는 유저)
- 테스트 시나리오 통과
- 커밋 + main 푸시

먼저 현재 상태를 확인하고, Phase 2의 첫 단계 작업 합의를 위한 질의응답을 시작하세요.
```

---

## 추가 참고 자료 (세션 시작 후 클로드가 자동 로드)

메모리 인덱스에서 자동 참조될 항목:
- project_separate_tracks.md — 트랙 1·2·3 결정 사항 전체
- reference_encryption_format.md — 암호화 문서 형식
- feedback_firestore_index_pattern.md — composite index 회피
- feedback_push_first.md — 수정 직후 main 푸시
- feedback_collaboration.md — Rule 9 포함 협업 스타일
- project_status.md — 최근 완료 + 다음 출발점

---

## 세션 종료 시 업데이트해야 할 메모리
- project_separate_tracks.md → Phase 2 완료 상태로 갱신
- project_status.md → 최근 완료에 추가
- 새로운 결정 사항이 있으면 별도 메모로
