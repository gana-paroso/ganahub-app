// DPAPI 암복호화 확인. Windows 현재 계정에서만 동작한다.
const test = require('node:test');
const assert = require('node:assert');
const { encrypt, decrypt } = require('../src/crypto');

test('암호화한 값을 다시 풀면 원문이 나온다 (한글·특수문자 포함)', () => {
  const plain = '한글pw!@#$%^&*()';
  const enc = encrypt(plain);
  assert.notStrictEqual(enc, plain);
  assert.strictEqual(decrypt(enc), plain);
});

test('빈 문자열은 그대로 빈 문자열', () => {
  assert.strictEqual(encrypt(''), '');
  assert.strictEqual(decrypt(''), '');
});

test('암호문이 아닌 값은 예외 없이 빈 문자열', () => {
  assert.strictEqual(decrypt('이건 암호문이 아님'), '');
  assert.strictEqual(decrypt(Buffer.from('abc').toString('base64')), '');
});

test('기존 앱과 같은 형식이다 (DPAPI blob 은 base64 로 AQAAANCMnd8 로 시작)', () => {
  assert.ok(encrypt('x').startsWith('AQAAANCMnd8'));
});
