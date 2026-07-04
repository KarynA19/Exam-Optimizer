import type {
  AuthLoginResponse,
  CourseImportResponse,
  CourseInput,
  ExplainMoveResponse,
  FixedExam,
  ManualMoveResponse,
  RemoteSavedSetupPayload,
  RemoteSavedSetupSummary,
  ScheduleProject,
  ScheduleSolution,
  ValidationIssue,
} from "./types";

function resolveApiBase(): string {
  const configuredBase = import.meta.env.VITE_API_BASE?.trim();
  if (configuredBase) {
    return configuredBase.replace(/\/$/, "");
  }

  if (import.meta.env.DEV) {
    return "http://localhost:8000/api";
  }

  throw new Error("Missing VITE_API_BASE for production build.");
}

const API_BASE = resolveApiBase();
const AUTH_TOKEN_KEY = "exam_optimizer_auth_token";
const AUTH_USER_ID_KEY = "exam_optimizer_auth_user_id";
const AUTH_STATE_EVENT = "exam-optimizer-auth-state-changed";

function emitAuthStateChanged() {
  window.dispatchEvent(new CustomEvent(AUTH_STATE_EVENT));
}

export function clearStoredAuth() {
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
  window.localStorage.removeItem(AUTH_USER_ID_KEY);
  emitAuthStateChanged();
}

async function buildErrorFromResponse(response: Response, fallback: string): Promise<Error> {
  const detail = await response.json().catch(() => null);
  if (response.status === 401) {
    clearStoredAuth();
    return new Error("Session expired. Please log in again.");
  }

  return new Error(detail?.detail ?? fallback);
}

export function getStoredAuthToken(): string | null {
  return window.localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setStoredAuthToken(token: string | null) {
  if (!token) {
    clearStoredAuth();
    return;
  }

  window.localStorage.setItem(AUTH_TOKEN_KEY, token);
  emitAuthStateChanged();
}

export function getStoredAuthUserId(): string | null {
  return window.localStorage.getItem(AUTH_USER_ID_KEY);
}

export function setStoredAuthUserId(userId: string | null) {
  if (!userId) {
    window.localStorage.removeItem(AUTH_USER_ID_KEY);
    emitAuthStateChanged();
    return;
  }

  window.localStorage.setItem(AUTH_USER_ID_KEY, userId);
  emitAuthStateChanged();
}

function buildAuthHeaders(): HeadersInit {
  const token = getStoredAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function loginToBackend(userId: string, password: string): Promise<AuthLoginResponse> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user_id: userId, password }),
  });

  if (!response.ok) {
    throw await buildErrorFromResponse(response, "Login failed.");
  }

  const payload = await response.json() as AuthLoginResponse;
  setStoredAuthToken(payload.token);
  setStoredAuthUserId(payload.user_id);
  return payload;
}

export async function validateProject(project: ScheduleProject): Promise<ScheduleProject> {
  const response = await fetch(`${API_BASE}/projects/validate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(project),
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearStoredAuth();
    }
    throw new Error("Validation request failed.");
  }

  return response.json();
}

export async function solveProject(
  project: ScheduleProject,
  options?: { signal?: AbortSignal },
): Promise<{ project_name: string; solutions: unknown[]; issues: unknown[] }> {
  const response = await fetch(`${API_BASE}/projects/solve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ project, max_solutions: 5 }),
    signal: options?.signal,
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearStoredAuth();
    }
    const detail = await response.json().catch(() => null);
    throw new Error(detail ? JSON.stringify(detail) : "Solve request failed.");
  }

  return response.json();
}

export async function manualMoveProject(
  project: ScheduleProject,
  solutionId: string,
  courseCode: string,
  moedNumber: number,
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
      moed_number: moedNumber,
      new_date: newDate,
    }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearStoredAuth();
    }
    const detail = await response.json().catch(() => null);
    throw new Error(detail ? JSON.stringify(detail) : "Manual move request failed.");
  }

  return response.json();
}

export async function explainMoveProject(
  project: ScheduleProject,
  solutionId: string,
  courseCode: string,
  moedNumber: number,
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
      moed_number: moedNumber,
      new_date: newDate,
    }),
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearStoredAuth();
    }
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
    if (response.status === 401) {
      clearStoredAuth();
    }
    const detail = await response.json().catch(() => null);
    if (Array.isArray(detail?.detail)) {
      throw detail.detail as ValidationIssue[];
    }

    throw new Error("Course import request failed.");
  }

  return response.json();
}


export async function downloadCourseTemplate(): Promise<Blob> {
  const cacheBuster = Date.now();
  const response = await fetch(`${API_BASE}/projects/import-courses/template?ts=${cacheBuster}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearStoredAuth();
    }
    throw new Error("Course template download failed.");
  }

  return response.blob();
}

export async function listRemoteSavedSetups(): Promise<RemoteSavedSetupSummary[]> {
  const response = await fetch(`${API_BASE}/saved-setups`, {
    headers: {
      ...buildAuthHeaders(),
    },
  });

  if (!response.ok) {
    throw await buildErrorFromResponse(response, "Failed to list saved setups.");
  }

  return response.json();
}

export async function saveRemoteSetup(
  project: ScheduleProject,
  setupId?: string | null,
  savedSolutionId?: string | null,
): Promise<RemoteSavedSetupSummary> {
  const response = await fetch(`${API_BASE}/saved-setups`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(),
    },
    body: JSON.stringify({
      project,
      setup_id: setupId ?? null,
      saved_solution_id: savedSolutionId ?? null,
    }),
  });

  if (!response.ok) {
    throw await buildErrorFromResponse(response, "Failed to save setup.");
  }

  return response.json();
}

export async function loadRemoteSetup(setupId: string): Promise<RemoteSavedSetupPayload> {
  const response = await fetch(`${API_BASE}/saved-setups/${setupId}`, {
    headers: {
      ...buildAuthHeaders(),
    },
  });

  if (!response.ok) {
    throw await buildErrorFromResponse(response, "Failed to load setup.");
  }

  return response.json();
}

export async function deleteRemoteSetup(setupId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/saved-setups/${setupId}`, {
    method: "DELETE",
    headers: {
      ...buildAuthHeaders(),
    },
  });

  if (!response.ok) {
    throw await buildErrorFromResponse(response, "Failed to delete setup.");
  }
}

export async function updateRemoteSetupSolutions(
  setupId: string,
  solutions: ScheduleSolution[],
  savedSolutionId?: string | null,
): Promise<RemoteSavedSetupSummary> {
  const response = await fetch(`${API_BASE}/saved-setups/${setupId}/solutions`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(),
    },
    body: JSON.stringify({
      solutions,
      saved_solution_id: savedSolutionId ?? null,
    }),
  });

  if (!response.ok) {
    throw await buildErrorFromResponse(response, "Failed to update setup solutions.");
  }

  return response.json();
}

export async function loadRemoteSetupCourses(setupId: string): Promise<CourseInput[]> {
  const response = await fetch(`${API_BASE}/saved-setups/${setupId}/courses`, {
    headers: {
      ...buildAuthHeaders(),
    },
  });

  if (!response.ok) {
    throw await buildErrorFromResponse(response, "Failed to load courses from saved setup.");
  }

  return response.json();
}

export async function loadRemoteSetupFixedExams(setupId: string): Promise<FixedExam[]> {
  const response = await fetch(`${API_BASE}/saved-setups/${setupId}/fixed-exams`, {
    headers: {
      ...buildAuthHeaders(),
    },
  });

  if (!response.ok) {
    throw await buildErrorFromResponse(response, "Failed to load fixed exams from saved setup.");
  }

  return response.json();
}
