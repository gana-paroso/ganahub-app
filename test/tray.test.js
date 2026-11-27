const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { attachTray } = require('../src/tray');

/** electron 대신 쓰는 가짜 객체들. 호출 기록(log)을 남긴다. */
function fakes() {
  const log = [];
  const app = Object.assign(new EventEmitter(), { quit: () => { log.push('quit'); app.emit('before-quit'); } });
  const win = Object.assign(new EventEmitter(), { minimized: false, isMinimized() { return this.minimized; }, restore() { this.minimized = false; log.push('restore'); }, show: () => log.push('show'), hide: () => log.push('hide'), focus: () => log.push('focus') });
  class Tray extends EventEmitter {
    constructor(img) { super(); this.img = img; Tray.last = this; }
    setToolTip(t) { this.tip = t; }
    setContextMenu(m) { this.menu = m; }
  }
  const Menu = { buildFromTemplate: t => t };
  const nativeImage = { createFromPath: p => `이미지:${p}` };
  return { log, app, win, deps: { app, Tray, Menu, nativeImage }, Tray };
}
/** 창의 close 이벤트를 흉내 낸다. 기본 동작을 막았는지(prevented) 돌려준다. */
const close = win => { let prevented = false; win.emit('close', { preventDefault: () => { prevented = true; } }); return prevented; };

test('닫기(X)를 누르면 종료하지 않고 창을 숨긴다', () => {
  const { win, log, deps } = fakes();
  attachTray(deps, win, 'icon.ico');
  assert.strictEqual(close(win), true);
  assert.deepStrictEqual(log, ['hide']);
});

test('트레이 메뉴의 종료나 정상 종료(before-quit) 뒤에는 창이 닫힌다', () => {
  const { win, app, log, deps, Tray } = fakes();
  attachTray(deps, win, 'icon.ico');
  Tray.last.menu.find(m => m.label === '종료').click();
  assert.deepStrictEqual(log, ['quit']);
  assert.strictEqual(close(win), false);
});

test('업데이트 재시작처럼 앱이 종료되는 경우에도 창을 붙잡지 않는다', () => {
  const { win, app, deps } = fakes();
  attachTray(deps, win, 'icon.ico');
  app.emit('before-quit');
  assert.strictEqual(close(win), false);
});

test('Windows 로그오프·종료(session-end) 중에는 창을 붙잡지 않는다', () => {
  const { win, deps } = fakes();
  attachTray(deps, win, 'icon.ico');
  win.emit('session-end');
  assert.strictEqual(close(win), false);
});

test('트레이 아이콘: 설명, 메뉴(열기·종료), 클릭과 더블클릭으로 창 열기', () => {
  const { win, log, deps, Tray } = fakes();
  attachTray(deps, win, 'C:/app/icon.ico');
  const t = Tray.last;
  assert.deepStrictEqual([t.tip, t.img], ['GanaHub', '이미지:C:/app/icon.ico']);
  assert.deepStrictEqual(t.menu.map(m => m.label || m.type), ['열기', 'separator', '종료']);
  t.emit('click'); t.emit('double-click');
  assert.deepStrictEqual(log, ['show', 'focus', 'show', 'focus']);
  log.length = 0;
  t.menu[0].click();
  assert.deepStrictEqual(log, ['show', 'focus']);
});

test('최소화된 창은 복원한 뒤 앞으로 가져온다 (두 번째 실행 때도 같은 함수)', () => {
  const { win, log, deps } = fakes();
  const { show } = attachTray(deps, win, 'icon.ico');
  win.minimized = true;
  show();
  assert.deepStrictEqual(log, ['restore', 'show', 'focus']);
});
