/**
 * manager.js
 * 도타2 인하우스 관리 통합 콘솔 도구
 * 
 * 1. 서비스 계정 키 파일 입력/확인
 * 2. Firestore 등록 선수 CSV 파일 추출 (원본 / 인하우스 호환 포맷)
 * 3. Firestore 보안 규칙 선택 배포 (1. 접수 오픈 / 2. 접수 마감)
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const admin = require('firebase-admin');
const { deployFirestoreRules } = require('./rules-deployer');

// 기본 설정 경로 (실행 디렉토리 기준)
const BASE_DIR = process.cwd();
const DEFAULT_KEY_PATH = path.join(BASE_DIR, 'serviceAccountKey.json');
const RULES_DIR = path.join(__dirname, 'rules');
const EXPORTS_DIR = path.join(BASE_DIR, 'exports');
const RAW_DIR = path.join(EXPORTS_DIR, 'raw');
const INHOUSE_DIR = path.join(EXPORTS_DIR, 'inhouse');

// 포지션 매핑
const POS_LABELS = {
  carry: '캐리(1)',
  mid: '미드(2)',
  offlane: '오프(3)',
  pos4: '4번 서폿(4)',
  pos5: '5번 서폿(5)'
};

const POS_ENUM = {
  carry: 1,
  mid: 2,
  offlane: 3,
  pos4: 4,
  pos5: 5
};

function formatPositions(positions) {
  if (!Array.isArray(positions)) return '';
  return positions.map((p, idx) => `${idx + 1}순위: ${POS_LABELS[p] || p}`).join(' / ');
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Seoul'
  }).format(date);
}

function escapeCsv(value) {
  if (value === null || value === undefined) return '""';
  const str = String(value);
  return `"${str.replace(/"/g, '""')}"`;
}

function prompt(rl, query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

let loadedServiceAccount = null;
let currentKeyPath = '';
let firebaseApp = null;

/**
 * 서비스 계정 JSON 로드 및 검증
 */
function loadKey(filePath) {
  try {
    let cleanPath = filePath.trim();
    // 윈도우 경로 양끝 따옴표 제거 (드래그 앤 드롭 시 자동 추가되는 " 경로 ")
    if ((cleanPath.startsWith('"') && cleanPath.endsWith('"')) ||
        (cleanPath.startsWith("'") && cleanPath.endsWith("'"))) {
      cleanPath = cleanPath.slice(1, -1);
    }
    const resolvedPath = path.isAbsolute(cleanPath) ? cleanPath : path.resolve(BASE_DIR, cleanPath);
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, message: `파일을 찾을 수 없습니다: ${resolvedPath}` };
    }
    const content = fs.readFileSync(resolvedPath, 'utf8');
    const json = JSON.parse(content);
    if (!json.project_id || !json.private_key || !json.client_email) {
      return { success: false, message: '올바른 Firebase 서비스 계정 JSON 형식이 아닙니다 (project_id, private_key 필요).' };
    }
    return { success: true, json, path: resolvedPath };
  } catch (err) {
    return { success: false, message: `JSON 파싱 오류: ${err.message}` };
  }
}

/**
 * Firebase Admin DB 인스턴스 초기화
 */
function getFirestoreDb(serviceAccount) {
  if (!firebaseApp) {
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    }, `app-${Date.now()}`);
  }
  return firebaseApp.firestore();
}

/**
 * 1. CSV 내보내기 실행
 */
async function handleExportCsv() {
  console.log('\n------------------------------------------------------------');
  console.log('📥 Firestore에서 선수 데이터를 불러오는 중입니다...');
  try {
    const db = getFirestoreDb(loadedServiceAccount);
    const snapshot = await db.collection('rosters').get();

    if (snapshot.empty) {
      console.log('⚠️ [알림] rosters 컬렉션에 등록된 선수가 없습니다.');
      return;
    }

    console.log(`✅ 총 ${snapshot.size}명의 선수 데이터를 성공적으로 조회했습니다.`);

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const timestampStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
    if (!fs.existsSync(INHOUSE_DIR)) fs.mkdirSync(INHOUSE_DIR, { recursive: true });

    // 원본 헤더
    const rawHeaders = [
      '문서ID', '닉네임', 'MMR', '디스코드ID', '스팀URL', 'SteamID64', '스팀커스텀네임',
      '1지망', '2지망', '3지망', '4지망', '5지망', '포지션요약', '최초등록일시(KST)', '최종수정일시(KST)'
    ];
    const rawRows = [rawHeaders.map(escapeCsv).join(',')];

    // 인하우스 선수단 헤더
    const inhouseHeaders = [
      '이름', '불러온MMR', '인하우스MMR', '변동', '경기', '승', '패', '승률',
      '1지망', '2지망', '3지망', '4지망', '5지망',
      '캐리판수', '미드판수', '오프판수', '4번서폿판수', '5번서폿판수', '주포지션', '최근흐름'
    ];
    const inhouseRows = [inhouseHeaders.join(',')];

    snapshot.forEach(doc => {
      const d = doc.data();
      const pos = Array.isArray(d.positions) ? d.positions : [];
      const nickname = d.nickname || '';
      const mmr = d.mmr !== undefined ? d.mmr : 0;

      // 1) 원본 데이터
      const rawRow = [
        doc.id,
        nickname,
        mmr,
        d.discordId || '',
        d.steamUrl || '',
        d.steamId || '',
        d.customName || '',
        POS_LABELS[pos[0]] || pos[0] || '',
        POS_LABELS[pos[1]] || pos[1] || '',
        POS_LABELS[pos[2]] || pos[2] || '',
        POS_LABELS[pos[3]] || pos[3] || '',
        POS_LABELS[pos[4]] || pos[4] || '',
        formatPositions(pos),
        formatDate(d.createdAt),
        formatDate(d.updatedAt)
      ];
      rawRows.push(rawRow.map(escapeCsv).join(','));

      // 2) 인하우스 호환 데이터
      const p1 = POS_ENUM[pos[0]] || '';
      const p2 = POS_ENUM[pos[1]] || '';
      const p3 = POS_ENUM[pos[2]] || '';
      const p4 = POS_ENUM[pos[3]] || '';
      const p5 = POS_ENUM[pos[4]] || '';

      const inhouseRow = [
        escapeCsv(nickname),
        mmr,
        mmr,
        0, 0, 0, 0, '',
        p1, p2, p3, p4, p5,
        0, 0, 0, 0, 0,
        '', ''
      ];
      inhouseRows.push(inhouseRow.join(','));
    });

    const rawFilename = `rosters_${timestampStr}.csv`;
    const inhouseFilename = `인하우스_선수단_${timestampStr}.csv`;

    const rawOutputPath = path.join(RAW_DIR, rawFilename);
    const inhouseOutputPath = path.join(INHOUSE_DIR, inhouseFilename);

    fs.writeFileSync(rawOutputPath, '\uFEFF' + rawRows.join('\r\n'), 'utf-8');
    fs.writeFileSync(inhouseOutputPath, '\uFEFF' + inhouseRows.join('\r\n'), 'utf-8');

    console.log('\n============================================================');
    console.log('🎉 2종류의 CSV 파일 출력이 완료되었습니다!');
    console.log('------------------------------------------------------------');
    console.log(`📁 1. 원본 상세 CSV:`);
    console.log(`   ${rawOutputPath}`);
    console.log(`📁 2. 인하우스 선수단 호환 CSV:`);
    console.log(`   ${inhouseOutputPath}`);
    console.log('============================================================');
  } catch (err) {
    console.error('❌ CSV 추출 실패:', err.message);
  }
}

/**
 * 2. Firestore 보안 규칙 배포 실행
 */
async function handleDeployRules(rl) {
  console.log('\n------------------------------------------------------------');
  console.log('🛡️  Firestore 보안 규칙 선택:');
  console.log(' 1) [접수 오픈] 선수 입력 허용 (신규 등록 및 수정 허용)');
  console.log(' 2) [접수 마감] 선수 입력 차단 (모든 제출 및 수정 금지)');
  console.log(' 0) 취소 (메인 메뉴로 돌아가기)');
  console.log('------------------------------------------------------------');

  const choice = (await prompt(rl, '적용할 규칙 번호를 선택하세요 (0-2): ')).trim();

  let targetRuleFile = '';
  let ruleName = '';

  if (choice === '1') {
    targetRuleFile = path.join(RULES_DIR, 'firestore.open.rules');
    ruleName = '접수 오픈 (선수 등록 허용)';
  } else if (choice === '2') {
    targetRuleFile = path.join(RULES_DIR, 'firestore.closed.rules');
    ruleName = '접수 마감 (선수 등록 차단)';
  } else {
    console.log('배포를 취소했습니다.');
    return;
  }

  if (!fs.existsSync(targetRuleFile)) {
    console.error(`❌ 규칙 파일을 찾을 수 없습니다: ${targetRuleFile}`);
    return;
  }

  const rulesContent = fs.readFileSync(targetRuleFile, 'utf8');

  console.log(`\n📡 Firebase 서버로 [${ruleName}] 규칙을 배포하는 중입니다...`);
  try {
    const result = await deployFirestoreRules(loadedServiceAccount, rulesContent);
    console.log('\n============================================================');
    console.log(`🎉 Firestore 보안 규칙 배포 성공!`);
    console.log(`- 프로젝트 ID: ${result.projectId}`);
    console.log(`- 적용 상태: [${ruleName}]`);
    console.log(`- 릴리스: ${result.releaseName}`);
    console.log('============================================================');
  } catch (err) {
    console.error('\n❌ 보안 규칙 배포 실패:', err.message);
    console.log('💡 팁: 서비스 계정에 "Firebase Rules Admin" 또는 "Editor" 권한이 부여되어 있는지 확인하세요.');
  }
}

/**
 * 메인 실행 진입점
 */
async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('============================================================');
  console.log('       ⚔️  도타2 인하우스 대회 통합 관리자 도구  ⚔️       ');
  console.log('============================================================');

  // 1. 서비스 계정 키 탐색 및 입력
  while (!loadedServiceAccount) {
    if (fs.existsSync(DEFAULT_KEY_PATH) && !currentKeyPath) {
      console.log(`\n🔎 기본 키 파일을 발견했습니다: ${DEFAULT_KEY_PATH}`);
      const confirm = (await prompt(rl, '이 서비스 계정 키를 사용하시겠습니까? (Y/n): ')).trim().toLowerCase();
      if (confirm === '' || confirm === 'y' || confirm === 'yes') {
        const res = loadKey(DEFAULT_KEY_PATH);
        if (res.success) {
          loadedServiceAccount = res.json;
          currentKeyPath = res.path;
          console.log(`✅ [${loadedServiceAccount.project_id}] 프로젝트 키가 성공적으로 로드되었습니다.`);
          break;
        } else {
          console.error(`❌ ${res.message}`);
        }
      }
    }

    console.log('\n🔑 서비스 계정 JSON 파일 경로를 입력하세요.');
    console.log('   (파일을 이 창에 드래그 앤 드롭한 뒤 Enter를 누르셔도 됩니다.)');
    const inputPath = await prompt(rl, '파일 경로 > ');
    if (!inputPath.trim()) continue;

    const res = loadKey(inputPath);
    if (res.success) {
      loadedServiceAccount = res.json;
      currentKeyPath = res.path;
      console.log(`✅ [${loadedServiceAccount.project_id}] 프로젝트 키가 성공적으로 로드되었습니다.`);
    } else {
      console.error(`❌ ${res.message}`);
    }
  }

  // 2. 메인 대화형 메뉴 루프
  let running = true;
  while (running) {
    console.log('\n============================================================');
    console.log(` [현재 연결된 프로젝트: ${loadedServiceAccount.project_id}]`);
    console.log(' 1. 📥 등록 선수 데이터 CSV 내보내기 (원본 및 호환 포맷)');
    console.log(' 2. 🛡️  Firestore 보안 규칙 설정 (접수 오픈 / 접수 마감)');
    console.log(' 3. 🔄 서비스 계정 키 파일 변경');
    console.log(' 0. 🚪 종료');
    console.log('============================================================');

    const choice = (await prompt(rl, '원하는 작업 번호를 입력하세요: ')).trim();

    switch (choice) {
      case '1':
        await handleExportCsv();
        break;
      case '2':
        await handleDeployRules(rl);
        break;
      case '3': {
        console.log('\n새로운 서비스 계정 JSON 파일 경로를 입력하세요:');
        const newPath = await prompt(rl, '파일 경로 > ');
        const res = loadKey(newPath);
        if (res.success) {
          loadedServiceAccount = res.json;
          currentKeyPath = res.path;
          firebaseApp = null; // 앱 재초기화
          console.log(`✅ [${loadedServiceAccount.project_id}] 프로젝트로 전환되었습니다.`);
        } else {
          console.error(`❌ ${res.message}`);
        }
        break;
      }
      case '0':
      case 'q':
      case 'exit':
        console.log('\n프로그램을 종료합니다.');
        running = false;
        break;
      default:
        console.log('⚠️ 유효하지 않은 번호입니다. 다시 입력해주세요.');
        break;
    }
  }

  rl.close();
}

main().catch(err => {
  console.error('치명적인 오류 발생:', err);
  process.exit(1);
});
