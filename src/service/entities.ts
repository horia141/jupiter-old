import * as moment from "moment";

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