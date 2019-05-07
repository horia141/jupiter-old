import * as Vorpal from "vorpal";
import {Args} from "vorpal";
import * as knex from "knex";

import { Service } from "./service/Service";
import {Goal, Plan} from "./service/entities";

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
        .description("Displays the current plan.")
        .action(async function (this: Vorpal, _args: Args) {
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
        .delimiter(">> ")
        .show();
}

function printPlan(plan: Plan): string {
    const res = []

    for (const goal of plan.goals) {
        res.push(printGoal(goal));
    }

    return res.join("\n");
}

function printGoal(goal: Goal): string {
    const res = [];

    res.push(`${goal.title}:`);

    res.push("  metrics:");

    for (const metric of goal.metrics) {
        res.push(`    ${metric.title}`);
    }

    res.push("  tasks:");

    for (const task of goal.tasks) {
        res.push(`    ${task.title}`);
    }

    return res.join("\n");
}

main();