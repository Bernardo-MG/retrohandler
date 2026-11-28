export function formatReleaseDate(releaseDate: string): string | null {
  // EmulationStation requires a full timestamp, but metadata can contain a
  // year or a year-month when the exact release day is unknown.
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(releaseDate.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2] ?? '01');
  const day = Number(match[3] ?? '01');
  if (year < 1 || month < 1 || month > 12) {
    return null;
  }
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) {
    return null;
  }
  return `${match[1]}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}T000000`;
}
