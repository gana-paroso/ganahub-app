// Jenkins 기능: 이 PC 안에 가짜 Jenkins(HTTP) 서버를 띄워 요청 주소, 인증, 응답 해석을 확인한다.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const jenkins = require('../src/jenkins');

const AUTH = `Basic ${Buffer.from('jenkins:tok').toString('base64')}`;

/** 요청 기록(requests)을 남기는 가짜 서버. routes 는 (method, 경로) → { status, body, json } 를 돌려주는 함수. */
function start(routes) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, auth: req.headers.authorization, crumb: req.headers['jenkins-crumb'] });
    if (req.headers.authorization !== AUTH) { res.statusCode = 401; return res.end(); }
    const r = routes(req.method, decodeURIComponent(req.url.split('?')[0])) || { status: 404 };
    res.statusCode = r.status || 200;
    res.end(r.json !== undefined ? JSON.stringify(r.json) : r.body || '');
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, requests, c: { url: `http://127.0.0.1:${server.address().port}/`, user: 'jenkins', token: 'tok' } })));
}

test('최근 빌드: 결과 이름, 진행 중, 트리거 주체, 커밋 메시지를 뽑는다 (단일·다중 changeSet 모두)', async () => {
  const { server, requests, c } = await start(() => ({ json: { builds: [
    { number: 58, result: null, building: true, timestamp: 1000, duration: 0, actions: [{}, { causes: [{ shortDescription: 'Started by user a' }] }], changeSets: [{ items: [{ msg: '파이프라인 커밋' }] }] },
    { number: 57, result: 'SUCCESS', building: false, timestamp: 900, duration: 120000, actions: [], changeSet: { items: [{ msg: '구버전 커밋' }] } },
    { number: 56, result: 'FAILURE', building: false, timestamp: 800, duration: 5000 }
  ] } }));
  try {
    const b = await jenkins.recentBuilds(c, 'my-job');
    assert.deepStrictEqual(b.map(x => [x.number, x.resultLabel, x.building]), [[58, '진행 중', true], [57, '성공', false], [56, '실패', false]]);
    assert.deepStrictEqual([b[0].cause, b[0].commitMessage, b[1].commitMessage, b[2].commitMessage], ['Started by user a', '파이프라인 커밋', '구버전 커밋', '']);
    assert.match(requests[0].url, /^\/job\/my-job\/api\/json\?tree=builds/);
  } finally { server.close(); }
});

test('Job 이름: 공백은 인코딩하고, 폴더 안의 Job 은 /job/폴더/job/이름 으로 만든다', () => {
  assert.strictEqual(jenkins.jobPath('my job'), 'my%20job');
  assert.strictEqual(jenkins.jobPath('folder/my job'), 'folder/job/my%20job');
});

test('빌드 내역 오류: Job 없음 / 인증 실패 / 서버 오류 / 접속 불가', async () => {
  const { server, c } = await start((_m, p) => (p.startsWith('/job/exists/') ? { json: { builds: [] } } : p.includes('boom') ? { status: 500 } : undefined));
  try {
    assert.deepStrictEqual(await jenkins.recentBuilds(c, 'exists'), []);
    await assert.rejects(jenkins.recentBuilds(c, 'nope'), /Job 'nope'을\(를\) 찾을 수 없습니다/);
    await assert.rejects(jenkins.recentBuilds(c, 'boom'), /상태 코드 500/);
    await assert.rejects(jenkins.recentBuilds({ ...c, token: 'wrong' }, 'exists'), /ID 또는 API Token/);
  } finally { server.close(); }
  await assert.rejects(jenkins.recentBuilds({ url: 'http://127.0.0.1:1', user: 'a', token: 'b' }, 'x'), /^Error: 연결 실패/);
});

test('빌드 상세: 로그와 변경된 파일, 너무 긴 로그는 끝부분만', async () => {
  const long = 'x'.repeat(25000) + 'END';
  const { server, c } = await start((_m, p) => {
    if (p === '/job/j/7/consoleText') return { body: 'Started\nFinished: SUCCESS' };
    if (p === '/job/j/8/consoleText') return { body: long };
    if (p.endsWith('/api/json')) return { json: { changeSets: [{ items: [{ paths: [{ file: 'a.java', editType: 'edit' }, { file: 'b.md', editType: 'add' }] }] }] } };
  });
  try {
    const d = await jenkins.buildDetail(c, 'j', 7);
    assert.strictEqual(d.log, 'Started\nFinished: SUCCESS');
    assert.deepStrictEqual(d.changedFiles, [{ file: 'a.java', editType: 'edit' }, { file: 'b.md', editType: 'add' }]);
    const l = (await jenkins.buildDetail(c, 'j', 8)).log;
    assert.ok(l.startsWith('...(생략)...') && l.endsWith('END') && l.length < 20100);
    await assert.rejects(jenkins.buildDetail(c, 'j', 99), /빌드 #99을\(를\) 찾을 수 없습니다/);
    await assert.rejects(jenkins.buildDetail(c, 'j', '../x'), /빌드 번호/);
  } finally { server.close(); }
});

test('지금 빌드하기: crumb 을 받아 함께 보내고, 권한이 없으면 안내한다', async () => {
  const { server, requests, c } = await start((m, p) => (p === '/crumbIssuer/api/json' ? { json: { crumbRequestField: 'Jenkins-Crumb', crumb: 'abc123' } }
    : m === 'POST' && p === '/job/ok-job/build' ? { status: 201 } : m === 'POST' && p === '/job/locked/build' ? { status: 403 } : undefined));
  try {
    assert.strictEqual(await jenkins.triggerBuild(c, 'ok-job'), '빌드 요청을 전송했습니다');
    assert.strictEqual(requests.find(r => r.method === 'POST').crumb, 'abc123');
    await assert.rejects(jenkins.triggerBuild(c, 'locked'), /권한이 없거나 CSRF/);
    await assert.rejects(jenkins.triggerBuild(c, 'missing'), /Job 'missing'을\(를\) 찾을 수 없습니다/);
  } finally { server.close(); }
});

test('crumb 을 쓰지 않는 서버도 빌드할 수 있다', async () => {
  const { server, c } = await start((m, p) => (m === 'POST' && p === '/job/j/build' ? { status: 201 } : undefined));
  try { assert.strictEqual(await jenkins.triggerBuild(c, 'j'), '빌드 요청을 전송했습니다'); } finally { server.close(); }
});
