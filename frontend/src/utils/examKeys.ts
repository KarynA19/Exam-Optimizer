import type { ScheduleSolution } from "../types";

export function getExamMoveKey(solutionId: string, courseCode: string, moedNumber: number) {
  return `${solutionId}:${courseCode}:${moedNumber}`;
}

export function getPreviewKey(solutionId: string, courseCode: string, moedNumber: number, date: string) {
  return `${solutionId}:${courseCode}:${moedNumber}:${date}`;
}

export function getOriginalExam(solution: ScheduleSolution, courseCode: string, moedNumber: number) {
  return solution.original_exams?.find((exam) => exam.course_code === courseCode && exam.moed_number === moedNumber) ?? null;
}

export function hasExamChanged(solution: ScheduleSolution, courseCode: string, moedNumber: number) {
  const currentExam = solution.exams.find((exam) => exam.course_code === courseCode && exam.moed_number === moedNumber);
  const originalExam = getOriginalExam(solution, courseCode, moedNumber);

  if (!currentExam || !originalExam) {
    return false;
  }

  return currentExam.exam_date !== originalExam.exam_date || currentExam.source !== originalExam.source;
}
