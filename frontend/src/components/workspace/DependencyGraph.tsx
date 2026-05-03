import type { CourseInput, ScheduleSolution } from "../../types";
import type { DependencyEdgeType } from "../../utils/workspaceUtils";

export function DependencyGraph({
  courses,
  solution,
  edges,
  focusCourseCode,
  changedCourseCodes,
  onSelectCourse,
}: {
  courses: CourseInput[];
  solution: ScheduleSolution | null;
  edges: Array<{ from: string; to: string; type: DependencyEdgeType }>;
  focusCourseCode: string | null;
  changedCourseCodes: string[];
  onSelectCourse: (courseCode: string) => void;
}) {
  const semesters = Array.from(new Set(courses.map((course) => course.semester_number))).sort((left, right) => left - right);
  const svgWidth = 960;
  const svgHeight = Math.max(320, semesters.length * 120);
  const nodes = courses.map((course) => {
    const rowCourses = courses.filter((candidate) => candidate.semester_number === course.semester_number);
    const rowIndex = semesters.indexOf(course.semester_number);
    const columnIndex = rowCourses.findIndex((candidate) => candidate.course_code === course.course_code);
    const x = 180 + columnIndex * 190;
    const y = 70 + rowIndex * 110;
    const activeExam = solution?.exams.find((exam) => exam.course_code === course.course_code);

    return {
      ...course,
      x,
      y,
      examDate: activeExam?.exam_date ?? null,
    };
  });

  function nodeVisible(courseCode: string) {
    if (!focusCourseCode) {
      return true;
    }

    return courseCode === focusCourseCode || edges.some((edge) => (edge.from === focusCourseCode && edge.to === courseCode) || (edge.to === focusCourseCode && edge.from === courseCode));
  }

  return (
    <div className="graph-wrap">
      <div className="graph-chip-row">
        {courses.map((course) => (
          <button
            key={course.course_code}
            type="button"
            className={course.course_code === focusCourseCode ? "solution-tab active" : "solution-tab"}
            onClick={() => onSelectCourse(course.course_code === focusCourseCode ? "" : course.course_code)}
          >
            {course.course_code}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="dependency-graph" role="img" aria-label="Course dependency graph">
        {edges.map((edge) => {
          const fromNode = nodes.find((node) => node.course_code === edge.from);
          const toNode = nodes.find((node) => node.course_code === edge.to);
          if (!fromNode || !toNode) {
            return null;
          }

          const dimmed = focusCourseCode ? !(edge.from === focusCourseCode || edge.to === focusCourseCode) : false;
          return (
            <line
              key={`${edge.from}-${edge.to}-${edge.type}`}
              x1={fromNode.x}
              y1={fromNode.y}
              x2={toNode.x}
              y2={toNode.y}
              className={`graph-edge edge-${edge.type}${dimmed ? " dimmed" : ""}`}
            />
          );
        })}
        {nodes.map((node) => {
          const dimmed = !nodeVisible(node.course_code);
          const changed = changedCourseCodes.includes(node.course_code);
          return (
            <g key={node.course_code} className={dimmed ? "graph-node dimmed" : "graph-node"} onClick={() => onSelectCourse(node.course_code)}>
              <circle cx={node.x} cy={node.y} r={changed ? 34 : 28} className={changed ? "graph-node-circle changed" : "graph-node-circle"} />
              <text x={node.x} y={node.y - 4} textAnchor="middle" className="graph-node-code">
                {node.course_code}
              </text>
              <text x={node.x} y={node.y + 14} textAnchor="middle" className="graph-node-label">
                S{node.semester_number}
              </text>
              {node.examDate ? (
                <text x={node.x} y={node.y + 30} textAnchor="middle" className="graph-node-date">
                  {node.examDate.slice(5)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
