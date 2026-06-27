import type { ScheduleSolution, ScheduledExam, ValidationIssue } from "../types";

export type PreviewStatus = "green" | "yellow" | "red" | "idle";

export type PreviewResponse = {
  valid: boolean;
  issues: ValidationIssue[];
  updated_solution?: {
    solution_id: string;
    score: number;
    exams: ScheduledExam[];
  };
};

export function getPreviewStatus(solution: ScheduleSolution, dateText: string, selectedExam: ScheduledExam | null, previewResponse?: PreviewResponse): PreviewStatus {
  if (!selectedExam || !previewResponse) {
    return "idle";
  }

  if (!previewResponse.valid) {
    return "red";
  }

  if (dateText === selectedExam.exam_date) {
    return "green";
  }

  return (previewResponse.updated_solution?.score ?? solution.score) < solution.score ? "yellow" : "green";
}
