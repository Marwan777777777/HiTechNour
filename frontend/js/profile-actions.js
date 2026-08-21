// Account and notification controls that are kept separate from the core worker app.
(function () {
  function show(message, kind = "") {
    if (window.showToast) window.showToast(message, kind);
    else window.alert(message);
  }

  function injectProfileControls() {
    const panel = document.getElementById("panel-profile");
    if (!panel || document.getElementById("account-security-section")) return;
    const section = document.createElement("section");
    section.id = "account-security-section";
    section.style.marginTop = "2rem";
    section.innerHTML = `
      <h3 style="margin:0 0 1rem">Account & security</h3>
      <label><span>Current password</span><input type="password" id="current-password" autocomplete="current-password" /></label>
      <label><span>New password</span><div style="position:relative"><input type="password" id="new-password" autocomplete="new-password" minlength="8" /><button type="button" class="icon-button" data-password-toggle="new-password" style="position:absolute;right:6px;top:50%;transform:translateY(-50%)" aria-label="Show password">👁</button></div></label>
      <label><span>Confirm new password</span><div style="position:relative"><input type="password" id="confirm-password" autocomplete="new-password" minlength="8" /><button type="button" class="icon-button" data-password-toggle="confirm-password" style="position:absolute;right:6px;top:50%;transform:translateY(-50%)" aria-label="Show password">👁</button></div></label>
      <div class="button-row" style="margin-top:.75rem;gap:.6rem;flex-wrap:wrap"><button type="button" id="change-password-btn" class="secondary-button">Change password</button><button type="button" id="enable-notifications-btn" class="secondary-button">Enable notifications</button></div>
      <p id="notification-status" class="meta" style="margin-top:.6rem"></p>
      <hr style="margin:1.5rem 0;border:0;border-top:1px solid var(--line,#e5e7eb)" />
      <button type="button" id="delete-account-btn" class="secondary-button" style="color:var(--red,#c62828);border-color:#efcaca">Delete my account</button>
      <p class="meta" style="margin-top:.5rem">Deleting your account revokes access and removes personal profile data while preserving attendance/audit records required by the system.</p>`;
    panel.appendChild(section);

    section.querySelectorAll("[data-password-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const input = document.getElementById(button.dataset.passwordToggle);
        if (!input) return;
        input.type = input.type === "password" ? "text" : "password";
        button.setAttribute("aria-label", input.type === "password" ? "Show password" : "Hide password");
      });
    });
    document.getElementById("change-password-btn").addEventListener("click", changePassword);
    document.getElementById("enable-notifications-btn").addEventListener("click", enableNotifications);
    document.getElementById("delete-account-btn").addEventListener("click", deleteAccount);
    updateNotificationStatus();
  }

  async function changePassword() {
    const currentPassword = document.getElementById("current-password").value;
    const newPassword = document.getElementById("new-password").value;
    const confirmPassword = document.getElementById("confirm-password").value;
    if (!currentPassword || !newPassword) return show("Current and new passwords are required.", "error");
    if (newPassword.length < 8) return show("New password must be at least 8 characters.", "error");
    if (newPassword !== confirmPassword) return show("New passwords do not match.", "error");
    const button = document.getElementById("change-password-btn");
    button.disabled = true;
    try {
      await Api.changeMyPassword(currentPassword, newPassword);
      Auth.logout();
      show("Password changed. Please sign in again.", "success");
      setTimeout(() => window.location.reload(), 700);
    } catch (err) { show(err.message, "error"); }
    finally { button.disabled = false; }
  }

  async function enableNotifications() {
    if (!window.HTNNotify) return show("Notification support is unavailable in this browser.", "error");
    const ok = await window.HTNNotify.ensurePermission();
    updateNotificationStatus();
    if (!ok) return show("Notifications were not enabled. Check your browser permission.", "error");
    await window.HTNNotify.showLocal("HiTechNour notifications enabled", "You will receive new alerts while the app is installed/active.", "htn-test");
    show("Notifications enabled.", "success");
  }

  function updateNotificationStatus() {
    const el = document.getElementById("notification-status");
    if (!el || !("Notification" in window)) return;
    el.textContent = `Browser notification permission: ${Notification.permission}.`;
  }

  async function deleteAccount() {
    if (!window.confirm("Delete your account? Your login and personal profile will be erased and access revoked. Attendance/audit history is retained.")) return;
    const button = document.getElementById("delete-account-btn");
    button.disabled = true;
    try {
      await Api.deleteMyAccount();
      Auth.logout();
      window.location.reload();
    } catch (err) { show(err.message, "error"); button.disabled = false; }
  }

  function boot() {
    injectProfileControls();
    const app = document.getElementById("app-screen");
    if (app) new MutationObserver(injectProfileControls).observe(app, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
