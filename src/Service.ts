import * as moment from "moment";

export class Service {

    public createPlan(): void {

    }

    public async getLatestPlan(): Promise<GetLatestPlanResponse> {
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
                }]
            }
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