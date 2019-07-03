import * as moment from "moment";

export type UserId = number;
export type PlanId = number;
export type GoalId = number;
export type MetricId = number;
export type TaskId = number;
export type SubTaskId = number;
export type BoardId = number;
export type ScheduleId = number;
export type CollectedMetricId = number;
export type CollectedMetricEntryId = number;
export type ScheduledTaskId = number;
export type ScheduledTaskEntryId = number;

export interface Version {
    major: number;
    minor: number;
}

export interface Plan {
    id: PlanId;
    version: Version;
    goals: Goal[];
    goalsOrder: GoalId[];
    idSerialHack: number;
    goalsById: Map<GoalId, Goal>;
    metricsById: Map<MetricId, Metric>;
    tasksById: Map<TaskId, Task>;
}

export interface Goal {
    id: GoalId;
    parentGoalId?: GoalId;
    isSystemGoal: boolean;
    title: string;
    description?: string;
    range: GoalRange;
    deadline?: moment.Moment;
    subgoals: Goal[];
    subgoalsOrder: GoalId[];
    metrics: Metric[];
    tasks: Task[];
    boards: Board[];
    isDone: boolean;
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
    id: MetricId;
    goalId: GoalId;
    title: string;
    description?: string;
    type: MetricType;
    isArchived: boolean;
}

export enum MetricType {
    COUNTER = "counter",
    GAUGE = "gauge"
}

export interface Task {
    id: TaskId;
    goalId: GoalId;
    title: string;
    description?: string;
    priority: TaskPriority;
    deadline?: moment.Moment;
    repeatSchedule?: TaskRepeatSchedule;
    reminderPolicy?: any;
    subtasks: SubTask[];
    donePolicy?: any;
    inProgress: boolean;
    isArchived: boolean;
}

export enum TaskPriority {
    NORMAL = "normal",
    HIGH = "high"
}

export function getTaskPriority(): Array<TaskPriority> {
    return [TaskPriority.NORMAL, TaskPriority.HIGH];
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
    id: SubTaskId;
    title: string;
    subtasks: SubTask[];
}

export interface Board {
    id: BoardId;
    title: string;
}

export interface Schedule {
    id: ScheduleId;
    version: Version;
    collectedMetrics: CollectedMetric[];
    scheduledTasks: ScheduledTask[];
    idSerialHack: number;
    collectedMetricsByMetricId: Map<MetricId, CollectedMetric>;
    scheduledTasksByTaskId: Map<TaskId, ScheduledTask>;
}

export interface CollectedMetric {
    id: CollectedMetricId;
    metricId: MetricId;
    entries: CollectedMetricEntry[];
}

export interface CollectedMetricEntry {
    id: CollectedMetricEntryId;
    collectedMetricId: CollectedMetricId;
    timestamp: moment.Moment;
    value: number;
}

export interface ScheduledTask {
    id: ScheduledTaskId;
    taskId: TaskId;
    entries: ScheduledTaskEntry[];
}

export interface ScheduledTaskEntry {
    id: ScheduledTaskEntryId;
    scheduledTaskId: ScheduledTaskId;
    isDone: boolean;
    repeatScheduleAt: moment.Moment;
}