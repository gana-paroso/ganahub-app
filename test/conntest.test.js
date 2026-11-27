// 연결 테스트: 이 PC 안에 가짜 SSH 서버와 Jenkins(HTTP) 서버를 띄워 확인한다.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { generateKeyPairSync } = require('crypto');
const { Server } = require('ssh2');
const { test: runTest, gitRequest, shq } = require('../src/conntest');

/** 비밀번호 'good' 만 허용하고, mysql 명령은 비밀번호 'rootpw' 일 때만 성공하는 가짜 SSH 서버. */
function startSsh() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' } });
  const server = new Server({ hostKeys: [privateKey] }, client => {
    client.on('error', () => {});
    client.on('authentication', ctx => (ctx.method === 'password' && ctx.username === 'dev' && ctx.password === 'good' ? ctx.accept() : ctx.reject(['password'])));
    client.on('ready', () => client.on('session', accept => accept().on('exec', (acceptExec, _reject, info) => {
      const stream = acceptExec(), ok = info.command.includes(`-p'rootpw'`);
      if (!ok) stream.stderr.write('ERROR 1045: Access denied\n');
      stream.exit(ok ? 0 : 1); stream.end();
    })));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

/** user:token 이 jenkins:tok 이면 200, boom 이면 500, 그 밖에는 401 을 돌려주는 가짜 Jenkins. */
function startHttp() {
  const server = http.createServer((req, res) => {
    const [u, t] = Buffer.from((req.headers.authorization || '').replace('Basic ', ''), 'base64').toString().split(':');
    res.statusCode = req.url !== '/api/json' ? 404 : u === 'jenkins' && t === 'tok' ? 200 : u === 'boom' ? 500 : 401;
    res.end('{}');
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

const sshFields = (port, extra = {}) => ({ host: '127.0.0.1', port: String(port), ssh_user: 'dev', auth_method: 'password', ssh_credential: 'good', mysql_user: '', mysql_password: '', ...extra });

test('SSH: 접속 성공 / 비밀번호 틀림 / 접속 거부', async () => {
  const { server, port } = await startSsh();
  try {
    assert.deepStrictEqual((await runTest('ssh', sshFields(port))).ok, true);
    const bad = await runTest('ssh', sshFields(port, { ssh_credential: 'bad' }));
    assert.deepStrictEqual([bad.ok, bad.message], [false, '인증에 실패했습니다 (ID/비밀번호 또는 키를 확인해주세요)']);
    const refused = await runTest('ssh', sshFields(1));
    assert.strictEqual(refused.ok, false);
    assert.match(refused.message, /^연결 실패/);
  } finally { server.close(); }
});

test('SSH: MySQL 계정까지 확인한다 (성공 / 실패 / 한쪽만 입력)', async () => {
  const { server, port } = await startSsh();
  try {
    const ok = await runTest('ssh', sshFields(port, { mysql_user: 'root', mysql_password: 'rootpw' }));
    assert.strictEqual(ok.ok, true);
    assert.match(ok.message, /MySQL 로그인/);
    const bad = await runTest('ssh', sshFields(port, { mysql_user: 'root', mysql_password: 'nope' }));
    assert.strictEqual(bad.ok, false);
    assert.match(bad.message, /MySQL 인증에 실패.*Access denied/);
    const half = await runTest('ssh', sshFields(port, { mysql_user: 'root' }));
    assert.deepStrictEqual([half.ok, /모두 입력/.test(half.message)], [true, true]);
  } finally { server.close(); }
});

test('SSH: 개인키 파일이 없으면 이유를 알려 준다', async () => {
  const r = await runTest('ssh', sshFields(22, { auth_method: 'key', ssh_credential: 'C:\\없는\\키' }));
  assert.strictEqual(r.ok, false);
  assert.match(r.message, /개인키 파일을 읽을 수 없습니다/);
});

test('Jenkins: 성공 / 인증 실패 / 서버 오류 / 접속 불가 / 잘못된 주소', async () => {
  const { server, port } = await startHttp();
  const url = `http://127.0.0.1:${port}/`;
  try {
    assert.strictEqual((await runTest('jenkins', { url, jenkins_user: 'jenkins', jenkins_token: 'tok' })).ok, true);
    assert.strictEqual((await runTest('jenkins', { url, jenkins_user: 'jenkins', jenkins_token: 'x' })).message, 'ID 또는 API Token이 올바르지 않습니다');
    assert.match((await runTest('jenkins', { url, jenkins_user: 'boom', jenkins_token: 'x' })).message, /상태 코드 500/);
    assert.match((await runTest('jenkins', { url: 'http://127.0.0.1:1', jenkins_user: 'a', jenkins_token: 'b' })).message, /^연결 실패/);
    assert.match((await runTest('jenkins', { url: 'ftp://x', jenkins_user: 'a', jenkins_token: 'b' })).message, /http/);
  } finally { server.close(); }
});

test('Git: 토큰이 비면 요청하지 않고, 요청 주소와 헤더는 제공자별로 다르다', async () => {
  assert.strictEqual((await runTest('git', { provider: 'github', git_token: '' })).ok, false);
  assert.strictEqual(gitRequest('github', 'T').url, 'https://api.github.com/user');
  assert.strictEqual(gitRequest('github', 'T').headers.Authorization, 'token T');
  assert.deepStrictEqual([gitRequest('gitlab', 'T').url, gitRequest('gitlab', 'T').headers['PRIVATE-TOKEN']], ['https://gitlab.com/api/v4/user', 'T']);
});

test('셸 인용: 작은따옴표가 들어 있어도 명령이 끊기지 않는다', () => {
  assert.strictEqual(shq('a b'), `'a b'`);
  assert.strictEqual(shq(`it's`), `'it'\\''s'`);
});

test('알 수 없는 유형', async () => {
  assert.strictEqual((await runTest('ftp', {})).ok, false);
});
