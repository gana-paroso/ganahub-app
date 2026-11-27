const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../src/store');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ganahub-store-'));

test('없는 파일은 fallback 을 돌려준다', () => {
  assert.deepStrictEqual(createStore(tmpDir()).read('connections.json', { connections: [] }), { connections: [] });
});

test('쓴 내용을 그대로 읽고, 임시 파일은 남지 않는다', () => {
  const dir = tmpDir(), s = createStore(dir);
  s.write('global_settings.json', { share_ip: '192.168.0.10', favorite_projects: ['가', '나'] });
  assert.deepStrictEqual(s.read('global_settings.json', {}), { share_ip: '192.168.0.10', favorite_projects: ['가', '나'] });
  assert.deepStrictEqual(fs.readdirSync(dir), ['global_settings.json']);
});

test('기존 앱과 같은 형식으로 저장한다 (들여쓰기 2칸, 한글 그대로)', () => {
  const dir = tmpDir();
  createStore(dir).write('connections.json', { connections: [{ name: '개발서버' }] });
  assert.strictEqual(fs.readFileSync(path.join(dir, 'connections.json'), 'utf8'), '{\n  "connections": [\n    {\n      "name": "개발서버"\n    }\n  ]\n}');
});

test('내용이 깨진 파일은 빈 값으로 바꾸지 않고 예외를 던진다', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'connections.json'), '{깨짐');
  assert.throws(() => createStore(dir).read('connections.json', {}), /connections\.json/);
});

test('최초 백업은 한 번만 만들고, 이후 수정해도 덮어쓰지 않는다', () => {
  const dir = tmpDir(), s = createStore(dir);
  s.write('global_settings.json', { v: 1 });
  s.backupOnce();
  s.write('global_settings.json', { v: 2 });
  s.backupOnce();
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'global_settings.json.bak'), 'utf8')), { v: 1 });
  assert.ok(!fs.existsSync(path.join(dir, 'connections.json.bak'))); // 없는 파일은 백업하지 않는다
});
