import { createEmptyProject, type MoedWindow, type SavedSetupEntry, type SavedSetupLibrary, type ScheduleProject } from "../types";

const STORAGE_KEY = "exam-optimizer:project";
const SETUP_LIBRARY_KEY = "exam-optimizer:setup-library";

function normalizePrerequisiteCourseCodes(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  }

  if (typeof value === "string") {
    return value
      .replace(/;/g, ",")
      .split(",")
      .map((entry: string) => entry.trim())
      .filter((entry: string) => entry.length > 0);
  }

  return [];
}

function normalizeCourseDepartment(value: unknown): "SW" | "IS" | null {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  return normalized === "SW" || normalized === "IS" ? normalized : null;
}

function normalizeSolutionDiagnostics(value: unknown): { target_gap_days: number; spacing_deviation: number; spacing_score: number } {
  const parsed = value as { target_gap_days?: number; spacing_deviation?: number; spacing_score?: number } | null | undefined;

  return {
    target_gap_days: typeof parsed?.target_gap_days === "number" ? parsed.target_gap_days : 1,
    spacing_deviation: typeof parsed?.spacing_deviation === "number" ? parsed.spacing_deviation : 0,
    spacing_score: typeof parsed?.spacing_score === "number" ? parsed.spacing_score : 0,
  };
}

function normalizeMoedWindows(value: unknown, fallbackGaps?: { same_semester_gap_days?: number; prerequisite_gap_days?: number; high_failure_gap_days?: number }): MoedWindow[] {
  if (Array.isArray(value) && value.length > 0) {
    return value.map((window, index) => {
      const parsed = window as Partial<MoedWindow>;
      return {
        moed_number: index + 1,
        start_date: parsed.start_date ?? "",
        end_date: parsed.end_date ?? parsed.start_date ?? "",
        same_semester_gap_days: typeof parsed.same_semester_gap_days === "number" ? parsed.same_semester_gap_days : (fallbackGaps?.same_semester_gap_days ?? 3),
        prerequisite_gap_days: typeof parsed.prerequisite_gap_days === "number" ? parsed.prerequisite_gap_days : (fallbackGaps?.prerequisite_gap_days ?? 3),
        high_failure_gap_days: typeof parsed.high_failure_gap_days === "number" ? parsed.high_failure_gap_days : (fallbackGaps?.high_failure_gap_days ?? 3),
      };
    });
  }

  if (value && typeof value === "object") {
    const parsed = value as Partial<MoedWindow>;
    return [
      {
        moed_number: 1,
        start_date: parsed.start_date ?? "",
        end_date: parsed.end_date ?? parsed.start_date ?? "",
        same_semester_gap_days: typeof parsed.same_semester_gap_days === "number" ? parsed.same_semester_gap_days : (fallbackGaps?.same_semester_gap_days ?? 3),
        prerequisite_gap_days: typeof parsed.prerequisite_gap_days === "number" ? parsed.prerequisite_gap_days : (fallbackGaps?.prerequisite_gap_days ?? 3),
        high_failure_gap_days: typeof parsed.high_failure_gap_days === "number" ? parsed.high_failure_gap_days : (fallbackGaps?.high_failure_gap_days ?? 3),
      },
    ];
  }

  return createEmptyProject().moed_windows;
}

function inferMoedNumber(dateText: string | undefined, moedWindows: MoedWindow[]): number {
  if (!dateText) {
    return 1;
  }

  return moedWindows.find((window) => window.start_date <= dateText && dateText <= window.end_date)?.moed_number ?? 1;
}

function normalizeProject(parsed: Partial<ScheduleProject> | null | undefined): ScheduleProject {
  const emptyProject = createEmptyProject();
  const moedWindows = normalizeMoedWindows(
    (parsed as { moed_windows?: unknown; moed_a_window?: unknown } | null | undefined)?.moed_windows ?? (parsed as { moed_windows?: unknown; moed_a_window?: unknown } | null | undefined)?.moed_a_window,
    parsed?.constraint_config,
  );

  return {
    ...emptyProject,
    ...parsed,
    moed_windows: moedWindows,
    constraint_config: {
      ...emptyProject.constraint_config,
      ...parsed?.constraint_config,
    },
    setup_entry_id: parsed?.setup_entry_id ?? emptyProject.setup_entry_id,
    initial_setup_saved_at: parsed?.initial_setup_saved_at ?? emptyProject.initial_setup_saved_at,
    excluded_ranges: parsed?.excluded_ranges ?? emptyProject.excluded_ranges,
    fixed_exams:
      parsed?.fixed_exams?.map((exam) => ({
        ...exam,
        course_name: exam.course_name ?? "",
        prerequisite_course_codes: normalizePrerequisiteCourseCodes(
          (exam as { prerequisite_course_codes?: string[] | string | null; prerequisite_course_code?: string | null })
            .prerequisite_course_codes ??
            (exam as { prerequisite_course_codes?: string[] | string | null; prerequisite_course_code?: string | null })
              .prerequisite_course_code,
        ),
      })) ?? emptyProject.fixed_exams,
    courses:
      parsed?.courses?.map((course) => ({
        ...course,
        department: normalizeCourseDepartment((course as { department?: unknown }).department),
        prerequisite_course_codes: normalizePrerequisiteCourseCodes(
          (course as { prerequisite_course_codes?: string[] | string | null; prerequisite_course_code?: string | null })
            .prerequisite_course_codes ??
            (course as { prerequisite_course_codes?: string[] | string | null; prerequisite_course_code?: string | null })
              .prerequisite_course_code,
        ),
      })) ?? emptyProject.courses,
    solutions:
      parsed?.solutions?.map((solution) => ({
        ...solution,
        exams: solution.exams.map((exam) => ({
          ...exam,
          moed_number: typeof exam.moed_number === "number" ? exam.moed_number : inferMoedNumber(exam.exam_date, moedWindows),
        })),
        original_exams: solution.original_exams?.map((exam) => ({
          ...exam,
          moed_number: typeof exam.moed_number === "number" ? exam.moed_number : inferMoedNumber(exam.exam_date, moedWindows),
        })),
        diagnostics: normalizeSolutionDiagnostics((solution as { diagnostics?: unknown }).diagnostics),
        original_diagnostics: normalizeSolutionDiagnostics((solution as { original_diagnostics?: unknown }).original_diagnostics),
      })) ?? emptyProject.solutions,
    issues: parsed?.issues ?? emptyProject.issues,
  };
}

export function loadProject(): ScheduleProject {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return createEmptyProject();
  }

  try {
    return normalizeProject(JSON.parse(raw) as Partial<ScheduleProject>);
  } catch {
    return createEmptyProject();
  }
}

export function saveProject(project: ScheduleProject): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
}

function normalizeSavedSetupEntry(parsed: Partial<SavedSetupEntry> | null | undefined): SavedSetupEntry | null {
  const moedWindows = normalizeMoedWindows(
    (parsed as { moed_windows?: unknown; moed_a_window?: unknown } | null | undefined)?.moed_windows ?? (parsed as { moed_windows?: unknown; moed_a_window?: unknown } | null | undefined)?.moed_a_window,
    parsed?.constraint_config,
  );

  if (!parsed?.entry_id || !parsed?.project_name || moedWindows.length === 0 || !moedWindows[0].start_date || !moedWindows[0].end_date || !parsed?.saved_at) {
    return null;
  }

  const fallbackProject = createEmptyProject();
  const rawYear = typeof parsed.year === "number" ? parsed.year : Number(parsed.year);
  const normalizedYear = Number.isFinite(rawYear) ? rawYear : Number(moedWindows[0].start_date.slice(0, 4));

  return {
    entry_id: parsed.entry_id,
    year: normalizedYear,
    project_name: parsed.project_name,
    moed_windows: moedWindows,
    constraint_config: {
      ...fallbackProject.constraint_config,
      ...parsed.constraint_config,
    },
    saved_at: parsed.saved_at,
  };
}

function compareSavedEntries(left: SavedSetupEntry, right: SavedSetupEntry): number {
  return right.saved_at.localeCompare(left.saved_at);
}

function groupEntriesByYear(entries: SavedSetupEntry[]): SavedSetupLibrary {
  return entries.reduce<SavedSetupLibrary>((groups, entry) => {
    const yearKey = String(entry.year);
    const nextGroup = groups[yearKey] ? [...groups[yearKey], entry] : [entry];
    groups[yearKey] = nextGroup.sort(compareSavedEntries);
    return groups;
  }, {});
}

export function loadSetupLibrary(): SavedSetupLibrary {
  const raw = window.localStorage.getItem(SETUP_LIBRARY_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as SavedSetupLibrary | SavedSetupEntry[];

    if (Array.isArray(parsed)) {
      return groupEntriesByYear(parsed.map((entry) => normalizeSavedSetupEntry(entry)).filter((entry): entry is SavedSetupEntry => entry !== null));
    }

    const entries = Object.values(parsed)
      .flat()
      .map((entry) => normalizeSavedSetupEntry(entry))
      .filter((entry): entry is SavedSetupEntry => entry !== null);

    return groupEntriesByYear(entries);
  } catch {
    return {};
  }
}

export function saveSetupLibrary(library: SavedSetupLibrary): void {
  window.localStorage.setItem(SETUP_LIBRARY_KEY, JSON.stringify(library));
}

export function upsertSetupEntry(entry: SavedSetupEntry): SavedSetupLibrary {
  const entries = Object.values(loadSetupLibrary())
    .flat()
    .filter((currentEntry) => currentEntry.entry_id !== entry.entry_id)
    .concat(entry);

  const nextLibrary = groupEntriesByYear(entries);
  saveSetupLibrary(nextLibrary);
  return nextLibrary;
}

export function deleteSetupEntry(entryId: string): SavedSetupLibrary {
  const entries = Object.values(loadSetupLibrary())
    .flat()
    .filter((currentEntry) => currentEntry.entry_id !== entryId);

  const nextLibrary = groupEntriesByYear(entries);
  saveSetupLibrary(nextLibrary);
  return nextLibrary;
}
