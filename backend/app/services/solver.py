from __future__ import annotations

import sys

# OR-Tools prints DLL load paths during import on Windows. Reconfigure the streams
# before the import so non-ASCII workspace paths do not crash under legacy code pages.
if sys.platform == "win32":
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream is not None and hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")

from ortools.sat.python import cp_model

from app.models.schedule import ScheduledExam, ScheduleSolution, SolveRequest, ValidationIssue
from app.services.validation import (
    iter_allowed_dates,
    pair_prefers_adjacent_semester_spacing,
    pair_required_gap_days,
    score_solution,
    validate_solution_exams,
)


def solve_project(request: SolveRequest) -> dict:
    project = request.project
    candidate_dates = iter_allowed_dates(project)
    if not candidate_dates:
        issue = ValidationIssue(
            code="no_feasible_schedule",
            severity="error",
            message="No candidate exam dates remain after applying the Moed A window and exclusions.",
        )
        return {"project_name": project.project_name, "solutions": [], "issues": [issue.model_dump()]}

    date_to_index = {candidate_date: index for index, candidate_date in enumerate(candidate_dates)}
    fixed_exam_lookup = {fixed_exam.course_code: fixed_exam for fixed_exam in project.fixed_exams}
    courses = project.courses
    horizon = max(len(candidate_dates) - 1, 0)

    model = cp_model.CpModel()
    exam_vars: dict[str, cp_model.IntVar] = {}
    pair_gap_vars: list[cp_model.IntVar] = []
    adjacent_semester_same_day_vars: list[cp_model.BoolVar] = []

    for course in courses:
        fixed_exam = fixed_exam_lookup.get(course.course_code)
        if fixed_exam is None:
            exam_vars[course.course_code] = model.NewIntVar(0, horizon, f"exam_{course.course_code}")
            continue

        fixed_index = date_to_index.get(fixed_exam.exam_date)
        if fixed_index is None:
            issue = ValidationIssue(
                code="no_feasible_schedule",
                severity="error",
                message=f"Fixed exam for {course.course_code} is not schedulable because its date is excluded.",
                related_course_code=course.course_code,
                related_date=fixed_exam.exam_date,
            )
            return {"project_name": project.project_name, "solutions": [], "issues": [issue.model_dump()]}
        exam_vars[course.course_code] = model.NewIntVar(fixed_index, fixed_index, f"exam_{course.course_code}")

    for index, course in enumerate(courses):
        for other_course in courses[index + 1 :]:
            min_gap = pair_required_gap_days(project, course, other_course)

            if min_gap > 0:
                gap_var = model.NewIntVar(0, horizon, f"gap_{course.course_code}_{other_course.course_code}")
                model.AddAbsEquality(gap_var, exam_vars[course.course_code] - exam_vars[other_course.course_code])
                model.Add(gap_var >= min_gap)
                pair_gap_vars.append(gap_var)

            if pair_prefers_adjacent_semester_spacing(course, other_course):
                same_day_var = model.NewBoolVar(f"same_day_{course.course_code}_{other_course.course_code}")
                model.Add(exam_vars[course.course_code] == exam_vars[other_course.course_code]).OnlyEnforceIf(same_day_var)
                model.Add(exam_vars[course.course_code] != exam_vars[other_course.course_code]).OnlyEnforceIf(same_day_var.Not())
                adjacent_semester_same_day_vars.append(same_day_var)

    if pair_gap_vars or adjacent_semester_same_day_vars:
        model.Maximize(sum(pair_gap_vars) - sum(adjacent_semester_same_day_vars))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10

    solutions: list[ScheduleSolution] = []

    for solution_index in range(request.max_solutions):
        status = solver.Solve(model)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            break

        exams = [
            ScheduledExam(
                course_code=course.course_code,
                exam_date=candidate_dates[solver.Value(exam_vars[course.course_code])],
                source="fixed" if course.course_code in fixed_exam_lookup else "solver",
            )
            for course in courses
        ]
        issues = validate_solution_exams(project, exams)
        solutions.append(
            ScheduleSolution(
                solution_id=f"solution-{solution_index + 1}",
                score=score_solution(project, exams),
                exams=sorted(exams, key=lambda exam: (exam.exam_date, exam.course_code)),
                issues=issues,
            )
        )

        same_value_flags: list[cp_model.BoolVar] = []
        for course in courses:
            fixed_value = solver.Value(exam_vars[course.course_code])
            same_value = model.NewBoolVar(f"same_{solution_index}_{course.course_code}")
            model.Add(exam_vars[course.course_code] == fixed_value).OnlyEnforceIf(same_value)
            model.Add(exam_vars[course.course_code] != fixed_value).OnlyEnforceIf(same_value.Not())
            same_value_flags.append(same_value)
        model.Add(sum(same_value_flags) <= len(courses) - 1)

    if not solutions:
        issue = ValidationIssue(
            code="no_feasible_schedule",
            severity="error",
            message="No feasible schedule was found for the current hard constraints.",
        )
        return {"project_name": project.project_name, "solutions": [], "issues": [issue.model_dump()]}

    return {
        "project_name": project.project_name,
        "solutions": [solution.model_dump(mode="json") for solution in solutions],
        "issues": [],
    }
