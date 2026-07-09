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
    DEPARTMENTS,
    EARLY_EXAM_WEIGHT,
    FRIDAY_EXAM_PENALTY,
    IDEAL_GAP_DEVIATION_WEIGHT,
    MAX_RECOMMENDED_GAP_DAYS,
    SAME_DAY_SEMESTER_GAP1_BONUS,
    SAME_DAY_SEMESTER_GAP2_BONUS,
    SAME_PARITY_SAME_DAY_PENALTY,
    SEMESTER_START_AFTER_WEEK_ONE_PENALTY,
    SEMESTER_START_SPREAD_PENALTY,
    SEMESTER_MISSING_FIRST_WEEK_PENALTY,
    SEMESTER_LATE_START_PENALTY,
    SEMESTER_SPAN_PENALTY,
    SAME_SEMESTER_OVER_WEEK_PENALTY,
    SAME_SEMESTER_GAP_WEIGHT,
    build_solution_diagnostics,
    course_departments,
    courses_share_department,
    date_is_friday,
    ideal_gap_target_days,
    iter_allowed_dates,
    moed_window_for_date,
    pair_requires_high_failure_gap,
    pair_requires_prerequisite_gap,
    pair_requires_same_semester_gap,
    score_solution,
    validate_solution_exams,
)


def moed_letter(moed_number: int) -> str:
    return chr(64 + moed_number)


def minimum_date_distance_for_free_days(minimum_free_days: int) -> int:
    if minimum_free_days <= 0:
        return 0
    return minimum_free_days + 1


def assignment_signature(assignments: dict[str, int]) -> tuple[tuple[str, int], ...]:
    return tuple(sorted(assignments.items()))


def solve_single_moed_project(
    project,
    moed_window: MoedWindow,
    max_solutions: int,
    base_solution_time_seconds: int,
    variant_solution_time_seconds: int,
    diversity_mode: str,
    variant_min_changed_exams: int | None,
) -> tuple[list[ScheduleSolution], list[ValidationIssue]]:
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
    same_day_semester_gap2_vars: list[cp_model.BoolVar] = []
    same_day_semester_gap1_vars: list[cp_model.BoolVar] = []
    same_parity_same_day_vars: list[cp_model.BoolVar] = []
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
                same_semester_over_week = model.NewBoolVar(f"same_semester_over_week_{course.course_code}_{other_course.course_code}")
                model.Add(gap_var >= MAX_RECOMMENDED_GAP_DAYS + 2).OnlyEnforceIf(same_semester_over_week)
                model.Add(gap_var <= MAX_RECOMMENDED_GAP_DAYS + 1).OnlyEnforceIf(same_semester_over_week.Not())
                objective_terms.append(-SAME_SEMESTER_OVER_WEEK_PENALTY * same_semester_over_week)
            elif pair_requires_prerequisite_gap(course, other_course):
                window_gap = max(window_gap, moed_window.prerequisite_gap_days)
                objective_terms.append(gap_var * moed_window.prerequisite_gap_days)
            elif pair_requires_high_failure_gap(course, other_course):
                window_gap = max(window_gap, moed_window.high_failure_gap_days)
                objective_terms.append(gap_var * (moed_window.high_failure_gap_days + 1))

            if window_gap > 0:
                model.Add(gap_var >= minimum_date_distance_for_free_days(window_gap))

            if courses_share_department(course, other_course):
                semester_distance = abs(course.semester_number - other_course.semester_number)
                semester_gap = max(0, semester_distance - 1)
                if semester_gap == 0:
                    intentional_override = (
                        pair_requires_same_semester_gap(course, other_course) and moed_window.same_semester_gap_days == 0
                    ) or (
                        pair_requires_prerequisite_gap(course, other_course) and moed_window.prerequisite_gap_days == 0
                    )
                    if not intentional_override:
                        model.Add(exam_vars[course.course_code] != exam_vars[other_course.course_code])
                elif semester_gap in {1, 2}:
                    same_day_var = model.NewBoolVar(f"same_day_semester_pref_{course.course_code}_{other_course.course_code}")
                    model.Add(exam_vars[course.course_code] == exam_vars[other_course.course_code]).OnlyEnforceIf(same_day_var)
                    model.Add(exam_vars[course.course_code] != exam_vars[other_course.course_code]).OnlyEnforceIf(same_day_var.Not())
                    if semester_gap == 2:
                        same_day_semester_gap2_vars.append(same_day_var)
                    else:
                        same_day_semester_gap1_vars.append(same_day_var)

            if course.semester_number != other_course.semester_number and course.semester_number % 2 == other_course.semester_number % 2:
                same_parity_same_day_var = model.NewBoolVar(f"same_parity_same_day_{course.course_code}_{other_course.course_code}")
                model.Add(exam_vars[course.course_code] == exam_vars[other_course.course_code]).OnlyEnforceIf(same_parity_same_day_var)
                model.Add(exam_vars[course.course_code] != exam_vars[other_course.course_code]).OnlyEnforceIf(same_parity_same_day_var.Not())
                same_parity_same_day_vars.append(same_parity_same_day_var)

    fixed_exams_by_prerequisite_code: dict[str, list] = {}
    for fixed_exam in project.fixed_exams:
        for prerequisite_code in fixed_exam.prerequisite_course_codes:
            fixed_exams_by_prerequisite_code.setdefault(prerequisite_code, []).append(fixed_exam)

    minimum_prerequisite_date_distance = minimum_date_distance_for_free_days(moed_window.prerequisite_gap_days)
    if minimum_prerequisite_date_distance > 0:
        for course in courses:
            course_exam_var = exam_vars[course.course_code]

            for prerequisite_code in course.prerequisite_course_codes:
                prerequisite_fixed_exam = fixed_exam_lookup.get(prerequisite_code)
                if prerequisite_fixed_exam is None:
                    continue
                prerequisite_fixed_exam_ordinal = date_to_ordinal.get(prerequisite_fixed_exam.exam_date)
                if prerequisite_fixed_exam_ordinal is None:
                    continue

                gap_to_prerequisite_fixed_exam = model.NewIntVar(
                    0,
                    max_ordinal - min_ordinal,
                    f"gap_to_fixed_prerequisite_{course.course_code}_{prerequisite_code}",
                )
                model.AddAbsEquality(gap_to_prerequisite_fixed_exam, course_exam_var - prerequisite_fixed_exam_ordinal)
                model.Add(gap_to_prerequisite_fixed_exam >= minimum_prerequisite_date_distance)

            for dependent_fixed_exam in fixed_exams_by_prerequisite_code.get(course.course_code, []):
                dependent_fixed_exam_ordinal = date_to_ordinal.get(dependent_fixed_exam.exam_date)
                if dependent_fixed_exam_ordinal is None:
                    continue

                gap_to_dependent_fixed_exam = model.NewIntVar(
                    0,
                    max_ordinal - min_ordinal,
                    f"gap_to_fixed_dependent_{course.course_code}_{dependent_fixed_exam.course_code}",
                )
                model.AddAbsEquality(gap_to_dependent_fixed_exam, course_exam_var - dependent_fixed_exam_ordinal)
                model.Add(gap_to_dependent_fixed_exam >= minimum_prerequisite_date_distance)

    courses_by_semester: dict[int, list[str]] = {}
    for course in courses:
        courses_by_semester.setdefault(course.semester_number, []).append(course.course_code)

    semester_earliest_vars: list[cp_model.IntVar] = []
    for semester_number, semester_course_codes in courses_by_semester.items():
        if not semester_course_codes:
            continue

        semester_exam_vars = [exam_vars[course_code] for course_code in semester_course_codes]
        earliest_exam_var = model.NewIntVar(min_ordinal, max_ordinal, f"semester_{semester_number}_earliest")
        latest_exam_var = model.NewIntVar(min_ordinal, max_ordinal, f"semester_{semester_number}_latest")
        span_var = model.NewIntVar(0, max_ordinal - min_ordinal, f"semester_{semester_number}_span")

        model.AddMinEquality(earliest_exam_var, semester_exam_vars)
        model.AddMaxEquality(latest_exam_var, semester_exam_vars)
        model.Add(span_var == latest_exam_var - earliest_exam_var)
        semester_earliest_vars.append(earliest_exam_var)

        objective_terms.append(-SEMESTER_LATE_START_PENALTY * (earliest_exam_var - min_ordinal))
        objective_terms.append(-SEMESTER_SPAN_PENALTY * span_var)

        starts_after_first_week = model.NewBoolVar(f"semester_{semester_number}_starts_after_first_week")
        model.Add(earliest_exam_var >= min_ordinal + 7).OnlyEnforceIf(starts_after_first_week)
        model.Add(earliest_exam_var <= min_ordinal + 6).OnlyEnforceIf(starts_after_first_week.Not())
        objective_terms.append(-SEMESTER_MISSING_FIRST_WEEK_PENALTY * starts_after_first_week)

        late_after_week_var = model.NewIntVar(0, max_ordinal - min_ordinal, f"semester_{semester_number}_late_after_week")
        model.AddMaxEquality(late_after_week_var, [0, earliest_exam_var - (min_ordinal + 6)])
        objective_terms.append(-SEMESTER_START_AFTER_WEEK_ONE_PENALTY * late_after_week_var)

    if len(semester_earliest_vars) > 1:
        min_semester_start_var = model.NewIntVar(min_ordinal, max_ordinal, "min_semester_start")
        max_semester_start_var = model.NewIntVar(min_ordinal, max_ordinal, "max_semester_start")
        semester_start_spread_var = model.NewIntVar(0, max_ordinal - min_ordinal, "semester_start_spread")
        model.AddMinEquality(min_semester_start_var, semester_earliest_vars)
        model.AddMaxEquality(max_semester_start_var, semester_earliest_vars)
        model.Add(semester_start_spread_var == max_semester_start_var - min_semester_start_var)
        objective_terms.append(-SEMESTER_START_SPREAD_PENALTY * semester_start_spread_var)

    if friday_exam_vars:
        objective_terms.append(-FRIDAY_EXAM_PENALTY * sum(friday_exam_vars.values()))
    objective_terms.extend(-EARLY_EXAM_WEIGHT * (exam_vars[course.course_code] - min_ordinal) for course in courses)
    if same_day_semester_gap2_vars:
        objective_terms.append(SAME_DAY_SEMESTER_GAP2_BONUS * sum(same_day_semester_gap2_vars))
    if same_day_semester_gap1_vars:
        objective_terms.append(SAME_DAY_SEMESTER_GAP1_BONUS * sum(same_day_semester_gap1_vars))
    if same_parity_same_day_vars:
        objective_terms.append(-SAME_PARITY_SAME_DAY_PENALTY * sum(same_parity_same_day_vars))
    if cumulative_gap_deviation_vars:
        objective_terms.append(-project.constraint_config.global_spacing_weight * sum(cumulative_gap_deviation_vars))
    if objective_terms:
        model.Maximize(sum(objective_terms))

    solver = cp_model.CpSolver()
    solutions: list[ScheduleSolution] = []
    seen_assignment_signatures: set[tuple[tuple[str, int], ...]] = set()

    if max_solutions <= 0:
        return [], []

    solver.parameters.max_time_in_seconds = base_solution_time_seconds
    base_status = solver.Solve(model)
    if base_status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        base_assignments = {course.course_code: solver.Value(exam_vars[course.course_code]) for course in courses}
        base_exams = [
            ScheduledExam(
                course_code=course.course_code,
                moed_number=moed_window.moed_number,
                exam_date=ordinal_to_date[base_assignments[course.course_code]],
                source="fixed" if course.course_code in fixed_exam_lookup else "solver",
            )
            for course in courses
        ]
        base_issues = validate_solution_exams(project, base_exams)
        solutions.append(
            ScheduleSolution(
                solution_id=f"moed-{moed_window.moed_number}-solution-1",
                score=score_solution(project, base_exams),
                exams=sorted(base_exams, key=lambda exam: (exam.exam_date, exam.course_code)),
                issues=base_issues,
                diagnostics=build_solution_diagnostics(project, base_exams),
            )
        )
        seen_assignment_signatures.add(assignment_signature(base_assignments))
    else:
        base_assignments = {}

    variant_target_count = max(0, min(max_solutions - 1, 20))
    if solutions and variant_target_count > 0 and courses:
        if variant_min_changed_exams is not None:
            base_min_changes = min(max(variant_min_changed_exams, 1), len(courses))
        elif diversity_mode == "high_diversity":
            base_min_changes = min(max(2, len(courses) // 3), len(courses))
        else:
            base_min_changes = 1

        accepted_assignments: list[dict[str, int]] = [base_assignments]
        for variant_index in range(variant_target_count):
            required_changes = min(base_min_changes + variant_index, len(courses)) if diversity_mode == "high_diversity" else base_min_changes

            same_as_base_flags: list[cp_model.BoolVar] = []
            for course in courses:
                course_code = course.course_code
                same_as_base = model.NewBoolVar(f"same_as_base_{variant_index}_{course_code}")
                model.Add(exam_vars[course_code] == base_assignments[course_code]).OnlyEnforceIf(same_as_base)
                model.Add(exam_vars[course_code] != base_assignments[course_code]).OnlyEnforceIf(same_as_base.Not())
                same_as_base_flags.append(same_as_base)
            model.Add(sum(same_as_base_flags) <= len(courses) - required_changes)

            for prior_index, prior_assignment in enumerate(accepted_assignments):
                same_as_prior_flags: list[cp_model.BoolVar] = []
                for course in courses:
                    course_code = course.course_code
                    same_as_prior = model.NewBoolVar(f"same_as_prior_{variant_index}_{prior_index}_{course_code}")
                    model.Add(exam_vars[course_code] == prior_assignment[course_code]).OnlyEnforceIf(same_as_prior)
                    model.Add(exam_vars[course_code] != prior_assignment[course_code]).OnlyEnforceIf(same_as_prior.Not())
                    same_as_prior_flags.append(same_as_prior)
                model.Add(sum(same_as_prior_flags) <= len(courses) - 1)

            solver.parameters.max_time_in_seconds = variant_solution_time_seconds
            status = solver.Solve(model)
            if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
                break

            variant_assignments = {course.course_code: solver.Value(exam_vars[course.course_code]) for course in courses}
            variant_signature = assignment_signature(variant_assignments)
            if variant_signature in seen_assignment_signatures:
                continue

            exams = [
                ScheduledExam(
                    course_code=course.course_code,
                    moed_number=moed_window.moed_number,
                    exam_date=ordinal_to_date[variant_assignments[course.course_code]],
                    source="fixed" if course.course_code in fixed_exam_lookup else "solver",
                )
                for course in courses
            ]
            issues = validate_solution_exams(project, exams)
            solutions.append(
                ScheduleSolution(
                    solution_id=f"moed-{moed_window.moed_number}-solution-{len(solutions) + 1}",
                    score=score_solution(project, exams),
                    exams=sorted(exams, key=lambda exam: (exam.exam_date, exam.course_code)),
                    issues=issues,
                    diagnostics=build_solution_diagnostics(project, exams),
                )
            )
            accepted_assignments.append(variant_assignments)
            seen_assignment_signatures.add(variant_signature)

            if len(solutions) >= max_solutions:
                break

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
        window_solutions, window_issues = solve_single_moed_project(
            window_project,
            moed_window,
            request.max_solutions,
            request.base_solution_time_seconds,
            request.variant_solution_time_seconds,
            request.diversity_mode,
            request.variant_min_changed_exams,
        )

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
