// 프로젝트 폴더 안의 탐색(한 단계 조회)과 파일명 검색(폴더 전체 색인 후 메모리 검색).
const fs = require('fs');
const path = require('path');
const { pool, CONFIG } = require('./projects');

const hidden = name => name.startsWith('@') || name === '#recycle'; // NAS 시스템 폴더
const isRisky = file => /\.(exe|bat|cmd|com|msi|ps1|vbs|scr)$/i.test(file); // 실행 전에 확인을 받아야 하는 파일
const MAX_RESULTS = 5000;

const join = (rel, name) => (rel ? `${rel}/${name}` : name);
const date = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 프로젝트 폴더 기준 상대 경로(/ 구분)를 절대 경로로 바꾼다. 프로젝트 폴더 밖으로 나가는 경로는 거부한다. */
function resolve(projectPath, rel = '') {
  const base = path.resolve(projectPath);
  const full = path.resolve(base, String(rel).split('/').join(path.sep));
  const [b, f] = [base.toLowerCase(), full.toLowerCase()];
  if (f !== b && !f.startsWith(b + path.sep)) throw new Error('허용되지 않은 경로입니다');
  return full;
}

/** 폴더 안 항목 한 단계. 프로젝트 루트의 config.json 은 숨긴다. 폴더/파일 구분과 정렬은 화면이 한다. */
async function list(projectPath, rel = '') {
  const dir = resolve(projectPath, rel);
  const ents = (await fs.promises.readdir(dir, { withFileTypes: true })).filter(e => !hidden(e.name) && !(!rel && e.name === CONFIG && !e.isDirectory()));
  return pool(ents, 16, async e => {
    let st = null;
    try { st = await fs.promises.stat(path.join(dir, e.name)); } catch { /* 정보를 못 읽어도 이름은 보여 준다 */ }
    const isDir = st ? st.isDirectory() : e.isDirectory();
    return { path: join(rel, e.name), name: e.name, isDir, size: isDir || !st ? null : st.size, modified: st ? date(st.mtime) : null };
  });
}

/** 검색 결과처럼 크기·수정일 없이 받은 항목들의 정보를 따로 읽는다. 읽지 못하면 null. */
function stat(projectPath, rels) {
  return pool(rels, 16, async rel => {
    try { const st = await fs.promises.stat(resolve(projectPath, rel)); return { size: st.isDirectory() ? null : st.size, modified: date(st.mtime) }; } catch { return null; }
  });
}

/* 프로젝트별 색인(이름만). 폴더를 깊이별로 8개씩 동시에 읽는다. */
const indexes = new Map();

async function scan(projectPath) {
  const out = [];
  let level = [''];
  while (level.length) {
    const next = [];
    await pool(level, 8, async rel => {
      let ents;
      try { ents = await fs.promises.readdir(resolve(projectPath, rel), { withFileTypes: true }); } catch { return; } // 읽지 못하는 하위 폴더는 건너뛴다
      for (const e of ents) {
        if (hidden(e.name) || (!rel && e.name === CONFIG && !e.isDirectory())) continue;
        const isDir = e.isDirectory();
        out.push({ path: join(rel, e.name), name: e.name, isDir });
        if (isDir) next.push(join(rel, e.name));
      }
    });
    level = next;
  }
  return out;
}

/** 색인을 새로 만들기 시작한다. (디렉토리 조회 화면에 들어올 때 한 번) */
function startIndex(projectPath) {
  const p = scan(projectPath);
  indexes.set(projectPath, p);
  p.catch(() => indexes.delete(projectPath));
  return p;
}

/** 이름에 term 이 들어간 항목(대소문자 무시). 색인이 아직 만들어지는 중이면 끝날 때까지 기다린다. */
async function search(projectPath, term) {
  const rows = await (indexes.get(projectPath) || startIndex(projectPath));
  const t = String(term).toLowerCase();
  const hits = rows.filter(r => r.name.toLowerCase().includes(t));
  return { rows: hits.slice(0, MAX_RESULTS), total: hits.length };
}

module.exports = { resolve, list, stat, startIndex, search, isRisky };
