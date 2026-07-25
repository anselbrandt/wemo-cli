import fs from "fs/promises";
import path from "path";

// Per-weekday on/off times, edited from the web UI and applied by scheduler.ts.
// This replaces the crontab entries that used to drive on.ts/off.ts.
//
// Times are LITERAL local clock times on the named calendar day: Saturday's
// "off" at 01:00 fires at 1am Saturday morning, not Saturday night. Same
// semantics cron had. To stay up late on a Friday, set Saturday's off time.
export type Day = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

// "HH:MM" in 24h local time, or null for "no event that day".
export interface DaySchedule {
  on: string | null;
  off: string | null;
}

export type Schedule = Record<Day, DaySchedule>;

export const DAYS: Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const SCHEDULE_PATH =
  process.env.WEMO_SCHEDULE || path.join(__dirname, "..", "schedule.json");

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

// Defaults reproduce the crontab this feature replaced, so behaviour is
// unchanged until the schedule is edited. Kept in code rather than a seed file
// (unlike devices.seed.json, whose DHCP-reserved IPs can't be derived).
export function defaultSchedule(): Schedule {
  const weekday: DaySchedule = { on: "08:45", off: "00:00" };
  const weekend: DaySchedule = { on: "10:00", off: "00:00" };
  return {
    Mon: { ...weekday },
    Tue: { ...weekday },
    Wed: { ...weekday },
    Thu: { ...weekday },
    Fri: { ...weekday },
    Sat: { ...weekend },
    Sun: { ...weekend },
  };
}

// Coerce untrusted input (the POST body, or a hand-edited schedule.json) into a
// Schedule, or null if it isn't one. Validating before persisting keeps a bad
// write from wedging the scheduler. A blank string is how the UI sends "cleared".
export function parseSchedule(raw: unknown): Schedule | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;

  for (const key of Object.keys(input)) {
    if (!DAYS.includes(key as Day)) return null;
  }

  const parsed = {} as Schedule;
  for (const day of DAYS) {
    const entry = input[day];
    if (entry === undefined) {
      // Absent day means "no events", not "use the default" — a partial POST
      // must not silently resurrect times the user just cleared.
      parsed[day] = { on: null, off: null };
      continue;
    }
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return null;
    }
    const times = entry as Record<string, unknown>;
    const on = parseTime(times.on);
    const off = parseTime(times.off);
    if (on === undefined || off === undefined) return null;
    parsed[day] = { on, off };
  }
  return parsed;
}

// null/""/absent → null (no event); a valid "HH:MM" → itself; anything else →
// undefined, which the caller treats as a validation failure.
function parseTime(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  return TIME_PATTERN.test(value) ? value : undefined;
}

export async function loadSchedule(): Promise<Schedule> {
  try {
    const raw = await fs.readFile(SCHEDULE_PATH, "utf-8");
    const parsed = parseSchedule(JSON.parse(raw));
    if (!parsed) {
      console.log("schedule load error: invalid contents, using defaults");
      return defaultSchedule();
    }
    return parsed;
  } catch (error: any) {
    if (error?.code === "ENOENT") return defaultSchedule();
    console.log("schedule load error:", error);
    return defaultSchedule();
  }
}

export async function saveSchedule(schedule: Schedule): Promise<void> {
  await fs.writeFile(SCHEDULE_PATH, JSON.stringify(schedule, null, 2) + "\n");
}

export function schedulePath(): string {
  return SCHEDULE_PATH;
}
