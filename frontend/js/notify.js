// Browser + in-app notification helpers for HiTechNour
(function () {
  async function ensurePermission() {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    try {
      const r = await Notification.requestPermission();
      return r === "granted";
    } catch {
      return false;
    }
  }

  function showLocal(title, body, tag) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    try {
      const n = new Notification(title, {
        body: body || "",
        tag: tag || "htn",
        icon: "icons/icon-192.png",
        badge: "icons/icon-192.png",
      });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch (_) {}
  }

  // Poll in-app notifications and surface new ones as OS notifications
  let lastSeenId = Number(localStorage.getItem("htn_last_notif_id") || 0);

  async function pollNotifications() {
    if (!window.Api || !Auth.getToken()) return;
    try {
      const list = await Api.getNotifications();
      if (!Array.isArray(list) || !list.length) return;
      const newest = list[0];
      if (newest.id > lastSeenId) {
        const fresh = list.filter((n) => n.id > lastSeenId && !n.read).slice(0, 5);
        for (const n of fresh.reverse()) {
          showLocal(n.title, n.body, "htn-" + n.id);
        }
        lastSeenId = newest.id;
        localStorage.setItem("htn_last_notif_id", String(lastSeenId));
      }
    } catch (_) {}
  }

  window.HTNNotify = { ensurePermission, showLocal, pollNotifications };

  function loadWebAuthnClient() {
    if (document.getElementById("htn-webauthn-client-script")) return;
    const script = document.createElement("script");
    script.id = "htn-webauthn-client-script";
    script.src = "js/webauthn-client.js?v=1";
    script.async = false;
    document.head.appendChild(script);
  }

  // After login / when online, ask permission once and start light polling.
  function start() {
    loadWebAuthnClient();
    if (!Auth.getToken()) return;
    ensurePermission();
    pollNotifications();
    setInterval(pollNotifications, 45000);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(start, 2500));
  } else {
    setTimeout(start, 2500);
  }
  window.addEventListener("online", pollNotifications);
})();
