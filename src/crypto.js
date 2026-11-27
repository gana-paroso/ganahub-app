// 비밀번호·토큰 암복호화. Windows DPAPI(현재 로그인 계정 키)를 직접 호출한다.
// 저장 형식은 기존 앱과 같다: DPAPI 암호문(옵션·엔트로피 없음)을 base64 문자열로 저장.
// 그래서 기존 앱이 저장한 global_settings.json / connections.json 의 값을 그대로 읽고, 반대로도 읽힌다.
const { Dpapi } = require('@primno/dpapi');

/** 평문을 암호화해 base64 문자열로 돌려준다. 빈 문자열은 그대로 빈 문자열. */
function encrypt(plain) {
  if (!plain) return '';
  return Buffer.from(Dpapi.protectData(Buffer.from(plain, 'utf8'), null, 'CurrentUser')).toString('base64');
}

/** encrypt() 로 만든 base64 문자열을 평문으로 돌려준다. 복호화 실패(다른 PC·계정 등)는 빈 문자열. */
function decrypt(b64) {
  if (!b64) return '';
  try {
    return Buffer.from(Dpapi.unprotectData(Buffer.from(b64, 'base64'), null, 'CurrentUser')).toString('utf8');
  } catch (e) {
    console.error('DPAPI 복호화 실패:', e.message);
    return '';
  }
}

module.exports = { encrypt, decrypt };
