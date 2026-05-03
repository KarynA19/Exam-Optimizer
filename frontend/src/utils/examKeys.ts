import type { ScheduleSolution } from "../types";

export function getExamMoveKey(solutionId: string, courseCode: string) {
  return `${solutionId}:${courseCode}`;
}

export function getPreviewKey(solutionId: string, courseCode: string, date: string) {
  return `${solutionId}:${courseCode}:${date}`;
}

export function getOriginalExam(solution: ScheduleSolution, courseCode: string) {
  return solution.original_exams?.find((exam) => exam.course_code === courseCode) ?? null;
}

export function hasExamChanged(solution: ScheduleSolution, courseCode: string) {
  const currentExam = solution.exams.find((exam) => exam.course_code === courseCode);
  const originalExam = getOriginalExam(solution, courseCode);

  if (!currentExam || !originalExam) {
    return false;
  }

  return currentExam.exam_date !== originalExam.exam_date || currentExam.source !== originalExam.source;
}
