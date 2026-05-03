import { IssueList } from "../common/IssueList";
import type { CourseInput, ScheduleSolution, ScheduledExam } from "../../types";
import { getExamMoveKey, getOriginalExam, hasExamChanged } from "../../utils/examKeys";

export function SolutionCard({
  solution,
  courseNameByCode,
  courseByCode,
  moveDrafts,
  movingExamKey,
  disabled,
  showChanges,
  onDraftChange,
  onMove,
}: {
  solution: ScheduleSolution;
  courseNameByCode: Record<string, string>;
  courseByCode: Record<string, CourseInput>;
  moveDrafts: Record<string, string>;
  movingExamKey: string | null;
  disabled: boolean;
  showChanges: boolean;
  onDraftChange: (solutionId: string, courseCode: string, nextDate: string) => void;
  onMove: (solution: ScheduleSolution, exam: ScheduledExam) => void;
}) {
  return (
    <article className="solution-card">
      <div className="solution-header">
        <div className="solution-meta">
          <strong>{solution.solution_id}</strong>
          <span>{solution.exams.length} scheduled exams</span>
        </div>
        <span>Score {solution.score}</span>
      </div>

      <div className="table-wrap">
        <table className="solution-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Semester</th>
              <th>Prerequisite</th>
              <th>Current date</th>
              <th>Original date</th>
              <th>Source</th>
              <th>New date</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {solution.exams.length === 0 ? (
              <tr>
                <td colSpan={9} className="empty-row">
                  No exams in this solution.
                </td>
              </tr>
            ) : (
              solution.exams.map((exam) => {
                const moveKey = getExamMoveKey(solution.solution_id, exam.course_code);
                const draftDate = moveDrafts[moveKey] ?? exam.exam_date;
                const isMoving = movingExamKey === moveKey;
                const originalExam = getOriginalExam(solution, exam.course_code);
                const changed = showChanges && hasExamChanged(solution, exam.course_code);
                const course = courseByCode[exam.course_code];

                return (
                  <tr key={moveKey} className={changed ? "changed-row" : undefined}>
                    <td>{exam.course_code}</td>
                    <td>{courseNameByCode[exam.course_code] ?? "Unknown course"}</td>
                    <td>{course?.semester_number ?? "-"}</td>
                    <td>{course?.prerequisite_course_code ?? "-"}</td>
                    <td>{exam.exam_date}</td>
                    <td>{originalExam?.exam_date ?? "-"}</td>
                    <td>
                      <span className={`solution-source source-${exam.source}`}>{exam.source}</span>
                    </td>
                    <td>
                      <input
                        className="move-date-input"
                        type="date"
                        value={draftDate}
                        disabled={disabled}
                        onChange={(event) => onDraftChange(solution.solution_id, exam.course_code, event.target.value)}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={disabled || draftDate.length === 0}
                        onClick={() => onMove(solution, exam)}
                      >
                        {isMoving ? "Moving..." : "Move"}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <IssueList issues={solution.issues} compact />
    </article>
  );
}
