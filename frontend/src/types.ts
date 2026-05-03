export type IssueSeverity = "error" | "warning";

export type ValidationIssue = {
  code: string;
  severity: IssueSeverity;
  message: string;
  related_course_code?: string | null;
  related_date?: string | null;
};

export type DateRange = {
  start_date: string;
  end_date: string;
};

export type ExcludedDateRange = DateRange & {
  reason: string;
};

export type FixedExam = {
  course_code: string;
  exam_date: string;
  locked: boolean;
  reason?: string | null;
};

export type CourseInput = {
  course_code: string;
  course_name: string;
  semester_number: number;
  high_failure_rate: boolean;
  prerequisite_course_code?: string | null;
};

export type ScheduledExam = {
  course_code: string;
  exam_date: string;
  source: "solver" | "fixed" | "manual";
};

export type ConstraintConfig = {
  same_semester_gap_days: number;
  prerequisite_gap_days: number;
  high_failure_gap_days: number;
};

export type ScheduleSolution = {
  solution_id: string;
  score: number;
  exams: ScheduledExam[];
  issues: ValidationIssue[];
  original_exams?: ScheduledExam[];
  original_score?: number;
};

export type ManualMoveUpdatedSolution = {
  solution_id: string;
  score: number;
  exams: ScheduledExam[];
};

export type ManualMoveResponse = {
  valid: boolean;
  issues: ValidationIssue[];
  updated_solution?: ManualMoveUpdatedSolution;
};

export type ExplainMoveResponse = ManualMoveResponse;

export type CourseImportResponse = {
  imported_count: number;
  courses: CourseInput[];
};

export type ScheduleProject = {
  project_name: string;
  moed_a_window: DateRange;
  constraint_config: ConstraintConfig;
  excluded_ranges: ExcludedDateRange[];
  fixed_exams: FixedExam[];
  courses: CourseInput[];
  solutions: ScheduleSolution[];
  issues: ValidationIssue[];
};

export const createEmptyProject = (): ScheduleProject => ({
  project_name: "Spring Moed A",
  moed_a_window: {
    start_date: "2026-06-15",
    end_date: "2026-07-15",
  },
  constraint_config: {
    same_semester_gap_days: 3,
    prerequisite_gap_days: 3,
    high_failure_gap_days: 3,
  },
  excluded_ranges: [],
  fixed_exams: [],
  courses: [],
  solutions: [],
  issues: [],
});
