// Simple EN / AR dictionary + direction switching + live UI apply
const I18N = {
  en: {
    appName: "HiTechNour",
    siteAttendance: "Site Attendance",
    username: "Username",
    password: "Password",
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
    username: "اسم المستخدم",
    password: "كلمة المرور",
    signIn: "تسجيل الدخول",
    checkIn: "تسجيل حضور",
    checkOut: "تسجيل انصراف",
    checkedIn: "تم تسجيل الحضور",
    checkedOut: "تم تسجيل الانصراف",
    offlineQueue: "تم الحفظ بدون إنترنت – سيتم المزامنة عند الاتصال",
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
