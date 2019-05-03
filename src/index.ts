import * as Vorpal from "vorpal";
import {Args} from "vorpal";
import * as knex from "knex";

import { Service } from "./Service";

function main() {

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

    const vorpal = (Vorpal as any)();

    vorpal
        .command("plan:show")
        .description("Displays the current plan.")
        .action(async function (this: Vorpal, _args: Args) {
            const res = await service.getLatestPlan();
            const resRes = JSON.stringify(res, undefined, 2);
            this.log(resRes);
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
            const resRes = JSON.stringify(res, undefined, 2);
            this.log(resRes);
        });

    vorpal
        .delimiter(">> ")
        .show();
}

main();