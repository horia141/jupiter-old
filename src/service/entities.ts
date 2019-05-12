import * as moment from "moment";

export interface Version {
    major: number;
    minor: number;
}

export interface Plan {
    id: number;
    version: Version;
    goals: Goal[];
    idSerialHack: number;
    goalsById: Map<number, Goal>;
    metricsById: Map<number, Metric>;
}

export interface Goal {
    id: number;
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
    id: number;
    goalId: number;
    title: string;
    type: MetricType;
}

export enum MetricType {
    COUNTER = "counter",
    GAUGE = "gauge"
}

export interface Task {
    id: number;
    title: string;
    priority: TaskPriority;
    description?: string;
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
    id: number;
    title: string;
    subtasks: SubTask[];
}

export interface Board {
    id: number;
    title: string;
}

export interface Schedule {
    id: number;
    version: Version;
    collectedMetrics: CollectedMetric[];
    tasks: ScheduledTask[];
    idSerialHack: number;
    collectedMetricsByMetricId: Map<number, CollectedMetric>;
}

export interface CollectedMetric {
    id: number;
    metricId: number;
    samples: CollectedMetricEntry[];
}

export interface CollectedMetricEntry {
    id: number;
    collectedMetricId: number;
    timestamp: moment.Moment;
    value: number;
}

export interface ScheduledTask {
    id: number;
    taskId: number;
}