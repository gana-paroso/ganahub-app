// 전역 설정(global_settings.json). 기존 앱과 같은 파일·같은 필드 이름(snake_case)을 쓰고, 모르는 필드는 건드리지 않고 보존한다.
const fs = require('fs');
const crypto = require('./crypto');
const { validHost } = require('./db');

const FILE = 'global_settings.json';
const DEFAULTS = {
  share_ip: '', share_name: '', share_id: '', share_password: '',
  ide_executables: [], favorite_projects: [],
  works_url: '', works_key: '', works_staff_id: '',
  db_default_hosts: [] // DB 관리의 '접근 허용 IP' 기본값 (이 PC에만 저장)
};

/** 파일이 실제로 존재하는 파일인지 확인한다. (IDE 실행 파일 경로 점검용) */
function fileExists(p) {
  try { return typeof p === 'string' && p.trim() !== '' && fs.statSync(p.trim()).isFile(); } catch { return false; }
}

/** store(읽기·쓰기)를 받아 전역 설정 기능을 만든다. 화면에는 비밀번호·키 원문을 주지 않고 등록 여부만 준다. */
function createSettings(store, { encrypt, decrypt } = crypto) {
  const load = () => ({ ...DEFAULTS, ...store.read(FILE, {}) });
  const str = v => String(v ?? '').trim();

  /** 화면에 그릴 값. 비밀값은 hasPassword/hasKey 로만 알린다. */
  function get() {
    const s = load();
    return {
      share: { ip: s.share_ip, name: s.share_name, id: s.share_id, hasPassword: !!s.share_password },
      ide: s.ide_executables.map(i => ({ name: i.name || '', exePath: i.exe_path || '', exists: fileExists(i.exe_path) })),
      works: { url: s.works_url, staffId: s.works_staff_id, hasKey: !!s.works_key },
      dbHosts: s.db_default_hosts
    };
  }

  /** 공유폴더 접속정보 저장. password 가 비어 있으면 저장된 비밀번호를 유지한다. */
  function saveShare({ ip, name, id, password }) {
    const s = load();
    Object.assign(s, { share_ip: str(ip), share_name: str(name), share_id: str(id) });
    if (password) s.share_password = encrypt(password);
    store.write(FILE, s);
  }

  /** IDE 실행파일 목록 전체 교체. 이름·경로가 비었거나 이름이 겹치면 저장하지 않는다. */
  function saveIde(list) {
    const rows = (list || []).map(r => ({ name: str(r.name), exe_path: str(r.exePath) }));
    if (rows.some(r => !r.name || !r.exe_path)) throw new Error('이름과 경로가 비어 있는 행이 있어요');
    if (new Set(rows.map(r => r.name)).size !== rows.length) throw new Error('같은 이름의 IDE가 있어요. 이름을 다르게 해 주세요');
    const s = load();
    s.ide_executables = rows;
    store.write(FILE, s);
  }

  /** 업무 포털 연동 정보 저장. 서버 주소 끝의 슬래시는 지우고, key 가 비어 있으면 저장된 키를 유지한다. */
  function saveWorks({ url, key, staffId }) {
    const s = load();
    Object.assign(s, { works_url: str(url).replace(/\/+$/, ''), works_staff_id: str(staffId) });
    if (key) s.works_key = encrypt(key);
    store.write(FILE, s);
  }

  /** DB 관리의 기본 허용 IP 목록 저장. 빈 값은 버리고 중복은 한 번만 남기며, 형식이 틀리면 저장하지 않는다. */
  function saveDbHosts(list) {
    const hosts = [...new Set((list || []).map(str).filter(Boolean))];
    const bad = hosts.filter(h => !validHost(h));
    if (bad.length) throw new Error(`허용 IP 형식이 올바르지 않습니다: ${bad.join(', ')}`);
    const s = load();
    s.db_default_hosts = hosts;
    store.write(FILE, s);
  }

  /** 저장된 비밀값을 평문으로 돌려준다. 화면에서 사용자가 "보기"를 눌렀을 때만 쓴다. kind: 'share' | 'works' */
  function reveal(kind) {
    const s = load();
    if (kind === 'share') return decrypt(s.share_password);
    if (kind === 'works') return decrypt(s.works_key);
    throw new Error('알 수 없는 항목입니다');
  }

  /** 공유폴더 접속정보(비밀번호 복호화 포함). 화면에는 보내지 않고 메인 프로세스 안에서만 쓴다. */
  function share() {
    const s = load();
    return { ip: s.share_ip, name: s.share_name, id: s.share_id, password: decrypt(s.share_password) };
  }

  const favorites = () => load().favorite_projects;

  /** 즐겨찾기를 넣거나 뺀다(이 PC에만 저장). 바뀐 뒤 즐겨찾기 상태(true=즐겨찾기)를 돌려준다. */
  function toggleFavorite(name) {
    const s = load();
    const added = !s.favorite_projects.includes(name);
    s.favorite_projects = added ? [...s.favorite_projects, name] : s.favorite_projects.filter(n => n !== name);
    store.write(FILE, s);
    return added;
  }

  return { get, saveShare, saveIde, saveWorks, saveDbHosts, reveal, share, favorites, toggleFavorite };
}

module.exports = { createSettings, fileExists };
