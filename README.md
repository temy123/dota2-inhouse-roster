# ⚔ 도타2 인하우스 로스터 등록 페이지

GitHub Pages에 배포하는 **정적(Static) 제출 페이지**입니다.
선수가 5단계(닉네임 → 스팀 프로필 → 디스코드 → MMR → 포지션 우선순위)를
마친 뒤 제출하면 **Cloud Firestore**에 저장되며, 같은 스팀 프로필로
제출하면 기존 정보가 갱신됩니다.

- 프레임워크 없음: 순수 HTML/CSS/JS + Firebase compat SDK(CDN)
- 한글 대폰트(Noto Sans KR) 기반 풀스크린 단계형 UI
- CSS 애니메이션: 배경 그라디언트/입자, 단계 전환 슬라이드, 태그 드래그,
  모달 줌인, 체크마크 드로잉 등
- 보안: [`firestore.rules`](firestore.rules) + [`SECURITY_GUIDE.md`](SECURITY_GUIDE.md)

## 📁 파일 구조

```
├── index.html               # 메인 페이지 (6단계 위저드)
├── css/
│   └── style.css            # 레이아웃 + 애니메이션
├── js/
│   ├── firebase-config.js   # ← Firebase Web 설정을 입력할 파일
│   ├── app.js               # 단계 제어 / 검증 / 태그 드래그 / 모달
│   └── submit.js            # Firestore 저장, 중복(스팀) 처리
├── firestore.rules          # Firestore 보안 규칙 (반드시 배포)
├── SECURITY_GUIDE.md        # Firebase 보안 설정 가이드
├── export-csv.js            # Firestore 로스터 CSV 추출 스크립트
├── package.json             # 관리 스크립트 실행용 패키지 설정
└── README.md
```

## 🛠️ 통합 관리 도구 실행 안내 (주최자/관리자용)

보안 규칙 설정(접수 오픈/마감) 및 등록 선수 명단 CSV 추출을 손쉽게 수행할 수 있는 대화형 관리 프로그램이 제공됩니다.

### 1) 서비스 계정 키(Service Account) 준비
1. [Firebase 콘솔](https://console.firebase.google.com) 접속
2. 프로젝트 설정(⚙️) → **서비스 계정(Service Accounts)** 탭
3. **새 비공개 키 생성(Generate new private key)** 클릭 → JSON 파일 다운로드
4. 다운로드된 JSON 파일을 프로그램 루트 폴더에 넣거나, 프로그램 실행 후 파일 경로를 직접 입력/드래그 앤 드롭하시면 됩니다.
   > 💡 **보안 규칙 원클릭 배포 시 필요한 권한:**
   > Firebase 콘솔에서 발급한 기본 서비스 계정은 편집자(Editor) 권한을 가지고 있어 바로 배포가 가능합니다. 만약 별도 IAM 계정을 쓰신다면 `Firebase Rules Admin` 역할을 부여해주세요.

### 2) 간편 실행 방법
- **Windows 더블 클릭 실행**: [`run.bat`](run.bat) 파일을 더블 클릭하면 자동으로 필수 패키지 점검 후 실행됩니다.
- **명령 프롬프트/터미널 실행**:
  ```bash
  npm start
  # 또는
  node manager.js
  ```

### 3) 주요 제공 기능
1. **📥 등록 선수 데이터 CSV 내보내기**:
   - `exports/raw/rosters_YYYYMMDD_HHMMSS.csv`: 원본 상세 데이터 (스팀 URL, 디스코드, 타임스탬프 등)
   - `exports/inhouse/인하우스_선수단_YYYYMMDD_HHMMSS.csv`: 대회/매칭 프로그램 호환 데이터 (1~5지망 숫자 enum 매핑, UTF-8 BOM 지원)
2. **🛡️ Firestore 보안 규칙 원클릭 설정**:
   - `1) [접수 오픈]`: 신규 선수 등록 및 정보 수정을 허용하는 규칙 배포
   - `2) [접수 마감]`: 모든 제출 및 수정을 거부(Permission Denied)하는 규칙 배포
3. **🔄 서비스 계정 키 변경**:
   - 프로그램 종료 없이 다른 Firebase 프로젝트의 JSON 키로 즉시 전환

## 🚀 설정 절차 (Firebase)

### 1) Firebase 프로젝트 준비

1. [Firebase 콘솔](https://console.firebase.google.com)에서 프로젝트 생성
   (Billing 연동은 Firestore Free tier 사용에 필요)
2. **Firestore Database** → **데이터베이스 만들기**
   - 환경: **Production**, 지역: `asia-northeast1`(도쿄) 권장
3. **프로젝트 개요** → ⚙️(설정) 아이콘 → **일반** 탭
   - **웹 앱(</> ) 추가** → 앱 등록
   - 발급된 **Web 설정 객체**(apiKey, projectId, …)를 복사

### 2) 설정 입력

`js/firebase-config.js`의 `YOUR_` 값을 복사한 설정으로 교체:

```js
window.DOTA_FIREBASE_CONFIG = {
  apiKey: "AIzaSy...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123",
  appCheckSiteKey: "YOUR_APP_CHECK_SITE_KEY" // 선택
};
```

> ⚠️ Web 설정키는 공개되어도 안전합니다. 서비스 계정(비공개) 키는
> 절대 이 파일에 넣지 마세요 — [`SECURITY_GUIDE.md`](SECURITY_GUIDE.md) 1절.

### 3) 보안 규칙 배포 (필수)

1. `firestore.rules` 내용을 Firebase 콘솔 → **Firestore Database → Rules**
    에 붙여넣고 **Publish**
    - 또는 CLI: `firebase deploy --only firestore:rules`
   - 이번 수정에는 기존 문서의 `createdAt` 보존 조건이 포함되어 있으므로,
     이전에 규칙을 게시했더라도 반드시 현재 파일 전체를 다시 Publish해야 합니다.
2. **(강력 권장) App Check 설정** — [`SECURITY_GUIDE.md`](SECURITY_GUIDE.md) 3절
3. **예산 알림** 설정 (비정상 트래픽 방어)

### 4) 동작 검증

- `index.html`을 브라우저로 열기 (Firebase에 연결되면 `file://`도 동작)
- 또는 로컬 서버: `npx serve .`
- 제출 1회 → Firestore 콘솔 `rosters` 컬렉션에 문서 생성 확인
- 같은 스팀 주소로 재제출 → `updatedAt` 갱신(업데이트) 확인
- 제출이 거부되면 브라우저 개발자 도구 **Console**에서
  `Firestore roster write failed` 로그의 `initialCode`, `updateCode`, `docId`를 확인

## 🌐 GitHub Pages 배포

1. 이 폴더를 Git 저장소로 푸시:
   ```bash
   git init
   git add .
   git commit -m "feat: dota2 inhouse roster submit page"
   git branch -M main
   git remote add origin https://github.com/<계정>/<레포지토리>.git
   git push -u origin main
   ```
2. GitHub 레포지토리 → **Settings → Pages**
   - **Source**: `Deploy from a branch` → Branch: `main`, Folder: `/ (root)`
   - **Save**
3. 약 1분 뒤 `https://<계정>.github.io/<레포지토리>/`에서 페이지 확인

> **App Check 도메인**: Pages URL(`https://<계정>.github.io/<레포지토리>`)을
> App Check 허용 도메인에 등록해야 스크립트 검증이 통과합니다.

## 🔄 데이터 모델 (`rosters` 컬렉션)

| 필드 | 타입 | 설명 |
|---|---|---|
| 문서 ID | — | 스팀 계정 기준: 17자리 Steam ID 또는 `cu_<커스텀네임>` |
| `nickname` | string(1~24) | 도타2 닉네임 |
| `steamUrl` | string | 스팀 프로필 URL 원문 |
| `steamId` | string(17) \| null | 17자리 Steam ID (커스텀 네임 시 null) |
| `customName` | string \| null | 소문자 커스텀 네임 (숫자 ID 시 null) |
| `discordId` | string(1~64) | 디스코드 아이디 |
| `mmr` | int(0~100000) | 현재 MMR |
| `positions` | list(5) | 우선순위 순서, 예: `["mid","carry","offlane","pos4","pos5"]` |
| `createdAt` | timestamp | 최초 등록 시각 (업데이트 시 불변) |
| `updatedAt` | timestamp | 최종 갱신 시각 |

### 중복 처리(업데이트) 로직

1. 제출 시 스팀 URL에서 계정을 추출해 **문서 ID를 결정적으로 생성**
   (숫자 ID: ID 그대로 / 커스텀 네임: `cu_` + 소문자 네임)
2. 전체 필드(`createdAt` 포함)로 저장을 먼저 시도합니다. 새 문서이면 생성됩니다.
3. 기존 문서라면 규칙이 `createdAt` 변경을 거부하고, 앱은 `createdAt`을 제외한
   merge write를 즉시 재시도하여 기존 정보를 갱신합니다.
4. read 권한이 없어도 동작하므로 다른 제출자의 데이터를 열람할 수 없습니다.

> **한계:** 스팀 **커스텀 네임을 변경**한 선수는 "신규"로 재등록됩니다.
> 숫자 ID 주소 제출을 권장하는 안내(페이지 STEP 2)를 제공하고 있습니다.

## 🛡️ 보안 요약

상세 설명은 [`SECURITY_GUIDE.md`](SECURITY_GUIDE.md) 참고.

1. ✅ Web 설정키는 공개, **비공개 키는 절대 클라이언트에 미포함**
2. ✅ `firestore.rules`: read 차단 / 필드·문서 ID 검증 / delete 금지
3. ✅ App Check(reCAPTCHA Enterprise)로 스크립트 스팸 방지 (권장)
4. ⚠️ 익명 제출은 "부계정"을 기술적으로 차단 불가 →
   제출 전 확인 모달(약속) + 관리자 수동 검토가 기본 전제
5. ✅ 예산 알림 + 사용량 모니터링
