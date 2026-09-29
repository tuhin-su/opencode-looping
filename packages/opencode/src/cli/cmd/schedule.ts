import type { Argv } from "yargs"
import { Effect } from "effect"
import { cmd } from "./cmd"
import { effectCmd } from "../effect-cmd"
import { UI } from "../ui"
import * as Store from "../../schedule/store"
import * as Daemon from "../../schedule/daemon"

export const ScheduleCommand = cmd({
  command: "schedule",
  describe: "manage scheduled tasks and background daemon",
  builder: (yargs: Argv) =>
    yargs
      .command(ScheduleListCommand)
      .command(ScheduleAddCommand)
      .command(ScheduleRemoveCommand)
      .command(ScheduleRunCommand)
      .command(ScheduleLogsCommand)
      .command(ScheduleDaemonCommand)
      .demandCommand(),
  async handler() {},
})

export const ScheduleListCommand = effectCmd({
  command: ["list", "ls"],
  describe: "list all scheduled tasks",
  instance: false,
  builder: (yargs) =>
    yargs.option("format", {
      describe: "output format",
      type: "string",
      choices: ["table", "json"],
      default: "table",
    }),
  handler: Effect.fn("Cli.schedule.list")(function* (args) {
    const tasks = yield* Effect.promise(() => Store.list())

    if (tasks.length === 0) {
      UI.println("No scheduled tasks found.")
      return
    }

    if (args.format === "json") {
      console.log(JSON.stringify(tasks, null, 2))
      return
    }

    UI.println(UI.Style.TEXT_BOLD + "Scheduled Tasks:" + UI.Style.TEXT_NORMAL)
    for (const task of tasks) {
      const nextDate = new Date(task.nextRunAt).toLocaleString()
      const lastDate = task.lastRunAt ? new Date(task.lastRunAt).toLocaleString() : "never"
      const statusColor =
        task.status === "completed"
          ? UI.Style.TEXT_SUCCESS
          : task.status === "failed"
            ? UI.Style.TEXT_DANGER
            : task.status === "running"
              ? UI.Style.TEXT_WARNING
              : UI.Style.TEXT_DIM

      UI.println(`\n${UI.Style.TEXT_BOLD}[${task.id}] ${task.name}${UI.Style.TEXT_NORMAL}`)
      UI.println(`  Schedule:  ${task.schedule}`)
      UI.println(`  Next run:  ${nextDate}`)
      UI.println(`  Last run:  ${lastDate} (${statusColor}${task.status}${UI.Style.TEXT_NORMAL})`)
      if (task.prompt) UI.println(`  Prompt:    ${task.prompt}`)
      if (task.command) UI.println(`  Command:   ${task.command}`)
      if (task.lastError) UI.println(`  Error:     ${UI.Style.TEXT_DANGER}${task.lastError}${UI.Style.TEXT_NORMAL}`)
    }
  }),
})

export const ScheduleAddCommand = effectCmd({
  command: "add",
  describe: "schedule a new background task",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("schedule", {
        alias: "s",
        describe: "recurrence schedule (e.g. 'every monday', 'daily', 'every 2 hours', '0 9 * * 1')",
        type: "string",
        demandOption: true,
      })
      .option("prompt", {
        alias: "p",
        describe: "agent prompt to execute on schedule",
        type: "string",
      })
      .option("command", {
        alias: "c",
        describe: "shell command to execute on schedule",
        type: "string",
      })
      .option("name", {
        alias: "n",
        describe: "name for the scheduled task",
        type: "string",
      }),
  handler: Effect.fn("Cli.schedule.add")(function* (args) {
    if (!args.prompt && !args.command) {
      UI.error("Either --prompt or --command must be specified.")
      return
    }

    const task = yield* Effect.promise(() =>
      Store.add({
        schedule: args.schedule,
        prompt: args.prompt,
        command: args.command,
        name: args.name,
        directory: process.cwd(),
      }),
    )

    const nextDate = new Date(task.nextRunAt).toLocaleString()
    UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Scheduled task "${task.name}" added!` + UI.Style.TEXT_NORMAL)
    UI.println(`  ID:       ${task.id}`)
    UI.println(`  Schedule: ${task.schedule}`)
    UI.println(`  Next run: ${nextDate}`)

    const daemonStatus = yield* Effect.promise(() => Daemon.isDaemonRunning())
    if (!daemonStatus.running) {
      UI.println(
        UI.Style.TEXT_WARNING +
          `\nNote: The scheduler daemon is not running. Start it with:\n  opencode schedule daemon --start` +
          UI.Style.TEXT_NORMAL,
      )
    }
  }),
})

export const ScheduleRemoveCommand = effectCmd({
  command: ["remove <id>", "rm <id>"],
  describe: "remove a scheduled task",
  instance: false,
  builder: (yargs) =>
    yargs.positional("id", {
      describe: "task ID to remove",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.schedule.remove")(function* (args) {
    const success = yield* Effect.promise(() => Store.remove(args.id))
    if (success) {
      UI.println(UI.Style.TEXT_SUCCESS + `Task ${args.id} removed.` + UI.Style.TEXT_NORMAL)
    } else {
      UI.println(UI.Style.TEXT_DANGER + `Task ${args.id} not found.` + UI.Style.TEXT_NORMAL)
    }
  }),
})

export const ScheduleRunCommand = effectCmd({
  command: "run <id>",
  describe: "immediately execute a scheduled task",
  instance: false,
  builder: (yargs) =>
    yargs.positional("id", {
      describe: "task ID to run",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.schedule.run")(function* (args) {
    const task = yield* Effect.promise(() => Store.get(args.id))
    if (!task) {
      UI.println(UI.Style.TEXT_DANGER + `Task ${args.id} not found.` + UI.Style.TEXT_NORMAL)
      return
    }

    UI.println(`Executing scheduled task [${task.id}] ${task.name}...`)
    const result = yield* Effect.promise(() => Daemon.executeTask(task))
    if (result.success) {
      UI.println(UI.Style.TEXT_SUCCESS + "Task executed successfully!" + UI.Style.TEXT_NORMAL)
      if (result.output) UI.println(result.output)
    } else {
      UI.println(UI.Style.TEXT_DANGER + "Task execution failed:" + UI.Style.TEXT_NORMAL)
      if (result.error) UI.println(result.error)
      if (result.output) UI.println(result.output)
    }
  }),
})

export const ScheduleLogsCommand = effectCmd({
  command: ["logs <id>", "log <id>"],
  describe: "view latest execution logs for a scheduled task",
  instance: false,
  builder: (yargs) =>
    yargs.positional("id", {
      describe: "task ID to view logs for",
      type: "string",
      demandOption: true,
    }),
  handler: Effect.fn("Cli.schedule.logs")(function* (args) {
    const logs = yield* Effect.promise(() => Daemon.getTaskLogs(args.id))
    if (!logs) {
      UI.println(`No logs found for task ${args.id}. The task may not have run yet.`)
      return
    }
    console.log(logs)
  }),
})

export const ScheduleDaemonCommand = effectCmd({
  command: "daemon",
  describe: "manage the background scheduler daemon",
  instance: false,
  builder: (yargs) =>
    yargs
      .option("start", {
        describe: "start scheduler daemon in background",
        type: "boolean",
      })
      .option("stop", {
        describe: "stop running scheduler daemon",
        type: "boolean",
      })
      .option("status", {
        describe: "check scheduler daemon status",
        type: "boolean",
      })
      .option("foreground", {
        alias: "f",
        describe: "run scheduler daemon in foreground",
        type: "boolean",
      }),
  handler: Effect.fn("Cli.schedule.daemon")(function* (args) {
    if (args.stop) {
      const stopped = yield* Effect.promise(() => Daemon.stopDaemon())
      if (stopped) {
        UI.println(UI.Style.TEXT_SUCCESS + "Scheduler daemon stopped." + UI.Style.TEXT_NORMAL)
      } else {
        UI.println("No running scheduler daemon found.")
      }
      return
    }

    if (args.start) {
      const result = yield* Effect.promise(() => Daemon.startDaemon())
      if (result.started) {
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Scheduler daemon started in background (PID ${result.pid}).` + UI.Style.TEXT_NORMAL)
      } else {
        UI.println(`Scheduler daemon is already running (PID ${result.pid}).`)
      }
      return
    }

    if (args.foreground) {
      UI.println(UI.Style.TEXT_BOLD + "Starting scheduler daemon in foreground (Ctrl+C to exit)..." + UI.Style.TEXT_NORMAL)
      yield* Effect.promise(() => Daemon.runDaemonLoop())
      return
    }

    // Default or --status
    const status = yield* Effect.promise(() => Daemon.getStatus())
    UI.println(UI.Style.TEXT_BOLD + "Scheduler Daemon Status:" + UI.Style.TEXT_NORMAL)
    UI.println(`  Running:         ${status.running ? UI.Style.TEXT_SUCCESS + `Yes (PID ${status.pid})` + UI.Style.TEXT_NORMAL : UI.Style.TEXT_DIM + "No" + UI.Style.TEXT_NORMAL}`)
    if (status.startedAt) UI.println(`  Started:         ${new Date(status.startedAt).toLocaleString()}`)
    if (status.lastHeartbeat) UI.println(`  Last Heartbeat:  ${new Date(status.lastHeartbeat).toLocaleString()}`)
    UI.println(`  Total Tasks:     ${status.taskCount}`)
    UI.println(`  Tasks Due Now:   ${status.dueCount}`)

    if (!status.running) {
      UI.println("\nTo start the daemon in the background:")
      UI.println("  opencode schedule daemon --start")
    }
  }),
})

export const DaemonCommand = cmd({
  command: "daemon [action]",
  describe: "scheduler daemon controls (start, stop, status, run)",
  builder: (yargs: Argv) =>
    yargs.positional("action", {
      describe: "action: start, stop, status, run",
      type: "string",
      choices: ["start", "stop", "status", "run"],
      default: "status",
    }),
  async handler(args) {
    const action = args.action || "status"
    if (action === "start") {
      const res = await Daemon.startDaemon()
      if (res.started) {
        UI.println(UI.Style.TEXT_SUCCESS_BOLD + `Scheduler daemon started (PID ${res.pid}).` + UI.Style.TEXT_NORMAL)
      } else {
        UI.println(`Scheduler daemon is already running (PID ${res.pid}).`)
      }
      return
    }
    if (action === "stop") {
      const stopped = await Daemon.stopDaemon()
      if (stopped) {
        UI.println(UI.Style.TEXT_SUCCESS + "Scheduler daemon stopped." + UI.Style.TEXT_NORMAL)
      } else {
        UI.println("Scheduler daemon was not running.")
      }
      return
    }
    if (action === "run") {
      UI.println(UI.Style.TEXT_BOLD + "Running scheduler daemon in foreground (Ctrl+C to exit)..." + UI.Style.TEXT_NORMAL)
      await Daemon.runDaemonLoop()
      return
    }
    const status = await Daemon.getStatus()
    UI.println(UI.Style.TEXT_BOLD + "Scheduler Daemon Status:" + UI.Style.TEXT_NORMAL)
    UI.println(`  Running:       ${status.running ? UI.Style.TEXT_SUCCESS + `Yes (PID ${status.pid})` + UI.Style.TEXT_NORMAL : UI.Style.TEXT_DIM + "No" + UI.Style.TEXT_NORMAL}`)
    UI.println(`  Total Tasks:   ${status.taskCount}`)
    UI.println(`  Tasks Due:     ${status.dueCount}`)
  },
})
