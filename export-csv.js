/**
 * export-csv.js
 * Firestore rosters 컬렉션의 데이터를 조회하여 두 가지 CSV 파일로 각각 폴더별로 추출하는 스크립트
 * 
 * 출력 1) 원본 로스터 폴더: exports/raw/rosters_YYYYMMDD_HHMMSS.csv
 *         - Firestore에 저장된 메타데이터(스팀URL, Discord ID, 타임스탬프 등)를 포함한 원본 상세 데이터
 * 출력 2) 인하우스 선수단 폴더: exports/inhouse/인하우스_선수단_YYYYMMDD_HHMMSS.csv
 *         - '인하우스_선수단.csv' 포맷에 맞춘 매칭/경기 시스템 호환 데이터
 *         - 1~5지망: 1(캐리), 2(미드), 3(오프), 4(4번서폿), 5(5번서폿) 숫자 enum
 *         - 불러온MMR, 인하우스MMR 모두 원본 MMR 동일 값 지정
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'serviceAccountKey.json');
const COLLECTION_NAME = 'rosters';

// 저장 디렉토리 설정
const EXPORTS_DIR = path.join(__dirname, 'exports');
const RAW_DIR = path.join(EXPORTS_DIR, 'raw');
const INHOUSE_DIR = path.join(EXPORTS_DIR, 'inhouse');

// 텍스트 라벨 (원본 CSV용)
const POS_LABELS = {
  carry: '캐리(1)',
  mid: '미드(2)',
  offlane: '오프(3)',
  pos4: '4번 서폿(4)',
  pos5: '5번 서폿(5)'
};

// 숫자 enum 매핑 (인하우스 선수단 CSV용)
// 1- 캐리, 2- 미드, 3- 오프, 4- 4번서폿, 5- 5번서폿
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

async function main() {
  if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
    console.error('\n❌ [오류] serviceAccountKey.json 파일을 찾을 수 없습니다.');
    console.error('------------------------------------------------------------');
    console.error('1. Firebase 콘솔(https://console.firebase.google.com)로 이동하세요.');
    console.error('2. 프로젝트 설정(톱니바퀴 아이콘) -> "서비스 계정" 탭으로 이동합니다.');
    console.error('3. "새 비공개 키 생성" 버튼을 클릭하여 JSON 키 파일을 다운로드합니다.');
    console.error('4. 다운로드된 파일의 이름을 "serviceAccountKey.json"으로 변경한 뒤');
    console.error('   본 프로젝트 루트 폴더에 넣어주세요.');
    console.error('------------------------------------------------------------\n');
    process.exit(1);
  }

  const serviceAccount = require(SERVICE_ACCOUNT_PATH);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  const db = admin.firestore();
  console.log('📡 Firestore에 연결하는 중...');

  try {
    const snapshot = await db.collection(COLLECTION_NAME).get();

    if (snapshot.empty) {
      console.log('⚠️ rosters 컬렉션에 등록된 선수가 없습니다.');
      return;
    }

    console.log(`✅ 총 ${snapshot.size}명의 선수 데이터를 가져왔습니다.`);

    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    const timestampStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    // 폴더 생성 (없으면 자동 생성)
    if (!fs.existsSync(RAW_DIR)) {
      fs.mkdirSync(RAW_DIR, { recursive: true });
    }
    if (!fs.existsSync(INHOUSE_DIR)) {
      fs.mkdirSync(INHOUSE_DIR, { recursive: true });
    }

    // -------------------------------------------------------------
    // 1. 원본 상세 CSV 생성
    // -------------------------------------------------------------
    const rawHeaders = [
      '문서ID',
      '닉네임',
      'MMR',
      '디스코드ID',
      '스팀URL',
      'SteamID64',
      '스팀커스텀네임',
      '1지망',
      '2지망',
      '3지망',
      '4지망',
      '5지망',
      '포지션요약',
      '최초등록일시(KST)',
      '최종수정일시(KST)'
    ];

    const rawRows = [rawHeaders.map(escapeCsv).join(',')];

    // -------------------------------------------------------------
    // 2. 인하우스_선수단 포맷 CSV 생성
    // 헤더: 이름,불러온MMR,인하우스MMR,변동,경기,승,패,승률,1지망,2지망,3지망,4지망,5지망,캐리판수,미드판수,오프판수,4번서폿판수,5번서폿판수,주포지션,최근흐름
    // -------------------------------------------------------------
    const inhouseHeaders = [
      '이름',
      '불러온MMR',
      '인하우스MMR',
      '변동',
      '경기',
      '승',
      '패',
      '승률',
      '1지망',
      '2지망',
      '3지망',
      '4지망',
      '5지망',
      '캐리판수',
      '미드판수',
      '오프판수',
      '4번서폿판수',
      '5번서폿판수',
      '주포지션',
      '최근흐름'
    ];

    const inhouseRows = [inhouseHeaders.join(',')];

    snapshot.forEach(doc => {
      const d = doc.data();
      const pos = Array.isArray(d.positions) ? d.positions : [];
      const nickname = d.nickname || '';
      const mmr = d.mmr !== undefined ? d.mmr : 0;

      // --- 원본 행 구성 ---
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

      // --- 인하우스_선수단 행 구성 ---
      const p1 = POS_ENUM[pos[0]] || '';
      const p2 = POS_ENUM[pos[1]] || '';
      const p3 = POS_ENUM[pos[2]] || '';
      const p4 = POS_ENUM[pos[3]] || '';
      const p5 = POS_ENUM[pos[4]] || '';

      const inhouseRow = [
        escapeCsv(nickname), // 이름 (큰따옴표)
        mmr,                 // 불러온MMR
        mmr,                 // 인하우스MMR
        0,                   // 변동
        0,                   // 경기
        0,                   // 승
        0,                   // 패
        '',                  // 승률
        p1,                  // 1지망 (숫자)
        p2,                  // 2지망 (숫자)
        p3,                  // 3지망 (숫자)
        p4,                  // 4지망 (숫자)
        p5,                  // 5지망 (숫자)
        0,                   // 캐리판수
        0,                   // 미드판수
        0,                   // 오프판수
        0,                   // 4번서폿판수
        0,                   // 5번서폿판수
        '',                  // 주포지션
        ''                   // 최근흐름
      ];
      inhouseRows.push(inhouseRow.join(','));
    });

    // 엑셀 한글 깨짐 방지 UTF-8 BOM
    const rawCsvContent = '\uFEFF' + rawRows.join('\r\n');
    const inhouseCsvContent = '\uFEFF' + inhouseRows.join('\r\n');

    const rawFilename = `rosters_${timestampStr}.csv`;
    const inhouseFilename = `인하우스_선수단_${timestampStr}.csv`;

    const rawOutputPath = path.join(RAW_DIR, rawFilename);
    const inhouseOutputPath = path.join(INHOUSE_DIR, inhouseFilename);

    fs.writeFileSync(rawOutputPath, rawCsvContent, 'utf-8');
    fs.writeFileSync(inhouseOutputPath, inhouseCsvContent, 'utf-8');

    console.log('\n============================================================');
    console.log('🎉 2가지 형식의 CSV 파일이 폴더별로 저장되었습니다!');
    console.log('------------------------------------------------------------');
    console.log(`1️⃣ [원본 로스터 데이터]`);
    console.log(`   📂 저장 폴더: exports/raw/`);
    console.log(`   📄 파일명: ${rawFilename}`);
    console.log(`   📍 전체 경로: ${rawOutputPath}`);
    console.log('');
    console.log(`2️⃣ [인하우스 선수단 호환 데이터]`);
    console.log(`   📂 저장 폴더: exports/inhouse/`);
    console.log(`   📄 파일명: ${inhouseFilename}`);
    console.log(`   📍 전체 경로: ${inhouseOutputPath}`);
    console.log('------------------------------------------------------------');
    console.log('💡 두 파일 모두 UTF-8 BOM이 적용되어 Excel에서 바로 열어도 한글이 깨지지 않습니다.');
    console.log('============================================================\n');

  } catch (error) {
    console.error('❌ 데이터 내보내기 중 오류 발생:', error);
  }
}

main();
