import * as Vorpal from "vorpal";
import {Args} from "vorpal";
import * as moment from "moment";
import * as os from "os";
import * as path from "path";
import * as fs from "fs-extra";

import {
    CollectedMetric,
    CounterPolicy,
    CounterPolicyType,
    GaugePolicy,
    GaugePolicyType,
    getGoalRange,
    getTaskPriority,
    getTaskReminderPolicy,
    getTaskRepeatSchedule,
    getTaskUrgency,
    Goal,
    GoalRange,
    Metric,
    MetricType,
    Plan,
    Schedule,
    ScheduledTask,
    SubTask, SubtasksPolicy,
    Task,
    TaskDoneType,
    TaskPriority,
    TaskReminderPolicy,
    TaskUrgency,
    User
} from "../shared/entities";
import { ServiceClient } from "../shared/dsrpc";
import {
    GetOrCreateUserRequest,
    ArchiveGoalRequest,
    ArchiveGoalResponse,
    ArchiveMetricRequest,
    ArchiveMetricResponse,
    ArchiveSubTaskRequest,
    ArchiveSubTaskResponse,
    ArchiveTaskRequest,
    ArchiveTaskResponse,
    ArchiveUserRequest,
    ArchiveUserResponse,
    ArchiveVacationRequest,
    ArchiveVacationResponse,
    CreateGoalRequest,
    CreateGoalResponse,
    CreateMetricRequest,
    CreateMetricResponse,
    CreateSubTaskRequest,
    CreateSubTaskResponse,
    CreateTaskRequest,
    CreateTaskResponse,
    CreateVacationRequest,
    CreateVacationResponse,
    GetLatestPlanRequest,
    GetLatestPlanResponse,
    GetLatestScheduleRequest,
    GetLatestScheduleResponse,
    GetOrCreateUserResponse,
    GetUserRequest,
    GetUserResponse,
    IncrementCounterTaskRequest,
    IncrementCounterTaskResponse,
    IncrementMetricRequest,
    IncrementMetricResponse,
    MarkGoalAsDoneRequest,
    MarkGoalAsDoneResponse,
    MarkSubTaskAsDoneRequest,
    MarkSubTaskAsDoneResponse,
    MarkTaskAsDoneRequest,
    MarkTaskAsDoneResponse,
    MoveGoalRequest,
    MoveGoalResponse,
    MoveMetricRequest,
    MoveMetricResponse,
    MoveSubTaskRequest,
    MoveSubTaskResponse,
    MoveTaskRequest,
    MoveTaskResponse,
    RecordForMetricRequest,
    RecordForMetricResponse,
    SetGaugeTaskRequest,
    SetGaugeTaskResponse,
    UpdateGoalRequest,
    UpdateGoalResponse,
    UpdateMetricRequest,
    UpdateMetricResponse, UpdatePlanRequest,
    UpdatePlanResponse,
    UpdateScheduledTaskEntryRequest,
    UpdateScheduledTaskEntryResponse,
    UpdateSubTaskRequest,
    UpdateSubTaskResponse,
    UpdateTaskRequest,
    UpdateTaskResponse,
    UpdateVacationRequest,
    UpdateVacationResponse
} from "../shared/dtos";

const Command = require('vorpal/dist/command.js');

declare module "vorpal" {
    interface Command {
        actionWithAuth(handler: (vorpal: Vorpal, args: Args) => Promise<void>): void;
    }
}

const STANDARD_DATE_FORMAT = "YYYY-MM-DD hh:mm UTC";
const DEFAULT_DOMAIN = "localhost:3000";
const HOME_CONF_PATH = ".jupiter";

interface UserConfig {
    domain: string;
}

async function main() {

    const vorpal = (Vorpal as any)();

    let userAuthToken: string | undefined = await getUserAuthInfoFromLocalStorage();
    let userConfig: UserConfig = await getUserConfigFromLocalStorage();
    let client = ServiceClient.build(`http://${userConfig.domain}/api`, userAuthToken);

    Command.prototype.actionWithAuth = function (this: Vorpal.Command, handler: (vorpal: Vorpal, args: Args) => Promise<void>) {
        return this.action(async function (this: Vorpal, args: Args) {
            if (!client.hasAuthToken()) {
                throw new Error(`Please register/login`);
            }

            await handler(vorpal, args);
        });
    };

    vorpal
        .command("user:register <email> <password>")
        .alias("user:login")
        .description("Registers a new user")
        .option("--domain <domain>", "To which domain to connect to")
        .action(async function (this: Vorpal, args: Args) {
            const email = String(args.email);
            const password = String(args.password);
            const domain = args.options.domain as string || userConfig.domain;

            if (userConfig.domain !== domain) {
                userConfig.domain = domain;
                client = ServiceClient.build(`http://${userConfig.domain}/api`, userAuthToken);
                await saveUserConfigToLocalStorage(userConfig);
            }

            const req = {
                email: email,
                password: password
            };
            const res = await client.do<GetOrCreateUserRequest, GetOrCreateUserResponse>("getOrCreateUser", req);
            await saveUserAuthInfoToLocalStorage(client.getAuthToken());
            vorpal.log(printUser(res.user));
        });

    vorpal
        .command("user:logout")
        .action(async function (this: Vorpal) {
            client.clearAuthToken();
            await clearUserAuthInfoFromLocalStorage();
        });

    vorpal
        .command("user:show")
        .actionWithAuth(async (vorpal: Vorpal, _args: Args) => {
            const req = {};
            const res = await client.do<GetUserRequest, GetUserResponse>("getUser", req);
            vorpal.log(printUser(res.user));
        });

    vorpal
        .command("user:new-vacation <startTime> <endTime>")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const startTime = moment.utc(args.startTime);
            const endTime = moment.utc(args.endTime);

            const req = {
                startTime: startTime,
                endTime: endTime
            };
            const res = await client.do<CreateVacationRequest, CreateVacationResponse>("createVacation", req);
            vorpal.log(printUser(res.user));
        });

    vorpal
        .command("user:set-vacation-start-time <vacationId> <startTime>")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const vacationId = args.vacationId;
            const startTime = moment.utc(args.startTime);

            const req = {
                vacationId: vacationId,
                startTime: startTime
            };
            const res = await client.do<UpdateVacationRequest, UpdateVacationResponse>("updateVacation", req);
            vorpal.log(printUser(res.user));
        });

    vorpal
        .command("user:set-vacation-end-time <vacationId> <endTime>")
        .actionWithAuth(async (_vorpal: Vorpal, args: Args) => {
            const vacationId = args.vacationId;
            const endTime = moment.utc(args.endTime);

            const req = {
                vacationId: vacationId,
                endTime: endTime
            };
            const res = await client.do<UpdateVacationRequest, UpdateVacationResponse>("updateVacation", req);
            vorpal.log(printUser(res.user));
        });

    vorpal
        .command("user:archive-vacation <vacationId>")
        .actionWithAuth(async (_vorpal: Vorpal, args: Args) => {
            const vacationId = args.vacationId;

            const req = {
                vacationId: vacationId
            };
            const res = await client.do<ArchiveVacationRequest, ArchiveVacationResponse>("archiveVacation", req);
            vorpal.log(printUser(res.user));
        });

    vorpal
        .command("user:quit")
        .actionWithAuth(async (_vorpal: Vorpal, _args: Args) => {
            const req = {};
            try {
                await client.do<ArchiveUserRequest, ArchiveUserResponse>("archiveUser", req);
            } finally {
                client.clearAuthToken();
                await clearUserAuthInfoFromLocalStorage();
            }
            vorpal.log("User removed");
        });

    vorpal
        .command("plan:show")
        .description("Displays the current plan")
        .actionWithAuth(async (vorpal: Vorpal, _args: Args) => {
            const req = {};
            const res = await client.do<GetLatestPlanRequest, GetLatestPlanResponse>("getLatestPlan", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:suspend")
        .description("Suspends the current plan")
        .actionWithAuth(async (vorpal: Vorpal, _args: Args) => {
            const req = {
                isSuspended: true
            };
            const res = await client.do<UpdatePlanRequest, UpdatePlanResponse>("updatePlan", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:unsuspend")
        .description("Suspends the current plan")
        .actionWithAuth(async (vorpal: Vorpal, _args: Args) => {
            const req = {
                isSuspended: false
            };
            const res = await client.do<UpdatePlanRequest, UpdatePlanResponse>("updatePlan", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:new-goal <title...>")
        .description("Adds a new goal to the current plan")
        .option("-d, --description <desc>", "Add a description to the goal")
        .option("-r, --range <range>", "The range of the goal in time", getGoalRange())
        .option("-c, --childOf <parentGoalId>", "The parent goal to nest this under")
        .types({ string: [ "d", "description", "r", "range", "c", "childOf" ]})
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
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
            const res = await client.do<CreateGoalRequest, CreateGoalResponse>("createGoal", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:move-goal <goalId>")
        .description("Move a goal to be a child of another goal, to the toplevel or to a new position")
        .option("-t, --toplevel", "Moves goal to the toplevel")
        .option("-c, --childOf <parentGoalId>", "Moves goal to be a child of the specified goal")
        .option("-p, --position <position>", "Moves goal at position under its parent")
        .types({ string: [ "t", "toplevel", "c", "childOf", "p", "position" ]})
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
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
            const res = await client.do<MoveGoalRequest, MoveGoalResponse>("moveGoal", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-goal-title <goalId> <title...>")
        .description("Change the title of a given goal")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const goalId = Number.parseInt(args.goalId);
            const title = args.title.join(" ");
            const req = {
                goalId: goalId,
                title: title
            };
            const res = await client.do<UpdateGoalRequest, UpdateGoalResponse>("updateGoal", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-goal-description <goalId> <description...>")
        .description("Change the description of a given goal")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const goalId = Number.parseInt(args.goalId);
            const description = args.description.join(" ");
            const req = {
                goalId: goalId,
                description: description
            };
            const res = await client.do<UpdateGoalRequest, UpdateGoalResponse>("updateGoal", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-goal-range <goalId> <range>")
        .description("Change the range of the given goal")
        .autocomplete(getGoalRange())
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const goalId = Number.parseInt(args.goalId);
            const range = args.range;
            if (getGoalRange().indexOf(range) === -1) {
                throw new Error(`Invalid goal range ${range}`);
            }
            const req = {
                goalId: goalId,
                range: range
            };
            const res = await client.do<UpdateGoalRequest, UpdateGoalResponse>("updateGoal", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:suspend-goal <goalId>")
        .description("Suspend a goal")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const goalId = Number.parseInt(args.goalId);

            const req = {
                goalId: goalId,
                isSuspended: true
            };
            const res = await client.do<UpdateGoalRequest, UpdateGoalResponse>("updateGoal", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:unsuspend-goal <goalId>")
        .description("Suspend a repeating task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const goalId = Number.parseInt(args.goalId);

            const req = {
                goalId: goalId,
                isSuspended: false
            };
            const res = await client.do<UpdateGoalRequest, UpdateGoalResponse>("updateGoal", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:mark-goal-as-done <goalId>")
        .description("Mark a goal as done")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const goalId = Number.parseInt(args.goalId);
            const req = {
                goalId: goalId
            };
            const res = await client.do<MarkGoalAsDoneRequest, MarkGoalAsDoneResponse>("markGoalAsDone", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:archive-goal <goalId>")
        .description("Archive a goal")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const goalId = Number.parseInt(args.goalId);
            const req = {
                goalId: goalId
            };
            const res = await client.do<ArchiveGoalRequest, ArchiveGoalResponse>("archiveGoal", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:new-metric <title...>")
        .description("Adds a new metric")
        .option("-g, --goal <goalId>", "The goal to add the metric to. Default to the inbox one")
        .option("-d, --description <desc>", "Add a description to the goal")
        .option("--counter", "Create a counter metric instead of a gauge one")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
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
            const res = await client.do<CreateMetricRequest, CreateMetricResponse>("createMetric", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:move-metric <metricId>")
        .description("Move a metric to another goal, or to a new position")
        .option("-c, --childOf <goalId>", "Moves metric to be a child of the given goal")
        .option("-p, --position <position>", "Moves metric at position under the goal")
        .types({ string: [ "c", "childOf", "p", "position" ]})
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const metricId = Number.parseInt(args.metricId);
            const goalId = args.options.childOf !== undefined ? Number.parseInt(args.options.childOf) : undefined;
            const position = args.options.position !== undefined ? Number.parseInt(args.options.position) : undefined;

            const req = {
                metricId: metricId,
                goalId: goalId,
                position: position
            };
            const res = await client.do<MoveMetricRequest, MoveMetricResponse>("moveMetric", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-metric-title <metricId> <title...>")
        .description("Change the title of a given metric")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const metricId = Number.parseInt(args.metricId);
            const title = args.title.join(" ");
            const req = {
                metricId: metricId,
                title: title
            };
            const res = await client.do<UpdateMetricRequest, UpdateMetricResponse>("updateMetric", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-metric-description <metricId> <description...>")
        .description("Change the title of a given metric")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const metricId = Number.parseInt(args.metricId);
            const description = args.description.join(" ");
            const req = {
                metricId: metricId,
                description: description
            };
            const res = await client.do<UpdateMetricRequest, UpdateMetricResponse>("updateMetric", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:archive-metric <metricId>")
        .description("Archive a given metric")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const metricId = Number.parseInt(args.metricId);

            const req = {
                metricId: metricId
            };
            const res = await client.do<ArchiveMetricRequest, ArchiveMetricResponse>("archiveMetric", req);
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
        .option("-m, --reminderPolicy <reminderPolicy>", "Controls when you'll be reminded of a task", getTaskReminderPolicy())
        .option("-b, --boolean", "Creates a boolean task")
        .option("-s, --subtasks", "Creates a task with subtasks")
        .option("--counter <counterConfig>", "Create a task with a counter done policy")
        .option("--gauge <gaugeConfig>", "Create a task with a gauge done policy")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const goalId = args.options.goal !== undefined ? Number.parseInt(args.options.goal) : undefined;
            const title = args.title.join(" ");
            const description = args.options.description;
            const priority = args.options.priority !== undefined ? (args.options.priority as TaskPriority) : TaskPriority.NORMAL;
            const urgency = args.options.urgency !== undefined ? (args.options.urgency as TaskUrgency) : TaskUrgency.REGULAR;
            const deadline = args.options.deadline !== undefined ? moment.utc(args.options.deadline) : undefined;
            const repeatSchedule = args.options.repeatSchedule;
            const reminderPolicy = args.options.reminderPolicy !== undefined ? (args.options.reminderPolicy as TaskReminderPolicy) : TaskReminderPolicy.WEEK_BEFORE;
            if (getTaskPriority().indexOf(priority) === -1) {
                throw new Error(`Invalid task priority ${priority}`);
            }
            if (repeatSchedule !== undefined && getTaskRepeatSchedule().indexOf(repeatSchedule) === -1) {
                throw new Error(`Invalid task repeat schedule ${repeatSchedule}`);
            }
            if (getTaskReminderPolicy().indexOf(reminderPolicy) === -1) {
                throw new Error(`Invalid reminder policy ${reminderPolicy}`);
            }

            let taskDoneType = null;
            let counterPolicy = undefined;
            let gaugePolicy = undefined;

            if (args.options.boolean !== undefined) {
                taskDoneType = TaskDoneType.BOOLEAN;
            } else if (args.options.subtasks !== undefined) {
                taskDoneType = TaskDoneType.SUBTASKS;
            } else if (args.options.counter !== undefined) {
                taskDoneType = TaskDoneType.COUNTER;
                counterPolicy = parseCounterPolicy(args.options.counter);
            } else if (args.options.gauge !== undefined) {
                taskDoneType = TaskDoneType.GAUGE;
                gaugePolicy = parseGaugePolicy(args.options.gauge);
            } else {
                taskDoneType = TaskDoneType.BOOLEAN;
            }

            const req: CreateTaskRequest = {
                goalId: goalId,
                title: title,
                description: description,
                priority: priority,
                urgency: urgency,
                deadline: deadline,
                repeatSchedule: repeatSchedule,
                reminderPolicy: reminderPolicy,
                donePolicy: {
                    type: taskDoneType,
                    counter: counterPolicy,
                    gauge: gaugePolicy
                }
            };

            const res = await client.do<CreateTaskRequest, CreateTaskResponse>("createTask", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:move-task <taskId>")
        .description("Move a task to another goal, or to a new position")
        .option("-c, --childOf <goalId>", "Moves task to be a child of the given goal")
        .option("-p, --position <position>", "Moves task at position under the goal")
        .types({ string: [ "c", "childOf", "p", "position" ]})
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const taskId = Number.parseInt(args.taskId);
            const goalId = args.options.childOf !== undefined ? Number.parseInt(args.options.childOf) : undefined;
            const position = args.options.position !== undefined ? Number.parseInt(args.options.position) : undefined;

            const req = {
                taskId: taskId,
                goalId: goalId,
                position: position
            };

            const res = await client.do<MoveTaskRequest, MoveTaskResponse>("moveTask", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-task-title <taskId> <title...>")
        .description("Change the title of a given task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const taskId = Number.parseInt(args.taskId);
            const title = args.title.join(" ");

            const req = {
                taskId: taskId,
                title: title
            };

            const res = await client.do<UpdateTaskRequest, UpdateTaskResponse>("updateTask", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-task-description <taskId> <description...>")
        .description("Change the description of a given task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const taskId = Number.parseInt(args.taskId);
            const description = args.description.join(" ");
            const req = {
                taskId: taskId,
                description: description
            };
            const res = await client.do<UpdateTaskRequest, UpdateTaskResponse>("updateTask", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-task-priority <taskId> <priority>")
        .description("Change the priority of a given task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const taskId = Number.parseInt(args.taskId);
            const priority = args.priority as TaskPriority;
            if (getTaskPriority().indexOf(priority) === -1) {
                throw new Error(`Invalid task priority ${priority}`);
            }

            const req = {
                taskId: taskId,
                priority: priority
            };
            const res = await client.do<UpdateTaskRequest, UpdateTaskResponse>("updateTask", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-task-urgency <taskId> <urgency>")
        .description("Change the urgency of a given task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const taskId = Number.parseInt(args.taskId);
            const urgency = args.urgency as TaskUrgency;
            if (getTaskUrgency().indexOf(urgency) === -1) {
                throw new Error(`Invalid task urgency ${urgency}`);
            }

            const req = {
                taskId: taskId,
                urgency: urgency
            };
            const res = await client.do<UpdateTaskRequest, UpdateTaskResponse>("updateTask", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-task-deadline <taskId> [deadline]")
        .description("Change the deadline of a given task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const taskId = Number.parseInt(args.taskId);
            const deadline = args.deadline !== undefined ? moment.utc(args.deadline) : undefined;
            const clearDeadline = args.deadline === undefined;

            const req = {
                taskId: taskId,
                deadline: deadline,
                clearDeadline: clearDeadline
            };
            const res = await client.do<UpdateTaskRequest, UpdateTaskResponse>("updateTask", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-task-schedule <taskId> [repeatSchedule]")
        .description("Change the repeat schedule for a task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
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
            const res = await client.do<UpdateTaskRequest, UpdateTaskResponse>("updateTask", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-task-reminder-policy <taskId> <reminderPolicy>")
        .description("Change the reminder policy for a task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const taskId = Number.parseInt(args.taskId);
            const reminderPolicy = args.reminderPolicy;
            if (getTaskReminderPolicy().indexOf(reminderPolicy) === -1) {
                throw new Error(`Invalid task reminder policy ${reminderPolicy}`);
            }

            const req = {
                taskId: taskId,
                reminderPolicy: reminderPolicy
            };
            const res = await client.do<UpdateTaskRequest, UpdateTaskResponse>("updateTask", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:suspend-task <taskId>")
        .description("Suspend a repeating task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const taskId = Number.parseInt(args.taskId);

            const req = {
                taskId: taskId,
                isSuspended: true
            };
            const res = await client.do<UpdateTaskRequest, UpdateTaskResponse>("updateTask", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:unsuspend-task <taskId>")
        .description("Suspend a repeating task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const taskId = Number.parseInt(args.taskId);

            const req = {
                taskId: taskId,
                isSuspended: false
            };
            const res = await client.do<UpdateTaskRequest, UpdateTaskResponse>("updateTask", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:archive-task <taskId>")
        .description("Archive a given task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const taskId = Number.parseInt(args.taskId);

            const req = {
                taskId: taskId
            };
            const res = await client.do<ArchiveTaskRequest, ArchiveTaskResponse>("archiveTask", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:new-subtask <taskId> <title...>")
        .description("Add a new subtask to a task")
        .option("-c, --childOf <parentSubTaskId>", "The subtask of taskId to nest this one under")
        .types({ string: [ "c", "childOf" ]})
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const taskId = Number.parseInt(args.taskId);
            const title = args.title.join(" ");
            const parentSubTaskId = args.options.childOf ? Number.parseInt(args.options.childOf) : undefined;

            const req = {
                taskId: taskId,
                title: title,
                parentSubTaskId: parentSubTaskId
            };
            const res = await client.do<CreateSubTaskRequest, CreateSubTaskResponse>("createSubTask", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:move-subtask <subTaskId>")
        .description("Move a subtask as a child of another one or changes its position")
        .option("-t, --toplevel", "Moves goal to the toplevel")
        .option("-c, --childOf <parentSubTaskId>", "The subtask to nest this one under")
        .option("-p, --position <position>", "The position to move the subtask to")
        .types({ string: [ "c", "childOf", "s", "subtaskChildOf", "p", "position" ]})
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
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
            const res = await client.do<MoveSubTaskRequest, MoveSubTaskResponse>("moveSubTask", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-subtask-title <subTaskId> <title...>")
        .description("Change the name of a subtask")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const subTaskId = Number.parseInt(args.subTaskId);
            const title = args.title.join(" ");

            const req = {
                subTaskId: subTaskId,
                title: title
            };
            const res = await client.do<UpdateSubTaskRequest, UpdateSubTaskResponse>("updateSubTask", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:archive-subtask <subTaskId>")
        .description("Archive a given subtask")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const subTaskId = Number.parseInt(args.subTaskId);

            const req = {
                subTaskId: subTaskId
            };
            const res = await client.do<ArchiveSubTaskRequest, ArchiveSubTaskResponse>("archiveSubTask", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-counter-task-config <taskId> <config>")
        .description("Change the configuration of a counter task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const taskId = Number.parseInt(args.taskId);
            const counterPolicy = parseCounterPolicy(args.config);

            const req: UpdateTaskRequest = {
                taskId: taskId,
                counterPolicy: counterPolicy
            };

            const res = await client.do<UpdateTaskRequest, UpdateTaskResponse>("updateTask", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("plan:set-gauge-task-config <taskId> <config>")
        .description("Change the configuration of a gauge task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const taskId = Number.parseInt(args.taskId);
            const gaugePolicy = parseGaugePolicy(args.config);

            const req: UpdateTaskRequest = {
                taskId: taskId,
                gaugePolicy: gaugePolicy
            };

            const res = await client.do<UpdateTaskRequest, UpdateTaskResponse>("updateTask", req);
            vorpal.log(printPlan(res.plan));
        });

    vorpal
        .command("schedule:show")
        .description("Displays the current schedule")
        .actionWithAuth(async (vorpal: Vorpal, _args: Args) => {
            const req = {};
            const res = await client.do<GetLatestScheduleRequest, GetLatestScheduleResponse>("getLatestSchedule", req);
            vorpal.log(printSchedule(res.schedule, res.plan));
        });

    vorpal
        .command("schedule:increment-metric <metricId>")
        .description("Increment a counter metric")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const metricId = Number.parseInt(args.metricId);
            const req = {
                metricId: metricId
            };
            const res = await client.do<IncrementMetricRequest, IncrementMetricResponse>("incrementMetric", req);
            vorpal.log(printSchedule(res.schedule, res.plan));
        });

    vorpal
        .command("schedule:record-metric <metricId> <value>")
        .description("Record a new value for a gauge metric")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const metricId = Number.parseInt(args.metricId);
            const value = Number.parseFloat(args.value);
            const req = {
                metricId: metricId,
                value: value
            };
            const res = await client.do<RecordForMetricRequest, RecordForMetricResponse>("recordForMetric", req);
            vorpal.log(printSchedule(res.schedule, res.plan));
        });

    vorpal
        .command("schedule:mark-task-as-in-progress <scheduledTaskEntryId>")
        .description("Marks a task as in progress")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const scheduledTaskEntryId = Number.parseInt(args.scheduledTaskEntryId);
            const req = {
                scheduledTaskEntryId: scheduledTaskEntryId,
                inProgress: true
            };
            const res = await client.do<UpdateScheduledTaskEntryRequest, UpdateScheduledTaskEntryResponse>("updateScheduledTaskEntry", req);
            vorpal.log(printSchedule(res.schedule, res.plan));
        });

    vorpal
        .command("schedule:unmark-task-as-in-progress <scheduledTaskEntryId>")
        .description("Marks a task as in progress")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const scheduledTaskEntryId = Number.parseInt(args.scheduledTaskEntryId);
            const req = {
                scheduledTaskEntryId: scheduledTaskEntryId,
                inProgress: false
            };
            const res = await client.do<UpdateScheduledTaskEntryRequest, UpdateScheduledTaskEntryResponse>("updateScheduledTaskEntry", req);
            vorpal.log(printSchedule(res.schedule, res.plan));
        });


    vorpal
        .command("schedule:mark-task-as-done <scheduledTaskEntryId>")
        .description("Marks a task as done")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const scheduledTaskEntryId = Number.parseInt(args.scheduledTaskEntryId);
            const req = {
                scheduledTaskEntryId: scheduledTaskEntryId
            };
            const res = await client.do<MarkTaskAsDoneRequest, MarkTaskAsDoneResponse>("markTaskAsDone", req);
            vorpal.log(printSchedule(res.schedule, res.plan));
        });

    vorpal
        .command("schedule:mark-subtask-as-done <scheduledTaskEntryId> <subTaskId>")
        .description("Mark a subtask as done")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const scheduledTaskEntryId = Number.parseInt(args.scheduledTaskEntryId);
            const subTaskId = Number.parseInt(args.subTaskId);
            const req = {
                scheduledTaskEntryId: scheduledTaskEntryId,
                subTaskId: subTaskId
            };
            const res = await client.do<MarkSubTaskAsDoneRequest, MarkSubTaskAsDoneResponse>("markSubTaskAsDone", req);
            vorpal.log(printSchedule(res.schedule, res.plan));
        });

    vorpal
        .command("schedule:increment-counter-task <scheduledTaskEntryId>")
        .description("Increment the value for a counter task")
        .option("-i, --increment <increment>", "How much to increment the counter. Defaults to 1")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const scheduledTaskEntryId = Number.parseInt(args.scheduledTaskEntryId);
            const increment = args.options.increment !== undefined ? Number.parseInt(args.options.increment) : undefined;
            const req = {
                scheduledTaskEntryId: scheduledTaskEntryId,
                increment: increment
            };
            const res = await client.do<IncrementCounterTaskRequest, IncrementCounterTaskResponse>("incrementCounterTask", req);
            vorpal.log(printSchedule(res.schedule, res.plan));
        });

    vorpal
        .command("schedule:set-gauge-task <scheduledTaskEntryId> <level>")
        .description("Increment the value for a counter task")
        .actionWithAuth(async (vorpal: Vorpal, args: Args) => {
            const scheduledTaskEntryId = Number.parseInt(args.scheduledTaskEntryId);
            const level = Number.parseInt(args.level);
            const req = {
                scheduledTaskEntryId: scheduledTaskEntryId,
                level: level
            };
            const res = await client.do<SetGaugeTaskRequest, SetGaugeTaskResponse>("setGaugeTask", req);
            vorpal.log(printSchedule(res.schedule, res.plan));
        });

    vorpal
        .delimiter(">> ")
        .show();
}

async function getUserConfigFromLocalStorage(): Promise<UserConfig> {
    const userConfigPath = buildUserConfigLocalStoragePath();
    try {
        return await fs.readJson(userConfigPath, { encoding: "utf-8" }) as UserConfig;
    } catch (e) {
        return {
            domain: DEFAULT_DOMAIN
        };
    }
}

async function saveUserConfigToLocalStorage(userConfig: UserConfig): Promise<void> {
    const userConfigPath = buildUserConfigLocalStoragePath();
    await fs.ensureFile(userConfigPath);
    await fs.writeJson(userConfigPath, userConfig);
}

function buildUserConfigLocalStoragePath(): string {
    return path.join(os.homedir(), HOME_CONF_PATH, "user-config");
}

async function getUserAuthInfoFromLocalStorage(): Promise<string | undefined> {
    const authInfoPath = buildAuthInfoLocalStoragePath();
    try {
        return await fs.readFile(authInfoPath, { encoding: "utf-8" });
    } catch (e) {
        return undefined;
    }
}

async function saveUserAuthInfoToLocalStorage(authInfoToken: string): Promise<void> {
    const authInfoPath = buildAuthInfoLocalStoragePath();
    await fs.ensureFile(authInfoPath);
    await fs.chmod(authInfoPath, "0600");
    await fs.writeFile(authInfoPath, authInfoToken, { encoding: "utf-8" });
}

async function clearUserAuthInfoFromLocalStorage() {
    const authInfoPath = buildAuthInfoLocalStoragePath();
    await fs.remove(authInfoPath);
}

function buildAuthInfoLocalStoragePath(): string {
    return path.join(os.homedir(), HOME_CONF_PATH, "user-auth");
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

    res.push(`id=${plan.id} ${plan.isSuspended ? "s" : ""}`);

    for (const goalId of plan.goalsOrder) {
        const goal = plan.goals.find(g => g.id === goalId) as Goal;
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
            const subGoal = goal.subgoals.find(sg => sg.id === subGoalId) as Goal;
            res.push(printGoal(subGoal, indent + 2));
        }
    }

    if (goal.metricsOrder.length > 0) {
        res.push(`${indentStr}  metrics:`);

        for (const metricId of goal.metricsOrder) {
            const metric = goal.metrics.find(m => m.id === metricId) as Metric;
            res.push(`${indentStr}    [${metric.id}] ${metric.type === MetricType.GAUGE ? 'g' : 'c'} ${metric.title}`);
        }
    }

    if (goal.tasksOrder.length > 0) {
        res.push(`${indentStr}  tasks:`);

        for (const taskId of goal.tasksOrder) {
            const task = goal.tasks.find(t => t.id === taskId) as Task;
            res.push(printTask(task, indent));

        }
    }

    return res.join("\n");
}

function printTask(task: Task, indent: number): string {
    const res = [];
    const indentStr = " ".repeat(indent);

    res.push(`${indentStr}    [${task.id}] ${task.isSuspended ? "s " : ""}${task.title} ${task.donePolicy.type} @${task.deadline ? task.deadline.format(STANDARD_DATE_FORMAT) : ""} ${task.priority === TaskPriority.HIGH ? "(high)" : ""} ${task.urgency === TaskUrgency.CRITICAL ? "Must" : "Nice"} ${task.repeatSchedule ? task.repeatSchedule : ""} ${task.reminderPolicy}`);

    switch (task.donePolicy.type) {
        case TaskDoneType.BOOLEAN:
            break;
        case TaskDoneType.SUBTASKS:
            const substasksPolicy = task.donePolicy.subtasks as SubtasksPolicy;
            if (substasksPolicy.subTasksOrder.length > 0) {
                res.push(`${indentStr}      subtasks:`);

                for (const subTaskId of substasksPolicy.subTasksOrder) {
                    const subTask = substasksPolicy.subTasks.find(st => st.id === subTaskId) as SubTask;
                    res.push(printSubTask(subTask, indent + 8));
                }
            }
            break;
        case TaskDoneType.COUNTER:
            break;
        case TaskDoneType.GAUGE:
            break;
    }


    return res.join("\n");
}

function printSubTask(subTask: SubTask, indent: number): string {
    const res = [];
    const indentStr = " ".repeat(indent);

    res.push(`${indentStr}[${subTask.id}] ${subTask.title}`);

    if (subTask.subTasksOrder.length > 0) {
        for (const subSubTaskId of subTask.subTasksOrder) {
            const subSubTask = subTask.subTasks.find(st => st.id === subSubTaskId) as SubTask;
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

    const metric = plan.goals.map(g => g.metrics.find(m => m.id === collectedMetric.metricId)).find(m => m !== undefined);
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

    const task = plan.goals.map(g => g.tasks.find(t => t.id === scheduledTask.taskId)).find(t => t !== undefined);
    if (task === undefined) {
        throw new Error(`Cannot find task for ${scheduledTask.taskId}`);
    }

    res.push(`    [${scheduledTask.id}] ${task.title}:`);

    for (const entry of scheduledTask.entries) {
        res.push(`     - [${entry.id}] ${entry.isDone ? "[+]" : "[-]"}${entry.inProgress ? " In Progress" : ""}`);
    }

    return res.join("\n");
}

function parseCounterPolicy(policyStr: string): CounterPolicy {
    const policyLs = policyStr.trim().split(" ").filter(s => s.trim() !== "");

    if (policyLs.length < 2) {
        throw new Error(`Invalid counter policy "${policyStr}"`);
    }

    const type = policyLs[0];
    const lowerLimitStr = policyLs[1];
    const lowerLimit = Number.parseInt(lowerLimitStr);
    if (Number.isNaN(lowerLimit) || lowerLimit.toString() !== lowerLimitStr) {
        throw new Error(`Invalid counter policy "${policyStr}"`);
    }

    switch (type) {
        case CounterPolicyType.EXACTLY:
            return {
                type: CounterPolicyType.EXACTLY,
                lowerLimit: lowerLimit
            };
        case CounterPolicyType.AT_MOST:
            return {
                type: CounterPolicyType.AT_MOST,
                lowerLimit: lowerLimit
            };
        case CounterPolicyType.AT_LEAST:
            return {
                type: CounterPolicyType.AT_LEAST,
                lowerLimit: lowerLimit
            };
        case CounterPolicyType.BETWEEN:
            if (policyLs.length !== 3) {
                throw new Error(`Invalid counter policy "${policyStr}"`);
            }

            const upperLimitStr = policyLs[2];
            const upperLimit = Number.parseInt(upperLimitStr);
            if (Number.isNaN(upperLimit) || upperLimit.toString() !== upperLimitStr) {
                throw new Error(`Invalid counter policy "${policyStr}"`);
            }

            return {
                type: CounterPolicyType.BETWEEN,
                lowerLimit: lowerLimit,
                upperLimit: upperLimit
            };
        default:
            throw new Error(`Invalid counter policy "${policyStr}"`);
    }
}

function parseGaugePolicy(policyStr: string): GaugePolicy {
    const policyLs = policyStr.trim().split(" ").filter(s => s.trim() !== "");

    if (policyLs.length < 2) {
        throw new Error(`Invalid counter policy "${policyStr}"`);
    }

    const type = policyLs[0];
    const lowerLimitStr = policyLs[1];
    const lowerLimit = Number.parseInt(lowerLimitStr);
    if (Number.isNaN(lowerLimit) || lowerLimit.toString() !== lowerLimitStr) {
        throw new Error(`Invalid counter policy "${policyStr}"`);
    }

    switch (type) {
        case GaugePolicyType.EXACTLY:
            return {
                type: GaugePolicyType.EXACTLY,
                lowerLimit: lowerLimit
            };
        case GaugePolicyType.AT_MOST:
            return {
                type: GaugePolicyType.AT_MOST,
                lowerLimit: lowerLimit
            };
        case GaugePolicyType.AT_LEAST:
            return {
                type: GaugePolicyType.AT_LEAST,
                lowerLimit: lowerLimit
            };
        case GaugePolicyType.BETWEEN:
            if (policyLs.length !== 3) {
                throw new Error(`Invalid counter policy "${policyStr}"`);
            }

            const upperLimitStr = policyLs[2];
            const upperLimit = Number.parseInt(upperLimitStr);
            if (Number.isNaN(upperLimit) || upperLimit.toString() !== upperLimitStr) {
                throw new Error(`Invalid counter policy "${policyStr}"`);
            }

            return {
                type: GaugePolicyType.BETWEEN,
                lowerLimit: lowerLimit,
                upperLimit: upperLimit
            };
        default:
            throw new Error(`Invalid counter policy "${policyStr}"`);
    }
}

main();