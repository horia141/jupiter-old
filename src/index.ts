import * as Vorpal from "vorpal";
import {Args} from "vorpal";
import * as knex from "knex";
import * as moment from "moment";

import {Service} from "./service/Service";
import {
    CollectedMetric,
    getGoalRange,
    getTaskPriority,
    getTaskRepeatSchedule,
    Goal,
    GoalRange,
    MetricType,
    Plan,
    Schedule,
    ScheduledTask,
    TaskPriority
} from "./service/entities";

async function main() {

    const conn = knex({
        client: "pg",
        connection: {
            host: process.env.POSTGRES_HOST as string,
            port: process.env.POSTGRES_PORT as string,
            database: process.env.POSTGRES_DATABASE as string,
            user: process.env.POSTGRES_USERNAME as string,
            password: process.env.POSTGRES_PASSWORD as string
        }
    });

    const service = new Service(conn);
    await service.init();

    const vorpal = (Vorpal as any)();

    vorpal
        .command("plan:show")
        .description("Displays the current plan")
        .action(async function (this: Vorpal) {
            const res = await service.getLatestPlan();
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:new-goal <title...>")
        .description("Adds a new goal to the current plan")
        .option("-d, --description <desc>", "Add a description to the goal")
        .option("-r, --range <range>", "The range of the goal in time", getGoalRange())
        .option("-c, --childOf <parentGoalId>", "The parent goal to nest this under")
        .types({ string: [ "d", "description", "r", "range", "c", "childOf" ]})
        .action(async function (this: Vorpal, args: Args) {
            const title = args.title.join(" ");
            const description = args.options.description;
            const range = args.options.range !== undefined ? (args.options.range as GoalRange) : GoalRange.LIFETIME;
            if (getGoalRange().indexOf(range) === -1) {
                throw new Error(`Invalid goal range ${range}`);
            }
            const parentGoalId = args.options.childOf ? Number.parseInt(args.options.childOf) : undefined;

            const req = {
                title: title,
                description: description,
                range: range,
                parentGoalId: parentGoalId
            };
            const res = await service.createGoal(req);
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:move-goal <goalId> [parentGoalId]")
        .description("Moves a goal to be a child of another goal or at the toplevel if none is given")
        .action(async function (this: Vorpal, args: Args) {
            const goalId = Number.parseInt(args.goalId);
            const parentGoalId = args.parentGoalId !== undefined ? Number.parseInt(args.parentGoalId) : undefined;

            const req = {
                goalId: goalId,
                parentGoalId: parentGoalId
            };
            const res = await service.moveGoal(req);
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-goal-title <goalId> <title...>")
        .description("Change the title of a given goal")
        .action(async function (this: Vorpal, args: Args) {
            const goalId = Number.parseInt(args.goalId);
            const title = args.title.join(" ");
            const req = {
                goalId: goalId,
                title: title
            };
            const res = await service.updateGoal(req);
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-goal-description <goalId> <description...>")
        .description("Change the description of a given goal")
        .action(async function (this: Vorpal, args: Args) {
            const goalId = Number.parseInt(args.goalId);
            const description = args.description.join(" ");
            const req = {
                goalId: goalId,
                description: description
            };
            const res = await service.updateGoal(req);
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-goal-range <goalId> <range>")
        .description("Change the range of the given goal")
        .autocomplete(getGoalRange())
        .action(async function (this: Vorpal, args: Args) {
            const goalId = Number.parseInt(args.goalId);
            const range = args.range;
            if (getGoalRange().indexOf(range) === -1) {
                throw new Error(`Invalid goal range ${range}`);
            }
            const req = {
                goalId: goalId,
                range: range
            };
            const res = await service.updateGoal(req);
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:mark-goal-as-done <goalId>")
        .description("Mark a goal as done")
        .action(async function (this: Vorpal, args: Args) {
            const goalId = Number.parseInt(args.goalId);
            const req = {
                goalId: goalId
            };
            const res = await service.markGoalAsDone(req);
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:archive-goal <goalId>")
        .description("Archive a goal")
        .action(async function (this: Vorpal, args: Args) {
            const goalId = Number.parseInt(args.goalId);
            const req = {
                goalId: goalId
            };
            const res = await service.archiveGoal(req);
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:new-metric <goalId> <title...>")
        .description("Adds a new metric to a goal")
        .option("-d, --description <desc>", "Add a description to the goal")
        .option("--counter", "Create a counter metric instead of a gauge one")
        .action(async function (this: Vorpal, args: Args) {
            const title = args.title.join(" ");
            const description = args.options.description;
            const goalId = Number.parseInt(args.goalId);
            const isCounter = args.options.counter !== undefined;
            const req = {
                title: title,
                description: description,
                goalId: goalId,
                isCounter: isCounter
            };
            const res = await service.createMetric(req);
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-metric-title <metricId> <title...>")
        .description("Change the title of a given metric")
        .action(async function (this: Vorpal, args: Args) {
            const metricId = Number.parseInt(args.metricId);
            const title = args.title.join(" ");
            const req = {
                metricId: metricId,
                title: title
            };
            const res = await service.updateMetric(req);
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-metric-description <metricId> <description...>")
        .description("Change the title of a given metric")
        .action(async function (this: Vorpal, args: Args) {
            const metricId = Number.parseInt(args.metricId);
            const description = args.description.join(" ");
            const req = {
                metricId: metricId,
                description: description
            };
            const res = await service.updateMetric(req);
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:archive-metric <metricId>")
        .description("Archive a given metric")
        .action(async function (this: Vorpal, args: Args) {
            const metricId = Number.parseInt(args.metricId);

            const req = {
                metricId: metricId
            };
            const res = await service.archiveMetric(req);
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:new-task <goalId> <title...>")
        .description("Add a new task to a goal")
        .option("-d, --description <desc>", "Add a description to the goal")
        .option("-p, --priority <priority>", "Assigns a priority to the task", getTaskPriority())
        .option("-d, --deadline <deadlineTime>", "Specifies a deadline in YYYY-MM-DD HH:mm")
        .option("-r, --repeatSchedule <schedule>", "Makes this task repeat according to a schedule", getTaskRepeatSchedule())
        .action(async function (this: Vorpal, args: Args) {
            const goalId = Number.parseInt(args.goalId);
            const title = args.title.join(" ");
            const description = args.options.description;
            const priority = args.options.priority !== undefined ? (args.options.priority as TaskPriority) : TaskPriority.NORMAL;
            const deadline = args.options.deadline !== undefined ? moment.utc(args.options.deadline) : undefined;
            const repeatSchedule = args.options.repeatSchedule;
            if (getTaskPriority().indexOf(priority) === -1) {
                throw new Error(`Invalid task priority ${priority}`);
            }
            if (repeatSchedule !== undefined && getTaskRepeatSchedule().indexOf(repeatSchedule) === -1) {
                throw new Error(`Invalid task repeat schedule ${repeatSchedule}`);
            }

            const req = {
                goalId: goalId,
                title: title,
                description: description,
                priority: priority,
                deadline: deadline,
                repeatSchedule: repeatSchedule
            };
            const res = await service.createTask(req);
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-task-title <taskId> <title...>")
        .description("Change the title of a given task")
        .action(async function (this: Vorpal, args: Args) {
            const taskId = Number.parseInt(args.taskId);
            const title = args.title.join(" ");
            const req = {
                taskId: taskId,
                title: title
            };
            const res = await service.updateTask(req);
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-task-description <taskId> <description...>")
        .description("Change the description of a given task")
        .action(async function (this: Vorpal, args: Args) {
            const taskId = Number.parseInt(args.taskId);
            const description = args.description.join(" ");
            const req = {
                taskId: taskId,
                description: description
            };
            const res = await service.updateTask(req);
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-task-priority <taskId> <priority>")
        .description("Change the priority of a given task")
        .action(async function (this: Vorpal, args: Args) {
            const taskId = Number.parseInt(args.taskId);
            const priority = args.priority as TaskPriority;
            if (getTaskPriority().indexOf(priority) === -1) {
                throw new Error(`Invalid task priority ${priority}`);
            }

            const req = {
                taskId: taskId,
                priority: priority
            };
            const res = await service.updateTask(req);
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-task-deadline <taskId> [deadline]")
        .description("Change the deadline of a given task")
        .action(async function (this: Vorpal, args: Args) {
            const taskId = Number.parseInt(args.taskId);
            const deadline = args.deadline !== undefined ? moment.utc(args.deadline) : undefined;
            const clearDeadline = args.deadline === undefined;

            const req = {
                taskId: taskId,
                deadline: deadline,
                clearDeadline: clearDeadline
            };
            const res = await service.updateTask(req);
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-task-schedule <taskId> [repeatSchedule]")
        .description("Change the repeat schedule for a task")
        .action(async function (this: Vorpal, args: Args) {
            const taskId = Number.parseInt(args.taskId);
            const repeatSchedule = args.repeatSchedule;
            if (repeatSchedule !== undefined && getTaskRepeatSchedule().indexOf(repeatSchedule) === -1) {
                throw new Error(`Invalid task repeat schedule ${repeatSchedule}`);
            }
            const clearRepeatSchedule = args.repeatSchedule === undefined;

            const req = {
                taskId: taskId,
                repeatSchedule: repeatSchedule,
                clearRepeatSchedule: clearRepeatSchedule
            };
            const res = await service.updateTask(req);
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:archive-task <taskId>")
        .description("Archive a given task")
        .action(async function (this: Vorpal, args: Args) {
            const taskId = Number.parseInt(args.taskId);

            const req = {
                taskId: taskId
            };
            const res = await service.archiveTask(req);
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("schedule:show")
        .description("Displays the current schedule")
        .action(async function (this: Vorpal) {
            const res = await service.getLatestSchedule();
            this.log(printSchedule(res.schedule, res.plan));
        });

    vorpal
        .command("schedule:increment-metric <metricId>")
        .description("Increment a counter metric")
        .action(async function (this: Vorpal, args: Args) {
            const metricId = Number.parseInt(args.metricId);
            const req = {
                metricId: metricId
            };
            const res = await service.incrementMetric(req);
            this.log(printSchedule(res.schedule, res.plan));
        });

    vorpal
        .command("schedule:record-metric <metricId> <value>")
        .description("Record a new value for a gauge metric")
        .action(async function (this: Vorpal, args: Args) {
            const metricId = Number.parseInt(args.metricId);
            const value = Number.parseFloat(args.value);
            const req = {
                metricId: metricId,
                value: value
            };
            const res = await service.recordForMetric(req);
            this.log(printSchedule(res.schedule, res.plan));
        });

    vorpal
        .command("schedule:mark-task-as-done <taskId>")
        .description("Marks a task as done")
        .action(async function (this: Vorpal, args: Args) {
            const taskId = Number.parseInt(args.taskId);
            const req = {
                taskId: taskId
            };
            const res = await service.markTaskAsDone(req);
            this.log(printSchedule(res.schedule, res.plan));
        });

    vorpal
        .delimiter(">> ")
        .show();
}

function printPlan(plan: Plan): string {
    const res = [];

    res.push(`id=${plan.id}`);

    for (const goal of plan.goals) {
        if (goal.isArchived || goal.isDone) {
            continue;
        }

        res.push(printGoal(goal));
    }

    return res.join("\n");
}

function printGoal(goal: Goal, indent: number = 0): string {
    const res = [];

    const indentStr = " ".repeat(indent);

    res.push(`${indentStr}[${goal.id}] ${goal.title} (${goal.range}@${goal.deadline ? goal.deadline.format("YYYY-MM-DD hh:mm UTC") : ""}):`);

    if (goal.subgoals.filter(g => !(g.isArchived || g.isDone)).length > 0) {
        res.push(`${indentStr}  subgoals:`);

        for (const subGoal of goal.subgoals) {
            if (subGoal.isArchived || subGoal.isDone) {
                continue;
            }

            res.push(printGoal(subGoal, indent + 2));
        }
    }

    if (goal.metrics.filter(m => !m.isArchived).length > 0) {

        res.push(`${indentStr}  metrics:`);

        for (const metric of goal.metrics) {
            if (metric.isArchived) {
                continue;
            }

            res.push(`${indentStr}    [${metric.id}] ${metric.type === MetricType.GAUGE ? 'g' : 'c'} ${metric.title}`);
        }
    }

    if (goal.tasks.filter(t => !t.isArchived).length > 0) {

        res.push(`${indentStr}  tasks:`);

        for (const task of goal.tasks) {
            if (task.isArchived) {
                continue;
            }

            res.push(`${indentStr}    [${task.id}] ${task.title} @${task.deadline ? task.deadline.format("YYYY-MM-DD hh:mm UTC") : ""} ${task.priority === TaskPriority.HIGH ? "(high)" : ""} ${task.repeatSchedule ? task.repeatSchedule : ""}`);
        }
    }

    return res.join("\n");
}

function printSchedule(schedule: Schedule, plan: Plan): string {
    const res = [];

    res.push(`id=${schedule.id}`);

    if (schedule.collectedMetrics.length > 0) {

        res.push("  metrics:");

        for (const collectedMetric of schedule.collectedMetrics) {
            res.push(printCollectedMetric(collectedMetric, plan));
        }
    }

    if (schedule.scheduledTasks.length > 0) {

        res.push("  tasks:");

        for (const scheduledTask of schedule.scheduledTasks) {
            res.push(printScheduledTask(scheduledTask, plan));
        }
    }

    return res.join("\n");
}

function printCollectedMetric(collectedMetric: CollectedMetric, plan: Plan): string {
    const res = [];

    const metric = plan.metricsById.get(collectedMetric.metricId);
    if (metric === undefined) {
        throw new Error(`Cannot find metric for ${collectedMetric.metricId}`);
    }

    res.push(`    [${collectedMetric.id}] ${metric.title}:`);

    for (const entry of collectedMetric.entries) {
        res.push(`     - ${entry.timestamp} => ${entry.value}`);
    }

    return res.join("\n");
}

function printScheduledTask(scheduledTask: ScheduledTask, plan: Plan): string {
    const res = [];

    const task = plan.tasksById.get(scheduledTask.taskId);
    if (task === undefined) {
        throw new Error(`Cannot find task for ${scheduledTask.taskId}`);
    }

    res.push(`    [${scheduledTask.id}] ${task.title}:`);

    for (const entry of scheduledTask.entries) {
        res.push(`     - ${entry.isDone ? "[+]" : "[-]"}`);
    }

    return res.join("\n");
}

main();