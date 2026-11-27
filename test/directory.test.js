const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const directory = require('../src/directory');

/** 프로젝트 폴더 샘플: config.json, 하위 폴더, 시스템 폴더가 섞여 있다. */
function makeProject() {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'ganahub-dir-'));
  const w = (rel, text = 'x') => { fs.mkdirSync(path.dirname(path.join(p, rel)), { recursive: true }); fs.writeFileSync(path.join(p, rel), text); };
  w('config.json', '{}'); w('접속정보.txt', '12345'); w('02.설계/ERD/sample_erd.png'); w('02.설계/화면설계서.pptx'); w('03.소스/config.json'); w('@eaDir/thumb.jpg');
  fs.mkdirSync(path.join(p, '04.산출물'));
  return p;
}

test('경로 변환: 프로젝트 폴더 밖으로 나가는 경로는 거부한다', () => {
  const p = makeProject();
  assert.strictEqual(directory.resolve(p, ''), path.resolve(p));
  assert.strictEqual(directory.resolve(p, '02.설계/ERD'), path.join(path.resolve(p), '02.설계', 'ERD'));
  for (const bad of ['..', '../x', '02.설계/../../x', 'C:\\Windows', '\\\\서버\\공유']) assert.throws(() => directory.resolve(p, bad), /허용되지 않은/);
});

test('폴더 조회: 루트의 config.json 과 시스템 폴더는 숨기고, 하위 폴더의 config.json 은 보인다', async () => {
  const p = makeProject();
  const root = await directory.list(p, '');
  assert.deepStrictEqual(root.map(r => r.name).sort(), ['02.설계', '03.소스', '04.산출물', '접속정보.txt'].sort());
  const file = root.find(r => r.name === '접속정보.txt');
  assert.deepStrictEqual([file.isDir, file.size, file.path], [false, 5, '접속정보.txt']);
  assert.match(file.modified, /^\d{4}-\d{2}-\d{2}$/);
  assert.strictEqual(root.find(r => r.name === '02.설계').size, null);
  assert.deepStrictEqual((await directory.list(p, '03.소스')).map(r => r.path), ['03.소스/config.json']);
});

test('검색: 하위 폴더까지 찾고(대소문자 무시), 시스템 폴더와 루트 config.json 은 제외한다', async () => {
  const p = makeProject();
  directory.startIndex(p);
  assert.deepStrictEqual((await directory.search(p, 'ERD')).rows.map(r => r.path).sort(), ['02.설계/ERD', '02.설계/ERD/sample_erd.png']);
  assert.deepStrictEqual((await directory.search(p, 'config')).rows.map(r => r.path), ['03.소스/config.json']);
  assert.strictEqual((await directory.search(p, 'thumb')).total, 0);
  assert.strictEqual((await directory.search(p, '없는이름')).total, 0);
});

test('검색 결과 항목의 크기·수정일을 따로 읽는다', async () => {
  const p = makeProject();
  const [a, b] = await directory.stat(p, ['접속정보.txt', '없는파일.txt']);
  assert.strictEqual(a.size, 5);
  assert.strictEqual(b, null);
  await assert.doesNotReject(directory.stat(p, ['../밖']));
});

test('실행 전에 확인이 필요한 파일 형식', () => {
  for (const f of ['a.exe', 'B.BAT', 'x.cmd', 'setup.msi', 'run.ps1', 'a.vbs']) assert.ok(directory.isRisky(f), f);
  for (const f of ['a.txt', 'doc.pdf', 'exe', 'a.exe.txt']) assert.ok(!directory.isRisky(f), f);
});
