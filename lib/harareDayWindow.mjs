export function getHarareDayWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Harare",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const dateKey = `${values.year}-${values.month}-${values.day}`;
  const nextDate = new Date(Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day) + 1,
  ));
  const nextDateKey = [
    nextDate.getUTCFullYear(),
    String(nextDate.getUTCMonth() + 1).padStart(2, "0"),
    String(nextDate.getUTCDate()).padStart(2, "0"),
  ].join("-");

  return {
    start: new Date(`${dateKey}T00:00:00+02:00`),
    end: new Date(`${nextDateKey}T00:00:00+02:00`),
  };
}
