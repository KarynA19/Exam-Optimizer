export function toDate(dateText: string) {
  return new Date(`${dateText}T00:00:00`);
}

export function diffDays(firstDate: string, secondDate: string) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.round(Math.abs(toDate(firstDate).getTime() - toDate(secondDate).getTime()) / millisecondsPerDay);
}

export function formatCalendarLabel(dateText: string) {
  return toDate(dateText).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function isWeekend(dateText: string) {
  const day = toDate(dateText).getDay();
  return day === 5 || day === 6;
}
