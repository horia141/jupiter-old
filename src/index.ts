import * as Vorpal from "vorpal";
import {Args} from "vorpal";
import * as knex from "knex";

import {Service} from "./service/Service";
import {CollectedMetric, Goal, MetricType, Plan, Schedule, ScheduledTask, TaskRepeatSchedule} from "./service/entities";

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
        .types({ string: [ "d", "description" ]})
        .action(async function (this: Vorpal, args: Args) {
            const title = args.title.join(" ");
            const description = args.options.description;
            const req = {
                title: title,
                description: description
            };
            const res = await service.createGoal(req);
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
        .option("--counter", "Create a counter metric instead of a gauge one")
        .action(async function (this: Vorpal, args: Args) {
            const title = args.title.join(" ");
            const goalId = Number.parseInt(args.goalId);
            const isCounter = args.options.counter !== undefined;
            const req = {
                title: title,
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
        .command("plan:new-task <goalId> <title...>")
        .description("Add a new task to a goal")
        .option(
            "-r, --repeatSchedule <schedule>",
            "Makes this task repeat according to a schedule",
            [TaskRepeatSchedule.DAILY, TaskRepeatSchedule.WEEKLY, TaskRepeatSchedule.MONTHLY, TaskRepeatSchedule.QUARTERLY, TaskRepeatSchedule.YEARLY])
        .action(async function (this: Vorpal, args: Args) {
            const title = args.title.join(" ");
            const goalId = Number.parseInt(args.goalId);
            const repeatSchedule = args.options.repeatSchedule;
            const req = {
                title: title,
                goalId: goalId,
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

function printGoal(goal: Goal): string {
    const res = [];

    res.push(`[${goal.id}] ${goal.title}:`);

    if (goal.metrics.length > 0) {

        res.push("  metrics:");

        for (const metric of goal.metrics) {
            res.push(`    [${metric.id}] ${metric.type === MetricType.GAUGE ? 'g' : 'c'} ${metric.title}`);
        }
    }

    if (goal.tasks.length > 0) {

        res.push("  tasks:");

        for (const task of goal.tasks) {
            res.push(`    [${task.id}] ${task.title}`);
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