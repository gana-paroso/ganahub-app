// IDE 관리 > 빌드&배포의 Git 기능. git 명령을 실행해 상태 확인, pull, commit + push, 태그 추천을 한다.
// 개발자 PC에 이미 구성된 자격증명(Credential Manager, SSH 키)을 먼저 쓰고,
// HTTPS 인증 실패로 보일 때만 연결 관리의 토큰으로 한 번 다시 시도한다. (토큰은 이번 명령에만 넘기고 저장소 설정에는 남기지 않는다)
const { execFile } = require('child_process');

const TIMEOUT = 30000;
const SEMVER = /^v(\d+)\.(\d+)\.(\d+)$/;
const SAFE_TAG = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/; // 첫 글자가 영숫자여야 git 옵션으로 해석되지 않는다
const AUTH_ERROR = /authentication failed|could not read username|could not read password|terminal prompts disabled|fatal: unable to access.*(401|403)|remote: (401|403)|http (401|403)/i;
const US = '\x1f';

/** git 을 실행한다. 반환: { code, stdout, stderr }. git 이 없으면 안내 문구로 예외를 던진다. */
function run(repo, args, pre = []) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-c', 'core.quotepath=false', ...pre, '-C', repo, ...args],
      { timeout: TIMEOUT, windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' } },
      (err, stdout, stderr) => {
        if (err && err.code === 'ENOENT') return reject(new Error('Git이 설치되어 있지 않거나 PATH에 등록되어 있지 않습니다. Git을 설치한 뒤 다시 시도해주세요.'));
        if (err && err.killed) return resolve({ code: 124, stdout, stderr: '시간이 초과되었습니다. 네트워크 상태를 확인해주세요.' });
        resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
      });
  });
}

const authArgs = ({ username, token }) => ['-c', `http.extraheader=AUTHORIZATION: basic ${Buffer.from(`${username || 'token'}:${token}`).toString('base64')}`];

/** 네트워크가 필요한 명령. 로컬 자격증명으로 실패했고 HTTPS 인증 오류로 보일 때만 토큰으로 한 번 더 시도한다. */
async function runAuth(repo, args, auth) {
  const r = await run(repo, args);
  if (r.code === 0 || !auth || !auth.token) return r;
  const url = (await run(repo, ['remote', 'get-url', 'origin'])).stdout.trim();
  if (!/^https?:\/\//.test(url) || !AUTH_ERROR.test(r.stdout + r.stderr)) return r;
  return run(repo, args, authArgs(auth));
}

const out = r => (r.stdout + r.stderr).trim();

/** `git status --porcelain -z` 출력을 [{ status, path }] 로 바꾼다. 이름 변경은 새 경로만 남긴다. */
function parseStatus(text) {
  const parts = text.split('\0'), files = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    files.push({ status: e.slice(0, 2).trim(), path: e.slice(3) });
    if ('RC'.includes(e[0]) || 'RC'.includes(e[1])) i++; // 다음 조각은 이전 경로
  }
  return files;
}

const changedFiles = async repo => {
  const r = await run(repo, ['status', '--porcelain', '-z', '--untracked-files=all']);
  return r.code === 0 ? parseStatus(r.stdout) : [];
};

const parseLog = text => text.split('\n').filter(l => l.trim()).map(l => { const [hash, message, author, when] = l.split(US); return { hash, message, author, when }; });

/** 저장소 요약. 네트워크 없이 마지막으로 받아 둔 정보 기준이라 화면에 들어올 때 불러도 된다. */
async function summary(repo) {
  const b = await run(repo, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (b.code !== 0) return { ok: false, error: b.stderr.trim() || 'Git 저장소가 아닙니다' };
  const u = await run(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const upstream = u.code === 0 ? u.stdout.trim() : '';
  let ahead = 0, behind = 0;
  if (upstream) {
    const c = await run(repo, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
    if (c.code === 0) [ahead, behind] = c.stdout.trim().split(/\s+/).map(Number);
  }
  const files = await changedFiles(repo);
  const l = await run(repo, ['log', '-1', `--format=%h${US}%s${US}%an${US}%cd`, '--date=format:%Y-%m-%d %H:%M']);
  const last = l.code === 0 && l.stdout.trim() ? parseLog(l.stdout)[0] : null;
  const t = await run(repo, ['describe', '--tags', '--abbrev=0']);
  return { ok: true, branch: b.stdout.trim(), upstream, ahead, behind, uncommitted: files.length, changedFiles: files, lastCommit: last, latestTag: t.code === 0 ? t.stdout.trim() : '' };
}

/** git fetch 후 원격과 비교한다. 커밋하지 않은 로컬 변경은 fetch 가 실패해도 함께 돌려준다. */
async function fetchStatus(repo, auth) {
  const files = await changedFiles(repo);
  const f = await runAuth(repo, ['fetch', '--quiet'], auth);
  if (f.code !== 0) return { ok: false, error: f.stderr.trim() || 'git fetch에 실패했습니다', uncommitted: files.length, changedFiles: files };
  const c = await run(repo, ['rev-list', '--left-right', '--count', 'HEAD...@{u}']);
  if (c.code !== 0) return { ok: false, error: c.stderr.trim() || '원격 추적 브랜치를 찾을 수 없습니다', uncommitted: files.length, changedFiles: files };
  const [ahead, behind] = c.stdout.trim().split(/\s+/).map(Number);
  const l = await run(repo, ['log', '-1', '--format=%an|%cd', '--date=format:%Y-%m-%d %H:%M', '@{u}']);
  const [remoteAuthor = '', remoteWhen = ''] = l.code === 0 ? l.stdout.trim().split('|') : [];
  let incoming = [];
  if (behind > 0) { const r = await run(repo, ['log', 'HEAD..@{u}', `--format=%h${US}%s${US}%an${US}%cd`, '--date=format:%Y-%m-%d %H:%M']); incoming = r.code === 0 ? parseLog(r.stdout) : []; }
  return { ok: true, ahead, behind, uncommitted: files.length, changedFiles: files, remoteAuthor, remoteWhen, incoming };
}

async function pull(repo, auth) {
  const r = await runAuth(repo, ['pull', '--no-edit'], auth); // 병합이 필요해도 편집기를 띄우지 않는다
  return r.code === 0 ? { ok: true, output: out(r) } : { ok: false, error: out(r) || 'git pull에 실패했습니다' };
}

/**
 * git add → commit → push. files 가 없으면 전체(-A), 배열이면 그 파일만 스테이징한다(빈 배열이면 add 생략).
 * 커밋할 것이 없는 것은 오류가 아니며, tag 가 있으면 현재 HEAD 에 태그만 만들어 push 한다.
 */
async function commitAndPush(repo, { message, tag, files }, auth) {
  const msg = String(message || '').trim();
  const hasChanges = files === undefined || files === null || files.length > 0; // 파일을 하나도 고르지 않으면 커밋 없이 태그만 처리한다
  if (hasChanges && !msg) return { ok: false, error: '커밋 메시지를 입력해주세요' };
  if (tag && !SAFE_TAG.test(tag)) return { ok: false, error: '태그 이름에 사용할 수 없는 문자가 있어요' };

  let result = '커밋할 변경사항이 없습니다';
  if (hasChanges) {
    const a = files ? await run(repo, ['add', '--', ...files.map(String)]) : await run(repo, ['add', '-A']);
    if (a.code !== 0) return { ok: false, error: a.stderr.trim() || 'git add에 실패했습니다' };
    const c = await run(repo, ['commit', '-m', msg]);
    const commitOut = out(c), lower = commitOut.toLowerCase();
    const nothing = c.code !== 0 && (lower.includes('nothing to commit') || lower.includes('nothing added to commit') || lower.includes('no changes added to commit'));
    if (c.code !== 0 && !nothing) return { ok: false, error: commitOut || 'git commit에 실패했습니다' };
    if (!nothing) {
      const p = await runAuth(repo, ['push'], auth);
      if (p.code !== 0) return { ok: false, error: out(p) || 'git push에 실패했습니다' };
      result = [commitOut, out(p)].join('\n').trim();
    }
  }
  if (!tag) return { ok: true, output: result };

  const t = await run(repo, ['tag', tag]);
  if (t.code !== 0) return { ok: false, error: [result, `태그 생성 실패: ${t.stderr.trim() || 'git tag에 실패했습니다'}`].join('\n') };
  const tp = await runAuth(repo, ['push', 'origin', tag], auth);
  if (tp.code !== 0) return { ok: false, error: [result, `태그 push 실패: ${tp.stderr.trim() || '태그 push에 실패했습니다'}`].join('\n') };
  return { ok: true, output: [result, `태그 ${tag} push 완료`].join('\n') };
}

/** 원격의 vMAJOR.MINOR.PATCH 태그 중 가장 높은 버전과, 거기서 올릴 3가지 추천 버전. 태그가 없으면 v0.0.0 기준. */
async function latestTag(repo) {
  const r = await run(repo, ['ls-remote', '--tags', 'origin']);
  if (r.code !== 0) return { ok: false, error: r.stderr.trim() || '태그 조회에 실패했습니다' };
  const versions = [];
  for (const line of r.stdout.split('\n')) {
    const ref = line.split('\t')[1];
    if (!ref || !ref.startsWith('refs/tags/')) continue;
    const m = ref.slice('refs/tags/'.length).replace(/\^\{\}$/, '').match(SEMVER);
    if (m) versions.push(m.slice(1).map(Number));
  }
  const [ma, mi, pa] = versions.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).pop() || [0, 0, 0];
  return { ok: true, latest: `v${ma}.${mi}.${pa}`, suggestions: { patch: `v${ma}.${mi}.${pa + 1}`, minor: `v${ma}.${mi + 1}.0`, major: `v${ma + 1}.0.0` } };
}

module.exports = { summary, fetchStatus, pull, commitAndPush, latestTag, parseStatus };
