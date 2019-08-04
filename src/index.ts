import * as Vorpal from "vorpal";
import {Args} from "vorpal";
import * as knex from "knex";
import * as moment from "moment";

import {AuthInfo, Context, Service} from "./service/Service";
import {
    CollectedMetric,
    getGoalRange,
    getTaskPriority,
    getTaskRepeatSchedule,
    getTaskUrgency,
    Goal,
    GoalRange,
    Metric,
    MetricType,
    Plan,
    Schedule,
    ScheduledTask,
    SubTask,
    Task,
    TaskPriority,
    TaskUrgency, User
} from "./service/entities";

const Command = require('vorpal/dist/command.js');

declare module "vorpal" {
    interface Command {
        actionWithAuth(handler: (vorpal: Vorpal, args: Args, ctx: Context) => Promise<void>): void;
    }
}

const STANDARD_DATE_FORMAT = "YYYY-MM-DD hh:mm UTC";

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

    Command.prototype.actionWithAuth = function (this: Vorpal.Command, handler: (vorpal: Vorpal, args: Args, ctx: Context) => Promise<void>) {
        return this.action(async function (this: Vorpal, args: Args) {
            if (userAuthInfo === null) {
                throw new Error(`Please register/login`);
            }

            const ctx: Context = {
                auth: userAuthInfo,
                userId: -1 // UGLY HACK
            };

            await handler(vorpal, args, ctx);
        });
    };

    let userAuthInfo: AuthInfo | null = null;

    vorpal
        .command("user:register <email> <password>")
        .description("Registers a new user")
        .action(async function (this: Vorpal, args: Args) {
            const email = args.email;
            const password = args.password;

            const req = {
                email: email,
                password: password
            };
            const res = await service.getOrCreateUser(req);
            userAuthInfo = res.auth;
            vorpal.log(printUser(res.user));
        });

    vorpal
        .command("user:login <email> <password>")
        .description("Login as a user")
        .action(async function (this: Vorpal, args: Args) {
            const email = args.email;
            const password = args.password;

            const req = {
                email: email,
                password: password
            };
            const res = await service.getOrCreateUser(req);
            userAuthInfo = res.auth;
            vorpal.log(printUser(res.user));
        });

    vorpal
        .command("user:logout")
        .action(async function (this: Vorpal) {
            userAuthInfo = null;
        });

    vorpal
        .command("user:show")
        .actionWithAuth(async (vorpal: Vorpal, _args: Args, ctx: Context) => {
            const req = {};
            const res = await service.getUser(ctx, req);
            vorpal.log(printUser(res.user));
        });

    vorpal
        .command("user:new-vacation <startTime> <endTime>")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
             const startTime = moment.utc(args.startTime);
             const endTime = moment.utc(args.endTime);

             const req = {
                 startTime: startTime,
                 endTime: endTime
             };
             const res = await service.createVacation(ctx, req);
             vorpal.log(printUser(res.user));
        });

    vorpal
        .command("user:set-vacation-start-time <vacationId> <startTime>")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const vacationId = args.vacationId;
            const startTime = moment.utc(args.startTime);

            const req = {
                vacationId: vacationId,
                startTime: startTime
            };
            const res = await service.updateVacation(ctx, req);
            vorpal.log(printUser(res.user));
        });

    vorpal
        .command("user:set-vacation-end-time <vacationId> <endTime>")
        .actionWithAuth(async (_vorpal: Vorpal, args: Args, ctx: Context) => {
            const vacationId = args.vacationId;
            const endTime = moment.utc(args.endTime);

            const req = {
                vacationId: vacationId,
                endTime: endTime
            };
            const res = await service.updateVacation(ctx, req);
            vorpal.log(printUser(res.user));
        });

    vorpal
        .command("user:archive-vacation <vacationId>")
        .actionWithAuth(async (_vorpal: Vorpal, args: Args, ctx: Context) => {
            const vacationId = args.vacationId;

            const req = {
                vacationId: vacationId
            };
            const res = await service.archiveVacation(ctx, req);
            vorpal.log(printUser(res.user));
        });

    vorpal
        .command("user:quit")
        .actionWithAuth(async (_vorpal: Vorpal, _args: Args, ctx: Context) => {
            const req = {};
            try {
                await service.archiveUser(ctx, req);
            } finally {
                userAuthInfo = null;
            }
            vorpal.log("User removed");
        });

    vorpal
        .command("plan:show")
        .description("Displays the current plan")
        .actionWithAuth(async (vorpal: Vorpal, _args: Args, ctx: Context) => {
            const req = {};
            const res = await service.getLatestPlan(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:new-goal <title...>")
        .description("Adds a new goal to the current plan")
        .option("-d, --description <desc>", "Add a description to the goal")
        .option("-r, --range <range>", "The range of the goal in time", getGoalRange())
        .option("-c, --childOf <parentGoalId>", "The parent goal to nest this under")
        .types({ string: [ "d", "description", "r", "range", "c", "childOf" ]})
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
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
            const res = await service.createGoal(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:move-goal <goalId>")
        .description("Move a goal to be a child of another goal, to the toplevel or to a new position")
        .option("-t, --toplevel", "Moves goal to the toplevel")
        .option("-c, --childOf <parentGoalId>", "Moves goal to be a child of the specified goal")
        .option("-p, --position <position>", "Moves goal at position under its parent")
        .types({ string: [ "t", "toplevel", "c", "childOf", "p", "position" ]})
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const goalId = Number.parseInt(args.goalId);
            const moveToToplevel = args.options.toplevel !== undefined;
            const parentGoalId = args.options.childOf !== undefined ? Number.parseInt(args.options.childOf) : undefined;
            const position = args.options.position !== undefined ? Number.parseInt(args.options.position) : undefined;

            const req = {
                goalId: goalId,
                moveToToplevel: moveToToplevel,
                parentGoalId: parentGoalId,
                position: position
            };
            const res = await service.moveGoal(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-goal-title <goalId> <title...>")
        .description("Change the title of a given goal")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const goalId = Number.parseInt(args.goalId);
            const title = args.title.join(" ");
            const req = {
                goalId: goalId,
                title: title
            };
            const res = await service.updateGoal(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-goal-description <goalId> <description...>")
        .description("Change the description of a given goal")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const goalId = Number.parseInt(args.goalId);
            const description = args.description.join(" ");
            const req = {
                goalId: goalId,
                description: description
            };
            const res = await service.updateGoal(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-goal-range <goalId> <range>")
        .description("Change the range of the given goal")
        .autocomplete(getGoalRange())
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const goalId = Number.parseInt(args.goalId);
            const range = args.range;
            if (getGoalRange().indexOf(range) === -1) {
                throw new Error(`Invalid goal range ${range}`);
            }
            const req = {
                goalId: goalId,
                range: range
            };
            const res = await service.updateGoal(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:suspend-goal <goalId>")
        .description("Suspend a goal")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const goalId = Number.parseInt(args.goalId);

            const req = {
                goalId: goalId,
                isSuspended: true
            };
            const res = await service.updateGoal(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:unsuspend-goal <goalId>")
        .description("Suspend a repeating task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const goalId = Number.parseInt(args.goalId);

            const req = {
                goalId: goalId,
                isSuspended: false
            };
            const res = await service.updateGoal(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:mark-goal-as-done <goalId>")
        .description("Mark a goal as done")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const goalId = Number.parseInt(args.goalId);
            const req = {
                goalId: goalId
            };
            const res = await service.markGoalAsDone(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:archive-goal <goalId>")
        .description("Archive a goal")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const goalId = Number.parseInt(args.goalId);
            const req = {
                goalId: goalId
            };
            const res = await service.archiveGoal(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:new-metric <title...>")
        .description("Adds a new metric")
        .option("-g, --goal <goalId>", "The goal to add the metric to. Default to the inbox one")
        .option("-d, --description <desc>", "Add a description to the goal")
        .option("--counter", "Create a counter metric instead of a gauge one")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const goalId = args.options.goal !== undefined ? Number.parseInt(args.options.goal) : undefined;
            const title = args.title.join(" ");
            const description = args.options.description;
            const isCounter = args.options.counter !== undefined;
            const req = {
                goalId: goalId,
                title: title,
                description: description,
                isCounter: isCounter
            };
            const res = await service.createMetric(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:move-metric <metricId>")
        .description("Move a metric to another goal, or to a new position")
        .option("-c, --childOf <goalId>", "Moves metric to be a child of the given goal")
        .option("-p, --position <position>", "Moves metric at position under the goal")
        .types({ string: [ "c", "childOf", "p", "position" ]})
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const metricId = Number.parseInt(args.metricId);
            const goalId = args.options.childOf !== undefined ? Number.parseInt(args.options.childOf) : undefined;
            const position = args.options.position !== undefined ? Number.parseInt(args.options.position) : undefined;

            const req = {
                metricId: metricId,
                goalId: goalId,
                position: position
            };
            const res = await service.moveMetric(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-metric-title <metricId> <title...>")
        .description("Change the title of a given metric")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const metricId = Number.parseInt(args.metricId);
            const title = args.title.join(" ");
            const req = {
                metricId: metricId,
                title: title
            };
            const res = await service.updateMetric(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-metric-description <metricId> <description...>")
        .description("Change the title of a given metric")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const metricId = Number.parseInt(args.metricId);
            const description = args.description.join(" ");
            const req = {
                metricId: metricId,
                description: description
            };
            const res = await service.updateMetric(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:archive-metric <metricId>")
        .description("Archive a given metric")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const metricId = Number.parseInt(args.metricId);

            const req = {
                metricId: metricId
            };
            const res = await service.archiveMetric(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:new-task <title...>")
        .description("Add a new task")
        .option("-g, --goal <goalId>", "The goal to add the task to. Default to the inbox one")
        .option("-d, --description <desc>", "Add a description to the goal")
        .option("-p, --priority <priority>", "Assigns a priority to the task", getTaskPriority())
        .option("-u, --urgency <urgency>", "Assigns an urgency to the task", getTaskUrgency())
        .option("-d, --deadline <deadlineTime>", "Specifies a deadline in YYYY-MM-DD HH:mm")
        .option("-r, --repeatSchedule <schedule>", "Makes this task repeat according to a schedule", getTaskRepeatSchedule())
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const goalId = args.options.goal !== undefined ? Number.parseInt(args.options.goal) : undefined;
            const title = args.title.join(" ");
            const description = args.options.description;
            const priority = args.options.priority !== undefined ? (args.options.priority as TaskPriority) : TaskPriority.NORMAL;
            const urgency = args.options.urgency !== undefined ? (args.options.urgency as TaskUrgency) : TaskUrgency.REGULAR;
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
                urgency: urgency,
                deadline: deadline,
                repeatSchedule: repeatSchedule
            };
            const res = await service.createTask(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:move-task <taskId>")
        .description("Move a task to another goal, or to a new position")
        .option("-c, --childOf <goalId>", "Moves task to be a child of the given goal")
        .option("-p, --position <position>", "Moves task at position under the goal")
        .types({ string: [ "c", "childOf", "p", "position" ]})
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const taskId = Number.parseInt(args.taskId);
            const goalId = args.options.childOf !== undefined ? Number.parseInt(args.options.childOf) : undefined;
            const position = args.options.position !== undefined ? Number.parseInt(args.options.position) : undefined;

            const req = {
                taskId: taskId,
                goalId: goalId,
                position: position
            };
            const res = await service.moveTask(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-task-title <taskId> <title...>")
        .description("Change the title of a given task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const taskId = Number.parseInt(args.taskId);
            const title = args.title.join(" ");

            const req = {
                taskId: taskId,
                title: title
            };
            const res = await service.updateTask(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-task-description <taskId> <description...>")
        .description("Change the description of a given task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const taskId = Number.parseInt(args.taskId);
            const description = args.description.join(" ");
            const req = {
                taskId: taskId,
                description: description
            };
            const res = await service.updateTask(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-task-priority <taskId> <priority>")
        .description("Change the priority of a given task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const taskId = Number.parseInt(args.taskId);
            const priority = args.priority as TaskPriority;
            if (getTaskPriority().indexOf(priority) === -1) {
                throw new Error(`Invalid task priority ${priority}`);
            }

            const req = {
                taskId: taskId,
                priority: priority
            };
            const res = await service.updateTask(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-task-urgency <taskId> <urgency>")
        .description("Change the urgency of a given task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const taskId = Number.parseInt(args.taskId);
            const urgency = args.urgency as TaskUrgency;
            if (getTaskUrgency().indexOf(urgency) === -1) {
                throw new Error(`Invalid task urgency ${urgency}`);
            }

            const req = {
                taskId: taskId,
                urgency: urgency
            };
            const res = await service.updateTask(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-task-deadline <taskId> [deadline]")
        .description("Change the deadline of a given task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const taskId = Number.parseInt(args.taskId);
            const deadline = args.deadline !== undefined ? moment.utc(args.deadline) : undefined;
            const clearDeadline = args.deadline === undefined;

            const req = {
                taskId: taskId,
                deadline: deadline,
                clearDeadline: clearDeadline
            };
            const res = await service.updateTask(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-task-schedule <taskId> [repeatSchedule]")
        .description("Change the repeat schedule for a task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
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
            const res = await service.updateTask(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:suspend-task <taskId>")
        .description("Suspend a repeating task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const taskId = Number.parseInt(args.taskId);

            const req = {
                taskId: taskId,
                isSuspended: true
            };
            const res = await service.updateTask(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:unsuspend-task <taskId>")
        .description("Suspend a repeating task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const taskId = Number.parseInt(args.taskId);

            const req = {
                taskId: taskId,
                isSuspended: false
            };
            const res = await service.updateTask(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:archive-task <taskId>")
        .description("Archive a given task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const taskId = Number.parseInt(args.taskId);

            const req = {
                taskId: taskId
            };
            const res = await service.archiveTask(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:new-subtask <taskId> <title...>")
        .description("Add a new subtask to a task")
        .option("-c, --childOf <parentSubTaskId>", "The subtask of taskId to nest this one under")
        .types({ string: [ "c", "childOf" ]})
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const taskId = Number.parseInt(args.taskId);
            const title = args.title.join(" ");
            const parentSubTaskId = args.options.childOf ? Number.parseInt(args.options.childOf) : undefined;

            const req = {
                taskId: taskId,
                title: title,
                parentSubTaskId: parentSubTaskId
            };
            const res = await service.createSubTask(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:move-subtask <subTaskId>")
        .description("Move a subtask as a child of another one or changes its position")
        .option("-t, --toplevel", "Moves goal to the toplevel")
        .option("-c, --childOf <parentSubTaskId>", "The subtask to nest this one under")
        .option("-p, --position <position>", "The position to move the subtask to")
        .types({ string: [ "c", "childOf", "s", "subtaskChildOf", "p", "position" ]})
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const subTaskId = Number.parseInt(args.subTaskId);
            const moveToTopLevel = args.options.toplevel !== undefined;
            const parentSubTaskId = args.options.childOf ? Number.parseInt(args.options.childOf) : undefined;
            const position = args.options.position ? Number.parseInt(args.options.position) : undefined;

            const req = {
                subTaskId: subTaskId,
                moveToTopLevel: moveToTopLevel,
                parentSubTaskId: parentSubTaskId,
                position: position
            };
            const res = await service.moveSubTask(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-subtask-title <subTaskId> <title...>")
        .description("Change the name of a subtask")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const subTaskId = Number.parseInt(args.subTaskId);
            const title = args.title.join(" ");

            const req = {
                subTaskId: subTaskId,
                title: title
            };
            const res = await service.updateSubTask(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:archive-subtask <subTaskId>")
        .description("Archive a given subtask")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const subTaskId = Number.parseInt(args.subTaskId);

            const req = {
                subTaskId: subTaskId
            };
            const res = await service.archiveSubTask(ctx, req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("schedule:show")
        .description("Displays the current schedule")
        .actionWithAuth(async (vorpal: Vorpal, _args: Args, ctx: Context) => {
            const req = {};
            const res = await service.getLatestSchedule(ctx, req);
            vorpal.log(printSchedule(res.schedule, res.plan));
        });

    vorpal
        .command("schedule:increment-metric <metricId>")
        .description("Increment a counter metric")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const metricId = Number.parseInt(args.metricId);
            const req = {
                metricId: metricId
            };
            const res = await service.incrementMetric(ctx, req);
            vorpal.log(printSchedule(res.schedule, res.plan));
        });

    vorpal
        .command("schedule:record-metric <metricId> <value>")
        .description("Record a new value for a gauge metric")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const metricId = Number.parseInt(args.metricId);
            const value = Number.parseFloat(args.value);
            const req = {
                metricId: metricId,
                value: value
            };
            const res = await service.recordForMetric(ctx, req);
            vorpal.log(printSchedule(res.schedule, res.plan));
        });

    vorpal
        .command("schedule:mark-task-as-done <taskId>")
        .description("Marks a task as done")
        .actionWithAuth(async (vorpal: Vorpal, args: Args, ctx: Context) => {
            const taskId = Number.parseInt(args.taskId);
            const req = {
                taskId: taskId
            };
            const res = await service.markTaskAsDone(ctx, req);
            vorpal.log(printSchedule(res.schedule, res.plan));
        });

    vorpal
        .delimiter(">> ")
        .show();
}

function printUser(user: User): string {
    const rightNow = moment.utc();

    const res = [];

    res.push(`id=${user.id} ${user.email}`);

    if (user.vacations.some(v => !v.isArchived && v.endTime.isAfter(rightNow))) {
        res.push("  vacations: ");

        for (const vacation of user.vacations) {
            if (vacation.isArchived || vacation.endTime.isBefore(rightNow)) {
                continue;
            }

            res.push(`   - [${vacation.id}] ${vacation.startTime.format(STANDARD_DATE_FORMAT)} ${vacation.endTime.format(STANDARD_DATE_FORMAT)}`);
        }
    }

    return res.join("\n");
}

function printPlan(plan: Plan): string {
    const res = [];

    res.push(`id=${plan.id}`);

    for (const goalId of plan.goalsOrder) {
        const goal = plan.goalsById.get(goalId) as Goal;
        res.push(printGoal(goal));
    }

    return res.join("\n");
}

function printGoal(goal: Goal, indent: number = 0): string {
    const res = [];

    const indentStr = " ".repeat(indent);

    res.push(`${indentStr}[${goal.id}] ${goal.isSuspended ? "s " : ""}${goal.title} (${goal.range}@${goal.deadline ? goal.deadline.format(STANDARD_DATE_FORMAT) : ""}):`);

    if (goal.subgoalsOrder.length > 0) {
        res.push(`${indentStr}  subgoals:`);

        for (const subGoalId of goal.subgoalsOrder) {
            const subGoal = goal.subgoalsById.get(subGoalId) as Goal;
            res.push(printGoal(subGoal, indent + 2));
        }
    }

    if (goal.metricsOrder.length > 0) {
        res.push(`${indentStr}  metrics:`);

        for (const metricId of goal.metricsOrder) {
            const metric = goal.metricsById.get(metricId) as Metric;
            res.push(`${indentStr}    [${metric.id}] ${metric.type === MetricType.GAUGE ? 'g' : 'c'} ${metric.title}`);
        }
    }

    if (goal.tasksOrder.length > 0) {
        res.push(`${indentStr}  tasks:`);

        for (const taskId of goal.tasksOrder) {
            const task = goal.tasksById.get(taskId) as Task;
            res.push(printTask(task, indent));

        }
    }

    return res.join("\n");
}

function printTask(task: Task, indent: number): string {
    const res = [];
    const indentStr = " ".repeat(indent);

    res.push(`${indentStr}    [${task.id}] ${task.isSuspended ? "s " : ""}${task.title} @${task.deadline ? task.deadline.format(STANDARD_DATE_FORMAT) : ""} ${task.priority === TaskPriority.HIGH ? "(high)" : ""} ${task.urgency === TaskUrgency.CRITICAL ? "Must" : "Nice"} ${task.repeatSchedule ? task.repeatSchedule : ""}`);

    if (task.subTasksOrder.length > 0) {
        res.push(`${indentStr}      subtasks:`);

        for (const subTaskId of task.subTasksOrder) {
            const subTask = task.subTasksById.get(subTaskId) as SubTask;
            res.push(printSubTask(subTask, indent + 8));
        }
    }

    return res.join("\n");
}

function printSubTask(subTask: SubTask, indent: number): string {
    const res = [];
    const indentStr = " ".repeat(indent);

    res.push(`${indentStr}[${subTask.id}] ${subTask.title}`);

    if (subTask.subTasksOrder.length > 0) {
        for (const subSubTaskId of subTask.subTasksOrder) {
            const subSubTask = subTask.subTasksById.get(subSubTaskId) as SubTask;
            res.push(printSubTask(subSubTask, indent + 2));
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