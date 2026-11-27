const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../src/store');
const { createIde, launchArgs } = require('../src/ide');

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ganahub-ide-'));
  return { dir, ide: createIde(createStore(dir)), raw: () => JSON.parse(fs.readFileSync(path.join(dir, 'ide_projects.json'), 'utf8')).ide_projects };
};
const eclipse = (extra = {}) => ({ name: 'A시청 계약관리', type: 'eclipse', exe: 'eGovFrameDev-4.3.0', local: 'D:/workspace/a', ws: 'D:/workspace/a-ws', linked: 'A시청', gitUrl: 'https://git.example/a.git', gitConn: 'g1', jen: 'j1', job: 'a-deploy', ...extra });

test('등록: 기존 파일과 같은 필드 이름으로 저장하고, 화면 이름으로 돌려준다', () => {
  const { ide, raw } = setup();
  const id = ide.save(eclipse());
  assert.deepStrictEqual(Object.keys(raw()[0]).sort(), ['created_at', 'git_connection_id', 'git_url', 'id', 'ide_exe_name', 'ide_type', 'jenkins_connection_id', 'jenkins_job_name', 'last_run_at', 'linked_project', 'local_path', 'memo', 'name', 'updated_at', 'workspace_path']);
  assert.deepStrictEqual([raw()[0].ide_type, raw()[0].local_path, raw()[0].jenkins_job_name], ['eclipse', 'D:/workspace/a', 'a-deploy']);
  assert.deepStrictEqual(ide.get(id), { id, name: 'A시청 계약관리', linked: 'A시청', type: 'eclipse', exe: 'eGovFrameDev-4.3.0', local: 'D:/workspace/a', ws: 'D:/workspace/a-ws', gitUrl: 'https://git.example/a.git', gitConn: 'g1', jen: 'j1', job: 'a-deploy', memo: '', lastRunAt: '' });
});

test('필수 항목 검사: 이름, 유형, IDE, 로컬 경로, Eclipse 의 Workspace', () => {
  const { ide } = setup();
  assert.throws(() => ide.save(eclipse({ name: ' ' })), /프로젝트명/);
  assert.throws(() => ide.save(eclipse({ type: 'vim' })), /IDE 유형/);
  assert.throws(() => ide.save(eclipse({ exe: '' })), /실행 파일/);
  assert.throws(() => ide.save(eclipse({ local: '' })), /로컬 저장소/);
  assert.throws(() => ide.save(eclipse({ ws: '' })), /Workspace/);
  assert.doesNotThrow(() => ide.save(eclipse({ type: 'vscode', exe: 'VSCode', ws: '' }))); // VSCode 는 Workspace 가 필요 없다
});

test('수정해도 개인 메모는 지워지지 않고, 보내지 않은 항목은 그대로다', () => {
  const { ide } = setup();
  const id = ide.save(eclipse());
  ide.saveMemo(id, '# 로컬 설정\n포트 8081');
  ide.save({ id, name: '이름만 변경' });
  const p = ide.get(id);
  assert.deepStrictEqual([p.name, p.memo, p.local, p.job], ['이름만 변경', '# 로컬 설정\n포트 8081', 'D:/workspace/a', 'a-deploy']);
});

test('개인 메모만 저장하고 다른 항목은 건드리지 않는다', () => {
  const { ide } = setup();
  const id = ide.save(eclipse());
  const before = ide.get(id);
  ide.saveMemo(id, '메모');
  assert.deepStrictEqual({ ...ide.get(id), memo: '' }, { ...before, memo: '' });
  assert.throws(() => ide.saveMemo('없는id', 'x'), /찾을 수 없/);
});

test('목록은 이름순이고, 삭제는 등록 정보만 지운다', () => {
  const { ide } = setup();
  const b = ide.save(eclipse({ name: '나' })), a = ide.save(eclipse({ name: '가' }));
  assert.deepStrictEqual(ide.list().map(p => p.name), ['가', '나']);
  ide.remove(a);
  assert.deepStrictEqual(ide.list().map(p => p.id), [b]);
  assert.throws(() => ide.remove(a), /찾을 수 없/);
});

test('파일의 모르는 필드는 보존한다', () => {
  const { ide, dir } = setup();
  fs.writeFileSync(path.join(dir, 'ide_projects.json'), JSON.stringify({ ide_projects: [], 새필드: 1 }));
  ide.save(eclipse());
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'ide_projects.json'), 'utf8')).새필드, 1);
});

test('실행 인자: Eclipse 는 -data, VSCode 는 -n', () => {
  assert.deepStrictEqual(launchArgs('eclipse', 'D:/ws'), ['-data', 'D:/ws']);
  assert.deepStrictEqual(launchArgs('vscode', 'D:/src'), ['-n', 'D:/src']);
});

test('실행 실패 사유: 등록 안 된 IDE, 없는 실행 파일, 없는 폴더', async () => {
  const { ide } = setup();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ganahub-target-'));
  const id = ide.save(eclipse({ type: 'vscode', exe: 'VSCode', ws: '', local: target }));
  await assert.rejects(ide.run(id, []), /전역 설정에 없어요/);
  await assert.rejects(ide.run(id, [{ name: 'VSCode', exePath: 'C:/없는/Code.exe' }]), /실행 파일을 찾을 수 없습니다/);
  const gone = ide.save(eclipse({ type: 'vscode', exe: 'VSCode', ws: '', local: path.join(target, '없는폴더') }));
  await assert.rejects(ide.run(gone, [{ name: 'VSCode', exePath: process.execPath }]), /로컬 저장소 경로를 찾을 수 없습니다/);
});

test('실행 성공: 프로세스를 띄우고 최근 실행 시각을 남긴다', async () => {
  const { ide } = setup();
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'ganahub-target-'));
  const id = ide.save(eclipse({ type: 'vscode', exe: 'VSCode', ws: '', local: target }));
  await ide.run(id, [{ name: 'VSCode', exePath: process.execPath }]); // node 가 인자 오류로 곧 끝나지만, 실행 자체는 성공으로 본다
  assert.match(ide.get(id).lastRunAt, /^\d{4}-\d{2}-\d{2}T/);
});
