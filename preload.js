// 화면(renderer)에는 아래 기능만 노출한다. Node/Electron API 에는 직접 접근할 수 없다.
const { contextBridge, ipcRenderer } = require('electron');

/** IPC 호출 결과({ ok, data | error })를 풀어서, 실패하면 Error 로 던진다. */
const call = channel => async (...args) => {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

contextBridge.exposeInMainWorld('api', {
  info: call('app:info'),
  installUpdate: call('update:install'),
  onUpdate: cb => ipcRenderer.on('update', (_e, state) => cb(state)),
  settings: {
    get: call('settings:get'), saveShare: call('settings:saveShare'), testShare: call('settings:testShare'),
    saveIde: call('settings:saveIde'), saveWorks: call('settings:saveWorks'), saveDbHosts: call('settings:saveDbHosts'), reveal: call('settings:reveal')
  },
  projects: {
    list: call('projects:list'), domains: call('projects:domains'), favorite: call('projects:favorite'),
    detail: call('projects:detail'), saveDomains: call('projects:saveDomains'), saveMemo: call('projects:saveMemo')
  },
  dir: {
    list: call('dir:list'), index: call('dir:index'), search: call('dir:search'), stat: call('dir:stat'),
    open: call('dir:open'), reveal: call('dir:reveal')
  },
  conn: {
    list: call('conn:list'), get: call('conn:get'), save: call('conn:save'), remove: call('conn:remove'),
    reveal: call('conn:reveal'), test: call('conn:test'), testSaved: call('conn:testSaved')
  },
  db: { servers: call('db:servers'), run: call('db:run') },
  onDbLog: cb => ipcRenderer.on('db:log', (_e, line) => cb(line)),
  ide: {
    list: call('ide:list'), get: call('ide:get'), save: call('ide:save'), remove: call('ide:remove'), memo: call('ide:memo'),
    run: call('ide:run'), openPath: call('ide:openPath'), options: call('ide:options')
  },
  git: { summary: call('git:summary'), check: call('git:check'), pull: call('git:pull'), push: call('git:push'), tag: call('git:tag') },
  jen: { builds: call('jen:builds'), detail: call('jen:detail'), build: call('jen:build') },
  works: { profile: call('works:profile'), importProfile: call('works:importProfile'), test: call('works:test'), contracts: call('works:contracts'), register: call('works:register'), open: call('works:open') },
  pickFolder: call('pick:folder'),
  copy: call('copy:text'),
  openUrl: call('open:url'),
  fileExists: call('file:exists'),
  pickExe: call('pick:exe')
});
