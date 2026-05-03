import type { ScheduleProject, ScheduleSolution } from "../types";
import { diffDays, isWeekend, toDate } from "./dateHelpers";

export function buildCalendarDays(project: ScheduleProject) {
  const days: string[] = [];
  const cursor = toDate(project.moed_a_window.start_date);
  const endDate = toDate(project.moed_a_window.end_date);

  while (cursor <= endDate) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

export function getSolutionMetrics(solution: ScheduleSolution) {
  const sortedExams = [...solution.exams].sort((left, right) => left.exam_date.localeCompare(right.exam_date));
  const gaps: number[] = [];

  for (let index = 1; index < sortedExams.length; index += 1) {
    gaps.push(diffDays(sortedExams[index - 1].exam_date, sortedExams[index].exam_date));
  }

  const weekendExams = solution.exams.filter((exam) => isWeekend(exam.exam_date)).length;
  const highFailureConflicts = solution.issues.filter((issue) => issue.message.includes("High-failure")).length;
  const manualEdits = solution.exams.filter((exam) => exam.source === "manual").length;
  const averageGap = gaps.length === 0 ? 0 : Math.round((gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length) * 10) / 10;
  const minimumGap = gaps.length === 0 ? 0 : Math.min(...gaps);

  return {
    averageGap,
    minimumGap,
    weekendExams,
    highFailureConflicts,
    manualEdits,
  };
}
