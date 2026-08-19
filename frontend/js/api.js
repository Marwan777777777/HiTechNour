// ---- Configuration ----
// Set this to your deployed backend URL before shipping.
const API_BASE_URL = window.HTN_API_BASE_URL || "http://localhost:4000/api";

// ---- Device ID ----
// Not a real hardware fingerprint (a browser can't access that) - a
// random UUID generated once and persisted in localStorage. This is a
// soft anti-sharing signal, not a hard security boundary. See the admin
// approval workflow on the backend for how misuse is caught instead.
function getDeviceId() {
  let id = localStorage.getItem("htn_device_id");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("htn_device_id", id);
  }
  return id;
}

// ---- Token storage ----
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

// ---- Fetch wrapper ----
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
      // We sent a token and got rejected - that's a genuinely dead/expired
      // session, so force back to login.
      Auth.logout();
      window.location.reload();
      throw new Error("Session expired. Please sign in again.");
    }
    // No token was sent (e.g. this was a login attempt itself) - a 401
    // here just means wrong username/password, not an expired session.
    // Fall through so the real error message reaches the caller instead
    // of getting masked by a reload.
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
    throw new Error(data?.error || `Request failed (${response.status}).`);
  }
  return data;
}

const Api = {
  login: (username, password) =>
    apiRequest("/auth/login", { method: "POST", body: { username, password } }),
  me: () => apiRequest("/auth/me"),

  getSites: () => apiRequest("/sites"),
  createSite: (site) => apiRequest("/sites", { method: "POST", body: site }),
  updateSite: (id, patch) => apiRequest(`/sites/${id}`, { method: "PUT", body: patch }),

  checkIn: (payload) => apiRequest("/checkins", { method: "POST", body: payload }),
  myCheckins: () => apiRequest("/checkins/me"),
  allCheckins: (flaggedOnly) => apiRequest(`/checkins${flaggedOnly ? "?flagged=true" : ""}`),
  reviewCheckin: (id) => apiRequest(`/checkins/${id}/review`, { method: "PATCH" }),
  exportCsv: (startDate, endDate) =>
    apiRequest(`/checkins/export?startDate=${startDate}&endDate=${endDate}`, { isBlob: true }),

  getUsers: () => apiRequest("/users"),
  createUser: (user) => apiRequest("/users", { method: "POST", body: user }),
  updateUser: (id, patch) => apiRequest(`/users/${id}`, { method: "PATCH", body: patch }),
  approveDevice: (id) => apiRequest(`/users/${id}/approve-device`, { method: "POST" }),
  resetDevice: (id) => apiRequest(`/users/${id}/reset-device`, { method: "POST" }),
  forceLogout: (id) => apiRequest(`/users/${id}/force-logout`, { method: "POST" }),
  resetPassword: (id, newPassword) =>
    apiRequest(`/users/${id}/reset-password`, { method: "POST", body: { newPassword } }),

  myAssignmentToday: () => apiRequest("/assignments/me/today"),
  mySchedule: () => apiRequest("/assignments/me"),
  getAssignments: (date) => apiRequest(`/assignments${date ? `?date=${date}` : ""}`),
  createAssignment: (a) => apiRequest("/assignments", { method: "POST", body: a }),
  updateAssignment: (id, patch) => apiRequest(`/assignments/${id}`, { method: "PATCH", body: patch }),
  deleteAssignment: (id) => apiRequest(`/assignments/${id}`, { method: "DELETE" }),
};
