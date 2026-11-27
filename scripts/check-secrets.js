// 공개 저장소에 올리기 전에, 사내 정보나 비밀값이 파일·커밋 메시지에 섞여 있지 않은지 검사한다. (npm run check:secrets)
// 두 가지 규칙을 쓴다.
//  1) 일반 규칙: 이 저장소에 들어 있다. 사설 IP 주소(샘플용 192.168.0.x 는 허용), 개인 키, GitHub 토큰.
//  2) 금지 목록: 저장소에 올리지 않는 비공개 목록. 한 줄에 정규식 하나(# 으로 시작하면 주석, 대소문자 무시).
//     .private/deny-list.txt 파일 또는 환경 변수 GANAHUB_DENY_LIST(줄바꿈으로 구분)에서 읽는다.
//     (GitHub Actions 에서는 저장소 Secret 값을 이 환경 변수로 넘기면 빌드 때도 같은 검사를 한다)
// 로그가 공개될 수 있으므로, 걸린 곳의 파일과 줄 번호, 규칙 이름만 출력하고 걸린 내용은 출력하지 않는다.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const GENERIC = [
  { name: '사설 IP 주소 (샘플용 192.168.0.x 외)', re: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.(?!0\.)\d{1,3}\.\d{1,3})\b/ },
  { name: '개인 키', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'GitHub 토큰', re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/ }
];
const SKIP_FILES = new Set(['package-lock.json']); // 자동 생성 파일
const BINARY_EXT = new Set(['.png', '.ico', '.woff2', '.woff', '.exe', '.zip', '.blockmap', '.jpg', '.gif', '.pdf']);

/** 금지 목록 텍스트를 규칙으로 바꾼다. 빈 줄과 # 주석은 건너뛰고, 정규식이 잘못되면 몇 번째 줄인지 알려 준다. */
function parseDenyList(text) {
  const rules = [];
  String(text || '').split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    try { rules.push({ name: `금지 목록 ${i + 1}번째 줄`, re: new RegExp(line, 'iu') }); } catch (e) { throw new Error(`금지 목록 ${i + 1}번째 줄의 정규식이 올바르지 않습니다: ${e.message}`); }
  });
  return rules;
}

/** 이 PC의 금지 목록(파일)과 환경 변수의 금지 목록을 합쳐 읽는다. */
function loadRules() {
  const file = path.join(ROOT, '.private', 'deny-list.txt');
  const fromFile = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  return { rules: [...GENERIC, ...parseDenyList(fromFile), ...parseDenyList(process.env.GANAHUB_DENY_LIST)], hasDenyList: !!(fromFile.trim() || process.env.GANAHUB_DENY_LIST) };
}

/** 텍스트에서 규칙에 걸리는 줄을 찾는다. 반환: [{ line, rule }] (걸린 내용은 담지 않는다) */
function scanText(text, rules) {
  const found = [];
  String(text).split(/\r?\n/).forEach((line, i) => { for (const r of rules) if (r.re.test(line)) found.push({ line: i + 1, rule: r.name }); });
  return found;
}

/** 검사할 파일 목록(저장소에 올라갈 파일). git 이 없으면 폴더를 직접 훑는다. */
function listFiles() {
  try { return execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean); } catch { /* git 저장소가 아니면 아래로 */ }
  const out = [];
  const walk = dir => { for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (['node_modules', 'dist', '.git', '.private', '.design'].includes(e.name)) continue;
    const rel = path.posix.join(dir, e.name);
    e.isDirectory() ? walk(rel) : out.push(rel);
  } };
  walk('.');
  return out.map(f => f.replace(/^\.\//, ''));
}

const isBinary = (rel, buf) => BINARY_EXT.has(path.extname(rel).toLowerCase()) || buf.subarray(0, 8000).includes(0);

/** 저장소 전체를 검사해 [{ where, rule }] 를 돌려준다. */
function checkRepo({ rules }) {
  const findings = [];
  for (const rel of listFiles()) {
    if (SKIP_FILES.has(path.basename(rel))) continue;
    let buf;
    try { buf = fs.readFileSync(path.join(ROOT, rel)); } catch { continue; }
    if (isBinary(rel, buf)) continue;
    for (const f of scanText(buf.toString('utf8'), rules)) findings.push({ where: `${rel}:${f.line}`, rule: f.rule });
  }
  try { // 커밋 메시지도 공개된다
    const log = execFileSync('git', ['log', '--format=%B%x00'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    log.split('\0').forEach((msg, i) => { for (const f of scanText(msg, rules)) findings.push({ where: `커밋 메시지(최근 ${i + 1}번째)`, rule: f.rule }); });
  } catch { /* 커밋이 아직 없으면 건너뛴다 */ }
  return findings;
}

if (require.main === module) {
  const { rules, hasDenyList } = loadRules();
  const findings = checkRepo({ rules });
  if (!hasDenyList) console.log('안내: 금지 목록이 없어 일반 규칙만 검사했어요. (.private/deny-list.txt 또는 환경 변수 GANAHUB_DENY_LIST)');
  if (findings.length) {
    console.error(`공개하면 안 될 수 있는 내용이 ${findings.length}곳에서 발견됐어요. (걸린 내용은 로그에 남기지 않아요)`);
    for (const f of findings) console.error(`  ${f.where}  [${f.rule}]`);
    process.exit(1);
  }
  console.log(`검사 통과: 파일과 커밋 메시지에서 문제를 찾지 못했어요. (규칙 ${rules.length}개)`);
}

module.exports = { scanText, parseDenyList, GENERIC };
