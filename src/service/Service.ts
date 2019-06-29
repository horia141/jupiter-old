import * as knex from "knex";
import {Transaction} from "knex";
import * as moment from "moment";

import {
    Board,
    CollectedMetric,
    CollectedMetricEntry,
    Goal,
    GoalRange,
    Metric,
    MetricType,
    Plan,
    Schedule,
    ScheduledTask, ScheduledTaskEntry, SubTask,
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

    // Plans

    public async createGoal(req: CreateGoalRequest): Promise<CreateGoalResponse> {

        const rightNow = moment.utc();

        const newGoal: Goal = {
            id: -1,
            parentGoalId: req.parentGoalId,
            isSystemGoal: false,
            title: req.title,
            description: req.description,
            range: req.range,
            deadline: Service.deadlineFromRange(rightNow, req.range),
            subgoals: [],
            metrics: [],
            tasks: [],
            boards: [],
            isDone: false,
            isArchived: false
        };

        const newPlanAndSchedule = await this.dbModifyPlanAndSchedule(planAndSchedule => {
            const plan = planAndSchedule.plan;

            if (req.parentGoalId === undefined) {
                plan.goals.push(newGoal);
            } else {
                const parentGoal = Service.getGoalById(plan, req.parentGoalId);
                newGoal.range = Service.limitRangeToParentRange(newGoal.range, parentGoal.range);
                newGoal.deadline = Service.deadlineFromRange(rightNow, newGoal.range);
                parentGoal.subgoals.push(newGoal);
            }

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

    public async moveGoal(req: MoveGoalRequest): Promise<MoveGoalResponse> {

        const rightNow = moment.utc();

        const newPlanAndSchedule = await this.dbModifyPlanAndSchedule(planAndSchedule => {
            const plan = planAndSchedule.plan;
            const goal = Service.getGoalById(plan, req.goalId, true);

            if (goal.isSystemGoal) {
                throw new ServiceError(`Cannot move system goal with id ${goal.id}`);
            }

            if (req.parentGoalId === undefined && goal.parentGoalId === undefined) {
                // Nothing to do here - goal is already at toplevel.
            } else if (req.parentGoalId === undefined && goal.parentGoalId !== undefined) {

                const parentGoal = Service.getGoalById(plan, goal.parentGoalId, true);
                goal.parentGoalId = undefined;
                const index = parentGoal.subgoals.findIndex(g => g.id === goal.id);
                parentGoal.subgoals.splice(index, 1);
                plan.goals.push(goal);
            } else if (req.parentGoalId !== undefined && goal.parentGoalId === undefined) {

                const parentGoal = Service.getGoalById(plan, req.parentGoalId);
                goal.parentGoalId = req.parentGoalId;
                goal.range = Service.limitRangeToParentRange(goal.range, parentGoal.range);
                goal.deadline = Service.deadlineFromRange(rightNow, goal.range);
                const index = plan.goals.findIndex( g => g.id === goal.id);
                plan.goals.splice(index, 1);
                parentGoal.subgoals.push(goal);
            } else if (req.parentGoalId !== undefined && goal.parentGoalId !== undefined) {

                const oldParentGoal = Service.getGoalById(plan, goal.parentGoalId, true);
                const parentGoal = Service.getGoalById(plan, req.parentGoalId);
                goal.parentGoalId = req.parentGoalId;
                const index = oldParentGoal.subgoals.findIndex(g => g.id === goal.id);
                oldParentGoal.subgoals.splice(index, 1);
                goal.parentGoalId = req.parentGoalId;
                goal.range = Service.limitRangeToParentRange(goal.range, parentGoal.range);
                goal.deadline = Service.deadlineFromRange(rightNow, goal.range);
                parentGoal.subgoals.push(goal);
            }

            planAndSchedule.plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, planAndSchedule];
        });

        return {
            plan: newPlanAndSchedule.plan
        };
    }

    public async updateGoal(req: UpdateGoalRequest): Promise<UpdateGoalResponse> {

        const rightNow = moment.utc();

        const newPlanAndSchedule = await this.dbModifyPlanAndSchedule(planAndSchedule => {
            const goal = Service.getGoalById(planAndSchedule.plan, req.goalId, true);

            if (goal.isSystemGoal) {
                throw new ServiceError(`Cannot update system goal with id ${goal.id}`);
            }

            if (req.title !== undefined) {
                goal.title = req.title;
            }
            if (req.description !== undefined) {
                goal.description = req.description;
            }
            if (req.range !== undefined) {
                goal.range = req.range;
                goal.deadline = Service.deadlineFromRange(rightNow, req.range);
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
            const goal = Service.getGoalById(planAndSchedule.plan, req.goalId);

            if (goal.isSystemGoal) {
                throw new ServiceError(`Cannot mark system goal as done with id ${goal.id}`);
            }

            goal.isDone = true;
            planAndSchedule.plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, planAndSchedule];
        });

        return {
            plan: newPlanAndSchedule.plan
        };
    }

    public async archiveGoal(req: ArchiveGoalRequest): Promise<ArchiveGoalResponse> {

        const newPlanAndSchedule = await this.dbModifyPlanAndSchedule(planAndSchedule => {
            const goal = Service.getGoalById(planAndSchedule.plan, req.goalId, false, true);

            if (goal.isSystemGoal) {
                throw new ServiceError(`Cannot archive system goal with id ${goal.id}`);
            }

            goal.isArchived = true;
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
            const plan = planAndSchedule.plan;
            const schedule = planAndSchedule.schedule;
            const goal = Service.getGoalById(plan, req.goalId);

            goal.metrics.push(newMetric);
            plan.version.minor++;
            plan.idSerialHack++;
            newMetric.id = plan.idSerialHack;
            plan.metricsById.set(newMetric.id, newMetric);

            schedule.collectedMetrics.push(newCollectedMetric);
            schedule.version.minor++;
            schedule.idSerialHack++;
            newCollectedMetric.id = schedule.idSerialHack;
            newCollectedMetric.metricId = newMetric.id;
            schedule.collectedMetricsByMetricId.set(newMetric.id, newCollectedMetric);

            return [WhatToSave.PLAN_AND_SCHEDULE, planAndSchedule];
        });

        return {
            plan: newPlanAndSchedule.plan
        };
    }

    public async updateMetric(req: UpdateMetricRequest): Promise<UpdateMetricResponse> {

        const newPlanAndSchedule = await this.dbModifyPlanAndSchedule(planAndSchedule => {
            const plan = planAndSchedule.plan;

            const metric = plan.metricsById.get(req.metricId);

            if (metric === undefined) {
                throw new ServiceError(`Metric with id ${req.metricId} does not exist for user ${Service.DEFAULT_USER_ID}`);
            }

            Service.getGoalById(plan, metric.goalId, true);

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

        if (req.deadline !== undefined && req.deadline.isSameOrBefore(rightNow)) {
            throw new ServiceError(`Deadline of ${req.deadline.toISOString()} is before present ${rightNow.toISOString()}`);
        }

        const newTask: Task = {
            id: -1,
            goalId: req.goalId,
            title: req.title,
            description: req.description,
            priority: req.priority,
            deadline: req.deadline,
            repeatSchedule: req.repeatSchedule,
            reminderPolicy: undefined,
            subtasks: [],
            donePolicy: undefined,
            inProgress: false
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
            const plan = planAndSchedule.plan;
            const schedule = planAndSchedule.schedule;
            const goal = Service.getGoalById(plan, req.goalId);

            goal.tasks.push(newTask);
            plan.version.minor++;
            plan.idSerialHack++;
            newTask.id = plan.idSerialHack;

            schedule.scheduledTasks.push(newScheduledTask);
            schedule.version.minor++;
            schedule.idSerialHack++;
            newScheduledTask.id = schedule.idSerialHack;
            newScheduledTask.taskId = newTask.id;
            schedule.idSerialHack++;
            newScheduledTask.entries[0].id = schedule.idSerialHack;
            newScheduledTask.entries[0].scheduledTaskId = newScheduledTask.id;

            return [WhatToSave.PLAN_AND_SCHEDULE, planAndSchedule];
        });

        return {
            plan: newPlanAndSchedule.plan
        };
    }

    public async updateTask(req: UpdateTaskRequest): Promise<UpdateTaskResponse> {

        const rightNow = moment.utc();

        if (req.clearDeadline && req.deadline !== undefined) {
            throw new ServiceError(`Cannot specify both a new deadline and try to clear it as well`);
        }

        if (req.deadline !== undefined && req.deadline.isSameOrBefore(rightNow)) {
            throw new ServiceError(`Deadline of ${req.deadline.toISOString()} is before present ${rightNow.toISOString()}`);
        }

        if (req.clearRepeatSchedule && req.repeatSchedule !== undefined) {
            throw new ServiceError(`Cannot specify both a new repeat schedule and try to clear it as well`);
        }

        const newPlanAndSchedule = await this.dbModifyPlanAndSchedule(planAndSchedule => {
            const plan = planAndSchedule.plan;
            const schedule = planAndSchedule.schedule;
            const task = plan.tasksById.get(req.taskId);

            if (task === undefined) {
                throw new ServiceError(`Task with id ${req.taskId} does not exist for user ${Service.DEFAULT_USER_ID}`);
            }

            Service.getGoalById(plan, task.goalId, true);

            if (req.title !== undefined) {
                task.title = req.title;
            }
            if (req.description !== undefined) {
                task.description = req.description;
            }
            if (req.priority !== undefined) {
                task.priority = req.priority;
            }
            if (req.deadline !== undefined) {
                task.deadline = req.deadline;
            } else if (req.clearDeadline) {
                task.deadline = undefined;
            }
            if (req.repeatSchedule !== undefined) {
                task.repeatSchedule = req.repeatSchedule;

                // Tricky behaviour here! We look at the last scheduled task entry for this thing. If it's
                // not today, we add one.

                const scheduledTask = schedule.scheduledTasksByTaskId.get(task.id);

                if (scheduledTask === undefined) {
                    throw new CriticalServiceError(`Cannot find scheduled task for task with id ${task.id}`);
                }

                if (!scheduledTask.entries[scheduledTask.entries.length - 1].repeatScheduleAt.isSame(rightNow.startOf("day"))) {
                    const newScheduledTaskEntry: ScheduledTaskEntry = {
                        id: -1,
                        scheduledTaskId: scheduledTask.id,
                        isDone: false,
                        repeatScheduleAt: rightNow.startOf("day")
                    };

                    schedule.version.minor++;
                    schedule.idSerialHack++;
                    newScheduledTaskEntry.id = schedule.idSerialHack;
                    scheduledTask.entries.push(newScheduledTaskEntry);
                }
            } else if (req.clearRepeatSchedule) {
                task.repeatSchedule = undefined;
            }
            planAndSchedule.plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, planAndSchedule];
        });

        return {
            plan: newPlanAndSchedule.plan
        };
    }

    // Schedules

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

            Service.getGoalById(plan, metric.goalId);

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

    public async markTaskAsDone(req: MarkTaskAsDoneRequest): Promise<MarkTaskAsDoneResponse> {

        const newPlanAndSchedule = await this.dbModifyPlanAndSchedule(planAndSchedule => {

            const plan = planAndSchedule.plan;
            const schedule = planAndSchedule.schedule;

            const task = plan.tasksById.get(req.taskId);

            if (task === undefined) {
                throw new ServiceError(`Metric with id ${req.taskId} does not exist for user ${Service.DEFAULT_USER_ID}`);
            }

            Service.getGoalById(plan, task.goalId);

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
            const plan = planAndSchedule.plan;

            let modifiedSomething = false;

            for (const task of planAndSchedule.plan.tasksById.values()) {
                if (task.repeatSchedule === undefined) {
                    continue;
                }

                const scheduledTask = planAndSchedule.schedule.scheduledTasksByTaskId.get(task.id);

                if (scheduledTask === undefined) {
                    throw new CriticalServiceError(`Scheduled task for task with id ${task.id} does not exist`);
                }

                const lastEntry = scheduledTask.entries[scheduledTask.entries.length - 1]; // Guaranteed to always exist!
                const lastEntryRepeatScheduleAt = lastEntry.repeatScheduleAt.startOf("day"); // Should already be here!

                const goal = Service.getGoalById(plan, task.goalId, true, true);

                if (goal.isArchived || goal.isDone) {
                    continue;
                } else if (goal.deadline !== undefined && lastEntryRepeatScheduleAt.isSameOrAfter(goal.deadline)) {
                    continue;
                } else if (task.deadline !== undefined && lastEntryRepeatScheduleAt.isSameOrAfter(task.deadline)) {
                    continue;
                }

                for (let date = lastEntryRepeatScheduleAt; date < rightNowDay; date = date.add(1, "day")) {
                    if (!shouldAddRepeatedTaskToScheduleBasedOnDate(date, task.repeatSchedule)) {
                        continue;
                    } else if (goal.deadline !== undefined && date.isSameOrAfter(goal.deadline)) {
                        continue;
                    } else if (task.deadline !== undefined && date.isSameOrAfter(task.deadline)) {
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

    // DB access & helpers

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

        function populateIndices(plan: Plan, goal: Goal): void {
            plan.goalsById.set(goal.id, goal);

            for (const metric of goal.metrics) {
                plan.metricsById.set(metric.id, metric);
            }

            for (const task of goal.tasks) {
                plan.tasksById.set(task.id, task);
            }

            for (const subGoal of goal.subgoals) {
                populateIndices(plan, subGoal);
            }
        }

        const dbPlan = planRow["plan"];

        const plan: Plan = {
            id: planRow.id,
            version: dbPlan.version,
            goals: dbPlan.goals.map((g: any) => Service.dbGoalToGoal(g)),
            idSerialHack: dbPlan.idSerialHack,
            goalsById: new Map<number, Goal>(),
            metricsById: new Map<number, Metric>(),
            tasksById: new Map<number, Task>()
        };

        for (const goal of plan.goals) {
            populateIndices(plan, goal);
        }

        return plan;
    }

    private static dbGoalToGoal(goalRow: any): Goal {
        return {
            id: goalRow.id,
            parentGoalId: goalRow.parentGoalId,
            isSystemGoal: goalRow.isSystemGoal,
            title: goalRow.title,
            description: goalRow.description,
            range: goalRow.range,
            deadline: goalRow.deadline ? moment.unix(goalRow.deadline).utc() : undefined,
            subgoals: goalRow.subgoals.map((g: any) => Service.dbGoalToGoal(g)),
            metrics: goalRow.metrics.map((m: any) => Service.dbMetricToMetric(m)),
            tasks: goalRow.tasks.map((t: any) => Service.dbTaskToTask(t)),
            boards: goalRow.boards.map((b: any) => Service.dbBoardToBoard(b)),
            isDone: goalRow.isDone,
            isArchived: goalRow.isArchived
        };
    }

    private static dbMetricToMetric(metricRow: any): Metric {
        return {
            id: metricRow.id,
            goalId: metricRow.goalid,
            title: metricRow.title,
            type: metricRow.type
        };
    }

    private static dbTaskToTask(taskRow: any): Task {
        return {
            id: taskRow.id,
            goalId: taskRow.goalId,
            title: taskRow.title,
            description: taskRow.description,
            priority: taskRow.priority,
            deadline: taskRow.deadline ? moment.unix(taskRow.deadline).utc() : undefined,
            repeatSchedule: taskRow.repeatSchedule,
            reminderPolicy: taskRow.reminderPolicy,
            subtasks: taskRow.subtasks.map((st: any) => Service.dbSubTaskToSubTask(st)),
            donePolicy: taskRow.donePolicy,
            inProgress: taskRow.inProgress
        };
    }

    private static dbSubTaskToSubTask(subTaskRow: any): SubTask {
        return {
            id: subTaskRow.id,
            title: subTaskRow.title,
            subtasks: subTaskRow.subtasks.map((st: any) => Service.dbSubTaskToSubTask(st))
        };
    }

    private static dbBoardToBoard(boardRow: any): Board {
        return {
            id: boardRow.id,
            title: boardRow.title
        };
    }

    private static planToDbPlan(plan: Plan): any {
        return {
            version: plan.version,
            goals: plan.goals.map(g => Service.goalToDbGoal(g)),
            idSerialHack: plan.idSerialHack
        };
    }

    private static goalToDbGoal(goal: Goal): any {
        return {
            id: goal.id,
            parentGoalId: goal.parentGoalId,
            isSystemGoal: goal.isSystemGoal,
            title: goal.title,
            description: goal.description,
            range: goal.range,
            deadline: goal.deadline ? goal.deadline.unix() : undefined,
            subgoals: goal.subgoals.map(g => Service.goalToDbGoal(g)),
            metrics: goal.metrics.map(m => Service.metricToDbMetric(m)),
            tasks: goal.tasks.map(t => Service.taskToDbTask(t)),
            boards: goal.boards.map(b => Service.boardToDbBoard(b)),
            isDone: goal.isDone,
            isArchived: goal.isArchived
        };
    }

    private static metricToDbMetric(metric: Metric): any {
        return {
            id: metric.id,
            goalId: metric.goalId,
            title: metric.title,
            type: metric.type
        };
    }

    private static taskToDbTask(task: Task): any {
        return {
            id: task.id,
            goalId: task.goalId,
            title: task.title,
            description: task.description,
            priority: task.priority,
            deadline: task.deadline ? task.deadline.unix() : undefined,
            repeatSchedule: task.repeatSchedule,
            reminderPolicy: task.reminderPolicy,
            subtasks: task.subtasks.map(st => Service.subTaskToDbSubTask(st)),
            donePolicy: task.donePolicy,
            inProgress: task.inProgress
        };
    }

    private static subTaskToDbSubTask(subTask: SubTask): any {
        return {
            id: subTask.id,
            title: subTask.title,
            subtasks: subTask.subtasks.map(st => Service.subTaskToDbSubTask(st))
        };
    }

    private static boardToDbBoard(board: Board): any {
        return {
            id: board.id,
            title: board.title
        };
    }

    private static dbScheduleToSchedule(scheduleRow: any): Schedule {

        const dbSchedule = scheduleRow["schedule"];

        const schedule: Schedule = {
            id: scheduleRow.id,
            version: dbSchedule.version,
            collectedMetrics: dbSchedule.collectedMetrics.map((cm: any) => {
                return {
                    id: cm.id,
                    metricId: cm.metricId,
                    entries: cm.entries.map((smp: any) => {
                        return {
                            id: smp.id,
                            collectedMetricId: smp.collectedMetricId,
                            timestamp: moment.unix(smp.timestamp).utc(),
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
                            repeatScheduleAt: moment.unix(ste.repeatScheduleAt).utc()
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
                    isSystemGoal: true,
                    description: "Stuff you're working on outside of any big project",
                    range: GoalRange.LIFETIME,
                    subgoals: [],
                    metrics: [],
                    tasks: [],
                    boards: [],
                    isDone: false,
                    isArchived: false
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

    private static deadlineFromRange(rightNow: moment.Moment, range: GoalRange): moment.Moment | undefined {
        switch (range) {
            case GoalRange.LIFETIME:
                return undefined;
            case GoalRange.FIVE_YEARS:
                return rightNow.endOf("year").add(5, "year");
            case GoalRange.YEAR:
                return rightNow.endOf("year");
            case GoalRange.QUARTER:
                return rightNow.endOf("quarter");
            case GoalRange.MONTH:
                return rightNow.endOf("month");
        }
    }

    private static limitRangeToParentRange(range: GoalRange, parentRange: GoalRange): GoalRange {
        switch (parentRange) {
            case GoalRange.LIFETIME:
                return range;
            case GoalRange.FIVE_YEARS:
                switch (range) {
                    case GoalRange.LIFETIME:
                    case GoalRange.FIVE_YEARS:
                        return parentRange;
                    default:
                        return range;
                }
            case GoalRange.YEAR:
                switch (range) {
                    case GoalRange.LIFETIME:
                    case GoalRange.FIVE_YEARS:
                    case GoalRange.YEAR:
                        return parentRange;
                    default:
                        return range;
                }
            case GoalRange.QUARTER:
                switch (range) {
                    case GoalRange.LIFETIME:
                    case GoalRange.FIVE_YEARS:
                    case GoalRange.YEAR:
                    case GoalRange.QUARTER:
                        return parentRange;
                    default:
                        return range;
                }
            case GoalRange.MONTH:
                return parentRange;
        }
    }

    private static getGoalById(plan: Plan, id: number, allowDone: boolean = false, allowArchived: boolean = false): Goal {
        const goal = plan.goalsById.get(id);

        if (goal === undefined) {
            throw new CriticalServiceError(`Goal with id ${id} does not exist for user ${Service.DEFAULT_USER_ID}`);
        } else if (goal.isArchived && !allowArchived) {
            throw new ServiceError(`Goal with id ${id} cannot be operated upon since it is archived`);
        } else if (goal.isDone && !allowDone) {
            throw new ServiceError(`Goal with id ${id} cannot be operated upon since it is done`);
        }

        return goal;
    }
}

export interface GetLatestPlanResponse {
    plan: Plan;
}

export interface CreateGoalRequest {
    title: string;
    description?: string;
    range: GoalRange;
    parentGoalId?: number;
}

export interface CreateGoalResponse {
    plan: Plan;
}

export interface MoveGoalRequest {
    goalId: number;
    parentGoalId?: number;
}

export interface MoveGoalResponse {
    plan: Plan;
}

export interface UpdateGoalRequest {
    goalId: number;
    title?: string;
    description?: string;
    range?: GoalRange;
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

export interface ArchiveGoalRequest {
    goalId: number;
}

export interface ArchiveGoalResponse {
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
    description?: string;
    priority: TaskPriority;
    deadline?: moment.Moment,
    repeatSchedule?: TaskRepeatSchedule;
}

export interface CreateTaskResponse {
    plan: Plan;
}

export interface UpdateTaskRequest {
    taskId: number;
    title?: string;
    description?: string;
    priority?: TaskPriority;
    deadline?: moment.Moment;
    clearDeadline?: boolean;
    repeatSchedule?: TaskRepeatSchedule;
    clearRepeatSchedule?: boolean;
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