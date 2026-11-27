/* GanaHub 공통 스크립트: 아이콘, 왼쪽 메뉴, 토스트. 화면은 <body data-nav="메뉴키">로 현재 메뉴를 알린다. */
const ICONS = {
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  link: '<path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 1 1 0 10h-2M8 12h8"/>',
  db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  ide: '<path d="M10 22V7a1 1 0 0 0-1-1H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 0 0-1-1H2"/><rect x="14" y="2" width="8" height="8" rx="1"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  star: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4M12 17h.01"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
};
const icon = (n, s) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"${s ? ` style="width:${s}px;height:${s}px"` : ""}>${ICONS[n]}</svg>`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const NAV = [
  ["projects", "프로젝트 관리", "folder", "projects-list-toss.html"],
  ["conn", "연결 관리", "link", "connections-toss.html"],
  ["db", "DB 관리", "db", "db-toss.html"],
  ["ide", "IDE 관리", "ide", "ide-toss.html"],
  ["quick", "간편접수", "phone", "quick-toss.html"],
  "sep",
  ["settings", "전역 설정", "settings", "settings-toss.html"],
];

/** <aside id="side">에 로고와 6개 메뉴를 그린다. */
(function renderSide() {
  const cur = document.body.dataset.nav;
  document.getElementById("side").innerHTML = `<div class="side-in"><div class="brand"><span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 12.5V11.5a4 4 0 0 1 4-4H36.5a4 4 0 0 1 4 4V24"/><path d="M7.5 23V36.5a4 4 0 0 0 4 4H36.5a4 4 0 0 0 4-4V34.5"/><path d="M24 20V14M20.2 22.8 14.5 21M27.8 22.8 33.5 21M21.5 27.2 17 33M26.5 27.2 31 33"/><circle cx="24" cy="24" r="3.5"/><g fill="currentColor" stroke="none"><circle cx="24" cy="14" r="3"/><circle cx="14.5" cy="21" r="3"/><circle cx="33.5" cy="21" r="3"/><circle cx="17" cy="33" r="3"/><circle cx="31" cy="33" r="3"/></g></svg></span><span class="brand-txt"><span class="brand-name">Gana<b>Hub</b></span><span class="ver">v1.0.0</span></span></div>
    <nav aria-label="주 메뉴">${NAV.map(n => n === "sep" ? '<div class="nav-sep"></div>'
      : `<a class="nav-item" href="${n[3]}" title="${n[1]}"${n[0] === cur ? ' aria-current="page"' : ""}>${icon(n[2])}<span>${n[1]}</span></a>`).join("")}</nav>
    </div>`;
})();

/** 토스트: 검정 배경 + 흰 글자. undo를 주면 "되돌리기" 버튼이 붙고 6초 동안 보여요. */
function toast(msg, undo) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status");
  t.append(msg);
  if (undo) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = "되돌리기";
    b.onclick = () => { undo(); t.remove(); };
    t.append(b);
  }
  document.body.append(t);
  setTimeout(() => t.remove(), undo ? 6000 : 2600);
}

/** 확인 창: 실행하면 true, 취소하면 false. */
function confirmDialog({ title, desc, confirmLabel = "확인", danger = false }) {
  return new Promise(resolve => {
    const d = document.createElement("dialog");
    d.className = "dlg";
    d.innerHTML = `<form method="dialog"><h2>${title}</h2><p>${desc}</p><div class="dlg-actions"><button class="btn" value="no">취소</button>
      <button class="btn ${danger ? "btn-danger" : "btn-primary"}" value="yes">${confirmLabel}</button></div></form>`;
    document.body.append(d);
    let done = false;
    const finish = v => { if (done) return; done = true; resolve(v); setTimeout(() => d.remove(), 0); };
    d.querySelector("form").addEventListener("submit", e => finish(!!e.submitter && e.submitter.value === "yes"));
    d.addEventListener("close", () => finish(d.returnValue === "yes"));
    d.showModal();
  });
}
Object.assign(ICONS, {
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7ZM14 2v4a2 2 0 0 0 2 2h4"/>',
  up: '<path d="m5 12 7-7 7 7M12 19V5"/>',
  external: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
});

/** 버전 배지와 업데이트 배너. 앱(Electron) 안에서만 동작하고, 브라우저로 직접 열었을 때는 건너뛴다. */
(function initUpdate() {
  if (!window.api) return;
  let bar;
  const show = u => {
    if (u.state === "idle") { bar?.remove(); bar = null; document.body.classList.remove("has-banner"); return; }
    if (!bar) { bar = document.createElement("div"); bar.className = "update-bar"; document.body.prepend(bar); document.body.classList.add("has-banner"); }
    bar.textContent = u.state === "downloading" ? `새 버전 ${u.version}을 받고 있어요 (${u.percent}%)` : `새 버전 ${u.version}이 준비됐어요`;
    if (u.state === "ready") {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = "재시작하여 업데이트";
      b.onclick = async () => {
        if (await confirmDialog({ title: "업데이트할까요?", desc: "앱이 종료된 뒤 새 버전으로 다시 시작해요.", confirmLabel: "업데이트" })) api.installUpdate();
      };
      bar.append(b);
    }
  };
  api.info().then(i => { document.querySelector(".ver").textContent = "v" + i.version; show(i.update); }).catch(() => {});
  api.onUpdate(show);
})();

/* Lucide eye / eye-off / copy */
const EYE = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>';
const COPY = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';

/**
 * 비밀값 입력칸([data-eye]가 가리키는 칸) 옆에 "보기"와 "복사" 버튼을 붙인다.
 * 칸이 비어 있으면 getSecret(칸 id)가 돌려주는 저장된 값을 가져와 보여 주거나 복사한다. (저장된 값이 없으면 빈 문자열을 돌려주면 된다)
 */
function initSecretButtons(getSecret) {
  document.querySelectorAll("[data-eye]").forEach(b => {
    b.innerHTML = EYE;
    b.insertAdjacentHTML("afterend", `<button class="btn eye" type="button" data-copy="${b.dataset.eye}" aria-label="복사" title="복사">${COPY}</button>`);
  });
  document.body.addEventListener("click", async e => {
    const eye = e.target.closest("[data-eye]"), cp = e.target.closest("[data-copy]");
    if (!eye && !cp) return;
    const input = document.getElementById((eye || cp).dataset.eye || cp.dataset.copy);
    try {
      if (eye) {
        const on = input.type === "password";
        if (on && !input.value) input.value = await getSecret(input.id);
        input.type = on ? "text" : "password"; eye.innerHTML = on ? EYE_OFF : EYE; eye.title = eye.ariaLabel = on ? "숨기기" : "보기";
      } else {
        const v = input.value || await getSecret(input.id);
        if (!v) return toast("복사할 값이 없어요");
        await api.copy(v); toast("복사했어요");
      }
    } catch (err) { toast(err.message); }
  });
}
