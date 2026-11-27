// 로컬 설정 JSON(%APPDATA%\GanaHub)의 읽기·쓰기. 기존 앱과 같은 파일·같은 형식(들여쓰기 2칸, UTF-8)을 쓴다.
const fs = require('fs');
const path = require('path');

// 기존 앱이 만든 파일들. 앱을 처음 실행할 때 이 파일들의 .bak 사본을 하나씩 남긴다.
const FILES = ['global_settings.json', 'connections.json', 'ide_projects.json', 'publish_projects.json'];

/** dir 폴더를 저장 위치로 쓰는 저장소를 만든다. */
function createStore(dir) {
  const file = name => path.join(dir, name);

  /** 파일이 없으면 fallback. 내용이 깨져 있으면 예외를 던진다. (조용히 빈 값으로 바꾸면 다음 저장 때 기존 데이터를 덮어쓰게 된다) */
  function read(name, fallback) {
    let text;
    try { text = fs.readFileSync(file(name), 'utf8'); } catch (e) {
      if (e.code === 'ENOENT') return fallback;
      throw e;
    }
    try { return JSON.parse(text); } catch (e) { throw new Error(`${name} 을(를) 읽을 수 없습니다: ${e.message}`); }
  }

  /** 임시 파일에 쓴 뒤 이름을 바꿔 교체한다. 쓰는 도중 꺼져도 기존 파일이 깨지지 않는다. */
  function write(name, data) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file(name) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file(name));
  }

  /** 각 파일의 .bak 사본이 아직 없으면 지금 내용을 복사해 둔다. (구 앱으로 되돌릴 때 쓰는 최초 상태) */
  function backupOnce() {
    for (const name of FILES) {
      const bak = file(name) + '.bak';
      if (fs.existsSync(file(name)) && !fs.existsSync(bak)) fs.copyFileSync(file(name), bak);
    }
  }

  return { read, write, backupOnce };
}

module.exports = { createStore, FILES };
