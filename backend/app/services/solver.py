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

from app.models.schedule import MoedWindow, ScheduledExam, ScheduleSolution, SolutionDiagnostics, SolveRequest, ValidationIssue
from app.services.validation import (
    ADJACENT_SEMESTER_SAME_DAY_PENALTY,
    DEPARTMENTS,
    FRIDAY_EXAM_PENALTY,
    IDEAL_GAP_DEVIATION_WEIGHT,
    SAME_SEMESTER_GAP_WEIGHT,
    build_solution_diagnostics,
    course_departments,
    date_is_friday,
    ideal_gap_target_days,
    iter_allowed_dates,
    moed_window_for_date,
    pair_requires_high_failure_gap,
    pair_requires_adjacent_semester_gap,
    pair_requires_prerequisite_gap,
    pair_requires_same_semester_gap,
    pair_prefers_adjacent_semester_spacing,
    score_solution,
    validate_solution_exams,
)


def moed_letter(moed_number: int) -> str:
    return chr(64 + moed_number)


def solve_single_moed_project(project, moed_window: MoedWindow, max_solutions: int) -> tuple[list[ScheduleSolution], list[ValidationIssue]]:
    candidate_dates = iter_allowed_dates(project)
    if not candidate_dates:
        return [], [
            ValidationIssue(
                code="no_feasible_schedule",
                severity="error",
                message=(
                    f"Moed {moed_letter(moed_window.moed_number)} has no schedulable dates left after applying its window, "
                    "excluded ranges, and the Saturday block."
                ),
            )
        ]

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
    friday_exam_vars: dict[str, cp_model.BoolVar] = {}
    scheduled_on_date_vars: dict[tuple[str, int], cp_model.BoolVar] = {}
    cumulative_gap_deviation_vars: list[cp_model.IntVar] = []

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
            return [], [
                ValidationIssue(
                    code="no_feasible_schedule",
                    severity="error",
                    message=(
                        f"Fixed exam for {course.course_code} is outside the available dates for Moed {moed_letter(moed_window.moed_number)} "
                        "or falls on an excluded date."
                    ),
                    related_course_code=course.course_code,
                    related_date=fixed_exam.exam_date,
                )
            ]
        exam_vars[course.course_code] = model.NewIntVar(fixed_ordinal, fixed_ordinal, f"exam_{course.course_code}")

    friday_ordinals = [candidate_date.toordinal() for candidate_date in candidate_dates if date_is_friday(candidate_date)]
    friday_ordinal_set = set(friday_ordinals)
    for course in courses:
        if not friday_ordinals:
            continue

        friday_var = model.NewBoolVar(f"friday_{course.course_code}")
        friday_exam_vars[course.course_code] = friday_var
        model.AddAllowedAssignments([exam_vars[course.course_code], friday_var], [[ordinal, 1] for ordinal in friday_ordinals] + [[ordinal, 0] for ordinal in candidate_ordinals if ordinal not in friday_ordinal_set])

    for department in DEPARTMENTS:
        department_friday_vars = [
            friday_exam_vars[course.course_code]
            for course in courses
            if course.course_code in friday_exam_vars and department in course_departments(course)
        ]
        if department_friday_vars:
            model.Add(sum(department_friday_vars) <= 1)

    total_exam_count = len(courses)
    if total_exam_count > 0:
        for course in courses:
            course_date_flags: list[cp_model.BoolVar] = []
            for ordinal in candidate_ordinals:
                on_date_var = model.NewBoolVar(f"exam_on_{course.course_code}_{ordinal}")
                scheduled_on_date_vars[(course.course_code, ordinal)] = on_date_var
                model.Add(exam_vars[course.course_code] == ordinal).OnlyEnforceIf(on_date_var)
                model.Add(exam_vars[course.course_code] != ordinal).OnlyEnforceIf(on_date_var.Not())
                course_date_flags.append(on_date_var)
            model.Add(sum(course_date_flags) == 1)

        cumulative_exam_count_terms: list[cp_model.LinearExpr] = []
        total_date_count = len(candidate_ordinals)
        for index, ordinal in enumerate(candidate_ordinals, start=1):
            exams_on_date = sum(scheduled_on_date_vars[(course.course_code, ordinal)] for course in courses)
            cumulative_exam_count_terms.append(exams_on_date)
            target_cumulative_count = round(index * total_exam_count / total_date_count)
            cumulative_exam_count = sum(cumulative_exam_count_terms)
            cumulative_gap_deviation = model.NewIntVar(
                0,
                total_exam_count,
                f"cumulative_gap_dev_{ordinal}",
            )
            model.Add(cumulative_gap_deviation >= cumulative_exam_count - target_cumulative_count)
            model.Add(cumulative_gap_deviation >= target_cumulative_count - cumulative_exam_count)
            cumulative_gap_deviation_vars.append(cumulative_gap_deviation)

    for index, course in enumerate(courses):
        for other_course in courses[index + 1 :]:
            gap_var = model.NewIntVar(0, max_ordinal - min_ordinal, f"gap_{course.course_code}_{other_course.course_code}")
            model.AddAbsEquality(gap_var, exam_vars[course.course_code] - exam_vars[other_course.course_code])
            window_gap = 0
            if pair_requires_same_semester_gap(course, other_course):
                window_gap = max(window_gap, moed_window.same_semester_gap_days)
                objective_terms.append(gap_var * (moed_window.same_semester_gap_days * SAME_SEMESTER_GAP_WEIGHT))
            elif pair_requires_prerequisite_gap(course, other_course):
                window_gap = max(window_gap, moed_window.prerequisite_gap_days)
                objective_terms.append(gap_var * moed_window.prerequisite_gap_days)
            elif pair_requires_high_failure_gap(course, other_course):
                window_gap = max(window_gap, moed_window.high_failure_gap_days)
                objective_terms.append(gap_var * (moed_window.high_failure_gap_days + 1))

            if pair_requires_adjacent_semester_gap(course, other_course):
                window_gap = max(window_gap, project.constraint_config.adjacent_semester_gap_days)

            if window_gap > 0:
                model.Add(gap_var >= window_gap)

            if pair_prefers_adjacent_semester_spacing(course, other_course):
                same_day_var = model.NewBoolVar(f"same_day_{course.course_code}_{other_course.course_code}")
                model.Add(exam_vars[course.course_code] == exam_vars[other_course.course_code]).OnlyEnforceIf(same_day_var)
                model.Add(exam_vars[course.course_code] != exam_vars[other_course.course_code]).OnlyEnforceIf(same_day_var.Not())
                adjacent_semester_same_day_vars.append(same_day_var)

    if friday_exam_vars:
        objective_terms.append(-FRIDAY_EXAM_PENALTY * sum(friday_exam_vars.values()))
    if adjacent_semester_same_day_vars:
        objective_terms.append(-ADJACENT_SEMESTER_SAME_DAY_PENALTY * sum(adjacent_semester_same_day_vars))
    if cumulative_gap_deviation_vars:
        objective_terms.append(-project.constraint_config.global_spacing_weight * sum(cumulative_gap_deviation_vars))
    if objective_terms:
        model.Maximize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 10

    solutions: list[ScheduleSolution] = []

    for solution_index in range(max_solutions):
        status = solver.Solve(model)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            break

        exams = [
            ScheduledExam(
                course_code=course.course_code,
                moed_number=moed_window.moed_number,
                exam_date=ordinal_to_date[solver.Value(exam_vars[course.course_code])],
                source="fixed" if course.course_code in fixed_exam_lookup else "solver",
            )
            for course in courses
        ]
        issues = validate_solution_exams(project, exams)
        solutions.append(
            ScheduleSolution(
                solution_id=f"moed-{moed_window.moed_number}-solution-{solution_index + 1}",
                score=score_solution(project, exams),
                exams=sorted(exams, key=lambda exam: (exam.exam_date, exam.course_code)),
                issues=issues,
                diagnostics=build_solution_diagnostics(project, exams),
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

    if solutions:
        return solutions, []

    return [], [
        ValidationIssue(
            code="no_feasible_schedule",
            severity="error",
            message=(
                f"Moed {moed_letter(moed_window.moed_number)} could not satisfy the current hard constraints for "
                f"{len(courses)} course(s) across {len(candidate_dates)} available day(s). Review this Moed's same-semester, "
                "prerequisite, high-failure, adjacent-semester, Friday, and fixed-exam constraints."
            ),
        )
    ]


def combine_window_solutions(solution_id: str, window_solutions: list[ScheduleSolution]) -> ScheduleSolution:
    combined_exams: list[ScheduledExam] = []
    combined_issues: list[ValidationIssue] = []
    total_score = 0
    total_target_gap = 0
    total_spacing_deviation = 0
    total_spacing_score = 0

    for solution in window_solutions:
        combined_exams.extend(solution.exams)
        combined_issues.extend(solution.issues)
        total_score += solution.score
        total_target_gap += solution.diagnostics.target_gap_days
        total_spacing_deviation += solution.diagnostics.spacing_deviation
        total_spacing_score += solution.diagnostics.spacing_score

    solution_count = max(len(window_solutions), 1)

    return ScheduleSolution(
        solution_id=solution_id,
        score=total_score,
        exams=sorted(combined_exams, key=lambda exam: (exam.moed_number, exam.exam_date, exam.course_code)),
        issues=combined_issues,
        diagnostics=SolutionDiagnostics(
            target_gap_days=max(1, round(total_target_gap / solution_count)),
            spacing_deviation=total_spacing_deviation,
            spacing_score=total_spacing_score,
        ),
    )


def solve_project(request: SolveRequest) -> dict:
    project = request.project
    per_window_solution_sets: list[list[ScheduleSolution]] = []
    blocking_issues: list[ValidationIssue] = []

    for moed_window in project.moed_windows:
        window_fixed_exams = [
            fixed_exam
            for fixed_exam in project.fixed_exams
            if (fixed_window := moed_window_for_date(project, fixed_exam.exam_date)) is not None
            and fixed_window.moed_number == moed_window.moed_number
        ]
        window_project = project.model_copy(update={"moed_windows": [moed_window], "fixed_exams": window_fixed_exams})
        window_solutions, window_issues = solve_single_moed_project(window_project, moed_window, request.max_solutions)

        if not window_solutions:
            blocking_issues.extend(window_issues)
            return {"project_name": project.project_name, "solutions": [], "issues": [issue.model_dump(mode="json") for issue in blocking_issues]}

        per_window_solution_sets.append(window_solutions)

    max_combined_solutions = min(len(window_solutions) for window_solutions in per_window_solution_sets)
    solutions = [
        combine_window_solutions(
            f"solution-{solution_index + 1}",
            [window_solutions[solution_index] for window_solutions in per_window_solution_sets],
        )
        for solution_index in range(min(request.max_solutions, max_combined_solutions))
    ]

    return {
        "project_name": project.project_name,
        "solutions": [solution.model_dump(mode="json") for solution in solutions],
        "issues": [],
    }
