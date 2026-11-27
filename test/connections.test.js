const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../src/store');
const { createConnections } = require('../src/connections');
const { decrypt } = require('../src/crypto');

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ganahub-conn-'));
  return { c: createConnections(createStore(dir)), raw: () => JSON.parse(fs.readFileSync(path.join(dir, 'connections.json'), 'utf8')), dir };
};
const ssh = (extra = {}) => ({ type: 'ssh', name: '개발서버', description: '용도', fields: { host: '192.168.0.31', port: '2222', ssh_user: 'dev', auth_method: 'password', ssh_credential: 'sshpw', mysql_user: 'root', mysql_password: 'mypw' }, ...extra });

test('SSH 등록: 비밀값은 암호화해 저장하고, 목록에는 요약만 나온다', () => {
  const { c, raw } = setup();
  const id = c.save(ssh());
  const f = raw().connections[0].fields;
  assert.strictEqual(decrypt(f.ssh_credential), 'sshpw');
  assert.strictEqual(decrypt(f.mysql_password), 'mypw');
  assert.strictEqual(f.host, '192.168.0.31');
  assert.deepStrictEqual(c.list(), [{ id, type: 'ssh', name: '개발서버', description: '용도', summary: 'dev@192.168.0.31:2222', lastUsedAt: '' }]);
  assert.ok(!JSON.stringify(c.list()).includes('sshpw'));
});

test('수정 폼용 조회: 비밀값은 비워서 주고 등록 여부만 알린다', () => {
  const { c } = setup();
  const g = c.get(c.save(ssh()));
  assert.deepStrictEqual([g.fields.ssh_credential, g.fields.mysql_password, g.fields.host], ['', '', '192.168.0.31']);
  assert.deepStrictEqual(g.hasSecret, { ssh_credential: true, mysql_password: true });
});

test('보기·복사용: 저장된 비밀값 하나를 평문으로 돌려준다', () => {
  const { c } = setup();
  const id = c.save(ssh());
  assert.strictEqual(c.reveal(id, 'mysql_password'), 'mypw');
  assert.throws(() => c.reveal(id, 'host'), /알 수 없는/);
});

test('수정할 때 비밀값을 비우면 저장된 값을 유지한다', () => {
  const { c } = setup();
  const id = c.save(ssh());
  c.save({ ...ssh(), id, name: '이름변경', fields: { ...ssh().fields, ssh_credential: '', mysql_password: '', host: '192.168.0.99' } });
  assert.strictEqual(c.reveal(id, 'ssh_credential'), 'sshpw');
  assert.strictEqual(c.reveal(id, 'mysql_password'), 'mypw');
  assert.strictEqual(c.list()[0].summary, 'dev@192.168.0.99:2222');
});

test('SSH 인증 방식을 바꾸면 이전 비밀값은 버린다 (비밀번호↔개인키)', () => {
  const { c, raw } = setup();
  const id = c.save(ssh());
  assert.throws(() => c.save({ ...ssh(), id, fields: { ...ssh().fields, auth_method: 'key', ssh_credential: '' } }), /개인키/); // 키 경로 없이 바꿀 수 없다
  c.save({ ...ssh(), id, fields: { ...ssh().fields, auth_method: 'key', ssh_credential: 'C:/k/id_rsa' } });
  assert.strictEqual(raw().connections[0].fields.ssh_credential, 'C:/k/id_rsa');
  c.save({ ...ssh(), id, fields: { ...ssh().fields, auth_method: 'password', ssh_credential: '' } }); // 다시 비밀번호로: 키 경로를 비밀번호로 쓰지 않는다
  assert.strictEqual(raw().connections[0].fields.ssh_credential, '');
});

test('개인키 경로는 암호화하지 않고, 수정 조회에서도 그대로 보인다', () => {
  const { c, raw } = setup();
  const id = c.save(ssh({ fields: { ...ssh().fields, auth_method: 'key', ssh_credential: 'C:\\Users\\me\\.ssh\\id_rsa' } }));
  assert.strictEqual(raw().connections[0].fields.ssh_credential, 'C:\\Users\\me\\.ssh\\id_rsa');
  assert.strictEqual(c.get(id).fields.ssh_credential, 'C:\\Users\\me\\.ssh\\id_rsa');
  assert.strictEqual(c.get(id).hasSecret.ssh_credential, false);
});

test('Git·Jenkins: 제공자와 주소를 정리해서 저장한다', () => {
  const { c, raw } = setup();
  c.save({ type: 'git', name: 'g', fields: { provider: 'GitLab', git_username: 'u', git_token: 't1' } });
  c.save({ type: 'jenkins', name: 'j', fields: { url: 'https://jenkins.example//', jenkins_user: 'u', jenkins_token: 't2' } });
  const [g, j] = raw().connections;
  assert.strictEqual(g.fields.provider, 'gitlab');
  assert.strictEqual(decrypt(g.fields.git_token), 't1');
  assert.strictEqual(j.fields.url, 'https://jenkins.example');
  assert.deepStrictEqual(c.list().map(x => x.summary), ['GitLab · u', 'u · https://jenkins.example']);
});

test('입력 검사: 이름, 필수 항목, Port', () => {
  const { c } = setup();
  assert.throws(() => c.save({ ...ssh(), name: ' ' }), /이름/);
  assert.throws(() => c.save(ssh({ fields: { ...ssh().fields, host: '' } })), /Host/);
  assert.throws(() => c.save(ssh({ fields: { ...ssh().fields, port: '99999' } })), /Port/);
  assert.throws(() => c.save(ssh({ fields: { ...ssh().fields, port: 'abc' } })), /Port/);
  assert.throws(() => c.save(ssh({ fields: { ...ssh().fields, auth_method: 'key', ssh_credential: '' } })), /개인키/);
  assert.throws(() => c.save({ type: 'git', name: 'g', fields: { provider: 'github', git_username: '' } }), /ID/);
  assert.throws(() => c.save({ type: 'ftp', name: 'x', fields: {} }), /알 수 없는/);
});

test('Port 를 비우면 22, 목록에 없는 필드는 저장하지 않는다', () => {
  const { c, raw } = setup();
  c.save(ssh({ fields: { ...ssh().fields, port: '', 엉뚱한: 'x' } }));
  assert.strictEqual(raw().connections[0].fields.port, '22');
  assert.ok(!('엉뚱한' in raw().connections[0].fields));
});

test('연결 테스트용: 비밀값을 비운 폼은 저장된 값으로 채운다', () => {
  const { c } = setup();
  const id = c.save(ssh());
  const f = c.withStored(id, 'ssh', { ...ssh().fields, ssh_credential: '', mysql_password: '새비번' });
  assert.deepStrictEqual([f.ssh_credential, f.mysql_password], ['sshpw', '새비번']);
  assert.strictEqual(c.withStored(null, 'ssh', { ssh_credential: '' }).ssh_credential, '');
});

test('삭제와 마지막 사용 시각, 파일의 다른 값 보존', () => {
  const { c, raw, dir } = setup();
  fs.writeFileSync(path.join(dir, 'connections.json'), JSON.stringify({ connections: [], 새필드: 1 }));
  const id = c.save(ssh());
  c.touch(id);
  assert.match(c.list()[0].lastUsedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  c.remove(id);
  assert.deepStrictEqual(c.list(), []);
  assert.strictEqual(raw().새필드, 1);
  assert.throws(() => c.remove('없는id'), /찾을 수 없/);
});
