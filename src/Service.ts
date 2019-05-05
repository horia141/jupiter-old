import * as moment from "moment";
import * as knex from "knex";
import {Transaction} from "knex";

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
        "schedule",
        "plan_id"
    ];

    public constructor(
        private readonly conn: knex) {

    }

    public async init(): Promise<void> {
        await this.createPlanIfDoesNotExist();
    }

    public async getLatestPlan(): Promise<GetLatestPlanResponse> {
        const planRows = await this.conn
            .from(Service.PLAN_TABLE)
            .select(Service.PLAN_FIELDS)
            .orderBy("version_major", "desc")
            .orderBy("version_minor", "desc")
            .where("user_id", Service.DEFAULT_USER_ID)
            .limit(1);

        if (planRows.length === 0) {
            throw new ServiceError(`No plan for user ${Service.DEFAULT_USER_ID}`);
        }

        const planRow = planRows[0];
        const plan = Service.dbPlanToPlan(planRow);

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
            const planRows = await trx
                .from(Service.PLAN_TABLE)
                .select(Service.PLAN_FIELDS)
                .orderBy("version_major", "desc")
                .orderBy("version_minor", "desc")
                .where("user_id", Service.DEFAULT_USER_ID)
                .limit(1);

            if (planRows.length === 0) {
                throw new ServiceError(`No plan for user ${Service.DEFAULT_USER_ID}`);
            }

            const planRow = planRows[0];
            const plan = Service.dbPlanToPlan(planRow);

            plan.goals.push(newGoal);
            plan.version.minor++;

            await trx
                .from(Service.PLAN_TABLE)
                .insert({
                    version_major: plan.version.major,
                    version_minor: plan.version.minor,
                    plan: plan,
                    user_id: Service.DEFAULT_USER_ID
                });

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
            const planRows= await trx
                .from(Service.PLAN_TABLE)
                .select(Service.PLAN_FIELDS)
                .where("user_id", Service.DEFAULT_USER_ID)
                .limit(1);

            if (planRows.length === 0) {
                const initialPlan = Service.getEmptyPlan();

                await trx
                    .from(Service.PLAN_TABLE)
                    .insert({
                        version_major: initialPlan.version.major,
                        version_minor: initialPlan.version.minor,
                        plan: initialPlan,
                        user_id: Service.DEFAULT_USER_ID
                    });
            }
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

export interface Plan {
    version: PlanVersion;
    goals: Goal[];
}

export interface PlanVersion {
    major: number;
    minor: number;
}

export interface Goal {
    title: string;
    description: string;
    range: GoalRange;
    deadline?: moment.Moment;
    subgoals: Goal[];
    metrics: Metric[];
    tasks: Task[];
    boards: Board[];
    canBeRemoved: boolean;
}

export enum GoalRange {
    LIFETIME = "lifetime",
    FIVE_YEARS = "five-years",
    YEAR = "year",
    QUARTER = "quarter",
    MONTH = "month"
}


export interface Metric {
    title: string;
    type: MetricType;
}

export enum MetricType {
    COUNTER = "counter",
    GAUGE = "gauge"
}

export interface Task {
    title: string;
    description: string;
    priority: TaskPriority;
    deadline?: moment.Moment;
    schedule?: any;
    reminderPolicy?: any;
    subtasks?: SubTask[];
    donePolicy?: any;
    inProgress: boolean;
}

export enum TaskPriority {
    NORMAL = "normal",
    HIGH = "high"
}

export interface SubTask {
    title: string;
    subtasks: SubTask[];
}

export interface Board {
    title: string;
}

export interface Schedule {
    tasks: ScheduledTask[];
    metrics: CollectedMetric[];
}

export interface ScheduledTask {

}

export interface CollectedMetric {

}
