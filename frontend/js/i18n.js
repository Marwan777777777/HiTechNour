// Simple EN / AR dictionary + direction switching
const I18N = {
  en: {
    appName: "HiTechNour",
    checkIn: "Check In",
    checkOut: "Check Out",
    checkedIn: "Checked in",
    checkedOut: "Checked out",
    offlineQueue: "Saved offline – will sync when online",
    distance: "Distance",
    inside: "Inside geofence",
    outside: "Outside geofence",
    accuracy: "GPS accuracy",
    myHistory: "My recent activity",
    assignmentToday: "Today's assignment",
    assignmentTomorrow: "Tomorrow",
    team: "Team on site",
    noAssignment: "No assignment today",
    reports: "Field reports",
    newReport: "New report",
    submitReport: "Submit report",
    surveys: "Surveys",
    answer: "Answer",
    notifications: "Alerts",
    markRead: "Mark all read",
    profile: "Profile",
    fullName: "Full name",
    phone: "Phone",
    language: "Language",
    save: "Save",
    deleteAccount: "Delete my account",
    logout: "Sign out",
    pendingDevice: "Device awaiting admin approval",
    loading: "Loading…",
    error: "Something went wrong",
    syncing: "Syncing offline items…",
    queueCount: "pending offline",
    home: "Home",
    alerts: "Alerts",
  },
  ar: {
    appName: "هاي تك نور",
    checkIn: "تسجيل حضور",
    checkOut: "تسجيل انصراف",
    checkedIn: "تم تسجيل الحضور",
    checkedOut: "تم تسجيل الانصراف",
    offlineQueue: "تم الحفظ بدون إنترنت – سيتم المزامنة عند الاتصال",
    distance: "المسافة",
    inside: "داخل النطاق",
    outside: "خارج النطاق",
    accuracy: "دقة الـ GPS",
    myHistory: "نشاطي الأخير",
    assignmentToday: "مهمة اليوم",
    assignmentTomorrow: "غداً",
    team: "الفريق في الموقع",
    noAssignment: "لا توجد مهمة اليوم",
    reports: "تقارير ميدانية",
    newReport: "تقرير جديد",
    submitReport: "إرسال التقرير",
    surveys: "استبيانات",
    answer: "إجابة",
    notifications: "التنبيهات",
    markRead: "علم الكل كمقروء",
    profile: "الملف الشخصي",
    fullName: "الاسم الكامل",
    phone: "الهاتف",
    language: "اللغة",
    save: "حفظ",
    deleteAccount: "حذف حسابي",
    logout: "تسجيل الخروج",
    pendingDevice: "الجهاز في انتظار موافقة المسؤول",
    loading: "جاري التحميل…",
    error: "حدث خطأ",
    syncing: "جاري مزامنة العناصر غير المتصلة…",
    queueCount: "في الانتظار بدون إنترنت",
    home: "الرئيسية",
    alerts: "التنبيهات",
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

function initLocale() {
  const stored = getLocale();
  setLocale(stored);
}

// Call on load + wire any toggle buttons
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initLocale();
      document.body.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-lang-toggle]");
        if (btn) {
          e.preventDefault();
          toggleLocale();
        }
      });
    });
  } else {
    initLocale();
    document.body.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-lang-toggle]");
      if (btn) {
        e.preventDefault();
        toggleLocale();
      }
    });
  }
}
