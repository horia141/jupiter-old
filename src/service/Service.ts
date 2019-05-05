import * as knex from "knex";
import {Transaction} from "knex";
import {GoalRange, Plan} from "./entities";

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

        const newGoal = {
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

            await this.dbSavePlan(trx, Service.DEFAULT_USER_ID, plan);

            return plan;
        });

        return {
            plan: newPlan
        };
    }

    public createMetric(): void {

    }

    public createTask(): void {

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
                plan: plan,
                user_id: userId
            });
    }

    private static dbPlanToPlan(planRow: any): Plan {
        // TODO(horia141): Proper deserialization here!
        return planRow["plan"];
    }

    private static getEmptyPlan(): Plan {
        return {
            version: {
                major: 1,
                minor: 1
            },
            goals: []
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


