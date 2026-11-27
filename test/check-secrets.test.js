// 공개 전 검사 스크립트. 걸려야 하는 값은 코드에 그대로 적으면 검사에 걸리므로, 조각을 이어 붙여 만든다.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const path = require('path');
const { scanText, parseDenyList, GENERIC } = require('../scripts/check-secrets');

const ip = (...p) => p.join('.');
const hits = (text, rules = GENERIC) => scanText(text, rules);

test('사설 IP 주소는 걸리고, 샘플 대역과 공인 주소·버전 번호는 통과한다', () => {
  for (const bad of [ip(10, 1, 2, 3), ip(172, 16, 0, 1), ip(172, 31, 255, 1), ip(192, 168, 1, 5), `접속: ${ip(10, 0, 0, 1)}:22`]) assert.strictEqual(hits(bad).length, 1, bad);
  for (const ok of [ip(192, 168, 0, 10), ip(127, 0, 0, 1), ip(172, 15, 0, 1), ip(172, 32, 0, 1), ip(8, 8, 8, 8), '1.2.3', 'v10.9.2', '192.168.0.%']) assert.strictEqual(hits(ok).length, 0, ok);
});

test('개인 키와 GitHub 토큰은 걸린다', () => {
  assert.strictEqual(hits(`-----BEGIN ${'RSA PRIVATE KEY'}-----`).length, 1);
  assert.strictEqual(hits(`token=${'ghp_'}${'a'.repeat(30)}`).length, 1);
  assert.strictEqual(hits(`${'github_pat_'}${'A1_'.repeat(10)}`).length, 1);
  assert.strictEqual(hits('ghp_짧음').length, 0);
});

test('걸린 줄 번호를 알려 주고, 걸린 내용은 결과에 담지 않는다', () => {
  const secret = ip(172, 20, 1, 1);
  const r = hits(`첫 줄\n둘째 줄\n주소 ${secret}\n끝`);
  assert.deepStrictEqual(r.map(x => x.line), [3]);
  assert.ok(!JSON.stringify(r).includes(secret));
});

test('금지 목록: 주석과 빈 줄은 건너뛰고, 대소문자를 무시하며, 앞뒤 조건(lookbehind)을 쓸 수 있다', () => {
  const rules = parseDenyList('# 설명\n\n  Customer-Name  \n(?<!pub-)internal\n');
  assert.strictEqual(rules.length, 2);
  assert.strictEqual(hits('A CUSTOMER-name 입니다', rules).length, 1);
  assert.strictEqual(hits('internal 문서', rules).length, 1);
  assert.strictEqual(hits('pub-internal 문서', rules).length, 0);
  assert.deepStrictEqual(parseDenyList(''), []);
  assert.deepStrictEqual(parseDenyList(undefined), []);
});

test('금지 목록의 정규식이 틀리면 몇 번째 줄인지 알려 준다', () => {
  assert.throws(() => parseDenyList('정상\n(닫히지 않음'), /2번째 줄/);
});

test('금지 목록에 걸리면 규칙 이름(줄 번호)만 알려 주고 내용은 알려 주지 않는다', () => {
  const r = scanText('비밀단어 포함', parseDenyList('# 주석\n비밀단어'));
  assert.deepStrictEqual(r, [{ line: 1, rule: '금지 목록 2번째 줄' }]);
});

test('현재 저장소 파일은 검사를 통과한다 (일반 규칙과, 이 PC에 금지 목록이 있으면 그것까지)', () => {
  assert.doesNotThrow(() => execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'check-secrets.js')], { encoding: 'utf8', stdio: 'pipe' }));
});
