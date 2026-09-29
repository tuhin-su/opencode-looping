import fs from "fs/promises"
import path from "path"
import os from "os"
import { randomUUID } from "crypto"
import { computeNextRun } from "./evaluator"
import type { ScheduledTask, CreateTaskInput } from "./types"

function getStoragePath(): string {
  const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
  const dir = path.join(stateHome, "opencode")
  return path.join(dir, "schedule.json")
}

export async function list(): Promise<ScheduledTask[]> {
  const file = getStoragePath()
  const content = await fs.readFile(file, "utf8").catch(() => undefined)
  if (!content) return []
  return JSON.parse(content) as ScheduledTask[]
}

export async function get(id: string): Promise<ScheduledTask | undefined> {
  const all = await list()
  return all.find((item) => item.id === id)
}

async function saveAll(tasks: ScheduledTask[]): Promise<void> {
  const file = getStoragePath()
  const dir = path.dirname(file)
  await fs.mkdir(dir, { recursive: true })
  const temp = `${file}.${randomUUID()}.tmp`
  await fs.writeFile(temp, JSON.stringify(tasks, null, 2), "utf8")
  await fs.rename(temp, file)
}

export async function add(input: CreateTaskInput): Promise<ScheduledTask> {
  const nextRun = computeNextRun(input.schedule)
  if (!nextRun) {
    throw new Error(`Invalid schedule expression: "${input.schedule}"`)
  }

  const task: ScheduledTask = {
    id: `sched_${randomUUID().slice(0, 8)}`,
    name: input.name ?? (input.prompt ? input.prompt.slice(0, 30) : input.command ?? "Scheduled Task"),
    schedule: input.schedule,
    prompt: input.prompt,
    command: input.command,
    directory: input.directory ?? process.cwd(),
    enabled: true,
    createdAt: Date.now(),
    nextRunAt: nextRun.getTime(),
    status: "idle",
  }

  const all = await list()
  all.push(task)
  await saveAll(all)
  return task
}

export async function remove(id: string): Promise<boolean> {
  const all = await list()
  const index = all.findIndex((item) => item.id === id)
  if (index === -1) return false
  all.splice(index, 1)
  await saveAll(all)
  return true
}

export async function update(id: string, updates: Partial<ScheduledTask>): Promise<ScheduledTask | undefined> {
  const all = await list()
  const task = all.find((item) => item.id === id)
  if (!task) return undefined

  Object.assign(task, updates)
  if (updates.schedule && !updates.nextRunAt) {
    const next = computeNextRun(updates.schedule)
    if (next) task.nextRunAt = next.getTime()
  }

  await saveAll(all)
  return task
}

export async function getDueTasks(now = Date.now()): Promise<ScheduledTask[]> {
  const all = await list()
  return all.filter((task) => task.enabled && task.status !== "running" && task.nextRunAt <= now)
}
