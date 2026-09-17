# 🔐 Firebase 보안 설정 가이드

> 도타2 인하우스 로스터 페이지가 **Firebase(개인 프로젝트)**에 연동되어
> **GitHub Pages**에서 공개 배포될 때, 반드시 알아야 할 보안 설정 요약본입니다.

## 1. 기본 개념: 웹 앱 설정키는 "공개되는 값"이다

| 구분 | 설명 | 공개해도 되는가? |
|---|---|---|
| **Web 설정키** (`apiKey`, `appId`, …) | 어떤 Firebase 프로젝트에 접근할지 알려주는 식별자. Firebase 콘솔 → 프로젝트 개요에서 발급 | ✅ 공개 가능 (이 페이지의 `js/firebase-config.js`에 들어가도 무방) |
| **서버/서비스 계정 키** (`.json` 서비스 계정, `serviceAccountKey`) | 관리자 권한의 비공개 키. 데이터 전체 조작 가능 | ❌ **절대** 클라이언트 코드·Git 저장소에 넣지 마세요 |
| **보안 규칙** (`firestore.rules`) | 실제 데이터 접근을 통제하는 핵심 정책 | ✅ 공개 (Firebase 서버에서 평가) |

**핵심 원칙:** 클라이언트에 "비밀"을 숨기는 방식이 아니라, **서버(Firestore)가 규칙으로 허용하는 것만** 통과시키는 방식으로 방어합니다.

---

## 2. Firestore 보안 규칙 (최소 필수)

본 프로젝트에 포함된 [`firestore.rules`](firestore.rules)의 핵심 내용:

```rules
match /rosters/{docId} {
  // 읽기 차단 — 클라이언트는 제출한 데이터도 열람 불가
  allow read:   if false;
  // 쓰기: 문서 ID·필수 필드·데이터 형식 검증을 통과해야 허용
  allow create: if validDocId()
                && validShape(request.resource.data)
                && validFields(request.resource.data);
  // update의 request.resource.data는 변경 후 전체 문서이므로
  // createdAt이 기존 값과 같은지 비교해 최초 등록 시각을 보호한다.
  allow update: if validDocId()
                && validShape(request.resource.data)
                && validFields(request.resource.data)
                && request.resource.data.createdAt == resource.data.createdAt;
  allow delete: if false;
}
```

### 왜 이렇게 설계했는가

1. **`read: if false`** — 제출자는 "내가 제출했는지"만 UI에서 알 뿐,
   Firestore에서 목록을 조회하지 않습니다. 이렇게 하면 **다른 선수가
   제출한 닉네임/디스코드/MMR을 스크래핑할 수 없습니다.**
   (중복 처리는 문서 ID를 스팀 계정으로 결정적으로 생성한 뒤,
    최초 생성이 `createdAt` 불변 규칙으로 거부될 경우 `createdAt`을
    제외한 merge write를 재시도하는 방식입니다 — `js/submit.js` 참고)
2. **문서 ID 검증** (`^[0-9]{17}$` 또는 `cu_...`) — 임의 경로의
   문서 생성을 막습니다.
3. **데이터 형식 검증** — 닉네임 24자 이하, 스팀 URL 정규식,
   MMR 0~100000, 포지션 5개 배열 등. 규칙 위반 데이터는 저장 불가.
4. **`delete: if false`** — 클라이언트는 어떤 문서도 삭제할 수 없음.
   오기 접수 처리는 관리 콘솔에서 담당합니다.
5. **기타 경로 전부 차단** — `rosters` 외의 모든 경로에 접근 불가.

### 적용 방법

```bash
# 1) Firebase CLI 설치 (https://firebase.google.com/docs/cli)
npm install -g firebase-tools

# 2) 로그인
firebase login

# 3) 프로젝트에서 설정 (한 번만)
firebase use <YOUR_PROJECT_ID>

# 4) 규칙 업로드
firebase deploy --only firestore:rules
```

또는 Firebase 콘솔 → **Firestore Database → Rules** 탭에
`firestore.rules` 내용을 붙여넣고 **Publish** 버튼을 누르면 됩니다.

> ⚠️ **테스트 팁:** 규칙 변경 후 클라이언트가 기존 규칙으로 계속
> 작동하는 "캐시"가 생길 수 있으니, 배포 후 새로고침으로 재확인하세요.

---

## 3. App Check (reCAPTCHA Enterprise) — 강력 권장

보안 규칙은 "데이터의 **형식**"만 검증할 뿐, **요청이 사람이 보낸
페이지의 것인지**는 알 수 없습니다. 공개 GitHub Pages + 익명 쓰기의
경우 악성 스크립트가 같은 API 키로 스크립트 스팸을 보낼 수 있습니다.

**App Check**는 "이 요청이 실제 웹페이지에서 왔는가"를 검증하는
Firebase 내장 기능입니다.

### 설정 절차

1. Firebase 콘솔 → **App Check → 설정** → **reCAPTCHA Enterprise** 선택
   - `https://github.com/<계정>/<레포지토리>` 또는 개발 중
     `http://localhost:5500` 등을 **허용된 도메인**으로 등록
2. **사이트 키**(Site Key) 발급
3. 발급된 사이트 키를 `js/firebase-config.js`의 `appCheckSiteKey`에 입력
4. `index.html`의 주석 해제된 App Check 스크립트 2개 활성화:
   ```html
   <script src="https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check-compat.js"></script>
   <script src="https://www.gstatic.com/recaptchaenterprise/v3.js" async defer></script>
   ```
   (`js/submit.js`는 `appCheckSiteKey`가 채워지면 자동으로 활성화합니다)
5. `firestore.rules`의 `appCheckOk()` 주석 해제:
   ```rules
   function appCheckOk() {
     return request.auth.token.app == 'verified';
   }
   allow create: if appCheckOk() && validDocId() && ...;
   allow update: if appCheckOk() && ...;
   ```
6. 규칙 재배포 (`firebase deploy --only firestore:rules`)

> 💡 App Check 설정 후 **관리 콘솔의 "App Check 설정 → 실행 제한"을
> "제한(Enforce)"으로 전환**할 때까지 규칙은 무시되지 않습니다.
> (Enforcement 대기 상태: "테스트" → "제한" 순서)

---

## 4. 익명 제출의 한계와 추가 방어

"부계정이 아닌지 확인 모달"은 **약속 수준**의 장치일 뿐, 기술적으로
막을 수 없습니다. 익명(비인증) 환경의 실질적 방어 수단은 다음과 같습니다.

| 수단 | 효과 |
|---|---|
| **App Check** (↑ 3절) | 스크립트 기반 대량 스팸을 원천 차단 |
| **예산 알림 (Billing alerts)** | Firestore 요청 수가 평소 대비 급증하면 이메일 알림 |
| **사용량 모니터링** | Firebase 콘솔 → Usage에서 `rosters` 쓰기 수를 주기 확인 |
| **데이터 리뷰 프로세스** | 제출 데이터는 선발 담당자가 **수동으로 검토** 후 반영 (본 프로젝트의 기본 전제) |

### 추후 강화 시 (필요 시)

- **Firebase Auth (Google 로그인)**로 신원 확인 후
  `request.auth.uid` 기준으로 `update` 권한을 소유자만 허용:
  ```rules
  allow update: if request.auth != null
               && resource.data.uid == request.auth.uid;
  ```
- **Cloud Functions** 중간 서버: 서버 측 유효성 검사·속도 제한(레이트 리밋),
  비공개 키 사용, IP 기반 제한 가능 (비용·운영 부담 증가)

---

## 5. 운영 체크리스트

- [ ] `firestore.rules`를 **Publish** (테스트 모드가 아닌 Production)
- [ ] App Check **설정 + Enforce(제한)** 전환 완료
- [ ] 예산 알림 설정 (예: 월 한도 10% 초과 시 알림)
- [ ] `js/firebase-config.js`에 Web 설정키 입력 — **서비스 계정 키 절대 X**
- [ ] GitHub Pages 배포 후 실제 제출 1회 → Firestore 콘솔에서 문서 확인
- [ ] 같은 스팀 주소로 2회 제출 → `updatedAt` 갱신 확인 (중복 처리 검증)
- [ ] 스팀 ID 17자리/커스텀 네임 모두 테스트
- [ ] (정기) Usage 탭에서 비정상 쓰기 급증 여부 확인
