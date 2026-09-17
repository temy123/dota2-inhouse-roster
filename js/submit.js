/* ============================================================
   submit.js — Firestore 저장 / 중복(스팀 프로필) 처리
   -----------------------------------------------------------
   · 스팀 URL: "steam으로 시작하고 숫자로 끝"이면 모두 허용
       (https/http, www, 종료 슬래시(/) 유무 관계없이)
   · 문서 ID를 스팀 계정으로 결정적(deterministic)하게 생성
       - URL 마지막 숫자가 17자리(Steam ID64) → 그대로 사용
         (예: 76561197990650432)
       - 그 외 → 'cu_' + (커스텀 네임 또는 마지막 숫자)
         (예: cu_nota123, cu_1234)
   · "전체 생성 시도 → 권한 거부 시 변경 필드만 갱신" 방식
        - Web SDK의 set()은 기존 문서에 대해 자동으로 update가 되므로,
          'already exists' 오류가 발생하지 않는다.
        - 최초 저장은 createdAt을 포함한 전체 문서로 생성하고,
          기존 문서는 createdAt을 제외한 merge write로 갱신한다.
       - 이렇게 하면 클라이언트가 다른 제출자의 문서 목록·내용을
         열람(read)할 필요가 없으므로, firestore.rules에서
         read를 완전 차단한 상태에서도 정상 동작
   ============================================================ */
(function () {
  'use strict';

  var COLLECTION = 'rosters';
  var db = null;

  /* ---------- Firebase 초기화 (지연 실행: 제출 버튼 클릭 시) ---------- */
  function isConfigured() {
    var c = window.DOTA_FIREBASE_CONFIG;
    return !!(c && c.apiKey && c.projectId &&
      c.apiKey.indexOf('YOUR_') !== 0 && c.projectId.indexOf('YOUR_') !== 0);
  }

  function init() {
    if (db) return db;
    if (!isConfigured()) {
      throw new Error('Firebase 설정이 필요합니다. js/firebase-config.js에 웹 앱 설정을 입력해 주세요. (README.md 참고)');
    }
    if (typeof firebase === 'undefined') {
      throw new Error('Firebase SDK를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
    }
    var app = firebase.initializeApp(window.DOTA_FIREBASE_CONFIG);

    // App Check (선택): app-check-compat 스크립트를 로드하고
    // appCheckSiteKey를 채운 경우에만 활성화 — SECURITY_GUIDE.md 3절
    var siteKey = window.DOTA_FIREBASE_CONFIG.appCheckSiteKey;
    if (typeof firebase.appCheck === 'function' &&
      typeof window.recaptcha !== 'undefined' &&
      siteKey && siteKey.indexOf('YOUR_') !== 0) {
      try {
        firebase.appCheck(app).activate(
          recaptcha.enterprise.provider({ siteKey: siteKey })
        );
      } catch (e) {
        console.warn('App Check 활성화에 실패했습니다:', e);
      }
    }

    db = firebase.firestore();
    return db;
  }

  /* ---------- 스팀 URL → 계정 식별자 추출 ---------- */
  // URL 끝 숫자 (종료 슬래시 포함 허용)
  function tailNumberFromUrl(url) {
    var m = url.match(/(\d+)\s*\/?\s*$/i);
    return m ? m[1] : null;
  }
  // 17자리 Steam ID64인지 판단
  function steamIdFromUrl(url) {
    var n = tailNumberFromUrl(url);
    return n && n.length === 17 ? n : null;
  }
  function customNameFromUrl(url) {
    var m = url.match(/\/id\/([A-Za-z0-9._-]{2,32})/i);
    return m ? m[1].toLowerCase() : null;
  }
  function docIdFor(steamUrl) {
    var id64 = steamIdFromUrl(steamUrl);
    if (id64) return id64;
    var name = customNameFromUrl(steamUrl);
    if (name) return 'cu_' + name;
    var tail = tailNumberFromUrl(steamUrl);
    if (tail) return 'cu_' + tail;

    // steamcommunity.com이 포함되어 있으나 위 규칙으로 고유 키를 뽑지 못하는 경우 fallback
    if (steamUrl.indexOf('steamcommunity.com') !== -1) {
      var cleaned = steamUrl.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      if (cleaned.length > 0) {
        return 'cu_' + cleaned.substring(0, 50);
      }
    }
    return null;
  }

  /* ---------- 오류 메시지 번역 ---------- */
  function friendlyError(err) {
    var code = err && err.code;
    var map = {
      'permission-denied':
        '저장에 권한이 없습니다. Firestore 보안 규칙(firestore.rules)이 게시(publish)되었는지, 입력 내용이 규칙을 위반하는지 확인해 주세요.',
      'unavailable': '서버에 연결할 수 없습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.',
      'network-unavailable': '네트워크 연결을 확인해 주세요.',
      'deadline-exceeded': '요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.',
      'resource-exhausted': '사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.'
    };
    return new Error(map[code] || ('제출에 실패했습니다 (' + (code || 'unknown error') + ').'));
  }

  /* ---------- 제출: create → (기존 문서) → createdAt 보존 update ---------- */
  window.submitRoster = function (data) {
    return new Promise(function (resolve, reject) {
      var database;
      try { database = init(); } catch (e) { reject(e); return; }

      var docId = docIdFor(data.steam);
      if (!docId) {
        reject(new Error('스팀 프로필 주소에서 계정을 인식할 수 없습니다. 주소를 확인해 주세요.'));
        return;
      }

      var ref = database.collection(COLLECTION).doc(docId);
      var now = firebase.firestore.FieldValue.serverTimestamp();

      // 신규 등록 시 저장할 전체 데이터
      var full = {
        nickname: data.nickname,
        steamUrl: data.steam,
        steamId: steamIdFromUrl(data.steam),
        customName: customNameFromUrl(data.steam),
        discordId: data.discord,
        mmr: data.mmr,
        positions: data.positions,
        createdAt: now,
        updatedAt: now
      };
      // 이미 등록된 경우 갱신할 데이터 (createdAt는 절대 건드리지 않음)
      var update = Object.assign({}, full);
      delete update.createdAt;

      // set(full)은 신규 문서에서는 create로 처리된다. 기존 문서에서는
      // rules의 createdAt 불변 조건에 의해 거부되고 아래 merge write로 이어진다.
      ref.set(full)
        .then(function () {
          resolve({ created: true, id: docId });
        })
        .catch(function (err) {
          if (!err || err.code !== 'permission-denied') {
            reject(friendlyError(err));
            return;
          }

          // 읽기 권한 없이 기존 문서 여부를 알 수 없으므로, createdAt을 제외한
          // merge write를 시도한다. 기존 문서라면 update로 허용되고, 없는
          // 문서라면 create 필수 필드(createdAt) 누락으로 다시 거부된다.
          ref.set(update, { merge: true })
            .then(function () {
              resolve({ created: false, id: docId });
            })
            .catch(function (updateErr) {
              console.warn('Firestore roster write failed:', {
                docId: docId,
                initialCode: err.code || 'unknown',
                updateCode: updateErr && updateErr.code || 'unknown'
              });
              reject(friendlyError(updateErr));
            });
        });
    });
  };
})();
