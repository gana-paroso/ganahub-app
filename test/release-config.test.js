// 릴리즈 파이프라인 설정이 서로 맞는지 확인한다. (설치 파일 이름, 업데이트 저장소, 워크플로의 파일 패턴)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');

test('업데이트 저장소가 ganahub-app 을 가리킨다', () => {
  assert.deepStrictEqual(pkg.build.publish, [{ provider: 'github', owner: 'gana-paroso', repo: 'ganahub-app' }]);
});

test('설치 파일 이름이 워크플로의 업로드 패턴과 맞는다', () => {
  const prefix = pkg.build.win.artifactName.split('${version}')[0]; // GanaHub-Setup-
  assert.ok(workflow.includes(`dist/${prefix}*.exe`));
  assert.ok(workflow.includes(`dist/${prefix}*.exe.blockmap`));
});

test('릴리즈 빌드 전에 공개 전 검사를 실행한다 (금지 목록은 Secret 에서 받는다)', () => {
  assert.ok(workflow.includes('node scripts/check-secrets.js'));
  assert.ok(workflow.includes('GANAHUB_DENY_LIST: ${{ secrets.DENY_LIST }}'));
  assert.ok(workflow.indexOf('check-secrets') < workflow.indexOf('npx electron-builder'), '검사가 빌드보다 먼저여야 한다');
});

test('저장 위치 폴더 이름이 기존 앱(GanaHub)과 같다', () => {
  assert.strictEqual(pkg.build.productName, 'GanaHub');
});
