import * as knex from "knex";
import {Transaction} from "knex";

import {CollectedMetric, Goal, GoalRange, Metric, MetricType, Plan, Schedule, Task, TaskPriority} from "./entities";

export class ServiceError extends Error {

    public constructor(message: string) {
        super(message);
    }
}

export class Service {

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
            canBeRemoved: true
        };

        const newPlanAndSchedule = await this.dbModifyPlanAndSchedule((planAndSchedule) => {
            planAndSchedule.plan.goals.push(newGoal);
            planAndSchedule.plan.version.minor++;
            planAndSchedule.plan.idSerialHack++;
            newGoal.id = planAndSchedule.plan.idSerialHack;
            planAndSchedule.plan.goalsById.set(newGoal.id, newGoal);

            planAndSchedule.schedule.version.minor++;

            return planAndSchedule;
        });

        return {
            plan: newPlanAndSchedule.plan
        };
    }

    public async createMetric(req: CreateMetricRequest): Promise<CreateMetricResponse> {

        const newMetric: Metric = {
            id: -1,
            title: req.title,
            type: MetricType.COUNTER
        };

        const newCollectedMetric: CollectedMetric = {
            id: -1,
            metricId: -1,
            samples: []
        };

        const newPlanAndSchedule = await this.dbModifyPlanAndSchedule(planAndSchedule => {
            const goal = planAndSchedule.plan.goalsById.get(req.goalId);

            if (goal === undefined) {
                throw new ServiceError(`Goal with id ${req.goalId} does not exist for user ${Service.DEFAULT_USER_ID}`);
            }

            goal.metrics.push(newMetric);
            planAndSchedule.plan.version.minor++;
            planAndSchedule.plan.idSerialHack++;
            newMetric.id = planAndSchedule.plan.idSerialHack;

            planAndSchedule.schedule.collectedMetrics.push(newCollectedMetric);
            planAndSchedule.schedule.version.minor++;
            planAndSchedule.schedule.idSerialHack++;
            newCollectedMetric.id = planAndSchedule.schedule.idSerialHack;
            newCollectedMetric.metricId = newMetric.id;

            return planAndSchedule;
        });

        return {
            plan: newPlanAndSchedule.plan
        };
    }

    public async createTask(req: CreateTaskRequest): Promise<CreateTaskResponse> {

        const newTask: Task = {
            id: -1,
            title: req.title,
            priority: TaskPriority.NORMAL,
            inProgress: false
        };

        const newPlanAndSchedule = await this.dbModifyPlanAndSchedule(planAndSchedule => {
            const goal = planAndSchedule.plan.goalsById.get(req.goalId);

            if (goal === undefined) {
                throw new ServiceError(`Goal with id ${req.goalId} does not exist for user ${Service.DEFAULT_USER_ID}`);
            }

            goal.tasks.push(newTask);
            planAndSchedule.plan.version.minor++;
            planAndSchedule.plan.idSerialHack++;
            newTask.id = planAndSchedule.plan.idSerialHack;

            planAndSchedule.schedule.version.minor++;

            return planAndSchedule;
        });

        return {
            plan: newPlanAndSchedule.plan
        };
    }

    public markGoalAsDone(): void {
    }

    public recordForMetric(): void {

    }

    public markTaskAsDone(): void {

    }

    public async getLatestSchedule(): Promise<GetLatestScheduleResponse> {
        const planAndSchedule = await this.dbGetLatestPlanAndSchedule();

        return {
            schedule: planAndSchedule.schedule
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

    private async dbModifyPlanAndSchedule(action: (planAndSchedule: PlanAndSchedule) => PlanAndSchedule): Promise<PlanAndSchedule> {
        return await this.conn.transaction(async (trx: Transaction) => {
            const plan = await this.dbGetLatestPlan(trx, Service.DEFAULT_USER_ID);
            const schedule = await this.dbGetLatestSchedule(trx, Service.DEFAULT_USER_ID, plan.id);

            const newPlanAndSchedule = action({plan: plan, schedule: schedule});

            const newSavedPlan = await this.dbSavePlan(trx, Service.DEFAULT_USER_ID, newPlanAndSchedule.plan);
            const newSavedSchedule = await this.dbSaveSchedule(trx, Service.DEFAULT_USER_ID, newSavedPlan.id, newPlanAndSchedule.schedule);

            return {
                plan: newSavedPlan,
                schedule: newSavedSchedule
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

        const plan = {
            id: planRow["id"],
            version: dbPlan.version,
            goals: dbPlan.goals,
            idSerialHack: dbPlan.idSerialHack,
            goalsById: new Map<number, Goal>()
        };

        // TODO(horia141): deal with subgoals here!
        for (const [, goal] of plan.goals.entries()) {
            plan.goalsById.set(goal.id, goal);
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

        const schedule = {
            id: scheduleRow["id"],
            version: dbSchedule.version,
            collectedMetrics: dbSchedule.collectedMetrics,
            tasks: dbSchedule.tasks,
            idSerialHack: dbSchedule.idSerialHack
        };

        return schedule;
    }

    private static scheduleToDbSchedule(schedule: Schedule): any {
        return {
            version: schedule.version,
            collectedMetrics: schedule.collectedMetrics,
            tasks: schedule.tasks,
            idSerialHack: schedule.idSerialHack
        };
    }

    private static getEmptyPlanAndSchedule(): PlanAndSchedule {
        return {
            plan: {
                id: -1,
                version: {
                    major: 1,
                    minor: 1
                },
                goals: [],
                idSerialHack: 0,
                goalsById: new Map<number, Goal>()
            },
            schedule: {
                id: -1,
                version: {
                    major: 1,
                    minor: 1
                },
                tasks: [],
                collectedMetrics: [],
                idSerialHack: 0
            }
        };
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

export interface CreateMetricRequest {
    goalId: number;
    title: string;
}

export interface CreateMetricResponse {
    plan: Plan;
}

export interface CreateTaskRequest {
    goalId: number;
    title: string;
}

export interface CreateTaskResponse {
    plan: Plan;
}

export interface GetLatestScheduleResponse {
    schedule: Schedule;
}

interface PlanAndSchedule {
    plan: Plan;
    schedule: Schedule;
}