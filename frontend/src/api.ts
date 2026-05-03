import type { CourseImportResponse, ExplainMoveResponse, ManualMoveResponse, ScheduleProject, ValidationIssue } from "./types";

const API_BASE = "http://localhost:8000/api";

export async function validateProject(project: ScheduleProject): Promise<ScheduleProject> {
  const response = await fetch(`${API_BASE}/projects/validate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(project),
  });

  if (!response.ok) {
    throw new Error("Validation request failed.");
  }

  return response.json();
}

export async function solveProject(project: ScheduleProject): Promise<{ project_name: string; solutions: unknown[]; issues: unknown[] }> {
  const response = await fetch(`${API_BASE}/projects/solve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ project, max_solutions: 5 }),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail ? JSON.stringify(detail) : "Solve request failed.");
  }

  return response.json();
}

export async function manualMoveProject(
  project: ScheduleProject,
  solutionId: string,
  courseCode: string,
  newDate: string,
): Promise<ManualMoveResponse> {
  const response = await fetch(`${API_BASE}/projects/manual-move`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      project,
      solution_id: solutionId,
      course_code: courseCode,
      new_date: newDate,
    }),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail ? JSON.stringify(detail) : "Manual move request failed.");
  }

  return response.json();
}

export async function explainMoveProject(
  project: ScheduleProject,
  solutionId: string,
  courseCode: string,
  newDate: string,
): Promise<ExplainMoveResponse> {
  const response = await fetch(`${API_BASE}/projects/explain-move`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      project,
      solution_id: solutionId,
      course_code: courseCode,
      new_date: newDate,
    }),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail ? JSON.stringify(detail) : "Move preview request failed.");
  }

  return response.json();
}

export async function importCoursesSpreadsheet(file: File): Promise<CourseImportResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE}/projects/import-courses`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    if (Array.isArray(detail?.detail)) {
      throw detail.detail as ValidationIssue[];
    }

    throw new Error("Course import request failed.");
  }

  return response.json();
}
