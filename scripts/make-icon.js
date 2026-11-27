// build/icon.svg 를 여러 크기의 PNG 로 그려서 build/icon.ico 로 묶는다. (설치 파일과 실행 파일의 아이콘)
// 실행: npx electron scripts/make-icon.js   (환경 변수 ICON_PREVIEW_DIR 를 주면 크기별 PNG 도 그 폴더에 저장한다)
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SVG = path.join(__dirname, '..', 'build', 'icon.svg');
const OUT = path.join(__dirname, '..', 'build', 'icon.ico');

app.commandLine.appendSwitch('force-device-scale-factor', '1'); // 화면 배율과 상관없이 정확한 픽셀 크기로 그린다

/** size x size 투명 배경으로 SVG 를 그려 PNG 데이터를 돌려준다. */
async function render(svg, size) {
  const win = new BrowserWindow({ width: size, height: size, show: false, frame: false, transparent: true, useContentSize: true, webPreferences: { offscreen: false } });
  const html = `<!doctype html><style>html,body{margin:0;overflow:hidden;background:transparent}svg{display:block}</style><body>${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`;
  const file = path.join(os.tmpdir(), `ganahub-icon-${size}.html`);
  fs.writeFileSync(file, html);
  await win.loadFile(file);
  await new Promise(r => setTimeout(r, 150));
  const img = (await win.webContents.capturePage()).resize({ width: size, height: size });
  if (img.toBitmap()[3] !== 0) console.warn(`경고: ${size}px 아이콘의 배경이 투명하지 않아요`); // 왼쪽 위 모서리의 투명도 확인
  const png = img.toPNG();
  win.destroy();
  fs.unlinkSync(file);
  return png;
}

/** PNG 들을 하나의 ICO 파일로 묶는다. (PNG 압축 방식, 256 은 폭·높이를 0 으로 적는다) */
function toIco(entries) {
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  let offset = head.length;
  entries.forEach(({ size, png }, i) => {
    const o = 6 + 16 * i;
    head[o] = size === 256 ? 0 : size; head[o + 1] = size === 256 ? 0 : size;
    head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(png.length, o + 8); head.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...entries.map(e => e.png)]);
}

app.on('window-all-closed', () => {}); // 창을 하나씩 닫아도 작업이 끝나기 전에 종료되지 않게 한다

app.whenReady().then(async () => {
  const svg = fs.readFileSync(SVG, 'utf8');
  const entries = [];
  for (const size of SIZES) entries.push({ size, png: await render(svg, size) });
  fs.writeFileSync(OUT, toIco(entries));
  if (process.env.ICON_PREVIEW_DIR) for (const e of entries) fs.writeFileSync(path.join(process.env.ICON_PREVIEW_DIR, `icon-${e.size}.png`), e.png);
  console.log(`${OUT} 를 만들었어요 (크기: ${SIZES.join(', ')})`);
  app.quit();
});
