/**
 * leaderboard.js
 * Firestore에서 공개 리더보드(public_leaderboard/latest)를 조회하여 렌더링
 * - DESIGN.md 원칙에 따른 간결한 데이터 뷰
 * - 기본 정렬: 인하우스 MMR 기준 내림차순
 * - 순위 산정: 현재 필터링/정렬된 결과 목록을 기준으로 1위부터 재산정
 * - 닉네임 컬럼은 클릭 정렬에서 제외
 * - 헤더 클릭 시 해당 데이터 컬럼 전체 셀(td) 강조 표시
 * - 포지션 선호도 1~2지망 표시
 */

(function () {
  'use strict';

  let rawLeaderboardData = null;
  let activeRoleFilter = 'all';
  let searchQuery = '';
  let sortField = 'mmr';      // 현재 정렬 기준 필드 (기본: 인하우스 MMR)
  let sortDirection = 'desc'; // 'desc' | 'asc'

  const ROLE_NAMES = {
    1: '캐리',
    2: '미드',
    3: '오프',
    4: '4서폿',
    5: '5서폿'
  };

  const ROLE_CLASSES = {
    1: 'p-carry',
    2: 'p-mid',
    3: 'p-offlane',
    4: 'p-pos4',
    5: 'p-pos5'
  };

  // DOM 요소 캐시
  const elements = {
    totalPlayers: document.getElementById('stat-total-players'),
    avgMmr: document.getElementById('stat-avg-mmr'),
    maxMmr: document.getElementById('stat-max-mmr'),
    lastUpdated: document.getElementById('stat-last-updated'),
    tableBody: document.getElementById('leaderboard-tbody'),
    stateContainer: document.getElementById('state-container'),
    searchInput: document.getElementById('search-input'),
    filterButtons: document.querySelectorAll('.filter-btn'),
    refreshBtn: document.getElementById('refresh-btn'),
    sortHeaders: document.querySelectorAll('th.sortable')
  };

  /**
   * Firebase Firestore 초기화
   */
  function initFirebase() {
    if (!window.firebase) {
      showError('Firebase SDK를 불러오지 못했습니다.');
      return null;
    }
    if (!firebase.apps.length) {
      if (!window.DOTA_FIREBASE_CONFIG) {
        showError('Firebase 설정(firebase-config.js)을 찾을 수 없습니다.');
        return null;
      }
      firebase.initializeApp(window.DOTA_FIREBASE_CONFIG);
    }
    return firebase.firestore();
  }

  /**
   * 상태 메시지 표시
   */
  function showLoading() {
    elements.stateContainer.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>리더보드 데이터를 불러오는 중입니다...</p>
      </div>
    `;
    elements.stateContainer.style.display = 'block';
    elements.tableBody.innerHTML = '';
  }

  function showError(msg) {
    elements.stateContainer.innerHTML = `
      <div class="error-state">
        <p>⚠️ ${escapeHtml(msg)}</p>
      </div>
    `;
    elements.stateContainer.style.display = 'block';
    elements.tableBody.innerHTML = '';
  }

  function showEmpty(msg = '표시할 선수가 없습니다.') {
    elements.stateContainer.innerHTML = `
      <div class="empty-state">
        <p>${escapeHtml(msg)}</p>
      </div>
    `;
    elements.stateContainer.style.display = 'block';
  }

  function hideState() {
    elements.stateContainer.style.display = 'none';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&')
      .replace(/</g, '<')
      .replace(/>/g, '>')
      .replace(/"/g, '"')
      .replace(/'/g, '&#039;');
  }

  function formatDate(isoString) {
    if (!isoString) return '-';
    try {
      const d = new Date(isoString);
      return new Intl.DateTimeFormat('ko-KR', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).format(d);
    } catch {
      return isoString;
    }
  }

  /**
   * Firestore 데이터 조회
   */
  async function fetchLeaderboard() {
    const db = initFirebase();
    if (!db) return;

    showLoading();
    try {
      const doc = await db.collection('public_leaderboard').doc('latest').get();
      if (doc.exists) {
        rawLeaderboardData = doc.data();
        renderOverview(rawLeaderboardData);
        renderTable();
        return;
      }
    } catch (err) {
      console.warn('Firestore 조회 오류 (로컬 fallback 시도):', err);
    }

    // fallback
    try {
      const res = await fetch('public-roaster/2026-09-19-1510.json');
      if (res.ok) {
        const rawJson = await res.json();
        const roleMap = {
          1: { id: 1, key: 'carry', label: '캐리 (1)' },
          2: { id: 2, key: 'mid', label: '미드 (2)' },
          3: { id: 3, key: 'offlane', label: '오프 (3)' },
          4: { id: 4, key: 'pos4', label: '4서폿 (4)' },
          5: { id: 5, key: 'pos5', label: '5서폿 (5)' }
        };
        const players = (rawJson.players || []).map((p, idx) => {
          const prefs = (p.prefs || []).slice(0, 2).map((r, i) => ({
            priority: i + 1,
            roleId: r,
            roleKey: (roleMap[r] || {}).key || 'unknown',
            roleLabel: (roleMap[r] || {}).label || `포지션 ${r}`
          }));
          return {
            rank: idx + 1,
            name: p.name,
            mmr: p.mmr || p.baseMMR,
            baseMMR: p.baseMMR,
            mmrDiff: (p.mmr || p.baseMMR) - (p.baseMMR || 0),
            wins: p.wins || 0,
            losses: p.losses || 0,
            totalGames: (p.wins || 0) + (p.losses || 0),
            winRate: 0,
            streak: p.streak || 0,
            positions: prefs
          };
        });

        rawLeaderboardData = {
          meta: { title: '도타2 인하우스 공개 리더보드', publishedAt: new Date().toISOString() },
          overview: {
            totalPlayers: players.length,
            avgMMR: Math.round(players.reduce((a, b) => a + (b.mmr || 0), 0) / players.length),
            maxMMR: Math.max(...players.map(p => p.mmr || 0)),
            minMMR: Math.min(...players.map(p => p.mmr || 0))
          },
          players: players
        };
        renderOverview(rawLeaderboardData);
        renderTable();
        return;
      }
    } catch (e) {
      // ignore
    }

    showEmpty('공개된 리더보드 데이터가 아직 없습니다. 관리자가 데이터를 배포할 때까지 기다려주세요.');
  }

  /**
   * 요약 통계(Fact Strip) 렌더링
   */
  function renderOverview(data) {
    const overview = data.overview || {};
    const meta = data.meta || {};

    if (elements.totalPlayers) elements.totalPlayers.textContent = `${overview.totalPlayers || 0}명`;
    if (elements.avgMmr) elements.avgMmr.textContent = overview.avgMMR ? Number(overview.avgMMR).toLocaleString() : '-';
    if (elements.maxMmr) elements.maxMmr.textContent = overview.maxMMR ? Number(overview.maxMMR).toLocaleString() : '-';
    if (elements.lastUpdated) elements.lastUpdated.textContent = formatDate(meta.publishedAt);
  }

  /**
   * 정렬 지표 UI 갱신
   */
  function updateSortHeaderUI() {
    if (!elements.sortHeaders) return;
    elements.sortHeaders.forEach(th => {
      const field = th.dataset.sort;
      const indicator = th.querySelector('.sort-indicator');
      if (field === sortField) {
        th.classList.add('sorted');
        if (indicator) indicator.textContent = sortDirection === 'desc' ? '▼' : '▲';
      } else {
        th.classList.remove('sorted');
        if (indicator) indicator.textContent = '';
      }
    });
  }

  /**
   * 리더보드 테이블 렌더링
   */
  function renderTable() {
    if (!rawLeaderboardData || !Array.isArray(rawLeaderboardData.players)) {
      showEmpty();
      return;
    }

    let players = [...rawLeaderboardData.players];

    // 1. 포지션 필터 적용 (1지망 또는 2지망에 해당 포지션이 포함된 경우)
    if (activeRoleFilter !== 'all') {
      const targetRoleId = parseInt(activeRoleFilter, 10);
      players = players.filter(p => {
        const positions = Array.isArray(p.positions) ? p.positions : [];
        return positions.some(pos => pos.roleId === targetRoleId);
      });
    }

    if (players.length === 0) {
      elements.tableBody.innerHTML = '';
      showEmpty('필터 조건에 맞는 선수가 없습니다.');
      return;
    }

    // 2. 현재 선택된 기준(인하우스 MMR, 본래 MMR, 전적, 최근 흐름 등)에 따라 정렬 실행
    players.sort((a, b) => {
      let valA, valB;

      switch (sortField) {
        case 'baseMMR':
          valA = a.baseMMR || 0;
          valB = b.baseMMR || 0;
          break;
        case 'winRate': {
          const gamesA = a.totalGames !== undefined ? a.totalGames : ((a.wins || 0) + (a.losses || 0));
          const gamesB = b.totalGames !== undefined ? b.totalGames : ((b.wins || 0) + (b.losses || 0));
          valA = a.winRate !== undefined ? a.winRate : (gamesA > 0 ? (a.wins / gamesA) * 100 : 0);
          valB = b.winRate !== undefined ? b.winRate : (gamesB > 0 ? (b.wins / gamesB) * 100 : 0);
          
          if (valA !== valB) {
            return sortDirection === 'desc' ? valB - valA : valA - valB;
          }
          // 동률일 경우: 총 판수(totalGames) 많은 순 -> 승리 수(wins) 많은 순 -> 인하우스 MMR 높은 순
          if (gamesA !== gamesB) {
            return sortDirection === 'desc' ? gamesB - gamesA : gamesA - gamesB;
          }
          if ((a.wins || 0) !== (b.wins || 0)) {
            return sortDirection === 'desc' ? (b.wins || 0) - (a.wins || 0) : (a.wins || 0) - (b.wins || 0);
          }
          const mmrA = a.mmr !== undefined ? a.mmr : (a.baseMMR || 0);
          const mmrB = b.mmr !== undefined ? b.mmr : (b.baseMMR || 0);
          return sortDirection === 'desc' ? mmrB - mmrA : mmrA - mmrB;
        }
        case 'streak':
          valA = a.streak !== undefined ? a.streak : 0;
          valB = b.streak !== undefined ? b.streak : 0;
          break;
        case 'mmr':
        default:
          valA = a.mmr !== undefined ? a.mmr : (a.baseMMR || 0);
          valB = b.mmr !== undefined ? b.mmr : (b.baseMMR || 0);
          break;
      }

      if (valA !== valB) {
        return sortDirection === 'desc' ? valB - valA : valA - valB;
      }
      return (a.name || '').localeCompare(b.name || '');
    });

    // 3. 현재 정렬/포지션 필터링 기준에 맞춰 각 선수의 순위(filteredRank)를 먼저 확정
    const rankedPlayers = players.map((p, idx) => ({
      ...p,
      filteredRank: idx + 1
    }));

    // 4. 닉네임 검색 필터 적용 (현재 산정된 순위가 유지된 채 특정 선수만 검색/표시)
    let displayPlayers = rankedPlayers;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      displayPlayers = rankedPlayers.filter(p => (p.name || '').toLowerCase().includes(q));
    }

    if (displayPlayers.length === 0) {
      elements.tableBody.innerHTML = '';
      showEmpty('검색 조건에 맞는 선수가 없습니다.');
      return;
    }

    hideState();
    updateSortHeaderUI();

    const rowsHtml = displayPlayers.map((player) => {
      // 검색 시에도 1위로 바뀌지 않고, 현재 필터링/정렬 기준 순위 그대로 표시
      const displayRank = player.filteredRank;

      // 순위 배지 (1, 2, 3위 스타일)
      let rankClass = '';
      if (displayRank === 1) rankClass = 'rank-top1';
      else if (displayRank === 2) rankClass = 'rank-top2';
      else if (displayRank === 3) rankClass = 'rank-top3';

      // MMR 변동 표시
      let diffHtml = '';
      const inhouseMmr = player.mmr !== undefined ? player.mmr : player.baseMMR;
      const baseMmr = player.baseMMR || 0;
      const diff = inhouseMmr - baseMmr;

      if (diff > 0) {
        diffHtml = `<span class="mmr-diff diff-up">+${diff}</span>`;
      } else if (diff < 0) {
        diffHtml = `<span class="mmr-diff diff-down">${diff}</span>`;
      } else {
        diffHtml = `<span class="mmr-diff diff-zero">0</span>`;
      }

      // 포지션 선호도 (1지망, 2지망만 표시)
      const positions = Array.isArray(player.positions) ? player.positions : [];
      const positionsHtml = positions.map(pos => {
        const roleClass = ROLE_CLASSES[pos.roleId] || '';
        const roleName = ROLE_NAMES[pos.roleId] || pos.roleLabel || `포지션${pos.roleId}`;
        return `
          <span class="pos-tag ${roleClass}">
            <span class="pos-priority">${pos.priority}지망</span>
            <span>${escapeHtml(roleName)}</span>
          </span>
        `;
      }).join('');

      // 전적 & 승률
      const wins = player.wins || 0;
      const losses = player.losses || 0;
      const totalGames = player.totalGames !== undefined ? player.totalGames : (wins + losses);
      const winRate = totalGames > 0
        ? (player.winRate !== undefined ? player.winRate : Math.round((wins / totalGames) * 1000) / 10)
        : 0;

      // 스트릭 (연승/연패)
      let streakHtml = '-';
      if (player.streak > 0) {
        streakHtml = `<span class="streak-win">${player.streak}연승</span>`;
      } else if (player.streak < 0) {
        streakHtml = `<span class="streak-lose">${Math.abs(player.streak)}연패</span>`;
      }

      // 현재 정렬된 컬럼 전체 셀 강조 클래스
      const isInhouseSorted = sortField === 'mmr' ? 'col-sorted' : '';
      const isBaseSorted = sortField === 'baseMMR' ? 'col-sorted' : '';
      const isWinRateSorted = sortField === 'winRate' ? 'col-sorted' : '';
      const isStreakSorted = sortField === 'streak' ? 'col-sorted' : '';

      return `
        <tr>
          <td class="col-rank">
            <span class="rank-badge ${rankClass}">${displayRank}</span>
          </td>
          <td>
            <div class="player-name">${escapeHtml(player.name)}</div>
          </td>
          <td class="col-mmr ${isInhouseSorted}">
            ${inhouseMmr ? inhouseMmr.toLocaleString() : '-'}
            ${diffHtml}
          </td>
          <td class="col-mmr ${isBaseSorted}">
            ${baseMmr ? baseMmr.toLocaleString() : '-'}
          </td>
          <td>
            <div class="positions-cell">
              ${positionsHtml || '<span class="text-muted">-</span>'}
            </div>
          </td>
          <td class="record-cell ${isWinRateSorted}">
            ${player.wins || 0}승 ${player.losses || 0}패
            <span class="win-rate">(${winRate}%)</span>
          </td>
          <td class="streak-cell ${isStreakSorted}">
            ${streakHtml}
          </td>
        </tr>
      `;
    }).join('');

    elements.tableBody.innerHTML = rowsHtml;
  }

  /**
   * 이벤트 바인딩
   */
  function bindEvents() {
    // 테이블 헤더 클릭 정렬 (닉네임 제외: 인하우스 MMR, 본래 MMR, 전적 승률, 최근 흐름)
    if (elements.sortHeaders) {
      elements.sortHeaders.forEach(th => {
        th.addEventListener('click', () => {
          const field = th.dataset.sort;
          if (!field) return;

          if (sortField === field) {
            sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
          } else {
            sortField = field;
            sortDirection = 'desc';
          }
          renderTable();
        });
      });
    }

    // 검색
    if (elements.searchInput) {
      elements.searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderTable();
      });
    }

    // 포지션 필터
    if (elements.filterButtons) {
      elements.filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
          elements.filterButtons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          activeRoleFilter = btn.dataset.role;
          renderTable();
        });
      });
    }

    // 새로고침
    if (elements.refreshBtn) {
      elements.refreshBtn.addEventListener('click', () => {
        fetchLeaderboard();
      });
    }
  }

  // 초기화 실행
  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    fetchLeaderboard();
  });
})();
