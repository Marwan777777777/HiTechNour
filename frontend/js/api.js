// ---- Configuration ----
const API_BASE_URL = window.HTN_API_BASE_URL || "http://localhost:4000/api";

function getDeviceId() {
  let id = localStorage.getItem("htn_device_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("htn_device_id", id);
  }
  return id;
}

function getClientEventId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const Auth = {
  getToken: () => localStorage.getItem("htn_token"),
  setToken: (token) => localStorage.setItem("htn_token", token),
  clearToken: () => localStorage.removeItem("htn_token"),
  getUser: () => {
    const raw = localStorage.getItem("htn_user");
    return raw ? JSON.parse(raw) : null;
  },
  setUser: (user) => localStorage.setItem("htn_user", JSON.stringify(user)),
  clearUser: () => localStorage.removeItem("htn_user"),
  logout() {
    this.clearToken();
    this.clearUser();
  },
};

// Offline attendance/report queuing has intentionally been removed.
// Attendance and reports are sent directly to the server so the UI never
// presents a misleading "ready to sync" state.
function clearLegacyOfflineQueue() {
  try {
    const request = indexedDB.deleteDatabase("htn_offline");
    request.onerror = () => {};
    request.onblocked = () => {};
  } catch (_) {}
}
clearLegacyOfflineQueue();

async function apiRequest(path, { method = "GET", body, isBlob = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = Auth.getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr) {
    throw new Error("Network error - check your connection and try again.");
  }

  if (response.status === 401) {
    if (token) {
      Auth.logout();
      window.location.reload();
      throw new Error("Session expired. Please sign in again.");
    }
  }

  if (isBlob) {
    if (!response.ok) throw new Error("Export failed.");
    return response.blob();
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    // no body
  }

  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (${response.status}).`);
    error.status = response.status;
    error.code = data?.code;
    throw error;
  }
  return data;
}

const Api = {
  login: (username, password) => apiRequest("/auth/login", { method: "POST", body: { username, password } }),
  me: () => apiRequest("/auth/me"),
  myAttendanceSummary: (month) => apiRequest(`/checkins/me/summary${month ? `?month=${month}` : ""}`),
  workerSummary: (id, month) => apiRequest(`/users/${id}/summary${month ? `?month=${month}` : ""}`),
  getSites: () => apiRequest("/sites"),
  getSkills: () => apiRequest("/skills"),
  createSkill: (name) => apiRequest("/skills", { method: "POST", body: { name } }),
  getSkillWorkers: (skillId) => apiRequest(`/skills/${skillId}/workers`),
  setWorkerSkill: (userId, skillId, level, notes) => apiRequest(`/skills/users/${userId}`, { method: "POST", body: { skillId, level, notes } }),
  removeWorkerSkill: (userId, skillId) => apiRequest(`/skills/users/${userId}/${skillId}`, { method: "DELETE" }),
  getSiteRequirements: (siteId) => apiRequest(`/skills/sites/${siteId}`),
  setSiteRequirement: (siteId, skillId, workersNeeded) => apiRequest(`/skills/sites/${siteId}`, { method: "POST", body: { skillId, workersNeeded } }),
  removeSiteRequirement: (siteId, skillId) => apiRequest(`/skills/sites/${siteId}/${skillId}`, { method: "DELETE" }),
  getOverview: () => apiRequest("/reports/overview"),
  getTeamBySite: () => apiRequest("/reports/team"),
  getWorkerDaily: (id, month) => apiRequest(`/users/${id}/daily${month ? `?month=${month}` : ""}`),
  updateUser: (id, patch) => apiRequest(`/users/${id}`, { method: "PATCH", body: patch }),
  deleteUser: (id) => apiRequest(`/users/${id}`, { method: "DELETE" }),
  getAllCheckins: () => apiRequest("/checkins"),
  createSite: (site) => apiRequest("/sites", { method: "POST", body: site }),
  updateSite: (id, patch) => apiRequest(`/sites/${id}`, { method: "PUT", body: patch }),
  checkIn: (payload) => apiRequest("/checkins", { method: "POST", body: payload }),
  myCheckins: () => apiRequest("/checkins/me"),
  allCheckins: (flaggedOnly) => apiRequest(`/checkins${flaggedOnly ? "?flagged=true" : ""}`),
  reviewCheckin: (id) => apiRequest(`/checkins/${id}/review`, { method: "PATCH" }),
  exportCsv: (startDate, endDate) => apiRequest(`/checkins/export?startDate=${startDate}&endDate=${endDate}`, { isBlob: true }),
  getUsers: (includeInactive = false) => apiRequest(`/users${includeInactive ? "?includeInactive=1" : ""}`),
  createUser: (user) => apiRequest("/users", { method: "POST", body: user }),
  approveDevice: (id) => apiRequest(`/users/${id}/approve-device`, { method: "POST" }),
  resetDevice: (id) => apiRequest(`/users/${id}/reset-device`, { method: "POST" }),
  forceLogout: (id) => apiRequest(`/users/${id}/force-logout`, { method: "POST" }),
  resetPassword: (id, newPassword) => apiRequest(`/users/${id}/reset-password`, { method: "POST", body: { newPassword } }),
  updateMyProfile: (patch) => apiRequest("/users/me", { method: "PATCH", body: patch }),
  deleteMyAccount: () => apiRequest("/users/me", { method: "DELETE" }),
  myAssignmentToday: () => apiRequest("/assignments/me/today"),
  mySchedule: () => apiRequest("/assignments/me"),
  getAssignments: (date) => apiRequest(`/assignments${date ? `?date=${date}` : ""}`),
  createAssignment: (a) => apiRequest("/assignments", { method: "POST", body: a }),
  updateAssignment: (id, patch) => apiRequest(`/assignments/${id}`, { method: "PATCH", body: patch }),
  deleteAssignment: (id) => apiRequest(`/assignments/${id}`, { method: "DELETE" }),
  submitReport: (payload) => apiRequest("/field/reports", { method: "POST", body: payload }),
  myReports: () => apiRequest("/field/reports/me"),
  allReports: (openOnly) => apiRequest(`/field/reports${openOnly ? "?open=true" : ""}`),
  reviewReport: (id) => apiRequest(`/field/reports/${id}/review`, { method: "PATCH" }),
  getSurveys: () => apiRequest("/field/surveys"),
  answerSurvey: (id, answer) => apiRequest(`/field/surveys/${id}/answer`, { method: "POST", body: { answer } }),
  createSurvey: (payload) => apiRequest("/field/surveys", { method: "POST", body: payload }),
  getAnnouncements: () => apiRequest("/field/announcements"),
  createAnnouncement: (payload) => apiRequest("/field/announcements", { method: "POST", body: payload }),
  getNotifications: () => apiRequest("/field/notifications"),
  markNotificationsRead: () => apiRequest("/field/notifications/read", { method: "POST" }),
  getActivity: () => apiRequest("/field/activity"),
};

// Compatibility wrappers kept so the existing app UI does not need a risky
// rewrite. They now perform a normal online request and never queue anything.
async function checkInWithOffline(payload) {
  const userId = Auth.getUser()?.id;
  if (!userId) throw new Error("Your session is missing. Please sign in again.");
  if (payload.type !== "check_in" && payload.type !== "check_out") {
    throw new Error("Invalid attendance action.");
  }
  if (!payload.clientEventId) payload.clientEventId = getClientEventId();
  return Api.checkIn(payload);
}

async function submitReportWithOffline(payload) {
  const userId = Auth.getUser()?.id;
  if (!userId) throw new Error("Your session is missing. Please sign in again.");
  return Api.submitReport(payload);
}

async function flushOfflineQueue() {
  return 0;
}

// Kept as a harmless compatibility object for older presentation code.
const OfflineQueue = {
  count: async () => 0,
};
