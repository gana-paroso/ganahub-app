// DB 관리: 가짜 SSH 서버가 mysql 명령처럼 응답한다. 받은 SQL 을 모두 기록해 어떤 SQL 이 서버로 갔는지 확인한다.
const test = require('node:test');
const assert = require('node:assert');
const { generateKeyPairSync } = require('crypto');
const { Server } = require('ssh2');
const db = require('../src/db');

/** 가짜 서버: SSH 비밀번호 'good', MySQL 비밀번호 'rootpw'. 기록(queries)과 서버 버전(version)을 바꿔 가며 쓴다. */
function startServer() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'pkcs1', format: 'pem' } });
  const state = { queries: [], version: '8.0.36' };
  const answer = sql => {
    if (sql.startsWith('SHOW DATABASES')) return 'information_schema\nmysql\nsample_dev\nc_dev\nsys\n';
    if (sql.startsWith('SELECT User, Host')) return 'root\tlocalhost\nmysql.sys\tlocalhost\nsample_user\t192.168.0.%\nsample_user\tlocalhost\n\t%\n';
    if (sql.startsWith("SELECT Host FROM mysql.user WHERE User = 'sample_user'")) return '192.168.0.%\nlocalhost\n';
    if (sql.startsWith('SHOW GRANTS')) return 'GRANT USAGE ON *.* TO `sample_user`@`192.168.0.%`\nGRANT ALL PRIVILEGES ON `sample_dev`.* TO `sample_user`@`192.168.0.%`\n';
    if (sql.startsWith('SELECT VERSION')) return `${state.version}\n`;
    return '';
  };
  const server = new Server({ hostKeys: [privateKey] }, client => {
    client.on('error', () => {});
    client.on('authentication', ctx => (ctx.method === 'password' && ctx.username === 'dev' && ctx.password === 'good' ? ctx.accept() : ctx.reject(['password'])));
    client.on('ready', () => client.on('session', accept => accept().on('exec', (acceptExec, _reject, info) => {
      const stream = acceptExec();
      let sql = '';
      stream.on('data', d => { sql += d; });
      stream.on('end', () => {
        if (!info.command.includes("-p'rootpw'")) { stream.stderr.write('ERROR 1045: Access denied\n'); stream.exit(1); return stream.end(); }
        state.queries.push({ batch: info.command.includes('-B -N'), sql });
        stream.write(answer(sql)); stream.exit(0); stream.end();
      });
    })));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port })));
}

const fields = (port, extra = {}) => ({ host: '127.0.0.1', port: String(port), ssh_user: 'dev', auth_method: 'password', ssh_credential: 'good', mysql_user: 'dbadmin', mysql_password: 'rootpw', ...extra });
/** 서버를 띄우고 fn 을 실행한 뒤 닫는다. 로그는 logs 에 모은다. */
async function withServer(fn, extra) {
  const s = await startServer(), logs = [];
  try { return await fn({ ...s, f: fields(s.port, extra), log: (lv, m) => logs.push(`${lv}|${m}`), logs }); } finally { s.server.close(); }
}
const sqls = state => state.queries.map(q => q.sql);

/* ---------- 순수 도우미 ---------- */

test('SQL 값과 식별자를 안전하게 감싼다', () => {
  assert.strictEqual(db.lit("a'b\\c"), "'a\\'b\\\\c'");
  assert.strictEqual(db.lit("x' OR '1'='1"), "'x\\' OR \\'1\\'=\\'1'");
  assert.strictEqual(db.ident('my`db'), '`my``db`');
});

test('이름·host 검사, 내부 계정 판별', () => {
  assert.ok(db.validIdentifier('my_db1'));
  for (const bad of ['', 'a-b', 'a b', "a'b", 'a;b', '한글']) assert.ok(!db.validIdentifier(bad), bad);
  for (const good of ['192.168.0.%', '%', 'localhost', '192.168.0.1']) assert.ok(db.validHost(good), good);
  for (const bad of ['', "a'b", 'a b', 'a;b', 'x'.repeat(256)]) assert.ok(!db.validHost(bad), bad);
  for (const u of ['root', 'mysql.sys', '']) assert.ok(db.isHiddenUser(u), u);
  assert.ok(!db.isHiddenUser('sample_user'));
});

test('권한: ALL 은 ALL PRIVILEGES, 허용 목록 밖이면 거부', () => {
  assert.strictEqual(db.privilegeClause(['ALL']), 'ALL PRIVILEGES');
  assert.strictEqual(db.privilegeClause(['SELECT', 'INSERT']), 'SELECT, INSERT');
  assert.throws(() => db.privilegeClause([]), /하나 이상/);
  assert.throws(() => db.privilegeClause(['SELECT', 'GRANT OPTION']), /허용되지 않는/);
  assert.throws(() => db.privilegeClause(['SELECT; DROP DATABASE x']), /허용되지 않는/);
});

test('ALTER USER 를 쓸 수 있는 서버 버전', () => {
  for (const v of ['8.0.36', '5.7.44-log', '10.6.12-MariaDB', '10.2.0-MariaDB', '']) assert.ok(db.useAlterUser(v), v);
  for (const v of ['5.6.51', '5.5.62-0ubuntu', '10.1.48-MariaDB']) assert.ok(!db.useAlterUser(v), v);
});

test('mysql -B 출력의 행·열과 이스케이프를 해석한다', () => {
  assert.deepStrictEqual(db.parseRows('a\tb\n\t%\nx\\ty\\\\z\tw\n'), [['a', 'b'], ['', '%'], ['x\ty\\z', 'w']]);
});

/* ---------- 서버 작업 ---------- */

test('접속 테스트: 성공 / MySQL 계정 미등록 / MySQL 비밀번호 틀림 / SSH 비밀번호 틀림', () => withServer(async ({ f, log, logs, port }) => {
  assert.strictEqual((await db.testConnection(f, log)).ok, true);
  assert.ok(logs.some(l => l.startsWith('success|[OK] DB 접속 테스트')));
  logs.length = 0;
  assert.strictEqual((await db.testConnection({ ...f, mysql_user: '', mysql_password: '' }, log)).ok, false);
  assert.match(logs.join('\n'), /MySQL 계정이 등록되어 있지 않습니다/);
  logs.length = 0;
  assert.strictEqual((await db.testConnection({ ...f, mysql_password: 'nope' }, log)).ok, false);
  assert.match(logs.join('\n'), /Access denied/);
  logs.length = 0;
  assert.strictEqual((await db.testConnection({ ...f, ssh_credential: 'bad' }, log)).ok, false);
  assert.match(logs.join('\n'), /SSH 접속 실패: 인증에 실패/);
}));

test('개요: 시스템 스키마와 내부 계정은 빼고, 이 앱이 쓰는 계정을 알려 준다', () => withServer(async ({ f, log }) => {
  const r = await db.overview(f, log);
  assert.deepStrictEqual(r.data, { databases: ['sample_dev', 'c_dev'], users: { sample_user: ['192.168.0.%', 'localhost'] }, inUse: 'dbadmin' });
}));

test('사용자 상세: USAGE 는 빼고 권한 대상의 백틱은 지운다', () => withServer(async ({ f, log, state }) => {
  const r = await db.userDetail(f, 'sample_user', log);
  assert.deepStrictEqual(r.data.hosts[0], { host: '192.168.0.%', grants: [{ privileges: 'ALL PRIVILEGES', target: 'sample_dev.*' }] });
  assert.strictEqual((await db.userDetail(f, 'root', log)).ok, false);
  assert.ok(!sqls(state).some(s => s.includes("'root'")));
}));

test('신규 사용자로 생성: DB → host 마다 계정+권한 → FLUSH 순서, 비밀번호는 로그에 남지 않는다', () => withServer(async ({ f, log, logs, state }) => {
  const r = await db.createDatabase(f, { db: 'myproject_dev', mode: 'new', user: 'my_user', password: "pw'x\\y", hosts: ['192.168.0.%', '%'], privileges: ['ALL'] }, log);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(sqls(state), [
    'CREATE DATABASE `myproject_dev`;',
    "CREATE USER 'my_user'@'192.168.0.%' IDENTIFIED BY 'pw\\'x\\\\y'; GRANT ALL PRIVILEGES ON `myproject_dev`.* TO 'my_user'@'192.168.0.%';",
    "CREATE USER 'my_user'@'%' IDENTIFIED BY 'pw\\'x\\\\y'; GRANT ALL PRIVILEGES ON `myproject_dev`.* TO 'my_user'@'%';",
    'FLUSH PRIVILEGES;'
  ]);
  const text = logs.join('\n');
  assert.ok(!text.includes('pw') && !text.includes('rootpw'), '로그에 비밀번호가 보이면 안 된다');
  assert.match(text, /IDENTIFIED BY \*\*\*\*/);
}));

test('기존 사용자로 생성: 없는 host 에 비밀번호가 없으면 DB 를 만들기 전에 멈춘다', () => withServer(async ({ f, log, logs, state }) => {
  const args = { db: 'x_dev', mode: 'existing', user: 'sample_user', hosts: ['192.168.0.%', '10.%'], privileges: ['SELECT'] };
  assert.strictEqual((await db.createDatabase(f, { ...args, password: '' }, log)).ok, false);
  assert.match(logs.join('\n'), /비밀번호가 필요합니다/);
  assert.ok(!sqls(state).some(s => s.startsWith('CREATE DATABASE')));
  state.queries.length = 0;
  assert.strictEqual((await db.createDatabase(f, { ...args, password: 'newpw' }, log)).ok, true);
  const run = sqls(state).filter(s => !s.startsWith('SELECT'));
  assert.deepStrictEqual(run, [
    'CREATE DATABASE `x_dev`;',
    "GRANT SELECT ON `x_dev`.* TO 'sample_user'@'192.168.0.%';",
    "CREATE USER 'sample_user'@'10.%' IDENTIFIED BY 'newpw'; GRANT SELECT ON `x_dev`.* TO 'sample_user'@'10.%';",
    'FLUSH PRIVILEGES;'
  ]);
}));

test('생성 입력 검사: 잘못된 이름·host·권한은 서버에 접속하지 않고 거부한다', () => withServer(async ({ f, log, state, logs }) => {
  const ok = { db: 'good_db', mode: 'new', user: 'good_user', password: 'pw', hosts: ['%'], privileges: ['ALL'] };
  const cases = [{ db: 'bad-name' }, { db: 'a`b' }, { user: "x'y" }, { password: '' }, { hosts: [] }, { hosts: ["1'2"] }, { privileges: ['DROP USER'] }, { privileges: [] }, { mode: 'x' }];
  for (const c of cases) assert.strictEqual((await db.createDatabase(f, { ...ok, ...c }, log)).ok, false, JSON.stringify(c));
  assert.strictEqual((await db.createDatabase(f, { ...ok, mode: 'existing', user: 'root' }, log)).ok, false);
  assert.deepStrictEqual(state.queries, []);
  assert.ok(!logs.some(l => l.includes('SSH 접속')));
}));

test('Database 삭제: 시스템 스키마는 거부, 이름은 백틱으로 감싼다', () => withServer(async ({ f, log, state }) => {
  assert.strictEqual((await db.dropDatabase(f, 'mysql', log)).ok, false);
  assert.strictEqual((await db.dropDatabase(f, 'sample_dev', log)).ok, true);
  assert.deepStrictEqual(sqls(state), ['DROP DATABASE `sample_dev`;']);
}));

test('계정 삭제·권한 회수·비밀번호 변경: root 와 이 앱이 쓰는 계정은 거부', () => withServer(async ({ f, log, logs, state }) => {
  for (const user of ['root', 'dbadmin']) {
    assert.strictEqual((await db.dropUserHost(f, { user, host: '%' }, log)).ok, false, user);
    assert.strictEqual((await db.revokeDatabase(f, { user, host: '%', db: 'x' }, log)).ok, false, user);
    assert.strictEqual((await db.changePassword(f, { user, host: '%', password: 'p' }, log)).ok, false, user);
  }
  assert.match(logs.join('\n'), /연결에 사용 중인 계정/);
  assert.deepStrictEqual(state.queries, []);
  assert.strictEqual((await db.dropUserHost(f, { user: 'sample_user', host: 'localhost' }, log)).ok, true);
  assert.strictEqual((await db.revokeDatabase(f, { user: 'sample_user', host: '%', db: 'sample_dev' }, log)).ok, true);
  assert.strictEqual((await db.revokeDatabase(f, { user: 'sample_user', host: '%', db: '*' }, log)).ok, false);
  assert.deepStrictEqual(sqls(state), ["DROP USER 'sample_user'@'localhost'; FLUSH PRIVILEGES;", "REVOKE ALL PRIVILEGES ON `sample_dev`.* FROM 'sample_user'@'%'; FLUSH PRIVILEGES;"]);
}));

test('비밀번호 변경: 서버 버전에 따라 ALTER USER 또는 SET PASSWORD', () => withServer(async ({ f, log, state }) => {
  await db.changePassword(f, { user: 'sample_user', host: '%', password: 'n1' }, log);
  state.version = '5.6.51';
  await db.changePassword(f, { user: 'sample_user', host: '%', password: 'n2' }, log);
  assert.deepStrictEqual(sqls(state).filter(s => !s.startsWith('SELECT')), [
    "ALTER USER 'sample_user'@'%' IDENTIFIED BY 'n1'; FLUSH PRIVILEGES;",
    "SET PASSWORD FOR 'sample_user'@'%' = PASSWORD('n2'); FLUSH PRIVILEGES;"
  ]);
}));

test('Host 추가: 이미 있는 host 는 거부, 새 host 는 계정만 만든다', () => withServer(async ({ f, log, state }) => {
  assert.strictEqual((await db.addHost(f, { user: 'sample_user', host: 'localhost', password: 'p' }, log)).ok, false);
  assert.strictEqual((await db.addHost(f, { user: 'sample_user', host: '10.%', password: 'p' }, log)).ok, true);
  assert.strictEqual((await db.addHost(f, { user: 'sample_user', host: "1'2", password: 'p' }, log)).ok, false);
  assert.deepStrictEqual(sqls(state).filter(s => s.startsWith('CREATE')), ["CREATE USER 'sample_user'@'10.%' IDENTIFIED BY 'p';"]);
}));
