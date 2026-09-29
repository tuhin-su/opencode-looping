import fs from "fs/promises"
import path from "path"
import os from "os"
import { spawn } from "child_process"
import { computeNextRun } from "./evaluator"
import * as Store from "./store"
import type { ScheduledTask, DaemonInfo, DaemonStatus } from "./types"

function getDaemonInfoPath(): string {
  const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
  const dir = path.join(stateHome, "opencode")
  return path.join(dir, "scheduler-daemon.json")
}

export async function isDaemonRunning(): Promise<{ running: boolean; pid?: number; info?: DaemonInfo }> {
  const file = getDaemonInfoPath()
  const content = await fs.readFile(file, "utf8").catch(() => undefined)
  if (!content) return { running: false }

  try {
    const info = JSON.parse(content) as DaemonInfo
    process.kill(info.pid, 0)
    return { running: true, pid: info.pid, info }
  } catch {
    await fs.unlink(file).catch(() => {})
    return { running: false }
  }
}

export async function getStatus(): Promise<DaemonStatus> {
  const { running, pid, info } = await isDaemonRunning()
  const tasks = await Store.list()
  const now = Date.now()
  const dueCount = tasks.filter((t) => t.enabled && t.nextRunAt <= now).length

  return {
    running,
    pid,
    startedAt: info?.startedAt,
    lastHeartbeat: info?.lastHeartbeat,
    taskCount: tasks.length,
    dueCount,
  }
}

export async function executeTask(task: ScheduledTask): Promise<{ success: boolean; output: string; error?: string }> {
  await Store.update(task.id, { status: "running" })

  return new Promise((resolve) => {
    let proc: ReturnType<typeof spawn>
    const cwd = task.directory || process.cwd()

    if (task.prompt) {
      const execPath = process.execPath
      const entry = process.argv[1]
      const args = entry ? [entry, "run", task.prompt] : ["run", task.prompt]
      proc = spawn(execPath, args, {
        cwd,
        env: { ...process.env, OPENCODE_NON_INTERACTIVE: "1" },
      })
    } else if (task.command) {
      proc = spawn("bash", ["-c", task.command], { cwd })
    } else {
      resolve({ success: false, output: "", error: "Task has neither prompt nor command" })
      return
    }

    let stdout = ""
    let stderr = ""

    proc.stdout?.on("data", (data) => {
      stdout += data.toString()
    })

    proc.stderr?.on("data", (data) => {
      stderr += data.toString()
    })

    proc.on("error", async (err) => {
      const next = computeNextRun(task.schedule)
      await Store.update(task.id, {
        status: "failed",
        lastRunAt: Date.now(),
        nextRunAt: next ? next.getTime() : task.nextRunAt,
        lastError: err.message,
      })
      resolve({ success: false, output: stdout, error: err.message })
    })

    proc.on("close", async (code) => {
      const success = code === 0
      const next = computeNextRun(task.schedule)
      await Store.update(task.id, {
        status: success ? "completed" : "failed",
        lastRunAt: Date.now(),
        nextRunAt: next ? next.getTime() : task.nextRunAt,
        lastResult: stdout.slice(-2000),
        lastError: success ? undefined : stderr.slice(-1000) || `Exited with code ${code}`,
      })

      const logDir = path.join(getLogsDir(), task.id)
      await fs.mkdir(logDir, { recursive: true }).catch(() => {})
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
      const logContent = `--- Task: ${task.name} (${task.id}) ---\nDate: ${new Date().toISOString()}\nStatus: ${success ? "SUCCESS" : "FAILED"}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}\n`
      await fs.writeFile(path.join(logDir, "latest.log"), logContent, "utf8").catch(() => {})
      await fs.writeFile(path.join(logDir, `${timestamp}.log`), logContent, "utf8").catch(() => {})

      if (success) {
        notifyUser(`OpenCode: ${task.name}`, stdout.slice(0, 180) || "Task completed successfully.")
      } else {
        notifyUser(`OpenCode Task Failed: ${task.name}`, stderr.slice(0, 180) || `Process exited with code ${code}`)
      }

      resolve({
        success,
        output: stdout,
        error: success ? undefined : stderr || `Process exited with code ${code}`,
      })
    })
  })
}

function getLogsDir(): string {
  const stateHome = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state")
  return path.join(stateHome, "opencode", "schedule_logs")
}

export async function getTaskLogs(taskId: string): Promise<string | undefined> {
  const file = path.join(getLogsDir(), taskId, "latest.log")
  return await fs.readFile(file, "utf8").catch(() => undefined)
}

function notifyUser(title: string, message: string) {
  const cleanMsg = message.replace(/"/g, '\\"').slice(0, 200)
  const cleanTitle = title.replace(/"/g, '\\"')
  if (process.platform === "linux") {
    spawn("notify-send", [cleanTitle, cleanMsg], { stdio: "ignore" }).on("error", () => {})
  } else if (process.platform === "darwin") {
    spawn("osascript", ["-e", `display notification "${cleanMsg}" with title "${cleanTitle}"`], { stdio: "ignore" }).on("error", () => {})
  }
}

export async function runDaemonLoop(signal?: AbortSignal): Promise<void> {
  const daemonFile = getDaemonInfoPath()
  const startedAt = Date.now()

  const writeHeartbeat = async () => {
    const info: DaemonInfo = {
      pid: process.pid,
      startedAt,
      lastHeartbeat: Date.now(),
      status: "running",
    }
    await fs.writeFile(daemonFile, JSON.stringify(info, null, 2), "utf8")
  }

  await writeHeartbeat()

  const cleanup = async () => {
    await fs.unlink(daemonFile).catch(() => {})
  }

  process.on("SIGTERM", async () => {
    await cleanup()
    process.exit(0)
  })

  process.on("SIGINT", async () => {
    await cleanup()
    process.exit(0)
  })

  while (!signal?.aborted) {
    await writeHeartbeat()

    const dueTasks = await Store.getDueTasks()
    for (const task of dueTasks) {
      if (signal?.aborted) break
      await executeTask(task)
    }

    // Check interval every 15 seconds
    const interval = 15000
    const startWait = Date.now()
    while (Date.now() - startWait < interval && !signal?.aborted) {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }

  await cleanup()
}

export async function startDaemon(): Promise<{ pid: number; started: boolean }> {
  const status = await isDaemonRunning()
  if (status.running && status.pid) {
    return { pid: status.pid, started: false }
  }

  const execPath = process.execPath
  const entry = process.argv[1]
  const args = entry ? [entry, "schedule", "daemon", "--foreground"] : ["schedule", "daemon", "--foreground"]

  const child = spawn(execPath, args, {
    detached: true,
    stdio: "ignore",
    env: { ...process.env },
  })
  child.unref()

  const pid = child.pid!
  return { pid, started: true }
}

export async function stopDaemon(): Promise<boolean> {
  const { running, pid } = await isDaemonRunning()
  if (!running || !pid) return false

  try {
    process.kill(pid, "SIGTERM")
    await fs.unlink(getDaemonInfoPath()).catch(() => {})
    return true
  } catch {
    return false
  }
}
