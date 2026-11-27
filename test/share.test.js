const test = require('node:test');
const assert = require('node:assert');
const { buildSharePath, parseErrorCode, testConnection } = require('../src/share');

test('공유 경로를 \\\\ip\\이름 형태로 만든다', () => {
  assert.strictEqual(buildSharePath('192.168.0.10', 'data'), '\\\\192.168.0.10\\data');
  assert.strictEqual(buildSharePath('192.168.0.10', ' /data/docs/ '), '\\\\192.168.0.10\\data\\docs');
  assert.strictEqual(buildSharePath('192.168.0.10', 'data\\docs\\'), '\\\\192.168.0.10\\data\\docs');
});

test('net 오류 출력에서 오류 번호를 뽑는다 (영문, 한글이 깨진 경우, 빈 출력)', () => {
  assert.strictEqual(parseErrorCode('System error 1326 has occurred.\r\n'), 1326);
  assert.strictEqual(parseErrorCode('�� 53��(��) ���'), 53);
  assert.strictEqual(parseErrorCode(''), 1);
});

test('입력이 비었거나 위험한 문자가 있으면 연결을 시도하지 않는다', async () => {
  assert.strictEqual((await testConnection({ ip: '', name: 'data' })).ok, false);
  assert.match((await testConnection({ ip: '1.2.3.4 /delete', name: 'data' })).message, /사용할 수 없는/);
  assert.match((await testConnection({ ip: '1.2.3.4', name: 'a|b' })).message, /사용할 수 없는/);
});

test('없는 공유에 연결하면 실패와 안내 문구를 돌려준다', { timeout: 60000 }, async () => {
  const r = await testConnection({ ip: 'localhost', name: 'ganahub_no_such_share', id: 'nobody', password: 'x' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.message.length > 0);
});
