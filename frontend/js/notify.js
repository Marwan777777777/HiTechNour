// Browser + service-worker notification helpers for HiTechNour.
// Permission is requested only from an explicit user action in Profile;
// background polling never surprises the user with a permission prompt.
(function () {
  async function ensurePermission() {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    try {
      const result = await Notification.requestPermission();
      return result === "granted";
    } catch (_) {
      return false;
    }
  }

  async function showLocal(title, body, tag) {
    if (!("Notification" in window) || Notification.permission !== "granted") return false;
    const options = {
      body: body || "",
      tag: tag || "htn",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      data: { url: "/index.html" },
    };
    try {
      // Persistent service-worker notifications work on mobile where the
      // page Notification() constructor is unsupported.
      const registration = await navigator.serviceWorker?.getRegistration();
      if (registration) {
        await registration.showNotification(title, options);
        return true;
      }
    } catch (_) {}

    try {
      const n = new Notification(title, options);
      n.onclick = () => { window.focus(); n.close(); };
      return true;
    } catch (_) {
      return false;
    }
  }

  let lastSeenId = Number(localStorage.getItem("htn_last_notif_id") || 0);

  async function pollNotifications() {
    if (!window.Api || !Auth.getToken()) return;
    try {
      const list = await Api.getNotifications();
      if (!Array.isArray(list) || !list.length) return;
      const newest = list[0];
      if (newest.id > lastSeenId) {
        const fresh = list.filter((n) => n.id > lastSeenId && !n.read).slice(0, 5);
        for (const n of fresh.reverse()) await showLocal(n.title, n.body, "htn-" + n.id);
        lastSeenId = newest.id;
        localStorage.setItem("htn_last_notif_id", String(lastSeenId));
      }
    } catch (_) {}
  }

  window.HTNNotify = { ensurePermission, showLocal, pollNotifications };

  function start() {
    if (!Auth.getToken()) return;
    // Polling is for users who already granted notification permission.
    // In-app Alerts still work even when permission is denied.
    pollNotifications();
    setInterval(pollNotifications, 45000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(start, 2500));
  else setTimeout(start, 2500);
  window.addEventListener("online", pollNotifications);
})();
