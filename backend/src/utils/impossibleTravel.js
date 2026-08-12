const { haversineMeters } = require("./geo");

// Generous upper bound (~144 km/h) so normal car travel in Cairo never
// false-flags. Tune down if you want it stricter.
const MAX_PLAUSIBLE_SPEED_MPS = 40;

function isImpossibleTravel(prevCheckin, newLat, newLng, newTimestamp) {
  if (!prevCheckin) return false;
  const distance = haversineMeters(prevCheckin.lat, prevCheckin.lng, newLat, newLng);
  const seconds = (new Date(newTimestamp) - new Date(prevCheckin.created_at)) / 1000;
  if (seconds <= 0) return false;
  const impliedSpeed = distance / seconds;
  return impliedSpeed > MAX_PLAUSIBLE_SPEED_MPS;
}

module.exports = { isImpossibleTravel };
