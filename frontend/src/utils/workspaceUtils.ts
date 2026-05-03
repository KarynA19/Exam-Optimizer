import type { CourseInput, ScheduleProject, ScheduleSolution, ScheduledExam, ValidationIssue } from "../types";

export type PreviewStatus = "green" | "yellow" | "red" | "idle";

export type PreviewResponse = {
  valid: boolean;
  issues: ValidationIssue[];
  updated_solution?: {
    solution_id: string;
    score: number;
    exams: ScheduledExam[];
  };
};

export type DependencyEdgeType = "semester" | "prerequisite" | "high-failure";

export function buildDependencyEdges(project: ScheduleProject) {
  const edges: Array<{ from: string; to: string; type: DependencyEdgeType }> = [];

  for (let index = 0; index < project.courses.length; index += 1) {
    const course = project.courses[index];

    for (const otherCourse of project.courses.slice(index + 1)) {
      if (course.prerequisite_course_code === otherCourse.course_code || otherCourse.prerequisite_course_code === course.course_code) {
        edges.push({ from: course.course_code, to: otherCourse.course_code, type: "prerequisite" });
        continue;
      }

      if (course.semester_number === otherCourse.semester_number) {
        edges.push({ from: course.course_code, to: otherCourse.course_code, type: "semester" });
        continue;
      }

      if ((course.high_failure_rate && [2, 3].includes(otherCourse.semester_number)) || (otherCourse.high_failure_rate && [2, 3].includes(course.semester_number))) {
        edges.push({ from: course.course_code, to: otherCourse.course_code, type: "high-failure" });
      }
    }
  }

  return edges;
}

export function getPreviewStatus(solution: ScheduleSolution, dateText: string, selectedExam: ScheduledExam | null, previewResponse?: PreviewResponse): PreviewStatus {
  if (!selectedExam || !previewResponse) {
    return "idle";
  }

  if (!previewResponse.valid) {
    return "red";
  }

  if (dateText === selectedExam.exam_date) {
    return "green";
  }

  return (previewResponse.updated_solution?.score ?? solution.score) < solution.score ? "yellow" : "green";
}
