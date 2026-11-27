// 공유폴더의 프로젝트 폴더 목록과 각 프로젝트의 config.json(도메인 정보·공통 메모).
// 여러 명이 동시에 저장할 수 있으므로, 저장할 때마다 최신 파일을 다시 읽어 바꾼 부분만 합치고 임시 파일 → 이름 변경으로 교체한다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG = 'config.json';
const SYSTEM_PREFIX = '@'; // Synology 가 만드는 시스템 폴더(@Recently-Snapshot, @eaDir 등)

/** 작업을 최대 limit 개씩 동시에 실행한다. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

/** 이름이 경로 구분자 없는 순수 폴더 이름인지 확인하고, 프로젝트 폴더 경로를 돌려준다. */
function projectDir(root, name) {
  if (!name || name === '.' || name === '..' || path.basename(name) !== name) throw new Error('잘못된 프로젝트 이름입니다');
  return path.join(root, name);
}

/** 루트 바로 아래의 프로젝트 폴더 이름(이름순). 시스템 폴더는 뺀다. */
async function list(root) {
  const ents = await fs.promises.readdir(root, { withFileTypes: true });
  return ents.filter(e => e.isDirectory() && !e.name.startsWith(SYSTEM_PREFIX)).map(e => e.name).sort((a, b) => a.localeCompare(b, 'ko'));
}

/** 2026-11-27T09:30:00 형식(지역 시간). 기존 config.json 과 같은 형식이다. */
function now() {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const emptyConfig = name => ({ project_name: name, domains: [], memo: '', memo_updated_at: null, updated_at: null });

/** config.json 을 읽는다. 없으면 exists:false, 내용이 깨져 있으면 corrupt:true 와 빈 기본값. */
async function readConfig(root, name) {
  const file = path.join(projectDir(root, name), CONFIG);
  let text;
  try { text = await fs.promises.readFile(file, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return { exists: false, corrupt: false, data: emptyConfig(name) };
    throw e;
  }
  try { return { exists: true, corrupt: false, data: JSON.parse(text.replace(/^﻿/, '')) }; } catch {
    return { exists: true, corrupt: true, data: emptyConfig(name) };
  }
}

/** 같은 폴더에 임시 파일로 쓴 뒤 이름을 바꿔 교체한다. 쓰는 도중 실패해도 기존 파일은 그대로 남는다. */
async function atomicWrite(file, data) {
  const tmp = path.join(path.dirname(file), `.config_${crypto.randomBytes(4).toString('hex')}.tmp`);
  try {
    await fs.promises.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fs.promises.rename(tmp, file);
  } catch (e) {
    await fs.promises.unlink(tmp).catch(() => {});
    throw e;
  }
}

/** 최신 config.json 을 다시 읽어 patch(data)로 바꾼 부분만 고쳐 저장한다. 다른 필드는 그대로 둔다. */
async function update(root, name, patch) {
  const file = path.join(projectDir(root, name), CONFIG);
  const cur = await readConfig(root, name);
  if (cur.corrupt) await fs.promises.copyFile(file, `${file}.broken`); // 깨진 파일은 덮어쓰기 전에 사본을 남긴다
  const data = { ...cur.data, project_name: name };
  patch(data, now());
  await atomicWrite(file, data);
}

/** 화면에 보여줄 상세 정보. */
async function detail(root, name) {
  const { exists, corrupt, data } = await readConfig(root, name);
  return {
    exists, corrupt,
    domains: (Array.isArray(data.domains) ? data.domains : []).map(d => ({ label: d.label || '', url: d.url || '' })),
    memo: typeof data.memo === 'string' ? data.memo : '',
    memoUpdatedAt: data.memo_updated_at || null
  };
}

/** 도메인 목록 전체 교체. 주소가 없는 행은 저장하지 않는다. */
function saveDomains(root, name, domains) {
  const rows = (domains || []).map(d => ({ label: String(d.label ?? '').trim(), url: String(d.url ?? '').trim() })).filter(d => d.url);
  return update(root, name, (data, t) => { data.domains = rows; data.updated_at = t; });
}

/** 공통 메모 전체 교체. 작성자 구분 없이 마지막 수정 시각만 남긴다. */
function saveMemo(root, name, memo) {
  return update(root, name, (data, t) => { data.memo = String(memo ?? ''); data.memo_updated_at = t; data.updated_at = t; });
}

/** 여러 프로젝트의 도메인 목록을 한꺼번에 읽는다. (목록 화면의 배지용) 읽지 못한 프로젝트는 건너뛴다. */
async function domainsOf(root, names) {
  const res = {};
  await pool(names, 8, async n => {
    try { const d = (await readConfig(root, n)).data.domains; if (Array.isArray(d) && d.length) res[n] = d.map(x => ({ label: x.label || '', url: x.url || '' })); } catch { /* 읽지 못하면 배지 없음 */ }
  });
  return res;
}

module.exports = { list, detail, saveDomains, saveMemo, domainsOf, projectDir, pool, CONFIG };
