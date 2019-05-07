import * as knex from "knex";
import {Transaction} from "knex";
import {Goal, GoalRange, Metric, MetricType, Plan, Task, TaskPriority} from "./entities";

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

            await this.dbSavePlan(trx, Service.DEFAULT_USER_ID, plan);

            return plan;
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

            await this.dbSavePlan(trx, Service.DEFAULT_USER_ID, plan);

            return plan;
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

            await this.dbSavePlan(trx, Service.DEFAULT_USER_ID, plan);

            return plan;
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

                const initialPlan = Service.getEmptyPlan();
                await this.dbSavePlan(trx, Service.DEFAULT_USER_ID, initialPlan);
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

        const planRow = planRows[0];
        return Service.dbPlanToPlan(planRow);
    }

    private async dbSavePlan(conn: knex, userId: number, plan: Plan): Promise<void> {
        await conn
            .from(Service.PLAN_TABLE)
            .insert({
                version_major: plan.version.major,
                version_minor: plan.version.minor,
                plan: Service.planToDbPlan(plan),
                user_id: userId
            });
    }

    private static dbPlanToPlan(planRow: any): Plan {
        // TODO(horia141): Proper deserialization here!
        const dbPlan = planRow["plan"];

        const plan = {
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

    private static getEmptyPlan(): Plan {
        return {
            version: {
                major: 1,
                minor: 1
            },
            goals: [],
            idSerialHack: 0,
            goalsById: new Map<number, Goal>()
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