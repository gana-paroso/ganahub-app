const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const projects = require('../src/projects');

/** 임시 폴더를 공유폴더 루트로 쓴다. */
const makeRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ganahub-root-'));
const cfg = (root, name) => JSON.parse(fs.readFileSync(path.join(root, name, 'config.json'), 'utf8'));

test('프로젝트 목록은 폴더만, 시스템 폴더(@)는 빼고 이름순', async () => {
  const root = makeRoot();
  for (const d of ['다', '가', '@Recently-Snapshot', '나']) fs.mkdirSync(path.join(root, d));
  fs.writeFileSync(path.join(root, '파일.txt'), 'x');
  assert.deepStrictEqual(await projects.list(root), ['가', '나', '다']);
});

test('config.json 이 없으면 exists:false 와 빈 값', async () => {
  const root = makeRoot(); fs.mkdirSync(path.join(root, 'p'));
  assert.deepStrictEqual(await projects.detail(root, 'p'), { exists: false, corrupt: false, domains: [], memo: '', memoUpdatedAt: null });
});

test('도메인 저장: 주소 없는 행은 버리고, 처음 저장하면 config.json 이 만들어진다', async () => {
  const root = makeRoot(); fs.mkdirSync(path.join(root, 'p'));
  await projects.saveDomains(root, 'p', [{ label: ' 운영 ', url: ' https://a.example ' }, { label: '빈 주소', url: '' }]);
  const c = cfg(root, 'p');
  assert.deepStrictEqual(c.domains, [{ label: '운영', url: 'https://a.example' }]);
  assert.strictEqual(c.project_name, 'p');
  assert.match(c.updated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  assert.strictEqual((await projects.detail(root, 'p')).exists, true);
});

test('메모를 저장해도 도메인과 모르는 필드는 그대로 남는다 (다른 사람이 저장한 내용 보존)', async () => {
  const root = makeRoot(); fs.mkdirSync(path.join(root, 'p'));
  fs.writeFileSync(path.join(root, 'p', 'config.json'), JSON.stringify({ project_name: 'p', domains: [{ label: 'a', url: 'u' }], 새필드: 7 }));
  await projects.saveMemo(root, 'p', '# 제목\n내용');
  const c = cfg(root, 'p');
  assert.deepStrictEqual(c.domains, [{ label: 'a', url: 'u' }]);
  assert.strictEqual(c.새필드, 7);
  assert.strictEqual(c.memo, '# 제목\n내용');
  assert.ok(c.memo_updated_at);
});

test('도메인과 메모를 차례로 저장하면 둘 다 남는다 (저장 직전 다시 읽어 병합)', async () => {
  const root = makeRoot(); fs.mkdirSync(path.join(root, 'p'));
  await projects.saveDomains(root, 'p', [{ label: 'x', url: 'https://x.example' }]);
  await projects.saveMemo(root, 'p', '메모');
  const d = await projects.detail(root, 'p');
  assert.deepStrictEqual([d.domains.length, d.memo], [1, '메모']);
});

test('저장 뒤 임시 파일이 남지 않는다', async () => {
  const root = makeRoot(); fs.mkdirSync(path.join(root, 'p'));
  await projects.saveMemo(root, 'p', 'a');
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'p')), ['config.json']);
});

test('깨진 config.json 은 corrupt 로 알리고, 저장하면 .broken 사본을 남긴다', async () => {
  const root = makeRoot(); fs.mkdirSync(path.join(root, 'p'));
  fs.writeFileSync(path.join(root, 'p', 'config.json'), '{깨짐');
  assert.strictEqual((await projects.detail(root, 'p')).corrupt, true);
  await projects.saveMemo(root, 'p', '복구');
  assert.strictEqual(fs.readFileSync(path.join(root, 'p', 'config.json.broken'), 'utf8'), '{깨짐');
  assert.strictEqual(cfg(root, 'p').memo, '복구');
});

test('BOM 이 붙은 config.json 도 읽는다', async () => {
  const root = makeRoot(); fs.mkdirSync(path.join(root, 'p'));
  fs.writeFileSync(path.join(root, 'p', 'config.json'), '﻿{"memo":"안녕"}');
  assert.strictEqual((await projects.detail(root, 'p')).memo, '안녕');
});

test('경로 구분자가 든 프로젝트 이름은 거부한다', async () => {
  const root = makeRoot();
  for (const bad of ['', '..', '.', 'a/b', 'a\\b', '..\\x']) await assert.rejects(projects.saveMemo(root, bad, 'x'), /잘못된/);
});

test('목록용 도메인 읽기: 도메인이 있는 프로젝트만 돌려준다', async () => {
  const root = makeRoot();
  for (const n of ['a', 'b', 'c']) fs.mkdirSync(path.join(root, n));
  await projects.saveDomains(root, 'a', [{ label: '운영', url: 'u1' }]);
  fs.writeFileSync(path.join(root, 'c', 'config.json'), '{깨짐');
  assert.deepStrictEqual(await projects.domainsOf(root, ['a', 'b', 'c']), { a: [{ label: '운영', url: 'u1' }] });
});
