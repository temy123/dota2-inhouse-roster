/* ============================================================
   feedback.js — 익명 내전 피드백 Firestore 제출
   저장 문서에는 답변 4개와 서버 생성 시각만 포함한다.
   ============================================================ */
(function () {
  'use strict';

  var COLLECTION = 'feedbacks';
  var MAX_LENGTH = 2000;
  var fields = [
    { inputId: 'feedback-balance', errorId: 'error-balance', countId: 'count-balance', key: 'balanceFeedback', label: '밸런스적으로 개선되었으면 하는 점' },
    { inputId: 'feedback-teamwork', errorId: 'error-teamwork', countId: 'count-teamwork', key: 'teamworkFeedback', label: '팀적으로 개선되었으면 하는 점' },
    { inputId: 'feedback-overall', errorId: 'error-overall', countId: 'count-overall', key: 'overallFeedback', label: '전체적으로 느낀 점' },
    { inputId: 'feedback-additions', errorId: 'error-additions', countId: 'count-additions', key: 'additionFeedback', label: '추가되었으면, 수정되었으면 하는 점' }
  ];
  var db = null;
  var isSubmitting = false;

  function isConfigured() {
    var config = window.DOTA_FIREBASE_CONFIG;
    return !!(config && config.apiKey && config.projectId &&
      config.apiKey.indexOf('YOUR_') !== 0 && config.projectId.indexOf('YOUR_') !== 0);
  }

  function init() {
    if (db) return db;
    if (!isConfigured()) throw new Error('Firebase 설정이 필요합니다. 관리자에게 문의해 주세요.');
    if (typeof firebase === 'undefined' || typeof firebase.firestore !== 'function') {
      throw new Error('Firebase 연결을 준비하지 못했습니다. 인터넷 연결을 확인해 주세요.');
    }
    var app = firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(window.DOTA_FIREBASE_CONFIG);
    db = firebase.firestore(app);
    return db;
  }

  function friendlyError(error) {
    var code = error && error.code;
    var messages = {
      'permission-denied': '현재 피드백을 저장할 수 없습니다. 잠시 후 다시 시도해 주세요.',
      'unavailable': '서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.',
      'network-unavailable': '네트워크 연결을 확인한 뒤 다시 시도해 주세요.',
      'deadline-exceeded': '요청 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.',
      'resource-exhausted': '요청이 많습니다. 잠시 후 다시 시도해 주세요.'
    };
    return messages[code] || '피드백 전송에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  }

  function getElement(id) { return document.getElementById(id); }

  function setFieldError(field, message) {
    var input = getElement(field.inputId);
    getElement(field.errorId).textContent = message || '';
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function updateCount(field) {
    var length = getElement(field.inputId).value.length;
    getElement(field.countId).textContent = length.toLocaleString('ko-KR') + ' / ' + MAX_LENGTH.toLocaleString('ko-KR');
  }

  function collectAndValidate() {
    var data = {};
    var firstInvalid = null;
    fields.forEach(function (field) {
      var input = getElement(field.inputId);
      var value = input.value.trim();
      var error = '';
      if (!value) error = field.label + '을(를) 작성해 주세요.';
      else if (value.length > MAX_LENGTH) error = '최대 ' + MAX_LENGTH.toLocaleString('ko-KR') + '자까지 입력할 수 있습니다.';
      setFieldError(field, error);
      if (error && !firstInvalid) firstInvalid = input;
      data[field.key] = value;
    });
    if (firstInvalid) {
      firstInvalid.focus();
      return null;
    }
    return data;
  }

  function setSubmitting(value) {
    isSubmitting = value;
    var button = getElement('submit-button');
    button.disabled = value;
    button.classList.toggle('is-submitting', value);
    button.querySelector('.button-label').textContent = value ? '익명으로 전송 중...' : '익명으로 피드백 보내기';
  }

  function showSuccess() {
    var formCard = document.querySelector('.form-card');
    var success = getElement('success-card');
    formCard.hidden = true;
    success.hidden = false;
    success.focus();
    success.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function resetForm() {
    getElement('feedback-form').reset();
    fields.forEach(function (field) {
      setFieldError(field, '');
      updateCount(field);
    });
    getElement('form-status').textContent = '';
  }

  function bindForm() {
    var form = getElement('feedback-form');
    fields.forEach(function (field) {
      var input = getElement(field.inputId);
      updateCount(field);
      input.addEventListener('input', function () {
        updateCount(field);
        if (input.value.trim()) setFieldError(field, '');
      });
    });

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      if (isSubmitting) return;
      var data = collectAndValidate();
      if (!data) return;

      getElement('form-status').textContent = '';
      setSubmitting(true);
      try {
        init().collection(COLLECTION).add({
          balanceFeedback: data.balanceFeedback,
          teamworkFeedback: data.teamworkFeedback,
          overallFeedback: data.overallFeedback,
          additionFeedback: data.additionFeedback,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then(function () {
          resetForm();
          showSuccess();
        }).catch(function (error) {
          console.warn('Firestore feedback write failed:', error && error.code);
          getElement('form-status').textContent = friendlyError(error);
        }).finally(function () {
          setSubmitting(false);
        });
      } catch (error) {
        getElement('form-status').textContent = friendlyError(error);
        setSubmitting(false);
      }
    });

    getElement('restart-button').addEventListener('click', function () {
      getElement('success-card').hidden = true;
      document.querySelector('.form-card').hidden = false;
      getElement('feedback-balance').focus();
      document.querySelector('.form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  document.addEventListener('DOMContentLoaded', bindForm);
})();
