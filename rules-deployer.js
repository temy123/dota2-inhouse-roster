/**
 * rules-deployer.js
 * Google Cloud / Firebase Rules API를 활용하여 Firestore 보안 규칙을 자동 배포하는 모듈
 */

const https = require('https');
const crypto = require('crypto');

/**
 * 서비스 계정 비공개 키로 Google OAuth2 Access Token 생성 (외부 라이브러리 없이 순수 Node.js 내장 crypto 사용)
 */
function getAccessToken(serviceAccount) {
  return new Promise((resolve, reject) => {
    try {
      const now = Math.floor(Date.now() / 1000);
      const header = {
        alg: 'RS256',
        typ: 'JWT'
      };

      const claimSet = {
        iss: serviceAccount.client_email,
        scope: 'https://www.googleapis.com/auth/firebase https://www.googleapis.com/auth/cloud-platform',
        aud: 'https://oauth2.googleapis.com/token',
        exp: now + 3600,
        iat: now
      };

      const base64UrlEncode = (obj) => {
        return Buffer.from(JSON.stringify(obj))
          .toString('base64')
          .replace(/=/g, '')
          .replace(/\+/g, '-')
          .replace(/\//g, '_');
      };

      const encodedHeader = base64UrlEncode(header);
      const encodedClaimSet = base64UrlEncode(claimSet);
      const signatureInput = `${encodedHeader}.${encodedClaimSet}`;

      const signer = crypto.createSign('RSA-SHA256');
      signer.update(signatureInput);
      const signature = signer.sign(serviceAccount.private_key, 'base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      const jwt = `${signatureInput}.${signature}`;

      const postData = new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      }).toString();

      const req = https.request(
        'https://oauth2.googleapis.com/token',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(postData)
          }
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.access_token) {
                resolve(parsed.access_token);
              } else {
                reject(new Error(parsed.error_description || parsed.error || data));
              }
            } catch (err) {
              reject(err);
            }
          });
        }
      );

      req.on('error', (err) => reject(err));
      req.write(postData);
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * HTTP Request 헬퍼 함수
 */
function sendRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const msg = parsed.error ? (parsed.error.message || JSON.stringify(parsed.error)) : `HTTP ${res.statusCode}: ${data}`;
            reject(new Error(msg));
          }
        } catch (e) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        }
      });
    });

    req.on('error', (err) => reject(err));
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

/**
 * Firestore 보안 규칙 배포 함수
 * @param {object} serviceAccount 서비스 계정 JSON 파싱 객체
 * @param {string} rulesContent 보안 규칙 텍스트
 */
async function deployFirestoreRules(serviceAccount, rulesContent) {
  const projectId = serviceAccount.project_id;
  if (!projectId) {
    throw new Error('서비스 계정에 project_id가 없습니다.');
  }

  // 1. 액세스 토큰 획득
  const token = await getAccessToken(serviceAccount);

  // 2. Ruleset 생성 (projects/{projectId}/rulesets)
  const rulesetBody = JSON.stringify({
    source: {
      files: [
        {
          name: 'firestore.rules',
          content: rulesContent
        }
      ]
    }
  });

  const createRulesetOptions = {
    hostname: 'firebaserules.googleapis.com',
    path: `/v1/projects/${projectId}/rulesets`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(rulesetBody)
    }
  };

  const rulesetRes = await sendRequest(createRulesetOptions, rulesetBody);
  const rulesetName = rulesetRes.name; // e.g. projects/{projectId}/rulesets/{rulesetId}
  if (!rulesetName) {
    throw new Error('규칙 세트 생성에 실패했습니다: ' + JSON.stringify(rulesetRes));
  }

  // 3. Cloud Firestore 릴리스 업데이트 (projects/{projectId}/releases/cloud.firestore)
  const releaseBody = JSON.stringify({
    release: {
      name: `projects/${projectId}/releases/cloud.firestore`,
      rulesetName: rulesetName
    }
  });

  const updateReleaseOptions = {
    hostname: 'firebaserules.googleapis.com',
    path: `/v1/projects/${projectId}/releases/cloud.firestore`,
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(releaseBody)
    }
  };

  const releaseRes = await sendRequest(updateReleaseOptions, releaseBody);
  return {
    projectId,
    rulesetName,
    releaseName: releaseRes.name
  };
}

module.exports = {
  getAccessToken,
  deployFirestoreRules
};
