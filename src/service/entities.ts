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
    tasksById: Map<number, Task>;
}

export interface Goal {
    id: number;
    parentGoalId?: number;
    title: string;
    description?: string;
    range: GoalRange;
    deadline?: moment.Moment;
    subgoals: Goal[];
    metrics: Metric[];
    tasks: Task[];
    boards: Board[];
    canBeMarkedAsDone: boolean;
    isDone: boolean;
    canBeArchived: boolean;
    isArchived: boolean;
}

export enum GoalRange {
    LIFETIME = "lifetime",
    FIVE_YEARS = "five-years",
    YEAR = "year",
    QUARTER = "quarter",
    MONTH = "month"
}

export function getGoalRange(): Array<GoalRange> {
    return [GoalRange.LIFETIME, GoalRange.FIVE_YEARS, GoalRange.YEAR, GoalRange.QUARTER, GoalRange.MONTH];
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
    goalId: number;
    title: string;
    description?: string;
    priority: TaskPriority;
    deadline?: moment.Moment;
    repeatSchedule?: TaskRepeatSchedule;
    reminderPolicy?: any;
    subtasks: SubTask[];
    donePolicy?: any;
    inProgress: boolean;
}

export enum TaskPriority {
    NORMAL = "normal",
    HIGH = "high"
}

export enum TaskRepeatSchedule {
    YEARLY = "yearly",
    QUARTERLY = "quarterly",
    MONTHLY = "monthly",
    WEEKLY = "weekly",
    DAILY = "daily"
}

export function getTaskRepeatSchedule(): Array<TaskRepeatSchedule> {
    return [TaskRepeatSchedule.DAILY, TaskRepeatSchedule.WEEKLY, TaskRepeatSchedule.MONTHLY, TaskRepeatSchedule.QUARTERLY, TaskRepeatSchedule.YEARLY];
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
    scheduledTasks: ScheduledTask[];
    idSerialHack: number;
    collectedMetricsByMetricId: Map<number, CollectedMetric>;
    scheduledTasksByTaskId: Map<number, ScheduledTask>;
}

export interface CollectedMetric {
    id: number;
    metricId: number;
    entries: CollectedMetricEntry[];
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
    entries: ScheduledTaskEntry[];
}

export interface ScheduledTaskEntry {
    id: number;
    scheduledTaskId: number;
    isDone: boolean;
    repeatScheduleAt: moment.Moment;
}