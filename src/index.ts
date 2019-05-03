import * as Vorpal from "vorpal";
import {Args} from "vorpal";

import { Service } from "./Service";

function main() {
    const service = new Service();

    const vorpal = (Vorpal as any)();

    vorpal
        .command("plan:show")
        .description("Displays the current plan.")
        .action(async function (_args: Args) {
            const res = await service.getLatestPlan();
            const resRes = JSON.stringify(res, undefined, 2);
            (this as any).log(resRes);
        });

    vorpal
        .command("plan:new-goal <title...>")
        .description("Adds a new goal to the current plan")
        .action(async function (args: Args) {
            const title = args.title.join(" ");
            const req = {
                title: title
            };
            const res = await service.createGoal(req);
            const resRes = JSON.stringify(res, undefined, 2);
            (this as any).log(resRes);
        });

    vorpal
        .delimiter(">> ")
        .show();
}

main();