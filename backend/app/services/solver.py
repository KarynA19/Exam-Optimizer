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
    ADJACENT_SEMESTER_SAME_DAY_PENALTY,
    FRIDAY_EXAM_PENALTY,
    SAME_SEMESTER_GAP_WEIGHT,
    date_is_friday,
    iter_allowed_dates,
    pair_requires_high_failure_gap,
    pair_requires_prerequisite_gap,
    pair_requires_same_semester_gap,
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

    candidate_ordinals = [candidate_date.toordinal() for candidate_date in candidate_dates]
    date_to_ordinal = {candidate_date: candidate_date.toordinal() for candidate_date in candidate_dates}
    ordinal_to_date = {candidate_date.toordinal(): candidate_date for candidate_date in candidate_dates}
    fixed_exam_lookup = {fixed_exam.course_code: fixed_exam for fixed_exam in project.fixed_exams}
    courses = project.courses
    min_ordinal = candidate_ordinals[0]
    max_ordinal = candidate_ordinals[-1]

    model = cp_model.CpModel()
    exam_vars: dict[str, cp_model.IntVar] = {}
    objective_terms: list[cp_model.LinearExpr] = []
    adjacent_semester_same_day_vars: list[cp_model.BoolVar] = []
    friday_exam_vars: list[cp_model.BoolVar] = []

    for course in courses:
        fixed_exam = fixed_exam_lookup.get(course.course_code)
        if fixed_exam is None:
            exam_vars[course.course_code] = model.NewIntVarFromDomain(
                cp_model.Domain.FromValues(candidate_ordinals),
                f"exam_{course.course_code}",
            )
            continue

        fixed_ordinal = date_to_ordinal.get(fixed_exam.exam_date)
        if fixed_ordinal is None:
            issue = ValidationIssue(
                code="no_feasible_schedule",
                severity="error",
                message=f"Fixed exam for {course.course_code} is not schedulable because its date is excluded.",
                related_course_code=course.course_code,
                related_date=fixed_exam.exam_date,
            )
            return {"project_name": project.project_name, "solutions": [], "issues": [issue.model_dump()]}
        exam_vars[course.course_code] = model.NewIntVar(fixed_ordinal, fixed_ordinal, f"exam_{course.course_code}")

    friday_ordinals = [candidate_date.toordinal() for candidate_date in candidate_dates if date_is_friday(candidate_date)]
    friday_ordinal_set = set(friday_ordinals)

    for course in courses:
        if not friday_ordinals:
            continue

        friday_var = model.NewBoolVar(f"friday_{course.course_code}")
        friday_exam_vars.append(friday_var)
        model.AddAllowedAssignments([exam_vars[course.course_code], friday_var], [[ordinal, 1] for ordinal in friday_ordinals] + [[ordinal, 0] for ordinal in candidate_ordinals if ordinal not in friday_ordinal_set])

    for index, course in enumerate(courses):
        for other_course in courses[index + 1 :]:
            min_gap = pair_required_gap_days(project, course, other_course)
            gap_var = model.NewIntVar(0, max_ordinal - min_ordinal, f"gap_{course.course_code}_{other_course.course_code}")
            model.AddAbsEquality(gap_var, exam_vars[course.course_code] - exam_vars[other_course.course_code])

            if min_gap > 0:
                model.Add(gap_var >= min_gap)

            if pair_requires_same_semester_gap(course, other_course):
                objective_terms.append(gap_var * (project.constraint_config.same_semester_gap_days * SAME_SEMESTER_GAP_WEIGHT))
            elif pair_requires_prerequisite_gap(course, other_course):
                objective_terms.append(gap_var * project.constraint_config.prerequisite_gap_days)
            elif pair_requires_high_failure_gap(course, other_course):
                objective_terms.append(gap_var * (project.constraint_config.high_failure_gap_days + 1))
            else:
                objective_terms.append(gap_var)

            if pair_prefers_adjacent_semester_spacing(course, other_course):
                same_day_var = model.NewBoolVar(f"same_day_{course.course_code}_{other_course.course_code}")
                model.Add(exam_vars[course.course_code] == exam_vars[other_course.course_code]).OnlyEnforceIf(same_day_var)
                model.Add(exam_vars[course.course_code] != exam_vars[other_course.course_code]).OnlyEnforceIf(same_day_var.Not())
                adjacent_semester_same_day_vars.append(same_day_var)

    if friday_exam_vars:
        objective_terms.append(-FRIDAY_EXAM_PENALTY * sum(friday_exam_vars))
    if adjacent_semester_same_day_vars:
        objective_terms.append(-ADJACENT_SEMESTER_SAME_DAY_PENALTY * sum(adjacent_semester_same_day_vars))
    if objective_terms:
        model.Maximize(sum(objective_terms))

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
                exam_date=ordinal_to_date[solver.Value(exam_vars[course.course_code])],
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
