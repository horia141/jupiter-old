import * as knex from "knex";
import {Transaction} from "knex";

import {Goal, GoalRange, Metric, MetricType, Plan, Schedule, Task, TaskPriority} from "./entities";

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
        await this.createPlanIfDoesNotExist();
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

        const newPlan = await this.conn.transaction(async (trx: Transaction) => {
            const plan = await this.dbGetLatestPlan(trx, Service.DEFAULT_USER_ID);

            plan.goals.push(newGoal);
            plan.version.minor++;
            plan.idSerialHack++;
            newGoal.id = plan.idSerialHack;
            plan.goalsById.set(newGoal.id, newGoal);

            return await this.dbSavePlan(trx, Service.DEFAULT_USER_ID, plan);
        });

        return {
            plan: newPlan
        };
    }

    public async createMetric(req: CreateMetricRequest): Promise<CreateMetricResponse> {

        const newMetric: Metric = {
            id: -1,
            title: req.title,
            type: MetricType.COUNTER
        };

        const newPlan = await this.conn.transaction(async (trx: Transaction) => {
            const plan = await this.dbGetLatestPlan(trx, Service.DEFAULT_USER_ID);

            const goal = plan.goalsById.get(req.goalId);

            if (goal === undefined) {
                throw new ServiceError(`Goal with id ${req.goalId} does not exist for user ${Service.DEFAULT_USER_ID}`);
            }

            goal.metrics.push(newMetric);
            plan.version.minor++;
            plan.idSerialHack++;
            newMetric.id = plan.idSerialHack;

            return await this.dbSavePlan(trx, Service.DEFAULT_USER_ID, plan);
        });

        return {
            plan: newPlan
        };
    }

    public async createTask(req: CreateTaskRequest): Promise<CreateTaskResponse> {

        const newTask: Task = {
            id: -1,
            title: req.title,
            priority: TaskPriority.NORMAL,
            inProgress: false
        };

        const newPlan = await this.conn.transaction(async (trx: Transaction) => {
            const plan = await this.dbGetLatestPlan(trx, Service.DEFAULT_USER_ID);

            const goal = plan.goalsById.get(req.goalId);

            if (goal === undefined) {
                throw new ServiceError(`Goal with id ${req.goalId} does not exist for user ${Service.DEFAULT_USER_ID}`);
            }

            goal.tasks.push(newTask);
            plan.version.minor++;
            plan.idSerialHack++;
            newTask.id = plan.idSerialHack;

            return await this.dbSavePlan(trx, Service.DEFAULT_USER_ID, plan);
        });

        return {
            plan: newPlan
        };
    }

    public markGoalAsDone(): void {
    }

    public recordForMetric(): void {

    }

    public markTaskAsDone(): void {

    }

    private async createPlanIfDoesNotExist(): Promise<void> {
        await this.conn.transaction(async (trx: Transaction) => {
            try {
                await this.dbGetLatestPlan(trx, Service.DEFAULT_USER_ID);
            } catch (e) {
                if (!e.message.startsWith("No plan for user")) {
                    throw e;
                }

                const [initialPlan, initialSchedule] = Service.getEmptyPlanAndSchedule();
                const newPlan = await this.dbSavePlan(trx, Service.DEFAULT_USER_ID, initialPlan);
                await this.dbSaveSchedule(trx, Service.DEFAULT_USER_ID, newPlan.id, initialSchedule);
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

    public async dbGetLatestSchedule(conn: knex, userId: number, planId: number): Promise<Schedule> {
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
        for (const [_goalIdx, goal] of plan.goals.entries()) {
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
            metrics: dbSchedule.metric,
            tasks: dbSchedule.tasks,
            idSerialHack: dbSchedule.idSerialHack
        };

        return schedule;
    }

    private static scheduleToDbSchedule(schedule: Schedule): any {
        return {
            version: schedule.version,
            metrics: schedule.metrics,
            tasks: schedule.tasks
        };
    }

    private static getEmptyPlanAndSchedule(): [Plan, Schedule] {
        return [{
            id: -1,
            version: {
                major: 1,
                minor: 1
            },
            goals: [],
            idSerialHack: 0,
            goalsById: new Map<number, Goal>()
        }, {
            id: -1,
            version: {
                major: 1,
                minor: 1
            },
            tasks: [],
            metrics: [],
            idSerialHack: 0
        }];
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