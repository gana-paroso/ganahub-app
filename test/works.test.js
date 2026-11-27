// 간편접수: 규격 파일(연동 규격)대로 요청을 만들고 응답을 해석하는지 확인한다.
// 아래 규격과 서버는 시험용으로 지어낸 이름이며, 실제 업무 포털의 규격이 아니다.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../src/store');
const { createSettings } = require('../src/settings');
const { createWorks, missingKeys } = require('../src/works');

const PROFILE = {
  path: '/api/{endpoint}.php', keyHeader: 'X-Test-Key', requestField: 'payload',
  endpoints: { me: 'whoami', ctrts: 'list', quick: 'add' },
  request: { staffId: 'sid', ctrtId: 'cid', body: 'text' },
  response: { result: 'status', success: 'okay', message: 'msg', data: 'out' },
  data: { staffName: 'name', contracts: 'items', ctrtId: 'id', ctrtName: 'title', customerName: 'client', statusName: 'state', postId: 'no', url: 'link' }
};

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ganahub-works-'));
  const store = createStore(dir), settings = createSettings(store);
  return { store, settings, works: createWorks(store, settings), dir };
}
/** 시험용 서버. 받은 요청(requests)을 기록하고, handler 가 응답 본문을 정한다. */
function startServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', d => { raw += d; });
    req.on('end', () => {
      const form = new URLSearchParams(raw);
      const r = { url: req.url, key: req.headers['x-test-key'], type: req.headers['content-type'], payload: form.get('payload') && JSON.parse(form.get('payload')) };
      requests.push(r);
      const out = handler(r);
      res.statusCode = out.http || 200;
      res.end(out.raw !== undefined ? out.raw : JSON.stringify(out.json));
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` })));
}
const configured = async (handler, key = 'secret-key') => {
  const ctx = setup(), srv = await startServer(handler);
  ctx.works.importProfile(PROFILE);
  ctx.settings.saveWorks({ url: `${srv.url}/`, staffId: 'staff1', key });
  return { ...ctx, ...srv };
};

test('규격 검사: 빠진 항목 이름을 알려 준다', () => {
  assert.deepStrictEqual(missingKeys(PROFILE), []);
  assert.deepStrictEqual(missingKeys({ ...PROFILE, keyHeader: '' }), ['keyHeader']);
  assert.deepStrictEqual(missingKeys({ ...PROFILE, path: '/api/fixed.php' }), ['path({endpoint} 자리표시자 필요)']);
  const { data, ...rest } = PROFILE;
  assert.strictEqual(missingKeys(rest).length, 8);
  assert.deepStrictEqual(missingKeys({ ...PROFILE, endpoints: { me: 'a', ctrts: 'b' } }), ['endpoints.quick']);
  assert.deepStrictEqual(missingKeys(null), ['(규격 전체)']);
});

test('규격 가져오기: 올바르면 저장하고, 잘못되면 거부한다', () => {
  const { works, store } = setup();
  assert.deepStrictEqual(works.profileStatus().ok, false);
  assert.throws(() => works.importProfile({ path: '/x/{endpoint}' }), /연동 규격이 올바르지 않습니다/);
  assert.strictEqual(store.read('works_profile.json', null), null);
  works.importProfile(PROFILE);
  assert.deepStrictEqual(works.profileStatus(), { ok: true, missing: [] });
});

test('직원 확인: 입력이 비어 있으면 호출하지 않는다', async () => {
  const { works } = setup();
  works.importProfile(PROFILE);
  await assert.rejects(works.test({ url: '', key: 'k', staffId: 's' }), /모두 입력/);
  await assert.rejects(works.test({ url: 'http://127.0.0.1:1', key: '', staffId: 's' }), /모두 입력/); // 저장된 키도 없을 때
  await assert.rejects(works.test({ url: 'http://127.0.0.1:1', key: 'k', staffId: ' ' }), /모두 입력/);
});

test('규격이 없으면 호출하지 않고 안내한다', async () => {
  const { works, settings } = setup();
  settings.saveWorks({ url: 'http://127.0.0.1:1', staffId: 's', key: 'k' });
  await assert.rejects(works.contracts(), /연동 규격이 없어요/);
  await assert.rejects(works.test({ url: 'http://127.0.0.1:1', key: 'k', staffId: 's' }), /연동 규격이 없어요/);
});

test('직원 확인: 규격의 주소·헤더·필드 이름으로 요청하고, 키를 비우면 저장된 키를 쓴다', async () => {
  const { works, server, requests, url } = await configured(() => ({ json: { status: 'okay', out: { name: '홍길동' } } }));
  try {
    const r = await works.test({ url: `${url}/`, key: '', staffId: ' staff9 ' });
    assert.deepStrictEqual(r, { staffName: '홍길동' });
    assert.deepStrictEqual([requests[0].url, requests[0].key, requests[0].payload], ['/api/whoami.php', 'secret-key', { sid: 'staff9' }]);
    assert.match(requests[0].type, /application\/x-www-form-urlencoded/);
    await works.test({ url, key: 'typed-key', staffId: 's' });
    assert.strictEqual(requests[1].key, 'typed-key');
    await assert.rejects(works.test({ url, key: '한글키', staffId: 's' }), /사용할 수 없는 문자/); // HTTP 헤더에는 영문·숫자·기호만 쓸 수 있다
    await assert.rejects(works.test({ url, key: 'has space', staffId: 's' }), /사용할 수 없는 문자/);
  } finally { server.close(); }
});

test('계약 목록: 규격의 필드 이름을 앱의 이름으로 바꿔 돌려준다', async () => {
  const { works, server, requests } = await configured(() => ({ json: { status: 'okay', out: { items: [{ id: 7, title: 'A 유지보수', client: 'A시청', state: '진행' }, { id: 8, title: '이름만' }] } } }));
  try {
    assert.deepStrictEqual(await works.contracts(), [{ id: 7, name: 'A 유지보수', customer: 'A시청', status: '진행' }, { id: 8, name: '이름만', customer: '', status: '' }]);
    assert.deepStrictEqual([requests[0].url, requests[0].payload], ['/api/list.php', { sid: 'staff1' }]);
  } finally { server.close(); }
});

test('계약 목록이 비어 있거나 형식이 달라도 빈 목록', async () => {
  const { works, server } = await configured(() => ({ json: { status: 'okay', out: {} } }));
  try { assert.deepStrictEqual(await works.contracts(), []); } finally { server.close(); }
});

test('간편접수 등록: 계약 번호는 숫자로, 내용은 한글 그대로 보내고 등록 번호와 주소를 돌려준다', async () => {
  const { works, server, requests, url } = await configured(() => ({ json: { status: 'okay', out: { no: 48231, link: 'http://x/view/48231' } } }));
  try {
    const r = await works.register({ ctrtId: '1003', body: '문의 내용입니다 & 특수문자 =?' });
    assert.deepStrictEqual(r, { postId: 48231, url: 'http://x/view/48231' });
    assert.deepStrictEqual([requests[0].url, requests[0].payload], ['/api/add.php', { sid: 'staff1', cid: 1003, text: '문의 내용입니다 & 특수문자 =?' }]);
    assert.ok(works.isOwnUrl(`${url}/view/1`));
    assert.ok(!works.isOwnUrl('http://evil.example/view/1'));
    assert.ok(!works.isOwnUrl(`${url}.evil.example/x`));
  } finally { server.close(); }
});

test('서버가 알려 준 오류 메시지는 그대로, 응답 형식이 다르면 안내 문구로', async () => {
  const { works, server } = await configured(r => (r.url.includes('list') ? { json: { status: 'fail', msg: '권한이 없는 직원입니다.' } } : r.url.includes('add') ? { raw: '<html>오류</html>', http: 502 } : { json: { status: 'fail' } }));
  try {
    await assert.rejects(works.contracts(), /권한이 없는 직원입니다\./);
    await assert.rejects(works.register({ ctrtId: 1, body: 'x' }), /서버 응답을 해석할 수 없습니다\. \(HTTP 502\)/);
    await assert.rejects(works.test({ url: 'http://127.0.0.1:1', key: 'k', staffId: 's' }), /서버에 연결할 수 없습니다/);
    await assert.rejects(works.test({ url: 'ftp://x', key: 'k', staffId: 's' }), /http/);
  } finally { server.close(); }
});

test('서버 응답에 메시지가 없으면 기본 문구', async () => {
  const { works, server } = await configured(() => ({ json: { status: 'fail' } }));
  try { await assert.rejects(works.contracts(), /처리 중 오류가 발생했습니다/); } finally { server.close(); }
});

test('접속 설정이 비어 있으면 호출하지 않고 안내한다', async () => {
  const { works, server, requests } = await configured(() => ({ json: { status: 'okay', out: {} } }), '');
  try {
    await assert.rejects(works.contracts(), /서버 주소, 업무 ID, 공용 키를 먼저 등록/);
    await assert.rejects(works.register({ ctrtId: 1, body: 'x' }), /먼저 등록/);
    assert.deepStrictEqual(requests, []);
  } finally { server.close(); }
});
