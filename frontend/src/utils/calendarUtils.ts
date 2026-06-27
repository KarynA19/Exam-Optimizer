import type { CourseInput, ScheduleProject, ScheduleSolution } from "../types";
import { diffDays, isWeekend, toDate } from "./dateHelpers";

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function buildCalendarDays(project: ScheduleProject, moedNumber?: number) {
  const days: string[] = [];
  for (const window of project.moed_windows) {
    if (moedNumber !== undefined && window.moed_number !== moedNumber) {
      continue;
    }

    const cursor = toDate(window.start_date);
    const endDate = toDate(window.end_date);

    while (cursor <= endDate) {
      days.push(formatDateKey(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  return days;
}

export function getExcludedDateReason(project: ScheduleProject, dateText: string): string | null {
  const match = project.excluded_ranges.find((range) => range.start_date <= dateText && dateText <= range.end_date);
  return match?.reason ?? null;
}

export function getSolutionMetrics(solution: ScheduleSolution, courseByCode?: Record<string, CourseInput>) {
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

  const semesterGapEntries = courseByCode
    ? Array.from(
        solution.exams.reduce<Map<number, string[]>>((semesterMap, exam) => {
          const semesterNumber = courseByCode[exam.course_code]?.semester_number;
          if (!semesterNumber) {
            return semesterMap;
          }
          const semesterDates = semesterMap.get(semesterNumber) ?? [];
          semesterDates.push(exam.exam_date);
          semesterMap.set(semesterNumber, semesterDates);
          return semesterMap;
        }, new Map()),
      )
        .map(([semesterNumber, examDates]) => {
          const sortedSemesterDates = [...examDates].sort((left, right) => left.localeCompare(right));
          if (sortedSemesterDates.length < 2) {
            return null;
          }

          const semesterGaps = sortedSemesterDates.slice(1).map((examDate, index) => diffDays(sortedSemesterDates[index], examDate));
          const averageSemesterGap = Math.round((semesterGaps.reduce((sum, gap) => sum + gap, 0) / semesterGaps.length) * 10) / 10;
          const minimumSemesterGap = Math.min(...semesterGaps);

          return {
            semesterNumber,
            averageSemesterGap,
            minimumSemesterGap,
          };
        })
        .filter((entry): entry is { semesterNumber: number; averageSemesterGap: number; minimumSemesterGap: number } => entry !== null)
    : [];

  const semesterGapSummary = semesterGapEntries.length > 0
    ? semesterGapEntries.map((entry) => `S${entry.semesterNumber}: ${entry.averageSemesterGap}d`).join(" • ")
    : "No repeated semesters";
  const tightestSemesterGap = semesterGapEntries.length > 0
    ? semesterGapEntries.reduce((tightest, entry) => (entry.minimumSemesterGap < tightest.minimumSemesterGap ? entry : tightest)).minimumSemesterGap
    : 0;
  const tightestSemesterLabel = semesterGapEntries.length > 0
    ? (() => {
        const entry = semesterGapEntries.reduce((tightest, current) => (current.minimumSemesterGap < tightest.minimumSemesterGap ? current : tightest));
        return `S${entry.semesterNumber}: ${entry.minimumSemesterGap}d`;
      })()
    : "-";

  return {
    averageGap,
    minimumGap,
    weekendExams,
    highFailureConflicts,
    manualEdits,
    semesterGapSummary,
    tightestSemesterGap,
    tightestSemesterLabel,
  };
}
