import { createEmptyProject, type SavedSetupEntry, type SavedSetupLibrary, type ScheduleProject } from "../types";

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

function normalizeProject(parsed: Partial<ScheduleProject> | null | undefined): ScheduleProject {
  const emptyProject = createEmptyProject();

  return {
    ...emptyProject,
    ...parsed,
    moed_a_window: {
      ...emptyProject.moed_a_window,
      ...parsed?.moed_a_window,
    },
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
        prerequisite_course_codes: normalizePrerequisiteCourseCodes(
          (course as { prerequisite_course_codes?: string[] | string | null; prerequisite_course_code?: string | null })
            .prerequisite_course_codes ??
            (course as { prerequisite_course_codes?: string[] | string | null; prerequisite_course_code?: string | null })
              .prerequisite_course_code,
        ),
      })) ?? emptyProject.courses,
    solutions: parsed?.solutions ?? emptyProject.solutions,
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
  if (!parsed?.entry_id || !parsed?.project_name || !parsed?.moed_a_window?.start_date || !parsed?.moed_a_window?.end_date || !parsed?.saved_at) {
    return null;
  }

  const fallbackProject = createEmptyProject();
  const rawYear = typeof parsed.year === "number" ? parsed.year : Number(parsed.year);
  const normalizedYear = Number.isFinite(rawYear) ? rawYear : Number(parsed.moed_a_window.start_date.slice(0, 4));

  return {
    entry_id: parsed.entry_id,
    year: normalizedYear,
    project_name: parsed.project_name,
    moed_a_window: {
      start_date: parsed.moed_a_window.start_date,
      end_date: parsed.moed_a_window.end_date,
    },
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
