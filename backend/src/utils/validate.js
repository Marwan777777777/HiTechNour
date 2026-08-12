function isValidLat(lat) {
  return typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

function isValidLng(lng) {
  return typeof lng === "number" && Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

function isValidRadius(radius) {
  return typeof radius === "number" && Number.isFinite(radius) && radius > 0 && radius <= 5000;
}

function isNonEmptyString(value, maxLen = 255) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLen;
}

module.exports = { isValidLat, isValidLng, isValidRadius, isNonEmptyString };
