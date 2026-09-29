export type ParsedSchedule =
  | { type: "cron"; minute: number[]; hour: number[]; dom: number[]; month: number[]; dow: number[]; raw: string }
  | { type: "interval"; ms: number; raw: string }

const DOW_MAP: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
}

function parseRange(expr: string, min: number, max: number): number[] {
  if (expr === "*") {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i)
  }
  if (expr.startsWith("*/")) {
    const step = parseInt(expr.slice(2), 10)
    if (isNaN(step) || step <= 0) return []
    const res: number[] = []
    for (let i = min; i <= max; i += step) res.push(i)
    return res
  }
  const parts = expr.split(",")
  const result = new Set<number>()
  for (const part of parts) {
    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-")
      const start = parseInt(startStr, 10)
      const end = parseInt(endStr, 10)
      if (!isNaN(start) && !isNaN(end) && start <= end) {
        for (let i = Math.max(min, start); i <= Math.min(max, end); i++) result.add(i)
      }
      continue
    }
    const val = parseInt(part, 10)
    if (!isNaN(val) && val >= min && val <= max) result.add(val)
  }
  return Array.from(result).sort((a, b) => a - b)
}

export function parseSchedule(expr: string): ParsedSchedule | undefined {
  const clean = expr.trim().toLowerCase()

  const intervalMatch = clean.match(/^every\s+(\d+)\s+(minute|minutes|hour|hours|day|days)$/)
  if (intervalMatch) {
    const count = parseInt(intervalMatch[1], 10)
    const unit = intervalMatch[2]
    const ms = unit.startsWith("minute")
      ? count * 60 * 1000
      : unit.startsWith("hour")
        ? count * 3600 * 1000
        : count * 86400 * 1000
    return { type: "interval", ms, raw: expr }
  }

  const dayMatch = clean.match(
    /^(?:every\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)(?:\s+at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?$/,
  )
  if (dayMatch) {
    const dow = DOW_MAP[dayMatch[1]]
    let hour = 9
    let minute = 0
    if (dayMatch[2] !== undefined) {
      let h = parseInt(dayMatch[2], 10)
      const m = dayMatch[3] ? parseInt(dayMatch[3], 10) : 0
      const ampm = dayMatch[4]
      if (ampm === "pm" && h < 12) h += 12
      if (ampm === "am" && h === 12) h = 0
      hour = h
      minute = m
    }
    return {
      type: "cron",
      minute: [minute],
      hour: [hour],
      dom: parseRange("*", 1, 31),
      month: parseRange("*", 1, 12),
      dow: [dow],
      raw: expr,
    }
  }

  if (clean === "daily" || clean === "every day") {
    return {
      type: "cron",
      minute: [0],
      hour: [0],
      dom: parseRange("*", 1, 31),
      month: parseRange("*", 1, 12),
      dow: parseRange("*", 0, 6),
      raw: expr,
    }
  }

  if (clean === "hourly" || clean === "every hour") {
    return {
      type: "cron",
      minute: [0],
      hour: parseRange("*", 0, 23),
      dom: parseRange("*", 1, 31),
      month: parseRange("*", 1, 12),
      dow: parseRange("*", 0, 6),
      raw: expr,
    }
  }

  if (clean === "weekdays" || clean === "every weekday") {
    return {
      type: "cron",
      minute: [0],
      hour: [9],
      dom: parseRange("*", 1, 31),
      month: parseRange("*", 1, 12),
      dow: [1, 2, 3, 4, 5],
      raw: expr,
    }
  }

  const cronTokens = clean.split(/\s+/)
  if (cronTokens.length === 5) {
    const minute = parseRange(cronTokens[0], 0, 59)
    const hour = parseRange(cronTokens[1], 0, 23)
    const dom = parseRange(cronTokens[2], 1, 31)
    const month = parseRange(cronTokens[3], 1, 12)
    const dow = Array.from(new Set(parseRange(cronTokens[4], 0, 7).map((d) => (d === 7 ? 0 : d)))).sort((a, b) => a - b)
    if (minute.length && hour.length && dom.length && month.length && dow.length) {
      return {
        type: "cron",
        minute,
        hour,
        dom,
        month,
        dow,
        raw: expr,
      }
    }
  }

  return undefined
}

export function computeNextRun(expr: string, fromDate = new Date()): Date | undefined {
  const parsed = parseSchedule(expr)
  if (!parsed) return undefined

  if (parsed.type === "interval") {
    return new Date(fromDate.getTime() + parsed.ms)
  }

  const iter = new Date(fromDate.getTime())
  iter.setSeconds(0, 0)
  iter.setMinutes(iter.getMinutes() + 1)

  const maxIterations = 5 * 366 * 24 * 60
  for (let i = 0; i < maxIterations; i++) {
    const month = iter.getMonth() + 1
    if (!parsed.month.includes(month)) {
      iter.setMonth(iter.getMonth() + 1, 1)
      iter.setHours(0, 0, 0, 0)
      continue
    }

    const dom = iter.getDate()
    const dow = iter.getDay()
    if (!parsed.dom.includes(dom) || !parsed.dow.includes(dow)) {
      iter.setDate(iter.getDate() + 1)
      iter.setHours(0, 0, 0, 0)
      continue
    }

    const hour = iter.getHours()
    if (!parsed.hour.includes(hour)) {
      iter.setHours(iter.getHours() + 1, 0, 0, 0)
      continue
    }

    const minute = iter.getMinutes()
    if (!parsed.minute.includes(minute)) {
      iter.setMinutes(iter.getMinutes() + 1)
      continue
    }

    return iter
  }

  return undefined
}

export function describeSchedule(expr: string): string {
  const parsed = parseSchedule(expr)
  if (!parsed) return `Invalid schedule: ${expr}`
  if (parsed.type === "interval") return `Every ${(parsed.ms / 1000 / 60).toFixed(0)} minutes`
  return expr
}
