(function () {
  "use strict";

  const API_BASE_URL = window.HTN_API_BASE_URL || "/api";
  const BIOMETRIC_FLAG = "htn_biometric_enabled";
  const PROMPT_FLAG = "htn_biometric_prompt_seen";

  function supported() {
    return window.isSecureContext &&
      "PublicKeyCredential" in window &&
      navigator.credentials &&
      typeof navigator.credentials.create === "function" &&
      typeof navigator.credentials.get === "function";
  }

  async function platformAuthenticatorAvailable() {
    if (!supported()) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  function bytesFromBase64Url(value) {
    const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function base64UrlFromBytes(value) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function publicKeyCreationOptions(options) {
    return {
      ...options,
      challenge: bytesFromBase64Url(options.challenge),
      user: {
        ...options.user,
        id: bytesFromBase64Url(options.user.id),
      },
      excludeCredentials: (options.excludeCredentials || []).map((credential) => ({
        ...credential,
        id: bytesFromBase64Url(credential.id),
      })),
    };
  }

  function publicKeyRequestOptions(options) {
    return {
      ...options,
      challenge: bytesFromBase64Url(options.challenge),
      allowCredentials: Array.isArray(options.allowCredentials)
        ? options.allowCredentials.map((credential) => ({
            ...credential,
            id: bytesFromBase64Url(credential.id),
          }))
        : undefined,
    };
  }

  function serializeRegistrationCredential(credential) {
    const response = credential.response;
    return {
      id: credential.id,
      rawId: base64UrlFromBytes(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment || undefined,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: {
        clientDataJSON: base64UrlFromBytes(response.clientDataJSON),
        attestationObject: base64UrlFromBytes(response.attestationObject),
        transports: typeof response.getTransports === "function" ? response.getTransports() : [],
        authenticatorData:
          typeof response.getAuthenticatorData === "function"
            ? base64UrlFromBytes(response.getAuthenticatorData())
            : undefined,
        publicKey:
          typeof response.getPublicKey === "function" && response.getPublicKey()
            ? base64UrlFromBytes(response.getPublicKey())
            : undefined,
        publicKeyAlgorithm:
          typeof response.getPublicKeyAlgorithm === "function"
            ? response.getPublicKeyAlgorithm()
            : undefined,
      },
    };
  }

  function serializeAuthenticationCredential(credential) {
    const response = credential.response;
    return {
      id: credential.id,
      rawId: base64UrlFromBytes(credential.rawId),
      type: credential.type,
      authenticatorAttachment: credential.authenticatorAttachment || undefined,
      clientExtensionResults: credential.getClientExtensionResults(),
      response: {
        clientDataJSON: base64UrlFromBytes(response.clientDataJSON),
        authenticatorData: base64UrlFromBytes(response.authenticatorData),
        signature: base64UrlFromBytes(response.signature),
        userHandle: response.userHandle ? base64UrlFromBytes(response.userHandle) : undefined,
      },
    };
  }

  async function request(path, { method = "GET", body, auth = false } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (auth) {
      const token = localStorage.getItem("htn_token");
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(data?.error || `Request failed (${response.status}).`);
    return data;
  }

  function toast(message, kind) {
    if (typeof window.showToast === "function") window.showToast(message, kind || "");
  }

  function ensureLoginButton() {
    const form = document.getElementById("login-form");
    const passwordInput = document.getElementById("login-password");
    if (!form || !passwordInput || document.getElementById("biometric-login-button")) return;

    const button = document.createElement("button");
    button.type = "button";
    button.id = "biometric-login-button";
    button.className = "biometric-login-button";
    button.innerHTML = '<span class="biometric-icon" aria-hidden="true">⌁</span><span>Sign in with Face ID / fingerprint</span>';
    button.addEventListener("click", biometricLogin);
    form.appendChild(button);
  }

  async function biometricLogin() {
    const button = document.getElementById("biometric-login-button");
    const errorEl = document.getElementById("login-error");
    if (button) {
      button.disabled = true;
      button.classList.add("is-loading");
    }
    errorEl?.classList.add("hidden");

    try {
      const options = await request("/webauthn/authentication-options");
      const credential = await navigator.credentials.get({
        publicKey: publicKeyRequestOptions(options),
      });
      if (!credential) throw new Error("No biometric credential was returned.");

      const result = await request("/webauthn/authentication-verify", {
        method: "POST",
        body: serializeAuthenticationCredential(credential),
      });

      localStorage.setItem(BIOMETRIC_FLAG, "1");
      localStorage.setItem(PROMPT_FLAG, "1");
      localStorage.setItem("htn_token", result.token);
      localStorage.setItem("htn_user", JSON.stringify(result.user));
      window.location.reload();
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = err.name === "NotAllowedError"
          ? "Biometric sign-in was cancelled or no registered passkey was found."
          : err.message || "Biometric sign-in failed.";
        errorEl.classList.remove("hidden");
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.classList.remove("is-loading");
      }
    }
  }

  function ensureEnrollmentStyles() {
    if (document.getElementById("htn-biometric-styles")) return;
    const style = document.createElement("style");
    style.id = "htn-biometric-styles";
    style.textContent = `
      .biometric-login-button{width:100%;margin-top:10px;min-height:46px;border:1px solid #2f5f9f;background:rgba(28,49,78,.72);color:#e8f1ff;border-radius:10px;font:600 13px Inter,sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:9px;transition:.18s ease}
      .biometric-login-button:hover{border-color:#4c8df7;background:rgba(40,72,112,.9);transform:translateY(-1px)}
      .biometric-login-button:disabled{opacity:.6;cursor:wait;transform:none}
      .biometric-icon{width:22px;height:22px;border:1px solid #5e9cff;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;color:#77adff;font-size:17px;line-height:1}
      .htn-bio-overlay{position:fixed;inset:0;background:rgba(3,9,18,.72);backdrop-filter:blur(8px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px}
      .htn-bio-card{width:min(440px,100%);background:#101a2c;border:1px solid #263d5f;border-radius:18px;box-shadow:0 28px 80px rgba(0,0,0,.45);padding:28px;color:#f5f8ff;font-family:Inter,sans-serif}
      .htn-bio-mark{width:54px;height:54px;border-radius:16px;background:#17345f;border:1px solid #2e5c96;display:flex;align-items:center;justify-content:center;font-size:25px;color:#69a1ff;margin-bottom:18px}
      .htn-bio-card h2{font:700 24px Space Grotesk,sans-serif;margin:0 0 8px}
      .htn-bio-card p{color:#9fb0c9;line-height:1.6;font-size:14px;margin:0 0 20px}
      .htn-bio-actions{display:flex;gap:10px;justify-content:flex-end}
      .htn-bio-actions button{border-radius:9px;padding:11px 15px;font:700 13px Inter,sans-serif;cursor:pointer}
      .htn-bio-skip{background:transparent;color:#9fb0c9;border:1px solid #2a3d5c}
      .htn-bio-enable{background:#3b82f6;color:white;border:1px solid #4d8ff7;min-width:150px}
      .htn-bio-enable:disabled{opacity:.6;cursor:wait}
      .htn-bio-status{font-size:12px;color:#8ea2bf;min-height:18px;margin-top:12px}
      .htn-biometric-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:999px;font:700 10px Inter,sans-serif;letter-spacing:.02em;vertical-align:middle;margin-left:7px}
      .htn-biometric-badge.on{color:#157447;background:#e7f8ef;border:1px solid #b9e8ce}
      .htn-biometric-badge.off{color:#64748b;background:#f3f5f8;border:1px solid #e2e7ef}
    `;
    document.head.appendChild(style);
  }

  async function enrollBiometric() {
    const enable = document.getElementById("htn-bio-enable");
    const status = document.getElementById("htn-bio-status");
    if (enable) enable.disabled = true;
    if (status) status.textContent = "Follow the Face ID / fingerprint prompt on your device…";

    try {
      const options = await request("/webauthn/registration-options", { auth: true });
      const credential = await navigator.credentials.create({
        publicKey: publicKeyCreationOptions(options),
      });
      if (!credential) throw new Error("No biometric credential was created.");

      const result = await request("/webauthn/registration-verify", {
        method: "POST",
        auth: true,
        body: serializeRegistrationCredential(credential),
      });

      localStorage.setItem(BIOMETRIC_FLAG, "1");
      localStorage.setItem(PROMPT_FLAG, "1");
      document.getElementById("htn-bio-overlay")?.remove();
      toast("Biometric sign-in is enabled on this device.", "success");
      ensureLoginButton();
    } catch (err) {
      if (status) {
        status.textContent = err.name === "NotAllowedError"
          ? "The biometric setup was cancelled. You can enable it later."
          : err.message || "Could not enable biometric sign-in.";
      }
      if (enable) enable.disabled = false;
    }
  }

  function showEnrollmentPrompt() {
    if (document.getElementById("htn-bio-overlay") || localStorage.getItem(PROMPT_FLAG) === "1") return;
    const user = (() => {
      try { return JSON.parse(localStorage.getItem("htn_user") || "null"); } catch { return null; }
    })();
    if (!user || user.role !== "employee") return;

    const overlay = document.createElement("div");
    overlay.id = "htn-bio-overlay";
    overlay.className = "htn-bio-overlay";
    overlay.innerHTML = `
      <section class="htn-bio-card" role="dialog" aria-modal="true" aria-labelledby="htn-bio-title">
        <div class="htn-bio-mark" aria-hidden="true">⌁</div>
        <h2 id="htn-bio-title">Enable faster sign-in</h2>
        <p>Use Face ID, fingerprint, or your device screen lock the next time you open HiTechNour. Your password stays available as a backup.</p>
        <div class="htn-bio-actions">
          <button type="button" class="htn-bio-skip" id="htn-bio-skip">Not now</button>
          <button type="button" class="htn-bio-enable" id="htn-bio-enable">Enable biometric</button>
        </div>
        <div class="htn-bio-status" id="htn-bio-status" aria-live="polite"></div>
      </section>`;
    document.body.appendChild(overlay);
    document.getElementById("htn-bio-skip").addEventListener("click", () => {
      localStorage.setItem(PROMPT_FLAG, "1");
      overlay.remove();
    });
    document.getElementById("htn-bio-enable").addEventListener("click", enrollBiometric);
  }

  async function maybePrepare() {
    ensureEnrollmentStyles();
    const available = await platformAuthenticatorAvailable();
    if (!available) return;

    const onLoginScreen = document.getElementById("login-screen") && !document.getElementById("login-screen").classList.contains("hidden");
    if (onLoginScreen && localStorage.getItem(BIOMETRIC_FLAG) === "1") ensureLoginButton();

    if (localStorage.getItem("htn_token")) {
      try {
        const status = await request("/webauthn/status", { auth: true });
        if (status.enabled) localStorage.setItem(BIOMETRIC_FLAG, "1");
        else localStorage.removeItem(BIOMETRIC_FLAG);
      } catch {}
    }
  }

  function watchForFirstLoginEnrollment() {
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - startedAt > 12000) {
        clearInterval(timer);
        return;
      }
      const token = localStorage.getItem("htn_token");
      const screen = document.getElementById("app-screen");
      if (!token || !screen || screen.classList.contains("hidden")) return;
      clearInterval(timer);
      if (localStorage.getItem(PROMPT_FLAG) === "1") return;
      try {
        const status = await request("/webauthn/status", { auth: true });
        if (!status.enabled) showEnrollmentPrompt();
        else {
          localStorage.setItem(BIOMETRIC_FLAG, "1");
          localStorage.setItem(PROMPT_FLAG, "1");
        }
      } catch {}
    }, 450);
  }

  function decorateAdminBiometrics() {
    if (!/admin\.html$/i.test(location.pathname)) return;
    let lastMapKey = "";

    async function loadUsers() {
      try {
        const token = localStorage.getItem("htn_token");
        if (!token) return null;
        const response = await fetch(`${API_BASE_URL}/users`, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) return null;
        const users = await response.json();
        const map = new Map(users.map((u) => [String(u.full_name || ""), !!u.biometrics_enabled]));
        const key = JSON.stringify([...map.entries()]);
        if (key !== lastMapKey) {
          lastMapKey = key;
          window.HTN_BIOMETRIC_USERS = map;
        }
        return map;
      } catch { return null; }
    }

    function decorate(root, map) {
      if (!root || !map) return;
      root.querySelectorAll("[data-htn-bio-decorated]").forEach((el) => el.removeAttribute("data-htn-bio-decorated"));
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);
      for (const node of textNodes) {
        const name = node.nodeValue?.trim();
        if (!name || !map.has(name)) continue;
        const parent = node.parentElement;
        if (!parent || parent.querySelector(".htn-biometric-badge")) continue;
        const badge = document.createElement("span");
        const enabled = map.get(name);
        badge.className = `htn-biometric-badge ${enabled ? "on" : "off"}`;
        badge.textContent = enabled ? "Biometric enabled" : "Biometric not set";
        parent.appendChild(badge);
      }
    }

    const refresh = async () => {
      const map = await loadUsers();
      if (!map) return;
      decorate(document.getElementById("teamBySite"), map);
      decorate(document.getElementById("devTableBody"), map);
      decorate(document.getElementById("dwName"), map);
    };

    const observer = new MutationObserver(() => refresh());
    const start = () => {
      observer.observe(document.body, { childList: true, subtree: true });
      refresh();
      setInterval(refresh, 8000);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
  }

  async function boot() {
    ensureEnrollmentStyles();
    await maybePrepare();
    decorateAdminBiometrics();

    // The password login handler lives in app.js. Wrapping Api.login lets us
    // keep that existing authentication flow untouched while offering the
    // biometric setup immediately after the first successful password login.
    const waitForApi = setInterval(() => {
      if (!window.Api && typeof Api === "undefined") return;
      clearInterval(waitForApi);
      if (typeof Api !== "undefined" && !Api.__htnBiometricWrapped) {
        const originalLogin = Api.login;
        Api.login = async function (username, password) {
          const result = await originalLogin(username, password);
          if (result?.user?.role === "employee") {
            watchForFirstLoginEnrollment();
          }
          return result;
        };
        Api.__htnBiometricWrapped = true;
      }
      const screenTimer = setInterval(() => {
        const loginScreen = document.getElementById("login-screen");
        if (loginScreen && !loginScreen.classList.contains("hidden") && localStorage.getItem(BIOMETRIC_FLAG) === "1") {
          ensureLoginButton();
        }
      }, 700);
      setTimeout(() => clearInterval(screenTimer), 15000);
    }, 100);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
