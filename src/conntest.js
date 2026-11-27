// 연결 테스트: SSH(+MySQL 로그인) / Git 토큰 / Jenkins. 모두 네트워크 호출이라 메인 프로세스에서 비동기로 실행한다.
const fs = require('fs');
const { Client } = require('ssh2');

const TIMEOUT = 6000;

/** 셸에 안전하게 넘기기 위해 작은따옴표로 감싼다. */
const shq = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

function describeSsh(e) {
  if (e.level === 'client-authentication') return '인증에 실패했습니다 (ID/비밀번호 또는 키를 확인해주세요)';
  if (e.level === 'client-timeout') return '연결 시간이 초과되었습니다 (Host/Port를 확인해주세요)';
  return `연결 실패: ${e.message}`;
}

/** SSH 로 접속한다. 성공하면 접속된 Client, 실패하면 사용자에게 보여줄 메시지를 담은 예외. */
function connect(f) {
  return new Promise((resolve, reject) => {
    const opts = { host: f.host, port: Number(f.port) || 22, username: f.ssh_user, readyTimeout: TIMEOUT, tryKeyboard: true };
    if (f.auth_method === 'key') {
      try { opts.privateKey = fs.readFileSync(f.ssh_credential); } catch (e) { return reject(new Error(`개인키 파일을 읽을 수 없습니다: ${e.code || e.message}`)); }
    } else opts.password = f.ssh_credential;
    const c = new Client();
    c.on('keyboard-interactive', (_n, _i, _l, _p, finish) => finish([f.ssh_credential])); // 비밀번호를 대화형으로만 받는 서버
    c.on('ready', () => resolve(c));
    c.on('error', e => reject(new Error(describeSsh(e))));
    c.connect(opts);
  });
}

/** 원격에서 명령을 실행해 { code, stderr } 를 돌려준다. */
function run(c, command) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('명령 실행 시간이 초과되었습니다')), TIMEOUT);
    c.exec(command, (err, stream) => {
      if (err) { clearTimeout(timer); return reject(err); }
      let stderr = '';
      stream.on('data', () => {}).stderr.on('data', d => { stderr += d; });
      stream.on('close', code => { clearTimeout(timer); resolve({ code, stderr: stderr.trim() }); });
    });
  });
}

/** SSH 접속을 확인하고, MySQL ID/PW 가 있으면 그 서버의 mysql 로 로그인도 확인한다. */
async function testSsh(f) {
  let c;
  try { c = await connect(f); } catch (e) { return { ok: false, message: e.message }; }
  try {
    const where = `${f.host}:${f.port || 22}`;
    if (!f.mysql_user && !f.mysql_password) return { ok: true, message: `${where} SSH 연결에 성공했습니다` };
    if (!f.mysql_user || !f.mysql_password) return { ok: true, message: `${where} SSH 연결에 성공했습니다 (MySQL은 ID와 비밀번호를 모두 입력해야 확인해요)` };
    const { code, stderr } = await run(c, `mysql -u${shq(f.mysql_user)} -p${shq(f.mysql_password)} -e 'SELECT 1;'`);
    if (code !== 0) return { ok: false, message: `SSH 연결에는 성공했지만 MySQL 인증에 실패했습니다: ${stderr.replace(/^.*Using a password.*\n?/m, '').trim() || '알 수 없는 오류'}` };
    return { ok: true, message: `SSH 접속과 MySQL 로그인('${f.mysql_user}')에 성공했습니다` };
  } catch (e) {
    return { ok: false, message: `MySQL 접속 확인 중 오류가 발생했습니다: ${e.message}` };
  } finally { c.end(); }
}

/** HTTP 호출. 실패는 사용자에게 보여줄 메시지로 바꿔 { ok:false } 로 돌려준다. */
async function http(url, headers) {
  try { return { res: await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) }) }; } catch (e) {
    return { ok: false, message: e.name === 'TimeoutError' ? '연결 시간이 초과되었습니다 (주소를 확인해주세요)' : `연결 실패: ${e.cause?.code || e.message}` };
  }
}

/** 토큰 확인용 요청 주소와 헤더. GitHub 는 /user, GitLab 은 /api/v4/user. */
function gitRequest(provider, token) {
  return provider === 'gitlab'
    ? { url: 'https://gitlab.com/api/v4/user', headers: { 'PRIVATE-TOKEN': token } }
    : { url: 'https://api.github.com/user', headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'GanaHub' } };
}

async function testGit(f) {
  if (!f.git_token) return { ok: false, message: '토큰을 입력해 주세요' };
  const { url, headers } = gitRequest(f.provider, f.git_token);
  const r = await http(url, headers);
  if (!r.res) return r;
  if (r.res.status === 200) { const d = await r.res.json().catch(() => ({})); return { ok: true, message: `토큰 인증에 성공했습니다 (계정: ${d.login || d.username || f.git_username})` }; }
  if (r.res.status === 401) return { ok: false, message: '토큰이 올바르지 않거나 만료되었습니다' };
  return { ok: false, message: `인증 실패 (상태 코드 ${r.res.status})` };
}

async function testJenkins(f) {
  if (!/^https?:\/\//i.test(f.url)) return { ok: false, message: 'URL은 http:// 또는 https:// 로 시작해야 해요' };
  const auth = Buffer.from(`${f.jenkins_user}:${f.jenkins_token}`).toString('base64');
  const r = await http(`${f.url.replace(/\/+$/, '')}/api/json`, { Authorization: `Basic ${auth}` });
  if (!r.res) return r;
  if (r.res.status === 200) return { ok: true, message: 'Jenkins 인증에 성공했습니다' };
  if (r.res.status === 401) return { ok: false, message: 'ID 또는 API Token이 올바르지 않습니다' };
  return { ok: false, message: `인증 실패 (상태 코드 ${r.res.status})` };
}

/** 연결 유형에 맞는 테스트를 실행한다. 반환: { ok, message } */
async function test(type, fields) {
  if (type === 'ssh') return testSsh(fields);
  if (type === 'git') return testGit(fields);
  if (type === 'jenkins') return testJenkins(fields);
  return { ok: false, message: '알 수 없는 연결 유형입니다' };
}

module.exports = { test, connect, gitRequest, shq };
