import { useEffect, useRef } from "react";

import type { CourseInput, ScheduleProject, ScheduleSolution, ScheduledExam, ValidationIssue } from "../../types";
import { getDepartmentClassName, getDepartmentLabel, getDepartmentShortLabel } from "../../utils/departmentUtils";
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
  selectedMoedNumber,
  semesterRows,
  courseNameByCode,
  courseByCode,
  selectedExam,
  selectedPreviewDate,
  previewResponses,
  previewLoading,
  showChanges,
  departmentFilter,
  activeConflict,
  onSelectExam,
  onSelectPreviewDate,
}: {
  project: ScheduleProject;
  solution: ScheduleSolution;
  calendarDays: string[];
  selectedMoedNumber: number;
  semesterRows: number[];
  courseNameByCode: Record<string, string>;
  courseByCode: Record<string, CourseInput>;
  selectedExam: ScheduledExam | null;
  selectedPreviewDate: string | null;
  previewResponses: Record<string, PreviewResponse>;
  previewLoading: boolean;
  showChanges: boolean;
  departmentFilter: "all" | "sw" | "is";
  activeConflict: ValidationIssue | null;
  onSelectExam: (exam: ScheduledExam) => void;
  onSelectPreviewDate: (date: string) => void;
}) {
  const examRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const visibleExams = solution.exams.filter((exam) => exam.moed_number === selectedMoedNumber);
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
  const departmentInfographic = [
    {
      key: "all",
      title: "All departments",
      description: "All exams in the selected Moed window.",
      total: project.courses.length,
      scheduled: visibleExams.length,
      fridayUsage: visibleExams.filter((exam) => toDate(exam.exam_date).getDay() === 5).length,
    },
    {
      key: "sw",
      title: "SW Department",
      description: "SW and shared exams stay vivid; IS exams are dimmed.",
      total: project.courses.filter((course) => course.department === "SW").length,
      scheduled: visibleExams.filter((exam) => [null, "SW"].includes(courseByCode[exam.course_code]?.department ?? null)).length,
      fridayUsage: visibleExams.filter((exam) => [null, "SW"].includes(courseByCode[exam.course_code]?.department ?? null) && toDate(exam.exam_date).getDay() === 5).length,
    },
    {
      key: "is",
      title: "IS Department",
      description: "IS and shared exams stay vivid; SW exams are dimmed.",
      total: project.courses.filter((course) => course.department === "IS").length,
      scheduled: visibleExams.filter((exam) => [null, "IS"].includes(courseByCode[exam.course_code]?.department ?? null)).length,
      fridayUsage: visibleExams.filter((exam) => [null, "IS"].includes(courseByCode[exam.course_code]?.department ?? null) && toDate(exam.exam_date).getDay() === 5).length,
    },
  ];

  function getMoedWindowForDate(dateText: string) {
    return project.moed_windows.find((window) => window.start_date <= dateText && dateText <= window.end_date) ?? null;
  }

  useEffect(() => {
    if (!activeConflictCourseCode || !activeConflictDate) {
      return;
    }

    examRefs.current[`${activeConflictCourseCode}|${selectedMoedNumber}|${activeConflictDate}`]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "center",
    });
  }, [activeConflictCourseCode, activeConflictDate]);

  return (
    <div className="calendar-visual-stack">
      <div className="department-infographic" aria-label="Department scheduling legend and summary">
        <div className="department-legend" role="list" aria-label="Department color legend">
          {departmentInfographic.map((item) => (
            <div key={`legend-${item.key}`} className="department-legend-item" role="listitem">
              <span className={["department-swatch", `department-${item.key}`].join(" ")} />
              <div>
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="department-stat-grid">
          {departmentInfographic.map((item) => (
            <article key={item.key} className={["department-stat-card", `department-${item.key}`].join(" ")}>
              <span className="department-stat-kicker">Department load</span>
              <strong>{item.title}</strong>
              <div className="department-stat-metrics">
                <span>{item.total} courses</span>
                <span>{item.scheduled} scheduled</span>
                <span>Friday usage {Math.min(item.fridayUsage, 1)}/1</span>
              </div>
            </article>
          ))}
        </div>
      </div>
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
        <span>Moed windows</span>
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
        const moedWindow = getMoedWindowForDate(dateText);
        const moedLabel = moedWindow ? `Moed ${String.fromCharCode(64 + moedWindow.moed_number)}` : "Moed";
        const moedDay = moedWindow ? diffDays(moedWindow.start_date, dateText) + 1 : 1;

        const dayCells = semesterRows.map((semesterNumber) => {
          const rowExams = visibleExams.filter(
            (exam) => courseByCode[exam.course_code]?.semester_number === semesterNumber && exam.exam_date === dateText,
          );
          const previewKey = selectedExam ? getPreviewKey(solution.solution_id, selectedExam.course_code, selectedExam.moed_number, dateText) : null;
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
                const selected = selectedExam?.course_code === exam.course_code && selectedExam.moed_number === exam.moed_number;
                const changed = showChanges && hasExamChanged(solution, exam.course_code, exam.moed_number);
                const course = courseByCode[exam.course_code];
                const departmentMatchesFilter = matchesDepartmentFilter(course, departmentFilter);
                const matchesConflictCourse = activeConflict?.related_course_code
                  ? activeConflict.related_course_code === exam.course_code
                  : selectedExam?.course_code === exam.course_code;
                const matchesConflictDate = activeConflict?.related_date
                  ? activeConflict.related_date === exam.exam_date
                  : selectedExam?.exam_date === exam.exam_date;
                const showConflictNote = Boolean(activeConflict && matchesConflictCourse && matchesConflictDate);

                return (
                  <div key={`${exam.course_code}-${exam.moed_number}-${exam.exam_date}`} className="calendar-event-stack">
                    <button
                      ref={(element) => {
                        examRefs.current[`${exam.course_code}|${exam.moed_number}|${exam.exam_date}`] = element;
                      }}
                      type="button"
                      className={[
                        "exam-chip",
                        getDepartmentClassName(course),
                        selected ? "selected" : "",
                        changed ? "changed" : "",
                        departmentFilter !== "all" && !departmentMatchesFilter ? "filtered-out" : "",
                      ].filter(Boolean).join(" ")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectExam(exam);
                      }}
                      title={getDepartmentLabel(course)}
                    >
                      <strong>{`${exam.course_code} - ${courseNameByCode[exam.course_code] ?? exam.course_code}`}</strong>
                      <span className="exam-chip-meta">
                        <span className={["department-badge", getDepartmentClassName(course)].join(" ")}>{getDepartmentShortLabel(course)}</span>
                        <span>Semester {course?.semester_number ?? semesterNumber}</span>
                      </span>
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
            <span>{moedLabel} Day {moedDay}</span>
          </div>,
        ];
      })}
      </div>
    </div>
  );
}


function matchesDepartmentFilter(course: CourseInput | undefined, filter: "all" | "sw" | "is"): boolean {
  if (filter === "all" || !course?.department) {
    return true;
  }
  if (filter === "sw") {
    return course.department !== "IS";
  }
  return course.department !== "SW";
}
