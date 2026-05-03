import { getSolutionMetrics } from "../../utils/calendarUtils";
import type { ScheduleSolution } from "../../types";

export function ComparisonDashboard({
  solutions,
  activeSolutionId,
  onSelectSolution,
}: {
  solutions: ScheduleSolution[];
  activeSolutionId: string | null;
  onSelectSolution: (solutionId: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="comparison-table">
        <thead>
          <tr>
            <th>Solution</th>
            <th>Score</th>
            <th>Avg. gap</th>
            <th>Min gap</th>
            <th>Weekend exams</th>
            <th>High-failure conflicts</th>
            <th>Manual edits</th>
          </tr>
        </thead>
        <tbody>
          {solutions.map((solution) => {
            const metrics = getSolutionMetrics(solution);
            return (
              <tr
                key={solution.solution_id}
                className={solution.solution_id === activeSolutionId ? "comparison-row active" : "comparison-row"}
                onClick={() => onSelectSolution(solution.solution_id)}
              >
                <td>{solution.solution_id}</td>
                <td>{solution.score}</td>
                <td>{metrics.averageGap}</td>
                <td>{metrics.minimumGap}</td>
                <td>{metrics.weekendExams}</td>
                <td>{metrics.highFailureConflicts}</td>
                <td>{metrics.manualEdits}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
