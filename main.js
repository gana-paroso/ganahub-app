// Electron 메인 프로세스: 창 생성과 화면(renderer)이 호출하는 기능(IPC)을 연결한다.
const { app, BrowserWindow, ipcMain, shell, dialog, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const updater = require('./src/updater');
const { createStore } = require('./src/store');
const { createSettings, fileExists } = require('./src/settings');
const share = require('./src/share');
const { createConnections } = require('./src/connections');
const conntest = require('./src/conntest');
const db = require('./src/db');
const { createIde } = require('./src/ide');
const gitops = require('./src/git');
const jenkins = require('./src/jenkins');
const { createWorks } = require('./src/works');
const projects = require('./src/projects');
const directory = require('./src/directory');

// 저장 위치는 기존 앱과 같은 %APPDATA%\GanaHub 를 그대로 쓴다. Chromium 캐시는 하위 electron 폴더로 분리한다.
const dataDir = process.env.GANAHUB_DATA_DIR || path.join(app.getPath('appData'), 'GanaHub'); // 환경 변수는 실제 설정을 건드리지 않고 시험할 때 쓴다
app.setPath('userData', dataDir);
app.setPath('sessionData', path.join(dataDir, 'electron'));

const store = createStore(dataDir);
const settings = createSettings(store);
const connections = createConnections(store);
const ide = createIde(store);
const works = createWorks(store, settings);

if (!app.requestSingleInstanceLock()) app.quit(); // 같은 설정 파일을 두 앱이 동시에 쓰지 않도록 하나만 허용

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 900, minHeight: 600, title: 'GanaHub', backgroundColor: '#f6f8fa', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  // 새 창은 열지 않는다. 앱 화면(ui 폴더) 사이의 이동만 허용하고, http(s) 링크는 기본 브라우저로 연다.
  const uiUrl = require('url').pathToFileURL(path.join(__dirname, 'ui') + path.sep).href;
  const external = url => { if (/^https?:\/\//.test(url)) shell.openExternal(url); };
  win.webContents.setWindowOpenHandler(({ url }) => { external(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(uiUrl)) { e.preventDefault(); external(url); } });
  win.loadFile(path.join(__dirname, 'ui', 'projects-list-toss.html'));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  try { store.backupOnce(); } catch (e) { console.error('설정 백업 실패:', e.message); } // 구 앱으로 되돌릴 때 쓰는 최초 사본
  createWindow();
  updater.init(s => win?.webContents.send('update', s));
});
app.on('window-all-closed', () => app.quit());

/* ---------- IPC: 결과를 { ok, data | error } 로 통일한다 ---------- */
const handle = (channel, fn) => ipcMain.handle(channel, async (_e, ...args) => {
  try { return { ok: true, data: await fn(...args) }; } catch (e) { return { ok: false, error: e.message }; }
});
handle('app:info', () => ({ version: app.getVersion(), update: updater.getState() }));
handle('update:install', () => updater.install());

/* ---------- 전역 설정 ---------- */
handle('settings:get', () => settings.get());
handle('settings:saveShare', v => { settings.saveShare(v); readyAt = 0; }); // 접속정보가 바뀌면 다음 접근 때 다시 연결한다
handle('settings:testShare', v => share.testConnection({ ...v, password: v.password || settings.reveal('share') })); // 입력란이 비어 있으면 저장된 비밀번호로 시험
handle('settings:saveIde', list => settings.saveIde(list));
handle('settings:saveWorks', v => settings.saveWorks(v));
handle('settings:saveDbHosts', list => settings.saveDbHosts(list));
handle('settings:reveal', kind => settings.reveal(kind));
handle('file:exists', p => fileExists(p));
handle('pick:exe', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'IDE 실행 파일 선택', properties: ['openFile'], filters: [{ name: '실행 파일', extensions: ['exe'] }] });
  return r.canceled ? null : r.filePaths[0];
});

/* ---------- 공유폴더(프로젝트·디렉토리) ---------- */
let readyAt = 0; // 공유폴더에 접근할 수 있음을 마지막으로 확인한 시각
let connecting = null; // 연결 확인이 진행 중이면 그 작업. 화면이 동시에 여러 번 요청해도 연결은 한 번만 시도한다
const root = () => { const c = settings.share(); return share.buildSharePath(c.ip, c.name); };

/** 공유폴더에 접근할 수 있는지 확인하고, 안 되면 저장된 ID/PW 로 연결한다. 성공은 5분 동안 다시 확인하지 않는다. */
async function ready() {
  if (Date.now() - readyAt < 5 * 60 * 1000) return;
  connecting ??= share.testConnection({ ...settings.share(), keep: true }).finally(() => { connecting = null; });
  const r = await connecting;
  if (!r.ok) throw new Error(r.message);
  readyAt = Date.now();
}
/** 공유폴더가 필요한 기능 앞뒤로 연결 확인과 실패 시 재확인 예약을 붙인다. */
const onShare = fn => async (...args) => {
  const c = settings.share();
  if (!c.ip || !c.name) throw new Error('전역 설정에서 공유폴더 접속정보를 먼저 등록해 주세요');
  try { await ready(); return await fn(...args); } catch (e) { readyAt = 0; throw e; }
};
const projectPath = name => projects.projectDir(root(), name);

// 설정이 비어 있으면 오류가 아니라 configured:false 로 알려 화면이 안내를 보여 준다.
handle('projects:list', async () => {
  const c = settings.share();
  if (!c.ip || !c.name) return { configured: false, names: [], favorites: [] };
  try { return { configured: true, names: await onShare(() => projects.list(root()))(), favorites: settings.favorites() }; } catch (e) { return { configured: true, names: [], favorites: [], error: e.message }; }
});
handle('projects:domains', onShare(names => projects.domainsOf(root(), names)));
handle('projects:favorite', name => settings.toggleFavorite(name));
handle('projects:detail', onShare(name => projects.detail(root(), name)));
handle('projects:saveDomains', onShare((name, domains) => projects.saveDomains(root(), name, domains)));
handle('projects:saveMemo', onShare((name, memo) => projects.saveMemo(root(), name, memo)));

handle('dir:list', onShare((name, rel) => directory.list(projectPath(name), rel)));
handle('dir:index', onShare(name => { directory.startIndex(projectPath(name)).catch(() => {}); })); // 화면에 들어올 때 백그라운드로 색인 시작
handle('dir:search', onShare((name, term) => directory.search(projectPath(name), term)));
handle('dir:stat', onShare((name, rels) => directory.stat(projectPath(name), rels)));
handle('dir:reveal', onShare((name, rel) => { shell.showItemInFolder(directory.resolve(projectPath(name), rel)); }));
handle('dir:open', onShare(async (name, rel) => {
  const target = directory.resolve(projectPath(name), rel);
  if (directory.isRisky(target)) { // 프로그램은 확인을 받은 뒤에만 실행한다
    const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['취소', '실행'], defaultId: 0, cancelId: 0, title: '실행 확인',
      message: `${path.basename(target)} 파일을 실행할까요?`, detail: target });
    if (r.response !== 1) return false;
  }
  const err = await shell.openPath(target);
  if (err) throw new Error(err);
  return true;
}));

/** 도메인 정보의 주소를 기본 브라우저로 연다. http(s) 주소만 허용한다. */
handle('open:url', url => {
  if (!/^https?:\/\//i.test(String(url))) throw new Error('http 또는 https 주소만 열 수 있어요');
  return shell.openExternal(String(url));
});

/* ---------- 연결 관리 (SSH / Git / Jenkins) ---------- */
handle('conn:list', () => connections.list());
handle('conn:get', id => connections.get(id));
handle('conn:save', v => connections.save(v));
handle('conn:remove', id => connections.remove(id));
handle('conn:reveal', (id, field) => connections.reveal(id, field));
// 폼에 입력 중인 값으로 테스트한다. 비밀값을 비워 둔 칸은 저장된 값으로 채운다.
handle('conn:test', ({ id, type, fields }) => conntest.test(type, connections.withStored(id, type, fields)));
// 저장된 연결로 테스트한다. 결과와 상관없이 마지막 사용 시각을 갱신한다.
handle('conn:testSaved', id => { const c = connections.decrypted(id); connections.touch(id); return conntest.test(c.type, c.fields); });

/** 비밀값 복사. 화면의 클립보드 API 대신 메인 프로세스에서 쓴다. */
handle('copy:text', text => { clipboard.writeText(String(text ?? '')); });

/* ---------- DB 관리 (SSH 로 원격 MySQL 작업) ---------- */
// 화면이 부를 수 있는 작업. 각 작업은 (접속정보, 인자, 로그 함수)를 받는다.
const DB_ACTIONS = {
  test: (f, _a, log) => db.testConnection(f, log),
  overview: (f, _a, log) => db.overview(f, log),
  userDetail: (f, a, log) => db.userDetail(f, a.user, log),
  create: (f, a, log) => db.createDatabase(f, a, log),
  addHost: (f, a, log) => db.addHost(f, a, log),
  dropDatabase: (f, a, log) => db.dropDatabase(f, a.db, log),
  dropUser: (f, a, log) => db.dropUserHost(f, a, log),
  revoke: (f, a, log) => db.revokeDatabase(f, a, log),
  password: (f, a, log) => db.changePassword(f, a, log)
};
let dbBusy = false; // 서버에 명령을 보내는 작업은 한 번에 하나만 실행한다

/** DB 관리에서 고를 수 있는 SSH 연결 목록. 비밀값은 포함하지 않는다. */
handle('db:servers', () => connections.list().filter(c => c.type === 'ssh').map(c => {
  const f = connections.get(c.id).fields;
  return { id: c.id, name: c.name, host: f.host, port: f.port, user: f.ssh_user, my: f.mysql_user };
}));

/** 작업을 실행한다. 진행 로그는 'db:log' 로 화면에 실시간으로 보내고, 결과({ ok, data })를 돌려준다. */
handle('db:run', async ({ serverId, action, args }) => {
  const fn = DB_ACTIONS[action];
  if (!fn) throw new Error('알 수 없는 작업입니다');
  if (dbBusy) throw new Error('다른 작업이 실행 중이에요');
  const c = connections.decrypted(serverId);
  if (c.type !== 'ssh') throw new Error('SSH 연결이 아닙니다');
  dbBusy = true;
  try { return await fn(c.fields, args || {}, (level, message) => win?.webContents.send('db:log', { level, message })); } finally { dbBusy = false; }
});

/* ---------- IDE 관리 ---------- */
handle('ide:list', () => ide.list());
handle('ide:get', id => ide.get(id));
handle('ide:save', v => ide.save(v));
handle('ide:remove', id => ide.remove(id));
handle('ide:memo', (id, text) => ide.saveMemo(id, text));
handle('ide:run', id => ide.run(id, settings.get().ide.map(i => ({ name: i.name, exePath: i.exePath }))));
handle('ide:openPath', async id => { const err = await shell.openPath(ide.get(id).local); if (err) throw new Error(err); });
handle('pick:folder', async () => {
  const r = await dialog.showOpenDialog(win, { title: '폴더 선택', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

/** 전역 설정에 등록된 IDE 가 VSCode 계열인지 실행 파일 이름으로 가린다. (그 밖에는 Eclipse 계열로 본다) */
const ideKind = exePath => (/code|cursor|codium/i.test(path.basename(exePath)) ? 'vscode' : 'eclipse');

/** 등록·수정 폼의 선택 목록: 전역 설정의 IDE, 프로젝트 관리의 프로젝트, 연결 관리의 Git·Jenkins 연결. 공유폴더를 못 읽어도 나머지는 준다. */
handle('ide:options', async () => {
  let linkable = [], linkError = '';
  if (settings.share().ip) { try { linkable = await onShare(() => projects.list(root()))(); } catch (e) { linkError = e.message; } }
  const conns = type => connections.list().filter(c => c.type === type).map(c => ({ id: c.id, name: c.name }));
  return { ides: settings.get().ide.map(i => ({ name: i.name, kind: ideKind(i.exePath) })), linkable, linkError, git: conns('git'), jenkins: connections.list().filter(c => c.type === 'jenkins').map(c => ({ id: c.id, name: c.name, url: connections.get(c.id).fields.url })) };
});

/** IDE 프로젝트의 Git 저장소 폴더. 폴더가 없으면 안내 문구로 예외. */
function repoOf(id) {
  const p = ide.get(id);
  if (!fs.existsSync(p.local)) throw new Error(`로컬 저장소 경로를 찾을 수 없습니다: ${p.local}`);
  return p;
}
/** 연결 관리의 Git 계정 토큰. (로컬 자격증명으로 인증이 안 될 때만 쓰인다) */
function gitAuth(p) {
  if (!p.gitConn) return null;
  try { const f = connections.decrypted(p.gitConn).fields; return f.git_token ? { username: f.git_username, token: f.git_token } : null; } catch { return null; }
}
/** 같은 프로젝트에 git 작업이 겹쳐 실행되지 않게 한다. */
const gitBusy = new Set();
const exclusive = fn => async (id, ...rest) => {
  if (gitBusy.has(id)) throw new Error('이 프로젝트의 다른 Git 작업이 실행 중이에요');
  gitBusy.add(id);
  try { return await fn(repoOf(id), ...rest); } finally { gitBusy.delete(id); }
};
handle('git:summary', id => gitops.summary(repoOf(id).local));
handle('git:check', exclusive(p => gitops.fetchStatus(p.local, gitAuth(p))));
handle('git:pull', exclusive(p => gitops.pull(p.local, gitAuth(p))));
handle('git:push', exclusive((p, v) => gitops.commitAndPush(p.local, { message: v.message, tag: v.tag, files: Array.isArray(v.files) ? v.files : undefined }, gitAuth(p))));
handle('git:tag', id => gitops.latestTag(repoOf(id).local));

/** IDE 프로젝트에 연결된 Jenkins 접속 정보와 Job 이름. */
function jenkinsOf(id) {
  const p = ide.get(id);
  if (!p.jen || !p.job) throw new Error('수정에서 Jenkins 연결과 Job명을 등록해 주세요');
  let f;
  try { f = connections.decrypted(p.jen).fields; } catch { throw new Error('연결된 Jenkins 정보를 찾을 수 없어요. 수정에서 다시 선택해 주세요'); }
  return { c: { url: f.url, user: f.jenkins_user, token: f.jenkins_token }, job: p.job };
}
handle('jen:builds', id => { const { c, job } = jenkinsOf(id); return jenkins.recentBuilds(c, job); });
handle('jen:detail', (id, n) => { const { c, job } = jenkinsOf(id); return jenkins.buildDetail(c, job, n); });
handle('jen:build', id => { const { c, job } = jenkinsOf(id); return jenkins.triggerBuild(c, job); });

/* ---------- 간편접수 (업무 포털) ---------- */
handle('works:profile', () => works.profileStatus());
// 연동 규격 파일(JSON)을 골라 이 PC에 저장한다. 취소하면 null.
handle('works:importProfile', async () => {
  const r = await dialog.showOpenDialog(win, { title: '연동 규격 파일 선택', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled) return null;
  let obj;
  try {
    const text = fs.readFileSync(r.filePaths[0], 'utf8');
    obj = JSON.parse(text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);
  } catch { throw new Error('규격 파일을 읽을 수 없어요. 올바른 JSON 파일인지 확인해 주세요'); }
  works.importProfile(obj);
  return works.profileStatus();
});
handle('works:test', v => works.test(v));
handle('works:contracts', () => works.contracts());
handle('works:register', v => works.register(v));
handle('works:open', url => {
  if (!works.isOwnUrl(url)) throw new Error('설정한 업무 포털 주소의 링크만 열 수 있어요');
  return shell.openExternal(String(url));
});
