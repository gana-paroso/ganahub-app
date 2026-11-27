// 연결 정보(connections.json): SSH / Git / Jenkins. 기존 앱과 같은 파일·같은 필드 이름을 쓴다.
// 비밀값(SSH 비밀번호, MySQL 비밀번호, Git·Jenkins 토큰)은 DPAPI 로 암호화해 저장한다. SSH 개인키 경로는 비밀이 아니라 평문이다.
const crypto = require('crypto');
const base = require('./crypto');

const FILE = 'connections.json';
// 타입별로 저장하는 필드. 여기에 없는 값은 저장하지 않는다.
const FIELDS = {
  ssh: ['host', 'port', 'ssh_user', 'auth_method', 'ssh_credential', 'mysql_user', 'mysql_password'],
  git: ['provider', 'git_username', 'git_token'],
  jenkins: ['url', 'jenkins_user', 'jenkins_token']
};
const SECRETS = { ssh: ['ssh_credential', 'mysql_password'], git: ['git_token'], jenkins: ['jenkins_token'] };
const REQUIRED = { ssh: [['host', 'Host'], ['ssh_user', 'ID']], git: [['git_username', 'ID']], jenkins: [['url', 'URL'], ['jenkins_user', 'ID']] };
const PROVIDER = { github: 'GitHub', gitlab: 'GitLab' };

function createConnections(store, { encrypt, decrypt } = base) {
  const str = v => String(v ?? '').trim();
  const load = () => { const raw = store.read(FILE, {}); return { ...raw, connections: Array.isArray(raw.connections) ? raw.connections : [] }; };
  const find = (data, id) => data.connections.find(c => c.id === id);
  const need = (data, id) => { const c = find(data, id); if (!c) throw new Error('연결 정보를 찾을 수 없습니다'); return c; };
  /** 개인키 경로는 비밀이 아니라서 암호화하지 않는다. */
  const isPlain = (type, fields, key) => type === 'ssh' && key === 'ssh_credential' && fields.auth_method === 'key';
  const stamp = () => new Date().toISOString().slice(0, 19);

  const summary = c => {
    const f = c.fields || {};
    if (c.type === 'ssh') return `${f.ssh_user || ''}@${f.host || ''}:${f.port || ''}`;
    if (c.type === 'git') return `${PROVIDER[f.provider] || f.provider || ''} · ${f.git_username || ''}`;
    return `${f.jenkins_user || ''} · ${f.url || ''}`;
  };

  /** 목록용 요약. 비밀값은 들어 있지 않다. */
  function list() {
    return load().connections.map(c => ({
      id: c.id, type: c.type, name: c.name, description: c.description || '', summary: summary(c),
      lastUsedAt: c.last_used_at ? c.last_used_at.replace('T', ' ').slice(0, 16) : ''
    }));
  }

  /** 수정 폼용. 비밀값은 비워서 주고(보기를 눌렀을 때 reveal 로 가져온다), 등록 여부만 알린다. */
  function get(id) {
    const c = need(load(), id), f = c.fields || {}, out = {};
    const has = {};
    for (const k of FIELDS[c.type]) out[k] = SECRETS[c.type].includes(k) && !isPlain(c.type, f, k) ? '' : f[k] ?? '';
    for (const k of SECRETS[c.type]) has[k] = !!f[k] && !isPlain(c.type, f, k);
    return { id: c.id, type: c.type, name: c.name, description: c.description || '', fields: out, hasSecret: has };
  }

  /** 새로 만들거나(id 없음) 고친다. 비밀값을 비워 보내면 저장된 값을 유지한다. 저장한 id 를 돌려준다. */
  function save({ id, type, name, description, fields }) {
    if (!FIELDS[type]) throw new Error('알 수 없는 연결 유형입니다');
    if (!str(name)) throw new Error('이름을 입력해 주세요');
    const f = {};
    for (const k of FIELDS[type]) f[k] = str(fields?.[k]);
    const miss = REQUIRED[type].find(([k]) => !f[k]);
    if (miss) throw new Error(`${miss[1]}을(를) 입력해 주세요`);
    if (type === 'ssh') {
      f.port = f.port || '22';
      if (!/^\d+$/.test(f.port) || +f.port < 1 || +f.port > 65535) throw new Error('Port 는 1~65535 사이 숫자여야 해요');
      f.auth_method = f.auth_method === 'key' ? 'key' : 'password';
      if (f.auth_method === 'key' && !f.ssh_credential) throw new Error('개인키 파일 경로를 입력해 주세요');
    }
    if (type === 'git') f.provider = f.provider.toLowerCase() === 'gitlab' ? 'gitlab' : 'github';
    if (type === 'jenkins') f.url = f.url.replace(/\/+$/, '');

    const data = load(), old = id ? need(data, id) : null;
    for (const k of SECRETS[type]) {
      if (isPlain(type, f, k)) continue;
      if (f[k]) f[k] = encrypt(f[k]);
      // 비워 두면 기존 값을 유지한다. 단, SSH 인증 방식이 바뀌면 이전 값(비밀번호↔키 경로)은 쓸 수 없다.
      else if (old && old.type === type && !(k === 'ssh_credential' && old.fields.auth_method !== f.auth_method)) f[k] = old.fields[k] || '';
    }
    const now = stamp();
    if (old) Object.assign(old, { name: str(name), description: str(description), fields: f, updated_at: now });
    else data.connections.push({ id: crypto.randomUUID(), type, name: str(name), description: str(description), fields: f, created_at: now, updated_at: now, last_used_at: null });
    store.write(FILE, data);
    return (old || data.connections[data.connections.length - 1]).id;
  }

  function remove(id) {
    const data = load();
    need(data, id);
    data.connections = data.connections.filter(c => c.id !== id);
    store.write(FILE, data);
  }

  /** 마지막 사용 시각을 지금으로 바꾼다. */
  function touch(id) {
    const data = load();
    need(data, id).last_used_at = stamp();
    store.write(FILE, data);
  }

  /** 비밀값을 복호화한 필드. 연결 테스트처럼 메인 프로세스 안에서만 쓴다. */
  function decrypted(id) {
    const c = need(load(), id), f = { ...c.fields };
    for (const k of SECRETS[c.type]) if (f[k] && !isPlain(c.type, f, k)) f[k] = decrypt(f[k]);
    return { type: c.type, fields: f };
  }

  /** 폼에서 비밀값을 비워 둔 채 테스트할 때, 저장된 값으로 빈칸을 채운다. 저장된 연결이 아니면 그대로 돌려준다. */
  function withStored(id, type, fields) {
    const f = { ...fields };
    if (!id) return f;
    const stored = decrypted(id);
    if (stored.type !== type) return f;
    for (const k of SECRETS[type]) {
      if (f[k] || (k === 'ssh_credential' && stored.fields.auth_method !== f.auth_method)) continue;
      f[k] = stored.fields[k] || '';
    }
    return f;
  }

  /** 저장된 비밀값 하나를 평문으로 돌려준다. 화면에서 "보기"나 "복사"를 눌렀을 때만 쓴다. */
  function reveal(id, field) {
    const { type, fields } = decrypted(id);
    if (!SECRETS[type].includes(field)) throw new Error('알 수 없는 항목입니다');
    return fields[field] || '';
  }

  return { list, get, save, remove, touch, decrypted, withStored, reveal };
}

module.exports = { createConnections };
