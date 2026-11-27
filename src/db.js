// DB 관리: SSH 로 서버에 접속해 그 서버의 mysql CLI 로 개발용 DB·계정을 만들고 정리한다.
// SQL 은 셸 인용 문제를 피하려고 명령줄이 아니라 표준입력(stdin)으로 mysql 에 넘긴다.
// 단계마다 log(level, message) 로 화면의 터미널에 알린다. level: cmd / success / error / info
const { connect, shq } = require('./conntest');

const TIMEOUT = 10000;
const ID = /^[A-Za-z0-9_]+$/;
const HOST = /^[A-Za-z0-9_.%:/-]{1,255}$/;
// 화면에 보이거나 건드리지 않는 시스템 스키마와 내부 계정
const SYSTEM_SCHEMAS = new Set(['information_schema', 'performance_schema', 'sys', 'mysql']);
const HIDDEN_USERS = new Set(['root', 'mysql.sys', 'mysql.session', 'mysql.infoschema', 'mariadb.sys', 'debian-sys-maint']);
// 권한 체크박스에서 허용하는 이름(화이트리스트). ALL 은 ALL PRIVILEGES 로 바꾼다.
const PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'INDEX', 'REFERENCES',
  'CREATE TEMPORARY TABLES', 'LOCK TABLES', 'CREATE VIEW', 'SHOW VIEW', 'TRIGGER', 'EVENT', 'EXECUTE', 'CREATE ROUTINE', 'ALTER ROUTINE'];

/* ---------- SQL 을 안전하게 만드는 도우미 ---------- */

/** 값을 SQL 문자열 리터럴('...')로 만든다. */
const lit = v => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
/** 기존 Database 이름을 백틱 식별자로 만든다. (이름 속 백틱은 두 번 쓴다) */
const ident = n => `\`${String(n).replace(/`/g, '``')}\``;
const validIdentifier = n => ID.test(n);
const validHost = h => HOST.test(h);
/** root, MySQL 내부 계정, 이름 없는(익명) 계정은 조회·조작하지 않는다. */
const isHiddenUser = u => !u || HIDDEN_USERS.has(u);

/** 체크한 권한들을 GRANT 구문 문자열로 만든다. 허용 목록에 없으면 예외. */
function privilegeClause(list) {
  if (!list || !list.length) throw new Error('권한을 하나 이상 선택해주세요');
  if (list.includes('ALL')) return 'ALL PRIVILEGES';
  const bad = list.filter(p => !PRIVILEGES.includes(p));
  if (bad.length) throw new Error(`허용되지 않는 권한입니다: ${bad.join(', ')}`);
  return list.join(', ');
}

/** mysql -B 출력의 백슬래시 이스케이프(탭·줄바꿈·NUL·백슬래시)를 원래 문자로 되돌린다. */
const unescapeBatch = v => v.replace(/\\([tn0\\])/g, (_m, c) => ({ t: '\t', n: '\n', 0: '\0', '\\': '\\' })[c]);
/** mysql -B -N 출력(행=줄, 열=탭)을 [[열, ...], ...] 로 바꾼다. */
const parseRows = out => out.split(/\r?\n/).filter(Boolean).map(line => line.split('\t').map(unescapeBatch));

/** 서버 버전 문자열로 ALTER USER 문법을 쓸 수 있는지 판단한다. (MySQL 5.7+, MariaDB 10.2+. 해석할 수 없으면 true) */
function useAlterUser(version) {
  const maria = /mariadb/i.test(version);
  const m = maria ? version.match(/(\d+)\.(\d+)\.\d+-MariaDB/i) : version.match(/^(\d+)\.(\d+)/);
  if (!m) return true;
  const [min, minor] = maria ? [10, 2] : [5, 7];
  return +m[1] > min || (+m[1] === min && +m[2] >= minor);
}

/* ---------- SSH · mysql 실행 ---------- */

/** 원격에서 명령을 실행하고 sql 을 stdin 으로 넘긴다. 반환: { code, stdout, stderr } */
function exec(client, command, sql) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('명령 실행 시간이 초과되었습니다')), TIMEOUT);
    client.exec(command, (err, stream) => {
      if (err) { clearTimeout(timer); return reject(err); }
      let stdout = '', stderr = '';
      stream.on('data', d => { stdout += d; }).stderr.on('data', d => { stderr += d; });
      stream.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
      stream.end(sql);
    });
  });
}

/**
 * 준비 → SSH 접속 → 작업 → 접속 종료를 묶는다. 준비에 실패하면(계정 미등록, ID 형식 오류, SSH 실패) 로그를 남기고 { ok:false }.
 * work(q) 의 q.run(sql, 표시용) 은 성공 여부를, q.fetch(sql, 표시용) 은 행 목록(실패하면 null)을 돌려준다.
 */
async function session(f, log, work) {
  const user = f.mysql_user, password = f.mysql_password;
  if (!user || !password) { log('error', '[ERROR] 이 서버에는 MySQL 계정이 등록되어 있지 않습니다 · 연결 관리에서 등록해주세요'); return { ok: false }; }
  if (!validIdentifier(user)) { log('error', '[ERROR] 연결관리에 등록된 MySQL ID가 올바르지 않습니다(영문/숫자/밑줄만 허용)'); return { ok: false }; }
  log('cmd', `$ ssh ${f.ssh_user}@${f.host} -p ${f.port || 22}`);
  let client;
  try { client = await connect(f); } catch (e) { log('error', `[ERROR] SSH 접속 실패: ${e.message}`); return { ok: false }; }
  log('success', '[OK] SSH 접속 성공');

  /** SQL 한 건 실행. 성공하면 { stdout, stderr }, 실패하면 로그를 남기고 null. */
  const mysql = async (sql, display, batch) => {
    log('cmd', `$ mysql -u${user} -p**** -e "${display}"`);
    try {
      const r = await exec(client, `mysql ${batch ? '-B -N ' : ''}-u${user} -p${shq(password)}`, sql);
      if (r.code !== 0) { log('error', `[ERROR] 실패 (종료 코드 ${r.code}): ${r.stderr.trim() || r.stdout.trim()}`); return null; }
      return r;
    } catch (e) { log('error', `[ERROR] 명령 실행 중 오류가 발생했습니다: ${e.message}`); return null; }
  };
  const q = {
    async run(sql, display) {
      const r = await mysql(sql, display, false);
      if (!r) return false;
      if (r.stdout.trim()) log('info', r.stdout.trim());
      if (r.stderr.trim()) log('info', r.stderr.trim()); // mysql 이 stderr 로 내는 경고
      return true;
    },
    async fetch(sql, display) { const r = await mysql(sql, display, true); return r && parseRows(r.stdout); }
  };
  try { return await work(q); } catch (e) { log('error', `[ERROR] ${e.message}`); return { ok: false }; } finally { client.end(); }
}

const fail = (log, msg) => { log('error', `[ERROR] ${msg}`); return { ok: false }; };

/* ---------- 작업 ---------- */

/** 등록된 MySQL 계정으로 SELECT 1 을 실행해 접속을 확인한다. */
const testConnection = (f, log) => session(f, log, async q => {
  if (!await q.run('SELECT 1;', 'SELECT 1')) return { ok: false };
  log('success', '[OK] DB 접속 테스트에 성공했습니다');
  return { ok: true };
});

/** Database 목록(시스템 스키마 제외)과 사용자별 host 목록(내부 계정 제외)을 한 번의 접속으로 가져온다. */
const overview = (f, log) => session(f, log, async q => {
  const dbs = await q.fetch('SHOW DATABASES;', 'SHOW DATABASES');
  if (!dbs) return { ok: false };
  const rows = await q.fetch('SELECT User, Host FROM mysql.user ORDER BY User, Host;', 'SELECT User, Host FROM mysql.user');
  if (!rows) return { ok: false };
  const databases = dbs.map(r => r[0]).filter(n => !SYSTEM_SCHEMAS.has(n));
  const users = {};
  for (const [user, host] of rows) if (!isHiddenUser(user)) (users[user] ||= []).push(host);
  log('success', `[OK] Database ${databases.length}개, 사용자 ${Object.keys(users).length}명 조회 완료`);
  return { ok: true, data: { databases, users, inUse: f.mysql_user } };
});

/** 한 사용자의 host 별 권한(어느 Database 에 어떤 권한). USAGE(권한 없음)는 뺀다. */
const userDetail = (f, user, log) => {
  if (isHiddenUser(user)) return fail(log, '조회할 수 없는 계정입니다');
  return session(f, log, async q => {
    const hostRows = await q.fetch(`SELECT Host FROM mysql.user WHERE User = ${lit(user)} ORDER BY Host;`, `SELECT Host FROM mysql.user WHERE User = '${user}'`);
    if (!hostRows) return { ok: false };
    const hosts = [];
    for (const [host] of hostRows) {
      const rows = await q.fetch(`SHOW GRANTS FOR ${lit(user)}@${lit(host)};`, `SHOW GRANTS FOR '${user}'@'${host}'`);
      if (!rows) return { ok: false };
      const grants = [];
      for (const [line] of rows) { // 비밀번호 해시가 섞인 줄 전체가 아니라 "권한 ON 대상"만 뽑는다
        const m = line.match(/^GRANT (.+?) ON (.+?) TO /);
        if (m && m[1].trim().toUpperCase() !== 'USAGE') grants.push({ privileges: m[1], target: m[2].replace(/`/g, '') });
      }
      hosts.push({ host, grants });
    }
    log('success', `[OK] '${user}' 정보 조회 완료`);
    return { ok: true, data: { user, hosts, inUse: f.mysql_user } };
  });
};

/** 사용자가 이미 가진 host 목록. 실패하면 null. */
async function userHosts(q, user) {
  const rows = await q.fetch(`SELECT Host FROM mysql.user WHERE User = ${lit(user)};`, `SELECT Host FROM mysql.user WHERE User = '${user}'`);
  return rows && rows.map(r => r[0]);
}

/**
 * Database 생성 → host 마다 권한 부여 → 권한 적용. mode: 'new' 는 host 마다 새 계정을 만들고, 'existing' 은 기존 사용자에게 권한을 준다
 * (그 host 에 계정이 아직 없으면 password 로 먼저 만든다. MySQL 은 user@host 가 서로 다른 계정이다).
 */
async function createDatabase(f, { db, mode, user, password, hosts, privileges }, log) {
  if (!validIdentifier(db)) return fail(log, 'DB명은 영문/숫자/밑줄(_)만 사용할 수 있습니다');
  if (mode !== 'new' && mode !== 'existing') return fail(log, '알 수 없는 생성 방식입니다');
  if (mode === 'new' && !validIdentifier(user)) return fail(log, 'User ID는 영문/숫자/밑줄(_)만 사용할 수 있습니다');
  if (mode === 'new' && !password) return fail(log, 'User PW를 입력해주세요');
  if (mode === 'existing' && isHiddenUser(user)) return fail(log, '권한을 부여할 기존 사용자를 선택해주세요');
  if (!hosts || !hosts.length) return fail(log, '접근을 허용할 IP를 하나 이상 등록해주세요');
  const badHosts = hosts.filter(h => !validHost(h));
  if (badHosts.length) return fail(log, `허용 IP 형식이 올바르지 않습니다: ${badHosts.join(', ')}`);
  let clause;
  try { clause = privilegeClause(privileges); } catch (e) { return fail(log, e.message); }

  return session(f, log, async q => {
    let newHosts = hosts; // 계정을 새로 만들어야 하는 host
    if (mode === 'existing') { // 비밀번호가 필요한지 DB 를 만들기 전에 확인한다
      const have = await userHosts(q, user);
      if (!have) return { ok: false };
      if (!have.length) return fail(log, `기존 사용자 '${user}'를 찾을 수 없습니다`);
      newHosts = hosts.filter(h => !have.includes(h));
      if (newHosts.length && !password) return fail(log, `'${user}'에게 없는 host(${newHosts.join(', ')})가 있어 비밀번호가 필요합니다`);
    }
    if (!await q.run(`CREATE DATABASE ${ident(db)};`, `CREATE DATABASE ${db}`)) return { ok: false };
    log('success', `[OK] 데이터베이스 '${db}' 생성 완료`);
    for (const host of hosts) {
      const account = `${lit(user)}@${lit(host)}`, grant = `GRANT ${clause} ON ${ident(db)}.* TO ${account};`;
      const create = mode === 'new' || newHosts.includes(host);
      const ok = await q.run(create ? `CREATE USER ${account} IDENTIFIED BY ${lit(password)}; ${grant}` : grant,
        create ? `CREATE USER ${account} IDENTIFIED BY ****; ${grant}` : grant);
      if (!ok) return { ok: false };
      log('success', `[OK] '${user}'@'${host}' 권한 부여 완료 (${clause})`);
    }
    if (!await q.run('FLUSH PRIVILEGES;', 'FLUSH PRIVILEGES')) return { ok: false };
    log('success', '[OK] 모든 작업이 완료되었습니다');
    return { ok: true };
  });
}

/** 기존 사용자에게 새 host 계정을 추가한다. (권한은 주지 않는다) */
function addHost(f, { user, host, password }, log) {
  if (isHiddenUser(user)) return fail(log, '조작할 수 없는 계정입니다');
  if (!validHost(host)) return fail(log, 'host 형식이 올바르지 않습니다');
  if (!password) return fail(log, '새 host 계정의 비밀번호를 입력해주세요');
  return session(f, log, async q => {
    const have = await userHosts(q, user);
    if (!have) return { ok: false };
    if (have.includes(host)) return fail(log, `'${user}'@'${host}' 계정이 이미 있습니다`);
    if (!await q.run(`CREATE USER ${lit(user)}@${lit(host)} IDENTIFIED BY ${lit(password)};`, `CREATE USER '${user}'@'${host}' IDENTIFIED BY ****`)) return { ok: false };
    log('success', `[OK] '${user}'@'${host}' 계정이 추가되었습니다`);
    return { ok: true };
  });
}

/** 삭제·권한 회수·비밀번호 변경을 해도 되는 계정인지 확인한다. 이 앱이 접속에 쓰는 계정은 지우거나 바꾸면 접속할 수 없게 되므로 거부한다. */
function checkAccount(f, user, log) {
  if (isHiddenUser(user)) { log('error', '[ERROR] 조작할 수 없는 계정입니다'); return false; }
  if (user === f.mysql_user) { log('error', `[ERROR] '${user}'은(는) 이 앱의 연결에 사용 중인 계정이라 조작할 수 없습니다`); return false; }
  return true;
}

function dropDatabase(f, db, log) {
  if (!db || SYSTEM_SCHEMAS.has(db)) return fail(log, '삭제할 수 없는 Database입니다');
  return session(f, log, async q => {
    if (!await q.run(`DROP DATABASE ${ident(db)};`, `DROP DATABASE ${db}`)) return { ok: false };
    log('success', `[OK] Database '${db}'이(가) 삭제되었습니다`);
    return { ok: true };
  });
}

function dropUserHost(f, { user, host }, log) {
  if (!checkAccount(f, user, log) || !host) return { ok: false };
  return session(f, log, async q => {
    if (!await q.run(`DROP USER ${lit(user)}@${lit(host)}; FLUSH PRIVILEGES;`, `DROP USER '${user}'@'${host}'`)) return { ok: false };
    log('success', `[OK] '${user}'@'${host}' 계정이 삭제되었습니다`);
    return { ok: true };
  });
}

/** 계정은 남기고 특정 Database 에 대한 권한만 회수한다. */
function revokeDatabase(f, { user, host, db }, log) {
  if (!checkAccount(f, user, log) || !host) return { ok: false };
  if (!db || db === '*') return fail(log, 'Database 단위 권한만 회수할 수 있습니다');
  return session(f, log, async q => {
    if (!await q.run(`REVOKE ALL PRIVILEGES ON ${ident(db)}.* FROM ${lit(user)}@${lit(host)}; FLUSH PRIVILEGES;`, `REVOKE ALL PRIVILEGES ON ${db}.* FROM '${user}'@'${host}'`)) return { ok: false };
    log('success', `[OK] '${user}'@'${host}'의 '${db}' 권한을 회수했습니다`);
    return { ok: true };
  });
}

/** 비밀번호 변경. 서버 버전을 조회해 ALTER USER 또는 SET PASSWORD 중 쓸 수 있는 문법을 고른다. */
function changePassword(f, { user, host, password }, log) {
  if (!checkAccount(f, user, log) || !host) return { ok: false };
  if (!password) return fail(log, '새 비밀번호를 입력해주세요');
  return session(f, log, async q => {
    const rows = await q.fetch('SELECT VERSION();', 'SELECT VERSION()');
    if (!rows) return { ok: false };
    const account = `${lit(user)}@${lit(host)}`;
    const sql = useAlterUser(rows[0]?.[0] || '') ? `ALTER USER ${account} IDENTIFIED BY ${lit(password)}; FLUSH PRIVILEGES;`
      : `SET PASSWORD FOR ${account} = PASSWORD(${lit(password)}); FLUSH PRIVILEGES;`;
    if (!await q.run(sql, `변경: '${user}'@'${host}' 비밀번호 ****`)) return { ok: false };
    log('success', `[OK] '${user}'@'${host}' 비밀번호가 변경되었습니다`);
    return { ok: true };
  });
}

module.exports = {
  testConnection, overview, userDetail, createDatabase, addHost, dropDatabase, dropUserHost, revokeDatabase, changePassword,
  lit, ident, validIdentifier, validHost, isHiddenUser, privilegeClause, parseRows, useAlterUser, PRIVILEGES
};
