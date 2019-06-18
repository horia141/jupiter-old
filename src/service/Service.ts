import * as knex from "knex";
import {Transaction} from "knex";
import * as moment from "moment";

import {
    CollectedMetric,
    CollectedMetricEntry,
    Goal,
    GoalRange,
    Metric,
    MetricType,
    Plan,
    Schedule,
    ScheduledTask,
    Task,
    TaskPriority,
    TaskRepeatSchedule
} from "./entities";

export class ServiceError extends Error {

    public constructor(message: string) {
        super(message);
    }
}

export class CriticalServiceError extends ServiceError {

    public constructor(message: string) {
        super(message);
    }

}

export class Service {

    private static readonly REPEATING_TASKS_INTERVAL = moment.duration(1, "minute");

    private static readonly DEFAULT_USER_ID = 1;

    private static readonly PLAN_TABLE = "core.plans";
    private static readonly PLAN_FIELDS = [
        "id",
        "version_major",
        "version_minor",
        "plan"
    ];

    private static readonly SCHEDULE_TABLE = "core.schedules";
    private static readonly SCHEDULE_FIELDS = [
        "id",
        "version_major",
        "version_minor",
        "schedule"
    ];

    public constructor(
        private readonly conn: knex) {
    }

    public async init(): Promise<void> {
        await this.dbCreatePlanIfDoesNotExist();
        setInterval(this.updateScheduleWithRepeatingTasks.bind(this), Service.REPEATING_TASKS_INTERVAL.asMilliseconds());
    }

    public async getLatestPlan(): Promise<GetLatestPlanResponse> {
        const plan = await this.dbGetLatestPlan(this.conn, Service.DEFAULT_USER_ID);

        return {
            plan: plan
        };
    }

    public async createGoal(req: CreateGoalRequest): Promise<CreateGoalResponse> {

        const newGoal: Goal = {
            id: -1,
            title: req.title,
            description: "",
            range: GoalRange.LIFETIME,
            subgoals: [],
            metrics: [],
            tasks: [],
            boards: [],
            canBeMarkedAsDone: true,
            canBeRemoved: true,
            isDone: false
        };

        const newPlanAndSchedule = await this.dbModifyPlanAndSchedule(planAndSchedule => {
            planAndSchedule.plan.goals.push(newGoal);
            planAndSchedule.plan.version.minor++;
            planAndSchedule.plan.idSerialHack++;
            newGoal.id = planAndSchedule.plan.idSerialHack;
            planAndSchedule.plan.goalsById.set(newGoal.id, newGoal);

            return [WhatToSave.PLAN_AND_SCHEDULE, planAndSchedule];
        });

        return {
            plan: newPlanAndSchedule.plan
        };
    }

    public async updateGoal(req: UpdateGoalRequest): Promise<UpdateGoalResponse> {

        const newPlanAndSchedule = await this.dbModifyPlanAndSchedule(planAndSchedule => {
            const goal = planAndSchedule.plan.goalsById.get(req.goalId);

            if (goal === undefined) {
                throw new ServiceError(`Goal with id ${req.goalId} does not exist for user ${Service.DEFAULT_USER_ID}`);
            }

            if (req.title !== undefined) {
                goal.title = req.title;
            }
            planAndSchedule.plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, planAndSchedule];
        });

        return {
            plan: newPlanAndSchedule.plan
        };
    }

    public async markGoalAsDone(req: MarkGoalAsDoneRequest): Promise<MarkGoalAsDoneResponse> {

        const newPlanAndSchedule = await this.dbModifyPlanAndSchedule(planAndSchedule => {
            const goal = planAndSchedule.plan.goalsById.get(req.goalId);

            if (goal === undefined) {
                throw new ServiceError(`Goal with id ${req.goalId} does not exist for user ${Service.DEFAULT_USER_ID}`);
            }

            if (!goal.canBeMarkedAsDone) {
                throw new ServiceError(`Goal with id ${req.goalId} cannot be marked as done`);
            }

            if (goal.isDone) {
                throw new ServiceError(`Goal with id ${req.goalId} is already done`);
            }

            goal.isDone = true;
            planAndSchedule.plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, planAndSchedule];
        });

        return {
            plan: newPlanAndSchedule.plan
        };
    }

    public async createMetric(req: CreateMetricRequest): Promise<CreateMetricResponse> {

        const newMetric: Metric = {
            id: -1,
            goalId: req.goalId,
            title: req.title,
            type: req.isCounter ? MetricType.COUNTER : MetricType.GAUGE
        };

        const newCollectedMetric: CollectedMetric = {
            id: -1,
            metricId: -1,
            entries: []
        };

        const newPlanAndSchedule = await this.dbModifyPlanAndSchedule(planAndSchedule => {
            const goal = planAndSchedule.plan.goalsById.get(req.goalId);

            if (goal === undefined) {
                throw new ServiceError(`Goal with id ${req.goalId} does not exist for user ${Service.DEFAULT_USER_ID}`);
            }

            if (goal.isDone) {
                throw new ServiceError(`Goal with id ${req.goalId} cannot have metrics added to it since it is done`);
            }

            goal.metrics.push(newMetric);
            planAndSchedule.plan.version.minor++;
            planAndSchedule.plan.idSerialHack++;
            newMetric.id = planAndSchedule.plan.idSerialHack;
            planAndSchedule.plan.metricsById.set(newMetric.id, newMetric);

            planAndSchedule.schedule.collectedMetrics.push(newCollectedMetric);
            planAndSchedule.schedule.version.minor++;
            planAndSchedule.schedule.idSerialHack++;
            newCollectedMetric.id = planAndSchedule.schedule.idSerialHack;
            newCollectedMetric.metricId = newMetric.id;
            planAndSchedule.schedule.collectedMetricsByMetricId.set(newMetric.id, newCollectedMetric);

            return [WhatToSave.PLAN_AND_SCHEDULE, planAndSchedule];
        });

        return {
            plan: newPlanAndSchedule.plan
        };
    }

    public async updateMetric(req: UpdateMetricRequest): Promise<UpdateMetricResponse> {

        const newPlanAndSchedule = await this.dbModifyPlanAndSchedule(planAndSchedule => {
            const metric = planAndSchedule.plan.metricsById.get(req.metricId);

            if (metric === undefined) {
                throw new ServiceError(`Metric with id ${req.metricId} does not exist for user ${Service.DEFAULT_USER_ID}`);
            }

            if (req.title !== undefined) {
                metric.title = req.title;
            }
            planAndSchedule.plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, planAndSchedule];
        });

        return {
            plan: newPlanAndSchedule.plan
        };
    }

    public async createTask(req: CreateTaskRequest): Promise<CreateTaskResponse> {

        const rightNow = moment.utc();

        const newTask: Task = {
            id: -1,
            goalId: req.goalId,
            title: req.title,
            priority: TaskPriority.NORMAL,
            inProgress: false,
            repeatSchedule: req.repeatSchedule
        };

        const newScheduledTask: ScheduledTask = {
            id: -1,
            taskId: -1,
            entries: [{
                id: -1,
                scheduledTaskId: -1,
                isDone: false,
                repeatScheduleAt: rightNow.startOf("day")
            }]
        };

        const newPlanAndSchedule = await this.dbModifyPlanAndSchedule(planAndSchedule => {
            const goal = planAndSchedule.plan.goalsById.get(req.goalId);

            if (goal === undefined) {
                throw new ServiceError(`Goal with id ${req.goalId} does not exist for user ${Service.DEFAULT_USER_ID}`);
            }

            if (goal.isDone) {
                throw new ServiceError(`Goal with id ${req.goalId} cannot have tasks added to it since it is done`);
            }

            goal.tasks.push(newTask);
            planAndSchedule.plan.version.minor++;
            planAndSchedule.plan.idSerialHack++;
            newTask.id = planAndSchedule.plan.idSerialHack;

            planAndSchedule.schedule.scheduledTasks.push(newScheduledTask);
            planAndSchedule.schedule.version.minor++;
            planAndSchedule.schedule.idSerialHack++;
            newScheduledTask.id = planAndSchedule.schedule.idSerialHack;
            newScheduledTask.taskId = newTask.id;
            planAndSchedule.schedule.idSerialHack++;
            newScheduledTask.entries[0].id = planAndSchedule.schedule.idSerialHack;
            newScheduledTask.entries[0].scheduledTaskId = newScheduledTask.id;

            return [WhatToSave.PLAN_AND_SCHEDULE, planAndSchedule];
        });

        return {
            plan: newPlanAndSchedule.plan
        };
    }

    public async updateTask(req: UpdateTaskRequest): Promise<UpdateTaskResponse> {

        const newPlanAndSchedule = await this.dbModifyPlanAndSchedule(planAndSchedule => {
            const task = planAndSchedule.plan.tasksById.get(req.taskId);

            if (task === undefined) {
                throw new ServiceError(`Task with id ${req.taskId} does not exist for user ${Service.DEFAULT_USER_ID}`);
            }

            if (req.title !== undefined) {
                task.title = req.title;
            }
            planAndSchedule.plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, planAndSchedule];
        });

        return {
            plan: newPlanAndSchedule.plan
        };
    }

    public async getLatestSchedule(): Promise<GetLatestScheduleResponse> {
        const planAndSchedule = await this.dbGetLatestPlanAndSchedule();

        return {
            plan: planAndSchedule.plan,
            schedule: planAndSchedule.schedule
        };
    }

    public async incrementMetric(req: IncrementMetricRequest): Promise<IncrementMetricResponse> {

        const rightNow = moment.utc();

        const newCollectedMetricEntry: CollectedMetricEntry = {
            id: -1,
            collectedMetricId: -1,
            timestamp: rightNow,
            value: 1
        };

        return await this.handleMetric(req.metricId, newCollectedMetricEntry, MetricType.COUNTER);
    }

    public async recordForMetric(req: RecordForMetricRequest): Promise<RecordForMetricResponse> {

        const rightNow = moment.utc();

        const newCollectedMetricEntry: CollectedMetricEntry = {
            id: -1,
            collectedMetricId: -1,
            timestamp: rightNow,
            value: req.value
        };

        return await this.handleMetric(req.metricId, newCollectedMetricEntry, MetricType.GAUGE);
    }

    public async markTaskAsDone(req: MarkTaskAsDoneRequest): Promise<MarkTaskAsDoneResponse> {

        const newPlanAndSchedule = await this.dbModifyPlanAndSchedule(planAndSchedule => {

            const plan = planAndSchedule.plan;
            const schedule = planAndSchedule.schedule;

            const task = plan.tasksById.get(req.taskId);

            if (task === undefined) {
                throw new ServiceError(`Metric with id ${req.taskId} does not exist for user ${Service.DEFAULT_USER_ID}`);
            }

            const goal = plan.goalsById.get(task.goalId);

            if (goal === undefined) {
                throw new CriticalServiceError(`Goal with id ${task.goalId} does not exist for user ${Service.DEFAULT_USER_ID}`);
            }

            if (goal.isDone) {
                throw new ServiceError(`Goal with id ${goal.id} cannot be operated upon since it is done`);
            }

            const scheduledTask = schedule.scheduledTasksByTaskId.get(req.taskId);

            if (scheduledTask === undefined) {
                throw new CriticalServiceError(`Scheduled task for task with id ${req.taskId} does not exist for user ${Service.DEFAULT_USER_ID}`);
            }

            // Find the one scheduled task.
            scheduledTask.entries[0].isDone = true;
            schedule.version.minor++;

            return [WhatToSave.SCHEDULE, planAndSchedule];
        });

        return {
            plan: newPlanAndSchedule.plan,
            schedule: newPlanAndSchedule.schedule
        };
    }

    private async updateScheduleWithRepeatingTasks(): Promise<void> {

        function shouldAddRepeatedTaskToScheduleBasedOnDate(date: moment.Moment, repeatSchedule: TaskRepeatSchedule): boolean {
            switch (repeatSchedule) {
                case TaskRepeatSchedule.DAILY:
                    return true;
                case TaskRepeatSchedule.WEEKLY:
                    return date.isoWeekday() === 1;
                case TaskRepeatSchedule.MONTHLY:
                    return date.date() === 1;
                case TaskRepeatSchedule.QUARTERLY:
                    const monthIdx = date.month();
                    return date.date() === 1 && (monthIdx === 0 || monthIdx === 3 || monthIdx === 6 || monthIdx === 9);
                case TaskRepeatSchedule.YEARLY:
                    return date.date() === 1 && date.month() === 0;
            }
        }

        const rightNow = moment.utc();
        const rightNowDay = rightNow.startOf("day");

        await this.dbModifyPlanAndSchedule(planAndSchedule => {
            let modifiedSomething = false;

            for (const task of planAndSchedule.plan.tasksById.values()) {
                if (task.repeatSchedule === undefined) {
                    continue;
                }

                const scheduledTask = planAndSchedule.schedule.scheduledTasksByTaskId.get(task.id);

                if (scheduledTask === undefined) {
                    throw new CriticalServiceError(`Scheduled task for task with id ${task.id} does not exist`);
                }

                const goal = planAndSchedule.plan.goalsById.get(task.goalId);

                if (goal === undefined) {
                    throw new CriticalServiceError(`Goal with id ${task.goalId} does not exist for ${task.id}`);
                }

                if (goal.isDone) {
                    continue;
                }

                const lastEntry = scheduledTask.entries[scheduledTask.entries.length - 1]; // Guaranteed to always exist!
                const lastEntryRepeatScheduleAt = lastEntry.repeatScheduleAt.startOf("day"); // Should already be here!

                for (let date = lastEntryRepeatScheduleAt; date < rightNowDay; date = date.add(1, "day")) {
                    if (!shouldAddRepeatedTaskToScheduleBasedOnDate(date, task.repeatSchedule)) {
                        continue;
                    }

                    planAndSchedule.schedule.idSerialHack++;
                    scheduledTask.entries.push({
                        id: planAndSchedule.schedule.idSerialHack,
                        scheduledTaskId: scheduledTask.id,
                        isDone: false,
                        repeatScheduleAt: date
                    });
                    modifiedSomething = true;
                }
            }

            if (modifiedSomething) {
                planAndSchedule.schedule.version.minor++;
                return [WhatToSave.SCHEDULE, planAndSchedule];
            }  else {
                return [WhatToSave.NONE, planAndSchedule];
            }
        });
    }

    private async handleMetric(metricId: number, entry: CollectedMetricEntry, allowedType: MetricType): Promise<RecordForMetricResponse | IncrementMetricResponse> {
        const newPlanAndSchedule = await this.dbModifyPlanAndSchedule(planAndSchedule => {
            const plan = planAndSchedule.plan;
            const schedule = planAndSchedule.schedule;

            const metric = plan.metricsById.get(metricId);

            if (metric === undefined) {
                throw new ServiceError(`Metric with id ${metricId} does not exist for user ${Service.DEFAULT_USER_ID}`);
            }

            if (metric.type !== allowedType) {
                throw new ServiceError(`Metric with id ${metricId} is not an ${allowedType}`);
            }

            const goal = plan.goalsById.get(metric.goalId);

            if (goal === undefined) {
                throw new CriticalServiceError(`Goal with id ${metric.goalId} does not exist for user ${Service.DEFAULT_USER_ID} and metric ${metricId}`);
            }

            if (goal.isDone) {
                throw new ServiceError(`Goal with id ${goal.id} cannot be operated upon since it is done`);
            }

            const collectedMetric = schedule.collectedMetricsByMetricId.get(metricId);

            if (collectedMetric === undefined) {
                throw new CriticalServiceError(`Collected metric for metric with id ${metricId} does not exist`);
            }

            collectedMetric.entries.push(entry);
            schedule.version.minor++;
            schedule.idSerialHack++;
            entry.id = schedule.idSerialHack;
            entry.collectedMetricId = collectedMetric.id;

            return [WhatToSave.SCHEDULE, planAndSchedule];
        });

        return {
            plan: newPlanAndSchedule.plan,
            schedule: newPlanAndSchedule.schedule
        };
    }

    private async dbGetLatestPlanAndSchedule(): Promise<PlanAndSchedule> {
        return await this.conn.transaction(async (trx: Transaction) => {
            const plan = await this.dbGetLatestPlan(trx, Service.DEFAULT_USER_ID);
            const schedule = await this.dbGetLatestSchedule(trx, Service.DEFAULT_USER_ID, plan.id);

            return {
                plan: plan,
                schedule: schedule
            };
        });
    }

    private async dbModifyPlanAndSchedule(action: (planAndSchedule: PlanAndSchedule) => [WhatToSave, PlanAndSchedule]): Promise<PlanAndSchedule> {
        return await this.conn.transaction(async (trx: Transaction) => {
            const plan = await this.dbGetLatestPlan(trx, Service.DEFAULT_USER_ID);
            const schedule = await this.dbGetLatestSchedule(trx, Service.DEFAULT_USER_ID, plan.id);

            const [whatToSave, newPlanAndSchedule] = action({plan: plan, schedule: schedule});

            let newSavedPlan;
            let newSavedSchedule;
            switch (whatToSave) {
                case WhatToSave.NONE:
                    newSavedPlan = newPlanAndSchedule.plan;
                    newSavedSchedule = newPlanAndSchedule.schedule;
                    break;
                case WhatToSave.PLAN:
                    newSavedPlan = await this.dbSavePlan(trx, Service.DEFAULT_USER_ID, newPlanAndSchedule.plan);
                    newSavedSchedule = newPlanAndSchedule.schedule;
                    break;
                case WhatToSave.SCHEDULE:
                    newSavedPlan = newPlanAndSchedule.plan;
                    newSavedSchedule = await this.dbSaveSchedule(trx, Service.DEFAULT_USER_ID, newPlanAndSchedule.plan.id, newPlanAndSchedule.schedule);
                    break;
                case WhatToSave.PLAN_AND_SCHEDULE:
                    newSavedPlan = await this.dbSavePlan(trx, Service.DEFAULT_USER_ID, newPlanAndSchedule.plan);
                    newSavedSchedule = await this.dbSaveSchedule(trx, Service.DEFAULT_USER_ID, newSavedPlan.id, newPlanAndSchedule.schedule);
                    break;
            }

            return {
                plan: newSavedPlan as Plan,
                schedule: newSavedSchedule as Schedule
            };
        });
    }

    private async dbCreatePlanIfDoesNotExist(): Promise<void> {
        await this.conn.transaction(async (trx: Transaction) => {
            try {
                await this.dbGetLatestPlan(trx, Service.DEFAULT_USER_ID);
            } catch (e) {
                if (!e.message.startsWith("No plan for user")) {
                    throw e;
                }

                const initialPlanAndSchedule = Service.getEmptyPlanAndSchedule();
                const newPlan = await this.dbSavePlan(trx, Service.DEFAULT_USER_ID, initialPlanAndSchedule.plan);
                await this.dbSaveSchedule(trx, Service.DEFAULT_USER_ID, newPlan.id, initialPlanAndSchedule.schedule);
            }
        });
    }

    private async dbGetLatestPlan(conn: knex, userId: number): Promise<Plan> {
        const planRows = await conn
            .from(Service.PLAN_TABLE)
            .select(Service.PLAN_FIELDS)
            .orderBy("version_major", "desc")
            .orderBy("version_minor", "desc")
            .where("user_id", userId)
            .limit(1);

        if (planRows.length === 0) {
            throw new ServiceError(`No plan for user ${userId}`);
        }

        return Service.dbPlanToPlan(planRows[0]);
    }

    private async dbSavePlan(conn: knex, userId: number, plan: Plan): Promise<Plan> {
        const planRows = await conn
            .from(Service.PLAN_TABLE)
            .returning(Service.PLAN_FIELDS)
            .insert({
                version_major: plan.version.major,
                version_minor: plan.version.minor,
                plan: Service.planToDbPlan(plan),
                user_id: userId
            });

        if (planRows.length === 0) {
            throw new ServiceError(`Could not insert plan for ${userId}`);
        }

        return Service.dbPlanToPlan(planRows[0]);
    }

    private async dbGetLatestSchedule(conn: knex, userId: number, planId: number): Promise<Schedule> {
        const scheduleRows = await conn
            .from(Service.SCHEDULE_TABLE)
            .select(Service.SCHEDULE_FIELDS)
            .orderBy("version_major", "desc")
            .orderBy("version_minor", "desc")
            .where("user_id", userId)
            .andWhere("plan_id", planId)
            .limit(1);

        if (scheduleRows.length === 0) {
            throw new ServiceError(`No schedule for user ${userId} and plan ${planId}`);
        }

        return Service.dbScheduleToSchedule(scheduleRows[0]);
    }

    private async dbSaveSchedule(conn: knex, userId: number, planId: number, schedule: Schedule): Promise<Schedule> {
        const scheduleRows = await conn
            .from(Service.SCHEDULE_TABLE)
            .returning(Service.SCHEDULE_FIELDS)
            .insert({
                version_major: schedule.version.major,
                version_minor: schedule.version.minor,
                schedule: Service.scheduleToDbSchedule(schedule),
                user_id: userId,
                plan_id: planId
            });

        if (scheduleRows.length === 0) {
            throw new ServiceError(`Could not insert sechedule for ${userId} and plan ${planId}`);
        }

        return Service.dbScheduleToSchedule(scheduleRows[0]);
    }

    private static dbPlanToPlan(planRow: any): Plan {
        // TODO(horia141): Proper deserialization here!
        const dbPlan = planRow["plan"];

        const plan: Plan = {
            id: planRow["id"],
            version: dbPlan.version,
            goals: dbPlan.goals,
            idSerialHack: dbPlan.idSerialHack,
            goalsById: new Map<number, Goal>(),
            metricsById: new Map<number, Metric>(),
            tasksById: new Map<number, Task>()
        };

        // TODO(horia141): deal with subgoals here!
        for (const goal of plan.goals) {
            plan.goalsById.set(goal.id, goal);

            for (const metric of goal.metrics) {
                plan.metricsById.set(metric.id, metric);
            }

            for (const task of goal.tasks) {
                plan.tasksById.set(task.id, task);
            }
        }

        return plan;
    }

    private static planToDbPlan(plan: Plan): any {
        return {
            version: plan.version,
            goals: plan.goals,
            idSerialHack: plan.idSerialHack
        };
    }

    private static dbScheduleToSchedule(scheduleRow: any): Schedule {
        // TODO(horia141): Proper deserializtion here!
        const dbSchedule = scheduleRow["schedule"];

        const schedule: Schedule = {
            id: scheduleRow["id"],
            version: dbSchedule.version,
            collectedMetrics: dbSchedule.collectedMetrics.map((cm: any) => {
                return {
                    id: cm.id,
                    metricId: cm.metricId,
                    entries: cm.entries.map((smp: any) => {
                        return {
                            id: smp.id,
                            collectedMetricId: smp.collectedMetricId,
                            timestamp: moment.unix(smp.timestamp),
                            value: smp.value
                        };
                    })
                };
            }),
            scheduledTasks: dbSchedule.scheduledTasks.map((st: any) => {
                return {
                    id: st.id,
                    taskId: st.taskId,
                    entries: st.entries.map((ste: any) => {
                        return {
                            id: ste.id,
                            scheduledTaskId: ste.scheduledTaskId,
                            isDone: ste.isDone,
                            repeatScheduleAt: moment.unix(ste.repeatScheduleAt)
                        };
                    })
                };
            }),
            idSerialHack: dbSchedule.idSerialHack,
            collectedMetricsByMetricId: new Map<number, CollectedMetric>(),
            scheduledTasksByTaskId: new Map<number, ScheduledTask>()
        };

        for (const collectedMetric of schedule.collectedMetrics) {
            schedule.collectedMetricsByMetricId.set(collectedMetric.metricId, collectedMetric);
        }

        for (const scheduledTask of schedule.scheduledTasks) {
            schedule.scheduledTasksByTaskId.set(scheduledTask.taskId, scheduledTask);
        }

        return schedule;
    }

    private static scheduleToDbSchedule(schedule: Schedule): any {
        return {
            version: schedule.version,
            collectedMetrics: schedule.collectedMetrics.map(cm => {
                return {
                    id: cm.id,
                    metricId: cm.metricId,
                    entries: cm.entries.map(smp => {
                        return {
                            id: smp.id,
                            collectedMetricId: smp.collectedMetricId,
                            timestamp: smp.timestamp.unix(),
                            value: smp.value
                        };
                    })
                };
            }),
            scheduledTasks: schedule.scheduledTasks.map(st => {
                return {
                    id: st.id,
                    taskId: st.taskId,
                    entries: st.entries.map(ste => {
                        return {
                            id: ste.id,
                            scheduledTaskId: ste.scheduledTaskId,
                            isDone: ste.isDone,
                            repeatScheduleAt: ste.repeatScheduleAt.unix()
                        };
                    })
                };
            }),
            idSerialHack: schedule.idSerialHack
        };
    }

    private static getEmptyPlanAndSchedule(): PlanAndSchedule {
        const newPlanAndSchedule = {
            plan: {
                id: -1,
                version: {
                    major: 1,
                    minor: 1
                },
                goals: [{
                    id: 1,
                    title: "Inbox",
                    description: "Stuff you're working on outside of any big project",
                    range: GoalRange.LIFETIME,
                    subgoals: [],
                    metrics: [],
                    tasks: [],
                    boards: [],
                    canBeMarkedAsDone: false,
                    canBeRemoved: false,
                    isDone: false
                }],
                idSerialHack: 1,
                goalsById: new Map<number, Goal>(),
                metricsById: new Map<number, Metric>(),
                tasksById: new Map<number, Task>()
            },
            schedule: {
                id: -1,
                version: {
                    major: 1,
                    minor: 1
                },
                scheduledTasks: [],
                collectedMetrics: [],
                idSerialHack: 0,
                collectedMetricsByMetricId: new Map<number, CollectedMetric>(),
                scheduledTasksByTaskId: new Map<number, ScheduledTask>()
            }
        };
        newPlanAndSchedule.plan.goalsById.set(1, newPlanAndSchedule.plan.goals[0]);

        return newPlanAndSchedule;
    }
}

export interface GetLatestPlanResponse {
    plan: Plan;
}

export interface CreateGoalRequest {
    title: string;
}

export interface CreateGoalResponse {
    plan: Plan;
}

export interface UpdateGoalRequest {
    goalId: number;
    title?: string;
}

export interface UpdateGoalResponse {
    plan: Plan;
}

export interface MarkGoalAsDoneRequest {
    goalId: number;
}

export interface MarkGoalAsDoneResponse {
    plan: Plan;
}

export interface CreateMetricRequest {
    goalId: number;
    title: string;
    isCounter: boolean;
}

export interface CreateMetricResponse {
    plan: Plan;
}

export interface UpdateMetricRequest {
    metricId: number;
    title?: string;
}

export interface UpdateMetricResponse {
    plan: Plan;
}

export interface CreateTaskRequest {
    goalId: number;
    title: string;
    repeatSchedule?: TaskRepeatSchedule;
}

export interface CreateTaskResponse {
    plan: Plan;
}

export interface UpdateTaskRequest {
    taskId: number;
    title?: string;
}

export interface UpdateTaskResponse {
    plan: Plan;
}

export interface GetLatestScheduleResponse {
    plan: Plan;
    schedule: Schedule;
}

export interface IncrementMetricRequest {
    metricId: number;
}

export interface IncrementMetricResponse {
    plan: Plan;
    schedule: Schedule;
}

export interface RecordForMetricRequest {
    metricId: number;
    value: number;
}

export interface RecordForMetricResponse {
    plan: Plan;
    schedule: Schedule;
}

export interface MarkTaskAsDoneRequest {
    taskId: number;
}

export interface MarkTaskAsDoneResponse {
    plan: Plan;
    schedule: Schedule;
}

enum WhatToSave {
    NONE = "none",
    PLAN = "plan",
    SCHEDULE = "schedule",
    PLAN_AND_SCHEDULE = "plan-and-schedule"
}

interface PlanAndSchedule {
    plan: Plan;
    schedule: Schedule;
}