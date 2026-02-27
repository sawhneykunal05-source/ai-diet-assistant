const API_BASE = "";

const foodDb = [
  { name: "Oats (1 bowl)", calories: 220, protein: 8 },
  { name: "Grilled Chicken (150g)", calories: 280, protein: 42 },
  { name: "Paneer (100g)", calories: 265, protein: 18 },
  { name: "Brown Rice (1 cup)", calories: 215, protein: 5 },
  { name: "Greek Yogurt (200g)", calories: 130, protein: 18 },
  { name: "Boiled Eggs (2)", calories: 160, protein: 13 },
  { name: "Whey Shake (1 scoop)", calories: 125, protein: 24 },
  { name: "Apple + Peanut Butter", calories: 210, protein: 5 },
  { name: "Salmon (120g)", calories: 250, protein: 28 },
  { name: "Dal + Roti", calories: 330, protein: 14 }
];

const defaultState = {
  profile: { age: 28, gender: "male", height: 170, weight: 72, activity: 1.375, goal: "maintain" },
  target: { calories: 2200, protein: 144 },
  day: { consumedCalories: 0, consumedProtein: 0, waterMl: 0, steps: 0 },
  meals: [],
  weights: [],
  fastingStart: null,
  streak: 0,
  lastActiveDate: null
};

let auth = loadAuth();
let state = loadState();

populateFoodOptions();
hydrateUI();
bindEvents();
refreshAll();
initAuth();

function loadAuth() {
  const raw = localStorage.getItem("aiDietAuth");
  if (!raw) return { token: "", email: "" };
  try { return JSON.parse(raw); } catch { return { token: "", email: "" }; }
}

function saveAuth() {
  localStorage.setItem("aiDietAuth", JSON.stringify(auth));
}

function stateKey() {
  return auth.email ? `aiDietState:${auth.email}` : "aiDietState:guest";
}

function loadState() {
  const raw = localStorage.getItem(stateKey());
  if (!raw) {
    const fresh = structuredClone(defaultState);
    fresh.target = calculateTargets(fresh.profile);
    return fresh;
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(defaultState),
      ...parsed,
      profile: { ...defaultState.profile, ...parsed.profile },
      target: { ...defaultState.target, ...parsed.target },
      day: { ...defaultState.day, ...parsed.day },
      meals: Array.isArray(parsed.meals) ? parsed.meals : [],
      weights: Array.isArray(parsed.weights) ? parsed.weights : []
    };
  } catch {
    const fresh = structuredClone(defaultState);
    fresh.target = calculateTargets(fresh.profile);
    return fresh;
  }
}

function saveState() {
  localStorage.setItem(stateKey(), JSON.stringify(state));
}

function bindEvents() {
  document.getElementById("signupBtn").addEventListener("click", signup);
  document.getElementById("loginBtn").addEventListener("click", login);
  document.getElementById("logoutBtn").addEventListener("click", logout);
  document.getElementById("saveProfile").addEventListener("click", saveProfile);
  document.getElementById("addMeal").addEventListener("click", addMeal);
  document.getElementById("addWater").addEventListener("click", addWater);
  document.getElementById("addSteps").addEventListener("click", addSteps);
  document.getElementById("saveWeight").addEventListener("click", saveWeightEntry);
  document.getElementById("startFast").addEventListener("click", startFast);
  document.getElementById("sendChat").addEventListener("click", sendChat);
  document.getElementById("searchNutritionBtn").addEventListener("click", searchNutrition);
  document.getElementById("barcodeSearchBtn").addEventListener("click", searchBarcode);

  document.getElementById("chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
  document.getElementById("mealLog").addEventListener("click", removeMeal);
  document.getElementById("nutritionResults").addEventListener("click", addNutritionResultMeal);
}

function hydrateUI() {
  const p = state.profile;
  setValue("age", p.age);
  setValue("gender", p.gender);
  setValue("height", p.height);
  setValue("weight", p.weight);
  setValue("activity", String(p.activity));
  setValue("goal", p.goal);
}

function setValue(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function calculateTargets(profile) {
  const w = Number(profile.weight);
  const h = Number(profile.height);
  const a = Number(profile.age);
  const activity = Number(profile.activity);

  let bmr = 10 * w + 6.25 * h - 5 * a;
  bmr += profile.gender === "male" ? 5 : -161;

  let tdee = bmr * activity;
  if (profile.goal === "lose") tdee -= 400;
  if (profile.goal === "gain") tdee += 300;

  const proteinPerKg = profile.goal === "lose" ? 2.2 : 1.9;
  return {
    calories: Math.max(1200, Math.round(tdee)),
    protein: Math.round(w * proteinPerKg)
  };
}

async function signup() {
  const email = document.getElementById("authEmail").value.trim().toLowerCase();
  const password = document.getElementById("authPassword").value;
  if (!email || password.length < 6) return setAuthMsg("Use valid email and 6+ char password.");

  const res = await api("/api/auth/register", { method: "POST", body: { email, password } }, false);
  if (!res.ok) return setAuthMsg(res.error || "Signup failed");

  auth = { token: res.data.token, email: res.data.email };
  saveAuth();
  state = loadState();
  setAuthMsg("Signup successful.");
  await pullProfileFromServer();
}

async function login() {
  const email = document.getElementById("authEmail").value.trim().toLowerCase();
  const password = document.getElementById("authPassword").value;
  if (!email || !password) return setAuthMsg("Enter email and password.");

  const res = await api("/api/auth/login", { method: "POST", body: { email, password } }, false);
  if (!res.ok) return setAuthMsg(res.error || "Login failed");

  auth = { token: res.data.token, email: res.data.email };
  saveAuth();
  state = loadState();
  setAuthMsg("Logged in.");
  await pullProfileFromServer();
}

function logout() {
  auth = { token: "", email: "" };
  saveAuth();
  state = loadState();
  hydrateUI();
  refreshAll();
  setAuthMsg("Logged out.");
}

async function initAuth() {
  if (!auth.token) {
    refreshAuthStatus();
    return;
  }
  await pullProfileFromServer();
}

async function pullProfileFromServer() {
  refreshAuthStatus();
  if (!auth.token) return;
  const res = await api("/api/profile", { method: "GET" }, true);
  if (!res.ok || !res.data?.profile) return;
  state.profile = { ...state.profile, ...res.data.profile };
  state.target = calculateTargets(state.profile);
  hydrateUI();
  saveState();
  refreshAll();
}

function setAuthMsg(msg) {
  document.getElementById("authMessage").textContent = msg;
  refreshAuthStatus();
}

function refreshAuthStatus() {
  document.getElementById("authStatus").textContent = auth.email ? auth.email : "Guest mode";
}

async function saveProfile() {
  state.profile = {
    age: Number(document.getElementById("age").value || 28),
    gender: document.getElementById("gender").value,
    height: Number(document.getElementById("height").value || 170),
    weight: Number(document.getElementById("weight").value || 72),
    activity: Number(document.getElementById("activity").value || 1.375),
    goal: document.getElementById("goal").value
  };

  state.target = calculateTargets(state.profile);
  saveState();
  refreshAll();

  if (auth.token) {
    const res = await api("/api/profile", { method: "PUT", body: { profile: state.profile } }, true);
    if (!res.ok) setAuthMsg(`Profile save sync failed: ${res.error}`);
  }
}

function populateFoodOptions() {
  const el = document.getElementById("foodItem");
  el.innerHTML = "";
  foodDb.forEach((food, i) => {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `${food.name} (${food.calories} kcal)`;
    el.appendChild(opt);
  });
}

function addMealRecord(meal) {
  state.meals.unshift(meal);
  state.day.consumedCalories += meal.calories;
  state.day.consumedProtein += meal.protein;
  touchStreak();
  saveState();
  refreshAll();
}

function addMeal() {
  const mealType = document.getElementById("mealType").value;
  const foodIndex = Number(document.getElementById("foodItem").value || 0);
  const servings = Number(document.getElementById("servings").value || 1);
  const food = foodDb[foodIndex];
  if (!food || servings <= 0) return;

  addMealRecord({
    id: crypto.randomUUID(),
    mealType,
    food: food.name,
    servings,
    calories: Math.round(food.calories * servings),
    protein: Math.round(food.protein * servings),
    ts: Date.now()
  });
}

function removeMeal(e) {
  const btn = e.target.closest(".removeMeal");
  if (!btn) return;
  const id = btn.dataset.id;
  const idx = state.meals.findIndex((m) => m.id === id);
  if (idx === -1) return;

  const [meal] = state.meals.splice(idx, 1);
  state.day.consumedCalories = Math.max(0, state.day.consumedCalories - meal.calories);
  state.day.consumedProtein = Math.max(0, state.day.consumedProtein - meal.protein);
  saveState();
  refreshAll();
}

function addWater() {
  state.day.waterMl = Math.min(6000, state.day.waterMl + 250);
  touchStreak();
  saveState();
  refreshAll();
}

function addSteps() {
  const delta = Number(document.getElementById("stepsInput").value || 0);
  if (delta <= 0) return;
  state.day.steps = Math.min(100000, state.day.steps + delta);
  touchStreak();
  saveState();
  refreshAll();
}

function saveWeightEntry() {
  const w = Number(document.getElementById("logWeight").value);
  if (!w || w < 30) return;
  state.weights.push({ date: todayStr(), value: w });
  if (state.weights.length > 30) state.weights = state.weights.slice(-30);
  touchStreak();
  saveState();
  refreshAll();
}

function startFast() {
  state.fastingStart = Date.now();
  touchStreak();
  saveState();
  refreshAll();
}

async function searchNutrition() {
  const query = document.getElementById("nutritionQuery").value.trim();
  if (!query) return;
  const res = await api(`/api/nutrition/search?q=${encodeURIComponent(query)}`, { method: "GET" }, false);
  if (!res.ok) return renderNutritionResults([], res.error || "Search failed.");
  renderNutritionResults(res.data.items || [], "");
}

async function searchBarcode() {
  const code = document.getElementById("barcodeInput").value.trim();
  if (!code) return;
  const res = await api(`/api/nutrition/barcode/${encodeURIComponent(code)}`, { method: "GET" }, false);
  if (!res.ok) return renderNutritionResults([], res.error || "Barcode lookup failed.");
  const item = res.data.item;
  renderNutritionResults(item ? [item] : [], item ? "" : "No product found for barcode.");
}

function renderNutritionResults(items, msg) {
  const ul = document.getElementById("nutritionResults");
  ul.innerHTML = "";

  if (!items.length) {
    const li = document.createElement("li");
    li.textContent = msg || "No results.";
    ul.appendChild(li);
    return;
  }

  for (const item of items.slice(0, 20)) {
    const li = document.createElement("li");
    li.innerHTML = `<div><strong>${escapeHtml(item.name)}</strong><span class="mealMeta">${item.calories} kcal | ${item.protein}g protein (${item.serving || "100g"})</span></div><button class="primary addExtFood">Add</button>`;
    li.querySelector("button").dataset.food = JSON.stringify(item);
    ul.appendChild(li);
  }
}

function addNutritionResultMeal(e) {
  const btn = e.target.closest(".addExtFood");
  if (!btn) return;
  const item = JSON.parse(btn.dataset.food);
  const mealType = document.getElementById("mealType").value;
  addMealRecord({
    id: crypto.randomUUID(),
    mealType,
    food: item.name,
    servings: 1,
    calories: Math.round(item.calories),
    protein: Math.round(item.protein),
    ts: Date.now()
  });
}

async function sendChat() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text) return;

  appendChat("user", text);
  input.value = "";

  const context = [
    `Goal: ${state.profile.goal}`,
    `Target calories: ${state.target.calories}`,
    `Target protein: ${state.target.protein}`,
    `Today calories: ${state.day.consumedCalories}`,
    `Today protein: ${state.day.consumedProtein}`,
    `Today water ml: ${state.day.waterMl}`,
    `Today steps: ${state.day.steps}`
  ].join(" | ");

  const res = await api("/api/chat", { method: "POST", body: { message: text, context } }, true);
  if (!res.ok) return appendChat("bot", `AI error: ${res.error || "request failed"}`);
  appendChat("bot", res.data.reply || "No response from AI coach.");
}

function appendChat(role, text) {
  const chat = document.getElementById("chatWindow");
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function touchStreak() {
  const today = todayStr();
  if (state.lastActiveDate === today) return;

  if (!state.lastActiveDate) {
    state.streak = 1;
  } else {
    const prev = new Date(state.lastActiveDate);
    const now = new Date(today);
    const diff = Math.round((now - prev) / 86400000);
    state.streak = diff === 1 ? state.streak + 1 : 1;
  }
  state.lastActiveDate = today;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function fastingElapsed() {
  if (!state.fastingStart) return "Not started";
  const ms = Date.now() - state.fastingStart;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const done = h >= 16 ? " (feeding window started)" : "";
  return `Fasting ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m / 16h${done}`;
}

function weightTrendText() {
  if (state.weights.length < 2) return state.weights.length ? `Latest: ${state.weights.at(-1).value} kg` : "No entries yet.";
  const last = state.weights.at(-1).value;
  const first = state.weights[0].value;
  const delta = (last - first).toFixed(1);
  const sign = delta > 0 ? "+" : "";
  return `30-entry trend: ${sign}${delta} kg (latest ${last} kg)`;
}

function refreshAll() {
  document.getElementById("targetCalories").textContent = state.target.calories;
  document.getElementById("targetProtein").textContent = state.target.protein;

  document.getElementById("consumedCalories").textContent = state.day.consumedCalories;
  document.getElementById("consumedProtein").textContent = state.day.consumedProtein;
  document.getElementById("waterIntake").textContent = (state.day.waterMl / 1000).toFixed(2);
  document.getElementById("stepCount").textContent = state.day.steps;

  setProgress("calorieProgress", state.day.consumedCalories / state.target.calories * 100);
  setProgress("proteinProgress", state.day.consumedProtein / state.target.protein * 100);
  setProgress("waterProgress", state.day.waterMl / 3000 * 100);
  setProgress("stepsProgress", state.day.steps / 10000 * 100);

  document.getElementById("goalChip").textContent = `Goal: ${goalLabel(state.profile.goal)}`;
  document.getElementById("streakCount").textContent = `${state.streak} days`;
  document.getElementById("fastingStatus").textContent = fastingElapsed();
  document.getElementById("weightTrend").textContent = weightTrendText();

  renderMeals();
  refreshAuthStatus();
}

function setProgress(id, value) {
  document.getElementById(id).value = Math.max(0, Math.min(100, value || 0));
}

function goalLabel(goal) {
  if (goal === "lose") return "Fat Loss";
  if (goal === "gain") return "Muscle Gain";
  return "Maintenance";
}

function renderMeals() {
  const ul = document.getElementById("mealLog");
  ul.innerHTML = "";

  for (const meal of state.meals.slice(0, 30)) {
    const node = document.getElementById("mealTemplate").content.firstElementChild.cloneNode(true);
    node.querySelector(".mealName").textContent = `${meal.mealType}: ${meal.food}`;
    node.querySelector(".mealMeta").textContent = `${meal.calories} kcal | ${meal.protein}g protein | ${meal.servings} serving(s)`;
    node.querySelector(".removeMeal").dataset.id = meal.id;
    ul.appendChild(node);
  }

  if (!state.meals.length) {
    const li = document.createElement("li");
    li.textContent = "No meals logged yet.";
    ul.appendChild(li);
  }
}

async function api(path, options = {}, withAuth = false) {
  try {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (withAuth && auth.token) headers.Authorization = `Bearer ${auth.token}`;

    const res = await fetch(`${API_BASE}${path}`, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function escapeHtml(text) {
  return text.replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
}

setInterval(() => {
  document.getElementById("fastingStatus").textContent = fastingElapsed();
}, 60000);
