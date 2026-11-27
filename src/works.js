// 업무 포털 간편접수. 접수 서버의 주소 형식, 인증 헤더, 요청·응답 필드 이름(연동 규격)은 코드에 적지 않고,
// 이 PC에만 저장하는 규격 파일(works_profile.json)에서 읽는다. 이 저장소에는 규격의 "항목 이름"만 있고 값은 없다.
const TIMEOUT = 15000;
const FILE = 'works_profile.json';

// 규격 파일이 가져야 하는 항목. 값(문자열)은 업무 포털 쪽 이름이고, 항목 이름은 이 앱이 정한 것이다.
const SHAPE = {
  endpoints: ['me', 'ctrts', 'quick'], // 접수 기능별 서버 쪽 이름 (직원 확인 / 계약 목록 / 간편접수 등록)
  request: ['staffId', 'ctrtId', 'body'], // 요청 값의 서버 쪽 필드 이름
  response: ['result', 'success', 'message', 'data'], // 응답의 결과·성공 값·메시지·데이터 필드 이름
  data: ['staffName', 'contracts', 'ctrtId', 'ctrtName', 'customerName', 'statusName', 'postId', 'url'] // 응답 데이터 안의 필드 이름
};

/** 규격 파일에서 빠졌거나 잘못된 항목 이름 목록. 비어 있으면 올바른 규격이다. */
function missingKeys(p) {
  const bad = [];
  if (!p || typeof p !== 'object') return ['(규격 전체)'];
  const text = v => typeof v === 'string' && v.trim() !== '';
  for (const k of ['path', 'keyHeader', 'requestField']) if (!text(p[k])) bad.push(k);
  if (text(p.path) && !p.path.includes('{endpoint}')) bad.push('path({endpoint} 자리표시자 필요)');
  for (const [group, keys] of Object.entries(SHAPE)) for (const k of keys) if (!p[group] || !text(p[group][k])) bad.push(`${group}.${k}`);
  return bad;
}

function createWorks(store, settings) {
  const load = () => store.read(FILE, null);

  /** 규격 파일이 올바르게 들어 있는지. */
  function profileStatus() {
    const p = load();
    if (!p) return { ok: false, missing: ['(규격 파일 없음)'] };
    const missing = missingKeys(p);
    return { ok: !missing.length, missing };
  }

  /** 가져온 규격을 검사하고 이 PC에 저장한다. 잘못되면 어떤 항목이 문제인지 알려 준다. */
  function importProfile(obj) {
    const missing = missingKeys(obj);
    if (missing.length) throw new Error(`연동 규격이 올바르지 않습니다. 확인할 항목: ${missing.join(', ')}`);
    store.write(FILE, obj);
  }

  /** 접수 API 호출. 성공하면 서버가 준 data 를, 실패하면 사용자에게 보여줄 메시지로 예외를 던진다. */
  async function call({ url, key }, endpoint, values) {
    const p = load();
    if (!p || missingKeys(p).length) throw new Error('연동 규격이 없어요. 전역 설정의 업무 포털 연동에서 규격 파일을 가져와 주세요');
    if (!/^https?:\/\//i.test(String(url || ''))) throw new Error('서버 주소는 http:// 또는 https:// 로 시작해야 해요');
    if (/[^\x21-\x7E]/.test(String(key || ''))) throw new Error('공용 키에 공백이나 한글 같은 사용할 수 없는 문자가 있어요');
    const target = url.replace(/\/+$/, '') + p.path.replace('{endpoint}', p.endpoints[endpoint]);
    const payload = Object.fromEntries(Object.entries(values).map(([k, v]) => [p.request[k], v]));
    let res;
    try {
      res = await fetch(target, { method: 'POST', headers: { [p.keyHeader]: key }, body: new URLSearchParams({ [p.requestField]: JSON.stringify(payload) }), signal: AbortSignal.timeout(TIMEOUT) });
    } catch (e) {
      throw new Error(e.name === 'TimeoutError' ? '서버 응답 시간이 초과되었습니다.' : `서버에 연결할 수 없습니다. 서버 주소를 확인해 주세요. (${e.cause?.code || e.name})`);
    }
    let body;
    try { body = await res.json(); } catch { throw new Error(`서버 응답을 해석할 수 없습니다. (HTTP ${res.status})`); }
    if (body[p.response.result] !== p.response.success) throw new Error(body[p.response.message] || '처리 중 오류가 발생했습니다.');
    return body[p.response.data] || {};
  }

  /** 저장된 접속 설정. 비어 있으면 안내 문구로 예외. */
  function saved() {
    const w = settings.get().works, key = settings.reveal('works');
    if (!w.url || !w.staffId || !key) throw new Error('전역 설정에서 서버 주소, 업무 ID, 공용 키를 먼저 등록해 주세요');
    return { conn: { url: w.url, key }, staffId: w.staffId };
  }

  /** 입력 중인 값(키를 비우면 저장된 키)으로 직원 확인. 직원 이름을 돌려준다. */
  async function test({ url, key, staffId }) {
    const p = load(), useKey = key || settings.reveal('works');
    if (!String(url || '').trim() || !String(staffId || '').trim() || !useKey) throw new Error('서버 주소, 업무 ID, 공용 키를 모두 입력해 주세요');
    const data = await call({ url: String(url).trim().replace(/\/+$/, ''), key: useKey }, 'me', { staffId: String(staffId).trim() });
    return { staffName: data[p.data.staffName] };
  }

  /** 계약 목록: [{ id, name, customer, status }] */
  async function contracts() {
    const { conn, staffId } = saved(), p = load();
    const list = (await call(conn, 'ctrts', { staffId }))[p.data.contracts];
    return (Array.isArray(list) ? list : []).map(c => ({ id: c[p.data.ctrtId], name: c[p.data.ctrtName] || '', customer: c[p.data.customerName] || '', status: c[p.data.statusName] || '' }));
  }

  /** 간편접수 등록. 등록된 요청업무 번호와 주소를 돌려준다. */
  async function register({ ctrtId, body }) {
    const { conn, staffId } = saved(), p = load();
    const data = await call(conn, 'quick', { staffId, ctrtId: Number(ctrtId), body: String(body) });
    return { postId: data[p.data.postId], url: data[p.data.url] };
  }

  /** 등록 결과 링크가 설정한 서버 주소 아래의 주소인지. (그 밖의 주소는 열지 않는다) */
  const isOwnUrl = link => { const base = settings.get().works.url; return !!base && String(link).startsWith(`${base}/`); };

  return { profileStatus, importProfile, test, contracts, register, isOwnUrl };
}

module.exports = { createWorks, missingKeys };
