// IDE 프로젝트(ide_projects.json): 등록·수정·삭제와 IDE 실행. 기존 앱과 같은 파일·같은 필드 이름(snake_case)을 쓴다.
// 화면과는 짧은 이름(camelCase)으로 주고받는다.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const FILE = 'ide_projects.json';
const TYPES = ['eclipse', 'vscode'];
// [화면 이름, 파일 필드]. 저장할 때 화면에서 보낸 항목만 바꾸고 나머지(개인 메모 등)는 그대로 둔다.
const FIELDS = [['name', 'name'], ['linked', 'linked_project'], ['type', 'ide_type'], ['exe', 'ide_exe_name'], ['local', 'local_path'], ['ws', 'workspace_path'],
  ['gitUrl', 'git_url'], ['gitConn', 'git_connection_id'], ['jen', 'jenkins_connection_id'], ['job', 'jenkins_job_name']];

const view = p => ({ id: p.id, ...Object.fromEntries(FIELDS.map(([v, f]) => [v, p[f] ?? ''])), memo: p.memo || '', lastRunAt: p.last_run_at || '' });
const stamp = () => new Date().toISOString().slice(0, 19);

/** IDE 종류별 실행 인자. Eclipse 는 -data 로 workspace 를 정하고, VSCode 는 -n 으로 항상 새 창에서 폴더를 연다. */
const launchArgs = (type, target) => (type === 'eclipse' ? ['-data', target] : ['-n', target]);

function createIde(store) {
  const load = () => { const raw = store.read(FILE, {}); return { ...raw, ide_projects: Array.isArray(raw.ide_projects) ? raw.ide_projects : [] }; };
  const need = (data, id) => { const p = data.ide_projects.find(x => x.id === id); if (!p) throw new Error('IDE 프로젝트를 찾을 수 없습니다'); return p; };

  const list = () => load().ide_projects.map(view).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const get = id => view(need(load(), id));

  /** 등록(id 없음) 또는 수정. 필수 항목을 검사하고 저장한 id 를 돌려준다. */
  function save(input) {
    const data = load(), old = input.id ? need(data, input.id) : null;
    const rec = old || { id: crypto.randomUUID(), memo: '', created_at: stamp(), last_run_at: '' };
    for (const [v, f] of FIELDS) if (v in input) rec[f] = String(input[v] ?? '').trim();
    if (!rec.name) throw new Error('IDE 프로젝트명을 입력해 주세요');
    if (!TYPES.includes(rec.ide_type)) throw new Error('IDE 유형을 선택해 주세요');
    if (!rec.ide_exe_name) throw new Error('IDE 실행 파일을 선택해 주세요');
    if (!rec.local_path) throw new Error('로컬 저장소 경로를 입력해 주세요');
    if (rec.ide_type === 'eclipse' && !rec.workspace_path) throw new Error('Workspace 경로를 입력해 주세요');
    rec.updated_at = stamp();
    if (!old) data.ide_projects.push(rec);
    store.write(FILE, data);
    return rec.id;
  }

  /** 개인 메모만 저장한다. 다른 항목은 건드리지 않는다. */
  function saveMemo(id, memo) {
    const data = load(), p = need(data, id);
    p.memo = String(memo ?? '');
    p.updated_at = stamp();
    store.write(FILE, data);
  }

  /** 이 PC의 등록 정보만 지운다. (소스 폴더와 프로젝트 관리의 config.json 은 그대로) */
  function remove(id) {
    const data = load();
    need(data, id);
    data.ide_projects = data.ide_projects.filter(p => p.id !== id);
    store.write(FILE, data);
  }

  /**
   * 등록된 IDE 로 저장소를 연다. exes 는 전역 설정의 IDE 목록([{ name, exePath }]). 실행에 성공하면 최근 실행 시각을 남긴다.
   * Eclipse 는 eclipse.ini 의 상대 경로 때문에 실행 파일 폴더에서 시작해야 한다.
   */
  async function run(id, exes) {
    const data = load(), p = need(data, id);
    const ide = exes.find(e => e.name === p.ide_exe_name);
    if (!ide) throw new Error(`IDE '${p.ide_exe_name}'이(가) 전역 설정에 없어요. 전역 설정에서 IDE를 등록해 주세요`);
    if (!fs.existsSync(ide.exePath) || !fs.statSync(ide.exePath).isFile()) throw new Error(`IDE 실행 파일을 찾을 수 없습니다: ${ide.exePath}`);
    const target = p.workspace_path || p.local_path;
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throw new Error(`로컬 저장소 경로를 찾을 수 없습니다: ${target}`);
    await new Promise((resolve, reject) => {
      const child = spawn(ide.exePath, launchArgs(p.ide_type, target), { cwd: path.dirname(ide.exePath), detached: true, stdio: 'ignore' });
      child.once('error', e => reject(new Error(`IDE 실행에 실패했습니다: ${e.message}`)));
      child.once('spawn', () => { child.unref(); resolve(); });
    });
    p.last_run_at = stamp();
    store.write(FILE, data);
  }

  return { list, get, save, saveMemo, remove, run };
}

module.exports = { createIde, launchArgs };
