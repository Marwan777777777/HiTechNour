(function () {
  function parseMapsCoords(text) {
    if (!text || typeof text !== "string") return null;
    const s = text.trim();
    const tryPair = (a, b) => {
      const lat = Number(a), lng = Number(b);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
      return null;
    };
    let m = s.match(/@(-?\d+\.?\d*),\s*(-?\d+\.?\d*)/);
    if (m) { const r = tryPair(m[1], m[2]); if (r) return r; }
    m = s.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/);
    if (m) { const r = tryPair(m[1], m[2]); if (r) return r; }
    m = s.match(/[?&]q=(-?\d+\.?\d*)(?:%2C|,)\s*(-?\d+\.?\d*)/i);
    if (m) { const r = tryPair(m[1], m[2]); if (r) return r; }
    m = s.match(/[?&]ll=(-?\d+\.?\d*),(-?\d+\.?\d*)/i);
    if (m) { const r = tryPair(m[1], m[2]); if (r) return r; }
    m = s.match(/destination=(-?\d+\.?\d*)(?:%2C|,)(-?\d+\.?\d*)/i);
    if (m) { const r = tryPair(m[1], m[2]); if (r) return r; }
    m = s.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
    if (m) { const r = tryPair(m[1], m[2]); if (r) return r; }
    m = s.match(/\/search\/(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)/);
    if (m) { const r = tryPair(m[1], m[2]); if (r) return r; }
    return null;
  }
  function applyMapsLinkToForm() {
    const linkEl = document.getElementById("siteMapsLink");
    const hint = document.getElementById("siteMapsHint");
    if (!linkEl) return;
    const coords = parseMapsCoords(linkEl.value);
    if (coords) {
      const lat = document.getElementById("siteLat");
      const lng = document.getElementById("siteLng");
      if (lat) lat.value = coords.lat;
      if (lng) lng.value = coords.lng;
      if (hint) { hint.textContent = "Coordinates filled from Maps link \u2713"; hint.style.color = "var(--green, #22C55E)"; }
    } else if (linkEl.value.trim()) {
      if (hint) {
        hint.textContent = "Could not read coordinates. Open Google Maps \u2192 Share \u2192 Copy link (full link preferred), or type lat/lng below.";
        hint.style.color = "var(--amber, #F59E0B)";
      }
    } else if (hint) {
      hint.textContent = "Paste a Maps link \u2014 lat/lng fill automatically. Or enter coordinates below.";
      hint.style.color = "var(--ink-faint)";
    }
  }
  function wire() {
    const el = document.getElementById("siteMapsLink");
    if (!el || el.dataset.wired) return;
    el.dataset.wired = "1";
    el.addEventListener("input", applyMapsLinkToForm);
    el.addEventListener("paste", () => setTimeout(applyMapsLinkToForm, 50));
    el.addEventListener("change", applyMapsLinkToForm);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wire);
  else wire();
  setInterval(wire, 1000);
})();
