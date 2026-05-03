import { createEmptyProject, type ScheduleProject } from "../types";

const STORAGE_KEY = "exam-optimizer:project";

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
    excluded_ranges: parsed?.excluded_ranges ?? emptyProject.excluded_ranges,
    fixed_exams: parsed?.fixed_exams ?? emptyProject.fixed_exams,
    courses: parsed?.courses ?? emptyProject.courses,
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
