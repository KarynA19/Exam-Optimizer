import { useEffect, useRef } from "react";

import type { CourseInput, ScheduleProject, ScheduleSolution, ScheduledExam, ValidationIssue } from "../../types";
import { diffDays, formatCalendarLabel, toDate } from "../../utils/dateHelpers";
import { getPreviewKey, hasExamChanged } from "../../utils/examKeys";
import { getPreviewStatus, type PreviewResponse } from "../../utils/workspaceUtils";

const YEAR_GROUPS = [
  { label: "Year 1", semesters: [1, 2] },
  { label: "Year 2", semesters: [3, 4] },
  { label: "Year 3", semesters: [5, 6] },
  { label: "Year 4", semesters: [7, 8] },
];

export function MasterCalendar({
  project,
  solution,
  calendarDays,
  semesterRows,
  courseNameByCode,
  courseByCode,
  selectedExam,
  selectedPreviewDate,
  previewResponses,
  previewLoading,
  showChanges,
  activeConflict,
  onSelectExam,
  onSelectPreviewDate,
}: {
  project: ScheduleProject;
  solution: ScheduleSolution;
  calendarDays: string[];
  semesterRows: number[];
  courseNameByCode: Record<string, string>;
  courseByCode: Record<string, CourseInput>;
  selectedExam: ScheduledExam | null;
  selectedPreviewDate: string | null;
  previewResponses: Record<string, PreviewResponse>;
  previewLoading: boolean;
  showChanges: boolean;
  activeConflict: ValidationIssue | null;
  onSelectExam: (exam: ScheduledExam) => void;
  onSelectPreviewDate: (date: string) => void;
}) {
  const examRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const semesterSet = new Set(semesterRows);
  const yearGroups = YEAR_GROUPS.map((group) => ({
    ...group,
    semesters: group.semesters.filter((semester) => semesterSet.has(semester)),
  })).filter((group) => group.semesters.length > 0);
  const courseCountBySemester = new Map(
    semesterRows.map((semesterNumber) => [
      semesterNumber,
      project.courses.filter((course) => course.semester_number === semesterNumber).length,
    ]),
  );
  const activeConflictCourseCode = activeConflict?.related_course_code ?? selectedExam?.course_code ?? null;
  const activeConflictDate = activeConflict?.related_date ?? selectedExam?.exam_date ?? null;

  useEffect(() => {
    if (!activeConflictCourseCode || !activeConflictDate) {
      return;
    }

    examRefs.current[`${activeConflictCourseCode}|${activeConflictDate}`]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });
  }, [activeConflictCourseCode, activeConflictDate]);

  return (
    <div
      className="calendar-board calendar-board-timetable"
      style={{ gridTemplateColumns: `repeat(${semesterRows.length}, minmax(132px, 1fr)) 108px` }}
    >
      {yearGroups.map((group) => (
        <div
          key={group.label}
          className="calendar-year-group"
          style={{ gridColumn: `span ${group.semesters.length}` }}
        >
          <strong>{group.label}</strong>
          <span>
            Semesters {group.semesters[0]}-{group.semesters[group.semesters.length - 1]}
          </span>
        </div>
      ))}
      <div className="calendar-date-rail calendar-date-rail-header" style={{ gridRow: "span 2" }}>
        <strong>Date</strong>
        <span>Moed A window</span>
      </div>

      {semesterRows.map((semesterNumber) => (
        <div key={`label-${semesterNumber}`} className="calendar-semester-heading">
          <strong>Semester {semesterNumber}</strong>
          <span>{courseCountBySemester.get(semesterNumber) ?? 0} courses</span>
        </div>
      ))}

      {calendarDays.flatMap((dateText) => {
        const date = toDate(dateText);
        const isSaturday = date.getDay() === 6;
        const weekdayLabel = date.toLocaleDateString(undefined, { weekday: "short" });

        const dayCells = semesterRows.map((semesterNumber) => {
          const rowExams = solution.exams.filter(
            (exam) => courseByCode[exam.course_code]?.semester_number === semesterNumber && exam.exam_date === dateText,
          );
          const previewKey = selectedExam ? getPreviewKey(solution.solution_id, selectedExam.course_code, dateText) : null;
          const previewResponse = previewKey ? previewResponses[previewKey] : undefined;
          const cellPreviewStatus = getPreviewStatus(solution, dateText, selectedExam, previewResponse);
          const inFocusWindow = selectedExam ? diffDays(selectedExam.exam_date, dateText) <= 3 : true;
          const selectedSemester = selectedExam
            ? courseByCode[selectedExam.course_code]?.semester_number === semesterNumber
            : false;
          const canPreview = selectedSemester && !isSaturday;
          const cellClassName = [
            "calendar-slot",
            selectedExam && !inFocusWindow ? "dimmed" : "",
            canPreview ? `preview-${cellPreviewStatus}` : "",
            canPreview && selectedPreviewDate === dateText ? "preview-target" : "",
            isSaturday ? "blocked" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div
              key={`${semesterNumber}-${dateText}`}
              className={cellClassName}
              onClick={() => {
                if (canPreview) {
                  onSelectPreviewDate(dateText);
                }
              }}
            >
              {canPreview && previewLoading ? <span className="preview-pulse" /> : null}
              {isSaturday ? <span className="calendar-blocked-note">Unavailable</span> : null}
              {rowExams.map((exam) => {
                const semesterTone = `semester-tone-${semesterNumber % 4}`;
                const selected = selectedExam?.course_code === exam.course_code;
                const changed = showChanges && hasExamChanged(solution, exam.course_code);
                const matchesConflictCourse = activeConflict?.related_course_code
                  ? activeConflict.related_course_code === exam.course_code
                  : selectedExam?.course_code === exam.course_code;
                const matchesConflictDate = activeConflict?.related_date
                  ? activeConflict.related_date === exam.exam_date
                  : selectedExam?.exam_date === exam.exam_date;
                const showConflictNote = Boolean(activeConflict && matchesConflictCourse && matchesConflictDate);

                return (
                  <div key={`${exam.course_code}-${exam.exam_date}`} className="calendar-event-stack">
                    <button
                      ref={(element) => {
                        examRefs.current[`${exam.course_code}|${exam.exam_date}`] = element;
                      }}
                      type="button"
                      className={["exam-chip", semesterTone, selected ? "selected" : "", changed ? "changed" : ""].filter(Boolean).join(" ")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectExam(exam);
                      }}
                    >
                      <strong>{`${exam.course_code} - ${courseNameByCode[exam.course_code] ?? exam.course_code}`}</strong>
                    </button>
                    {showConflictNote ? (
                      <div className={activeConflict?.severity === "error" ? "calendar-conflict-note severity-error" : "calendar-conflict-note severity-warning"}>
                        {activeConflict?.message}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        });

        return [
          ...dayCells,
          <div key={dateText} className={isSaturday ? "calendar-date-rail blocked" : "calendar-date-rail"}>
            <strong>{formatCalendarLabel(dateText)}</strong>
            <span>{weekdayLabel}</span>
            <span>Day {diffDays(project.moed_a_window.start_date, dateText) + 1}</span>
          </div>,
        ];
      })}
    </div>
  );
}
