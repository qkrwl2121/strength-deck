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
let selectedPlanWeek = 1;
let selectedPlanDayOffset = 0;

const panels = {
  today: document.querySelector("#todayStep"),
  maxes: document.querySelector("#maxesStep"),
  plan: document.querySelector("#planStep"),
  calendar: document.querySelector("#calendarStep"),
};

document.querySelector("#profileButton").addEventListener("click", openProfile);
document.querySelectorAll("[data-close-profile]").forEach((button) => button.addEventListener("click", closeProfile));
document.querySelectorAll("[data-drawer-view]").forEach((button) => {
  button.addEventListener("click", () => showDrawerView(button.dataset.drawerView));
});

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
  const deleteButton = event.target.closest("[data-delete-user-id]");
  if (deleteButton) {
    deleteUser(deleteButton.dataset.deleteUserId);
    return;
  }

  const button = event.target.closest("[data-user-id]");
  if (!button) return;
  state.activeUserId = button.dataset.userId;
  selectedCalendarDate = isoDate(new Date());
  saveState(`${activeUser().profile.nickname} 데이터로 전환했습니다.`);
  hydrateForms();
  renderAll();
  showDrawerView("profile");
  animateUserSwitch();
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
  if (totalSets > 0 && doneSets < totalSets) {
    showToast("위 세트를 모두 체크하면 완료할 수 있습니다.");
    return;
  }
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
  launchConfetti();
  renderAll();
  showStep("calendar");
});

document.querySelector("#undoCompleteSession").addEventListener("click", () => {
  undoCompletion(isoDate(new Date()));
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

document.querySelector("#calendarDetail").addEventListener("click", (event) => {
  const button = event.target.closest("[data-undo-date]");
  if (!button) return;
  undoCompletion(button.dataset.undoDate);
});

const weekSelect = document.querySelector("#weekSelect");
if (weekSelect) {
  weekSelect.addEventListener("change", (event) => {
    selectedPlanWeek = Number(event.currentTarget.value);
    renderPlan();
  });
}

const legacyWeekTabs = document.querySelector("#weekTabs");
if (legacyWeekTabs) {
  legacyWeekTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-week]");
    if (!button) return;
    selectedPlanWeek = Number(button.dataset.week);
    renderPlan();
  });
}

document.querySelector("#dateTabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-offset]");
  if (!button) return;
  selectedPlanDayOffset = Number(button.dataset.offset);
  renderPlan();
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
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("sw.js");
      registration.update();
    } catch {
      showToast("앱 업데이트 확인에 실패했습니다.");
    }
  });
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
      ? "스쿼트 · 데드리프트 · 프레스"
      : profile.goal === "mixed"
        ? "스쿼트 · 스내치 · 클린"
        : "스내치 · 클린 · 하체 힘";
  const weeks = buildWeeks(highSportLoad, volumeBias);
  const weekSessions = weeks.map((week) => buildSessions(maxes, sessionsPerWeek, volumeBias, week.week));

  return {
    title: `${focus} 중심 4주 계획`,
    summary: `${profile.nickname || "사용자"} · ${profile.height || "-"}cm, ${profile.weight || "-"}kg, ${activity || "운동 정보 없음"} 기준. 매주 운동 종류와 강도를 바꿔서 힘을 올립니다.`,
    metrics: [
      ["주 운동", `${sessionsPerWeek}회`],
      ["강도", "65-88%"],
      ["1RM 입력", `${available.length}개`],
    ],
    weeks,
    sessions: weekSessions[0] || [],
    weekSessions,
  };
}

function buildWeeks(highSportLoad, volumeBias) {
  const setAdjust = volumeBias > 0 ? "세트 조금 추가" : volumeBias < 0 || highSportLoad ? "세트 조금 줄임" : "기본 세트";
  return [
    { week: 1, name: "기본 힘 만들기", range: "70-78%", note: `스쿼트와 기본 리프트를 안정적으로 반복합니다. ${setAdjust}` },
    { week: 2, name: "무게 올리기", range: "75-84%", note: `스쿼트, 클린, 프레스 무게를 올리고 반복 수를 줄입니다. ${setAdjust}` },
    { week: 3, name: "무거운 중량 적응", range: "80-88%", note: "무거운 1-2회 세트로 힘을 확인합니다. 실패할 것 같으면 바로 중단합니다." },
    { week: 4, name: "회복과 속도", range: "65-75%", note: "가볍게 빠르게 움직이며 다음 4주를 준비합니다." },
  ];
}

function buildSessions(maxes, sessionsPerWeek, volumeBias, week = 1) {
  const baseSets = volumeBias > 0 ? 5 : volumeBias < 0 ? 3 : 4;
  const weekPlans = {
    1: [
      {
        title: "스쿼트 + 스내치 기본",
        note: "백스쿼트로 하체 힘을 만들고 스내치 동작을 안정적으로 반복합니다.",
        lifts: [
          prescription("backSquat", maxes.backSquat, [[72, baseSets, 3], [78, 3, 2]], "백스쿼트"),
          prescription("snatch", maxes.snatch, [[65, 5, 2], [72, 3, 2]], "스내치"),
          prescription("deadlift", maxes.deadlift, [[74, 3, 3]], "데드리프트"),
        ],
      },
      {
        title: "프론트스쿼트 + 클린",
        note: "클린을 받는 자세와 상체 버티는 힘을 같이 올립니다.",
        lifts: [
          prescription("frontSquat", maxes.frontSquat, [[72, baseSets, 3], [78, 3, 2]], "프론트스쿼트"),
          prescription("cleanJerk", maxes.cleanJerk, [[65, 5, 1], [72, 4, 1]], "클린 & 저크"),
          prescription("pushPress", maxes.pushPress, [[70, 4, 3]], "푸시프레스"),
        ],
      },
      {
        title: "데드리프트 + 하체 강화",
        note: "당기는 힘과 스쿼트 반복 능력을 함께 가져갑니다.",
        lifts: [
          prescription("deadlift", maxes.deadlift, [[72, 4, 3], [80, 2, 2]], "데드리프트"),
          prescription("backSquat", maxes.backSquat, [[68, 4, 4]], "가벼운 백스쿼트"),
          prescription("snatch", maxes.snatch, [[68, 5, 1]], "스내치 싱글"),
        ],
      },
    ],
    2: [
      {
        title: "무게 올린 스쿼트",
        note: "반복 수를 줄이고 스쿼트 무게를 올립니다.",
        lifts: [
          prescription("backSquat", maxes.backSquat, [[76, baseSets, 2], [82, 3, 2], [85, 2, 1]], "백스쿼트"),
          prescription("snatch", maxes.snatch, [[70, 4, 2], [76, 3, 1]], "스내치"),
          prescription("deadlift", maxes.deadlift, [[80, 3, 2]], "데드리프트"),
        ],
      },
      {
        title: "클린 힘 + 프레스",
        note: "클린 무게와 머리 위로 밀어내는 힘을 올립니다.",
        lifts: [
          prescription("frontSquat", maxes.frontSquat, [[76, 4, 2], [83, 3, 1]], "프론트스쿼트"),
          prescription("cleanJerk", maxes.cleanJerk, [[70, 4, 1], [78, 3, 1]], "클린 & 저크"),
          prescription("pushPress", maxes.pushPress, [[74, 4, 2], [80, 2, 2]], "푸시프레스"),
        ],
      },
      {
        title: "스내치 풀 + 하체",
        note: "스내치보다 무겁게 당기고 하체 보조 운동을 더합니다.",
        lifts: [
          prescription("snatch", maxes.snatch, [[90, 4, 2]], "스내치 풀"),
          prescription("backSquat", maxes.backSquat, [[74, 4, 3]], "정지 백스쿼트"),
          prescription("deadlift", maxes.deadlift, [[82, 3, 2]], "데드리프트"),
        ],
      },
    ],
    3: [
      {
        title: "무거운 스쿼트",
        note: "가장 무거운 주입니다. 좋은 자세로 가능한 세트만 진행합니다.",
        lifts: [
          prescription("backSquat", maxes.backSquat, [[80, 3, 2], [86, 2, 1], [88, 1, 1]], "백스쿼트"),
          prescription("snatch", maxes.snatch, [[74, 3, 1], [80, 3, 1]], "스내치"),
          prescription("deadlift", maxes.deadlift, [[84, 3, 1]], "데드리프트"),
        ],
      },
      {
        title: "클린 + 프론트스쿼트",
        note: "클린 받는 힘과 프론트스쿼트 고중량 적응을 합니다.",
        lifts: [
          prescription("frontSquat", maxes.frontSquat, [[80, 3, 2], [86, 2, 1]], "프론트스쿼트"),
          prescription("cleanJerk", maxes.cleanJerk, [[76, 3, 1], [82, 2, 1]], "클린 & 저크"),
          prescription("pushPress", maxes.pushPress, [[78, 3, 2], [84, 2, 1]], "푸시프레스"),
        ],
      },
      {
        title: "클린 풀 + 코어 힘",
        note: "강하게 당기고 몸통이 무너지지 않게 버티는 날입니다.",
        lifts: [
          prescription("cleanJerk", maxes.cleanJerk, [[95, 4, 2]], "클린 풀"),
          prescription("deadlift", maxes.deadlift, [[86, 2, 1]], "데드리프트"),
          prescription("backSquat", maxes.backSquat, [[76, 3, 3]], "백스쿼트"),
        ],
      },
    ],
    4: [
      {
        title: "빠른 스쿼트",
        note: "무게를 낮추고 빠르고 깔끔하게 움직입니다.",
        lifts: [
          prescription("backSquat", maxes.backSquat, [[65, 4, 2], [72, 3, 2]], "백스쿼트"),
          prescription("snatch", maxes.snatch, [[60, 5, 1], [68, 3, 1]], "스내치"),
          prescription("deadlift", maxes.deadlift, [[70, 3, 2]], "데드리프트"),
        ],
      },
      {
        title: "가벼운 클린 + 프레스",
        note: "회복을 해치지 않으면서 기술과 속도를 유지합니다.",
        lifts: [
          prescription("frontSquat", maxes.frontSquat, [[65, 4, 2], [72, 3, 2]], "프론트스쿼트"),
          prescription("cleanJerk", maxes.cleanJerk, [[62, 5, 1], [70, 3, 1]], "클린 & 저크"),
          prescription("pushPress", maxes.pushPress, [[65, 4, 2]], "푸시프레스"),
        ],
      },
      {
        title: "하체 강화 정리",
        note: "다음 계획으로 넘어가기 전 피로를 남기지 않습니다.",
        lifts: [
          prescription("deadlift", maxes.deadlift, [[70, 3, 2]], "데드리프트"),
          prescription("backSquat", maxes.backSquat, [[65, 3, 3]], "가벼운 백스쿼트"),
          prescription("snatch", maxes.snatch, [[65, 4, 1]], "스내치 싱글"),
        ],
      },
    ],
  };

  const sessions = weekPlans[week] || weekPlans[1];

  return sessions.slice(0, sessionsPerWeek).map((session) => ({ ...session, lifts: session.lifts.filter(Boolean) }));
}

function prescription(key, max, waves, label = lifts[key]) {
  if (!max) return null;
  return {
    name: label,
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
      return `<article class="user-card ${isActive ? "is-active" : ""}">
        <button class="user-card-main" type="button" data-user-id="${user.id}">
          <strong>${profile.nickname}</strong>
          <span>${profile.weight}kg · 주 ${profile.days}회</span>
        </button>
        <button class="user-delete-button" type="button" data-delete-user-id="${user.id}" aria-label="${profile.nickname} 사용자 삭제">삭제</button>
      </article>`;
    })
    .join("");
}

function deleteUser(userId) {
  if (state.users.length <= 1) {
    showToast("사용자는 최소 1명 필요합니다.");
    return;
  }

  const target = state.users.find((user) => user.id === userId);
  if (!target) return;

  const ok = window.confirm(`${target.profile.nickname} 사용자를 삭제할까요? 프로필, 1RM, 완료 기록이 함께 삭제됩니다.`);
  if (!ok) return;

  state.users = state.users.filter((user) => user.id !== userId);
  if (state.activeUserId === userId) state.activeUserId = state.users[0].id;
  selectedCalendarDate = isoDate(new Date());
  saveState(`${target.profile.nickname} 사용자를 삭제했습니다.`);
  hydrateForms();
  renderAll();
  showDrawerView("users");
}

function renderNutrition() {
  const profile = activeUser().profile;
  const bodyWeightKg = number(profile.weight);
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
    .map(([label, value]) => `<span><small>${label}</small><strong>${value}</strong></span>`)
    .join("");

  const currentWeek = plan?.weeks?.[selectedPlanWeek - 1];
  document.querySelector("#weekList").innerHTML = currentWeek
    ? `<article class="exercise-card week-compact">
        <header><div><h3>${selectedPlanWeek}주차: ${currentWeek.name}</h3><p>${currentWeek.note}</p></div><span class="badge">${currentWeek.range}</span></header>
      </article>`
    : "";

  const weekSelect = document.querySelector("#weekSelect");
  if (weekSelect) {
    weekSelect.innerHTML = [1, 2, 3, 4]
      .map((week) => `<option value="${week}" ${week === selectedPlanWeek ? "selected" : ""}>${week}주차</option>`)
      .join("");
  }

  const legacyWeekTabs = document.querySelector("#weekTabs");
  if (legacyWeekTabs) {
    legacyWeekTabs.innerHTML = [1, 2, 3, 4]
      .map((week) => `<button class="${week === selectedPlanWeek ? "is-active" : ""}" type="button" data-week="${week}">${week}주</button>`)
      .join("");
  }

  document.querySelector("#dateTabs").innerHTML = [0, 1, 2, 3, 4, 5, 6]
    .map((offset) => {
      const date = addDays(new Date(), (selectedPlanWeek - 1) * 7 + offset);
      const label = planDayLabel(date, offset, selectedPlanWeek);
      return `<button class="${offset === selectedPlanDayOffset ? "is-active" : ""}" type="button" data-offset="${offset}">
        <strong>${label}</strong><span>${date.getDate()}</span>
      </button>`;
    })
    .join("");

  const selectedSession = pickPlanSession(plan, selectedPlanWeek, selectedPlanDayOffset);
  document.querySelector("#programList").innerHTML = selectedSession
    ? renderSessionCard(selectedSession, selectedPlanWeek, selectedPlanDayOffset)
    : `<div class="empty-state">1RM을 입력하면 4주 블록과 오늘 세션이 생성됩니다.</div>`;
}

function renderSessionCard(session, week = selectedPlanWeek, dayOffset = selectedPlanDayOffset) {
  const date = addDays(new Date(), (week - 1) * 7 + dayOffset);
  return `<article class="exercise-card">
    <header><div><h3>${session.title}</h3><p>${week}주차 · ${date.getMonth() + 1}/${date.getDate()} · ${session.note}</p></div><span class="badge">${session.lifts.length} lifts</span></header>
    <div class="sets">${session.lifts.map(renderLiftSummary).join("") || `<p>입력된 1RM이 없어 처방을 만들 수 없습니다.</p>`}</div>
  </article>`;
}

function pickPlanSession(plan, week, offset) {
  const sessions = plan?.weekSessions?.[week - 1] || plan?.sessions || [];
  if (!sessions.length) return null;
  return sessions[offset % sessions.length];
}

function planDayLabel(date, offset, week = 1) {
  if (week === 1 && offset === 0) return "오늘";
  if (week === 1 && offset === 1) return "내일";
  return ["일", "월", "화", "수", "목", "금", "토"][date.getDay()];
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
  const counts = todaySetCounts(session);
  const allChecked = counts.total > 0 && counts.done === counts.total;
  document.querySelector("#todayHint").textContent = session?.note || "프로필과 1RM을 입력하면 오늘 진행할 세션이 생성됩니다.";
  document.querySelector("#todaySession").innerHTML = session
    ? session.lifts.map(renderTodayLift).join("")
    : `<div class="empty-state">아직 생성된 세션이 없습니다. 1RM 화면에서 현재 최고 중량을 입력해 주세요.</div>`;
  const completeButton = document.querySelector("#completeSession");
  completeButton.textContent = session ? (isDone ? "오늘 완료됨" : "오늘 스트렝스 완료") : "1RM 입력하기";
  completeButton.classList.toggle("is-complete", isDone);
  completeButton.disabled = Boolean(session) && (!allChecked || isDone);
  completeButton.title = Boolean(session) && !allChecked ? "위 세트를 모두 체크하면 완료할 수 있습니다." : "";
  document.querySelector("#undoCompleteSession").hidden = !isDone;
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

function todaySetCounts(session = activeUser().plan?.sessions?.[0]) {
  const todayChecks = activeUser().todayChecks?.[isoDate(new Date())] || {};
  const ids = (session?.lifts || []).flatMap((lift) => lift.sets.map((_, index) => `${lift.name}-${index}`));
  return {
    total: ids.length,
    done: ids.filter((id) => todayChecks[id]).length,
  };
}

function undoCompletion(date) {
  const user = activeUser();
  delete user.completedDates[date];
  user.todayChecks = user.todayChecks || {};
  delete user.todayChecks[date];
  user.history = (user.history || []).filter((item) => item.isoDate !== date);
  selectedCalendarDate = date;
  saveState("완료를 취소했습니다.");
  renderAll();
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
    <button class="calendar-undo" type="button" data-undo-date="${selectedCalendarDate}">완료 취소</button>
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
  showDrawerView("profile");
}

function closeProfile() {
  document.querySelector("#profileDrawer").classList.remove("is-open");
  document.querySelector("#profileDrawer").setAttribute("aria-hidden", "true");
}

function showDrawerView(view) {
  document.querySelectorAll("[data-drawer-view-panel]").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.drawerViewPanel === view);
  });
}

function animateUserSwitch() {
  const drawer = document.querySelector(".drawer-panel");
  drawer.classList.remove("is-switching");
  void drawer.offsetWidth;
  drawer.classList.add("is-switching");
  window.setTimeout(() => drawer.classList.remove("is-switching"), 520);
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
  Object.keys(user.maxes || {}).forEach((key) => {
    if (user.maxes[key]) user.maxes[key] = roundLoad(user.maxes[key] * factor, toUnit);
  });
}

function updateUnitLabels() {
  const unitLabel = unit(activeUser().profile);
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

function launchConfetti() {
  const layer = document.querySelector("#confettiLayer");
  const colors = ["#1ed760", "#ffffff", "#539df5", "#ffa42b", "#f3727f"];
  layer.innerHTML = "";

  for (let index = 0; index < 32; index += 1) {
    const piece = document.createElement("span");
    const angle = (Math.PI * 2 * index) / 32;
    const distance = 90 + Math.random() * 120;
    piece.style.setProperty("--x", `${Math.cos(angle) * distance}px`);
    piece.style.setProperty("--y", `${Math.sin(angle) * distance - 80}px`);
    piece.style.setProperty("--r", `${Math.random() * 360}deg`);
    piece.style.background = colors[index % colors.length];
    layer.appendChild(piece);
  }

  layer.classList.remove("is-active");
  void layer.offsetWidth;
  layer.classList.add("is-active");
  window.setTimeout(() => {
    layer.classList.remove("is-active");
    layer.innerHTML = "";
  }, 1000);
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

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatKoreanDate(value) {
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}
