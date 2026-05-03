import type { CourseInput, ScheduleProject, ScheduleSolution, ScheduledExam } from "../../types";
import { diffDays, formatCalendarLabel, isWeekend } from "../../utils/dateHelpers";
import { getPreviewKey, hasExamChanged } from "../../utils/examKeys";
import { getPreviewStatus, type PreviewResponse } from "../../utils/workspaceUtils";

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
  onSelectExam: (exam: ScheduledExam) => void;
  onSelectPreviewDate: (date: string) => void;
}) {
  return (
    <div className="calendar-board">
      <div className="calendar-corner">Semester</div>
      {calendarDays.map((dateText) => (
        <div key={dateText} className={isWeekend(dateText) ? "calendar-date weekend" : "calendar-date"}>
          <strong>{formatCalendarLabel(dateText)}</strong>
          <span>Day {diffDays(project.moed_a_window.start_date, dateText) + 1}</span>
        </div>
      ))}

      {semesterRows.flatMap((semesterNumber) => {
        const rowCells = calendarDays.map((dateText) => {
          const rowExams = solution.exams.filter(
            (exam) => courseByCode[exam.course_code]?.semester_number === semesterNumber && exam.exam_date === dateText,
          );
          const previewKey = selectedExam ? getPreviewKey(solution.solution_id, selectedExam.course_code, dateText) : null;
          const previewResponse = previewKey ? previewResponses[previewKey] : undefined;
          const cellPreviewStatus = getPreviewStatus(solution, dateText, selectedExam, previewResponse);
          const inFocusWindow = selectedExam ? diffDays(selectedExam.exam_date, dateText) <= 3 : true;
          const cellClassName = [
            "calendar-slot",
            selectedExam && !inFocusWindow ? "dimmed" : "",
            selectedExam && courseByCode[selectedExam.course_code]?.semester_number === semesterNumber ? `preview-${cellPreviewStatus}` : "",
            selectedPreviewDate === dateText ? "preview-target" : "",
          ]
            .filter(Boolean)
            .join(" ");

          return (
            <div
              key={`${semesterNumber}-${dateText}`}
              className={cellClassName}
              onClick={() => {
                if (selectedExam && courseByCode[selectedExam.course_code]?.semester_number === semesterNumber) {
                  onSelectPreviewDate(dateText);
                }
              }}
            >
              {selectedExam && courseByCode[selectedExam.course_code]?.semester_number === semesterNumber && previewLoading ? (
                <span className="preview-pulse" />
              ) : null}
              {rowExams.map((exam) => {
                const semesterTone = `semester-tone-${semesterNumber % 4}`;
                const selected = selectedExam?.course_code === exam.course_code;
                const changed = showChanges && hasExamChanged(solution, exam.course_code);

                return (
                  <button
                    key={`${exam.course_code}-${exam.exam_date}`}
                    type="button"
                    className={["exam-chip", semesterTone, selected ? "selected" : "", changed ? "changed" : ""].filter(Boolean).join(" ")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectExam(exam);
                    }}
                  >
                    <strong>{exam.course_code}</strong>
                    <span>{courseNameByCode[exam.course_code] ?? exam.course_code}</span>
                  </button>
                );
              })}
            </div>
          );
        });

        return [
          <div key={`label-${semesterNumber}`} className="calendar-row-label">
            <strong>Sem {semesterNumber}</strong>
            <span>{project.courses.filter((course) => course.semester_number === semesterNumber).length} courses</span>
          </div>,
          ...rowCells,
        ];
      })}
    </div>
  );
}
