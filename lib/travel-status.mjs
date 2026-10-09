export function travelUnavailableMessage({ hasOrigin, hasPlayAt, hasDestination }) {
  if (!hasOrigin) return 'Add a start location to calculate travel time';
  if (!hasPlayAt) return 'Listing time unavailable';
  if (!hasDestination) return 'Verified coordinates unavailable for this venue';
  return '';
}
