// Simple EN / AR dictionary + direction switching + live UI apply
const I18N = {
  en: {
    appName: "HiTechNour",
    siteAttendance: "Site Attendance",
    welcomeBack: "WELCOME BACK",
    loginTitle: "Sign in to continue",
    loginSubtitle: "Use your HiTechNour account to access attendance.",
    secureSignIn: "Secure sign in",
    about: "About Hitechnour",
    partners: "Partners",
    contact: "Contact",
    leftTitle: "ONE PLACE TO MANAGE EVERY WORKING DAY.",
    leftSubtitle: "Secure attendance, site visibility and workforce operations in one focused workspace.",
    verified: "Verified site attendance",
    locationAware: "Location-aware operations",
    builtFor: "Built for your workforce",
    platform: "HITECHNOUR · ATTENDANCE PLATFORM",
    username: "Username",
    password: "Password",
    showPassword: "Show password",
    hidePassword: "Hide password",
    signIn: "Sign In",
    checkIn: "Check In",
    checkOut: "Check Out",
    checkedIn: "Checked in",
    checkedOut: "Checked out",
    offlineQueue: "Saved offline – will sync when online",
    distance: "Distance",
    inside: "Inside",
    outside: "Outside",
    insideRange: "Inside range",
    outsideRange: "Outside range",
    locating: "Locating…",
    locationNeeded: "Location access needed",
    site: "Site",
    myAttendance: "My Attendance",
    days: "days",
    recentActivity: "Recent Activity",
    assignmentToday: "Today's assignment",
    noAssignment: "No assignment today",
    reports: "Reports",
    fieldReport: "Field Report",
    title: "Title",
    details: "Details",
    whatHappened: "What happened?",
    describeSituation: "Describe the situation on site…",
    submitReport: "Submit report",
    myReports: "My reports",
    noReports: "No reports yet.",
    alerts: "Alerts",
    markRead: "Mark all read",
    noAlerts: "No alerts yet.",
    profile: "Profile",
    fullName: "Full name",
    phone: "Phone",
    language: "Language",
    save: "Save",
    deleteAccount: "Delete my account",
    logout: "Sign out",
    pendingDevice: "Your device is awaiting admin approval. You can't check in until it's approved.",
    loading: "Loading…",
    home: "Home",
    waitingLocation: "Waiting for location…",
    titleBodyRequired: "Title and body are required",
    reportSubmitted: "Report submitted",
    markedRead: "Marked as read",
    profileSaved: "Profile saved",
    deleteConfirm: "Delete your account permanently? This cannot be undone.",
    offlineBadge: "offline",
    syncedItems: "offline item(s) synced",
  },
  ar: {
    appName: "هاي تك نور",
    siteAttendance: "حضور المواقع",
    welcomeBack: "مرحباً بعودتك",
    loginTitle: "سجّل الدخول للمتابعة",
    loginSubtitle: "استخدم حساب هاي تك نور للوصول إلى نظام الحضور.",
    secureSignIn: "تسجيل دخول آمن",
    about: "عن هاي تك نور",
    partners: "الشركاء",
    contact: "تواصل معنا",
    leftTitle: "مكان واحد لإدارة كل يوم عمل.",
    leftSubtitle: "حضور آمن، رؤية للمواقع وإدارة عمليات فريق العمل في مساحة عمل واحدة.",
    verified: "حضور مواقع موثّق",
    locationAware: "عمليات مرتبطة بالموقع",
    builtFor: "مصمم لفريق عملك",
    platform: "هاي تك نور · منصة الحضور",
    username: "اسم المستخدم",
    password: "كلمة المرور",
    showPassword: "إظهار كلمة المرور",
    hidePassword: "إخفاء كلمة المرور",
    signIn: "تسجيل الدخول",
    checkIn: "تسجيل حضور",
    checkOut: "تسجيل انصراف",
    checkedIn: "تم تسجيل الحضور",
    checkedOut: "تم تسجيل الانصراف",
    offlineQueue: "تم الحفظ بدون إنترنت – ستتم المزامنة عند الاتصال",
    distance: "المسافة",
    inside: "داخل",
    outside: "خارج",
    insideRange: "داخل النطاق",
    outsideRange: "خارج النطاق",
    locating: "جاري تحديد الموقع…",
    locationNeeded: "يلزم السماح بالموقع",
    site: "الموقع",
    myAttendance: "حضوري",
    days: "أيام",
    recentActivity: "النشاط الأخير",
    assignmentToday: "مهمة اليوم",
    noAssignment: "لا توجد مهمة اليوم",
    reports: "التقارير",
    fieldReport: "تقرير ميداني",
    title: "العنوان",
    details: "التفاصيل",
    whatHappened: "ماذا حدث؟",
    describeSituation: "اوصف الوضع في الموقع…",
    submitReport: "إرسال التقرير",
    myReports: "تقاريري",
    noReports: "لا توجد تقارير بعد.",
    alerts: "التنبيهات",
    markRead: "تعليم الكل كمقروء",
    noAlerts: "لا توجد تنبيهات بعد.",
    profile: "الملف الشخصي",
    fullName: "الاسم الكامل",
    phone: "الهاتف",
    language: "اللغة",
    save: "حفظ",
    deleteAccount: "حذف حسابي",
    logout: "تسجيل الخروج",
    pendingDevice: "جهازك بانتظار موافقة المسؤول. لا يمكنك تسجيل الحضور حتى تتم الموافقة.",
    loading: "جاري التحميل…",
    home: "الرئيسية",
    waitingLocation: "بانتظار الموقع…",
    titleBodyRequired: "العنوان والتفاصيل مطلوبان",
    reportSubmitted: "تم إرسال التقرير",
    markedRead: "تم تعليم الكل كمقروء",
    profileSaved: "تم حفظ الملف",
    deleteConfirm: "حذف حسابك نهائياً؟ لا يمكن التراجع عن هذا.",
    offlineBadge: "بدون إنترنت",
    syncedItems: "عنصر(عناصر) تمت مزامنته",
  },
};

function t(key) {
  const locale = localStorage.getItem("htn_locale") || "en";
  return (I18N[locale] && I18N[locale][key]) || I18N.en[key] || key;
}

function getLocale() {
  return localStorage.getItem("htn_locale") || "en";
}

function setLocale(locale) {
  if (locale !== "en" && locale !== "ar") return;
  localStorage.setItem("htn_locale", locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  syncLangToggles();
  applyTranslations();
}

function toggleLocale() {
  setLocale(getLocale() === "ar" ? "en" : "ar");
}

function syncLangToggles() {
  const loc = getLocale();
  document.querySelectorAll("[data-lang-toggle]").forEach((el) => {
    el.textContent = loc === "ar" ? "EN" : "ع";
    el.setAttribute("title", loc === "ar" ? "Switch to English" : "التبديل إلى العربية");
    el.setAttribute("aria-label", el.getAttribute("title"));
  });
}

function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    const text = t(key);
    const label = el.querySelector(".btn-label");
    if (label) label.textContent = text;
    else el.textContent = text;
  });

  const login = document.querySelector("#login-screen");
  if (login) {
    const loginKicker = login.querySelector(".login-kicker");
    const loginTitle = login.querySelector(".login-heading h1");
    const loginSubtitle = login.querySelector(".login-heading p");
    const security = login.querySelector(".login-security-note");
    const about = document.getElementById("open-company-about");
    const companyLinks = login.querySelectorAll(".company-link");
    const leftEyebrow = login.querySelector(".login-visual-copy .eyebrow");
    const leftTitle = login.querySelector(".login-visual-copy h2");
    const leftSubtitle = login.querySelector(".login-visual-copy p");
    const leftPoints = login.querySelectorAll(".login-visual-points span");
    const leftFooter = login.querySelector(".login-visual-footer");

    if (loginKicker) loginKicker.textContent = t("welcomeBack");
    if (loginTitle) loginTitle.textContent = t("loginTitle");
    if (loginSubtitle) loginSubtitle.textContent = t("loginSubtitle");
    if (security) security.innerHTML = `<i></i> ${t("secureSignIn")}`;
    if (about) about.textContent = t("about");
    if (companyLinks[1]) companyLinks[1].textContent = t("partners");
    if (companyLinks[2]) companyLinks[2].textContent = t("contact");
    if (leftEyebrow) leftEyebrow.textContent = t("siteAttendance");
    if (leftTitle) leftTitle.textContent = t("leftTitle");
    if (leftSubtitle) leftSubtitle.textContent = t("leftSubtitle");
    if (leftPoints[0]) leftPoints[0].lastChild.textContent = t("verified");
    if (leftPoints[1]) leftPoints[1].lastChild.textContent = t("locationAware");
    if (leftPoints[2]) leftPoints[2].lastChild.textContent = t("builtFor");
    if (leftFooter) leftFooter.textContent = t("platform");

    const passwordToggle = document.getElementById("toggle-password");
    if (passwordToggle) {
      const visible = document.getElementById("login-password")?.type === "text";
      const label = visible ? t("hidePassword") : t("showPassword");
      passwordToggle.setAttribute("aria-label", label);
      passwordToggle.setAttribute("title", label);
    }
  }

  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (key) el.setAttribute("placeholder", t(key));
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (key) el.setAttribute("title", t(key));
  });

  try {
    if (typeof state !== "undefined" && state.isCheckedIn !== undefined) {
      const btn = document.getElementById("checkin-button");
      const lab = btn && btn.querySelector(".btn-label");
      if (lab) lab.textContent = state.isCheckedIn ? t("checkOut") : t("checkIn");
    }
  } catch (_) {}
}

function initLocale() {
  setLocale(getLocale());
}

if (typeof document !== "undefined") {
  const boot = () => {
    initLocale();
    document.body.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-lang-toggle]");
      if (btn) {
        e.preventDefault();
        toggleLocale();
      }
    });
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}
