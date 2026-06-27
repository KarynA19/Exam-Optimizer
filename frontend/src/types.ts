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

export type MoedWindow = DateRange & {
  moed_number: number;
  same_semester_gap_days: number;
  prerequisite_gap_days: number;
  high_failure_gap_days: number;
};

export type ExcludedDateRange = DateRange & {
  reason: string;
};

export type FixedExam = {
  course_code: string;
  course_name: string;
  prerequisite_course_codes: string[];
  exam_date: string;
  locked: boolean;
  department?: CourseDepartment;
  reason?: string | null;
};

export type CourseDepartment = "SW" | "IS" | null;

export type CourseInput = {
  course_code: string;
  course_name: string;
  semester_number: number;
  high_failure_rate: boolean;
  department: CourseDepartment;
  prerequisite_course_codes: string[];
};

export type ScheduledExam = {
  course_code: string;
  moed_number: number;
  exam_date: string;
  source: "solver" | "fixed" | "manual";
};

export type ConstraintConfig = {
  same_semester_gap_days: number;
  adjacent_semester_gap_days: number;
  prerequisite_gap_days: number;
  high_failure_gap_days: number;
  global_spacing_weight: number;
};

export type SolutionDiagnostics = {
  target_gap_days: number;
  spacing_deviation: number;
  spacing_score: number;
};

export type SavedSetupEntry = {
  entry_id: string;
  year: number;
  project_name: string;
  moed_windows: MoedWindow[];
  constraint_config: ConstraintConfig;
  saved_at: string;
};

export type SavedSetupLibrary = Record<string, SavedSetupEntry[]>;

export type AuthLoginResponse = {
  token: string;
  user_id: string;
};

export type RemoteSavedSetupSummary = {
  setup_id: string;
  project_name: string;
  year: number;
  saved_at?: string | null;
  updated_at?: string | null;
  saved_solution_id?: string | null;
};

export type RemoteSavedSetupPayload = {
  metadata: RemoteSavedSetupSummary;
  project: ScheduleProject;
};

export type ImportMode = "replace" | "append" | "merge";

export type ScheduleSolution = {
  solution_id: string;
  score: number;
  exams: ScheduledExam[];
  issues: ValidationIssue[];
  diagnostics: SolutionDiagnostics;
  original_exams?: ScheduledExam[];
  original_score?: number;
  original_diagnostics?: SolutionDiagnostics;
};

export type ManualMoveUpdatedSolution = {
  solution_id: string;
  score: number;
  exams: ScheduledExam[];
  diagnostics: SolutionDiagnostics;
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
  fixed_exams_imported_count: number;
  fixed_exams: FixedExam[];
};

export type ScheduleProject = {
  project_name: string;
  moed_windows: MoedWindow[];
  constraint_config: ConstraintConfig;
  remote_setup_id?: string | null;
  setup_entry_id?: string | null;
  initial_setup_saved_at?: string | null;
  excluded_ranges: ExcludedDateRange[];
  fixed_exams: FixedExam[];
  courses: CourseInput[];
  solutions: ScheduleSolution[];
  issues: ValidationIssue[];
};

export const createEmptyProject = (): ScheduleProject => ({
  project_name: "Spring Moed A",
  moed_windows: [
    {
      moed_number: 1,
      start_date: "2026-06-15",
      end_date: "2026-07-15",
      same_semester_gap_days: 3,
      prerequisite_gap_days: 3,
      high_failure_gap_days: 3,
    },
  ],
  constraint_config: {
    same_semester_gap_days: 3,
    adjacent_semester_gap_days: 2,
    prerequisite_gap_days: 3,
    high_failure_gap_days: 3,
    global_spacing_weight: 4,
  },
  remote_setup_id: null,
  setup_entry_id: null,
  initial_setup_saved_at: null,
  excluded_ranges: [],
  fixed_exams: [],
  courses: [],
  solutions: [],
  issues: [],
});
