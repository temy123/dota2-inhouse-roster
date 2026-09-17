/* ============================================================
   Firebase Web 설정
   -----------------------------------------------------------
   Firebase 콘솔 → 프로젝트 개요 → "웹 앱을 추가" 에서
   발급된 설정 객체를 아래에 붙여넣어 주세요.

   ⚠️ 주의: 이 파일은 공개되는 정적 파일입니다.
       Web 설정키(apiKey 등)는 공개되어도 안전합니다.
       서버/서비스 계정 키(비공개 키)는 절대 여기에 넣지 마세요.
   실제 보안은 firestore.rules + App Check에서 담당합니다.
       → SECURITY_GUIDE.md 참고
   ============================================================ */
window.DOTA_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBL1tB2Iu8YGA9IHlRyzSnvOeQf5153asU",
  authDomain: "ota-a8c90.firebaseapp.com",
  projectId: "ota-a8c90",
  storageBucket: "ota-a8c90.appspot.com",
  messagingSenderId: "482971116584",
  appId: "1:482971116584:web:cee6206223aee2540a011d",
  // (선택) App Check(reCAPTCHA v3) 사이트 키 — SECURITY_GUIDE.md 3절 참고
//   appCheckSiteKey: "YOUR_APP_CHECK_SITE_KEY"
};
