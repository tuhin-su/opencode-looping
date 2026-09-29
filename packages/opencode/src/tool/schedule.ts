import { Effect, Schema } from "effect"
import { Tool } from "./tool"
import DESCRIPTION from "./schedule.txt"
import * as Store from "../schedule/store"
import * as Daemon from "../schedule/daemon"

export const Parameters = Schema.Struct({
  action: Schema.Literals(["add", "list", "remove", "run", "status"]).annotate({
    description: "The action to perform: add, list, remove, run, or status",
  }),
  schedule: Schema.optional(Schema.String).annotate({
    description: "Recurrence schedule, e.g. 'every monday', 'daily', 'every 2 hours', or cron '0 9 * * 1' (required for add)",
  }),
  prompt: Schema.optional(Schema.String).annotate({
    description: "The prompt for OpenCode to execute when scheduled",
  }),
  command: Schema.optional(Schema.String).annotate({
    description: "Optional shell command to execute instead of prompt",
  }),
  name: Schema.optional(Schema.String).annotate({
    description: "Optional short name for the scheduled task",
  }),
  id: Schema.optional(Schema.String).annotate({
    description: "The task ID (required for remove or run)",
  }),
})

export const ScheduleTool = Tool.define(
  "schedule",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "schedule",
            patterns: [params.action],
            always: ["*"],
            metadata: {},
          })

          if (params.action === "add") {
            if (!params.schedule) {
              return {
                title: "Schedule Task Failed",
                output: "Error: 'schedule' parameter is required to add a scheduled task (e.g. 'every monday', 'daily', '0 9 * * 1').",
                metadata: {},
              }
            }

            if (!params.prompt && !params.command) {
              return {
                title: "Schedule Task Failed",
                output: "Error: Either 'prompt' or 'command' must be specified for the scheduled task.",
                metadata: {},
              }
            }

            const task = yield* Effect.promise(() =>
              Store.add({
                name: params.name,
                schedule: params.schedule!,
                prompt: params.prompt,
                command: params.command,
                directory: process.cwd(),
              }),
            )

            // Auto-check daemon status
            const daemonStatus = yield* Effect.promise(() => Daemon.isDaemonRunning())
            const daemonNote = daemonStatus.running
              ? `Scheduler daemon is active (PID ${daemonStatus.pid}).`
              : "Note: The scheduler daemon is not currently running. Run `opencode schedule daemon` to start it."

            const nextIso = new Date(task.nextRunAt).toISOString()

            return {
              title: `Scheduled task: ${task.name}`,
              output: [
                `Task scheduled successfully:`,
                `- ID: ${task.id}`,
                `- Name: ${task.name}`,
                `- Schedule: ${task.schedule}`,
                `- Next run: ${nextIso}`,
                `- Target: ${task.prompt ? `Prompt "${task.prompt}"` : `Command "${task.command}"`}`,
                "",
                daemonNote,
              ].join("\n"),
              metadata: {
                id: task.id,
                nextRunAt: task.nextRunAt,
              },
            }
          }

          if (params.action === "list") {
            const tasks = yield* Effect.promise(() => Store.list())
            if (tasks.length === 0) {
              return {
                title: "Scheduled Tasks (0)",
                output: "No scheduled tasks found.",
                metadata: {},
              }
            }

            const output = tasks
              .map((t) => {
                const nextStr = new Date(t.nextRunAt).toLocaleString()
                const lastStr = t.lastRunAt ? new Date(t.lastRunAt).toLocaleString() : "never"
                return `• [${t.id}] ${t.name}\n  Schedule: ${t.schedule}\n  Next run: ${nextStr}\n  Last run: ${lastStr} (${t.status})\n  Target: ${t.prompt ?? t.command}`
              })
              .join("\n\n")

            return {
              title: `Scheduled Tasks (${tasks.length})`,
              output,
              metadata: { count: tasks.length },
            }
          }

          if (params.action === "remove") {
            if (!params.id) {
              return {
                title: "Remove Scheduled Task Failed",
                output: "Error: 'id' parameter is required to remove a scheduled task.",
                metadata: {},
              }
            }

            const removed = yield* Effect.promise(() => Store.remove(params.id!))
            return {
              title: removed ? `Removed Task ${params.id}` : `Task ${params.id} Not Found`,
              output: removed ? `Task ${params.id} successfully removed.` : `No task found with ID ${params.id}.`,
              metadata: { id: params.id, removed },
            }
          }

          if (params.action === "run") {
            if (!params.id) {
              return {
                title: "Run Scheduled Task Failed",
                output: "Error: 'id' parameter is required to run a scheduled task.",
                metadata: {},
              }
            }

            const task = yield* Effect.promise(() => Store.get(params.id!))
            if (!task) {
              return {
                title: `Task ${params.id} Not Found`,
                output: `No task found with ID ${params.id}.`,
                metadata: { id: params.id },
              }
            }

            const result = yield* Effect.promise(() => Daemon.executeTask(task))
            return {
              title: `Executed Task: ${task.name}`,
              output: [
                `Task ${task.id} execution completed (${result.success ? "success" : "failed"}):`,
                result.output ? `Output:\n${result.output}` : "",
                result.error ? `Error:\n${result.error}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
              metadata: { id: task.id, success: result.success },
            }
          }

          // action === "status"
          const status = yield* Effect.promise(() => Daemon.getStatus())
          const output = [
            `Scheduler Daemon Status:`,
            `- Running: ${status.running ? `Yes (PID ${status.pid})` : "No"}`,
            status.startedAt ? `- Started at: ${new Date(status.startedAt).toLocaleString()}` : "",
            status.lastHeartbeat ? `- Last heartbeat: ${new Date(status.lastHeartbeat).toLocaleString()}` : "",
            `- Total scheduled tasks: ${status.taskCount}`,
            `- Tasks currently due: ${status.dueCount}`,
          ]
            .filter(Boolean)
            .join("\n")

          return {
            title: `Scheduler Daemon Status: ${status.running ? "Running" : "Stopped"}`,
            output,
            metadata: { running: status.running },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
