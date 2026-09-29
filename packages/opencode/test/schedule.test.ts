import { describe, test, expect } from "bun:test"
import { parseSchedule, computeNextRun, describeSchedule } from "../src/schedule/evaluator"
import * as Store from "../src/schedule/store"

describe("Schedule Evaluator", () => {
  test("parses natural day-of-week schedule: every monday", () => {
    const parsed = parseSchedule("every monday")
    expect(parsed).toBeDefined()
    if (parsed && parsed.type === "cron") {
      expect(parsed.dow).toEqual([1])
      expect(parsed.hour).toEqual([9])
      expect(parsed.minute).toEqual([0])
    }
  })

  test("parses every monday at specific time", () => {
    const parsed = parseSchedule("every monday at 14:30")
    expect(parsed).toBeDefined()
    if (parsed && parsed.type === "cron") {
      expect(parsed.dow).toEqual([1])
      expect(parsed.hour).toEqual([14])
      expect(parsed.minute).toEqual([30])
    }
  })

  test("parses intervals: every 15 minutes", () => {
    const parsed = parseSchedule("every 15 minutes")
    expect(parsed).toBeDefined()
    if (parsed && parsed.type === "interval") {
      expect(parsed.ms).toBe(15 * 60 * 1000)
    }
  })

  test("parses standard cron: 0 9 * * 1", () => {
    const parsed = parseSchedule("0 9 * * 1")
    expect(parsed).toBeDefined()
    if (parsed && parsed.type === "cron") {
      expect(parsed.minute).toEqual([0])
      expect(parsed.hour).toEqual([9])
      expect(parsed.dow).toEqual([1])
    }
  })

  test("computes next run for every monday in the future", () => {
    const refDate = new Date("2026-09-28T10:00:00Z") // Monday 10:00
    const next = computeNextRun("every monday", refDate)
    expect(next).toBeDefined()
    expect(next!.getTime()).toBeGreaterThan(refDate.getTime())
    expect(next!.getDay()).toBe(1) // Monday
  })

  test("computes next run for interval schedule", () => {
    const refDate = new Date("2026-09-28T10:00:00Z")
    const next = computeNextRun("every 30 minutes", refDate)
    expect(next).toBeDefined()
    expect(next!.getTime() - refDate.getTime()).toBe(30 * 60 * 1000)
  })

  test("describes schedule expressions", () => {
    expect(describeSchedule("every 15 minutes")).toBe("Every 15 minutes")
    expect(describeSchedule("every monday")).toBe("every monday")
  })
})

describe("Schedule Store", () => {
  test("adds, lists, and removes scheduled task", async () => {
    const task = await Store.add({
      name: "Test Monday Run",
      schedule: "every monday",
      prompt: "run sanity test",
      directory: "/tmp",
    })

    expect(task.id).toBeDefined()
    expect(task.name).toBe("Test Monday Run")
    expect(task.schedule).toBe("every monday")
    expect(task.nextRunAt).toBeGreaterThan(Date.now())

    const list = await Store.list()
    expect(list.some((t) => t.id === task.id)).toBe(true)

    const fetched = await Store.get(task.id)
    expect(fetched?.name).toBe("Test Monday Run")

    const removed = await Store.remove(task.id)
    expect(removed).toBe(true)

    const afterRemove = await Store.get(task.id)
    expect(afterRemove).toBeUndefined()
  })
})
