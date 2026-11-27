// 공유폴더(NAS) 연결 테스트. Windows 의 `net use` 로 인증하고, 비밀번호는 명령줄이 아니라 표준입력으로 넘긴다.
const { execFile } = require('child_process');
const fs = require('fs');

const ERRORS = {
  5: '접근이 거부되었습니다 (ID/비밀번호를 확인해주세요)',
  53: '네트워크 경로를 찾을 수 없습니다 (IP/공유이름을 확인해주세요)',
  67: '네트워크 이름(공유 이름)을 찾을 수 없습니다 (IP/공유이름을 확인해주세요)',
  85: '이미 이 서버에 연결되어 있습니다. 잠시 후 다시 시도해주세요',
  1219: '동일한 서버에 다른 자격증명으로 이미 연결되어 있습니다. 기존 연결을 해제한 뒤 다시 시도해주세요',
  1326: 'ID 또는 비밀번호가 올바르지 않습니다'
};
const TIMEOUT = -1;
const VALID_HOST = /^[A-Za-z0-9.\-]+$/;
const BAD_NAME = /[<>|?*":]/;

/** "data", "data/docs" 처럼 입력한 공유 이름을 \\ip\data\docs 형태로 만든다. */
function buildSharePath(ip, name) {
  return `\\\\${ip}\\${name.trim().replace(/^[\\/]+|[\\/]+$/g, '').replace(/\//g, '\\')}`;
}

/** net 명령의 오류 출력("시스템 오류 1326…" / "System error 1326…")에서 오류 번호만 뽑는다. 한글이 깨져도 숫자는 남는다. */
function parseErrorCode(stderr) {
  const m = String(stderr).match(/\b(\d{1,5})\b/);
  return m ? Number(m[1]) : 1;
}

const describe = code => code === TIMEOUT ? '연결 시간이 초과되었습니다 (IP를 확인해주세요)' : ERRORS[code] || `연결 실패 (코드 ${code})`;

/** net 명령 실행. 성공하면 stdout 문자열, 실패하면 { code } 를 담은 예외. */
function net(args, { input, timeout = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    const p = execFile('net', args, { timeout, windowsHide: true }, (e, stdout, stderr) => {
      if (!e) return resolve(stdout);
      reject({ code: e.killed ? TIMEOUT : parseErrorCode(stderr) });
    });
    p.stdin.end(input ?? '');
  });
}

/** 폴더로 열리는지 확인한다. 네트워크가 막혀 오래 걸리면 ms 뒤에 실패로 본다. */
function isDir(p, ms = 8000) {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(false), ms);
    fs.promises.stat(p).then(s => s.isDirectory(), () => false).then(v => { clearTimeout(t); resolve(v); });
  });
}

/** 이 서버에 이미 걸려 있는 연결을 모두 끊는다. (다른 계정으로 연결돼 있으면 새 인증이 안 되기 때문) */
async function disconnectServer(ip) {
  const list = await net(['use']).catch(() => '');
  const prefix = `\\\\${ip}\\`.toLowerCase();
  for (const r of list.split(/\s+/).filter(t => t.toLowerCase().startsWith(prefix))) await net(['use', r, '/delete', '/y']).catch(() => {});
}

/** 접속을 시도하고 오류 번호를 돌려준다. 성공은 0. 비밀번호는 표준입력(`*`)으로 넘긴다. */
async function connect(share, id, password) {
  const args = ['use', share, '*'].concat(id ? [`/user:${id}`] : []);
  try { await net(args, { input: `${password || ''}\r\n` }); return 0; } catch (e) { return e.code; }
}

/**
 * \\ip\name 에 접근할 수 있는지 시험한다. 이미 Windows 에 연결된 세션으로 열리면 그대로 성공 처리하고,
 * 아니면 ID/PW 로 연결해 본 뒤 시험용 연결은 끊는다(keep 이면 유지). 반환: { ok, message }
 */
async function testConnection({ ip, name, id, password, keep = false }) {
  if (!ip || !name) return { ok: false, message: 'IP와 공유이름을 입력해주세요' };
  if (!VALID_HOST.test(ip) || BAD_NAME.test(name)) return { ok: false, message: 'IP 또는 공유 이름에 사용할 수 없는 문자가 있어요' };

  const remote = buildSharePath(ip, name);
  if (await isDir(remote)) return { ok: true, message: `${remote} 접속에 성공했습니다 (기존 연결 세션 사용)` };

  const share = remote.split('\\').slice(0, 4).join('\\'); // net use 는 \\ip\공유 까지만 받는다
  let code = await connect(share, id, password);
  if (code === 1219) { await disconnectServer(ip); code = await connect(share, id, password); }
  if (code) return { ok: false, message: describe(code) };

  const found = await isDir(remote);
  if (!keep) await net(['use', share, '/delete', '/y']).catch(() => {}); // keep 이면 이후 폴더 접근을 위해 연결을 유지한다
  return found ? { ok: true, message: `${remote} 접속에 성공했습니다` }
    : { ok: false, message: '서버에는 연결했지만 하위 경로를 찾을 수 없습니다 (공유 이름을 확인해주세요)' };
}

module.exports = { testConnection, buildSharePath, parseErrorCode };
