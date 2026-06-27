import { useEffect, useMemo, useRef, useState } from "react";

import type { CourseInput, ScheduleProject, ScheduleSolution, ScheduledExam, ValidationIssue } from "../../types";
import { getDepartmentClassName, getDepartmentLabel, getDepartmentShortLabel } from "../../utils/departmentUtils";
import { diffDays, formatCalendarLabel, formatDisplayDate, toDate } from "../../utils/dateHelpers";
import { getPreviewKey, hasExamChanged } from "../../utils/examKeys";
import { getExcludedDateReason } from "../../utils/calendarUtils";
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
  onDropExam,
  onDepartmentFilterChange,
  interactionsEnabled,
  onExamDoubleClick,
  onExamLock,
  onExamUnlock,
  onExamEditDate,
  isExamLocked,
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
  onDropExam: (exam: ScheduledExam, targetDate: string, semesterNumber: number) => void;
  onDepartmentFilterChange: (filter: "all" | "sw" | "is") => void;
  interactionsEnabled: boolean;
  onExamDoubleClick: (exam: ScheduledExam) => void;
  onExamLock: (exam: ScheduledExam) => void;
  onExamUnlock: (exam: ScheduledExam) => void;
  onExamEditDate: (exam: ScheduledExam) => void;
  isExamLocked: (exam: ScheduledExam) => boolean;
}) {
  const examRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [contextMenu, setContextMenu] = useState<{ exam: ScheduledExam; x: number; y: number } | null>(null);
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
  const visibleExamByToken = useMemo(() => {
    const tokenMap = new Map<string, ScheduledExam>();
    for (const exam of visibleExams) {
      tokenMap.set(`${exam.course_code}|${exam.moed_number}|${exam.exam_date}`, exam);
    }
    return tokenMap;
  }, [visibleExams]);

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

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    const closeMenu = () => setContextMenu(null);
    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [contextMenu]);

  return (
    <div className="calendar-visual-stack">
      <div
        className="calendar-board calendar-board-timetable"
        style={{ gridTemplateColumns: `repeat(${semesterRows.length}, minmax(108px, 1fr)) 86px` }}
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
        const excludedReason = getExcludedDateReason(project, dateText);
        const isExcluded = excludedReason !== null;
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
          const canPreview = selectedSemester && !isSaturday && !isExcluded;
          const cellClassName = [
            "calendar-slot",
            selectedExam && !inFocusWindow ? "dimmed" : "",
            canPreview ? `preview-${cellPreviewStatus}` : "",
            canPreview && selectedPreviewDate === dateText ? "preview-target" : "",
            isSaturday || isExcluded ? "blocked" : "",
            isExcluded ? "excluded" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div
              key={`${semesterNumber}-${dateText}`}
              className={cellClassName}
              onClick={() => {
                if (!interactionsEnabled) {
                  return;
                }
                if (canPreview) {
                  onSelectPreviewDate(dateText);
                }
              }}
              onDragOver={(event) => {
                if (!interactionsEnabled) {
                  return;
                }
                if (!isSaturday && !isExcluded) {
                  event.preventDefault();
                }
              }}
              onDrop={(event) => {
                if (!interactionsEnabled || isSaturday || isExcluded) {
                  return;
                }
                event.preventDefault();
                const token = event.dataTransfer.getData("text/plain");
                const draggedExam = visibleExamByToken.get(token);
                if (!draggedExam || draggedExam.exam_date === dateText) {
                  return;
                }
                onDropExam(draggedExam, dateText, semesterNumber);
              }}
            >
              {canPreview && previewLoading ? <span className="preview-pulse" /> : null}
              {isSaturday || isExcluded ? <span className="calendar-blocked-note">{isExcluded ? `Unavailable: ${excludedReason}` : "Unavailable"}</span> : null}
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
                        exam.source === "fixed" || isExamLocked(exam) ? "fixed" : "",
                        departmentFilter !== "all" && !departmentMatchesFilter ? "filtered-out" : "",
                      ].filter(Boolean).join(" ")}
                      onClick={(event) => {
                        if (!interactionsEnabled) {
                          return;
                        }
                        event.stopPropagation();
                        onSelectExam(exam);
                      }}
                      onDoubleClick={(event) => {
                        if (!interactionsEnabled) {
                          return;
                        }
                        event.stopPropagation();
                        onExamDoubleClick(exam);
                      }}
                      onContextMenu={(event) => {
                        if (!interactionsEnabled) {
                          return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        setContextMenu({ exam, x: event.clientX, y: event.clientY });
                      }}
                      draggable={interactionsEnabled}
                      onDragStart={(event) => {
                        if (!interactionsEnabled) {
                          return;
                        }
                        event.dataTransfer.setData("text/plain", `${exam.course_code}|${exam.moed_number}|${exam.exam_date}`);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      title={getDepartmentLabel(course)}
                    >
                      <strong>{`${exam.course_code} - ${courseNameByCode[exam.course_code] ?? exam.course_code}`}</strong>
                      <span className="exam-chip-meta">
                        <span className={["department-badge", getDepartmentClassName(course)].join(" ")}>{getDepartmentShortLabel(course)}</span>
                        <span>Semester {course?.semester_number ?? semesterNumber}</span>
                        {exam.source === "fixed" ? <span className="source-chip">Fixed</span> : null}
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
              {showChanges
                ? (solution.original_exams ?? [])
                    .filter((originalExam) => {
                      if (originalExam.moed_number !== selectedMoedNumber || originalExam.exam_date !== dateText) {
                        return false;
                      }
                      const originalCourse = courseByCode[originalExam.course_code];
                      if (!originalCourse || originalCourse.semester_number !== semesterNumber) {
                        return false;
                      }
                      const currentExam = solution.exams.find(
                        (exam) => exam.course_code === originalExam.course_code && exam.moed_number === originalExam.moed_number,
                      );
                      return currentExam?.exam_date !== originalExam.exam_date;
                    })
                    .map((originalExam) => {
                      const originalCourse = courseByCode[originalExam.course_code];
                      return (
                        <div key={`original-${originalExam.course_code}-${originalExam.moed_number}-${originalExam.exam_date}`} className="exam-chip original-slot-marker">
                          <strong>{`${originalExam.course_code} original`}</strong>
                          <span className="exam-chip-meta">
                            <span className={["department-badge", getDepartmentClassName(originalCourse)].join(" ")}>{getDepartmentShortLabel(originalCourse)}</span>
                            <span>{formatDisplayDate(originalExam.exam_date)}</span>
                          </span>
                        </div>
                      );
                    })
                : null}
            </div>
          );
        });

        return [
          ...dayCells,
          <div key={dateText} className={isSaturday || isExcluded ? "calendar-date-rail blocked excluded" : "calendar-date-rail"}>
            <strong>{formatCalendarLabel(dateText)}</strong>
            <span>{weekdayLabel}</span>
            <span>{moedLabel} Day {moedDay}</span>
          </div>,
        ];
      })}
      </div>
      {contextMenu ? (
        <div className="calendar-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button type="button" onClick={() => onExamDoubleClick(contextMenu.exam)}>Edit course details</button>
          <button type="button" onClick={() => onExamEditDate(contextMenu.exam)}>Edit exam date</button>
          {isExamLocked(contextMenu.exam) ? (
            <button type="button" onClick={() => onExamUnlock(contextMenu.exam)}>Unlock exam</button>
          ) : (
            <button type="button" onClick={() => onExamLock(contextMenu.exam)}>Lock exam</button>
          )}
        </div>
      ) : null}
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
