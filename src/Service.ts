import * as moment from "moment";
import * as knex from "knex";
import {Transaction} from "knex";

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

    static getEmptyPlan(): Plan {
        return {
            version: {
                major: 1,
                minor: 1
            },
            goals: []
        };
    }

    public async getLatestPlan(): Promise<GetLatestPlanResponse> {
        await this.conn.transaction(async (trx: Transaction) => {
            const planRows= await trx
                .from(Service.PLAN_TABLE)
                .select(Service.PLAN_FIELDS)
                .orderBy("version_major", "desc")
                .orderBy("version_minor", "desc")
                .where("user_id", Service.DEFAULT_USER_ID)
                .limit(1);

            if (planRows.length === 0) {
                console.log("this");
            } else {
                console.log("that");
            }
        });

        return {
            plan: Service.getEmptyPlan()
        };
    }

    public async createGoal(req: CreateGoalRequest): Promise<CreateGoalResponse> {
        return {
            plan: {
                version: {
                    major: 1,
                    minor: 10
                },
                goals: [{
                    title: "Buy a boat",
                    description: "",
                    range: GoalRange.FIVE_YEARS,
                    subgoals: [],
                    metrics: [],
                    tasks: [],
                    boards: []
                }, {
                    title: req.title,
                    description: "",
                    range: GoalRange.FIVE_YEARS,
                    subgoals: [],
                    metrics: [],
                    tasks: [],
                    boards: []
                }]
            }
        }
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

    public saySomething(): void {
        console.log("Hello");
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