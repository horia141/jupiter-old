import {
    CounterPolicy,
    CounterPolicyType,
    GaugePolicy,
    GaugePolicyType,
    GoalId,
    GoalRange,
    MetricId,
    Plan,
    Schedule,
    ScheduledTaskEntryId,
    SubTaskId,
    TaskDoneType,
    TaskId,
    TaskPriority,
    TaskReminderPolicy,
    TaskRepeatSchedule,
    TaskUrgency,
    User,
    VacationId
} from "./entities";
import * as moment from "moment";

export interface GetOrCreateUserRequest {
    email: string;
    password: string;
}

export interface GetOrCreateUserResponse {
    user: User;
}

export interface GetUserRequest {
}

export interface GetUserResponse {
    user: User;
}

export interface ArchiveUserRequest {
}

export interface ArchiveUserResponse {
}

export interface CreateVacationRequest {
    startTime: moment.Moment;
    endTime: moment.Moment;
}

export interface CreateVacationResponse {
    user: User;
}

export interface UpdateVacationRequest {
    vacationId: VacationId;
    startTime?: moment.Moment;
    endTime?: moment.Moment;
}

export interface UpdateVacationResponse {
    user: User;
}

export interface ArchiveVacationRequest {
    vacationId: VacationId;
}

export interface ArchiveVacationResponse {
    user: User;
}

export interface GetLatestPlanRequest {
}

export interface GetLatestPlanResponse {
    plan: Plan;
}

export interface UpdatePlanRequest {
    isSuspended?: boolean;
}

export interface UpdatePlanResponse {
    plan: Plan;
}

export interface CreateGoalRequest {
    title: string;
    description?: string;
    range: GoalRange;
    parentGoalId?: number;
}

export interface CreateGoalResponse {
    plan: Plan;
}

export interface MoveGoalRequest {
    goalId: GoalId;
    moveToToplevel?: boolean;
    parentGoalId?: GoalId;
    position?: number;
}

export interface MoveGoalResponse {
    plan: Plan;
}

export interface UpdateGoalRequest {
    goalId: GoalId;
    title?: string;
    description?: string;
    range?: GoalRange;
    isSuspended?: boolean;
}

export interface UpdateGoalResponse {
    plan: Plan;
}

export interface MarkGoalAsDoneRequest {
    goalId: GoalId;
}

export interface MarkGoalAsDoneResponse {
    plan: Plan;
}

export interface ArchiveGoalRequest {
    goalId: GoalId;
}

export interface ArchiveGoalResponse {
    plan: Plan;
}

export interface CreateMetricRequest {
    goalId?: GoalId;
    title: string;
    description?: string;
    isCounter: boolean;
}

export interface CreateMetricResponse {
    plan: Plan;
}

export interface MoveMetricRequest {
    metricId: MetricId;
    goalId?: GoalId;
    position?: number;
}

export interface MoveMetricResponse {
    plan: Plan;
}

export interface UpdateMetricRequest {
    metricId: MetricId;
    title?: string;
    description?: string;
}

export interface UpdateMetricResponse {
    plan: Plan;
}

export interface ArchiveMetricRequest {
    metricId: MetricId;
}

export interface ArchiveMetricResponse {
    plan: Plan;
}

export interface CreateTaskRequest {
    goalId?: GoalId;
    title: string;
    description?: string;
    priority: TaskPriority;
    urgency: TaskUrgency;
    deadline?: moment.Moment,
    repeatSchedule?: TaskRepeatSchedule;
    reminderPolicy: TaskReminderPolicy;
    donePolicy: {
        type: TaskDoneType;
        counter?: {
            type: CounterPolicyType;
            lowerLimit: number;
            upperLimit?: number;
        };
        gauge?: {
            type: GaugePolicyType;
            lowerLimit: number;
            upperLimit?: number;
        }
    }
}

export interface CreateTaskResponse {
    plan: Plan;
}

export interface MoveTaskRequest {
    taskId: TaskId;
    goalId?: GoalId;
    position?: number;
}

export interface MoveTaskResponse {
    plan: Plan;
}

export interface UpdateTaskRequest {
    taskId: TaskId;
    title?: string;
    description?: string;
    priority?: TaskPriority;
    urgency?: TaskUrgency;
    deadline?: moment.Moment;
    clearDeadline?: boolean;
    repeatSchedule?: TaskRepeatSchedule;
    reminderPolicy?: TaskReminderPolicy;
    clearRepeatSchedule?: boolean;
    isSuspended?: boolean;
    counterPolicy?: CounterPolicy;
    gaugePolicy?: GaugePolicy;
}

export interface UpdateTaskResponse {
    plan: Plan;
}

export interface ArchiveTaskRequest {
    taskId: TaskId;
}

export interface ArchiveTaskResponse {
    plan: Plan;
}

export interface CreateSubTaskRequest {
    taskId: TaskId;
    title: string;
    parentSubTaskId?: SubTaskId;
}

export interface CreateSubTaskResponse {
    plan: Plan;
}

export interface MoveSubTaskRequest {
    subTaskId: SubTaskId;
    moveToTopLevel?: boolean;
    parentSubTaskId?: SubTaskId;
    position?: number;
}

export interface MoveSubTaskResponse {
    plan: Plan;
}

export interface UpdateSubTaskRequest {
    subTaskId: SubTaskId;
    title?: string;
}

export interface UpdateSubTaskResponse {
    plan: Plan;
}

export interface ArchiveSubTaskRequest {
    subTaskId: SubTaskId;
}

export interface ArchiveSubTaskResponse {
    plan: Plan;
}

export interface GetLatestScheduleRequest {
}

export interface GetLatestScheduleResponse {
    plan: Plan;
    schedule: Schedule;
}

export interface IncrementMetricRequest {
    metricId: MetricId;
}

export interface IncrementMetricResponse {
    plan: Plan;
    schedule: Schedule;
}

export interface RecordForMetricRequest {
    metricId: MetricId;
    value: number;
}

export interface RecordForMetricResponse {
    plan: Plan;
    schedule: Schedule;
}

export interface UpdateScheduledTaskEntryRequest {
    scheduledTaskEntryId: number;
    inProgress?: boolean;
}

export interface UpdateScheduledTaskEntryResponse {
    plan: Plan;
    schedule: Schedule;
}

export interface MarkTaskAsDoneRequest {
    scheduledTaskEntryId: ScheduledTaskEntryId;
}

export interface MarkTaskAsDoneResponse {
    plan: Plan;
    schedule: Schedule;
}

export interface MarkSubTaskAsDoneRequest {
    scheduledTaskEntryId: ScheduledTaskEntryId;
    subTaskId: SubTaskId;
}

export interface MarkSubTaskAsDoneResponse {
    plan: Plan;
    schedule: Schedule;
}

export interface IncrementCounterTaskRequest {
    scheduledTaskEntryId: ScheduledTaskEntryId;
    increment?: number;
}

export interface IncrementCounterTaskResponse {
    plan: Plan;
    schedule: Schedule;
}

export interface SetGaugeTaskRequest {
    scheduledTaskEntryId: ScheduledTaskEntryId;
    level: number;
}

export interface SetGaugeTaskResponse {
    plan: Plan;
    schedule: Schedule;
}