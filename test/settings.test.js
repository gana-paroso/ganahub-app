const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../src/store');
const { createSettings, fileExists } = require('../src/settings');
const { decrypt } = require('../src/crypto');

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ganahub-set-'));
  return { dir, s: createSettings(createStore(dir)), raw: () => JSON.parse(fs.readFileSync(path.join(dir, 'global_settings.json'), 'utf8')) };
};

test('설정이 없으면 빈 값을 돌려준다', () => {
  const { s } = setup();
  assert.deepStrictEqual(s.get(), { share: { ip: '', name: '', id: '', hasPassword: false }, ide: [], works: { url: '', staffId: '', hasKey: false }, dbHosts: [] });
});

test('공유폴더 비밀번호는 암호화해 저장하고, 화면에는 등록 여부만 준다', () => {
  const { s, raw } = setup();
  s.saveShare({ ip: ' 192.168.0.10 ', name: 'data\\docs', id: 'user', password: '비밀pw' });
  assert.strictEqual(raw().share_ip, '192.168.0.10');
  assert.notStrictEqual(raw().share_password, '비밀pw');
  assert.strictEqual(decrypt(raw().share_password), '비밀pw');
  assert.deepStrictEqual(s.get().share, { ip: '192.168.0.10', name: 'data\\docs', id: 'user', hasPassword: true });
  assert.ok(!JSON.stringify(s.get()).includes('비밀pw'));
  assert.strictEqual(s.reveal('share'), '비밀pw');
});

test('비밀번호를 비워 저장하면 기존 비밀번호를 유지한다', () => {
  const { s, raw } = setup();
  s.saveShare({ ip: 'a', name: 'b', id: 'c', password: 'pw1' });
  const before = raw().share_password;
  s.saveShare({ ip: 'a2', name: 'b', id: 'c', password: '' });
  assert.strictEqual(raw().share_password, before);
  assert.strictEqual(raw().share_ip, 'a2');
});

test('모르는 필드(즐겨찾기 등)는 저장해도 그대로 남는다', () => {
  const { dir, s, raw } = setup();
  fs.writeFileSync(path.join(dir, 'global_settings.json'), JSON.stringify({ favorite_projects: ['가', '나'], 새필드: 1 }));
  s.saveShare({ ip: 'a', name: 'b', id: 'c', password: '' });
  assert.deepStrictEqual(raw().favorite_projects, ['가', '나']);
  assert.strictEqual(raw().새필드, 1);
});

test('IDE 목록은 기존 형식(name, exe_path)으로 저장한다', () => {
  const { s, raw } = setup();
  s.saveIde([{ name: ' VSCode ', exePath: 'C:\\x\\Code.exe' }]);
  assert.deepStrictEqual(raw().ide_executables, [{ name: 'VSCode', exe_path: 'C:\\x\\Code.exe' }]);
  assert.deepStrictEqual(s.get().ide, [{ name: 'VSCode', exePath: 'C:\\x\\Code.exe', exists: false }]);
});

test('IDE 이름·경로가 비었거나 이름이 겹치면 저장하지 않는다', () => {
  const { s } = setup();
  assert.throws(() => s.saveIde([{ name: '', exePath: 'a.exe' }]), /비어/);
  assert.throws(() => s.saveIde([{ name: 'a', exePath: '' }]), /비어/);
  assert.throws(() => s.saveIde([{ name: 'a', exePath: '1.exe' }, { name: 'a', exePath: '2.exe' }]), /같은 이름/);
});

test('업무 포털 주소 끝 슬래시는 지우고, 키는 암호화하며 비우면 유지한다', () => {
  const { s, raw } = setup();
  s.saveWorks({ url: 'https://works.example//', staffId: 'user', key: 'k1' });
  assert.strictEqual(raw().works_url, 'https://works.example');
  assert.strictEqual(s.reveal('works'), 'k1');
  s.saveWorks({ url: 'https://works.example', staffId: 'user', key: '' });
  assert.strictEqual(s.reveal('works'), 'k1');
  assert.deepStrictEqual(s.get().works, { url: 'https://works.example', staffId: 'user', hasKey: true });
});

test('fileExists 는 실제 파일만 true', () => {
  assert.ok(fileExists(__filename));
  assert.ok(!fileExists(__dirname));
  assert.ok(!fileExists(''));
  assert.ok(!fileExists(undefined));
});

test('DB 기본 허용 IP: 공백과 중복은 정리해 저장하고, 형식이 틀리면 거부한다', () => {
  const { s, raw } = setup();
  s.saveDbHosts([' localhost ', '', '192.168.0.%', 'localhost']);
  assert.deepStrictEqual(raw().db_default_hosts, ['localhost', '192.168.0.%']);
  assert.deepStrictEqual(s.get().dbHosts, ['localhost', '192.168.0.%']);
  assert.throws(() => s.saveDbHosts(["1'2"]), /형식이 올바르지/);
  assert.deepStrictEqual(raw().db_default_hosts, ['localhost', '192.168.0.%']); // 거부하면 기존 값 유지
  s.saveDbHosts([]);
  assert.deepStrictEqual(s.get().dbHosts, []);
});
