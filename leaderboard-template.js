/**
 * leaderboard-template.js
 * 공개 리더보드용 데이터 정제 및 템플릿 변환 모듈
 * 
 * - 민감한 개인정보(스팀 링크, 디스코드 등) 배제
 * - 포지션(prefs)은 요구사항에 따라 1지망, 2지망까지만 공개 데이터에 포함
 * - 랭킹 산출, 통계 요약 데이터 생성
 */

const ROLE_MAP = {
  1: { id: 1, key: 'carry', label: '캐리 (1)' },
  2: { id: 2, key: 'mid', label: '미드 (2)' },
  3: { id: 3, key: 'offlane', label: '오프 (3)' },
  4: { id: 4, key: 'pos4', label: '4서폿 (4)' },
  5: { id: 5, key: 'pos5', label: '5서폿 (5)' }
};

/**
 * 원본 로스터 JSON 데이터를 공개용 리더보드 템플릿 구조로 변환
 * @param {Object} rawData - 원본 JSON (public-roaster/YYYY-MM-DD-HHmm.json 형태)
 * @param {Object} [meta] - 부가 메타데이터 (제목, 설명 등)
 */
function createPublicLeaderboardData(rawData, meta = {}) {
  const players = Array.isArray(rawData.players) ? rawData.players : [];
  const matches = Array.isArray(rawData.matches) ? rawData.matches : [];
  
  // 1. 선수 데이터 가공 및 정렬 (MMR 내림차순 -> 승률 내림차순 -> 이름 순)
  const sortedPlayers = [...players].sort((a, b) => {
    const mmrA = a.mmr !== undefined ? a.mmr : (a.baseMMR || 0);
    const mmrB = b.mmr !== undefined ? b.mmr : (b.baseMMR || 0);
    if (mmrB !== mmrA) return mmrB - mmrA;

    const gamesA = (a.wins || 0) + (a.losses || 0);
    const rateA = gamesA > 0 ? (a.wins || 0) / gamesA : 0;
    const gamesB = (b.wins || 0) + (b.losses || 0);
    const rateB = gamesB > 0 ? (b.wins || 0) / gamesB : 0;
    if (rateB !== rateA) return rateB - rateA;

    return (a.name || '').localeCompare(b.name || '');
  });

  const publicPlayers = sortedPlayers.map((player, index) => {
    const wins = player.wins || 0;
    const losses = player.losses || 0;
    const totalGames = wins + losses;
    const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 1000) / 10 : 0;

    // 포지션 선호도: 1지망, 2지망까지만 추출
    const rawPrefs = Array.isArray(player.prefs) ? player.prefs : [];
    const top2Prefs = rawPrefs.slice(0, 2).map((prefNum, idx) => {
      const roleInfo = ROLE_MAP[prefNum] || { id: prefNum, key: `pos${prefNum}`, label: `포지션 ${prefNum}` };
      return {
        priority: idx + 1,
        roleId: roleInfo.id,
        roleKey: roleInfo.key,
        roleLabel: roleInfo.label
      };
    });

    const baseMMR = player.baseMMR || 0;
    const mmr = player.mmr !== undefined ? player.mmr : baseMMR;
    const mmrDiff = mmr - baseMMR;

    return {
      rank: index + 1,
      id: player.id || `p_${index + 1}`,
      name: player.name || '알 수 없음',
      mmr: mmr,
      baseMMR: baseMMR,
      mmrDiff: mmrDiff,
      wins: wins,
      losses: losses,
      totalGames: totalGames,
      winRate: winRate,
      streak: player.streak || 0,
      positions: top2Prefs, // 1지망, 2지망만 공개
      roleCount: Array.isArray(player.roleCount) ? player.roleCount : [0, 0, 0, 0, 0]
    };
  });

  // 2. 전체 요약 통계(Stats Overview)
  const totalPlayers = publicPlayers.length;
  const totalMMR = publicPlayers.reduce((acc, cur) => acc + cur.mmr, 0);
  const avgMMR = totalPlayers > 0 ? Math.round(totalMMR / totalPlayers) : 0;
  const maxMMR = totalPlayers > 0 ? Math.max(...publicPlayers.map(p => p.mmr)) : 0;
  const minMMR = totalPlayers > 0 ? Math.min(...publicPlayers.map(p => p.mmr)) : 0;

  return {
    meta: {
      title: meta.title || '도타2 인하우스 공개 리더보드',
      season: meta.season || '2026',
      publishedAt: new Date().toISOString(),
      sourceUpdatedAt: rawData.updatedAt || new Date().toISOString()
    },
    overview: {
      totalPlayers,
      totalMatches: matches.length,
      avgMMR,
      maxMMR,
      minMMR
    },
    players: publicPlayers,
    matches: matches // 필요 시 공개 경기 결과
  };
}

module.exports = {
  createPublicLeaderboardData,
  ROLE_MAP
};
