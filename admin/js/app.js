// admin/js/app.js — ADMIN 전용(기본 탭=전체 조회)
// [변경점 요약]
// - 기본 탭을 '전체 조회'로 설정(initTabs에서 초기 동기화)
// - 나머지는 고객용 개인 조회 로직을 그대로 재사용
// - 모듈형 주석으로 각 책임 분리

/* =========================
 * 상수/전역
 * ========================= */
/** 배포 버전(캐시 키) */
const BUILD_VERSION = '2025-09-19';
/** 데이터 경로(관리자/고객 공통, 상대경로 주의) */
const progressUrl = `../data/study_progress.json?v=${BUILD_VERSION}`;
const certUrl = `../data/study_cert.json?v=${BUILD_VERSION}`;
/** 단순 접근 코드(보안 아님 → 서버 보호 권장) */
const ACCESS_CODE = '1234';

/** 상태 보관 */
let chart = null;
let progressData = [];
let certData = [];
let courseTitles = [];
let roomCodes = [];

/** DOM 헬퍼 */
const $ = (s) => document.querySelector(s);

/* =========================
 * [모듈] 인증 오버레이
 * ========================= */
/** 인증 초기화 */
function initAuthOverlay(){
  $('#authBtn').addEventListener('click', onAuthSubmit);
  $('#authInput').addEventListener('keydown', (e)=>{ if(e.key==='Enter') onAuthSubmit(); });
}
/** 인증 제출 */
function onAuthSubmit(){
  const val = String($('#authInput').value||'').trim();
  if(val===ACCESS_CODE){ $('#authOverlay').style.display='none'; }
  else{ const msg=$('#authMsg'); msg.style.display='block'; msg.textContent='코드가 올바르지 않습니다.'; }
}

/* =========================
 * [모듈] 데이터 유틸
 * ========================= */
function getProgressRows(pj){
  if(pj && Array.isArray(pj.rows)) return pj.rows;
  if(pj && Array.isArray(pj.json_study_user_progress)) return pj.json_study_user_progress;
  return [];
}
function getCertRows(cj){
  if(cj && Array.isArray(cj.rows)) return cj.rows;
  if(cj && Array.isArray(cj.json_study_cert)) return cj.json_study_cert;
  return [];
}
function computeShownAt(pj, rows){
  const ga = pj && pj.generated_at ? new Date(pj.generated_at) : null;
  if(ga && !Number.isNaN(ga)) return ga;
  let m=null;
  for(const r of rows){
    const d = r?.progress_date ? new Date(String(r.progress_date)) : null;
    if(d && !Number.isNaN(d)) m = (!m || d>m) ? d : m;
  }
  return m;
}
function roomLabelFromCode(code){
  if(!code) return '';
  const m = String(code).match(/^(\d{2})(\d{2})(.+)$/);
  if(!m) return code;
  const [, yy, mm] = m;
  return `${yy}년 ${mm}월 단톡방`;
}
function getSelectedRoomCode(){
  const sel = $('#roomSelect');
  return sel && sel.value ? sel.value : null;
}
function fmtDateLabel(iso){
  const d = new Date(iso);
  if(Number.isNaN(d.getTime())) return iso;
  const w=['일','월','화','수','목','금','토'][d.getDay()];
  const mm=String(d.getMonth()+1).padStart(2,'0');
  const dd=String(d.getDate()).padStart(2,'0');
  return `${mm}/${dd}(${w})`;
}
function getSelectedCourseTitle(){
  const sel = $('#courseSelect');
  return sel && sel.value ? sel.value : null;
}

/* =========================
 * [모듈] 차트
 * ========================= */
function ensureChart(labels, data){
  const ctx = document.getElementById('progressChart')?.getContext?.('2d');
  if(!ctx) return;
  if(chart) chart.destroy();
  chart = new Chart(ctx,{
    type:'line',
    data:{labels, datasets:[{label:'진도율', data, pointRadius:2, tension:0.2}]},
    options:{responsive:true, maintainAspectRatio:false, interaction:{mode:'index', intersect:false}, scales:{y:{beginAtZero:true, min:0, max:100}}}
  });
}

/* =========================
 * [모듈] 드롭다운/목록
 * ========================= */
function fillCourses(){
  courseTitles = [...new Set(
    progressData.map(r=>String(r.study_group_title||'').trim()).filter(Boolean)
  )].sort((a,b)=>a.localeCompare(b,'ko'));
  const sel = $("#courseSelect");
  if(sel){
    sel.innerHTML = '<option value="">과정 명을 선택하세요 ▼</option>';
    courseTitles.forEach(title=>{
      const opt=document.createElement('option'); opt.value=title; opt.textContent=title; sel.appendChild(opt);
    });
  }
  $("#roomSelect").innerHTML = '<option value="">단톡방 명을 선택하세요 ▼</option>';
  $('#nickInput').value = '';
  $("#nickList").innerHTML = '';
  roomCodes = [];
}
function fillRooms(courseTitle){
  const sel = $("#roomSelect");
  sel.innerHTML = '<option value="">단톡방 명을 선택하세요 ▼</option>';
  if(!courseTitle){
    roomCodes=[]; $('#nickInput').value=''; $("#nickList").innerHTML=''; return;
  }
  roomCodes = [...new Set(
    progressData.filter(r=>String(r.study_group_title).trim()===courseTitle)
                .map(r=>r.opentalk_code).filter(Boolean)
  )].sort((a,b)=>a.localeCompare(b,'ko'));
  roomCodes.forEach(code=>{
    const opt=document.createElement('option'); opt.value=code; opt.textContent=roomLabelFromCode(code); sel.appendChild(opt);
  });
  $('#nickInput').value=''; $("#nickList").innerHTML='';
}
function fillNicknames(opentalkCode){
  const ndl=$("#nickList"); ndl.innerHTML='';
  if(!opentalkCode) return;
  const fromProgress = progressData.filter(r=>r.opentalk_code===opentalkCode).map(r=>String(r.nickname||'').trim()).filter(Boolean);
  const nickSet = new Set(fromProgress);
  const fromCertOnly = certData
    .filter(r=>r.opentalk_code===opentalkCode && !nickSet.has(String(r.nickname||r.name||'').trim()))
    .map(r=>String((r.nickname||r.name||'')).trim()).filter(Boolean);
  const options=[...nickSet, ...new Set(fromCertOnly)].sort((a,b)=>a.localeCompare(b,'ko'));
  options.forEach(v=>{ const o=document.createElement('option'); o.value=v; ndl.appendChild(o); });
}

/* =========================
 * [모듈] 렌더
 * ========================= */
function updateChartTitle(code, nick){
  const el=$('#chartTitle'); if(!el) return;
  const course=getSelectedCourseTitle();
  const roomTxt=code?`[${roomLabelFromCode(code)}]`:''; const courseTxt=course?`[${course}]`:'';
  if(code && nick) el.textContent = `${courseTxt}${roomTxt} ${nick}님의 진도율(%)`;
  else if(code) el.textContent = `${courseTxt}${roomTxt} 진도율(%)`;
  else if(course) el.textContent = `${courseTxt} 진도율(%)`;
  else el.textContent = '진도율(%)';
}
function renderChart(code, nick){
  if(!(code && nick)){ ensureChart([],[]); return; }
  const rows = progressData
    .filter(r=>r.opentalk_code===code && String(r.nickname||'').trim()===(nick||'').trim())
    .map(r=>({d:String(r.progress_date).slice(0,10), v:Number.parseFloat(r.progress)}))
    .filter(x=>x.d && Number.isFinite(x.v))
    .sort((a,b)=>a.d.localeCompare(b.d));
  ensureChart(rows.map(x=>fmtDateLabel(x.d)), rows.map(x=>x.v));
}
function renderTable(code){
  const tb=$("#certTbody"); tb.innerHTML='';
  $("#certCount").textContent='';
  if(!code) return;
  const all = certData.filter(r=>r.opentalk_code===code);
  const top = all.slice().sort((a,b)=>(a.user_rank??9999)-(b.user_rank??9999)).slice(0,20);
  top.forEach(r=>{
    const rank=r.user_rank??'';
    const cls = rank==1?'rank-1':rank==2?'rank-2':rank==3?'rank-3':'';
    const displayName = (r.nickname && r.nickname.trim()) ? r.nickname.trim()
                       : (r.name && r.name.trim()) ? r.name.trim() : '';
    const avg = (r.average_week!=null && r.average_week!=='') ? Number.parseFloat(r.average_week).toFixed(1) : '';
    const tr=document.createElement('tr');
    tr.innerHTML = `<td class="${cls}">${rank}</td><td>${displayName}</td><td>${r.cert_days_count??''}</td><td>${avg}</td>`;
    tb.appendChild(tr);
  });
  $("#certCount").textContent = `[${roomLabelFromCode(code)}] 총 ${all.length}명 중 상위 20명`;
}

/* =========================
 * [모듈] 이벤트 바인딩(개인 조회)
 * ========================= */
function bindEvents(){
  $('#courseSelect').addEventListener('change', ()=>{
    const course=getSelectedCourseTitle();
    fillRooms(course);
    updateChartTitle(null, ($('#nickInput').value||'').trim());
  });
  $('#roomSelect').addEventListener('change', ()=>{
    const code=getSelectedRoomCode();
    fillNicknames(code);
    updateChartTitle(code, ($('#nickInput').value||'').trim());
  });
  $('#nickInput').addEventListener('input', ()=>{
    const code=getSelectedRoomCode();
    updateChartTitle(code, ($('#nickInput').value||'').trim());
  });
  $('#applyBtn').addEventListener('click', ()=>{
    const code=getSelectedRoomCode();
    const nick=($('#nickInput').value||'').trim();
    updateChartTitle(code, nick);
    renderChart(code, nick);
    renderTable(code);
  });
  let isComposing=false;
  $('#nickInput').addEventListener('compositionstart', ()=>isComposing=true);
  $('#nickInput').addEventListener('compositionend', ()=>isComposing=false);
  document.addEventListener('keydown', (e)=>{
    if(e.key!=='Enter') return;
    const a=document.activeElement; if(!a) return;
    if(a.id==='roomSelect' || (a.id==='nickInput' && !isComposing)){
      e.preventDefault(); $('#applyBtn').click();
    }
  });
  $('#nickInput').addEventListener('search', ()=>{
    updateChartTitle(getSelectedRoomCode(), '');
  });
}

/* =========================
 * [모듈] 로드/에러
 * ========================= */
function showLoadError(message){
  const box=$('#loadError');
  box.style.display='block';
  box.innerHTML=`${message} <button id="retryBtn" type="button" class="btn">다시 시도</button>`;
  $('#retryBtn').addEventListener('click', ()=>{
    box.style.display='none'; box.innerHTML=''; init();
  });
}
async function load(){
  const [p,c] = await Promise.all([
    fetch(progressUrl,{cache:'no-store'}),
    fetch(certUrl,{cache:'no-store'})
  ]);
  const pj = await p.json().catch(()=>({}));
  const cj = await c.json().catch(()=>({}));
  progressData = getProgressRows(pj);
  certData = getCertRows(cj);
  fillCourses();
  ensureChart([],[]);
  updateChartTitle(null,'');
  const shownAt = computeShownAt(pj, progressData);
  $('#updateTime').textContent = shownAt
    ? `최근 업데이트 시각 : ${shownAt.toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}`
    : '';
  if(courseTitles.length===0){
    $('#courseSelect').innerHTML = '<option value="">과정 데이터를 찾지 못했습니다</option>';
  }
}

/* =========================
 * [모듈] 탭 전환 (기본=전체)
 * ========================= */
/**
 * setTab
 * @param {'personal'|'all'} target
 * @param {NodeListOf<HTMLButtonElement>} buttons
 */
function setTab(target, buttons){
  buttons.forEach(b=>b.classList.remove('active'));
  const btn = Array.from(buttons).find(b=>b.dataset.tab===target);
  if(btn) btn.classList.add('active');
  const personal=document.getElementById('tabPersonal');
  const all=document.getElementById('tabAll');
  if(personal) personal.style.display = (target==='personal')?'block':'none';
  if(all) all.style.display = (target==='all')?'block':'none';
}
/** 탭 초기화 */
function initTabs(){
  const buttons = document.querySelectorAll('.tab-btn');
  if(!buttons.length) return;
  buttons.forEach(btn=>{
    btn.addEventListener('click', ()=> setTab(btn.dataset.tab, buttons));
  });
  // 초기: active가 붙어있는 버튼 기준으로 1회 동기화(기본=전체 조회)
  const activeBtn = document.querySelector('.tab-btn.active');
  setTab(activeBtn ? activeBtn.dataset.tab : 'all', buttons);
}

/* =========================
 * 부트스트랩
 * ========================= */
async function init(){
  try{
    initAuthOverlay();
    bindEvents();      // 개인 조회 이벤트
    await load();      // 데이터 로드
    initTabs();        // 탭 전환 초기화(기본 'all')
  }catch(e){
    console.error(e);
    showLoadError('데이터를 불러오지 못했습니다.');
  }
}
init();
