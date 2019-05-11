import * as Vorpal from "vorpal";
import {Args} from "vorpal";
import * as knex from "knex";

import { Service } from "./service/Service";
import {CollectedMetric, Goal, Plan, Schedule} from "./service/entities";

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
        .action(async function (this: Vorpal, args: Args) {
            const title = args.title.join(" ");
            const req = {
                title: title
            };
            const res = await service.createGoal(req);
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:new-metric <title...> <goalId>")
        .description("Adds a new metric to a goal")
        .action(async function (this: Vorpal, args: Args) {
            const title = args.title.join(" ");
            const goalId = Number.parseInt(args.goalId);
            const req = {
                title: title,
                goalId: goalId
            };
            const res = await service.createMetric(req);
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:new-task <title...> <goalId>")
        .description("Add a new task to a goal")
        .action(async function (this: Vorpal, args: Args) {
            const title = args.title.join(" ");
            const goalId = Number.parseInt(args.goalId);
            const req = {
                title: title,
                goalId: goalId
            };
            const res = await service.createTask(req);
            this.log(printPlan(res.plan));
        });

    vorpal
        .command("schedule:show")
        .description("Displays the current schedule")
        .action(async function (this: Vorpal) {
            const res = await service.getLatestSchedule();
            this.log(printSchedule(res.schedule));
        });

    vorpal
        .delimiter(">> ")
        .show();
}

function printPlan(plan: Plan): string {
    const res = [];

    res.push(`id=${plan.id}`);

    for (const goal of plan.goals) {
        res.push(printGoal(goal));
    }

    return res.join("\n");
}

function printGoal(goal: Goal): string {
    const res = [];

    res.push(`[${goal.id}] ${goal.title}:`);

    if (goal.metrics.length > 0) {

        res.push("  collectedMetrics:");

        for (const metric of goal.metrics) {
            res.push(`    [${metric.id}] ${metric.title}`);
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

function printSchedule(schedule: Schedule): string {
    const res = [];

    res.push(`id=${schedule.id}`);

    if (schedule.collectedMetrics.length > 0) {

        res.push("  metrics:");

        for (const collectedMetric of schedule.collectedMetrics) {
            res.push(printCollectedMetric(collectedMetric));
        }
    }

    return res.join("\n");
}

function printCollectedMetric(collectedMetric: CollectedMetric): string {
    const res = [];

    res.push(`    [${collectedMetric.id}] ${collectedMetric.metricId}:`);

    for (const sample of collectedMetric.samples) {
        res.push(`     - ${sample.timestamp} => ${sample.value}`);
    }

    return res.join("\n");
}

main();