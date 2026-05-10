# 🚀 Cloud Functions 배포 가이드 (Gemini AI 프록시)

이 가이드를 따라하면 Sanctum OS의 AI 분석(저녁 회고, 타임박싱 브리핑)이 활성화돼요.

> 안 해도 앱은 그대로 작동해요. 배포 안 한 상태에서는 자동으로 간단 요약(fallback)으로 보여드려요.
> 정식 AI 분석을 받고 싶으면 아래 단계를 한 번만 따라하시면 돼요.

---

## ⏱ 예상 소요 시간

- 처음 한 번: **15~20분** (Firebase CLI 설치 + 요금제 업그레이드 + Gemini API 키 발급 포함)
- 이후 코드 수정 후 재배포: **2~3분**

## 💰 요금

- **Firebase**: Cloud Functions는 **Blaze 요금제(종량제)** 필요. 사용량 적으면 한 달 0원에 가까움
- **Gemini API**: 무료 티어 충분. Flash 모델은 분당 60회 무료 (Pro는 분당 5회 무료)
- 우리 앱은 사용자 한 명당 하루 5~10회 호출이라 무료 한도 안에서 끝남

---

## 1단계: 사전 준비 (한 번만)

### Node.js 20 설치 확인
```powershell
node -v
```
v20.x.x 안 보이면 https://nodejs.org/ 에서 LTS 버전 설치.

### Firebase CLI 설치
```powershell
npm install -g firebase-tools
```

### Firebase 로그인
```powershell
firebase login
```
브라우저가 열리고 Google 로그인 → 권한 승인.

### Firebase 프로젝트 사용 설정
프로젝트 루트(`C:\Users\MSI\Desktop\개발\Sanctum OS`)에서:
```powershell
firebase use biblealimi
```

---

## 2단계: Blaze 요금제 업그레이드

**Cloud Functions를 배포하려면 Blaze(종량제) 필요해요.** 무료 한도 안에서만 쓰면 거의 0원이에요.

1. https://console.firebase.google.com/project/biblealimi/usage/details 접속
2. **"업그레이드"** 또는 **"Blaze 요금제로 업그레이드"** 클릭
3. 결제 카드 등록 (Google Cloud 결제 계정)
4. **예산 알림 꼭 설정** — 한 달 $5 정도로 (안전장치)

---

## 3단계: Gemini API 키 발급

1. https://aistudio.google.com/apikey 접속
2. **"Create API key"** 클릭
3. **"Create API key in existing project"** → `biblealimi` 선택
4. 발급된 키 복사 (`AIzaSy...`로 시작하는 긴 문자열)

> 이 키는 **절대 코드에 직접 넣지 마세요**. 다음 단계에서 Firebase Secrets에 등록해요.

---

## 4단계: Firebase Secrets에 API 키 등록

프로젝트 루트에서:
```powershell
firebase functions:secrets:set GEMINI_API_KEY
```

프롬프트가 뜨면 **3단계에서 복사한 API 키**를 붙여넣고 Enter.

확인:
```powershell
firebase functions:secrets:access GEMINI_API_KEY
```

키 값이 뜨면 OK.

---

## 5단계: 의존성 설치 + 배포

```powershell
cd functions
npm install
cd ..
firebase deploy --only functions:llmProxy
```

처음 배포는 5~10분 정도 걸려요. 끝나면:
```
✔ functions[asia-northeast3-llmProxy] Successful create operation.
Function URL: https://...
```

---

## 6단계: 동작 확인

1. Sanctum OS 사이트로 이동: https://aboveall0628-sudo.github.io/sanctumos/
2. **`Ctrl + Shift + R`** (hard refresh)
3. 사이드바 **🌙 저녁 통합 루프** 클릭
4. 스크롤해서 **🔍 회고 읽기** 섹션으로 이동
5. AI 요약이 보이면:
   - **"🌟 AI가 살펴본 오늘의 결"** 태그 → ✅ Cloud Function 정상 작동
   - **"※ 지금은 간단 요약만 보여드려요. AI 분석은 곧 활성화될 예정이에요."** → 아직 fallback. 5단계까지 다시 확인

---

## 🔧 문제 해결

### "permission-denied" 에러
- Firebase Console → IAM → 본인 계정에 **Cloud Functions Admin** 권한 있는지 확인

### "GEMINI_API_KEY not found"
- 4단계 다시. `firebase functions:secrets:set GEMINI_API_KEY`

### "API key not valid"
- Gemini Studio에서 키 다시 확인. 만료됐거나 권한 부족일 수 있음

### 배포 후에도 fallback 메시지가 뜸
- DevTools(F12) → Console → 빨간 에러 확인
- `region` 불일치: 우리는 `asia-northeast3` 사용. 다른 region에 배포하면 클라이언트가 못 찾음

---

## 💡 비용 모니터링

- Firebase Console → **Usage and billing** → 일별 호출 수 확인
- Gemini API → https://aistudio.google.com/usage → 월별 호출 수 확인

우리 앱은 사용자 한 명당:
- 일별 회고 호출: 1회
- 주간 회고 호출: 토요일 1회
- 타임박싱 브리핑: 1일 5~10회

→ **한 달 200회 이내**, 무료 한도(분당 60회 = 일 86,400회) 한참 안쪽이에요.

---

## 🛡 보안 체크리스트

- [ ] `GEMINI_API_KEY`는 Firebase Secrets에만 있음 (코드/Git에 절대 안 들어감)
- [ ] llmProxy의 `if (!req.auth)` 인증 체크 살아있음
- [ ] 클라이언트에서 호출 전 `pseudonymize()` 통과 (사람 이름·금액 마스킹)
- [ ] task 화이트리스트로 임의 프롬프트 주입 차단
- [ ] Firebase Console → Cloud Functions → llmProxy → **로그**에서 에러 모니터링

---

## 향후 모델 업그레이드

`functions/src/llmProxy.ts`의 `allowedModels` 배열에 새 모델 추가:
```ts
const allowedModels = ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-3.0-flash"];
```

그 후 재배포:
```powershell
firebase deploy --only functions:llmProxy
```

클라이언트 `ui/aiClient.js`의 `opts.deep` 분기에서 새 모델로 전환.
