const STORAGE_KEY = "strength-deck-state-v1";

const lifts = {
  backSquat: "백스쿼트",
  frontSquat: "프론트스쿼트",
  deadlift: "데드리프트",
  pushPress: "푸시프레스",
  snatch: "스내치",
  cleanJerk: "클린 & 저크",
};

const defaultProfile = {
  nickname: "나",
  gender: "female",
  height: 160,
  weight: 50,
  unit: "kg",
  activity: "크로스핏",
  days: 6,
  goal: "olympic",
  recovery: "normal",
};

const state = normalizeState(loadState());
let calendarCursor = new Date();
let selectedCalendarDate = isoDate(new Date());

const panels = {
  today: document.querySelector("#todayStep"),
  maxes: document.querySelector("#maxesStep"),
  plan: document.querySelector("#planStep"),
  calendar: document.querySelector("#calendarStep"),
};

document.querySelector("#profileButton").addEventListener("click", openProfile);
document.querySelectorAll("[data-close-profile]").forEach((button) => button.addEventListener("click", closeProfile));

document.querySelectorAll(".appbar-item").forEach((button) => {
  button.addEventListener("click", () => showStep(button.dataset.step));
});

document.querySelector("#addUserForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const nickname = new FormData(form).get("nickname")?.toString().trim() || "새 사용자";
  const user = createUser(nickname);
  state.users.push(user);
  state.activeUserId = user.id;
  saveState("사용자를 추가했습니다.");
  form.reset();
  hydrateForms();
  renderAll();
});

document.querySelector("#userCardList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-user-id]");
  if (!button) return;
  state.activeUserId = button.dataset.userId;
  selectedCalendarDate = isoDate(new Date());
  saveState(`${activeUser().profile.nickname} 데이터로 전환했습니다.`);
  hydrateForms();
  renderAll();
});

document.querySelector("#profileForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const user = activeUser();
  const previousUnit = unit(user.profile);
  user.profile = normalizeProfile(Object.fromEntries(new FormData(event.currentTarget).entries()));
  if (unit(user.profile) !== previousUnit) convertStoredWeights(user, previousUnit, unit(user.profile));
  rebuildPlanIfPossible(user);
  saveState("프로필을 저장했습니다.");
  hydrateForms();
  renderAll();
});

document.querySelector("#unitSelect").addEventListener("change", (event) => {
  const user = activeUser();
  const nextUnit = event.currentTarget.value;
  const previousUnit = unit(user.profile);
  if (nextUnit === previousUnit) return;
  user.profile.unit = nextUnit;
  convertStoredWeights(user, previousUnit, nextUnit);
  rebuildPlanIfPossible(user);
  saveState(`단위를 ${nextUnit}로 변경했습니다.`);
  hydrateForms();
  renderAll();
});

document.querySelector("#maxForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const user = activeUser();
  user.maxes = Object.fromEntries(new FormData(event.currentTarget).entries());
  Object.keys(user.maxes).forEach((key) => {
    user.maxes[key] = number(user.maxes[key]);
  });
  rebuildPlanIfPossible(user);
  saveState("1RM과 프로그램을 저장했습니다.");
  renderAll();
  showStep("plan");
});

document.querySelector("#completeSession").addEventListener("click", () => {
  const user = activeUser();
  if (!user.plan?.sessions?.length) {
    showStep("maxes");
    return;
  }

  const today = isoDate(new Date());
  const doneSets = document.querySelectorAll("#todaySession input:checked").length;
  const totalSets = document.querySelectorAll("#todaySession input").length;
  const session = user.plan.sessions[0];
  user.todayChecks = user.todayChecks || {};
  user.completedDates[today] = true;
  user.history = (user.history || []).filter((item) => item.isoDate !== today);
  user.history.unshift({
    isoDate: today,
    date: new Date().toLocaleDateString("ko-KR"),
    title: session.title,
    doneSets: doneSets || totalSets,
    totalSets,
    unit: unit(user.profile),
    lifts: session.lifts.map((lift) => ({
      name: lift.name,
      summary: lift.sets.map((set) => `${set.percent}% ${set.sets}x${set.reps} ${set.weight}${unit(user.profile)}`).join(", "),
    })),
  });
  user.history = user.history.slice(0, 30);
  selectedCalendarDate = today;
  saveState("오늘 스트렝스를 완료했습니다.");
  renderAll();
  showStep("calendar");
});

document.querySelector("#undoCompleteSession").addEventListener("click", () => {
  const user = activeUser();
  const today = isoDate(new Date());
  delete user.completedDates[today];
  user.todayChecks = user.todayChecks || {};
  delete user.todayChecks[today];
  user.history = (user.history || []).filter((item) => item.isoDate !== today);
  selectedCalendarDate = today;
  saveState("오늘 완료를 취소했습니다.");
  renderAll();
});

document.querySelector("#todaySession").addEventListener("change", (event) => {
  if (!event.target.matches("[data-check-id]")) return;
  const user = activeUser();
  const today = isoDate(new Date());
  user.todayChecks = user.todayChecks || {};
  user.todayChecks[today] = user.todayChecks[today] || {};
  user.todayChecks[today][event.target.dataset.checkId] = event.target.checked;
  saveState("", false);
  renderTodaySession();
});

document.querySelector("#prevMonth").addEventListener("click", () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
  renderCalendar();
});

document.querySelector("#nextMonth").addEventListener("click", () => {
  calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
  renderCalendar();
});

document.querySelector("#calendarGrid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-date]");
  if (!button) return;
  selectedCalendarDate = button.dataset.date;
  renderCalendar();
});

document.querySelector("#exportData").addEventListener("click", () => {
  const data = JSON.stringify({ exportedAt: new Date().toISOString(), app: "strength-deck", state }, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `strength-deck-backup-${isoDate(new Date())}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("백업 파일을 내보냈습니다.");
});

document.querySelector("#importData").addEventListener("change", async (event) => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    replaceState(normalizeState(parsed.state || parsed));
    saveState("데이터를 가져왔습니다.", false);
    hydrateForms();
    renderAll();
    closeProfile();
    showToast("데이터를 가져왔습니다.");
  } catch {
    showToast("가져오기 파일을 읽을 수 없습니다.");
  } finally {
    event.currentTarget.value = "";
  }
});

document.querySelector("#resetData").addEventListener("click", () => {
  const ok = window.confirm("모든 사용자, 프로필, 1RM, 완료 기록을 이 기기에서 삭제할까요?");
  if (!ok) return;
  replaceState(normalizeState({}));
  selectedCalendarDate = isoDate(new Date());
  saveState("데이터를 초기화했습니다.");
  hydrateForms();
  renderAll();
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}

hydrateForms();
renderAll();
showStep("today");

function createUser(nickname) {
  return {
    id: `user-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    profile: normalizeProfile({ ...defaultProfile, nickname }),
    maxes: {},
    plan: null,
    history: [],
    completedDates: {},
    todayChecks: {},
  };
}

function activeUser() {
  return state.users.find((user) => user.id === state.activeUserId) || state.users[0];
}

function buildPlan(profile = {}, maxes = {}) {
  const days = number(profile.days) || 3;
  const recovery = profile.recovery || "normal";
  const activity = (profile.activity || "").trim();
  const highSportLoad = days >= 5 || /크로스핏|crossfit/i.test(activity);
  const sessionsPerWeek = highSportLoad ? 2 : days >= 4 ? 3 : 2;
  const volumeBias = recovery === "high" && !highSportLoad ? 1 : recovery === "low" || highSportLoad ? -1 : 0;
  const available = Object.entries(maxes).filter(([, value]) => value > 0);
  const focus =
    profile.goal === "power"
      ? "스쿼트, 데드리프트, 프레스 중심"
      : profile.goal === "mixed"
        ? "스쿼트, 풀, 올림픽 리프트 균형"
        : "스쿼트 강도와 스내치/클린 전이";

  return {
    title: `${sessionsPerWeek}회 보강 / ${focus}`,
    summary: `${profile.nickname || "사용자"} · ${profile.height || "-"}cm, ${profile.weight || "-"}${unit(profile)}, ${activity || "운동 정보 없음"} 기준. 1RM의 70-88%에서 시작합니다.`,
    metrics: [
      ["주 보강", `${sessionsPerWeek}회`],
      ["강도 범위", "70-88%"],
      ["입력 1RM", `${available.length}개`],
    ],
    weeks: buildWeeks(highSportLoad, volumeBias),
    sessions: buildSessions(maxes, sessionsPerWeek, volumeBias),
  };
}

function buildWeeks(highSportLoad, volumeBias) {
  const setAdjust = volumeBias > 0 ? "+1세트" : volumeBias < 0 || highSportLoad ? "-1세트" : "기본";
  return [
    ["1주", "기술 유지 + 볼륨", "70-78%", `주요 리프트 4x3, 보조 3x3 (${setAdjust})`],
    ["2주", "강도 상승", "75-84%", `주요 리프트 4x2, 싱글 2-3회 (${setAdjust})`],
    ["3주", "고강도 노출", "80-88%", "주요 리프트 3x2 후 85-88% 싱글 2회"],
    ["4주", "회복 + 테스트 준비", "65-75%", "가벼운 3x2, 속도 유지, 실패 세트 금지"],
  ];
}

function buildSessions(maxes, sessionsPerWeek, volumeBias) {
  const baseSets = volumeBias > 0 ? 5 : volumeBias < 0 ? 3 : 4;
  const sessions = [
    {
      title: "Day A: 스쿼트 힘 + 역도 풀",
      note: "하체 최대힘을 만들고 스내치/클린의 당기는 힘으로 연결합니다.",
      lifts: [
        prescription("backSquat", maxes.backSquat, [
          [70, baseSets, 3],
          [78, baseSets, 2],
          [84, 3, 1],
        ]),
        prescription("snatch", maxes.snatch, [
          [65, 5, 2],
          [72, 4, 2],
        ]),
        prescription("deadlift", maxes.deadlift, [[78, 3, 3]]),
      ],
    },
    {
      title: "Day B: 프론트스쿼트 + 오버헤드 힘",
      note: "클린 회복 자세와 저크/프레스 전이를 우선합니다.",
      lifts: [
        prescription("frontSquat", maxes.frontSquat, [
          [72, baseSets, 3],
          [80, 3, 2],
          [86, 3, 1],
        ]),
        prescription("cleanJerk", maxes.cleanJerk, [
          [65, 5, 1],
          [75, 4, 1],
        ]),
        prescription("pushPress", maxes.pushPress, [
          [70, baseSets, 3],
          [78, 3, 2],
        ]),
      ],
    },
  ];

  if (sessionsPerWeek >= 3) {
    sessions.push({
      title: "Day C: 데드리프트 + 폭발력",
      note: "순수 당기는 힘과 바벨 가속을 분리해서 가져갑니다.",
      lifts: [
        prescription("deadlift", maxes.deadlift, [
          [72, 4, 3],
          [82, 3, 2],
          [88, 2, 1],
        ]),
        prescription("backSquat", maxes.backSquat, [[68, 4, 4]]),
        prescription("snatch", maxes.snatch, [[70, 6, 1]]),
      ],
    });
  }

  return sessions.map((session) => ({ ...session, lifts: session.lifts.filter(Boolean) }));
}

function prescription(key, max, waves) {
  if (!max) return null;
  return {
    name: lifts[key],
    max,
    trainingMax: roundLoad(max * 0.9),
    sets: waves.map(([percent, sets, reps]) => ({
      percent,
      sets,
      reps,
      weight: roundLoad(max * (percent / 100)),
    })),
  };
}

function renderAll() {
  renderUsers();
  renderPlan();
  renderNutrition();
  renderTodaySession();
  renderHistory();
  renderCalendar();
  renderCalendarNavState();
}

function renderUsers() {
  const current = activeUser();
  document.querySelector("#userCardList").innerHTML = state.users
    .map((user) => {
      const profile = user.profile;
      const isActive = user.id === current.id;
      return `<button class="user-card ${isActive ? "is-active" : ""}" type="button" data-user-id="${user.id}">
        <strong>${profile.nickname}</strong>
        <span>${profile.weight}${unit(profile)} · 주 ${profile.days}회</span>
      </button>`;
    })
    .join("");
}

function renderNutrition() {
  const profile = activeUser().profile;
  const bodyWeightKg = unit(profile) === "lb" ? number(profile.weight) / 2.20462 : number(profile.weight);
  const days = number(profile.days) || 3;
  const isCrossfit = /크로스핏|crossfit/i.test(profile.activity || "");
  const activityFactor = days >= 6 ? 34 : days >= 4 ? 32 : 30;
  const genderAdjust = profile.gender === "male" ? 100 : profile.gender === "female" ? -100 : 0;
  const calorieTarget = roundToNearest(bodyWeightKg * activityFactor + genderAdjust + (isCrossfit ? 100 : 0), 50);
  const protein = Math.round(bodyWeightKg * 1.6);
  const carbs = Math.round(bodyWeightKg * (isCrossfit || days >= 5 ? 4 : 3.2));
  const fat = Math.round(bodyWeightKg * 0.7);
  const genderText = profile.gender === "male" ? "남성" : profile.gender === "female" ? "여성" : "성별 미지정";

  document.querySelector("#nutritionCard").innerHTML = `<div class="nutrition-head">
    <div>
      <h2>오늘 섭취 목표</h2>
      <p>${genderText}, 체중, 주 운동 횟수 기준의 일반 회복 가이드입니다.</p>
    </div>
    <span class="badge">${calorieTarget} kcal</span>
  </div>
  <div class="nutrition-grid">
    <div><strong>${protein}g</strong><span>단백질</span></div>
    <div><strong>${carbs}g</strong><span>탄수화물</span></div>
    <div><strong>${fat}g</strong><span>지방</span></div>
  </div>
  <p class="nutrition-note">기준: 체중 1kg당 단백질 1.6g, 지방 0.7g, 탄수화물 3.2-4g. 칼로리는 체중 x ${activityFactor}kcal에 성별 보정과 운동 종류를 약하게 반영했습니다.</p>`;
}

function renderPlan() {
  const user = activeUser();
  const plan = user.plan;
  document.querySelector("#planTitle").textContent = plan?.title || "계획이 아직 없습니다.";
  document.querySelector("#planSummary").textContent = plan?.summary || "마이페이지에서 프로필을 저장하고 1RM을 입력해 주세요.";
  document.querySelector("#metricRow").innerHTML = (plan?.metrics || [])
    .map(([label, value]) => `<article class="metric"><strong>${value}</strong><span>${label}</span></article>`)
    .join("");
  document.querySelector("#weekList").innerHTML = (plan?.weeks || [])
    .map(
      ([week, title, percent, sets]) => `<article class="exercise-card">
        <header><div><h3>${week}: ${title}</h3><p>${sets}</p></div><span class="badge">${percent}</span></header>
      </article>`,
    )
    .join("");
  document.querySelector("#programList").innerHTML = plan?.sessions?.length
    ? plan.sessions.map(renderSessionCard).join("")
    : `<div class="empty-state">1RM을 입력하면 4주 블록과 오늘 세션이 생성됩니다.</div>`;
}

function renderSessionCard(session) {
  return `<article class="exercise-card">
    <header><div><h3>${session.title}</h3><p>${session.note}</p></div><span class="badge">${session.lifts.length} lifts</span></header>
    <div class="sets">${session.lifts.map(renderLiftSummary).join("") || `<p>입력된 1RM이 없어 처방을 만들 수 없습니다.</p>`}</div>
  </article>`;
}

function renderLiftSummary(lift) {
  const unitLabel = unit(activeUser().profile);
  const sets = lift.sets.map((set) => `${set.percent}% ${set.sets}x${set.reps} @ ${set.weight}${unitLabel}`).join(" / ");
  return `<div class="set-row"><strong>${lift.name}</strong><span>${sets}</span><span>TM ${lift.trainingMax}${unitLabel}</span></div>`;
}

function renderTodaySession() {
  const user = activeUser();
  const session = user.plan?.sessions?.[0];
  const isDone = Boolean(user.completedDates?.[isoDate(new Date())]);
  document.querySelector("#todayHint").textContent = session?.note || "프로필과 1RM을 입력하면 오늘 진행할 세션이 생성됩니다.";
  document.querySelector("#todaySession").innerHTML = session
    ? session.lifts.map(renderTodayLift).join("")
    : `<div class="empty-state">아직 생성된 세션이 없습니다. 1RM 화면에서 현재 최고 중량을 입력해 주세요.</div>`;
  const completeButton = document.querySelector("#completeSession");
  completeButton.textContent = session ? (isDone ? "오늘 완료됨" : "오늘 스트렝스 완료") : "1RM 입력하기";
  completeButton.classList.toggle("is-complete", isDone);
}

function renderTodayLift(lift) {
  const todayChecks = activeUser().todayChecks?.[isoDate(new Date())] || {};
  return `<section class="today-lift">
    <header><div><h3>${lift.name}</h3><p>현재 1RM ${lift.max}${unit(activeUser().profile)}, 트레이닝 맥스 ${lift.trainingMax}${unit(activeUser().profile)}</p></div><span class="badge">1RM</span></header>
    <div class="sets">${lift.sets
      .map((set, index) => {
        const checkId = `${lift.name}-${index}`;
        const checked = Boolean(todayChecks[checkId]);
        return `<label class="set-row today-set ${checked ? "is-checked" : ""}">
          <strong>${set.percent}%</strong>
          <span>${set.sets}세트 x ${set.reps}회 · ${set.weight}${unit(activeUser().profile)}</span>
          <input type="checkbox" data-check-id="${checkId}" aria-label="${lift.name} ${index + 1}번 처방 완료" ${checked ? "checked" : ""} />
        </label>`;
      })
      .join("")}</div>
  </section>`;
}

function renderHistory() {
  const history = activeUser().history || [];
  document.querySelector("#historyList").innerHTML = history.length
    ? history.map((item) => `<div class="set-row"><strong>${item.date}</strong><span>${item.title}</span><span>${item.doneSets}/${item.totalSets}</span></div>`).join("")
    : `<div class="empty-state">아직 완료한 세션이 없습니다.</div>`;
}

function renderCalendar() {
  const user = activeUser();
  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const cells = [];
  document.querySelector("#calendarTitle").textContent = `${year}.${String(month + 1).padStart(2, "0")}`;

  for (let i = 0; i < first.getDay(); i += 1) cells.push(`<span class="calendar-cell is-empty"></span>`);
  for (let day = 1; day <= last.getDate(); day += 1) {
    const key = isoDate(new Date(year, month, day));
    const classes = ["calendar-cell"];
    if (key === isoDate(new Date())) classes.push("is-today");
    if (user.completedDates?.[key]) classes.push("is-done");
    if (key === selectedCalendarDate) classes.push("is-selected");
    cells.push(`<button class="${classes.join(" ")}" type="button" data-date="${key}"><b>${day}</b><em>${user.completedDates?.[key] ? "✓" : ""}</em></button>`);
  }
  document.querySelector("#calendarGrid").innerHTML = cells.join("");
  renderCalendarDetail();
}

function renderCalendarDetail() {
  const user = activeUser();
  const item = (user.history || []).find((entry) => entry.isoDate === selectedCalendarDate);
  const detail = document.querySelector("#calendarDetail");
  if (!item) {
    detail.innerHTML = `<div class="empty-state">${formatKoreanDate(selectedCalendarDate)} 완료 기록이 없습니다.</div>`;
    return;
  }
  detail.innerHTML = `<article class="exercise-card calendar-summary">
    <header><div><h3>${formatKoreanDate(selectedCalendarDate)}</h3><p>${item.title} · ${item.doneSets}/${item.totalSets} 세트 완료</p></div><span class="badge">완료</span></header>
    <div class="sets">${(item.lifts || []).map((lift) => `<div class="set-row"><strong>${lift.name}</strong><span>${lift.summary}</span><span>✓</span></div>`).join("") || `<div class="set-row"><strong>기록</strong><span>${item.title}</span><span>✓</span></div>`}</div>
  </article>`;
}

function renderCalendarNavState() {
  document.querySelector("#calendarNavIcon").classList.toggle("has-check", Boolean(activeUser().completedDates?.[isoDate(new Date())]));
}

function showStep(step) {
  Object.entries(panels).forEach(([key, panel]) => panel.classList.toggle("is-active", key === step));
  document.querySelectorAll(".appbar-item").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.step === step));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function openProfile() {
  document.querySelector("#profileDrawer").classList.add("is-open");
  document.querySelector("#profileDrawer").setAttribute("aria-hidden", "false");
}

function closeProfile() {
  document.querySelector("#profileDrawer").classList.remove("is-open");
  document.querySelector("#profileDrawer").setAttribute("aria-hidden", "true");
}

function hydrateForms() {
  const user = activeUser();
  Object.entries(user.profile || {}).forEach(([key, value]) => {
    const field = document.querySelector(`#profileForm [name="${key}"]`);
    if (field) field.value = value;
  });
  Object.entries(user.maxes || {}).forEach(([key, value]) => {
    const field = document.querySelector(`#maxForm [name="${key}"]`);
    if (field) field.value = value || "";
  });
  updateUnitLabels();
}

function normalizeState(raw) {
  if (Array.isArray(raw?.users) && raw.users.length) {
    const users = raw.users.map(normalizeUser);
    return {
      users,
      activeUserId: users.some((user) => user.id === raw.activeUserId) ? raw.activeUserId : users[0].id,
    };
  }

  const user = normalizeUser({
    id: "user-default",
    profile: raw?.profile || defaultProfile,
    maxes: raw?.maxes || {},
    plan: raw?.plan || null,
    history: raw?.history || [],
    completedDates: raw?.completedDates || {},
    todayChecks: raw?.todayChecks || {},
  });
  return { users: [user], activeUserId: user.id };
}

function normalizeUser(user) {
  const next = {
    id: user.id || `user-${Date.now()}`,
    profile: normalizeProfile(user.profile || defaultProfile),
    maxes: user.maxes || {},
    plan: user.plan || null,
    history: Array.isArray(user.history) ? user.history : [],
    completedDates: user.completedDates || {},
    todayChecks: user.todayChecks || {},
  };
  next.history.forEach((item) => {
    if (item.isoDate) next.completedDates[item.isoDate] = true;
  });
  if (Object.values(next.maxes).some((value) => number(value) > 0)) next.plan = buildPlan(next.profile, next.maxes);
  return next;
}

function normalizeProfile(profile) {
  return {
    nickname: profile.nickname || "나",
    gender: ["male", "female", "other"].includes(profile.gender) ? profile.gender : "female",
    height: number(profile.height) || 160,
    weight: number(profile.weight) || 50,
    unit: profile.unit === "lb" ? "lb" : "kg",
    activity: profile.activity || "크로스핏",
    days: number(profile.days) || 6,
    goal: profile.goal || "olympic",
    recovery: profile.recovery || "normal",
  };
}

function replaceState(next) {
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, next);
}

function rebuildPlanIfPossible(user) {
  if (Object.values(user.maxes || {}).some((value) => number(value) > 0)) user.plan = buildPlan(user.profile, user.maxes);
}

function convertStoredWeights(user, fromUnit, toUnit) {
  const factor = fromUnit === "kg" && toUnit === "lb" ? 2.20462 : fromUnit === "lb" && toUnit === "kg" ? 1 / 2.20462 : 1;
  if (user.profile.weight) user.profile.weight = roundToTenth(user.profile.weight * factor);
  Object.keys(user.maxes || {}).forEach((key) => {
    if (user.maxes[key]) user.maxes[key] = roundLoad(user.maxes[key] * factor, toUnit);
  });
}

function updateUnitLabels() {
  const unitLabel = unit(activeUser().profile);
  document.querySelectorAll(".unit-label").forEach((label) => {
    label.textContent = unitLabel;
  });
  document.querySelectorAll("#maxForm input").forEach((input) => {
    input.placeholder = unitLabel;
  });
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveState(message, show = true) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (show && message) showToast(message);
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function number(value) {
  return Number.parseFloat(value) || 0;
}

function roundToHalf(value) {
  return Math.round(value * 2) / 2;
}

function roundToTenth(value) {
  return Math.round(value * 10) / 10;
}

function roundToNearest(value, step) {
  return Math.round(value / step) * step;
}

function roundLoad(value, targetUnit = unit(activeUser().profile)) {
  if (targetUnit === "lb") return Math.round(value / 5) * 5;
  return roundToHalf(value);
}

function unit(profile = {}) {
  return profile.unit === "lb" ? "lb" : "kg";
}

function isoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatKoreanDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}
