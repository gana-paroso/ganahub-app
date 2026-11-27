// Git 기능: 임시 폴더에 원격(bare) 저장소와 두 개발자의 복제본을 만들어 실제 git 으로 확인한다.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const git = require('../src/git');

const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
const write = (repo, rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };

/** 원격 하나와 복제본 둘(me: 앱에서 보는 저장소, other: 다른 개발자)을 만든다. 첫 커밋은 이미 push 되어 있다. */
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ganahub-git-'));
  const remote = path.join(root, 'remote.git'), me = path.join(root, 'me'), other = path.join(root, 'other');
  execFileSync('git', ['init', '--bare', '-b', 'main', remote]);
  for (const [dir, name] of [[me, 'me'], [other, 'other']]) {
    execFileSync('git', ['clone', '-q', remote, dir]);
    g(dir, 'config', 'user.name', name); g(dir, 'config', 'user.email', `${name}@example.com`); g(dir, 'config', 'commit.gpgsign', 'false');
  }
  write(me, 'README.md', '처음');
  g(me, 'add', '-A'); g(me, 'commit', '-q', '-m', '첫 커밋'); g(me, 'push', '-q', '-u', 'origin', 'HEAD:main');
  g(other, 'pull', '-q', 'origin', 'main');
  return { root, remote, me, other };
}

test('저장소가 아닌 폴더는 안내 문구를 돌려준다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ganahub-nogit-'));
  const r = await git.summary(dir);
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.length > 0);
});

test('요약: 브랜치, 원격 추적, 변경 파일(한글·공백 이름, 새 파일 포함)', async () => {
  const { me } = setup();
  write(me, '한글 문서.txt', 'x'); write(me, 'sub/new file.txt', 'y'); write(me, 'README.md', '수정');
  const s = await git.summary(me);
  assert.deepStrictEqual([s.ok, s.branch, s.upstream, s.ahead, s.behind, s.uncommitted], [true, 'main', 'origin/main', 0, 0, 3]);
  assert.deepStrictEqual(s.changedFiles.map(f => f.path).sort(), ['README.md', 'sub/new file.txt', '한글 문서.txt']);
  assert.deepStrictEqual(s.changedFiles.find(f => f.path === 'README.md').status, 'M');
  assert.strictEqual(s.changedFiles.find(f => f.path === '한글 문서.txt').status, '??');
  assert.deepStrictEqual([s.lastCommit.message, s.lastCommit.author], ['첫 커밋', 'me']);
});

test('원격 변경 확인 → 받아올 커밋 목록 → pull', async () => {
  const { me, other } = setup();
  write(other, '화면.txt', '새 파일'); g(other, 'add', '-A'); g(other, 'commit', '-q', '-m', '결재 화면 오류 수정'); g(other, 'push', '-q');
  const before = await git.fetchStatus(me);
  assert.deepStrictEqual([before.ok, before.behind, before.ahead], [true, 1, 0]);
  assert.deepStrictEqual([before.incoming[0].message, before.incoming[0].author], ['결재 화면 오류 수정', 'other']);
  assert.strictEqual(before.remoteAuthor, 'other');
  const p = await git.pull(me);
  assert.strictEqual(p.ok, true);
  assert.ok(fs.existsSync(path.join(me, '화면.txt')));
  assert.strictEqual((await git.fetchStatus(me)).behind, 0);
});

test('원격에 닿지 못하면 오류 문구와 함께 로컬 변경은 그대로 알려 준다', async () => {
  const { me } = setup();
  g(me, 'remote', 'set-url', 'origin', path.join(os.tmpdir(), 'ganahub-없는-원격.git'));
  write(me, 'a.txt', 'x');
  const r = await git.fetchStatus(me);
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.length > 0);
  assert.strictEqual(r.uncommitted, 1);
});

test('Commit & Push: 고른 파일만 커밋하고 나머지는 그대로 남는다', async () => {
  const { me, other } = setup();
  write(me, 'a.txt', 'A'); write(me, 'b.txt', 'B');
  const r = await git.commitAndPush(me, { message: '한 파일만', files: ['a.txt'] });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual((await git.summary(me)).changedFiles.map(f => f.path), ['b.txt']);
  g(other, 'pull', '-q', 'origin', 'main');
  assert.ok(fs.existsSync(path.join(other, 'a.txt')));
  assert.ok(!fs.existsSync(path.join(other, 'b.txt')));
  assert.strictEqual(g(other, 'log', '-1', '--format=%s').trim(), '한 파일만');
});

test('Commit & Push: 메시지 없이 커밋하려 하면 거부한다', async () => {
  const { me } = setup();
  write(me, 'a.txt', 'A');
  const r = await git.commitAndPush(me, { message: '  ', files: ['a.txt'] });
  assert.deepStrictEqual([r.ok, /커밋 메시지/.test(r.error)], [false, true]);
});

test('태그: 변경 없이 태그만 push 하고, 추천 버전을 올려 준다', async () => {
  const { me, remote } = setup();
  assert.deepStrictEqual((await git.latestTag(me)).suggestions, { patch: 'v0.0.1', minor: 'v0.1.0', major: 'v1.0.0' });
  const r = await git.commitAndPush(me, { message: '', tag: 'v1.2.3', files: [] });
  assert.strictEqual(r.ok, true);
  assert.match(r.output, /태그 v1\.2\.3 push 완료/);
  assert.match(g(remote, 'tag'), /v1\.2\.3/);
  g(me, 'tag', 'v1.10.0'); g(me, 'push', '-q', 'origin', 'v1.10.0'); g(me, 'tag', 'beta'); g(me, 'push', '-q', 'origin', 'beta');
  const t = await git.latestTag(me);
  assert.deepStrictEqual([t.latest, t.suggestions.patch, t.suggestions.minor, t.suggestions.major], ['v1.10.0', 'v1.10.1', 'v1.11.0', 'v2.0.0']); // 1.10 > 1.2, 형식이 다른 태그는 무시
});

test('커밋과 태그를 함께: 커밋 push 뒤에 태그 push', async () => {
  const { me, remote } = setup();
  write(me, 'a.txt', 'A');
  const r = await git.commitAndPush(me, { message: '릴리즈', tag: 'v2.0.0' });
  assert.strictEqual(r.ok, true);
  assert.match(g(remote, 'tag'), /v2\.0\.0/);
  assert.strictEqual(g(remote, 'log', '-1', '--format=%s', 'main').trim(), '릴리즈');
});

test('태그 이름에 옵션처럼 보이거나 위험한 값은 git 에 넘기지 않는다', async () => {
  const { me, remote } = setup();
  for (const tag of ['-d', '--force', 'a b', 'a;b', '$(x)', '']) {
    if (!tag) continue;
    const r = await git.commitAndPush(me, { message: 'm', tag, files: [] });
    assert.deepStrictEqual([tag, r.ok], [tag, false]);
  }
  assert.strictEqual(g(remote, 'tag').trim(), '');
});

test('이미 있는 태그를 다시 만들면 실패 사유를 돌려준다', async () => {
  const { me } = setup();
  await git.commitAndPush(me, { message: '', tag: 'v1.0.0', files: [] });
  const r = await git.commitAndPush(me, { message: '', tag: 'v1.0.0', files: [] });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /태그 생성 실패/);
});

test('git status -z 해석: 새 파일, 수정, 이름 변경, 한글·공백 경로', () => {
  assert.deepStrictEqual(git.parseStatus(' M a.txt\0?? 한글 폴더/새 파일.txt\0R  new.txt\0old.txt\0D  gone.txt\0'), [
    { status: 'M', path: 'a.txt' }, { status: '??', path: '한글 폴더/새 파일.txt' }, { status: 'R', path: 'new.txt' }, { status: 'D', path: 'gone.txt' }
  ]);
  assert.deepStrictEqual(git.parseStatus(''), []);
});
