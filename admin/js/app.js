// admin/js/app.js — ADMIN 전용 (전체 조회 탭 강화)
/* =========================
 * 상수/전역
 * ========================= */
/** 배포 버전(캐시 키) */
const BUILD_VERSION = '2025-09-19';
/** 데이터 경로(관리자/고객 공통, 상대경로 주의) */
const progressUrl = `../data/study_progress.json?v=${BUILD_VERSION}`;
const certUrl = `../data/study_cert.json?v=${BUILD_VERSION}`;
const certDailyUrl = `../data/study_cert_daily.json?v=${BUILD_VERSION}`;
const opentalkStartUrl = `../data/opentalk_code_start.json?v=${BUILD_VERSION}`;
/** 단순 접근 코드(보안 아님 → 서버 보호 권장) */
const ACCESS_CODE = '1234';

/** 상태 보관 */
let chart = null;
let weeklyCertChart = null;
let weeklyProgressChart = null;
let progressData = [];
let certData = [];
let certDailyData = [];
let opentalkStartData = [];
let courseTitles = [];
let roomCodes = [];
let currentCalendarDate = new Date();
let selectedUserData = null;

/** DOM 헬퍼 */
const $ = (s) => document.querySelector(s);

/* =========================
 * [모듈] 인증 오버레이
 * ========================= */
/** 인증 초기화 */
function initAuthOverlay() {
  $('#authBtn').addEventListener('click', onAuthSubmit);
  $('#authInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') onAuthSubmit(); });
}

/** 인증 제출 */
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
 * [모듈] 데이터 유틸
 * ========================= */
function getProgressRows(pj) {
  if (pj && Array.isArray(pj.rows)) return pj.rows;
  if (pj && Array.isArray(pj.json_study_user_progress)) return pj.json_study_user_progress;
  return [];
}

function getCertRows(cj) {
  if (cj && Array.isArray(cj.rows)) return cj.rows;
  if (cj && Array.isArray(cj.json_study_cert)) return cj.json_study_cert;
  return [];
}

function computeShownAt(pj, rows) {
  const ga = pj && pj.generated_at ? new Date(pj.generated_at) : null;
  if (ga && !Number.isNaN(ga)) return ga;
  let m = null;
  for (const r of rows) {
    const d = r?.progress_date ? new Date(String(r.progress_date)) : null;
    if (d && !Number.isNaN(d)) m = (!m || d > m) ? d : m;
  }
  return m;
}

function roomLabelFromCode(code) {
  if (!code) return '';
  const m = String(code).match(/^(\d{2})(\d{2})(.+)$/);
  if (!m) return code;
  const [, yy, mm] = m;
  return `${yy}년 ${mm}월 단톡방`;
}

function getSelectedRoomCode() {
  const sel = $('#roomSelect');
  return sel && sel.value ? sel.value : null;
}

function fmtDateLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const w = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}(${w})`;
}

function getSelectedCourseTitle() {
  const sel = $('#courseSelect');
  return sel && sel.value ? sel.value : null;
}

/* =========================
 * [모듈] 전체 조회 - 통계 계산
 * ========================= */

/** 
 * 전체 단톡방 인원 수 계산 (가장 오래된 년월부터)
 */
function calculateTotalUsersFromStart() {
  if (certData.length === 0) return { count: 0, startPeriod: '' };
  
  // opentalk_code에서 가장 작은 년월 찾기
  const periods = certData.map(r => {
    const match = r.opentalk_code.match(/^(\d{2})(\d{2})/);
    if (match) {
      const [, yy, mm] = match;
      return `${yy}년 ${mm}월`;
    }
    return null;
  }).filter(Boolean);
  
  const sortedPeriods = [...new Set(periods)].sort();
  const startPeriod = sortedPeriods[0] || '';
  
  // 전체 사용자 수 (study_cert.json 기준)
  const totalCount = certData.length;
  
  return { count: totalCount, startPeriod };
}

/** 
 * 현재 운영중인 단톡방 인원 수 계산
 */
function calculateActiveGroupUsers() {
  if (opentalkStartData.length === 0 || certData.length === 0) return 0;
  
  // is_active가 1인 단톡방 목록
  const activeCodes = opentalkStartData
    .filter(g => g.is_active === 1)
    .map(g => g.opentalk_code);
  
  // 해당 단톡방들의 고객 수
  const activeUsers = certData.filter(r => activeCodes.includes(r.opentalk_code));
  
  return activeUsers.length;
}

/** 
 * 4주간의 주차별 기간 계산
 * @returns {Array} 각 주차의 시작일과 종료일 배열
 */
function getFourWeeksPeriods() {
  const today = new Date();
  const periods = [];
  
  for (let week = 3; week >= 0; week--) {
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - (week * 7) - 6); // 주 시작 (일요일)
    
    const weekEnd = new Date(today);
    weekEnd.setDate(today.getDate() - (week * 7)); // 주 끝 (토요일)
    
    periods.push({
      start: weekStart.toISOString().slice(0, 10),
      end: weekEnd.toISOString().slice(0, 10),
      label: `${week === 0 ? '이번주' : week + '주 전'}`
    });
  }
  
  return periods;
}

/** 
 * 주차별 N회 이상 인증한 고객 수 계산
 * @param {number} minCerts 최소 인증 횟수
 */
function calculateWeeklyCertStats(minCerts = 3) {
  const periods = getFourWeeksPeriods();
  const weeklyStats = [];
  
  periods.forEach((period, index) => {
    // 해당 주차의 인증 데이터 필터링
    const weekCerts = certDailyData.filter(r => 
      r.cert_date >= period.start && r.cert_date <= period.end
    );
    
    // 사용자별 해당 주 총 인증 횟수 계산
    const userCertCounts = {};
    weekCerts.forEach(r => {
      const key = `${r.opentalk_code}-${r.nickname || r.name}`;
      userCertCounts[key] = (userCertCounts[key] || 0) + (r.cert_count || 0);
    });
    
    // N회 이상 인증한 사용자 수
    const qualifiedUsers = Object.values(userCertCounts).filter(count => count >= minCerts).length;
    
    weeklyStats.push({
      week: index + 1,
      label: period.label,
      count: qualifiedUsers
    });
  });
  
  return weeklyStats;
}

/** 
 * 주차별 진도율 상승 고객 수 계산
 */
function calculateWeeklyProgressStats() {
  const periods = getFourWeeksPeriods();
  const weeklyStats = [];
  
  periods.forEach((period, index) => {
    let improvedUsers = 0;
    
    // 모든 사용자별로 해당 주의 진도율 변화 확인
    const userGroups = {};
    progressData.forEach(r => {
      const key = `${r.opentalk_code}-${r.nickname}`;
      if (!userGroups[key]) userGroups[key] = [];
      userGroups[key].push(r);
    });
    
    Object.values(userGroups).forEach(userProgress => {
      // 해당 주 기간의 진도 데이터만 필터링
      const weekProgress = userProgress.filter(r => 
        r.progress_date >= period.start && r.progress_date <= period.end
      ).sort((a, b) => a.progress_date.localeCompare(b.progress_date));
      
      if (weekProgress.length >= 2) {
        const startProgress = parseFloat(weekProgress[0].progress);
        const endProgress = parseFloat(weekProgress[weekProgress.length - 1].progress);
        
        // 1 이상 상승한 경우
        if (endProgress - startProgress >= 1) {
          improvedUsers++;
        }
      }
    });
    
    weeklyStats.push({
      week: index + 1,
      label: period.label,
      count: improvedUsers
    });
  });
  
  return weeklyStats;
}

/* =========================
 * [모듈] 전체 조회 - 차트 렌더링
 * ========================= */

/** 
 * 주차별 인증 고객 수 차트 렌더링
 */
function renderWeeklyCertChart() {
  const ctx = document.getElementById('weeklyCertChart')?.getContext?.('2d');
  if (!ctx) return;
  
  const minCerts = parseInt($('#minCertCount').value) || 3;
  const stats = calculateWeeklyCertStats(minCerts);
  
  if (weeklyCertChart) weeklyCertChart.destroy();
  
  weeklyCertChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: stats.map(s => s.label),
      datasets: [{
        label: `${minCerts}회 이상 인증 고객 수`,
        data: stats.map(s => s.count),
        backgroundColor: '#10b981',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: { 
          beginAtZero: true,
          ticks: { stepSize: 1 }
        }
      }
    }
  });
}

/** 
 * 주차별 진도율 상승 고객 수 차트 렌더링
 */
function renderWeeklyProgressChart() {
  const ctx = document.getElementById('weeklyProgressChart')?.getContext?.('2d');
  if (!ctx) return;
  
  const stats = calculateWeeklyProgressStats();
  
  if (weeklyProgressChart) weeklyProgressChart.destroy();
  
  weeklyProgressChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: stats.map(s => s.label),
      datasets: [{
        label: '진도율 상승 고객 수',
        data: stats.map(s => s.count),
        backgroundColor: '#3b82f6',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: { 
          beginAtZero: true,
          ticks: { stepSize: 1 }
        }
      }
    }
  });
}

/* =========================
 * [모듈] 전체 조회 - 4주간 데이터 계산
 * ========================= */

/** 
 * 4주간 평균 인증 수 계산 (단톡방 시작일 고려)
 * @param {string} opentalkCode 
 * @param {string} nickname 
 */
function calculate4WeekAvgCerts(opentalkCode, nickname) {
  const today = new Date();
  const fourWeeksAgo = new Date(today);
  fourWeeksAgo.setDate(today.getDate() - 28);
  
  // 단톡방 시작일 확인
  const groupInfo = opentalkStartData.find(g => g.opentalk_code === opentalkCode);
  let startDate = fourWeeksAgo;
  
  if (groupInfo) {
    const groupStartDate = new Date(groupInfo.opentalk_start_date);
    if (groupStartDate > fourWeeksAgo) {
      startDate = groupStartDate;
    }
  }
  
  // 해당 기간의 인증 데이터
  const userCerts = certDailyData.filter(r => 
    r.opentalk_code === opentalkCode &&
    (r.nickname || r.name) === nickname &&
    r.cert_date >= startDate.toISOString().slice(0, 10) &&
    r.cert_date <= today.toISOString().slice(0, 10)
  );
  
  // 총 인증 횟수
  const totalCerts = userCerts.reduce((sum, r) => sum + (r.cert_count || 0), 0);
  
  // 실제 경과 일수
  const daysDiff = Math.ceil((today - startDate) / (1000 * 60 * 60 * 24));
  const actualDays = Math.min(daysDiff, 28);
  
  // 평균 = 총 인증 횟수 / 28일 (또는 실제 경과 일수)
  return actualDays > 0 ? totalCerts / actualDays * 7 : 0; // 주간 평균으로 환산
}

/** 
 * 4주간 진도율 상승폭 계산
 * @param {string} opentalkCode 
 * @param {string} nickname 
 */
function calculate4WeekProgressGrowth(opentalkCode, nickname) {
  const today = new Date();
  const fourWeeksAgo = new Date(today);
  fourWeeksAgo.setDate(today.getDate() - 28);
  
  // 단톡방 시작일 확인
  const groupInfo = opentalkStartData.find(g => g.opentalk_code === opentalkCode);
  let startDate = fourWeeksAgo;
  
  if (groupInfo) {
    const groupStartDate = new Date(groupInfo.opentalk_start_date);
    if (groupStartDate > fourWeeksAgo) {
      startDate = groupStartDate;
    }
  }
  
  // 해당 사용자의 진도 데이터
  const userProgress = progressData.filter(r => 
    r.opentalk_code === opentalkCode &&
    r.nickname === nickname
  ).sort((a, b) => a.progress_date.localeCompare(b.progress_date));
  
  if (userProgress.length === 0) return { current: 0, growth: 0 };
  
  // 현재 진도율 (최신 데이터)
  const currentProgress = parseFloat(userProgress[userProgress.length - 1].progress);
  
  // 시작일 근처의 진도율 찾기
  const startDateStr = startDate.toISOString().slice(0, 10);
  const startProgress = userProgress.find(r => r.progress_date >= startDateStr);
  
  if (!startProgress) {
    return { current: currentProgress, growth: 0 };
  }
  
  const initialProgress = parseFloat(startProgress.progress);
  const growth = currentProgress - initialProgress;
  
  return { 
    current: currentProgress, 
    growth: growth > 0 ? growth : 0 // 상승분만 표시
  };
}

/* =========================
 * [모듈] 전체 조회 - 드롭다운 및 테이블
 * ========================= */

/** 
 * 전체 조회용 드롭다운 채우기
 */
function fillAllQueryDropdowns() {
  // 과정별 드롭다운
  const allCourseSelects = ['#allCourseSelect', '#allCourseSelectForRoom'];
  allCourseSelects.forEach(selector => {
    const sel = $(selector);
    if (sel) {
      sel.innerHTML = '<option value="">전체 과정</option>';
      courseTitles.forEach(title => {
        const opt = document.createElement('option');
        opt.value = title;
        opt.textContent = title;
        sel.appendChild(opt);
      });
    }
  });
}

/** 
 * 과정별 단톡방 드롭다운 채우기
 */
function fillAllRoomDropdown(courseTitle) {
  const sel = $('#allRoomSelect');
  if (!sel) return;
  
  sel.innerHTML = '<option value="">단톡방 선택</option>';
  if (!courseTitle) return;
  
  const rooms = [...new Set(
    progressData.filter(r => r.study_group_title === courseTitle)
      .map(r => r.opentalk_code)
  )].sort();
  
  rooms.forEach(code => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = roomLabelFromCode(code);
    sel.appendChild(opt);
  });
}

/** 
 * 과정별 인증 테이블 렌더링
 */
function renderCourseCertTable(courseTitle = '') {
  const tbody = $('#courseCertTable');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  // 해당 과정의 모든 사용자
  let targetUsers = certData;
  if (courseTitle) {
    const courseRooms = progressData
      .filter(r => r.study_group_title === courseTitle)
      .map(r => r.opentalk_code);
    targetUsers = certData.filter(r => courseRooms.includes(r.opentalk_code));
  }
  
  // 4주 평균 인증 수 계산 후 정렬
  const userStats = targetUsers.map(user => {
    const avgCerts = calculate4WeekAvgCerts(user.opentalk_code, user.nickname);
    return {
      opentalk_code: user.opentalk_code,
      nickname: user.nickname,
      avgCerts: avgCerts
    };
  }).filter(u => u.avgCerts > 0)
    .sort((a, b) => b.avgCerts - a.avgCerts);
  
  userStats.forEach(user => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${roomLabelFromCode(user.opentalk_code)}</td>
      <td>${user.nickname}</td>
      <td>${user.avgCerts.toFixed(1)}</td>
    `;
    tbody.appendChild(tr);
  });
}

/** 
 * 과정별 진도율 테이블 렌더링
 */
function renderCourseProgressTable(courseTitle = '') {
  const tbody = $('#courseProgressTable');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  
  // 해당 과정의 모든 사용자
  let targetUsers = certData;
  if (courseTitle) {
    const courseRooms = progressData
      .filter(r => r.study_group_title === courseTitle)
      .map(r => r.opentalk_code);
    targetUsers = certData.filter(r => courseRooms.includes(r.opentalk_code));
  }
  
  // 4주 진도율 상승 계산 후 정렬
  const userStats = targetUsers.map(user => {
    const progressInfo = calculate4WeekProgressGrowth(user.opentalk_code, user.nickname);
    return {
      opentalk_code: user.opentalk_code,
      nickname: user.nickname,
      current: progressInfo.current,
      growth: progressInfo.growth
    };
  }).filter(u => u.growth > 0) // 상승한 사용자만
    .sort((a, b) => b.growth - a.growth);
  
  userStats.forEach(user => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${roomLabelFromCode(user.opentalk_code)}</td>
      <td>${user.nickname}</td>
      <td>${user.current.toFixed(1)}%</td>
      <td>+${user.growth.toFixed(1)}</td>
    `;
    tbody.appendChild(tr);
  });
}

/** 
 * 단톡방별 인증 테이블 렌더링
 */
function renderRoomCertTable(opentalkCode) {
  const tbody = $('#roomCertTable');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  if (!opentalkCode) return;
  
  // 해당 단톡방의 사용자들
  const roomUsers = certData.filter(r => r.opentalk_code === opentalkCode);
  
  // 4주 평균 인증 수 계산 후 정렬
  const userStats = roomUsers.map(user => {
    const avgCerts = calculate4WeekAvgCerts(user.opentalk_code, user.nickname);
    return {
      nickname: user.nickname,
      avgCerts: avgCerts
    };
  }).filter(u => u.avgCerts > 0)
    .sort((a, b) => b.avgCerts - a.avgCerts);
  
  userStats.forEach(user => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${user.nickname}</td>
      <td>${user.avgCerts.toFixed(1)}</td>
    `;
    tbody.appendChild(tr);
  });
}

/** 
 * 단톡방별 진도율 테이블 렌더링
 */
function renderRoomProgressTable(opentalkCode) {
  const tbody = $('#roomProgressTable');
  if (!tbody) return;
  
  tbody.innerHTML = '';
  if (!opentalkCode) return;
  
  // 해당 단톡방의 사용자들
  const roomUsers = certData.filter(r => r.opentalk_code === opentalkCode);
  
  // 4주 진도율 상승 계산 후 정렬
  const userStats = roomUsers.map(user => {
    const progressInfo = calculate4WeekProgressGrowth(user.opentalk_code, user.nickname);
    return {
      nickname: user.nickname,
      current: progressInfo.current,
      growth: progressInfo.growth
    };
  }).filter(u => u.growth > 0) // 상승한 사용자만
    .sort((a, b) => b.growth - a.growth);
  
  userStats.forEach(user => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${user.nickname}</td>
      <td>${user.current.toFixed(1)}%</td>
      <td>+${user.growth.toFixed(1)}</td>
    `;
    tbody.appendChild(tr);
  });
}

/* =========================
 * [모듈] 전체 조회 - 기간 조회
 * ========================= */

/** 
 * 기간별 평균 인증 수 계산
 */
function calculatePeriodAvgCerts(opentalkCode, nickname, startDate, endDate) {
  const userCerts = certDailyData.filter(r => 
    r.opentalk_code === opentalkCode &&
    (r.nickname || r.name) === nickname &&
    r.cert_date >= startDate &&
    r.cert_date <= endDate
  );
  
  const totalCerts = userCerts.reduce((sum, r) => sum + (r.cert_count || 0), 0);
  const daysDiff = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24)) + 1;
  const weeksDiff = daysDiff / 7;
  
  return weeksDiff > 0 ? totalCerts / weeksDiff : 0;
}

/** 
 * 기간별 진도율 상승 계산
 */
function calculatePeriodProgressGrowth(opentalkCode, nickname, startDate, endDate) {
  const userProgress = progressData.filter(r => 
    r.opentalk_code === opentalkCode &&
    r.nickname === nickname &&
    r.progress_date >= startDate &&
    r.progress_date <= endDate
  ).sort((a, b) => a.progress_date.localeCompare(b.progress_date));
  
  if (userProgress.length < 2) return { current: 0, growth: 0 };
  
  const startProgress = parseFloat(userProgress[0].progress);
  const endProgress = parseFloat(userProgress[userProgress.length - 1].progress);
  const growth = endProgress - startProgress;
  
  return { 
    current: endProgress, 
    growth: growth > 0 ? growth : 0 
  };
}

/** 
 * 기간 조회 테이블 렌더링
 */
function renderPeriodTables(startDate, endDate) {
  // 인증 테이블
  const certTbody = $('#periodCertTable');
  if (certTbody) {
    certTbody.innerHTML = '';
    
    const certStats = certData.map(user => ({
      opentalk_code: user.opentalk_code,
      nickname: user.nickname,
      avgCerts: calculatePeriodAvgCerts(user.opentalk_code, user.nickname, startDate, endDate)
    })).filter(u => u.avgCerts > 0)
      .sort((a, b) => b.avgCerts - a.avgCerts);
    
    certStats.forEach(user => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${roomLabelFromCode(user.opentalk_code)}</td>
        <td>${user.nickname}</td>
        <td>${user.avgCerts.toFixed(1)}</td>
      `;
      certTbody.appendChild(tr);
    });
  }
  
  // 진도율 테이블
  const progressTbody = $('#periodProgressTable');
  if (progressTbody) {
    progressTbody.innerHTML = '';
    
    const progressStats = certData.map(user => {
      const progressInfo = calculatePeriodProgressGrowth(user.opentalk_code, user.nickname, startDate, endDate);
      return {
        opentalk_code: user.opentalk_code,
        nickname: user.nickname,
        current: progressInfo.current,
        growth: progressInfo.growth
      };
    }).filter(u => u.growth > 0)
      .sort((a, b) => b.growth - a.growth);
    
    progressStats.forEach(user => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${roomLabelFromCode(user.opentalk_code)}</td>
        <td>${user.nickname}</td>
        <td>${user.current.toFixed(1)}%</td>
        <td>+${user.growth.toFixed(1)}</td>
      `;
      progressTbody.appendChild(tr);
    });
  }
}

/* =========================
 * [모듈] 전체 조회 - 통계 렌더링
 * ========================= */

/** 
 * 대시보드 통계 렌더링
 */
function renderDashboardStats() {
  // 전체 단톡방 인원 수
  const totalStats = calculateTotalUsersFromStart();
  $('#totalUsersFromStart').textContent = totalStats.count.toLocaleString();
  $('#totalUsersLabel').textContent = `전체 단톡방 인원 수 (${totalStats.startPeriod}부터)`;
  
  // 현재 운영중인 단톡방 인원 수
  $('#activeGroupUsers').textContent = calculateActiveGroupUsers().toLocaleString();
  
  // 차트 렌더링
  renderWeeklyCertChart();
  renderWeeklyProgressChart();
}

/* =========================
 * [모듈] 개인 조회 - 차트
 * ========================= */
function ensureChart(labels, data) {
  const ctx = document.getElementById('progressChart')?.getContext?.('2d');
  if (!ctx) return;
  if (chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets: [{ label: '진도율', data, pointRadius: 2, tension: 0.2 }] },
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: { beginAtZero: true, min: 0, max: 100 } } }
  });
}

/* =========================
 * [모듈] 개인 조회 - 드롭다운/목록
 * ========================= */
function fillCourses() {
  courseTitles = [...new Set(
    progressData.map(r => String(r.study_group_title || '').trim()).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'ko'));
  const sel = $("#courseSelect");
  if (sel) {
    sel.innerHTML = '<option value="">과정 명을 선택하세요 ▼</option>';
    courseTitles.forEach(title => {
      const opt = document.createElement('option'); opt.value = title; opt.textContent = title; sel.appendChild(opt);
    });
  }
  $("#roomSelect").innerHTML = '<option value="">단톡방 명을 선택하세요 ▼</option>';
  $('#nickInput').value = '';
  $("#nickList").innerHTML = '';
  roomCodes = [];
}

function fillRooms(courseTitle) {
  const sel = $("#roomSelect");
  sel.innerHTML = '<option value="">단톡방 명을 선택하세요 ▼</option>';
  if (!courseTitle) {
    roomCodes = []; $('#nickInput').value = ''; $("#nickList").innerHTML = ''; return;
  }
  roomCodes = [...new Set(
    progressData.filter(r => String(r.study_group_title).trim() === courseTitle)
      .map(r => r.opentalk_code).filter(Boolean)
  )].sort((a, b) => a.localeCompare(b, 'ko'));
  roomCodes.forEach(code => {
    const opt = document.createElement('option'); opt.value = code; opt.textContent = roomLabelFromCode(code); sel.appendChild(opt);
  });
  $('#nickInput').value = ''; $("#nickList").innerHTML = '';
}

function fillNicknames(opentalkCode) {
  const ndl = $("#nickList"); ndl.innerHTML = '';
  if (!opentalkCode) return;
  const fromProgress = progressData.filter(r => r.opentalk_code === opentalkCode).map(r => String(r.nickname || '').trim()).filter(Boolean);
  const nickSet = new Set(fromProgress);
  const fromCertOnly = certData
    .filter(r => r.opentalk_code === opentalkCode && !nickSet.has(String(r.nickname || r.name || '').trim()))
    .map(r => String((r.nickname || r.name || '')).trim()).filter(Boolean);
  const options = [...nickSet, ...new Set(fromCertOnly)].sort((a, b) => a.localeCompare(b, 'ko'));
  options.forEach(v => { const o = document.createElement('option'); o.value = v; ndl.appendChild(o); });
}

/* =========================
 * [모듈] 개인 조회 - 달력
 * ========================= */
function initCalendar() {
  $('#prevMonthBtn').addEventListener('click', () => {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() - 1);
    renderCalendar();
  });
  
  $('#nextMonthBtn').addEventListener('click', () => {
    currentCalendarDate.setMonth(currentCalendarDate.getMonth() + 1);
    renderCalendar();
  });
}

function setCalendarToStartMonth() {
  const code = getSelectedRoomCode();
  if (!code) return;
  
  // opentalk_code_start.json에서 실제 시작일 찾기
  const groupInfo = opentalkStartData.find(g => g.opentalk_code === code);
  if (groupInfo && groupInfo.opentalk_start_date) {
    const startDate = new Date(groupInfo.opentalk_start_date);
    currentCalendarDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    renderCalendar();
    return;
  }
  
  // 메타데이터가 없으면 기존 방식으로 fallback
  const match = code.match(/^(\d{2})(\d{2})/);
  if (match) {
    const [, yy, mm] = match;
    const year = 2000 + parseInt(yy);
    const month = parseInt(mm) - 1;
    currentCalendarDate = new Date(year, month, 1);
    renderCalendar();
  }
}

function getGroupInfo(opentalkCode) {
  return opentalkStartData.find(g => g.opentalk_code === opentalkCode);
}

function isDateInRange(dateStr, opentalkCode) {
  const groupInfo = getGroupInfo(opentalkCode);
  if (!groupInfo) return true; // 정보가 없으면 모든 날짜 허용
  
  const checkDate = new Date(dateStr);
  const startDate = new Date(groupInfo.opentalk_start_date);
  const endDate = new Date(groupInfo.opentalk_end_date);
  
  return checkDate >= startDate && checkDate <= endDate;
}

function renderCalendar() {
  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  
  $('#calendarTitle').textContent = `${year}년 ${month + 1}월`;
  
  // 단톡방 정보 업데이트
  updateCalendarStatus();
  
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const firstDayOfWeek = (firstDay.getDay() + 6) % 7; // 월요일을 0으로
  
  let calendarHTML = '';
  let date = 1;
  
  // 이전 달 날짜들
  const prevMonthLastDay = new Date(year, month, 0).getDate();
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const day = prevMonthLastDay - i;
    calendarHTML += `<div class="calendar-day other-month">
      <div class="calendar-day-number">${day}</div>
    </div>`;
  }
  
  // 현재 달 날짜들
  while (date <= lastDay.getDate()) {
    const currentDate = new Date(year, month, date);
    const today = new Date();
    const isToday = currentDate.toDateString() === today.toDateString();
    
    const dateStr = currentDate.toISOString().slice(0, 10);
    const activity = getUserActivity(dateStr);
    
    // 단톡방 운영 기간 확인
    const code = getSelectedRoomCode();
    const isInRange = code ? isDateInRange(dateStr, code) : false;
    const isOutOfRange = code && !isInRange;
    
    let indicators = '';
    if (!isOutOfRange && activity.cert && activity.progress) {
      indicators = '<div class="calendar-dot both"></div>';
    } else if (!isOutOfRange && activity.cert) {
      indicators = '<div class="calendar-dot cert"></div>';
    } else if (!isOutOfRange && activity.progress) {
      indicators = '<div class="calendar-dot progress"></div>';
    }
    
    const outOfRangeClass = isOutOfRange ? 'out-of-range' : '';
    
    calendarHTML += `<div class="calendar-day ${isToday ? 'today' : ''} ${outOfRangeClass}">
      <div class="calendar-day-number">${date}</div>
      <div class="calendar-indicators">${indicators}</div>
    </div>`;
    
    date++;
  }
  
  // 다음 달 날짜들로 그리드 채우기
  const remainingCells = 42 - (firstDayOfWeek + lastDay.getDate());
  for (let date = 1; date <= remainingCells; date++) {
    calendarHTML += `<div class="calendar-day other-month">
      <div class="calendar-day-number">${date}</div>
    </div>`;
  }
  
  $('#calendarDays').innerHTML = calendarHTML;
}

function updateCalendarStatus() {
  const code = getSelectedRoomCode();
  const nick = ($('#nickInput').value || '').trim();
  
  let statusText = '';
  let cardTitle = '학습 활동 달력';
  
  if (code && nick) {
    const groupInfo = getGroupInfo(code);
    if (groupInfo) {
      const isActive = groupInfo.is_active === 1;
      const statusLabel = isActive ? '진행중' : '종료';
      const endDate = new Date(groupInfo.opentalk_end_date);
      const today = new Date();
      
      // 종료일 체크
      let realStatus = statusLabel;
      if (isActive && today > endDate) {
        realStatus = '종료 (기간 만료)';
      }
      
      statusText = `${groupInfo.opentalk_start_date} ~ ${groupInfo.opentalk_end_date} (${realStatus})`;
      cardTitle = `${nick}님의 학습 활동 달력`;
    }
  }
  
  $('#calendarStatus').textContent = statusText;
  $('#calendarCardTitle').textContent = cardTitle;
}

function getUserActivity(dateStr) {
  if (!selectedUserData) return { cert: false, progress: false };
  
  const code = getSelectedRoomCode();
  const nick = ($('#nickInput').value || '').trim();
  
  // 인증 확인
  const hasCert = certDailyData.some(r => 
    r.opentalk_code === code && 
    (r.nickname || r.name || '').trim() === nick &&
    r.cert_date === dateStr &&
    r.cert_count > 0
  );
  
  // 진도 확인
  const hasProgress = progressData.some(r => 
    r.opentalk_code === code && 
    (r.nickname || '').trim() === nick &&
    r.progress_date === dateStr &&
    parseFloat(r.progress) > 0
  );
  
  return { cert: hasCert, progress: hasProgress };
}

/* =========================
 * [모듈] 개인 조회 - 렌더
 * ========================= */
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

function renderChart(code, nick) {
  if (!(code && nick)) { ensureChart([], []); return; }
  const rows = progressData
    .filter(r => r.opentalk_code === code && String(r.nickname || '').trim() === (nick || '').trim())
    .map(r => ({ d: String(r.progress_date).slice(0, 10), v: Number.parseFloat(r.progress) }))
    .filter(x => x.d && Number.isFinite(x.v))
    .sort((a, b) => a.d.localeCompare(b.d));
  ensureChart(rows.map(x => fmtDateLabel(x.d)), rows.map(x => x.v));
}

function renderTable(code) {
  const tb = $("#certTbody");
  tb.innerHTML = '';
  $("#certCount").textContent = '';
  if (!code) return;
  const all = certData.filter(r => r.opentalk_code === code);
  const top = all.slice().sort((a, b) => (a.user_rank ?? 9999) - (b.user_rank ?? 9999)).slice(0, 20);
  top.forEach(r => {
    const rank = r.user_rank ?? '';
    const cls = rank == 1 ? 'rank-1' : rank == 2 ? 'rank-2' : rank == 3 ? 'rank-3' : '';
    const displayName = (r.nickname && r.nickname.trim()) ? r.nickname.trim()
      : (r.name && r.name.trim()) ? r.name.trim() : '';
    const avg = (r.average_week != null && r.average_week !== '') ? Number.parseFloat(r.average_week).toFixed(1) : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="${cls}">${rank}</td><td>${displayName}</td><td>${r.cert_days_count ?? ''}</td><td>${avg}</td>`;
    tb.appendChild(tr);
  });
  $("#certCount").textContent = `[${roomLabelFromCode(code)}] 총 ${all.length}명 중 상위 20명`;
}

/* =========================
 * [모듈] 이벤트 바인딩
 * ========================= */
function bindEvents() {
  // 개인 조회 탭 이벤트 (기존 유지)
  $('#courseSelect').addEventListener('change', () => {
    const course = getSelectedCourseTitle();
    fillRooms(course);
    updateChartTitle(null, ($('#nickInput').value || '').trim());
  });
  
  $('#roomSelect').addEventListener('change', () => {
    const code = getSelectedRoomCode();
    fillNicknames(code);
    updateChartTitle(code, ($('#nickInput').value || '').trim());
    setCalendarToStartMonth();
  });
  
  $('#nickInput').addEventListener('input', () => {
    const code = getSelectedRoomCode();
    updateChartTitle(code, ($('#nickInput').value || '').trim());
  });
  
  $('#applyBtn').addEventListener('click', () => {
    const code = getSelectedRoomCode();
    const nick = ($('#nickInput').value || '').trim();
    
    selectedUserData = { code, nick };
    updateChartTitle(code, nick);
    renderChart(code, nick);
    renderTable(code);
    renderCalendar(); // 달력 업데이트
  });

  // 전체 조회 탭 이벤트들
  // 최소 인증 횟수 변경 시 차트 업데이트
  $('#minCertCount').addEventListener('input', () => {
    renderWeeklyCertChart();
  });
  
  // 섹션 탭 전환
  document.querySelectorAll('.section-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const section = tab.dataset.section;
      
      // 탭 활성화 상태 변경
      document.querySelectorAll('.section-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // 섹션 표시/숨김
      document.querySelectorAll('.filter-section').forEach(s => s.classList.remove('active'));
      document.getElementById(`section${section.charAt(0).toUpperCase() + section.slice(1)}`).classList.add('active');
    });
  });
  
  // 과정별 조회 이벤트
  $('#applyCourseFilter').addEventListener('click', () => {
    const courseTitle = $('#allCourseSelect').value;
    renderCourseCertTable(courseTitle);
    renderCourseProgressTable(courseTitle);
  });
  
  // 단톡방별 조회 이벤트
  $('#allCourseSelectForRoom').addEventListener('change', () => {
    const courseTitle = $('#allCourseSelectForRoom').value;
    fillAllRoomDropdown(courseTitle);
  });
  
  $('#applyRoomFilter').addEventListener('click', () => {
    const opentalkCode = $('#allRoomSelect').value;
    renderRoomCertTable(opentalkCode);
    renderRoomProgressTable(opentalkCode);
  });
  
  // 기간 조회 이벤트
  $('#applyPeriodFilter').addEventListener('click', () => {
    const startDate = $('#periodStartDate').value;
    const endDate = $('#periodEndDate').value;
    
    if (!startDate || !endDate) {
      alert('조회 시작일과 종료일을 모두 입력해주세요.');
      return;
    }
    
    if (startDate > endDate) {
      alert('시작일은 종료일보다 이전이어야 합니다.');
      return;
    }
    
    renderPeriodTables(startDate, endDate);
  });

  // 개인 조회 탭 키보드 이벤트
  let isComposing = false;
  $('#nickInput').addEventListener('compositionstart', () => isComposing = true);
  $('#nickInput').addEventListener('compositionend', () => isComposing = false);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const a = document.activeElement;
    if (!a) return;
    if (a.id === 'roomSelect' || (a.id === 'nickInput' && !isComposing)) {
      e.preventDefault();
      $('#applyBtn').click();
    }
  });
  $('#nickInput').addEventListener('search', () => {
    updateChartTitle(getSelectedRoomCode(), '');
  });
}

/* =========================
 * [모듈] 탭 전환 (기본=전체)
 * ========================= */
/**
 * setTab
 * @param {'personal'|'all'} target
 * @param {NodeListOf<HTMLButtonElement>} buttons
 */
function setTab(target, buttons) {
  buttons.forEach(b => b.classList.remove('active'));
  const btn = Array.from(buttons).find(b => b.dataset.tab === target);
  if (btn) btn.classList.add('active');
  const personal = document.getElementById('tabPersonal');
  const all = document.getElementById('tabAll');
  if (personal) personal.style.display = (target === 'personal') ? 'block' : 'none';
  if (all) all.style.display = (target === 'all') ? 'block' : 'none';
}

/** 탭 초기화 */
function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  if (!buttons.length) return;
  buttons.forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab, buttons));
  });
  // 초기: active가 붙어있는 버튼 기준으로 1회 동기화(기본=전체 조회)
  const activeBtn = document.querySelector('.tab-btn.active');
  setTab(activeBtn ? activeBtn.dataset.tab : 'all', buttons);
}

/* =========================
 * [모듈] 로드/에러
 * ========================= */
function showLoadError(message) {
  const box = $('#loadError');
  box.style.display = 'block';
  box.innerHTML = `${message} <button id="retryBtn" type="button" class="btn">다시 시도</button>`;
  $('#retryBtn').addEventListener('click', () => {
    box.style.display = 'none';
    box.innerHTML = '';
    init();
  });
}

// 데이터 로드
async function load() {
  const [p, c, cd, os] = await Promise.all([
    fetch(progressUrl, { cache: 'no-store' }),
    fetch(certUrl, { cache: 'no-store' }),
    fetch(certDailyUrl, { cache: 'no-store' }),
    fetch(opentalkStartUrl, { cache: 'no-store' })
  ]);
  
  const pj = await p.json().catch(() => ({}));
  const cj = await c.json().catch(() => ({}));
  const cdj = await cd.json().catch(() => ({}));
  const osj = await os.json().catch(() => ({}));
  
  progressData = getProgressRows(pj);
  certData = getCertRows(cj);
  certDailyData = getCertRows(cdj);
  opentalkStartData = getCertRows(osj);
  
  // 개인 조회용 드롭다운 초기화
  fillCourses();
  ensureChart([], []);
  updateChartTitle(null, '');
  
  // 전체 조회용 드롭다운 초기화
  fillAllQueryDropdowns();
  
  // 전체 조회 탭 렌더링
  renderDashboardStats();
  
  // 기간 조회 기본 날짜 설정 (최근 4주)
  const today = new Date();
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(today.getDate() - 28);
  
  $('#periodStartDate').value = fourWeeksAgo.toISOString().slice(0, 10);
  $('#periodEndDate').value = today.toISOString().slice(0, 10);
  
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
    initCalendar();
    bindEvents();      // 모든 이벤트 바인딩
    await load();      // 데이터 로드
    initTabs();        // 탭 전환 초기화(기본 'all')
  } catch (e) {
    console.error(e);
    showLoadError('데이터를 불러오지 못했습니다.');
  }
}

// 애플리케이션 시작
init();
