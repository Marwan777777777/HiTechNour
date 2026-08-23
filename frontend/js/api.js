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

const OfflineQueue = (() => {
  const DB_NAME = "htn_offline";
  const STORE = "queue";
  const VERSION = 2;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function enqueue(item) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).add({
        ...item,
        ownerUserId: item.ownerUserId ?? Auth.getUser()?.id ?? null,
        created: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function list() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function remove(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function countForCurrentUser() {
    const userId = Auth.getUser()?.id;
    if (!userId) return 0;
    const items = await list();
    return items.filter((item) => item.ownerUserId === userId).length;
  }

  async function hasPendingCheckin(type) {
    const userId = Auth.getUser()?.id;
    if (!userId) return false;
    const items = await list();
    return items.some(
      (item) => item.ownerUserId === userId && item.kind === "checkin" && item.payload?.type === type
    );
  }

  return {
    enqueue,
    list,
    remove,
    count: countForCurrentUser,
    countForCurrentUser,
    hasPendingCheckin,
  };
})();

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

async function checkInWithOffline(payload) {
  const userId = Auth.getUser()?.id;
  if (!userId) throw new Error("Your session is missing. Please sign in again.");

  const type = payload.type;
  if (type !== "check_in" && type !== "check_out") throw new Error("Invalid attendance action.");
  if (!payload.clientEventId) payload.clientEventId = getClientEventId();

  if (await OfflineQueue.hasPendingCheckin(type)) {
    const error = new Error(type === "check_in" ? "A check-in is already waiting to sync." : "A check-out is already waiting to sync.");
    error.code = "OFFLINE_EVENT_PENDING";
    throw error;
  }

  if (!navigator.onLine) {
    await OfflineQueue.enqueue({ kind: "checkin", ownerUserId: userId, payload });
    return { offline: true, message: "Saved offline – will sync when online." };
  }

  try {
    return await Api.checkIn(payload);
  } catch (err) {
    if (err.message.includes("Network error")) {
      await OfflineQueue.enqueue({ kind: "checkin", ownerUserId: userId, payload });
      return { offline: true, message: "Saved offline – will sync when online." };
    }
    throw err;
  }
}

async function submitReportWithOffline(payload) {
  const userId = Auth.getUser()?.id;
  if (!userId) throw new Error("Your session is missing. Please sign in again.");
  if (!navigator.onLine) {
    await OfflineQueue.enqueue({ kind: "report", ownerUserId: userId, payload });
    return { offline: true, message: "Report saved offline – will sync when online." };
  }
  try {
    return await Api.submitReport(payload);
  } catch (err) {
    if (err.message.includes("Network error")) {
      await OfflineQueue.enqueue({ kind: "report", ownerUserId: userId, payload });
      return { offline: true, message: "Report saved offline – will sync when online." };
    }
    throw err;
  }
}

async function flushOfflineQueue() {
  const currentUserId = Auth.getUser()?.id;
  if (!currentUserId || !navigator.onLine) return 0;

  const items = await OfflineQueue.list();
  let synced = 0;
  for (const item of items) {
    if (item.ownerUserId !== currentUserId) continue;

    try {
      if (item.kind === "checkin") await Api.checkIn(item.payload);
      else if (item.kind === "report") await Api.submitReport(item.payload);
      await OfflineQueue.remove(item.id);
      synced++;
    } catch (err) {
      if (err.status >= 400 && err.status < 500 && err.status !== 429) {
        await OfflineQueue.remove(item.id);
      }
    }
  }
  return synced;
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    flushOfflineQueue().then((n) => {
      if (n > 0 && window.showToast) window.showToast(`${n} offline item(s) synced`, "success");
    });
  });
}
