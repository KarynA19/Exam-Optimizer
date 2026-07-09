import { useEffect, useMemo, useRef, useState } from "react";
import { Lock } from "lucide-react";

import type { CourseInput, FixedExam, ScheduleProject, ScheduleSolution, ScheduledExam, ValidationIssue } from "../../types";
import { getDepartmentClassName, getDepartmentLabel, getDepartmentShortLabel } from "../../utils/departmentUtils";
import { diffDays, formatDisplayDate, toDate } from "../../utils/dateHelpers";
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
  examSearchQuery,
  onSelectExam,
  onClearSelectedExam,
  onSelectPreviewDate,
  onDropExam,
  onDepartmentFilterChange,
  interactionsEnabled,
  onExamDoubleClick,
  onExamLock,
  onExamUnlock,
  onExamEditDate,
  isExamLocked,
  isExamFixed,
}: {
  project: ScheduleProject;
  solution: ScheduleSolution;
  calendarDays: string[];
  selectedMoedNumber: number;
  semesterRows: number[];
  examSearchQuery: string;
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
  onClearSelectedExam: () => void;
  onSelectPreviewDate: (date: string) => void;
  onDropExam: (exam: ScheduledExam, targetDate: string, semesterNumber: number) => void;
  onDepartmentFilterChange: (filter: "all" | "sw" | "is") => void;
  interactionsEnabled: boolean;
  onExamDoubleClick: (exam: ScheduledExam) => void;
  onExamLock: (exam: ScheduledExam) => void;
  onExamUnlock: (exam: ScheduledExam) => void;
  onExamEditDate: (exam: ScheduledExam) => void;
  isExamLocked: (exam: ScheduledExam) => boolean;
  isExamFixed: (exam: ScheduledExam) => boolean;
}) {
  const examRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [contextMenu, setContextMenu] = useState<{ exam: ScheduledExam; x: number; y: number } | null>(null);
  const visibleExams = solution.exams.filter((exam) => exam.moed_number === selectedMoedNumber);
  const normalizedSearchQuery = examSearchQuery.trim().toLowerCase();
  const hasSearchQuery = normalizedSearchQuery.length > 0;
  const issueByExamKey = useMemo(() => {
    const severityRank = { warning: 1, error: 2 } as const;
    const issueMap = new Map<string, ValidationIssue>();

    for (const issue of solution.issues) {
      if (!issue.related_course_code || !issue.related_date) {
        continue;
      }

      const match = visibleExams.find(
        (exam) => exam.course_code === issue.related_course_code && exam.exam_date === issue.related_date,
      );
      if (!match) {
        continue;
      }

      const issueKey = `${match.course_code}|${match.moed_number}|${match.exam_date}`;
      const existingIssue = issueMap.get(issueKey);
      if (!existingIssue || severityRank[issue.severity] > severityRank[existingIssue.severity]) {
        issueMap.set(issueKey, issue);
      }
    }

    return issueMap;
  }, [solution.issues, visibleExams]);
  const semesterSet = new Set(semesterRows);
  const yearGroups = YEAR_GROUPS.map((group) => ({
    ...group,
    semesters: group.semesters.filter((semester) => semesterSet.has(semester)),
  })).filter((group) => group.semesters.length > 0);
  const yearBoundarySemesters = new Set(
    yearGroups.slice(0, -1).map((group) => group.semesters[group.semesters.length - 1]),
  );
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
  const fixedExamByCourseCode = useMemo(() => {
    const map = new Map<string, FixedExam>();
    for (const fixedExam of project.fixed_exams) {
      map.set(fixedExam.course_code, fixedExam);
    }
    return map;
  }, [project.fixed_exams]);

  function getExamSemester(exam: ScheduledExam): number | null {
    const fixedExamSemester = fixedExamByCourseCode.get(exam.course_code)?.semester_number;
    if (exam.source === "fixed" && typeof fixedExamSemester === "number") {
      return fixedExamSemester;
    }
    return courseByCode[exam.course_code]?.semester_number ?? null;
  }

  function getMoedWindowForDate(dateText: string) {
    return project.moed_windows.find((window) => window.start_date <= dateText && dateText <= window.end_date) ?? null;
  }

  const rowMinHeightByDate = useMemo(() => {
    const courseSemesterMap = new Map(Object.values(courseByCode).map((course) => [course.course_code, course.semester_number]));
    const fixedSemesterMap = new Map(project.fixed_exams.map((fixedExam) => [fixedExam.course_code, fixedExam.semester_number]));
    const countByDateSemester = new Map<string, number>();

    for (const exam of visibleExams) {
      const semesterNumber = fixedSemesterMap.get(exam.course_code) ?? courseSemesterMap.get(exam.course_code);
      if (!semesterNumber) {
        continue;
      }
      const dateSemesterKey = `${exam.exam_date}|${semesterNumber}`;
      countByDateSemester.set(dateSemesterKey, (countByDateSemester.get(dateSemesterKey) ?? 0) + 1);
    }

    const minHeightMap = new Map<string, number>();
    for (const dateText of calendarDays) {
      let maxInRow = 1;
      for (const semesterNumber of semesterRows) {
        maxInRow = Math.max(maxInRow, countByDateSemester.get(`${dateText}|${semesterNumber}`) ?? 0);
      }
      minHeightMap.set(dateText, 84 + Math.max(0, maxInRow - 1) * 70);
    }

    return minHeightMap;
  }, [calendarDays, courseByCode, project.fixed_exams, semesterRows, visibleExams]);

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

  useEffect(() => {
    if (!selectedExam) {
      return;
    }

    const handleOutsideExamClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      if (target.closest(".exam-chip") || target.closest(".calendar-context-menu")) {
        return;
      }

      onClearSelectedExam();
    };

    document.addEventListener("click", handleOutsideExamClick);
    return () => {
      document.removeEventListener("click", handleOutsideExamClick);
    };
  }, [onClearSelectedExam, selectedExam]);

  return (
    <div className="calendar-visual-stack">
      <div
        className="calendar-board calendar-board-timetable"
        style={{ gridTemplateColumns: `repeat(${semesterRows.length}, minmax(108px, 1fr)) 132px` }}
      >
      {yearGroups.map((group, index) => (
        <div
          key={group.label}
          className={[
            "calendar-year-group",
            index < yearGroups.length - 1 ? "year-group-boundary" : "",
          ].filter(Boolean).join(" ")}
          style={{ gridColumn: `span ${group.semesters.length}`, gridRow: 1 }}
        >
          <strong>{group.label}</strong>
        </div>
      ))}
      <div
        className="calendar-year-group calendar-date-corner"
        style={{ gridColumn: `${semesterRows.length + 1}`, gridRow: 1 }}
      />
      <div
        className="calendar-date-rail calendar-date-rail-header"
        style={{ gridColumn: `${semesterRows.length + 1}`, gridRow: 2 }}
      >
        <strong>Date</strong>
      </div>

      {semesterRows.map((semesterNumber) => (
        <div
          key={`label-${semesterNumber}`}
          className={[
            "calendar-semester-heading",
            yearBoundarySemesters.has(semesterNumber) ? "year-boundary" : "",
          ].filter(Boolean).join(" ")}
          style={{ gridRow: 2 }}
        >
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
        const moedDay = moedWindow ? diffDays(moedWindow.start_date, dateText) + 1 : 1;
        const monthDayLabel = date.toLocaleDateString(undefined, { month: "long", day: "numeric" });

        const dayCells = semesterRows.map((semesterNumber) => {
          const rowExams = visibleExams.filter(
            (exam) => getExamSemester(exam) === semesterNumber && exam.exam_date === dateText,
          );
          const previewKey = selectedExam ? getPreviewKey(solution.solution_id, selectedExam.course_code, selectedExam.moed_number, dateText) : null;
          const previewResponse = previewKey ? previewResponses[previewKey] : undefined;
          const cellPreviewStatus = getPreviewStatus(solution, dateText, selectedExam, previewResponse);
          const inFocusWindow = selectedExam ? diffDays(selectedExam.exam_date, dateText) <= 3 : true;
          const selectedSemester = selectedExam
            ? getExamSemester(selectedExam) === semesterNumber
            : false;
          const canPreview = selectedSemester && !isSaturday && !isExcluded;
          const cellClassName = [
            "calendar-slot",
            yearBoundarySemesters.has(semesterNumber) ? "year-boundary" : "",
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
              style={{ minHeight: `${rowMinHeightByDate.get(dateText) ?? 84}px` }}
              title={isSaturday ? "Unavailable" : excludedReason ?? undefined}
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
              {rowExams.map((exam) => {
                const examIssue = issueByExamKey.get(`${exam.course_code}|${exam.moed_number}|${exam.exam_date}`);
                const selected = selectedExam?.course_code === exam.course_code && selectedExam.moed_number === exam.moed_number;
                const conflictFocused = Boolean(
                  activeConflict?.related_course_code
                  && activeConflict?.related_date
                  && activeConflict.related_course_code === exam.course_code
                  && activeConflict.related_date === exam.exam_date,
                );
                const changed = showChanges && hasExamChanged(solution, exam.course_code, exam.moed_number);
                const locked = isExamLocked(exam);
                const fixedExam = isExamFixed(exam);
                const constrained = locked || fixedExam;
                const course = courseByCode[exam.course_code];
                const courseName = courseNameByCode[exam.course_code] ?? exam.course_code;
                const departmentMatchesFilter = matchesDepartmentFilter(course, departmentFilter);
                const examMatchesSearch = matchesExamSearch(exam, normalizedSearchQuery, courseNameByCode);

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
                        conflictFocused ? "conflict-focused" : "",
                        changed ? "changed" : "",
                        fixedExam ? "fixed-source" : "",
                        hasSearchQuery && examMatchesSearch ? "search-match" : "",
                        (departmentFilter !== "all" && !departmentMatchesFilter) || !examMatchesSearch ? "filtered-out" : "",
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
                        if (fixedExam) {
                          return;
                        }
                        event.stopPropagation();
                        if (locked) {
                          onExamUnlock(exam);
                          return;
                        }
                        onExamLock(exam);
                      }}
                      onContextMenu={(event) => {
                        if (!interactionsEnabled) {
                          return;
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        setContextMenu({ exam, x: event.clientX, y: event.clientY });
                      }}
                      draggable={interactionsEnabled && !locked}
                      onDragStart={(event) => {
                        if (!interactionsEnabled || locked) {
                          return;
                        }
                        event.dataTransfer.setData("text/plain", `${exam.course_code}|${exam.moed_number}|${exam.exam_date}`);
                        event.dataTransfer.effectAllowed = "move";
                      }}
                      title={getDepartmentLabel(course)}
                    >
                      <span className="exam-chip-indicators">
                        {locked ? <Lock className="exam-chip-lock" aria-hidden="true" /> : null}
                        {examIssue ? (
                          <span
                            className={examIssue.severity === "error" ? "calendar-conflict-dot severity-error" : "calendar-conflict-dot severity-warning"}
                            title={examIssue.message}
                            aria-label={examIssue.message}
                          />
                        ) : null}
                      </span>
                      <div className="exam-chip-title-row">
                        <strong className="exam-chip-code">{exam.course_code}</strong>
                      </div>
                      <p className="exam-chip-name">{courseName}</p>
                      <span className="exam-chip-meta">
                        <span className={["department-badge", getDepartmentClassName(course)].join(" ")}>{getDepartmentShortLabel(course)}</span>
                      </span>
                    </button>
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
                      if (currentExam?.exam_date === originalExam.exam_date) {
                        return false;
                      }
                      return true;
                    })
                    .map((originalExam) => {
                      const originalCourse = courseByCode[originalExam.course_code];
                      const originalExamMatchesSearch = matchesExamSearch(originalExam, normalizedSearchQuery, courseNameByCode);
                      return (
                        <div
                          key={`original-${originalExam.course_code}-${originalExam.moed_number}-${originalExam.exam_date}`}
                          className={[
                            "exam-chip",
                            "original-slot-marker",
                            hasSearchQuery && originalExamMatchesSearch ? "search-match" : "",
                            originalExamMatchesSearch ? "" : "filtered-out",
                          ].filter(Boolean).join(" ")}
                        >
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
          <div
            key={dateText}
            className={isSaturday || isExcluded ? "calendar-date-rail blocked excluded" : "calendar-date-rail"}
            style={{ minHeight: `${rowMinHeightByDate.get(dateText) ?? 84}px` }}
          >
            <strong>{`${weekdayLabel}, ${monthDayLabel} - Day ${moedDay}`}</strong>
          </div>,
        ];
      })}
      </div>
      {contextMenu ? (
        <div className="calendar-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button type="button" onClick={() => onExamDoubleClick(contextMenu.exam)}>Edit course details</button>
          <button type="button" onClick={() => onExamEditDate(contextMenu.exam)}>Edit exam date</button>
          {isExamFixed(contextMenu.exam) ? (
            <button type="button" disabled>Fixed exam</button>
          ) : isExamLocked(contextMenu.exam) ? (
            <button type="button" onClick={() => onExamUnlock(contextMenu.exam)}>Unlock exam</button>
          ) : (
            <button type="button" onClick={() => onExamLock(contextMenu.exam)}>Lock exam</button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function matchesExamSearch(
  exam: { course_code: string },
  normalizedSearchQuery: string,
  courseNameByCode: Record<string, string>,
): boolean {
  if (!normalizedSearchQuery) {
    return true;
  }

  const courseCode = exam.course_code.toLowerCase();
  const courseName = (courseNameByCode[exam.course_code] ?? "").toLowerCase();
  return courseCode.includes(normalizedSearchQuery) || courseName.includes(normalizedSearchQuery);
}


function matchesDepartmentFilter(course: CourseInput | undefined, filter: "all" | "sw" | "is"): boolean {
  if (filter === "all") {
    return true;
  }
  if (!course?.department) {
    return false;
  }
  if (filter === "sw") {
    return course.department === "SW";
  }
  return course.department === "IS";
}
