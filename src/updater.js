// 자동 업데이트(GitHub Releases). 앱을 켠 5초 뒤와 이후 4시간마다 확인한다.
// 받는 것은 백그라운드로 하고, 설치는 사용자가 재시작하거나 앱을 종료할 때 된다.
const { app } = require('electron');
const { autoUpdater } = require('electron-updater');

let state = { state: 'idle' }; // idle | downloading { version, percent } | ready { version }

/** 업데이트 상태가 바뀔 때마다 onChange(state)를 호출한다. 개발 실행(npm start)에서는 확인하지 않는다. */
function init(onChange) {
  const set = s => { state = s; onChange(s); };
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('update-available', i => { if (state.state !== 'ready') set({ state: 'downloading', version: i.version, percent: 0 }); });
  autoUpdater.on('download-progress', p => set({ state: 'downloading', version: state.version, percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', i => set({ state: 'ready', version: i.version }));
  autoUpdater.on('error', e => console.error('업데이트 확인 실패:', e.message)); // 오프라인 등은 조용히 넘어간다
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 5000);
  setInterval(check, 4 * 60 * 60 * 1000);
}

const getState = () => state;
const install = () => autoUpdater.quitAndInstall(true, true);

module.exports = { init, getState, install };
