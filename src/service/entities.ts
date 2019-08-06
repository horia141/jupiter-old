import * as moment from "moment";

export type UserId = number;
export type VacationId = number;
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

export interface User {
    id: UserId;
    email: string;
    passwordHash: string;
    isArchived: boolean;
    vacations: Vacation[];
    idSerialHack: number;
    vacationsById: Map<VacationId, Vacation>;
}

export interface Vacation {
    id: VacationId;
    startTime: moment.Moment;
    endTime: moment.Moment;
    isArchived: boolean;
}

export interface Plan {
    id: PlanId;
    version: Version;
    goals: Goal[];
    goalsOrder: GoalId[];
    isSuspended: boolean;
    idSerialHack: number;
    inboxGoalId: number;
    goalsById: Map<GoalId, Goal>;
    metricsById: Map<MetricId, Metric>;
    tasksById: Map<TaskId, Task>;
    subTasksById: Map<SubTaskId, SubTask>;
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
    subgoalsById: Map<GoalId, Goal>;
    subgoalsOrder: GoalId[];
    metrics: Metric[];
    metricsById: Map<MetricId, Metric>;
    metricsOrder: MetricId[];
    tasks: Task[];
    tasksById: Map<TaskId, Task>;
    tasksOrder: TaskId[];
    boards: Board[];
    isSuspended: boolean;
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
    urgency: TaskUrgency;
    deadline?: moment.Moment;
    repeatSchedule?: TaskRepeatSchedule;
    reminderPolicy: TaskReminderPolicy;
    donePolicy: TaskDonePolicy;
    isSuspended: boolean;
    isArchived: boolean;
}

export enum TaskPriority {
    HIGH = "high",
    NORMAL = "normal"
}

export function getTaskPriority(): Array<TaskPriority> {
    return [TaskPriority.NORMAL, TaskPriority.HIGH];
}

export enum TaskUrgency {
    CRITICAL = "critical",
    REGULAR = "regular"
}

export function getTaskUrgency(): Array<TaskUrgency> {
    return [TaskUrgency.CRITICAL, TaskUrgency.REGULAR];
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

export enum TaskReminderPolicy {
    QUARTER_BEFORE = "quarter-before",
    MONTH_BEFORE = "month-before",
    WEEK_BEFORE = "week-before",
    DAY_BEFORE = "day-before"
}

export function getTaskReminderPolicy(): Array<TaskReminderPolicy> {
    return [TaskReminderPolicy.QUARTER_BEFORE, TaskReminderPolicy.MONTH_BEFORE, TaskReminderPolicy.WEEK_BEFORE, TaskReminderPolicy.DAY_BEFORE];
}

export interface TaskDonePolicy {
    type: TaskDonePolicyType;
    boolean?: BooleanPolicy;
    subtasks?: SubtasksPolicy;
    counter?: CounterPolicy;
    gauge?: GaugePolicy;
}

export enum TaskDonePolicyType {
    BOOLEAN = "boolean",
    SUBTASKS = "subtasks",
    COUNTER = "counter",
    GAUGE = "gauge"
}

export function getTaskDonePolicyType(): Array<TaskDonePolicyType> {
    return [TaskDonePolicyType.BOOLEAN, TaskDonePolicyType.SUBTASKS, TaskDonePolicyType.COUNTER, TaskDonePolicyType.GAUGE];
}

export interface BooleanPolicy {
}

export interface SubtasksPolicy {
    subTasks: SubTask[];
    subTasksOrder: SubTaskId[];
    subTasksById: Map<SubTaskId, SubTask>;
}

export interface CounterPolicy {
    type: CounterPolicyType;
    lowerLimit?: number;
    upperLimit?: number;
}

export enum CounterPolicyType {
    EXACTLY = "exactly",
    AT_MOST = "at-most",
    AT_LEAST = "at-least",
    BETWEEN = "between"
}

export interface GaugePolicy {
    type: GaugePolicyType;
    lowerLimit?: number;
    upperLimit?: number;
}

export enum GaugePolicyType {
    EXACTLY = "exactly",
    AT_MOST = "at-most",
    AT_LEAST = "at-least",
    BETWEEN = "between"
}

export interface SubTask {
    id: SubTaskId;
    taskId: TaskId;
    parentSubTaskId?: SubTaskId;
    title: string;
    subTasks: SubTask[];
    subTasksById: Map<SubTaskId, SubTask>;
    subTasksOrder: SubTaskId[];
    isArchived: boolean;
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
    scheduledTaskEntriesById: Map<ScheduledTaskEntryId, ScheduledTaskEntry>;
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
    inProgress: boolean;
    isDone: boolean;
    repeatScheduleAt: moment.Moment;
}