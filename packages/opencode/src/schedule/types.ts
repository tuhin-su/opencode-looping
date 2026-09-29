export type TaskStatus = "idle" | "running" | "completed" | "failed"

export type ScheduledTask = {
  id: string
  name: string
  schedule: string
  prompt?: string
  command?: string
  directory: string
  enabled: boolean
  createdAt: number
  lastRunAt?: number
  nextRunAt: number
  status: TaskStatus
  lastResult?: string
  lastError?: string
}

export type CreateTaskInput = {
  name?: string
  schedule: string
  prompt?: string
  command?: string
  directory?: string
}

export type DaemonInfo = {
  pid: number
  startedAt: number
  lastHeartbeat: number
  status: "running" | "stopped"
}

export type DaemonStatus = {
  running: boolean
  pid?: number
  startedAt?: number
  lastHeartbeat?: number
  taskCount: number
  dueCount: number
}
