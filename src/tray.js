// 창의 닫기(X)를 눌러도 종료하지 않고 트레이로 숨기고, 트레이 아이콘으로 다시 열거나 종료한다. (기존 앱과 같은 동작)
// electron 객체는 인자로 받는다. (시험할 때 가짜 객체를 넣을 수 있다)

/** win 의 닫기를 트레이 숨김으로 바꾸고 트레이 아이콘을 만든다. 반환: { show, tray } (tray 는 사라지지 않게 호출한 쪽에서 붙들어 둔다) */
function attachTray({ app, Tray, Menu, nativeImage }, win, iconPath) {
  let quitting = false;
  app.on('before-quit', () => { quitting = true; }); // 트레이의 종료, 업데이트 재시작, 그 밖의 정상 종료
  win.on('session-end', () => { quitting = true; }); // Windows 로그오프·종료 중에는 창을 붙잡지 않는다
  win.on('close', e => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });

  /** 숨겨졌거나 최소화된 창을 앞으로 가져온다. */
  const show = () => {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };

  const tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip('GanaHub');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: '열기', click: show }, { type: 'separator' }, { label: '종료', click: () => app.quit() }]));
  tray.on('click', show);
  tray.on('double-click', show);
  return { show, tray };
}

module.exports = { attachTray };
