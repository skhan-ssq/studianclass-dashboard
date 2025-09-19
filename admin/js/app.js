// js/app.js — 빠른 개선 포인트 적용판
// [핵심 변경 요약]
// 1) 캐시 키 고정(BUILD_VERSION)로 교체
// 2) #courseSelect 중복 리스너 제거
// 3) 접근성: aria-live 적용, 에러 시 재시도 버튼 제공
// 4) 버튼 type="button"(HTML에서 지정) 전제
// 5) 최소 보안 고지: ACCESS_CODE는 클라이언트 노출(실보안 아님)

/* =========================
 * 상수/전역 (필요 최소한)
 * ========================= */
/** 배포 시 바꾸는 정적 캐시 키(주 1회 업데이트 정책에 맞춤) */
const BUILD_VERSION = '2025-09-19';
/** 데이터 경로(고정 버전 파라미터 사용) */
const progressUrl = `data/study_progress.json?v=${BUILD_VERSION}`;
const certUrl = `data/study_cert.json?v=${BUILD_VERSION}`;
/** 인증 코드(클라이언트 하드코딩은 보안 아님! 서버 검증 권장) */
const ACCESS_CODE = '1234';

/** Chart.js 인스턴스 */
let chart = null;
/** 데이터 저장소 */
let progressData = [];
let certData = [];
/** 선택 목록 캐시 */
let courseTitles = [];
let roomCodes = [];

/** DOM 헬퍼 */
const $ = (s) => document.querySelector(s);

/* =========================
 * 인증 오버레이
 * ========================= */
/** 인증 초기화: 버튼/엔터 입력 처리 */
function initAuthOverlay() {
  $('#authBtn').addEventListener('click', onAuthSubmit);
  $('#authInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onAuthSubmit();
  });
}
/** 인증 제출 핸들러 */
function onAuthSubmit() {
  const val = String($('#authInput').value || '').trim();
  if (val === ACCESS_CODE) {
    $('#authOverlay').style.display = 'none';
  } else {
    const msg = $('#authMsg');
    msg.style.display = 'block';
    msg.textContent = '코드가 올바르지 않습니다.';
  }
}

/* =========================
 * 유틸리티
 * ========================= */
/** progress JSON에서 rows 추출(포맷 이중 대응) */
function getProgressRows(pj) {
  if (pj && Array.isArray(pj.rows)) return pj.rows;
  if (pj && Array.isArray(pj.json_study_user_progress)) return pj.json_study_user_progress;
  return [];
}
/** cert JSON에서 rows 추출(포맷 이중 대응) */
function getCertRows(cj) {
  if (cj && Array.isArray(cj.rows)) return cj.rows;
  if (cj && Array.isArray(cj.json_study_cert)) return cj.json_study_cert;
  return [];
}
/** 페이지에 표시할 업데이트 시각 결정 */
function computeShownAt(pj, rows) {
  const ga = pj && pj.generated_at ? new Date(pj.generated_at) : null;
  if (ga && !Number.isNaN(ga)) return ga;
  let m = null;
  for (const r of rows) {
    const d = r?.progress_date ? new Date(String(r.progress_date)) : null;
    if (d && !Number.isNaN(d)) m = !m || d > m ? d : m;
  }
  return m;
}
/** YYMM코드 → 라벨 */
function roomLabelFromCode(code) {
  if (!code) return '';
  const m = String(code).match(/^(\d{2})(\d{2})(.+)$/); // YY MM KEY
  if (!m) return code;
  const [, yy, mm] = m;
  return `${yy}년 ${mm}월 단톡방`;
}
/** 현재 선택된 방 코드 얻기 */
function getSelectedRoomCode() {
  const sel = $('#roomSelect');
  return sel && sel.value ? sel.value : null;
}
/** MM/DD(요일) 포맷 */
function fmtDateLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const w = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}(${w})`;
}
/** 선택된 과정명 얻기 */
function getSelectedCourseTitle() {
  const sel = $('#courseSelect');
  return sel && sel.value ? sel.value : null;
}

/* =========================
 * 차트
 * ========================= */
/** 라인 차트 생성/갱신(파괴-재생성) */
function ensureChart(labels, data) {
  const ctx = document.getElementById('progressChart').getContext('2d');
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: '진도율', data, pointRadius: 2, tension: 0.2 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: { y: { beginAtZero: true, min: 0, max: 100 } }
    }
  });
}

/* =========================
 * 드롭다운/목록
 * ========================= */
/** 과정명 목록 채우기 */
function fillCourses() {
  courseTitles = [...new Set(
    progressData.map((r) => String(r.study_group_title || '').trim()).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'ko'));
  const sel = $('#courseSelect');
  sel.innerHTML = '<option value="">과정 명을 선택하세요 ▼</option>';
  courseTitles.forEach((title) => {
    const opt = document.createElement('option');
    opt.value = title;
    opt.textContent = title;
    sel.appendChild(opt);
  });
  // 하위 초기화
  $('#roomSelect').innerHTML = '<option value="">단톡방 명을 선택하세요 ▼</option>';
  $('#nickInput').value = '';
  $('#nickList').innerHTML = '';
  roomCodes = [];
}
/** 선택한 과정명 기준 방 목록 채우기 */
function fillRooms(courseTitle) {
  const sel = $('#roomSelect');
  sel.innerHTML = '<option value="">단톡방 명을 선택하세요 ▼</option>';
  if (!courseTitle) {
    roomCodes = [];
    $('#nickInput').value = '';
    $('#nickList').innerHTML = '';
    return;
  }
  roomCodes = [...new Set(
    progressData.filter((r) => String(r.study_group_title).trim() === courseTitle)
      .map((r) => r.opentalk_code).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'ko'));
  roomCodes.forEach((code) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = roomLabelFromCode(code);
    sel.appendChild(opt);
  });
  // 닉네임 초기화
  $('#nickInput').value = '';
  $('#nickList').innerHTML = '';
}
/** 방 기준 닉네임 목록 채우기(Progress + Cert 보강) */
function fillNicknames(opentalkCode) {
  const ndl = $('#nickList');
  ndl.innerHTML = '';
  if (!opentalkCode) return;

  const fromProgress = progressData
    .filter((r) => r.opentalk_code === opentalkCode)
    .map((r) => String(r.nickname || '').trim())
    .filter(Boolean);

  const nickSet = new Set(fromProgress);

  const fromCertOnly = certData
    .filter((r) => r.opentalk_code === opentalkCode && !nickSet.has(String(r.nickname || r.name || '').trim()))
    .map((r) => String((r.nickname || r.name || '')).trim())
    .filter(Boolean);

  const options = [...nickSet, ...new Set(fromCertOnly)].sort((a, b) => a.localeCompare(b, 'ko'));
  options.forEach((v) => {
    const o = document.createElement('option');
    o.value = v;
    ndl.appendChild(o);
  });
}

/* =========================
 * 렌더
 * ========================= */
/** 차트 타이틀 갱신 */
function updateChartTitle(code, nick) {
  const el = $('#chartTitle');
  if (!el) return;
  const course = getSelectedCourseTitle();
  const roomTxt = code ? `[${roomLabelFromCode(code)}]` : '';
  const courseTxt = course ? `[${course}]` : '';
  if (code && nick) el.textContent = `${courseTxt}${roomTxt} ${nick}님의 진도율(%)`;
  else if (code) el.textContent = `${courseTxt}${roomTxt} 진도율(%)`;
  else if (course) el.textContent = `${courseTxt} 진도율(%)`;
  else el.textContent = '진도율(%)';
}
/** 선택된 방/닉 기준 차트 렌더 */
function renderChart(code, nick) {
  if (!(code && nick)) {
    ensureChart([], []);
    return;
  }
  const rows = progressData
    .filter((r) => r.opentalk_code === code && String(r.nickname || '').trim() === (nick || '').trim())
    .map((r) => ({ d: String(r.progress_date).slice(0, 10), v: Number.parseFloat(r.progress) }))
    .filter((x) => x.d && Number.isFinite(x.v))
    .sort((a, b) => a.d.localeCompare(b.d));
  ensureChart(rows.map((x) => fmtDateLabel(x.d)), rows.map((x) => x.v));
}
/** 인증 상위 20명 표 렌더 */
function renderTable(code) {
  const tb = $('#certTbody');
  tb.innerHTML = '';
  $('#certCount').textContent = '';
  if (!code) return;

  const all = certData.filter((r) => r.opentalk_code === code);
  const top = all.slice().sort((a, b) => (a.user_rank ?? 9999) - (b.user_rank ?? 9999)).slice(0, 20);

  top.forEach((r) => {
    const rank = r.user_rank ?? '';
    const cls = rank == 1 ? 'rank-1' : rank == 2 ? 'rank-2' : rank == 3 ? 'rank-3' : '';
    const displayName = (r.nickname && r.nickname.trim()) ? r.nickname.trim()
      : (r.name && r.name.trim()) ? r.name.trim() : '';
    const avg = (r.average_week != null && r.average_week !== '')
      ? Number.parseFloat(r.average_week).toFixed(1) : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="${cls}">${rank}</td><td>${displayName}</td><td>${r.cert_days_count ?? ''}</td><td>${avg}</td>`;
    tb.appendChild(tr);
  });

  $('#certCount').textContent = `[${roomLabelFromCode(code)}] 총 ${all.length}명 중 상위 20명`;
}

/* =========================
 * 이벤트 바인딩
 * ========================= */
function bindEvents() {
  // 과정 변경 → 방 갱신, 타이틀 갱신
  $('#courseSelect').addEventListener('change', () => {
    const course = getSelectedCourseTitle();
    fillRooms(course);
    updateChartTitle(null, ($('#nickInput').value || '').trim());
  });

  // 방 변경 → 닉네임 갱신, 타이틀 갱신
  $('#roomSelect').addEventListener('change', () => {
    const code = getSelectedRoomCode();
    fillNicknames(code);
    updateChartTitle(code, ($('#nickInput').value || '').trim());
  });

  // 닉네임 입력 → 타이틀만 갱신
  $('#nickInput').addEventListener('input', () => {
    const code = getSelectedRoomCode();
    updateChartTitle(code, ($('#nickInput').value || '').trim());
  });

  // 적용 버튼 → 차트/표 렌더
  $('#applyBtn').addEventListener('click', () => {
    const code = getSelectedRoomCode();
    const nick = ($('#nickInput').value || '').trim();
    updateChartTitle(code, nick);
    renderChart(code, nick);
    renderTable(code);
  });

  // IME 조합 상태 플래그
  let isComposing = false;
  $('#nickInput').addEventListener('compositionstart', () => (isComposing = true));
  $('#nickInput').addEventListener('compositionend', () => (isComposing = false));

  // Enter → 적용(방 select, 닉 input만)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const a = document.activeElement;
    if (!a) return;
    if (a.id === 'roomSelect' || (a.id === 'nickInput' && !isComposing)) {
      e.preventDefault();
      $('#applyBtn').click();
    }
  });

  // 닉네임 검색 X 클릭 후 타이틀 초기화
  $('#nickInput').addEventListener('search', () => {
    updateChartTitle(getSelectedRoomCode(), '');
  });
}

/* =========================
 * 데이터 로드 + 에러 처리
 * ========================= */
/** 로드 에러 표시 및 재시도 버튼 렌더 */
function showLoadError(message) {
  const box = $('#loadError');
  box.style.display = 'block';
  box.innerHTML = `${message} <button id="retryBtn" type="button" class="btn">다시 시도</button>`;
  $('#retryBtn').addEventListener('click', () => {
    box.style.display = 'none';
    box.innerHTML = '';
    init(); // 전체 재시작
  });
}
/** 초기 데이터 로드 */
async function load() {
  const [p, c] = await Promise.all([
    fetch(progressUrl, { cache: 'no-store' }),
    fetch(certUrl, { cache: 'no-store' })
  ]);
  const pj = await p.json().catch(() => ({}));
  const cj = await c.json().catch(() => ({}));

  progressData = getProgressRows(pj);
  certData = getCertRows(cj);

  fillCourses();
  ensureChart([], []);
  updateChartTitle(null, '');

  const shownAt = computeShownAt(pj, progressData);
  $('#updateTime').textContent = shownAt
    ? `최근 업데이트 시각 : ${shownAt.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
    : '';

  if (courseTitles.length === 0) {
    $('#courseSelect').innerHTML = '<option value="">과정 데이터를 찾지 못했습니다</option>';
  }
}

/* =========================
 * 부트스트랩
 * ========================= */
async function init() {
  try {
    initAuthOverlay();
    bindEvents();
    await load();
  } catch (e) {
    console.error(e);
    showLoadError('데이터를 불러오지 못했습니다.');
  }
}
init();
