import { getSolutionMetrics } from "../../utils/calendarUtils";
import type { CourseInput, ScheduleSolution } from "../../types";
import { getDepartmentClassName } from "../../utils/departmentUtils";

export function ComparisonDashboard({
  solutions,
  activeSolutionId,
  courseByCode,
  onSelectSolution,
}: {
  solutions: ScheduleSolution[];
  activeSolutionId: string | null;
  courseByCode: Record<string, CourseInput>;
  onSelectSolution: (solutionId: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="comparison-table">
        <thead>
          <tr>
            <th>Solution</th>
            <th>Score</th>
            <th>Target gap</th>
            <th>Spread score</th>
            <th>Semester gaps</th>
            <th>Tightest semester</th>
            <th>Weekend exams</th>
            <th>High-failure conflicts</th>
            <th>Shared</th>
            <th>SW</th>
            <th>IS</th>
            <th>Manual edits</th>
          </tr>
        </thead>
        <tbody>
          {solutions.map((solution) => {
            const metrics = getSolutionMetrics(solution, courseByCode);
            const departmentCounts = solution.exams.reduce(
              (counts, exam) => {
                const course = courseByCode[exam.course_code];
                if (course?.department === "SW") {
                  counts.sw += 1;
                } else if (course?.department === "IS") {
                  counts.is += 1;
                } else {
                  counts.shared += 1;
                }
                return counts;
              },
              { shared: 0, sw: 0, is: 0 },
            );

            return (
              <tr
                key={solution.solution_id}
                className={solution.solution_id === activeSolutionId ? "comparison-row active" : "comparison-row"}
                onClick={() => onSelectSolution(solution.solution_id)}
              >
                <td>{solution.solution_id}</td>
                <td>{solution.score}</td>
                <td>{solution.diagnostics.target_gap_days}d</td>
                <td>{solution.diagnostics.spacing_score}</td>
                <td className="comparison-semester-gaps">{metrics.semesterGapSummary}</td>
                <td>{metrics.tightestSemesterLabel}</td>
                <td>{metrics.weekendExams}</td>
                <td>{metrics.highFailureConflicts}</td>
                <td>
                  <span className={["comparison-metric-pill", getDepartmentClassName({ department: null })].join(" ")}>{departmentCounts.shared}</span>
                </td>
                <td>
                  <span className={["comparison-metric-pill", getDepartmentClassName({ department: "SW" })].join(" ")}>{departmentCounts.sw}</span>
                </td>
                <td>
                  <span className={["comparison-metric-pill", getDepartmentClassName({ department: "IS" })].join(" ")}>{departmentCounts.is}</span>
                </td>
                <td>{metrics.manualEdits}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
