import * as knex from "knex";
import {Transaction} from "knex";
import * as moment from "moment";
import * as EmailValidator from 'email-validator';
import * as bcrypt from "bcrypt";
import * as jwt from "jsonwebtoken";

import {
    Board,
    BooleanPolicy,
    BooleanStatus,
    CollectedMetric,
    CollectedMetricEntry,
    CounterPolicy,
    CounterPolicyType,
    CounterStatus,
    GaugePolicy,
    GaugePolicyType,
    GaugeStatus,
    Goal,
    GoalId,
    GoalRange,
    Metric,
    MetricId,
    MetricType,
    Plan,
    PlanId,
    Schedule,
    ScheduledTask,
    ScheduledTaskDoneStatus,
    ScheduledTaskEntry,
    ScheduledTaskEntryId,
    ScheduledTaskId,
    SubTask,
    SubTaskId,
    SubtasksPolicy,
    SubtasksStatus,
    Task,
    TaskDonePolicy,
    TaskDoneType,
    TaskId,
    TaskPriority,
    TaskReminderPolicy,
    TaskRepeatSchedule,
    TaskUrgency,
    User,
    UserId,
    Vacation,
    VacationId
} from "../shared/entities";
import {RpcContext, rpcHandler} from "../shared/dsrpc";

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

export class Handler {

    private static readonly REPEATING_TASKS_INTERVAL = moment.duration(1, "minute");

    private static readonly USER_TABLE = "core.users";
    private static readonly USER_FIELDS = [
        "id",
        "user_json",
        "email",
        "password_hash"
    ];

    private static readonly PLAN_TABLE = "core.plans";
    private static readonly PLAN_FIELDS = [
        "id",
        "version_major",
        "version_minor",
        "plan_json"
    ];

    private static readonly SCHEDULE_TABLE = "core.schedules";
    private static readonly SCHEDULE_FIELDS = [
        "id",
        "version_major",
        "version_minor",
        "schedule_json"
    ];

    private static readonly BCRYPT_ROUNDS = 10;
    private static readonly AUTH_TOKEN_LIFE_HOURS = 4;
    public static readonly AUTH_TOKEN_ENCRYPTION_KEY = "Big Secret";

    public constructor(
        private readonly conn: knex) {
    }

    public async init(): Promise<void> {
        setInterval(this.updateScheduleWithRepeatingTasks.bind(this), Handler.REPEATING_TASKS_INTERVAL.asMilliseconds());
    }

    // User

    @rpcHandler
    public async getOrCreateUser(_ctx: RpcContext, req: GetOrCreateUserRequest): Promise<GetOrCreateUserResponse> {

        const rightNow = moment.utc();

        if (!EmailValidator.validate(req.email)) {
            throw new ServiceError(`Supplied email ${req.email} is invalid`);
        } else if (req.password.trim().length === 0) {
            throw new ServiceError(`Supplied password is invalid`);
        }

        const user = await this.dbGetOrCreateUser(req.email, req.password);

        const jwtPayload = {
            id: user.id,
            iat: rightNow.unix(),
            exp: rightNow.add(Handler.AUTH_TOKEN_LIFE_HOURS, "hours").unix()
        };

        return new Promise<GetOrCreateUserResponse>((resolve, reject) => {

            jwt.sign(jwtPayload, Handler.AUTH_TOKEN_ENCRYPTION_KEY, (err, jwtEncoded) => {
                if (err) {
                    return reject(new ServiceError(`Crypto error ${err.message}`));
                }

                resolve({
                    auth: {
                        token: jwtEncoded
                    },
                    user: user
                });
            });
        });
    }

    @needsAuth
    public async getUser(ctx: Context, _req: GetUserRequest): Promise<GetUserResponse> {

        const user = await this.dbGetUserById(this.conn, ctx.userId);

        return {
            user: user
        };
    }

    @needsAuth
    public async archiveUser(ctx: Context, _req: ArchiveUserRequest): Promise<ArchiveUserResponse> {

        await this.dbModifyFullUser(ctx, fullUser => {
            const user = fullUser.user;

            user.isArchived = true;

            return [WhatToSave.USER, fullUser];
        });

        return {};
    }

    @needsAuth
    public async createVacation(ctx: Context, req: CreateVacationRequest): Promise<CreateVacationResponse> {

        const rightNow = moment.utc();

        if (req.startTime.isBefore(rightNow)) {
            throw new ServiceError("Vacation start date is in the past");
        } else if (req.endTime.isBefore(req.startTime)) {
            throw new ServiceError("Vacation end date is before start date");
        }

        const newVacation: Vacation = {
            id: -1,
            startTime: req.startTime,
            endTime: req.endTime,
            isArchived: false
        };

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {

            const user = fullUser.user;

            user.idSerialHack++;
            newVacation.id = user.idSerialHack;

            user.vacations.push(newVacation);

            return [WhatToSave.USER, fullUser];
        });

        return {
            user: newFullUser.user
        };
    }

    @needsAuth
    public async updateVacation(ctx: Context, req: UpdateVacationRequest): Promise<UpdateVacationResponse> {

        const rightNow = moment.utc();

        if (req.startTime !== undefined && req.startTime.isBefore(rightNow)) {
            throw new ServiceError("Vacation start date is in the past");
        } else if (req.endTime !== undefined && req.endTime.isBefore(rightNow)) {
            throw new ServiceError("Vacation end date is in the past");
        } else if (req.startTime !== undefined && req.endTime !== undefined && req.startTime.isAfter(req.endTime)) {
            throw new ServiceError("Vacation end date is before start date");
        }

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {

            const user = fullUser.user;
            const vacation = Handler.getVacationById(user, req.vacationId);

            if (req.startTime !== undefined && req.endTime !== undefined) {
                vacation.startTime = req.startTime;
                vacation.endTime = req.endTime;
            } else if (req.startTime !== undefined) {
                if (req.startTime.isAfter(vacation.endTime)) {
                    throw new ServiceError("Cannot set start date after end date");
                }
                vacation.startTime = req.startTime;
            } else if (req.endTime !== undefined) {
                if (req.endTime.isBefore(vacation.startTime)) {
                    throw new ServiceError("Cannot set end date after start date");
                }
                vacation.endTime = req.endTime;
            }

            return [WhatToSave.USER, fullUser];
        });

        return {
            user: newFullUser.user
        };
    }

    @needsAuth
    public async archiveVacation(ctx: Context, req: ArchiveVacationRequest): Promise<ArchiveVacationResponse> {

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {

            const user = fullUser.user;
            const vacation = Handler.getVacationById(user, req.vacationId);

            vacation.isArchived = true;

            return [WhatToSave.USER, fullUser];
        });

        return {
            user: newFullUser.user
        };
    }

    // Plans

    @needsAuth
    public async getLatestPlan(ctx: Context, _req: GetLatestPlanRequest): Promise<GetLatestPlanResponse> {

        const plan = await this.dbGetLatestPlan(this.conn, ctx.userId);

        return {
            plan: plan
        };
    }

    @needsAuth
    public async updatePlan(ctx: Context, req: UpdatePlanRequest): Promise<UpdatePlanResponse> {

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {
            const plan = fullUser.plan;

            if (req.isSuspended !== undefined) {
                if (req.isSuspended && plan.isSuspended) {
                    throw new ServiceError("Plan is already suspended");
                } else if (!req.isSuspended && !plan.isSuspended) {
                    throw new ServiceError("Plan is already unsuspended");
                }
                plan.isSuspended = req.isSuspended;
            }

            plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan
        };
    }

    @needsAuth
    public async createGoal(ctx: Context, req: CreateGoalRequest): Promise<CreateGoalResponse> {

        const rightNow = moment.utc();

        const newGoal: Goal = {
            id: -1,
            parentGoalId: req.parentGoalId,
            isSystemGoal: false,
            title: req.title,
            description: req.description,
            range: req.range,
            deadline: Handler.deadlineFromRange(rightNow, req.range),
            subgoals: [],
            subgoalsById: new Map<GoalId, Goal>(),
            subgoalsOrder: [],
            metrics: [],
            metricsById: new Map<MetricId, Metric>(),
            metricsOrder: [],
            tasks: [],
            tasksById: new Map<TaskId, Task>(),
            tasksOrder: [],
            boards: [],
            isSuspended: false,
            isDone: false,
            isArchived: false
        };

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {
            const plan = fullUser.plan;

            plan.idSerialHack++;
            newGoal.id = plan.idSerialHack;

            if (req.parentGoalId === undefined) {
                plan.goals.push(newGoal);
                plan.goalsOrder.push(newGoal.id);
            } else {
                const parentGoal = Handler.getGoalById(plan, req.parentGoalId);
                newGoal.range = Handler.limitRangeToParentRange(newGoal.range, parentGoal.range);
                newGoal.deadline = Handler.deadlineFromRange(rightNow, newGoal.range);
                parentGoal.subgoals.push(newGoal);
                parentGoal.subgoalsById.set(newGoal.id, newGoal);
                parentGoal.subgoalsOrder.push(newGoal.id);
            }

            plan.version.minor++;
            plan.goalsById.set(newGoal.id, newGoal);

            return [WhatToSave.PLAN_AND_SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan
        };
    }

    @needsAuth
    public async moveGoal(ctx: Context, req: MoveGoalRequest): Promise<MoveGoalResponse> {

        const rightNow = moment.utc();

        if (!req.moveToToplevel && req.parentGoalId === undefined && req.position === undefined) {
            throw new ServiceError("You must specifiy at least one of toplevel, parentGoalId or position");
        } else if (req.moveToToplevel && req.parentGoalId !== undefined) {
            throw new ServiceError(`Cannot both move to toplevel and a child under ${req.parentGoalId}`);
        }

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {
            const plan = fullUser.plan;
            const goal = Handler.getGoalById(plan, req.goalId, true);

            if (goal.isSystemGoal) {
                throw new ServiceError(`Cannot move system goal with id ${goal.id}`);
            }

            // The following method is quite hairy. It covers moving a goal between the toplevel
            // and another goal as a child, as well as moving the goal in the order of subgoals
            // of its parent. Which is arguably trying too much, but it makes for an easier interface
            // for clients. So we have to be tactical about this. There's three parameters in the request
            // which influence what happens, in the sense that if they're set we must do something special.
            // Ditto, if the goal is at the toplevel or under another goal adds an extra dimension. So
            // there are in total 16 combinations of things we must consider. Which hints that we should
            // have an if/else block with 16 cases. However, the following simplifications help:
            // * in most circumstances if a req.position is specified or not, can be treated inside the block.
            // * all parameters "unset" are not alowed.
            // * both req.moveToToplevel and req.parentGoalId !== undefined cannot be set.
            // After these, we can have just 7 cases. One of which is empty because there's nothing to do,
            // and another two which just move the goal in the order of its parent.

            if (req.moveToToplevel && req.parentGoalId === undefined && goal.parentGoalId !== undefined) {
                // Move a child goal to the toplevel.

                const parentGoal = Handler.getGoalById(plan, goal.parentGoalId, true);
                goal.parentGoalId = undefined;
                const subgoalsIndex = parentGoal.subgoals.findIndex(g => g.id === goal.id);
                const subgoalsOrderIndex = parentGoal.subgoalsOrder.indexOf(goal.id);
                parentGoal.subgoals.splice(subgoalsIndex, 1);
                parentGoal.subgoalsById.delete(goal.id);
                parentGoal.subgoalsOrder.splice(subgoalsOrderIndex, 1);

                plan.goals.push(goal);
                if (req.position === undefined) {
                    plan.goalsOrder.push(goal.id);
                } else {
                    if (req.position < 1 || req.position > plan.goalsOrder.length) {
                        throw new ServiceError(`Cannot move goal with id ${goal.id} to position ${req.position}`);
                    }

                    plan.goalsOrder.splice(req.position - 1, 0, goal.id);
                }
            } else if (req.moveToToplevel && req.parentGoalId === undefined && goal.parentGoalId === undefined && req.position !== undefined) {
                // Move a toplevel goal to the toplevel at a certain position

                if (req.position < 1 || req.position > plan.goalsOrder.length) {
                    throw new ServiceError(`Cannot move goal with id ${goal.id} to position ${req.position}`);
                }

                const goalsIndex = plan.goalsOrder.indexOf(goal.id);
                plan.goalsOrder.splice(goalsIndex, 1);
                plan.goalsOrder.splice(req.position - 1, 0, goal.id);
            } else if (req.moveToToplevel && req.parentGoalId === undefined && goal.parentGoalId === undefined && req.position === undefined) {
                // Move a toplevel goal to the toplevel.

                // Nothing to do!
            } else if (!req.moveToToplevel && req.parentGoalId !== undefined && goal.parentGoalId !== undefined) {
                // Move a child goal as a child of another goal

                const oldParentGoal = Handler.getGoalById(plan, goal.parentGoalId, true);
                const parentGoal = Handler.getGoalById(plan, req.parentGoalId);

                // Check that the new parent goal isn't a descendant of the current goal.
                // This is bad behaviour which we can't allow.
                let parentsWalkerGoal = parentGoal;
                while (parentsWalkerGoal.parentGoalId !== undefined) {
                    if (parentsWalkerGoal.parentGoalId === goal.id) {
                        throw new ServiceError(`Cannot move goal with id ${goal.id} to one of its descendants`);
                    }
                    parentsWalkerGoal = Handler.getGoalById(plan, parentsWalkerGoal.parentGoalId);
                }

                goal.parentGoalId = req.parentGoalId;
                const subgoalsIndex = oldParentGoal.subgoals.findIndex(g => g.id === goal.id);
                const subgoalsOrderIndex = oldParentGoal.subgoalsOrder.indexOf(goal.id);
                oldParentGoal.subgoals.splice(subgoalsIndex, 1);
                oldParentGoal.subgoalsById.delete(goal.id);
                oldParentGoal.subgoalsOrder.splice(subgoalsOrderIndex, 1);
                goal.parentGoalId = req.parentGoalId;
                goal.range = Handler.limitRangeToParentRange(goal.range, parentGoal.range);
                goal.deadline = Handler.deadlineFromRange(rightNow, goal.range);

                parentGoal.subgoals.push(goal);
                parentGoal.subgoalsById.set(goal.id, goal);
                if (req.position === undefined) {
                    parentGoal.subgoalsOrder.push(goal.id);
                } else {
                    if (req.position < 1 || req.position > parentGoal.subgoalsOrder.length) {
                        throw new ServiceError(`Cannot move goal with id ${goal.id} to position ${req.position}`);
                    }

                    plan.goalsOrder.splice(req.position - 1, 0, goal.id);
                }
            } else if (!req.moveToToplevel && req.parentGoalId !== undefined && goal.parentGoalId === undefined) {
                // Move a toplevel goal as a child of another goal

                const parentGoal = Handler.getGoalById(plan, req.parentGoalId);

                // Check that the new parent goal isn't a descendant of the current goal.
                // This is bad behaviour which we can't allow.
                let parentsWalkerGoal = parentGoal;
                while (parentsWalkerGoal.parentGoalId !== undefined) {
                    if (parentsWalkerGoal.parentGoalId === goal.id) {
                        throw new ServiceError(`Cannot move goal with id ${goal.id} to one of its descendants`);
                    }
                    parentsWalkerGoal = Handler.getGoalById(plan, parentsWalkerGoal.parentGoalId);
                }

                goal.parentGoalId = req.parentGoalId;
                goal.range = Handler.limitRangeToParentRange(goal.range, parentGoal.range);
                goal.deadline = Handler.deadlineFromRange(rightNow, goal.range);
                const goalsIndex = plan.goals.findIndex( g => g.id === goal.id);
                const goalsOrderIndex = plan.goalsOrder.indexOf(goal.id);
                plan.goals.splice(goalsIndex, 1);
                plan.goalsOrder.splice(goalsOrderIndex, 1);

                parentGoal.subgoals.push(goal);
                parentGoal.subgoalsById.set(goal.id, goal);
                if (req.position === undefined) {
                    parentGoal.subgoalsOrder.push(goal.id);
                } else {
                    if (req.position < 1 || req.position > parentGoal.subgoalsOrder.length) {
                        throw new ServiceError(`Cannot move goal with id ${goal.id} to position ${req.position}`);
                    }

                    parentGoal.subgoalsOrder.splice(req.position - 1, 0, goal.id);
                }
            } else if (!req.moveToToplevel && req.parentGoalId === undefined && goal.parentGoalId !== undefined && req.position !== undefined) {
                // Move a child goal to a certain position in its parent.

                const parentGoal = Handler.getGoalById(plan, goal.parentGoalId);

                if (req.position < 1 || req.position > parentGoal.subgoalsOrder.length) {
                    throw new ServiceError(`Cannot move goal with id ${goal.id} to position ${req.position}`);
                }

                const subgoalsOrderIndex = parentGoal.subgoalsOrder.indexOf(goal.id);
                parentGoal.subgoalsOrder.splice(subgoalsOrderIndex, 1);
                parentGoal.subgoalsOrder.splice(req.position - 1, 0, goal.id);
            } else if (!req.moveToToplevel && req.parentGoalId === undefined && goal.parentGoalId === undefined && req.position !== undefined) {
                // Move a toplevel goal to a certain position.

                if (req.position < 1 || req.position > plan.goalsOrder.length) {
                    throw new ServiceError(`Cannot move goal with id ${goal.id} to position ${req.position}`);
                }

                const goalsIndex = plan.goalsOrder.indexOf(goal.id);
                plan.goalsOrder.splice(goalsIndex, 1);
                plan.goalsOrder.splice(req.position - 1, 0, goal.id);
            } else {
                throw new CriticalServiceError("Invalid service path!");
            }

            fullUser.plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan
        };
    }

    @needsAuth
    public async updateGoal(ctx: Context, req: UpdateGoalRequest): Promise<UpdateGoalResponse> {

        const rightNow = moment.utc();

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {
            const goal = Handler.getGoalById(fullUser.plan, req.goalId, true);

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
                goal.deadline = Handler.deadlineFromRange(rightNow, req.range);
            }
            if (req.isSuspended !== undefined) {
                if (req.isSuspended && goal.isSuspended) {
                    throw new ServiceError(`Goal with id ${goal.id} is already suspended`);
                } else if (!req.isSuspended && !goal.isSuspended) {
                    throw new ServiceError(`Goal with id ${goal.id} is already unsuspended`);
                }
                goal.isSuspended = req.isSuspended;
            }
            fullUser.plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan
        };
    }

    @needsAuth
    public async markGoalAsDone(ctx: Context, req: MarkGoalAsDoneRequest): Promise<MarkGoalAsDoneResponse> {

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {
            const plan = fullUser.plan;
            const goal = Handler.getGoalById(plan, req.goalId);
            const parentGoal = goal.parentGoalId ? Handler.getGoalById(plan, goal.parentGoalId) : null;

            if (goal.isSystemGoal) {
                throw new ServiceError(`Cannot mark system goal as done with id ${goal.id}`);
            }

            if (parentGoal === null) {
                const goalPosition = plan.goalsOrder.indexOf(goal.id);
                plan.goalsOrder.splice(goalPosition, 1);
            } else {
                const goalPosition = parentGoal.subgoalsOrder.indexOf(goal.id);
                parentGoal.subgoalsOrder.splice(goalPosition, 1);
            }

            goal.isDone = true;
            plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan
        };
    }

    @needsAuth
    public async archiveGoal(ctx: Context, req: ArchiveGoalRequest): Promise<ArchiveGoalResponse> {

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {
            const plan = fullUser.plan;
            const goal = Handler.getGoalById(plan, req.goalId, false, true);
            const parentGoal = goal.parentGoalId ? Handler.getGoalById(plan, goal.parentGoalId) : null;

            if (goal.isSystemGoal) {
                throw new ServiceError(`Cannot archive system goal with id ${goal.id}`);
            }

            if (parentGoal === null) {
                const goalPosition = plan.goalsOrder.indexOf(goal.id);
                plan.goalsOrder.splice(goalPosition, 1);
            } else {
                const goalPosition = parentGoal.subgoalsOrder.indexOf(goal.id);
                parentGoal.subgoalsOrder.splice(goalPosition, 1);
            }

            goal.isArchived = true;

            plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan
        };
    }

    @needsAuth
    public async createMetric(ctx: Context, req: CreateMetricRequest): Promise<CreateMetricResponse> {

        const newMetric: Metric = {
            id: -1,
            goalId: -1,
            title: req.title,
            description: req.description,
            type: req.isCounter ? MetricType.COUNTER : MetricType.GAUGE,
            isArchived: false
        };

        const newCollectedMetric: CollectedMetric = {
            id: -1,
            metricId: -1,
            entries: []
        };

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {
            const plan = fullUser.plan;
            const schedule = fullUser.schedule;
            const goal = req.goalId ? Handler.getGoalById(plan, req.goalId) : Handler.getGoalById(plan, plan.inboxGoalId);

            plan.idSerialHack++;
            newMetric.id = plan.idSerialHack;
            newMetric.goalId = goal.id;

            schedule.idSerialHack++;
            newCollectedMetric.id = schedule.idSerialHack;
            newCollectedMetric.metricId = newMetric.id;

            goal.metrics.push(newMetric);
            goal.metricsById.set(newMetric.id, newMetric);
            goal.metricsOrder.push(newMetric.id);

            plan.metricsById.set(newMetric.id, newMetric);

            schedule.collectedMetrics.push(newCollectedMetric);
            schedule.collectedMetricsByMetricId.set(newMetric.id, newCollectedMetric);

            plan.version.minor++;
            schedule.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan
        };
    }

    @needsAuth
    public async moveMetric(ctx: Context, req: MoveMetricRequest): Promise<MoveMetricResponse> {

        if (req.goalId === undefined && req.position === undefined) {
            throw new ServiceError("You must specify at least one of goalId or position");
        }

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {
            const plan = fullUser.plan;
            const metric = Handler.getMetricById(plan, req.metricId);

            if (req.goalId !== undefined) {
                const oldGoal = Handler.getGoalById(plan, metric.goalId);
                const newGoal = Handler.getGoalById(plan, req.goalId);

                metric.goalId = req.goalId;
                const oldGoalIndex = oldGoal.metrics.findIndex(m => m.id === metric.id);
                const oldGoalOrderIndex = oldGoal.metricsOrder.indexOf(metric.id);
                oldGoal.metrics.splice(oldGoalIndex, 1);
                oldGoal.metricsById.delete(metric.id);
                oldGoal.metricsOrder.splice(oldGoalOrderIndex, 1);

                newGoal.metrics.push(metric);
                newGoal.metricsById.set(metric.id, metric);
                if (req.position !== undefined) {
                    if (req.position < 1 || req.position > newGoal.metricsOrder.length) {
                        throw new ServiceError(`Cannot move metric with id ${metric.id} to position ${req.position}`);
                    }

                    newGoal.metricsOrder.splice(req.position - 1, 0, metric.id);
                } else {
                    newGoal.metricsOrder.push(metric.id);
                }
            } else if (req.position !== undefined) {
                const goal = Handler.getGoalById(plan, metric.goalId);

                if (req.position < 1 || req.position > goal.metricsOrder.length) {
                    throw new ServiceError(`Cannot move metric with id ${metric.id} to position ${req.position}`);
                }

                const goalOrderIndex = goal.metricsOrder.indexOf(metric.id);
                goal.metricsOrder.splice(goalOrderIndex, 1);
                goal.metricsOrder.splice(req.position - 1, 0, metric.id);
            } else {
                throw new CriticalServiceError("Invalid service path!");
            }

            fullUser.plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan
        };
    }

    @needsAuth
    public async updateMetric(ctx: Context, req: UpdateMetricRequest): Promise<UpdateMetricResponse> {

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {
            const plan = fullUser.plan;
            const metric = Handler.getMetricById(plan, req.metricId);

            Handler.getGoalById(plan, metric.goalId, true);

            if (req.title !== undefined) {
                metric.title = req.title;
            }
            if (req.description !== undefined) {
                metric.description = req.description;
            }
            fullUser.plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan
        };
    }

    @needsAuth
    public async archiveMetric(ctx: Context, req: ArchiveMetricRequest): Promise<ArchiveMetricResponse> {

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {
            const plan = fullUser.plan;
            const metric = Handler.getMetricById(plan, req.metricId);

            Handler.getGoalById(plan, metric.goalId, true);

            metric.isArchived = true;
            fullUser.plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan
        };
    }

    @needsAuth
    public async createTask(ctx: Context, req: CreateTaskRequest): Promise<CreateTaskResponse> {

        const rightNow = moment.utc();

        if (req.deadline !== undefined && req.deadline.isSameOrBefore(rightNow)) {
            throw new ServiceError(`Deadline of ${req.deadline.toISOString()} is before present ${rightNow.toISOString()}`);
        }

        if (req.donePolicy.type === TaskDoneType.COUNTER) {
            const counterPolicy = req.donePolicy.counter as CounterPolicy;
            if (counterPolicy.lowerLimit < 0) {
                throw new ServiceError(`Lower limit of ${counterPolicy.lowerLimit} cannot be negative`);
            }
            if (counterPolicy.type === CounterPolicyType.BETWEEN && (counterPolicy.upperLimit as number) < counterPolicy.lowerLimit) {
                throw new ServiceError(`Upper limit of ${counterPolicy.upperLimit} is below lower limit of ${counterPolicy.lowerLimit}`);
            }
        } else if (req.donePolicy.type === TaskDoneType.GAUGE) {
            const gaugePolicy = req.donePolicy.gauge as GaugePolicy;
            if (gaugePolicy.lowerLimit < 0) {
                throw new ServiceError(`Lower limit of ${gaugePolicy.lowerLimit} cannot be negative`);
            }
            if (gaugePolicy.type === GaugePolicyType.BETWEEN && (gaugePolicy.upperLimit as number) < gaugePolicy.lowerLimit) {
                throw new ServiceError(`Upper limit of ${gaugePolicy.upperLimit} is below lower limit of ${gaugePolicy.lowerLimit}`)
            }
        }

        const newTask: Task = {
            id: -1,
            goalId: -1,
            title: req.title,
            description: req.description,
            priority: req.priority,
            urgency: req.urgency,
            deadline: req.deadline,
            repeatSchedule: req.repeatSchedule,
            reminderPolicy: req.reminderPolicy,
            donePolicy: {
                type: req.donePolicy.type,
                boolean: req.donePolicy.type !== TaskDoneType.BOOLEAN ? undefined : {},
                subtasks: req.donePolicy.type !== TaskDoneType.SUBTASKS ? undefined : {
                    subTasks: [],
                    subTasksOrder: [],
                    subTasksById: new Map<SubTaskId, SubTask>()
                },
                counter: req.donePolicy.type !== TaskDoneType.COUNTER ? undefined : {
                    type: (req.donePolicy.counter as CounterPolicy).type,
                    lowerLimit: (req.donePolicy.counter as CounterPolicy).lowerLimit,
                    upperLimit: (req.donePolicy.counter as CounterPolicy).upperLimit
                },
                gauge: req.donePolicy.type !== TaskDoneType.GAUGE ? undefined : {
                    type: (req.donePolicy.gauge as GaugePolicy).type,
                    lowerLimit: (req.donePolicy.gauge as GaugePolicy).lowerLimit,
                    upperLimit: (req.donePolicy.gauge as GaugePolicy).upperLimit
                }
            },
            isSuspended: false,
            isArchived: false
        };

        const newScheduledTask: ScheduledTask = {
            id: -1,
            taskId: -1,
            entries: [{
                id: -1,
                scheduledTaskId: -1,
                inProgress: false,
                isDone: false,
                doneStatus: Handler.generateDoneStatusFromPolicy(newTask),
                repeatScheduleAt: rightNow.startOf("day")
            }]
        };

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {
            const plan = fullUser.plan;
            const schedule = fullUser.schedule;
            const goal = req.goalId ? Handler.getGoalById(plan, req.goalId) : Handler.getGoalById(plan, plan.inboxGoalId);

            plan.idSerialHack++;
            newTask.id = plan.idSerialHack;
            newTask.goalId = goal.id;

            schedule.idSerialHack++;
            newScheduledTask.id = schedule.idSerialHack;
            newScheduledTask.taskId = newTask.id;
            schedule.idSerialHack++;
            newScheduledTask.entries[0].id = schedule.idSerialHack;
            newScheduledTask.entries[0].scheduledTaskId = newScheduledTask.id;

            goal.tasks.push(newTask);
            goal.tasksById.set(newTask.id, newTask);
            goal.tasksOrder.push(newTask.id);

            plan.tasksById.set(newTask.id, newTask);

            schedule.scheduledTasks.push(newScheduledTask);
            schedule.scheduledTasksById.set(newScheduledTask.id, newScheduledTask);
            schedule.scheduledTasksByTaskId.set(newTask.id, newScheduledTask);
            schedule.scheduledTaskEntriesById.set(newScheduledTask.entries[0].id, newScheduledTask.entries[0]);

            plan.version.minor++;
            schedule.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan
        };
    }

    @needsAuth
    public async moveTask(ctx: Context, req: MoveTaskRequest): Promise<MoveTaskResponse> {

        if (req.goalId === undefined && req.position === undefined) {
            throw new ServiceError("You must specify at least one of goalId or position");
        }

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {
            const plan = fullUser.plan;
            const task = Handler.getTaskById(plan, req.taskId);

            if (req.goalId !== undefined) {
                const oldGoal = Handler.getGoalById(plan, task.goalId);
                const newGoal = Handler.getGoalById(plan, req.goalId);

                task.goalId = req.goalId;
                const oldGoalIndex = oldGoal.tasks.findIndex(t => t.id === task.id);
                const oldGoalOrderIndex = oldGoal.tasksOrder.indexOf(task.id);
                oldGoal.tasks.splice(oldGoalIndex, 1);
                oldGoal.tasksById.delete(task.id);
                oldGoal.tasksOrder.splice(oldGoalOrderIndex, 1);

                newGoal.tasks.push(task);
                newGoal.tasksById.set(task.id, task);
                if (req.position !== undefined) {
                    if (req.position < 1 || req.position > newGoal.tasksOrder.length) {
                        throw new ServiceError(`Cannot move task with id ${task.id} to position ${req.position}`);
                    }

                    newGoal.tasksOrder.splice(req.position - 1, 0, task.id);
                } else {
                    newGoal.tasksOrder.push(task.id);
                }
            } else if (req.position !== undefined) {
                const goal = Handler.getGoalById(plan, task.goalId);

                if (req.position < 1 || req.position > goal.tasksOrder.length) {
                    throw new ServiceError(`Cannot move task with id ${task.id} to position ${req.position}`);
                }

                const goalOrderIndex = goal.tasksOrder.indexOf(task.id);
                goal.tasksOrder.splice(goalOrderIndex, 1);
                goal.tasksOrder.splice(req.position - 1, 0, task.id);
            } else {
                throw new CriticalServiceError("Invalid service path!");
            }

            fullUser.plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan
        };
    }

    @needsAuth
    public async updateTask(ctx: Context, req: UpdateTaskRequest): Promise<UpdateTaskResponse> {

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

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {
            const plan = fullUser.plan;
            const schedule = fullUser.schedule;
            const task = Handler.getTaskById(plan, req.taskId);

            Handler.getGoalById(plan, task.goalId, true);

            if (req.title !== undefined) {
                task.title = req.title;
            }
            if (req.description !== undefined) {
                task.description = req.description;
            }
            if (req.priority !== undefined) {
                task.priority = req.priority;
            }
            if (req.urgency !== undefined) {
                task.urgency = req.urgency;
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

                const scheduledTask = Handler.getScheduledTaskByTaskId(schedule, task.id);

                if (!scheduledTask.entries[scheduledTask.entries.length - 1].repeatScheduleAt.isSame(rightNow.startOf("day"))) {
                    const newScheduledTaskEntry: ScheduledTaskEntry = {
                        id: -1,
                        scheduledTaskId: scheduledTask.id,
                        inProgress: false,
                        isDone: false,
                        doneStatus: Handler.generateDoneStatusFromPolicy(task),
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
            if (req.reminderPolicy !== undefined) {
                task.reminderPolicy = req.reminderPolicy;
            }
            if (req.isSuspended !== undefined) {
                if (req.isSuspended && task.isSuspended) {
                    throw new ServiceError(`Task with id ${task.id} is already suspended`);
                } else if (!req.isSuspended && !task.isSuspended) {
                    throw new ServiceError(`Task with id ${task.id} is already unsuspended`);
                }
                task.isSuspended = req.isSuspended;
            }
            if (req.counterPolicy !== undefined) {
                if (task.donePolicy.type !== TaskDoneType.COUNTER) {
                    throw new ServiceError(`Task with id ${task.id} is not counter`);
                }
                task.donePolicy.counter = req.counterPolicy;
            }
            if (req.gaugePolicy !== undefined) {
                if (task.donePolicy.type !== TaskDoneType.GAUGE) {
                    throw new ServiceError(`Task with id ${task.id} is not gauge`);
                }
                task.donePolicy.gauge = req.gaugePolicy;
            }

            const scheduledTaskEntry = Handler.getCurrentActiveScheduledTaskEntry(schedule, task);
            scheduledTaskEntry.isDone = Handler.computeIsDone(task, scheduledTaskEntry);

            fullUser.plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan
        };
    }

    @needsAuth
    public async archiveTask(ctx: Context, req: ArchiveTaskRequest): Promise<ArchiveTaskResponse> {

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {
            const plan = fullUser.plan;
            const task = Handler.getTaskById(plan, req.taskId);
            const goal = Handler.getGoalById(plan, task.goalId, true);

            task.isArchived = true;

            const goalOrderIndex = goal.tasksOrder.indexOf(task.id);
            goal.tasksOrder.splice(goalOrderIndex, 1);

            plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan
        };
    }

    @needsAuth
    public async createSubTask(ctx: Context, req: CreateSubTaskRequest): Promise<CreateSubTaskResponse> {

        const newSubTask: SubTask = {
            id: -1,
            taskId: req.taskId,
            parentSubTaskId: req.parentSubTaskId,
            title: req.title,
            subTasks: [],
            subTasksById: new Map<SubTaskId, SubTask>(),
            subTasksOrder: [],
            isArchived: false
        };

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {
            const plan = fullUser.plan;
            const schedule = fullUser.schedule;

            const task = Handler.getTaskById(plan, req.taskId);
            Handler.getGoalById(plan, task.goalId);

            if (task.donePolicy.type !== TaskDoneType.SUBTASKS) {
                throw new ServiceError(`Cannot create sub-task for non subtask goal task ${task.id}`);
            }

            plan.idSerialHack++;
            newSubTask.id = plan.idSerialHack;

            const subtaskPolicy = task.donePolicy.subtasks as SubtasksPolicy;

            if (req.parentSubTaskId === undefined) {
                subtaskPolicy.subTasks.push(newSubTask);
                subtaskPolicy.subTasksOrder.push(newSubTask.id);
                subtaskPolicy.subTasksById.set(newSubTask.id, newSubTask);
            } else {
                const parentSubTask = subtaskPolicy.subTasksById.get(req.parentSubTaskId);
                if (parentSubTask === undefined) {
                    throw new ServiceError(`Cannot find parent subTask with id ${req.parentSubTaskId}`);
                }
                parentSubTask.subTasks.push(newSubTask);
                parentSubTask.subTasksOrder.push(newSubTask.id);
                parentSubTask.subTasksById.set(newSubTask.id, newSubTask);
                subtaskPolicy.subTasksById.set(newSubTask.id, newSubTask);
            }

            const scheduledTaskEntry = Handler.getCurrentActiveScheduledTaskEntry(schedule, task);
            scheduledTaskEntry.isDone = Handler.computeIsDone(task, scheduledTaskEntry);

            plan.subTasksById.set(newSubTask.id, newSubTask);

            plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan
        };
    }

    @needsAuth
    public async moveSubTask(ctx: Context, req: MoveSubTaskRequest): Promise<MoveSubTaskResponse> {

        if (!req.moveToTopLevel && req.parentSubTaskId === undefined && req.position === undefined) {
            throw new ServiceError("You must specify at least one of toplevel, parentSubTaskId or position");
        } else if (req.moveToTopLevel && req.parentSubTaskId !== undefined) {
            throw new ServiceError(`Cannot both move to toplevel and a child under ${req.parentSubTaskId}`);
        }

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {
            const plan = fullUser.plan;
            const subTask = Handler.getSubTaskById(plan, req.subTaskId);
            const task = Handler.getTaskById(plan, subTask.taskId);
            const parentSubTask = subTask.parentSubTaskId ? Handler.getSubTaskById(plan, subTask.parentSubTaskId) : null;
            Handler.getGoalById(plan, task.goalId);

            const subtasksPolicy = task.donePolicy.subtasks as SubtasksPolicy;

            if (req.moveToTopLevel && req.parentSubTaskId === undefined && parentSubTask !== null) {

                // Move a child subtask to the toplevel.

                subTask.parentSubTaskId = undefined;

                const parentIndex = parentSubTask.subTasks.findIndex(st => st.id === subTask.id);
                const parentOrdersIndex = parentSubTask.subTasksOrder.indexOf(subTask.id);
                parentSubTask.subTasks.splice(parentIndex, 1);
                parentSubTask.subTasksById.delete(subTask.id);
                parentSubTask.subTasksOrder.splice(parentOrdersIndex, 1);

                subtasksPolicy.subTasks.push(subTask);
                subtasksPolicy.subTasksById.set(subTask.id, subTask);
                if (req.position === undefined) {
                    subtasksPolicy.subTasksOrder.push(subTask.id);
                } else {
                    if (req.position < 1 || req.position > subtasksPolicy.subTasksOrder.length) {
                        throw new ServiceError(`Cannot move subtask with id ${subTask.id} to position ${req.position}`);
                    }

                    subtasksPolicy.subTasksOrder.splice(req.position - 1, 0, subTask.id);
                }
            } else if (req.moveToTopLevel && req.parentSubTaskId === undefined && parentSubTask === null) {

                // Move a toplevel subtask to the toplevel.

                if (req.position !== undefined) {

                    if (req.position < 1 || req.position > subtasksPolicy.subTasksOrder.length) {
                        throw new ServiceError(`Cannot move subtask with id ${subTask.id} to position ${req.position}`);
                    }

                    const parentIndex = subtasksPolicy.subTasksOrder.indexOf(subTask.id);
                    subtasksPolicy.subTasksOrder.splice(parentIndex, 1);
                    subtasksPolicy.subTasksOrder.splice(req.position - 1, 0, subTask.id);
                }
            } else if (!req.moveToTopLevel && req.parentSubTaskId !== undefined && parentSubTask !== null) {
                // Move a child subtask to be a child of another task.

                const newParentSubTask = Handler.getSubTaskById(plan, req.parentSubTaskId);

                if (newParentSubTask.taskId !== parentSubTask.taskId) {
                    throw new ServiceError(`Cannot move subtask with id ${subTask.id} to a different task non-explicitly`);
                }

                // Make sure we're not moving a subtask to one of its descendants.
                let parentSubtaskWalker = newParentSubTask;
                while (parentSubtaskWalker.parentSubTaskId !== undefined) {
                    if (parentSubtaskWalker.parentSubTaskId === subTask.id) {
                        throw new ServiceError(`Cannot move subtask with id ${subTask.id} to one of its descendants`);
                    }
                    parentSubtaskWalker = Handler.getSubTaskById(plan, parentSubtaskWalker.parentSubTaskId);
                }

                subTask.parentSubTaskId = req.parentSubTaskId;

                const parentIndex = parentSubTask.subTasks.findIndex(st => st.id === subTask.id);
                const parentOrdersIndex = parentSubTask.subTasksOrder.indexOf(subTask.id);
                parentSubTask.subTasks.splice(parentIndex, 1);
                parentSubTask.subTasksById.delete(subTask.id);
                parentSubTask.subTasksOrder.splice(parentOrdersIndex, 1);

                newParentSubTask.subTasks.push(subTask);
                newParentSubTask.subTasksById.set(subTask.id, subTask);

                if (req.position === undefined) {
                    newParentSubTask.subTasksOrder.push(subTask.id);
                } else {
                    if (req.position < 1 || req.position > newParentSubTask.subTasksOrder.length) {
                        throw new ServiceError(`Cannot move subtask with id ${subTask.id} to position ${req.position}`);
                    }

                    newParentSubTask.subTasksOrder.splice(req.position - 1, 0, subTask.id);
                }
            } else if (!req.moveToTopLevel && req.parentSubTaskId !== undefined && parentSubTask === null) {
                // Move a toplevel subtask to be a child of another task.

                const newParentSubTask = Handler.getSubTaskById(plan, req.parentSubTaskId);

                if (newParentSubTask.taskId !== task.id) {
                    throw new ServiceError(`Cannot move subtask with id ${subTask.id} to a different task non-explicitly`);
                }

                // Make sure we're not moving a subtask to one of its descendants.
                let parentSubtaskWalker = newParentSubTask;
                while (parentSubtaskWalker.parentSubTaskId !== undefined) {
                    if (parentSubtaskWalker.parentSubTaskId === subTask.id) {
                        throw new ServiceError(`Cannot move subtask with id ${subTask.id} to one of its descendants`);
                    }
                    parentSubtaskWalker = Handler.getSubTaskById(plan, parentSubtaskWalker.parentSubTaskId);
                }

                subTask.parentSubTaskId = req.parentSubTaskId;

                const parentIndex = subtasksPolicy.subTasks.findIndex(st => st.id === subTask.id);
                const parentOrdersIndex = subtasksPolicy.subTasksOrder.indexOf(subTask.id);
                subtasksPolicy.subTasks.splice(parentIndex, 1);
                subtasksPolicy.subTasksOrder.splice(parentOrdersIndex, 1);

                newParentSubTask.subTasks.push(subTask);
                newParentSubTask.subTasksById.set(subTask.id, subTask);

                if (req.position === undefined) {
                    newParentSubTask.subTasksOrder.push(subTask.id);
                } else {
                    if (req.position < 1 || req.position > newParentSubTask.subTasksOrder.length) {
                        throw new ServiceError(`Cannot move subtask with id ${subTask.id} to position ${req.position}`);
                    }

                    newParentSubTask.subTasksOrder.splice(req.position - 1, 0, subTask.id);
                }
            } else if (!req.moveToTopLevel && req.parentSubTaskId === undefined && req.position !== undefined && parentSubTask !== null) {

                // Move a child subtask to a different position under its parent.

                if (req.position < 1 || req.position > parentSubTask.subTasksOrder.length) {
                    throw new ServiceError(`Cannot move subtask with id ${subTask.id} to position ${req.position}`);
                }

                const parentIndex = parentSubTask.subTasksOrder.indexOf(subTask.id);
                parentSubTask.subTasksOrder.splice(parentIndex, 1);
                parentSubTask.subTasksOrder.splice(req.position - 1, 0, subTask.id);
            } else if (!req.moveToTopLevel && req.parentSubTaskId === undefined && req.position !== undefined && parentSubTask === null) {

                // Move a toplevel subtask to a different position.

                if (req.position < 1 || req.position > subtasksPolicy.subTasksOrder.length) {
                    throw new ServiceError(`Cannot move subtask with id ${subTask.id} to position ${req.position}`);
                }

                const parentIndex = subtasksPolicy.subTasksOrder.indexOf(subTask.id);
                subtasksPolicy.subTasksOrder.splice(parentIndex, 1);
                subtasksPolicy.subTasksOrder.splice(req.position - 1, 0, subTask.id);
            } else {
                throw new CriticalServiceError("Invalid service path!");
            }

            fullUser.plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan
        };
    }

    @needsAuth
    public async updateSubTask(ctx: Context, req: UpdateSubTaskRequest): Promise<UpdateSubTaskResponse> {

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {
            const plan = fullUser.plan;
            const subTask = Handler.getSubTaskById(plan, req.subTaskId);
            const task = Handler.getTaskById(plan, subTask.taskId);
            Handler.getGoalById(plan, task.goalId);

            if (req.title !== undefined) {
                subTask.title = req.title;
            }

            plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan
        };
    }

    @needsAuth
    public async archiveSubTask(ctx: Context, req: ArchiveSubTaskRequest): Promise<ArchiveSubTaskResponse> {

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {
            const plan = fullUser.plan;
            const schedule = fullUser.schedule;

            const subTask = Handler.getSubTaskById(plan, req.subTaskId);
            const parentSubTask = subTask.parentSubTaskId ? Handler.getSubTaskById(plan, subTask.parentSubTaskId) : null;
            const task = Handler.getTaskById(plan, subTask.taskId);
            Handler.getGoalById(plan, task.goalId, true);

            if (parentSubTask === null) {
                const subTaskIndex = (task.donePolicy.subtasks as SubtasksPolicy).subTasksOrder.indexOf(subTask.id);
                (task.donePolicy.subtasks as SubtasksPolicy).subTasksOrder.splice(subTaskIndex, 1);
            } else {
                const subTaskIndex = parentSubTask.subTasksOrder.indexOf(subTask.id);
                parentSubTask.subTasksOrder.splice(subTaskIndex, 1);
            }

            const scheduledTaskEntry = Handler.getCurrentActiveScheduledTaskEntry(schedule, task);
            scheduledTaskEntry.isDone = Handler.computeIsDone(task, scheduledTaskEntry);

            subTask.isArchived = true;

            plan.version.minor++;

            return [WhatToSave.PLAN_AND_SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan
        };
    }

    // Schedules

    @needsAuth
    public async getLatestSchedule(ctx: Context, _req: GetLatestScheduleRequest): Promise<GetLatestScheduleResponse> {
        const fullUser = await this.dbGetFullUser(ctx);

        return {
            plan: fullUser.plan,
            schedule: fullUser.schedule
        };
    }

    @needsAuth
    public async incrementMetric(ctx: Context, req: IncrementMetricRequest): Promise<IncrementMetricResponse> {

        const rightNow = moment.utc();

        const newCollectedMetricEntry: CollectedMetricEntry = {
            id: -1,
            collectedMetricId: -1,
            timestamp: rightNow,
            value: 1
        };

        return await this.handleMetric(ctx, req.metricId, newCollectedMetricEntry, MetricType.COUNTER);
    }

    @needsAuth
    public async recordForMetric(ctx: Context, req: RecordForMetricRequest): Promise<RecordForMetricResponse> {

        const rightNow = moment.utc();

        const newCollectedMetricEntry: CollectedMetricEntry = {
            id: -1,
            collectedMetricId: -1,
            timestamp: rightNow,
            value: req.value
        };

        return await this.handleMetric(ctx, req.metricId, newCollectedMetricEntry, MetricType.GAUGE);
    }

    private async handleMetric(ctx: Context, metricId: MetricId, entry: CollectedMetricEntry, allowedType: MetricType): Promise<RecordForMetricResponse | IncrementMetricResponse> {
        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {
            const plan = fullUser.plan;
            const schedule = fullUser.schedule;

            const metric = Handler.getMetricById(plan, metricId);

            if (metric.type !== allowedType) {
                throw new ServiceError(`Metric with id ${metricId} is not an ${allowedType}`);
            }

            Handler.getGoalById(plan, metric.goalId);

            const collectedMetric = schedule.collectedMetricsByMetricId.get(metricId);

            if (collectedMetric === undefined) {
                throw new CriticalServiceError(`Collected metric for metric with id ${metricId} does not exist`);
            }

            collectedMetric.entries.push(entry);
            schedule.version.minor++;
            schedule.idSerialHack++;
            entry.id = schedule.idSerialHack;
            entry.collectedMetricId = collectedMetric.id;

            return [WhatToSave.SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan,
            schedule: newFullUser.schedule
        };
    }

    @needsAuth
    public async markTaskAsDone(ctx: Context, req: MarkTaskAsDoneRequest): Promise<MarkTaskAsDoneResponse> {

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {

            const plan = fullUser.plan;
            const schedule = fullUser.schedule;

            const scheduledTaskEntry = Handler.getScheduledTaskEntryById(schedule, req.scheduledTaskEntryId);
            const scheduledTask = Handler.getScheduledTaskById(schedule, scheduledTaskEntry.scheduledTaskId);
            const task = Handler.getTaskById(plan, scheduledTask.taskId);

            if (scheduledTaskEntry.doneStatus.type !== TaskDoneType.BOOLEAN) {
                throw new ServiceError(`Cannot mark non-boolean type task entry with id ${req.scheduledTaskEntryId} as done`);
            }

            (scheduledTaskEntry.doneStatus.boolean as BooleanStatus).isDone = true;
            scheduledTaskEntry.isDone = Handler.computeIsDone(task, scheduledTaskEntry);

            schedule.version.minor++;

            return [WhatToSave.SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan,
            schedule: newFullUser.schedule
        };
    }

    @needsAuth
    public async markSubTaskAsDone(ctx: Context, req: MarkSubTaskAsDoneRequest): Promise<MarkSubTaskAsDoneResponse> {

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {

            const plan = fullUser.plan;
            const schedule = fullUser.schedule;

            const scheduledTaskEntry = Handler.getScheduledTaskEntryById(schedule, req.scheduledTaskEntryId);
            const scheduledTask = Handler.getScheduledTaskById(schedule, scheduledTaskEntry.scheduledTaskId);
            const task = Handler.getTaskById(plan, scheduledTask.taskId);
            Handler.getGoalById(plan, task.goalId);

            if (scheduledTaskEntry.doneStatus.type !== TaskDoneType.SUBTASKS) {
                throw new ServiceError(`Cannot mark non-subtask type task entry with id ${req.scheduledTaskEntryId} as done`);
            }

            if (!(task.donePolicy.subtasks as SubtasksPolicy).subTasksById.has(req.subTaskId)) {
                throw new ServiceError(`Subtask with id ${req.subTaskId} does not belong to task ${task.id}`);
            }

            (scheduledTaskEntry.doneStatus.subtasks as SubtasksStatus).doneSubTasks.add(req.subTaskId);
            scheduledTaskEntry.isDone = Handler.computeIsDone(task, scheduledTaskEntry);

            schedule.version.minor++;

            return [WhatToSave.SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan,
            schedule: newFullUser.schedule
        };
    }

    @needsAuth
    public async incrementCounterTask(ctx: Context, req: IncrementCounterTaskRequest): Promise<IncrementCounterTaskResponse> {

        if (req.increment !== undefined) {
            if (req.increment < 1) {
                throw new ServiceError("Increment value must be greater than 1");
            }
            if (!Number.isInteger(req.increment)) {
                throw new ServiceError("Increment value must be an integer");
            }
        }

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {

            const plan = fullUser.plan;
            const schedule = fullUser.schedule;

            const scheduledTaskEntry = Handler.getScheduledTaskEntryById(schedule, req.scheduledTaskEntryId);
            const scheduledTask = Handler.getScheduledTaskById(schedule, scheduledTaskEntry.scheduledTaskId);
            const task = Handler.getTaskById(plan, scheduledTask.taskId);
            Handler.getGoalById(plan, task.goalId);

            if (scheduledTaskEntry.doneStatus.type !== TaskDoneType.COUNTER) {
                throw new ServiceError(`Cannot increment non-counter type task entry with id ${req.scheduledTaskEntryId}`);
            }

            // Find the one scheduled task.
            const increment = req.increment !== undefined ? req.increment : 1;
            (scheduledTaskEntry.doneStatus.counter as CounterStatus).currentValue += increment;
            scheduledTaskEntry.isDone = Handler.computeIsDone(task, scheduledTaskEntry);

            schedule.version.minor++;

            return [WhatToSave.SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan,
            schedule: newFullUser.schedule
        };
    }

    @needsAuth
    public async setGaugeTask(ctx: Context, req: SetGaugeTaskRequest): Promise<SetGaugeTaskResponse> {

        if (req.level < 0) {
            throw new ServiceError(`Cannot set negative level ${req.level} for task entry ${req.scheduledTaskEntryId}`);
        }

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {

            const plan = fullUser.plan;
            const schedule = fullUser.schedule;

            const scheduledTaskEntry = Handler.getScheduledTaskEntryById(schedule, req.scheduledTaskEntryId);
            const scheduledTask = Handler.getScheduledTaskById(schedule, scheduledTaskEntry.scheduledTaskId);
            const task = Handler.getTaskById(plan, scheduledTask.taskId);
            Handler.getGoalById(plan, task.goalId);

            if (scheduledTaskEntry.doneStatus.type !== TaskDoneType.GAUGE) {
                throw new ServiceError(`Cannot set non-gauge type task entry with id ${req.scheduledTaskEntryId}`);
            }

            // Find the one scheduled task.
            (scheduledTaskEntry.doneStatus.gauge as GaugeStatus).currentValue = req.level;
            scheduledTaskEntry.isDone = Handler.computeIsDone(task, scheduledTaskEntry);

            schedule.version.minor++;

            return [WhatToSave.SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan,
            schedule: newFullUser.schedule
        };
    }

    @needsAuth
    public async updateScheduledTaskEntry(ctx: Context, req: UpdateScheduledTaskEntryRequest): Promise<UpdateScheduledTaskEntryResponse> {

        const newFullUser = await this.dbModifyFullUser(ctx, fullUser => {
            const schedule = fullUser.schedule;

            const scheduledTaskEntry = Handler.getScheduledTaskEntryById(schedule, req.scheduledTaskEntryId);

            if (req.inProgress !== undefined) {
                if (req.inProgress && scheduledTaskEntry.inProgress) {
                    throw new ServiceError(`Scheduled task entry with id ${scheduledTaskEntry.id} is already in progress`);
                } else if (!req.inProgress && !scheduledTaskEntry.inProgress) {
                    throw new ServiceError(`Scheduled task entry with id ${scheduledTaskEntry.id} is already not in progress`);
                }
                scheduledTaskEntry.inProgress = req.inProgress;
            }

            schedule.version.minor++;

            return [WhatToSave.SCHEDULE, fullUser];
        });

        return {
            plan: newFullUser.plan,
            schedule: newFullUser.schedule
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

        const users = await this.dbGetAllActiveUsers(this.conn);

        for (const user of users) {

            const ctx = {
                auth: { token: "A FAKE TOKEN WHICH IS FAKE" },
                userId: user.id
            };

            await this.dbModifyFullUser(ctx, fullUser => {
                const plan = fullUser.plan;

                let modifiedSomething = false;

                for (const task of fullUser.plan.tasksById.values()) {
                    if (task.repeatSchedule === undefined) {
                        continue;
                    }

                    const scheduledTask = fullUser.schedule.scheduledTasksByTaskId.get(task.id);

                    if (scheduledTask === undefined) {
                        throw new CriticalServiceError(`Scheduled task for task with id ${task.id} does not exist`);
                    }

                    const lastEntry = scheduledTask.entries[scheduledTask.entries.length - 1]; // Guaranteed to always exist!
                    const lastEntryRepeatScheduleAt = lastEntry.repeatScheduleAt.startOf("day"); // Should already be here!

                    const goal = Handler.getGoalById(plan, task.goalId, true, true);

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
                        } else if (
                            task.urgency === TaskUrgency.REGULAR
                            && user.vacations
                                .filter(v => !v.isArchived)
                                .some(v => date.isSameOrAfter(v.startTime) && date.isSameOrBefore(v.endTime))) {
                            continue;
                        } else if (task.urgency === TaskUrgency.REGULAR && task.isSuspended) {
                            continue;
                        } else if (task.urgency === TaskUrgency.REGULAR && goal.isSuspended) {
                            continue;
                        } else if (task.urgency === TaskUrgency.REGULAR && plan.isSuspended) {
                            continue;
                        }

                        fullUser.schedule.idSerialHack++;
                        scheduledTask.entries.push({
                            id: fullUser.schedule.idSerialHack,
                            scheduledTaskId: scheduledTask.id,
                            inProgress: false,
                            isDone: false,
                            doneStatus: Handler.generateDoneStatusFromPolicy(task),
                            repeatScheduleAt: date
                        });
                        modifiedSomething = true;
                    }
                }

                if (modifiedSomething) {
                    fullUser.schedule.version.minor++;
                    return [WhatToSave.SCHEDULE, fullUser];
                } else {
                    return [WhatToSave.NONE, fullUser];
                }
            });
        }
    }

    private static generateDoneStatusFromPolicy(task: Task): ScheduledTaskDoneStatus {
        switch (task.donePolicy.type) {
            case TaskDoneType.BOOLEAN:
                return {
                    type: TaskDoneType.BOOLEAN,
                    boolean: {
                        isDone: false
                    }
                };
            case TaskDoneType.SUBTASKS:
                return {
                    type: TaskDoneType.SUBTASKS,
                    subtasks: {
                        doneSubTasks: new Set<SubTaskId>()
                    }
                };
            case TaskDoneType.COUNTER:
                return {
                    type: TaskDoneType.COUNTER,
                    counter: {
                        currentValue: 0
                    }
                };
            case TaskDoneType.GAUGE:
                return {
                    type: TaskDoneType.GAUGE,
                    gauge: {
                        currentValue: 0
                    }
                };
        }
    }

    private static computeIsDone(task: Task, entry: ScheduledTaskEntry): boolean {
        switch (task.donePolicy.type) {
            case TaskDoneType.BOOLEAN:
                return (entry.doneStatus.boolean as BooleanStatus).isDone;
            case TaskDoneType.SUBTASKS:
                for (const taskId of (task.donePolicy.subtasks as SubtasksPolicy).subTasksById.keys()) {
                    if (!(entry.doneStatus.subtasks as SubtasksStatus).doneSubTasks.has(taskId)) {
                        return false;
                    }
                }

                return true;
            case TaskDoneType.COUNTER: {
                const donePolicy = task.donePolicy.counter as CounterPolicy;
                const doneStatus = entry.doneStatus.counter as CounterStatus;

                switch (donePolicy.type) {
                    case CounterPolicyType.EXACTLY:
                        return doneStatus.currentValue === donePolicy.lowerLimit;
                    case CounterPolicyType.AT_LEAST:
                        return doneStatus.currentValue >= donePolicy.lowerLimit;
                    case CounterPolicyType.AT_MOST:
                        return doneStatus.currentValue <= donePolicy.lowerLimit;
                    case CounterPolicyType.BETWEEN:
                        return doneStatus.currentValue >= donePolicy.lowerLimit && doneStatus.currentValue <= (donePolicy.upperLimit as number);
                }
            } break;
            case TaskDoneType.GAUGE: {
                const donePolicy = task.donePolicy.gauge as GaugePolicy;
                const doneStatus = entry.doneStatus.gauge as GaugeStatus;

                switch (donePolicy.type) {
                    case GaugePolicyType.EXACTLY:
                        return doneStatus.currentValue === donePolicy.lowerLimit;
                    case GaugePolicyType.AT_LEAST:
                        return doneStatus.currentValue >= donePolicy.lowerLimit;
                    case GaugePolicyType.AT_MOST:
                        return doneStatus.currentValue <= donePolicy.lowerLimit;
                    case GaugePolicyType.BETWEEN:
                        return doneStatus.currentValue >= donePolicy.lowerLimit && doneStatus.currentValue <= (donePolicy.upperLimit as number);
                }
            } break;
        }

        throw new CriticalServiceError(`Unknown paths with ${task.donePolicy.type}`);
    }

    // DB access & helpers

    private async dbGetFullUser(ctx: Context): Promise<FullUser> {
        return await this.conn.transaction(async (trx: Transaction) => {
            const user = await this.dbGetUserById(trx, ctx.userId);

            if (user.isArchived) {
                throw new ServiceError(`User id=${user.id} is archived`);
            }

            const plan = await this.dbGetLatestPlan(trx, user.id);
            const schedule = await this.dbGetLatestSchedule(trx, user.id, plan.id);

            return {
                user: user,
                plan: plan,
                schedule: schedule
            };
        });
    }

    private async dbModifyFullUser(ctx: Context, action: (fullUser: FullUser) => [WhatToSave, FullUser]): Promise<FullUser> {
        return await this.conn.transaction(async (trx: Transaction) => {
            const user = await this.dbGetUserById(trx, ctx.userId);

            if (user.isArchived) {
                throw new ServiceError(`User id=${user.id} is archived`);
            }

            const plan = await this.dbGetLatestPlan(trx, user.id);
            const schedule = await this.dbGetLatestSchedule(trx, user.id, plan.id);

            const fullUser = {
                user: user,
                plan: plan,
                schedule: schedule
            };

            const [whatToSave, newFullUser] = action(fullUser);

            let newSavedUser;
            let newSavedPlan;
            let newSavedSchedule;
            switch (whatToSave) {
                case WhatToSave.NONE:
                    newSavedUser = newFullUser.user;
                    newSavedPlan = newFullUser.plan;
                    newSavedSchedule = newFullUser.schedule;
                    break;
                case WhatToSave.USER:
                    newSavedUser = await this.dbUpdateUser(trx, newFullUser.user);
                    newSavedPlan = newFullUser.plan;
                    newSavedSchedule = newFullUser.schedule;
                case WhatToSave.SCHEDULE:
                    newSavedUser = newFullUser.user;
                    newSavedPlan = newFullUser.plan;
                    newSavedSchedule = await this.dbSaveSchedule(trx, newSavedUser.id, newFullUser.plan.id, newFullUser.schedule);
                    break;
                case WhatToSave.PLAN_AND_SCHEDULE:
                    newSavedUser = newFullUser.user;
                    newSavedPlan = await this.dbSavePlan(trx, newSavedUser.id, newFullUser.plan);
                    newSavedSchedule = await this.dbSaveSchedule(trx, newSavedUser.id, newSavedPlan.id, newFullUser.schedule);
                    break;
            }

            return {
                user: newSavedUser as User,
                plan: newSavedPlan as Plan,
                schedule: newSavedSchedule as Schedule
            };
        });
    }

    private async dbGetOrCreateUser(email: string, password: string): Promise<User> {
        return await this.conn.transaction(async (trx: Transaction) => {
            try {
                const user = await this.dbGetUserByEmailAndPassword(trx, email, password);

                if (user.isArchived) {
                    throw new ServiceError(`User id=${user.id} is archived`);
                }

                return user;
            } catch (e) {
                if (!e.message.startsWith("No user with email")) {
                    throw e;
                }

                const initialFullUser = await Handler.getEmptyFullUser(email, password);
                const newUser = await this.dbSaveUser(trx, initialFullUser.user);
                const newPlan = await this.dbSavePlan(trx, newUser.id, initialFullUser.plan);
                await this.dbSaveSchedule(trx, newUser.id, newPlan.id, initialFullUser.schedule);

                return newUser;
            }
        });
    }

    private async dbGetUserByEmailAndPassword(conn: knex, email: string, password: string): Promise<User> {
        const userRows = await conn
            .from(Handler.USER_TABLE)
            .select(Handler.USER_FIELDS)
            .where("email", email)
            .limit(1);

        if (userRows.length === 0) {
            throw new ServiceError(`No user with email ${email} and supplied password`);
        }

        const userRow = userRows[0];

        return new Promise<User>((resolve, reject) => {
            bcrypt.compare(password, userRow["password_hash"], (err: Error, same?: boolean) => {
                if (err) {
                    return reject(new ServiceError(`Crypto error ${err.message}`));
                }

                if (!same) {
                    return reject(new ServiceError(`Invalid password for user ${email}`));
                }

                resolve(Handler.dbUserToUser(userRows[0]));
            });
        });
    }

    private async dbGetUserById(conn: knex, id: UserId): Promise<User> {
        const userRows = await conn
            .from(Handler.USER_TABLE)
            .select(Handler.USER_FIELDS)
            .where("id", id)
            .limit(1);

        if (userRows.length === 0) {
            throw new ServiceError(`No user with id ${id}`);
        }

        return Handler.dbUserToUser(userRows[0]);
    }

    private async dbGetAllActiveUsers(conn: knex): Promise<User[]> {
        const userRows = await conn
            .from(Handler.USER_TABLE)
            .select(Handler.USER_FIELDS)
            .whereRaw("(user_json->>'isArchived')::boolean = FALSE");

        return userRows.map((ur: any) => Handler.dbUserToUser(ur));
    }

    private async dbSaveUser(conn: knex, user: User): Promise<User> {
        const userRows = await conn
            .from(Handler.USER_TABLE)
            .returning(Handler.USER_FIELDS)
            .insert({
                user_json: Handler.userToDbUser(user),
                email: user.email,
                password_hash: user.passwordHash
            });

        if (userRows.length === 0) {
            throw new ServiceError(`Could not insert user ${user.id}`);
        }

        return Handler.dbUserToUser(userRows[0]);
    }

    private async dbUpdateUser(conn: knex, user: User): Promise<User> {
        const userRows = await conn
            .from(Handler.USER_TABLE)
            .returning(Handler.USER_FIELDS)
            .update({
                user_json: Handler.userToDbUser(user),
                email: user.email,
                password_hash: user.passwordHash
            })
            .where("id", user.id);

        if (userRows.length === 0) {
            throw new ServiceError(`Could not update user ${user.id}`);
        }

        return Handler.dbUserToUser(userRows[0]);
    }

    private async dbGetLatestPlan(conn: knex, userId: UserId): Promise<Plan> {
        const planRows = await conn
            .from(Handler.PLAN_TABLE)
            .select(Handler.PLAN_FIELDS)
            .orderBy("version_major", "desc")
            .orderBy("version_minor", "desc")
            .where("user_id", userId)
            .limit(1);

        if (planRows.length === 0) {
            throw new ServiceError(`No plan for user ${userId}`);
        }

        return Handler.dbPlanToPlan(planRows[0]);
    }

    private async dbSavePlan(conn: knex, userId: UserId, plan: Plan): Promise<Plan> {
        const planRows = await conn
            .from(Handler.PLAN_TABLE)
            .returning(Handler.PLAN_FIELDS)
            .insert({
                version_major: plan.version.major,
                version_minor: plan.version.minor,
                plan_json: Handler.planToDbPlan(plan),
                user_id: userId
            });

        if (planRows.length === 0) {
            throw new ServiceError(`Could not insert plan for ${userId}`);
        }

        return Handler.dbPlanToPlan(planRows[0]);
    }

    private async dbGetLatestSchedule(conn: knex, userId: UserId, planId: PlanId): Promise<Schedule> {
        const scheduleRows = await conn
            .from(Handler.SCHEDULE_TABLE)
            .select(Handler.SCHEDULE_FIELDS)
            .orderBy("version_major", "desc")
            .orderBy("version_minor", "desc")
            .where("user_id", userId)
            .andWhere("plan_id", planId)
            .limit(1);

        if (scheduleRows.length === 0) {
            throw new ServiceError(`No schedule for user ${userId} and plan ${planId}`);
        }

        return Handler.dbScheduleToSchedule(scheduleRows[0]);
    }

    private async dbSaveSchedule(conn: knex, userId: UserId, planId: PlanId, schedule: Schedule): Promise<Schedule> {
        const scheduleRows = await conn
            .from(Handler.SCHEDULE_TABLE)
            .returning(Handler.SCHEDULE_FIELDS)
            .insert({
                version_major: schedule.version.major,
                version_minor: schedule.version.minor,
                schedule_json: Handler.scheduleToDbSchedule(schedule),
                user_id: userId,
                plan_id: planId
            });

        if (scheduleRows.length === 0) {
            throw new ServiceError(`Could not insert sechedule for ${userId} and plan ${planId}`);
        }

        return Handler.dbScheduleToSchedule(scheduleRows[0]);
    }

    private static dbUserToUser(userRow: any): User {
        const dbUser = userRow["user_json"];

        const user = {
            id: userRow.id,
            email: userRow.email,
            passwordHash: userRow.password_hash,
            isArchived: dbUser.isArchived,
            vacations: dbUser.vacations.map((v: any) => Handler.dbVacationToVacation(v)),
            idSerialHack: dbUser.idSerialHack,
            vacationsById: new Map<VacationId, Vacation>()
        };

        for (const vacation of user.vacations) {
            user.vacationsById.set(vacation.id, vacation);
        }

        return user;
    }

    private static dbVacationToVacation(vacationRow: any): Vacation {
        return {
            id: vacationRow.id,
            startTime: moment.unix(vacationRow.startTime).utc(),
            endTime: moment.unix(vacationRow.endTime).utc(),
            isArchived: vacationRow.isArchived
        };
    }

    private static userToDbUser(user: User): any {
        return {
            isArchived: user.isArchived,
            vacations: user.vacations.map(v => Handler.vacationToDbVacation(v)),
            idSerialHack: user.idSerialHack
        };
    }

    private static vacationToDbVacation(vacation: Vacation): any {
        return {
            id: vacation.id,
            startTime: vacation.startTime.unix(),
            endTime: vacation.endTime.unix(),
            isArchived: vacation.isArchived
        };
    }

    private static dbPlanToPlan(planRow: any): Plan {

        function populateIndices(plan: Plan, goal: Goal): void {
            plan.goalsById.set(goal.id, goal);

            for (const metric of goal.metrics) {
                plan.metricsById.set(metric.id, metric);
            }

            for (const task of goal.tasks) {
                plan.tasksById.set(task.id, task);

                if (task.donePolicy.type === TaskDoneType.SUBTASKS) {
                    for (const [subTaskId, subTask] of (task.donePolicy.subtasks as SubtasksPolicy).subTasksById.entries()) {
                        plan.subTasksById.set(subTaskId, subTask);
                    }
                }
            }

            for (const subGoal of goal.subgoals) {
                populateIndices(plan, subGoal);
            }
        }

        const dbPlan = planRow["plan_json"];

        const plan: Plan = {
            id: planRow.id,
            version: dbPlan.version,
            goals: dbPlan.goals.map((g: any) => Handler.dbGoalToGoal(g)),
            goalsOrder: dbPlan.goalsOrder,
            isSuspended: dbPlan.isSuspended,
            idSerialHack: dbPlan.idSerialHack,
            inboxGoalId: dbPlan.inboxGoalId,
            goalsById: new Map<GoalId, Goal>(),
            metricsById: new Map<MetricId, Metric>(),
            tasksById: new Map<TaskId, Task>(),
            subTasksById: new Map<SubTaskId, SubTask>()
        };

        for (const goal of plan.goals) {
            populateIndices(plan, goal);
        }

        return plan;
    }

    private static dbGoalToGoal(goalRow: any): Goal {

        function populateIndices(goal: Goal): void {

            for (const subGoal of goal.subgoals) {
                goal.subgoalsById.set(subGoal.id, subGoal);
                populateIndices(subGoal);
            }

            for (const metric of goal.metrics) {
                goal.metricsById.set(metric.id, metric);
            }

            for (const task of goal.tasks) {
                goal.tasksById.set(task.id, task);
            }
        }

        const goal: Goal = {
            id: goalRow.id,
            parentGoalId: goalRow.parentGoalId,
            isSystemGoal: goalRow.isSystemGoal,
            title: goalRow.title,
            description: goalRow.description,
            range: goalRow.range,
            deadline: goalRow.deadline ? moment.unix(goalRow.deadline).utc() : undefined,
            subgoals: goalRow.subgoals.map((g: any) => Handler.dbGoalToGoal(g)),
            subgoalsById: new Map<GoalId, Goal>(),
            subgoalsOrder: goalRow.subgoalsOrder,
            metrics: goalRow.metrics.map((m: any) => Handler.dbMetricToMetric(m)),
            metricsById: new Map<MetricId, Metric>(),
            metricsOrder: goalRow.metricsOrder,
            tasks: goalRow.tasks.map((t: any) => Handler.dbTaskToTask(t)),
            tasksById: new Map<TaskId, Task>(),
            tasksOrder: goalRow.tasksOrder,
            boards: goalRow.boards.map((b: any) => Handler.dbBoardToBoard(b)),
            isSuspended: goalRow.isSuspended,
            isDone: goalRow.isDone,
            isArchived: goalRow.isArchived
        };

        populateIndices(goal);

        return goal;
    }

    private static dbMetricToMetric(metricRow: any): Metric {
        return {
            id: metricRow.id,
            goalId: metricRow.goalId,
            title: metricRow.title,
            description: metricRow.description,
            type: metricRow.type,
            isArchived: metricRow.isArchived
        };
    }

    private static dbTaskToTask(taskRow: any): Task {

        const task = {
            id: taskRow.id,
            goalId: taskRow.goalId,
            title: taskRow.title,
            description: taskRow.description,
            priority: taskRow.priority,
            urgency: taskRow.urgency,
            deadline: taskRow.deadline ? moment.unix(taskRow.deadline).utc() : undefined,
            repeatSchedule: taskRow.repeatSchedule,
            reminderPolicy: taskRow.reminderPolicy,
            donePolicy: Handler.dbTaskDonePolicyToTaskDonePolicy(taskRow.donePolicy),
            isSuspended: taskRow.isSuspended,
            isArchived: taskRow.isArchived
        };

        return task;
    }

    private static dbTaskDonePolicyToTaskDonePolicy(donePolicyRow: any): TaskDonePolicy {
        const type = donePolicyRow.type;

        switch (type) {
            case TaskDoneType.BOOLEAN:
                return {
                    type: TaskDoneType.BOOLEAN,
                    boolean: Handler.dbBooleanPolicyToBooleanPolicy(donePolicyRow.boolean)
                };
            case TaskDoneType.SUBTASKS:
                return {
                    type: TaskDoneType.SUBTASKS,
                    subtasks: Handler.dbSubtasksPolicyToSubtasksPolicy(donePolicyRow.subtasks)
                };
            case TaskDoneType.COUNTER:
                return {
                    type: TaskDoneType.COUNTER,
                    counter: Handler.dbCounterPolicyToCounterPolicy(donePolicyRow.counter)
                };
            case TaskDoneType.GAUGE:
                return {
                    type: TaskDoneType.GAUGE,
                    gauge: Handler.dbGaugePolicyToGaugePolicy(donePolicyRow.gauge)
                };
            default:
                throw new CriticalServiceError(`Invalid done policy type ${type}`);
        }
    }

    private static dbBooleanPolicyToBooleanPolicy(_booleanPolicyRow: any): BooleanPolicy {
        return {};
    }

    private static dbSubtasksPolicyToSubtasksPolicy(subtasksPolicyRow: any): SubtasksPolicy {
        function populateIndicies(policy: SubtasksPolicy, subTask: SubTask) {
            policy.subTasksById.set(subTask.id, subTask);
            for (const subSubTask of subTask.subTasks) {
                populateIndicies(policy, subSubTask);
            }
        }

        const subtasksPolicy = {
            subTasks: subtasksPolicyRow.subTasks.map((st: any) => Handler.dbSubTaskToSubTask(st)),
            subTasksOrder: subtasksPolicyRow.subTasksOrder,
            subTasksById: new Map<SubTaskId, SubTask>()
        };

        for (const subTask of subtasksPolicy.subTasks) {
            populateIndicies(subtasksPolicy, subTask);
        }

        return subtasksPolicy;
    }

    private static dbSubTaskToSubTask(subTaskRow: any): SubTask {
        const subTask = {
            id: subTaskRow.id,
            taskId: subTaskRow.taskId,
            parentSubTaskId: subTaskRow.parentSubTaskId,
            title: subTaskRow.title,
            subTasks: subTaskRow.subTasks.map((st: any) => Handler.dbSubTaskToSubTask(st)),
            subTasksById: new Map<SubTaskId, SubTask>(),
            subTasksOrder: subTaskRow.subTasksOrder,
            isArchived: subTaskRow.isArchived
        };

        for (const subSubTask of subTask.subTasks) {
            subTask.subTasksById.set(subSubTask.id, subSubTask);
        }

        return subTask;
    }

    private static dbCounterPolicyToCounterPolicy(counterPolicyRow: any): CounterPolicy {
        return {
            type: counterPolicyRow.type,
            lowerLimit: counterPolicyRow.lowerLimit,
            upperLimit: counterPolicyRow.upperLimit
        };
    }

    private static dbGaugePolicyToGaugePolicy(gaugePolicyRow: any): GaugePolicy {
        return {
            type: gaugePolicyRow.type,
            lowerLimit: gaugePolicyRow.lowerLimit,
            upperLimit: gaugePolicyRow.upperLimit
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
            goals: plan.goals.map(g => Handler.goalToDbGoal(g)),
            goalsOrder: plan.goalsOrder,
            isSuspended: plan.isSuspended,
            idSerialHack: plan.idSerialHack,
            inboxGoalId: plan.inboxGoalId
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
            subgoals: goal.subgoals.map(g => Handler.goalToDbGoal(g)),
            subgoalsOrder: goal.subgoalsOrder,
            metrics: goal.metrics.map(m => Handler.metricToDbMetric(m)),
            metricsOrder: goal.metricsOrder,
            tasks: goal.tasks.map(t => Handler.taskToDbTask(t)),
            tasksOrder: goal.tasksOrder,
            boards: goal.boards.map(b => Handler.boardToDbBoard(b)),
            isSuspended: goal.isSuspended,
            isDone: goal.isDone,
            isArchived: goal.isArchived
        };
    }

    private static metricToDbMetric(metric: Metric): any {
        return {
            id: metric.id,
            goalId: metric.goalId,
            title: metric.title,
            description: metric.description,
            type: metric.type,
            isArchived: metric.isArchived
        };
    }

    private static taskToDbTask(task: Task): any {
        return {
            id: task.id,
            goalId: task.goalId,
            title: task.title,
            description: task.description,
            priority: task.priority,
            urgency: task.urgency,
            deadline: task.deadline ? task.deadline.unix() : undefined,
            repeatSchedule: task.repeatSchedule,
            reminderPolicy: task.reminderPolicy,
            donePolicy: Handler.taskDonePolicyToDbTaskDonePolicy(task.donePolicy),
            isSuspended: task.isSuspended,
            isArchived: task.isArchived
        };
    }

    private static taskDonePolicyToDbTaskDonePolicy(taskDonePolicy: TaskDonePolicy): any {
        switch (taskDonePolicy.type) {
            case TaskDoneType.BOOLEAN:
                return {
                    type: TaskDoneType.BOOLEAN,
                    boolean: Handler.booleanPolicyToDbBooleanPolicy(taskDonePolicy.boolean as BooleanPolicy)
                };
            case TaskDoneType.SUBTASKS:
                return {
                    type: TaskDoneType.SUBTASKS,
                    subtasks: Handler.subtasksPolicyToDbSubtasksPolicy(taskDonePolicy.subtasks as SubtasksPolicy)
                };
            case TaskDoneType.COUNTER:
                return {
                    type: TaskDoneType.COUNTER,
                    counter: Handler.counterPolicyToDbCounterPolicy(taskDonePolicy.counter as CounterPolicy)
                };
            case TaskDoneType.GAUGE:
                return {
                    type: TaskDoneType.GAUGE,
                    gauge: Handler.gaugePolicyToDbGaugePolicy(taskDonePolicy.gauge as GaugePolicy)
                };
        }
    }

    private static booleanPolicyToDbBooleanPolicy(_booleanPolicy: BooleanPolicy): any {
        return {};
    }

    private static subtasksPolicyToDbSubtasksPolicy(subtasksPolicy: SubtasksPolicy): any {
        return {
            subTasks: subtasksPolicy.subTasks.map(st => Handler.subTaskToDbSubTask(st)),
            subTasksOrder: subtasksPolicy.subTasksOrder
        };
    }

    private static counterPolicyToDbCounterPolicy(counterPolicy: CounterPolicy): any {
        return {
            type: counterPolicy.type,
            lowerLimit: counterPolicy.lowerLimit,
            upperLimit: counterPolicy.upperLimit
        };
    }

    private static gaugePolicyToDbGaugePolicy(gaugePolicy: GaugePolicy): any {
        return {
            type: gaugePolicy.type,
            lowerLimit: gaugePolicy.lowerLimit,
            upperLimit: gaugePolicy.upperLimit
        };
    }

    private static subTaskToDbSubTask(subTask: SubTask): any {
        return {
            id: subTask.id,
            taskId: subTask.taskId,
            parentSubTaskId: subTask.parentSubTaskId,
            title: subTask.title,
            subTasks: subTask.subTasks.map(st => Handler.subTaskToDbSubTask(st)),
            subTasksOrder: subTask.subTasksOrder,
            isArchived: subTask.isArchived
        };
    }

    private static boardToDbBoard(board: Board): any {
        return {
            id: board.id,
            title: board.title
        };
    }

    private static dbScheduleToSchedule(scheduleRow: any): Schedule {

        const dbSchedule = scheduleRow["schedule_json"];

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
                            inProgress: ste.inProgress,
                            isDone: ste.isDone,
                            doneStatus: Handler.dbScheduledTaskDoneStatusToScheduledTaskDoneStatus(ste.doneStatus),
                            repeatScheduleAt: moment.unix(ste.repeatScheduleAt).utc()
                        };
                    })
                };
            }),
            idSerialHack: dbSchedule.idSerialHack,
            collectedMetricsByMetricId: new Map<MetricId, CollectedMetric>(),
            scheduledTasksById: new Map<ScheduledTaskId, ScheduledTask>(),
            scheduledTasksByTaskId: new Map<TaskId, ScheduledTask>(),
            scheduledTaskEntriesById: new Map<ScheduledTaskEntryId, ScheduledTaskEntry>()
        };

        for (const collectedMetric of schedule.collectedMetrics) {
            schedule.collectedMetricsByMetricId.set(collectedMetric.metricId, collectedMetric);
        }

        for (const scheduledTask of schedule.scheduledTasks) {
            schedule.scheduledTasksById.set(scheduledTask.id, scheduledTask)
            schedule.scheduledTasksByTaskId.set(scheduledTask.taskId, scheduledTask);

            for (const scheduledTaskEntry of scheduledTask.entries) {
                schedule.scheduledTaskEntriesById.set(scheduledTaskEntry.id, scheduledTaskEntry);
            }
        }

        return schedule;
    }

    private static dbScheduledTaskDoneStatusToScheduledTaskDoneStatus(scheduledTaskDoneStatusRow: any): ScheduledTaskDoneStatus {
        switch (scheduledTaskDoneStatusRow.type) {
            case TaskDoneType.BOOLEAN:
                return {
                    type: TaskDoneType.BOOLEAN,
                    boolean: Handler.dbBooleanStatusToBooleanStatus(scheduledTaskDoneStatusRow.boolean)
                };
            case TaskDoneType.SUBTASKS:
                return {
                    type: TaskDoneType.SUBTASKS,
                    subtasks: Handler.dbSubtasksStatusToSubtasksStatus(scheduledTaskDoneStatusRow.subtasks)
                };
            case TaskDoneType.COUNTER:
                return {
                    type: TaskDoneType.COUNTER,
                    counter: Handler.dbCounterStatusToCounterStatus(scheduledTaskDoneStatusRow.counter)
                };
            case TaskDoneType.GAUGE:
                return {
                    type: TaskDoneType.GAUGE,
                    gauge: Handler.dbGaugeStatusToGaugeStatus(scheduledTaskDoneStatusRow.gauge)
                };
            default:
                throw new CriticalServiceError(`Invalid task done type ${scheduledTaskDoneStatusRow.type}`);
        }
    }

    private static dbBooleanStatusToBooleanStatus(booleanStatusRow: any): BooleanStatus {
        return {
            isDone: booleanStatusRow.isDone
        };
    }

    private static dbSubtasksStatusToSubtasksStatus(substasksStatusRow: any): SubtasksStatus {
        return {
            doneSubTasks: new Set<SubTaskId>(substasksStatusRow.doneSubtasks)
        };
    }

    private static dbCounterStatusToCounterStatus(counterStatusRow: any): CounterStatus {
        return {
            currentValue: counterStatusRow.currentValue
        };
    }

    private static dbGaugeStatusToGaugeStatus(gaugeStatusRow: any): GaugeStatus {
        return {
            currentValue: gaugeStatusRow.currentValue
        };
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
                            inProgress: ste.inProgress,
                            isDone: ste.isDone,
                            doneStatus: Handler.scheduledTaskDoneStatusToDbScheduledTaskDoneStatus(ste.doneStatus),
                            repeatScheduleAt: ste.repeatScheduleAt.unix()
                        };
                    })
                };
            }),
            idSerialHack: schedule.idSerialHack
        };
    }

    private static scheduledTaskDoneStatusToDbScheduledTaskDoneStatus(scheduledTaskDoneStatus: ScheduledTaskDoneStatus): any {
        switch (scheduledTaskDoneStatus.type) {
            case TaskDoneType.BOOLEAN:
                return {
                    type: TaskDoneType.BOOLEAN,
                    boolean: Handler.booleanStatusToDbBooleanStatus(scheduledTaskDoneStatus.boolean as BooleanStatus)
                };
            case TaskDoneType.SUBTASKS:
                return {
                    type: TaskDoneType.SUBTASKS,
                    subtasks: Handler.subtasksStatusToDbSubtasksStatus(scheduledTaskDoneStatus.subtasks as SubtasksStatus)
                };
            case TaskDoneType.COUNTER:
                return {
                    type: TaskDoneType.COUNTER,
                    counter: Handler.counterStatusToDbCounterStatus(scheduledTaskDoneStatus.counter as CounterStatus)
                };
            case TaskDoneType.GAUGE:
                return {
                    type: TaskDoneType.GAUGE,
                    gauge: Handler.gaugeStatusToDbGaugeStatus(scheduledTaskDoneStatus.gauge as GaugeStatus)
                };
        }
    }

    private static booleanStatusToDbBooleanStatus(booleanStatus: BooleanStatus): any {
        return {
            isDone: booleanStatus.isDone
        };
    }

    private static subtasksStatusToDbSubtasksStatus(subtasksStatus: SubtasksStatus): any {
        return {
            doneSubtasks: new Array<SubTaskId>(...subtasksStatus.doneSubTasks)
        }
    }

    private static counterStatusToDbCounterStatus(counterStatus: CounterStatus): any {
        return {
            currentValue: counterStatus.currentValue
        };
    }

    private static gaugeStatusToDbGaugeStatus(gaugeStatus: GaugeStatus): any {
        return {
            currentValue: gaugeStatus.currentValue
        };
    }

    private static async getEmptyFullUser(email: string, password: string): Promise<FullUser> {
        return new Promise<FullUser>((resolve, reject) => {
            bcrypt.hash(password, Handler.BCRYPT_ROUNDS, (err, passwordHash) => {

                if (err) {
                    return reject(new ServiceError(`Crypto error ${err.message}`));
                }

                const newFullUser = {
                    user: {
                        id: -1,
                        email: email,
                        passwordHash: passwordHash,
                        isArchived: false,
                        vacations: [],
                        idSerialHack: 1,
                        vacationsById: new Map<VacationId, Vacation>()
                    },
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
                            subgoalsById: new Map<GoalId, Goal>(),
                            subgoalsOrder: [],
                            metrics: [],
                            metricsById: new Map<MetricId, Metric>(),
                            metricsOrder: [],
                            tasks: [],
                            tasksById: new Map<TaskId, Task>(),
                            tasksOrder: [],
                            boards: [],
                            isSuspended: false,
                            isDone: false,
                            isArchived: false
                        }],
                        goalsOrder: [1],
                        isSuspended: false,
                        idSerialHack: 1,
                        inboxGoalId: 1,
                        goalsById: new Map<GoalId, Goal>(),
                        metricsById: new Map<MetricId, Metric>(),
                        tasksById: new Map<TaskId, Task>(),
                        subTasksById: new Map<SubTaskId, SubTask>()
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
                        collectedMetricsByMetricId: new Map<MetricId, CollectedMetric>(),
                        scheduledTasksById: new Map<ScheduledTaskId, ScheduledTask>(),
                        scheduledTasksByTaskId: new Map<TaskId, ScheduledTask>(),
                        scheduledTaskEntriesById: new Map<ScheduledTaskEntryId, ScheduledTaskEntry>()
                    }
                };
                newFullUser.plan.goalsById.set(1, newFullUser.plan.goals[0]);

                resolve(newFullUser);
            });
        });
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

    private static getVacationById(user: User, id: VacationId, allowArchived: boolean = false) {
        const vacation = user.vacationsById.get(id);

        if (vacation === undefined) {
            throw new CriticalServiceError(`Vacation with id ${id} does not exist`);
        } else if (vacation.isArchived && !allowArchived) {
            throw new ServiceError(`Vacation with id ${id} cannot be operated upon since it is archived`);
        }

        return vacation;
    }

    private static getGoalById(plan: Plan, id: GoalId, allowDone: boolean = false, allowArchived: boolean = false): Goal {
        const goal = plan.goalsById.get(id);

        if (goal === undefined) {
            throw new CriticalServiceError(`Goal with id ${id} does not exist`);
        } else if (goal.isArchived && !allowArchived) {
            throw new ServiceError(`Goal with id ${id} cannot be operated upon since it is archived`);
        } else if (goal.isDone && !allowDone) {
            throw new ServiceError(`Goal with id ${id} cannot be operated upon since it is done`);
        }

        return goal;
    }

    private static getMetricById(plan: Plan, id: MetricId, allowArchived: boolean = false): Metric {
        const metric = plan.metricsById.get(id);

        if (metric === undefined) {
            throw new CriticalServiceError(`Metric with ${id} does not exist`);
        } else if (metric.isArchived && !allowArchived) {
            throw new ServiceError(`Metric with id ${id} cannot be operated upon since it is archived`);
        }

        return metric;
    }

    private static getTaskById(plan: Plan, id: TaskId, allowArchived: boolean = false): Task {
        const task = plan.tasksById.get(id);

        if (task === undefined) {
            throw new CriticalServiceError(`Task with id ${id} does not exist`);
        } else if (task.isArchived && !allowArchived) {
            throw new ServiceError(`Task with id ${id} cannot be operated upon since it is archived`);
        }

        return task;
    }

    private static getSubTaskById(plan: Plan, id: SubTaskId, allowdArchived: boolean = false): SubTask {
        const subTask = plan.subTasksById.get(id);

        if (subTask === undefined) {
            throw new CriticalServiceError(`Subtask with id ${id} does not exist`);
        } else if (subTask.isArchived && !allowdArchived) {
            throw new ServiceError(`Subtask with id ${id} cannot be operated upon since it is archived`);
        }

        return subTask;
    }

    private static getScheduledTaskById(schedule: Schedule, id: ScheduledTaskId): ScheduledTask {
        const scheduledTask = schedule.scheduledTasksById.get(id);

        if (scheduledTask === undefined) {
            throw new CriticalServiceError(`Scheduled task for task with id ${id} does not exist`);
        }

        return scheduledTask;
    }

    private static getScheduledTaskByTaskId(schedule: Schedule, taskId: TaskId): ScheduledTask {
        const scheduledTask = schedule.scheduledTasksByTaskId.get(taskId);

        if (scheduledTask === undefined) {
            throw new CriticalServiceError(`Scheduled task for task with id ${taskId} does not exist`);
        }

        return scheduledTask;
    }

    private static getScheduledTaskEntryById(schedule: Schedule, id: ScheduledTaskId): ScheduledTaskEntry {
        const scheduledTaskEntry = schedule.scheduledTaskEntriesById.get(id);

        if (scheduledTaskEntry === undefined) {
            throw new CriticalServiceError(`Scheduled task entry with id ${id} does not exist`);
        }

        return scheduledTaskEntry;
    }

    private static getCurrentActiveScheduledTaskEntry(schedule: Schedule, task: Task): ScheduledTaskEntry {
        const scheduledTask = Handler.getScheduledTaskByTaskId(schedule, task.id);
        // Assume it's the last entry and we are up to date!
        return scheduledTask.entries[scheduledTask.entries.length - 1];
    }
}

type RequestHandler<Req, Res> = (ctx: Context, req: Req) => Promise<Res>;

function needsAuth<Req, Res>(_target: Object, _propertyKey: string, descriptor: TypedPropertyDescriptor<RequestHandler<Req, Res>>): TypedPropertyDescriptor<RequestHandler<Req, Res>> {
    const originalMethod = descriptor.value;

    descriptor.value = async function (ctx: Context, req: Req) {

        const userId = await new Promise<number>((resolve, reject) => {
            jwt.verify(ctx.auth.token, Handler.AUTH_TOKEN_ENCRYPTION_KEY, (err, jwtDecoded) => {
                if (err) {
                    return reject(new ServiceError(`Invalid auth token`));
                }

                resolve((jwtDecoded as any).id as number);
            });
        });

        const newCtx = {
            auth: ctx.auth,
            userId: userId
        };

        return await (originalMethod as any).call(this, newCtx, req);
    };

    return descriptor;
}

export interface Context {
    auth: AuthInfo;
    userId: number;
}

export interface AuthInfo {
    token: string;
}

export interface GetOrCreateUserRequest {
    email: string;
    password: string;
}

export interface GetOrCreateUserResponse {
    auth: AuthInfo;
    user: User;
}

export interface GetUserRequest {
}

export interface GetUserResponse {
    user: User;
}

export interface ArchiveUserRequest {
}

export interface ArchiveUserResponse {
}

export interface CreateVacationRequest {
    startTime: moment.Moment;
    endTime: moment.Moment;
}

export interface CreateVacationResponse {
    user: User;
}

export interface UpdateVacationRequest {
    vacationId: VacationId;
    startTime?: moment.Moment;
    endTime?: moment.Moment;
}

export interface UpdateVacationResponse {
    user: User;
}

export interface ArchiveVacationRequest {
    vacationId: VacationId;
}

export interface ArchiveVacationResponse {
    user: User;
}

export interface GetLatestPlanRequest {
}

export interface GetLatestPlanResponse {
    plan: Plan;
}

export interface UpdatePlanRequest {
    isSuspended?: boolean;
}

export interface UpdatePlanResponse {
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
    goalId: GoalId;
    moveToToplevel?: boolean;
    parentGoalId?: GoalId;
    position?: number;
}

export interface MoveGoalResponse {
    plan: Plan;
}

export interface UpdateGoalRequest {
    goalId: GoalId;
    title?: string;
    description?: string;
    range?: GoalRange;
    isSuspended?: boolean;
}

export interface UpdateGoalResponse {
    plan: Plan;
}

export interface MarkGoalAsDoneRequest {
    goalId: GoalId;
}

export interface MarkGoalAsDoneResponse {
    plan: Plan;
}

export interface ArchiveGoalRequest {
    goalId: GoalId;
}

export interface ArchiveGoalResponse {
    plan: Plan;
}

export interface CreateMetricRequest {
    goalId?: GoalId;
    title: string;
    description?: string;
    isCounter: boolean;
}

export interface CreateMetricResponse {
    plan: Plan;
}

export interface MoveMetricRequest {
    metricId: MetricId;
    goalId?: GoalId;
    position?: number;
}

export interface MoveMetricResponse {
    plan: Plan;
}

export interface UpdateMetricRequest {
    metricId: MetricId;
    title?: string;
    description?: string;
}

export interface UpdateMetricResponse {
    plan: Plan;
}

export interface ArchiveMetricRequest {
    metricId: MetricId;
}

export interface ArchiveMetricResponse {
    plan: Plan;
}

export interface CreateTaskRequest {
    goalId?: GoalId;
    title: string;
    description?: string;
    priority: TaskPriority;
    urgency: TaskUrgency;
    deadline?: moment.Moment,
    repeatSchedule?: TaskRepeatSchedule;
    reminderPolicy: TaskReminderPolicy;
    donePolicy: {
        type: TaskDoneType;
        counter?: {
            type: CounterPolicyType;
            lowerLimit: number;
            upperLimit?: number;
        };
        gauge?: {
            type: GaugePolicyType;
            lowerLimit: number;
            upperLimit?: number;
        }
    }
}

export interface CreateTaskResponse {
    plan: Plan;
}

export interface MoveTaskRequest {
    taskId: TaskId;
    goalId?: GoalId;
    position?: number;
}

export interface MoveTaskResponse {
    plan: Plan;
}

export interface UpdateTaskRequest {
    taskId: TaskId;
    title?: string;
    description?: string;
    priority?: TaskPriority;
    urgency?: TaskUrgency;
    deadline?: moment.Moment;
    clearDeadline?: boolean;
    repeatSchedule?: TaskRepeatSchedule;
    reminderPolicy?: TaskReminderPolicy;
    clearRepeatSchedule?: boolean;
    isSuspended?: boolean;
    counterPolicy?: CounterPolicy;
    gaugePolicy?: GaugePolicy;
}

export interface UpdateTaskResponse {
    plan: Plan;
}

export interface ArchiveTaskRequest {
    taskId: TaskId;
}

export interface ArchiveTaskResponse {
    plan: Plan;
}

export interface CreateSubTaskRequest {
    taskId: TaskId;
    title: string;
    parentSubTaskId?: SubTaskId;
}

export interface CreateSubTaskResponse {
    plan: Plan;
}

export interface MoveSubTaskRequest {
    subTaskId: SubTaskId;
    moveToTopLevel?: boolean;
    parentSubTaskId?: SubTaskId;
    position?: number;
}

export interface MoveSubTaskResponse {
    plan: Plan;
}

export interface UpdateSubTaskRequest {
    subTaskId: SubTaskId;
    title?: string;
}

export interface UpdateSubTaskResponse {
    plan: Plan;
}

export interface ArchiveSubTaskRequest {
    subTaskId: SubTaskId;
}

export interface ArchiveSubTaskResponse {
    plan: Plan;
}

export interface GetLatestScheduleRequest {
}

export interface GetLatestScheduleResponse {
    plan: Plan;
    schedule: Schedule;
}

export interface IncrementMetricRequest {
    metricId: MetricId;
}

export interface IncrementMetricResponse {
    plan: Plan;
    schedule: Schedule;
}

export interface RecordForMetricRequest {
    metricId: MetricId;
    value: number;
}

export interface RecordForMetricResponse {
    plan: Plan;
    schedule: Schedule;
}

export interface UpdateScheduledTaskEntryRequest {
    scheduledTaskEntryId: number;
    inProgress?: boolean;
}

export interface UpdateScheduledTaskEntryResponse {
    plan: Plan;
    schedule: Schedule;
}

export interface MarkTaskAsDoneRequest {
    scheduledTaskEntryId: ScheduledTaskEntryId;
}

export interface MarkTaskAsDoneResponse {
    plan: Plan;
    schedule: Schedule;
}

export interface MarkSubTaskAsDoneRequest {
    scheduledTaskEntryId: ScheduledTaskEntryId;
    subTaskId: SubTaskId;
}

export interface MarkSubTaskAsDoneResponse {
    plan: Plan;
    schedule: Schedule;
}

export interface IncrementCounterTaskRequest {
    scheduledTaskEntryId: ScheduledTaskEntryId;
    increment?: number;
}

export interface IncrementCounterTaskResponse {
    plan: Plan;
    schedule: Schedule;
}

export interface SetGaugeTaskRequest {
    scheduledTaskEntryId: ScheduledTaskEntryId;
    level: number;
}

export interface SetGaugeTaskResponse {
    plan: Plan;
    schedule: Schedule;
}

enum WhatToSave {
    NONE = "none",
    USER = "user",
    SCHEDULE = "schedule",
    PLAN_AND_SCHEDULE = "plan-and-schedule"
}

interface FullUser {
    user: User;
    plan: Plan;
    schedule: Schedule;
}