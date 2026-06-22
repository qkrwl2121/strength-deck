const STORAGE_KEY = "strength-deck-state-v1";

const lifts = {
  backSquat: "백스쿼트",
  frontSquat: "프론트스쿼트",
  deadlift: "데드리프트",
  pushPress: "푸시프레스",
  snatch: "스내치",
  cleanJerk: "클린 & 저크",
};

const defaultState = {
  profile: {
    height: 160,
    weight: 50,
    unit: "kg",
    activity: "크로스핏",
    days: 6,
    goal: "olympic",
    recovery: "normal",
  },
  maxes: {},
  plan: null,
  history: [],
  completedDates: {},
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

document.querySelector("#profileForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const previousUnit = unit(state.profile);
  state.profile = normalizeProfile(Object.fromEntries(new FormData(event.currentTarget).entries()));
  if (unit(state.profile) !== previousUnit) convertStoredWeights(previousUnit, unit(state.profile));
  rebuildPlanIfPossible();
  saveState();
  hydrateForms();
  updateUnitLabels();
  renderAll();
  closeProfile();
});

document.querySelector("#unitSelect").addEventListener("change", (event) => {
  const nextUnit = event.currentTarget.value;
  const previousUnit = unit(state.profile);
  if (nextUnit === previousUnit) return;
  state.profile.unit = nextUnit;
  convertStoredWeights(previousUnit, nextUnit);
  rebuildPlanIfPossible();
  saveState();
  hydrateForms();
  updateUnitLabels();
  renderAll();
});

document.querySelector("#maxForm").addEventListener("submit", (event) => {
  event.preventDefault();
  state.maxes = Object.fromEntries(new FormData(event.currentTarget).entries());
  Object.keys(state.maxes).forEach((key) => {
    state.maxes[key] = number(state.maxes[key]);
  });
  rebuildPlanIfPossible();
  saveState();
  renderAll();
  showStep("plan");
});

document.querySelector("#completeSession").addEventListener("click", () => {
  if (!state.plan?.sessions?.length) {
    showStep("maxes");
    return;
  }

  const today = isoDate(new Date());
  const doneSets = document.querySelectorAll("#todaySession input:checked").length;
  const totalSets = document.querySelectorAll("#todaySession input").length;
  const session = state.plan.sessions[0];
  state.completedDates[today] = true;
  state.history = (state.history || []).filter((item) => item.isoDate !== today);
  state.history.unshift({
    isoDate: today,
    date: new Date().toLocaleDateString("ko-KR"),
    title: session.title,
    doneSets: doneSets || totalSets,
    totalSets,
    unit: unit(state.profile),
    lifts: session.lifts.map((lift) => ({
      name: lift.name,
      summary: lift.sets.map((set) => `${set.percent}% ${set.sets}x${set.reps} ${set.weight}${unit(state.profile)}`).join(", "),
    })),
  });
  state.history = state.history.slice(0, 30);
  selectedCalendarDate = today;
  saveState();
  renderAll();
  showStep("calendar");
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
});

document.querySelector("#importData").addEventListener("change", async (event) => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    replaceState(normalizeState(parsed.state || parsed));
    saveState();
    hydrateForms();
    updateUnitLabels();
    renderAll();
    closeProfile();
  } catch {
    alert("가져오기 파일을 읽을 수 없습니다.");
  } finally {
    event.currentTarget.value = "";
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}

hydrateForms();
updateUnitLabels();
renderAll();
showStep("today");

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
    summary: `${profile.height || "-"}cm, ${profile.weight || "-"}${unit(profile)}, ${activity || "운동 정보 없음"} 기준. 1RM의 70-88%에서 시작하고 피로가 큰 주에는 90% 트레이닝 맥스를 기준으로 계산합니다.`,
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
  renderPlan();
  renderNutrition();
  renderTodaySession();
  renderHistory();
  renderCalendar();
  renderCalendarNavState();
}

function renderNutrition() {
  const profile = state.profile || {};
  const bodyWeightKg = unit(profile) === "lb" ? number(profile.weight) / 2.20462 : number(profile.weight);
  const days = number(profile.days) || 3;
  const activity = (profile.activity || "").toLowerCase();
  const isCrossfit = activity.includes("크로스핏") || activity.includes("crossfit");
  const activityMultiplier = days >= 6 ? 39 : days >= 4 ? 36 : 32;
  const calorieTarget = roundToNearest(bodyWeightKg * activityMultiplier + (isCrossfit ? 150 : 0), 50);
  const protein = Math.round(bodyWeightKg * 2);
  const carbs = Math.round(bodyWeightKg * (isCrossfit || days >= 5 ? 5 : 4));
  const fat = Math.round(bodyWeightKg * 0.8);

  document.querySelector("#nutritionCard").innerHTML = `<div class="nutrition-head">
    <div>
      <h2>오늘 섭취 목표</h2>
      <p>${profile.activity || "운동"} ${days}회/주 기준의 스트렝스 회복 가이드</p>
    </div>
    <span class="badge">${calorieTarget} kcal</span>
  </div>
  <div class="nutrition-grid">
    <div><strong>${protein}g</strong><span>단백질</span></div>
    <div><strong>${carbs}g</strong><span>탄수화물</span></div>
    <div><strong>${fat}g</strong><span>지방</span></div>
  </div>`;
}

function renderPlan() {
  const plan = state.plan;
  document.querySelector("#planTitle").textContent = plan?.title || "계획이 아직 없습니다.";
  document.querySelector("#planSummary").textContent = plan?.summary || "마이페이지에서 프로필을 저장하고 1RM을 입력해 주세요.";
  document.querySelector("#metricRow").innerHTML = (plan?.metrics || [])
    .map(([label, value]) => `<article class="metric"><strong>${value}</strong><span>${label}</span></article>`)
    .join("");
  document.querySelector("#weekList").innerHTML = (plan?.weeks || [])
    .map(
      ([week, title, percent, sets]) => `<article class="exercise-card">
        <header>
          <div>
            <h3>${week}: ${title}</h3>
            <p>${sets}</p>
          </div>
          <span class="badge">${percent}</span>
        </header>
      </article>`,
    )
    .join("");
  document.querySelector("#programList").innerHTML = plan?.sessions?.length
    ? plan.sessions.map(renderSessionCard).join("")
    : `<div class="empty-state">1RM을 입력하면 4주 블록과 오늘 세션이 생성됩니다.</div>`;
}

function renderSessionCard(session) {
  return `<article class="exercise-card">
    <header>
      <div>
        <h3>${session.title}</h3>
        <p>${session.note}</p>
      </div>
      <span class="badge">${session.lifts.length} lifts</span>
    </header>
    <div class="sets">
      ${session.lifts.map(renderLiftSummary).join("") || `<p>입력된 1RM이 없어 처방을 만들 수 없습니다.</p>`}
    </div>
  </article>`;
}

function renderLiftSummary(lift) {
  const unitLabel = unit(state.profile);
  const sets = lift.sets.map((set) => `${set.percent}% ${set.sets}x${set.reps} @ ${set.weight}${unitLabel}`).join(" / ");
  return `<div class="set-row"><strong>${lift.name}</strong><span>${sets}</span><span>TM ${lift.trainingMax}${unitLabel}</span></div>`;
}

function renderTodaySession() {
  const session = state.plan?.sessions?.[0];
  const isDone = Boolean(state.completedDates?.[isoDate(new Date())]);
  document.querySelector("#todayHint").textContent = session?.note || "프로필과 1RM을 입력하면 오늘 진행할 세션이 생성됩니다.";
  document.querySelector("#todaySession").innerHTML = session
    ? session.lifts.map(renderTodayLift).join("")
    : `<div class="empty-state">아직 생성된 세션이 없습니다. 1RM 화면에서 현재 최고 중량을 입력해 주세요.</div>`;
  const completeButton = document.querySelector("#completeSession");
  completeButton.textContent = session ? (isDone ? "오늘 완료됨" : "오늘 스트렝스 완료") : "1RM 입력하기";
  completeButton.classList.toggle("is-complete", isDone);
}

function renderTodayLift(lift) {
  return `<article class="exercise-card">
    <header>
      <div>
        <h3>${lift.name}</h3>
        <p>현재 1RM ${lift.max}${unit(state.profile)}, 트레이닝 맥스 ${lift.trainingMax}${unit(state.profile)}</p>
      </div>
      <span class="badge">1RM</span>
    </header>
    <div class="sets">
      ${lift.sets
        .map(
          (set, index) => `<label class="set-row">
            <strong>${set.percent}%</strong>
            <span>${set.sets}세트 x ${set.reps}회 · ${set.weight}${unit(state.profile)}</span>
            <input type="checkbox" aria-label="${lift.name} ${index + 1}번 처방 완료" />
          </label>`,
        )
        .join("")}
    </div>
  </article>`;
}

function renderHistory() {
  const history = state.history || [];
  document.querySelector("#historyList").innerHTML = history.length
    ? history.map((item) => `<div class="set-row"><strong>${item.date}</strong><span>${item.title}</span><span>${item.doneSets}/${item.totalSets}</span></div>`).join("")
    : `<div class="empty-state">아직 완료한 세션이 없습니다.</div>`;
}

function renderCalendar() {
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
    if (key === selectedCalendarDate) classes.push("is-selected");
    if (state.completedDates?.[key]) classes.push("is-done");
    cells.push(`<button class="${classes.join(" ")}" type="button" data-date="${key}"><b>${day}</b><em>${state.completedDates?.[key] ? "✓" : ""}</em></button>`);
  }
  document.querySelector("#calendarGrid").innerHTML = cells.join("");
  renderCalendarDetail();
}

function renderCalendarDetail() {
  const item = (state.history || []).find((entry) => entry.isoDate === selectedCalendarDate);
  const detail = document.querySelector("#calendarDetail");
  if (!item) {
    detail.innerHTML = `<div class="empty-state">${formatKoreanDate(selectedCalendarDate)} 완료 기록이 없습니다.</div>`;
    return;
  }

  detail.innerHTML = `<article class="exercise-card calendar-summary">
    <header>
      <div>
        <h3>${formatKoreanDate(selectedCalendarDate)}</h3>
        <p>${item.title} · ${item.doneSets}/${item.totalSets} 세트 완료</p>
      </div>
      <span class="badge">완료</span>
    </header>
    <div class="sets">
      ${(item.lifts || []).map((lift) => `<div class="set-row"><strong>${lift.name}</strong><span>${lift.summary}</span><span>✓</span></div>`).join("") || `<div class="set-row"><strong>기록</strong><span>${item.title}</span><span>✓</span></div>`}
    </div>
  </article>`;
}

function renderCalendarNavState() {
  document.querySelector("#calendarNavIcon").classList.toggle("has-check", Boolean(state.completedDates?.[isoDate(new Date())]));
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
  Object.entries(state.profile || {}).forEach(([key, value]) => {
    const field = document.querySelector(`#profileForm [name="${key}"]`);
    if (field) field.value = value;
  });
  Object.entries(state.maxes || {}).forEach(([key, value]) => {
    const field = document.querySelector(`#maxForm [name="${key}"]`);
    if (field && value) field.value = value;
  });
}

function normalizeState(raw) {
  const next = { ...defaultState, ...(raw || {}) };
  next.profile = normalizeProfile({ ...defaultState.profile, ...(raw?.profile || {}) });
  next.maxes = raw?.maxes || {};
  next.history = Array.isArray(raw?.history) ? raw.history : [];
  next.completedDates = raw?.completedDates || {};
  next.history.forEach((item) => {
    if (item.isoDate) next.completedDates[item.isoDate] = true;
  });
  if (Object.values(next.maxes).some((value) => number(value) > 0)) next.plan = buildPlan(next.profile, next.maxes);
  return next;
}

function normalizeProfile(profile) {
  return {
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

function rebuildPlanIfPossible() {
  if (Object.values(state.maxes || {}).some((value) => number(value) > 0)) state.plan = buildPlan(state.profile, state.maxes);
}

function convertStoredWeights(fromUnit, toUnit) {
  const factor = fromUnit === "kg" && toUnit === "lb" ? 2.20462 : fromUnit === "lb" && toUnit === "kg" ? 1 / 2.20462 : 1;
  if (state.profile.weight) state.profile.weight = roundToTenth(state.profile.weight * factor);
  Object.keys(state.maxes || {}).forEach((key) => {
    if (state.maxes[key]) state.maxes[key] = roundLoad(state.maxes[key] * factor, toUnit);
  });
}

function updateUnitLabels() {
  const unitLabel = unit(state.profile);
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

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

function roundLoad(value, targetUnit = unit(state.profile)) {
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
