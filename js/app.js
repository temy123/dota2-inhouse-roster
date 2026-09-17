/* ============================================================
   app.js — 단계 위저드 제어 / 입력 검증 / 태그 드래그 / 모달
   ============================================================ */
(function () {
  'use strict';

  var POS_LABELS = { carry: '캐리', mid: '미드', offlane: '오프', pos4: '4번 서폿', pos5: '5번 서폿' };
  var INITIAL_ORDER = ['carry', 'mid', 'offlane', 'pos4', 'pos5'];

  var stage = document.getElementById('stage');
  var steps = Array.prototype.slice.call(stage.querySelectorAll('.step'));
  var stepByNum = {};
  steps.forEach(function (s) { stepByNum[+s.dataset.step] = s; });

  var progress = document.getElementById('progress');
  var trackFill = document.getElementById('track-fill');
  var btnStart = document.getElementById('btn-start');
  var discordModal = document.getElementById('discord-modal');
  var discordModalCancel = document.getElementById('discord-modal-cancel');
  var discordModalConfirm = document.getElementById('discord-modal-confirm');
  var modal = document.getElementById('modal');
  var modalCancel = document.getElementById('modal-cancel');
  var modalConfirm = document.getElementById('modal-confirm');
  var btnSubmit = document.getElementById('btn-submit');
  var btnRestart = document.getElementById('btn-restart');
  var summaryCard = document.getElementById('summary-card');
  var successTitle = document.getElementById('success-title');
  var successDesc = document.getElementById('success-desc');
  var toastEl = document.getElementById('toast');
  var tagList = document.getElementById('tag-list');
  var initialTagHtml = tagList.innerHTML;

  var inputs = {
    nickname: document.getElementById('input-nickname'),
    steam: document.getElementById('input-steam'),
    discord: document.getElementById('input-discord'),
    mmr: document.getElementById('input-mmr')
  };

  var current = 0;
  var submitting = false;
  var state = {
    nickname: '',
    steam: '',
    discord: '',
    mmr: 0,
    positions: INITIAL_ORDER.slice()
  };

  /* ---------- 유틸 ---------- */
  var toastTimer = null;
  window.toast = function (msg, ms) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 5200);
  };

  var AMP = String.fromCharCode(38); // &
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, AMP + 'amp;')
      .replace(/</g, AMP + 'lt;')
      .replace(/>/g, AMP + 'gt;')
      .replace(/"/g, AMP + 'quot;')
      .replace(/'/g, AMP + '#39;');
  }

  /* ---------- 진행도 ---------- */
  var STEP_LABELS = ['닉네임', '스팀', '디스코드', 'MMR', '포지션'];
  var FILL = { 1: 10, 2: 30, 3: 50, 4: 70, 5: 90, 6: 100, 7: 100 };

  function buildProgress() {
    progress.innerHTML = STEP_LABELS.map(function (label, i) {
      return '<div class="progress-item" data-i="' + (i + 1) + '">' +
        '<span class="progress-num">' + (i + 1) + '</span>' +
        '<span class="progress-label">' + label + '</span></div>';
    }).join('');
  }

  function updateProgress() {
    progress.classList.toggle('hidden', current === 0);
    if (current === 0) return;
    progress.querySelectorAll('.progress-item').forEach(function (el) {
      var i = +el.dataset.i;
      el.classList.toggle('done', current > i);
      el.classList.toggle('active', current === i);
    });
    trackFill.style.width = (FILL[current] || 0) + '%';
  }

  /* ---------- 단계 전환 ---------- */
  function showStep(n, dir) {
    if (n === current || !stepByNum[n]) return;
    var cur = stepByNum[current];
    var target = stepByNum[n];
    var movingBack = dir === 'back';
    var exitCls = movingBack ? 'exit-right' : 'exit-left';
    var fromCls = movingBack ? 'from-left' : 'from-right';

    // 나가는 단계: 즉시 active 해제 → opacity 1→0 페이드아웃 + 포인터 이벤트 차단
    // (전환 중에도 항상 정확히 한 단계만 .active → 포인터 가로채기 방지)
    if (cur) {
      cur.classList.remove('active');
      cur.classList.add(exitCls);
    }

    // 들어오는 단계: 오프셋(opacity 0) 상태 → 리플로우 → active+정위치 (페이드인)
    target.classList.remove('from-left', 'from-right');
    target.classList.add(fromCls);
    target.scrollTop = 0;
    void target.offsetWidth; // reflow → 트랜지션 발동
    target.classList.add('active');
    target.classList.remove(fromCls);

    // 퇴장 애니메이션 완료 후 클래스 정리 (안전장치 포함)
    if (cur) {
      var finished = false;
      var cleanup = function () {
        if (finished) return;
        finished = true;
        cur.classList.remove('exit-left', 'exit-right');
      };
      cur.addEventListener('transitionend', cleanup, { once: true });
      setTimeout(cleanup, 700);
    }

    current = n;
    updateProgress();
    if (n === 6) renderSummary();
    var title = target.querySelector('[tabindex="-1"]');
    if (title) title.focus({ preventScroll: true });
  }

  /* ---------- 검증 ---------- */
  var FIELD_OF_STEP = { 1: 'nickname', 2: 'steam', 3: 'discord', 4: 'mmr' };

  // 스팀 프로필 URL 정규화: 프로토콜/www/끝 슬래시 제거
  function normalizeSteamUrl(v) {
    return v.trim()
      .replace(/^[Hh][Tt][Tt][Pp][Ss]?:\/\//, '')
      .replace(/^www\./i, '')
      .replace(/\/+$/, '');
  }

  function validateNickname(v) {
    var t = v.trim();
    if (!t) return '닉네임을 입력해 주세요.';
    if (t.length > 24) return '닉네임은 24자를 넘을 수 없습니다.';
    return '';
  }
  function validateSteam(v) {
    var t = normalizeSteamUrl(v);
    if (!t) return '스팀 프로필 주소를 붙여넣어 주세요.';
    // "steam"으로 시작하고 숫자로 끝난다면 그대로 허용 (완화 검증)
    if (/^steam/i.test(t) && /\d$/.test(t)) return '';
    return '"steam"으로 시작해 숫자로 끝나야 합니다. 예) https://steamcommunity.com/profiles/7656119...';
  }
  function validateDiscord(v) {
    var t = v.trim();
    if (!t) return '디스코드 아이디를 입력해 주세요.';
    if (t.length > 64) return '디스코드 아이디는 64자를 넘을 수 없습니다.';
    if (/\s/.test(t)) return '공백은 사용할 수 없습니다.';
    return '';
  }
  function validateMmr(v) {
    var t = v.trim();
    if (!t) return 'MMR을 입력해 주세요.';
    if (!/^\d{1,6}$/.test(t)) return '숫자만 입력해 주세요.';
    if (Number(t) > 100000) return '100,000 이하로 입력해 주세요.';
    return '';
  }
  var validators = { 1: validateNickname, 2: validateSteam, 3: validateDiscord, 4: validateMmr };

  function setFieldError(step, msg) {
    var key = FIELD_OF_STEP[step];
    if (!key) return;
    var errEl = document.getElementById('error-' + key);
    var input = inputs[key];
    if (msg) {
      errEl.textContent = msg;
      errEl.classList.add('show');
      input.classList.remove('shake');
      void input.offsetWidth;
      input.classList.add('shake');
    } else {
      errEl.textContent = '';
      errEl.classList.remove('show');
    }
  }

  function commitStep(step) {
    if (step === 1) state.nickname = inputs.nickname.value.trim();
    if (step === 2) state.steam = inputs.steam.value.trim();
    if (step === 3) state.discord = inputs.discord.value.trim();
    if (step === 4) state.mmr = Number(inputs.mmr.value.trim());
    if (step === 5) state.positions = currentTagOrder();
  }

  /* ---------- 등록 시작 전 디스코드 안내 ---------- */
  function openDiscordModal() {
    if (current !== 0) return;
    discordModal.classList.add('show');
    setTimeout(function () { discordModalConfirm.focus(); }, 320);
  }

  function closeDiscordModal() {
    discordModal.classList.remove('show');
    btnStart.focus();
  }

  btnStart.addEventListener('click', openDiscordModal);
  discordModalCancel.addEventListener('click', closeDiscordModal);
  discordModalConfirm.addEventListener('click', function () {
    discordModal.classList.remove('show');
    showStep(1, 'next');
  });
  discordModal.addEventListener('click', function (e) {
    if (e.target === discordModal) closeDiscordModal();
  });

  /* ---------- 진행 버튼 (위임) ---------- */
  stage.addEventListener('click', function (e) {
    if (e.target.closest('[data-next]')) {
      if (current === 0) { showStep(1, 'next'); return; }
      if (current >= 1 && current <= 5) {
        var fn = validators[current];
        var err = fn ? fn(inputs[FIELD_OF_STEP[current]].value) : '';
        if (err) { setFieldError(current, err); return; }
        setFieldError(current, '');
        commitStep(current);
        showStep(current + 1, 'next');
      }
    } else if (e.target.closest('[data-back]')) {
      if (current >= 1 && current <= 6) showStep(current - 1, 'back');
    }
  });

  // 입력 단계에서 Enter 키로 다음 단계
  stage.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && current >= 1 && current <= 4) {
      var btn = stepByNum[current].querySelector('[data-next]');
      if (btn) btn.click();
    }
  });

  /* ---------- 포지션 태그: 동적 드래그 (Pointer Events + FLIP) ----------
     드래그 중인 태그가 손끝(커서)을 따라가고,
     다른 태그들이 실시간으로 자리를 비키며 부드럽게 이동합니다. */
  var drag = null;

  function currentTagOrder() {
    return Array.prototype.map.call(tagList.querySelectorAll('.tag'), function (t) {
      return t.dataset.pos;
    });
  }

  function refreshRanks() {
    var tags = Array.prototype.slice.call(tagList.querySelectorAll('.tag'));
    tags.forEach(function (tag, i) {
      var rankEl = tag.querySelector('.tag-rank');
      // 순위가 바뀌면 배지에 살짝 튀어오르는(bump) 효과
      if (rankEl.textContent !== String(i + 1)) {
        rankEl.textContent = i + 1;
        rankEl.classList.remove('bump');
        void rankEl.offsetWidth; // 애니메이션 재실행
        rankEl.classList.add('bump');
      }
      var up = tag.querySelector('.tag-move[data-dir="-1"]');
      var down = tag.querySelector('.tag-move[data-dir="1"]');
      if (up) up.disabled = i === 0;
      if (down) down.disabled = i === tags.length - 1;
    });
    state.positions = currentTagOrder();
  }

  function afterElement(list, y) {
    var els = Array.prototype.slice.call(list.querySelectorAll('.tag:not(.dragging)'));
    var closest = { offset: -Infinity, element: null };
    els.forEach(function (child) {
      var box = child.getBoundingClientRect();
      var offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) closest = { offset: offset, element: child };
    });
    return closest.element;
  }

  // FLIP: 포인터 위치 기준으로 드래그 태그를 DOM에서 재배치하고,
  // 밀려난 나머지 태그들이 부드럽게 새 자리로 이동하도록 애니메이션
  function reorderForCenter(y) {
    var others = Array.prototype.slice.call(tagList.querySelectorAll('.tag:not(.dragging)'));
    var firsts = others.map(function (t) { return t.getBoundingClientRect(); });

    var after = afterElement(tagList, y);
    if (after == null) tagList.appendChild(drag.tag);
    else tagList.insertBefore(drag.tag, after);

    others.forEach(function (t, i) {
      var last = t.getBoundingClientRect();
      var dy = firsts[i].top - last.top;
      if (dy !== 0) {
        t.style.transition = 'none';
        t.style.transform = 'translateY(' + dy + 'px)';
        void t.offsetWidth; // 리플로시 → 즉시 적용
        t.style.transition = '';
        t.style.transform = '';
      }
    });
  }

  function startDrag(tag, e) {
    var rect = tag.getBoundingClientRect();
    drag = {
      tag: tag,
      offX: e.clientX - rect.left,
      offY: e.clientY - rect.top,
      startY: e.clientY,
      height: rect.height,
      moved: false
    };
    document.addEventListener('pointermove', onPointerMove, { passive: false });
    document.addEventListener('pointerup', endDrag);
    document.addEventListener('pointercancel', endDrag);
  }

  function onPointerMove(e) {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.abs(e.clientY - drag.startY) < 5) return; // 잡았다가 안 움직이면 드래그 아님
      drag.moved = true;
      drag.tag.classList.add('dragging');
    }
    e.preventDefault();

    var absTop = e.clientY - drag.offY;
    var absLeft = e.clientX - drag.offX;

    // 1) 재배치: 나머지 태그들이 실시간으로 자리 비낌
    reorderForCenter(absTop + drag.height / 2);

    // 2) 드래그 태그가 포인터를 정확히 따라감 (DOM 슬롯 변화분을 보정)
    drag.tag.style.transform = 'none';
    var home = drag.tag.getBoundingClientRect();
    drag.tag.style.transform =
      'translate(' + (absLeft - home.left) + 'px,' + (absTop - home.top) + 'px) scale(1.04) rotate(0.4deg)';
  }

  function endDrag() {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', endDrag);
    document.removeEventListener('pointercancel', endDrag);
    if (!drag) return;
    var tag = drag.tag;
    var moved = drag.moved;
    drag = null;
    if (moved) {
      tag.classList.remove('dragging'); // transition 상태 복원
      tag.style.transform = '';        // 새 자리에 부드럽히 안착
      refreshRanks();
    }
  }

  tagList.addEventListener('pointerdown', function (e) {
    if (drag) return;
    var tag = e.target.closest('.tag');
    if (!tag || e.target.closest('.tag-move')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 텍스트 선택/네이티브 드래그 등 부수 동작 방지
    e.preventDefault();
    startDrag(tag, e);
  });

  // (보안망) 어떤 경로로든 네이티브 HTML5 DnD가 시작되면 즉시 취소
  tagList.addEventListener('dragstart', function (e) { e.preventDefault(); });

  // FLIP: 재배치 함수(mutate) 실행 전후 위치 차이를 역으로 적용해
  // 모든 태그가 부드럽게 새 자리로 이동 (화살표 버튼용)
  function flipMove(mutate) {
    var tags = Array.prototype.slice.call(tagList.querySelectorAll('.tag'));
    var firsts = tags.map(function (t) { return t.getBoundingClientRect().top; });
    mutate();
    tags.forEach(function (t, i) {
      var dy = firsts[i] - t.getBoundingClientRect().top;
      if (dy !== 0) {
        t.style.transition = 'none';
        t.style.transform = 'translateY(' + dy + 'px)';
        void t.offsetWidth; // 리플로시 → 즉시 적용
        t.style.transition = '';
        t.style.transform = '';
      }
    });
  }

  // 터치/키보드 폴백: ↑↓ 버튼 (드래그와 동일한 FLIP 애니메이션 적용)
  tagList.addEventListener('click', function (e) {
    var btn = e.target.closest('.tag-move');
    if (!btn || btn.disabled) return;
    var tag = btn.closest('.tag');
    var dir = Number(btn.dataset.dir);
    var sib = dir === -1 ? tag.previousElementSibling : tag.nextElementSibling;
    if (!sib || !sib.classList.contains('tag')) return;
    flipMove(function () {
      tagList.insertBefore(tag, dir === -1 ? sib : sib.nextSibling);
    });
    refreshRanks();
  });

  /* ---------- 요약 (STEP 6) ---------- */
  function renderSummary() {
    var steam = state.steam;
    var steamHref = /^https?:\/\//i.test(steam) ? steam : 'https://' + steam;
    var posFlow = state.positions.map(function (p, i) {
      return '<span class="pos-chip"><b>' + (i + 1) + '</b>' + escapeHtml(POS_LABELS[p] || p) + '</span>';
    }).join('<span class="mini-arrow">→</span>');

    summaryCard.innerHTML =
      '<div class="summary-row"><span class="summary-key">닉네임</span>' +
      '<span class="summary-value">' + escapeHtml(state.nickname) + '</span></div>' +
      '<div class="summary-row"><span class="summary-key">스팀 프로필</span>' +
      '<span class="summary-value"><a href="' + escapeHtml(steamHref) + '" target="_blank" rel="noopener noreferrer">' +
      escapeHtml(steam) + '</a></span></div>' +
      '<div class="summary-row"><span class="summary-key">디스코드</span>' +
      '<span class="summary-value">' + escapeHtml(state.discord) + '</span></div>' +
      '<div class="summary-row"><span class="summary-key">MMR</span>' +
      '<span class="summary-value">' + Number(state.mmr).toLocaleString('ko-KR') + '</span></div>' +
      '<div class="summary-row"><span class="summary-key">포지션 우선순위</span>' +
      '<span class="summary-value"><span class="pos-flow">' + posFlow + '</span></span></div>';
  }

  /* ---------- 부계정 확인 모달 ---------- */
  function openModal() {
    if (submitting) return;
    modal.classList.add('show');
    setTimeout(function () { modalConfirm.focus(); }, 320);
  }

  function closeModal() {
    modal.classList.remove('show');
    modalConfirm.classList.remove('loading');
    modalConfirm.disabled = false;
    modalCancel.disabled = false;
  }

  btnSubmit.addEventListener('click', openModal);
  modalCancel.addEventListener('click', function () { if (!submitting) closeModal(); });
  modal.addEventListener('click', function (e) { if (e.target === modal && !submitting) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (discordModal.classList.contains('show')) {
      closeDiscordModal();
    } else if (modal.classList.contains('show') && !submitting) {
      closeModal();
    }
  });

  modalConfirm.addEventListener('click', function () {
    if (submitting) return;
    submitting = true;
    modalConfirm.classList.add('loading');
    modalConfirm.disabled = true;
    modalCancel.disabled = true;

    window.submitRoster({
      nickname: state.nickname,
      steam: state.steam,
      discord: state.discord,
      mmr: state.mmr,
      positions: state.positions.slice()
    }).then(function (result) {
      closeModal();
      successTitle.textContent = result.created ? '제출 완료!' : '정보 갱신 완료!';
      successDesc.innerHTML = result.created
        ? '<strong>' + escapeHtml(state.nickname) + '</strong> 님의 정보가 등록되었습니다.<br>모집과 매칭 공지를 위해 디스코드 서버에 참여하고 알림을 켜두세요.'
        : '<strong>' + escapeHtml(state.nickname) + '</strong> 님의 기존 등록 정보가<br>최신 내용으로 갱신되었습니다. 디스코드 서버 참여와 알림도 확인해 주세요.';
      showStep(7, 'next');
    }).catch(function (err) {
      closeModal();
      window.toast(err && err.message ? err.message : '제출에 실패했습니다.');
    }).then(function () {
      submitting = false;
      modalConfirm.classList.remove('loading');
      modalConfirm.disabled = false;
      modalCancel.disabled = false;
    });
  });

  /* ---------- 새로 시작 ---------- */
  btnRestart.addEventListener('click', function () {
    Object.keys(inputs).forEach(function (k) { inputs[k].value = ''; });
    [1, 2, 3, 4].forEach(function (s) { setFieldError(s, ''); });
    tagList.innerHTML = initialTagHtml;
    refreshRanks();
    showStep(0, 'back');
  });

  /* ---------- 초기화 ---------- */
  buildProgress();
  refreshRanks();
  updateProgress();
})();
