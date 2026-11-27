// IDE 관리 > 빌드&배포의 Jenkins 기능: 최근 빌드 내역, 빌드 상세(로그·변경 파일), 지금 빌드하기.
// c = { url, user, token }. 실패는 사용자에게 보여줄 메시지를 담은 예외로 던진다.
const TIMEOUT = 10000;
const MAX_LOG = 20000;
const RESULT = { SUCCESS: '성공', FAILURE: '실패', ABORTED: '중단', UNSTABLE: '불안정' };

/** "folder/job" 처럼 폴더 안의 Job 도 /job/folder/job/job 형태로 만든다. 각 조각은 주소용으로 인코딩한다. */
const jobPath = job => String(job).split('/').filter(Boolean).map(encodeURIComponent).join('/job/');
const auth = c => ({ Authorization: `Basic ${Buffer.from(`${c.user}:${c.token}`).toString('base64')}` });

async function call(c, path, { method = 'GET', headers = {} } = {}) {
  try {
    return await fetch(`${c.url.replace(/\/+$/, '')}${path}`, { method, headers: { ...auth(c), ...headers }, signal: AbortSignal.timeout(TIMEOUT) });
  } catch (e) {
    throw new Error(e.name === 'TimeoutError' ? '연결 시간이 초과되었습니다 (주소를 확인해주세요)' : `연결 실패: ${e.cause?.code || e.message}`);
  }
}

/** 응답 상태가 성공이 아니면 안내 메시지로 예외를 던진다. */
function check(res, what) {
  if (res.status === 401) throw new Error('ID 또는 API Token이 올바르지 않습니다');
  if (res.status === 404) throw new Error(`${what}을(를) 찾을 수 없습니다`);
  if (!res.ok) throw new Error(`요청 실패 (상태 코드 ${res.status})`);
}

/** 구버전 Jenkins 의 changeSet(단일)과 파이프라인의 changeSets(다중)를 하나의 항목 목록으로 합친다. */
const changeItems = o => (o.changeSets || (o.changeSet ? [o.changeSet] : [])).flatMap(cs => cs.items || []);

/** 지정한 Job 의 최근 빌드(최신순). 트리거 주체와 첫 커밋 메시지도 함께 가져온다. */
async function recentBuilds(c, job, limit = 10) {
  const tree = `builds[number,result,timestamp,duration,building,actions[causes[shortDescription]],changeSets[items[msg]],changeSet[items[msg]]]{0,${limit}}`;
  const res = await call(c, `/job/${jobPath(job)}/api/json?${new URLSearchParams({ tree })}`);
  check(res, `Job '${job}'`);
  return ((await res.json()).builds || []).map(b => {
    const causes = (b.actions || []).flatMap(a => a.causes || []);
    return {
      number: b.number, result: b.result, building: !!b.building,
      resultLabel: b.building ? '진행 중' : RESULT[b.result] || b.result || '-',
      timestamp: b.timestamp || 0, duration: b.duration || 0,
      cause: causes[0]?.shortDescription || '', commitMessage: changeItems(b)[0]?.msg || ''
    };
  });
}

/** 한 빌드의 콘솔 로그(너무 길면 끝부분만)와 변경된 파일 목록. */
async function buildDetail(c, job, number) {
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) throw new Error('빌드 번호가 올바르지 않습니다');
  const base = `/job/${jobPath(job)}/${n}`;
  const logRes = await call(c, `${base}/consoleText`);
  check(logRes, `빌드 #${n}`);
  let log = await logRes.text();
  if (log.length > MAX_LOG) log = `...(생략)...\n${log.slice(-MAX_LOG)}`;

  const tree = 'changeSets[items[msg,author[fullName],paths[file,editType]]],changeSet[items[msg,author[fullName],paths[file,editType]]]';
  let data = {};
  try { const r = await call(c, `${base}/api/json?${new URLSearchParams({ tree })}`); if (r.ok) data = await r.json(); } catch { /* 변경 파일은 없어도 로그는 보여 준다 */ }
  const changedFiles = changeItems(data).flatMap(i => (i.paths || []).map(p => ({ file: p.file || '', editType: p.editType || '' })));
  return { log, changedFiles };
}

/** 지금 빌드하기. CSRF crumb 을 쓰는 Jenkins 도 되도록 crumb 을 먼저 받아 본다. (받을 수 없는 서버는 그냥 진행) */
async function triggerBuild(c, job) {
  const headers = {};
  try {
    const cr = await call(c, '/crumbIssuer/api/json');
    if (cr.ok) { const d = await cr.json(); headers[d.crumbRequestField || 'Jenkins-Crumb'] = d.crumb || ''; }
  } catch { /* crumb 없이 진행 */ }
  const res = await call(c, `/job/${jobPath(job)}/build`, { method: 'POST', headers });
  if (res.status === 200 || res.status === 201) return '빌드 요청을 전송했습니다';
  if (res.status === 403) throw new Error('권한이 없거나 CSRF 보호 설정을 확인해야 합니다');
  check(res, `Job '${job}'`);
  throw new Error(`빌드 요청 실패 (상태 코드 ${res.status})`);
}

module.exports = { recentBuilds, buildDetail, triggerBuild, jobPath };
