from __future__ import annotations

from datetime import date, timedelta

from app.models.schedule import CourseInput, ManualMoveRequest, ScheduleProject, ScheduledExam, ScheduleSolution, ValidationIssue


def date_is_excluded(project: ScheduleProject, target_date: date) -> bool:
    return any(excluded_range.start_date <= target_date <= excluded_range.end_date for excluded_range in project.excluded_ranges)


def iter_allowed_dates(project: ScheduleProject) -> list[date]:
    allowed_dates: list[date] = []
    current_date = project.moed_a_window.start_date
    while current_date <= project.moed_a_window.end_date:
        if not date_is_excluded(project, current_date):
            allowed_dates.append(current_date)
        current_date += timedelta(days=1)
    return allowed_dates


def gap_days(first_date: date, second_date: date) -> int:
    return abs((first_date - second_date).days)


def pair_requires_same_semester_gap(first_course: CourseInput, second_course: CourseInput) -> bool:
    return first_course.semester_number == second_course.semester_number


def pair_requires_prerequisite_gap(first_course: CourseInput, second_course: CourseInput) -> bool:
    prerequisite_pair = (
        first_course.prerequisite_course_code == second_course.course_code
        or second_course.prerequisite_course_code == first_course.course_code
    )
    back_to_back_semesters = abs(first_course.semester_number - second_course.semester_number) == 1
    return prerequisite_pair and back_to_back_semesters


def pair_requires_high_failure_gap(first_course: CourseInput, second_course: CourseInput) -> bool:
    return (first_course.high_failure_rate and second_course.semester_number in {2, 3}) or (
        second_course.high_failure_rate and first_course.semester_number in {2, 3}
    )


def pair_prefers_adjacent_semester_spacing(first_course: CourseInput, second_course: CourseInput) -> bool:
    return abs(first_course.semester_number - second_course.semester_number) == 1


def pair_required_gap_days(project: ScheduleProject, first_course: CourseInput, second_course: CourseInput) -> int:
    min_gap = 0

    if pair_requires_same_semester_gap(first_course, second_course):
        min_gap = max(min_gap, project.constraint_config.same_semester_gap_days)
    if pair_requires_prerequisite_gap(first_course, second_course):
        min_gap = max(min_gap, project.constraint_config.prerequisite_gap_days)
    if pair_requires_high_failure_gap(first_course, second_course):
        min_gap = max(min_gap, project.constraint_config.high_failure_gap_days)

    return min_gap


def score_solution(project: ScheduleProject, exams: list[ScheduledExam]) -> int:
    course_lookup = {course.course_code: course for course in project.courses}
    total_score = 0

    for index, exam in enumerate(exams):
        course = course_lookup.get(exam.course_code)
        if course is None:
            continue

        for other_exam in exams[index + 1 :]:
            other_course = course_lookup.get(other_exam.course_code)
            if other_course is None:
                continue

            distance = gap_days(exam.exam_date, other_exam.exam_date)
            if pair_requires_same_semester_gap(course, other_course):
                total_score += distance * project.constraint_config.same_semester_gap_days
            elif pair_requires_prerequisite_gap(course, other_course):
                total_score += distance * project.constraint_config.prerequisite_gap_days
            elif pair_requires_high_failure_gap(course, other_course):
                total_score += distance * (project.constraint_config.high_failure_gap_days + 1)

            if pair_prefers_adjacent_semester_spacing(course, other_course) and distance == 0:
                total_score -= 1

    return total_score


def pair_constraint_issues(
    project: ScheduleProject,
    moved_course: CourseInput,
    moved_date: date,
    other_course: CourseInput,
    other_date: date,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    distance = gap_days(moved_date, other_date)
    same_semester_gap = project.constraint_config.same_semester_gap_days
    prerequisite_gap = project.constraint_config.prerequisite_gap_days
    high_failure_gap = project.constraint_config.high_failure_gap_days

    if pair_requires_same_semester_gap(moved_course, other_course) and distance < same_semester_gap:
        issues.append(
            ValidationIssue(
                code="unsatisfied_constraint",
                severity="error",
                message=f"Courses in the same semester need at least a {same_semester_gap}-day gap.",
                related_course_code=other_course.course_code,
                related_date=other_date,
            )
        )

    if pair_requires_prerequisite_gap(moved_course, other_course) and distance < prerequisite_gap:
        issues.append(
            ValidationIssue(
                code="unsatisfied_constraint",
                severity="error",
                message=f"Prerequisite-linked back-to-back semester courses need at least a {prerequisite_gap}-day gap.",
                related_course_code=other_course.course_code,
                related_date=other_date,
            )
        )

    if pair_requires_high_failure_gap(moved_course, other_course) and distance < high_failure_gap:
        issues.append(
            ValidationIssue(
                code="unsatisfied_constraint",
                severity="error",
                message=f"High-failure courses must stay at least {high_failure_gap} days away from semester 2 or 3 exams.",
                related_course_code=other_course.course_code,
                related_date=other_date,
            )
        )

    return issues


def validate_solution_exams(project: ScheduleProject, exams: list[ScheduledExam]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    course_lookup = {course.course_code: course for course in project.courses}

    for exam in exams:
        if exam.exam_date < project.moed_a_window.start_date or exam.exam_date > project.moed_a_window.end_date:
            issues.append(
                ValidationIssue(
                    code="unsatisfied_constraint",
                    severity="error",
                    message="Scheduled exams must stay inside the Moed A window.",
                    related_course_code=exam.course_code,
                    related_date=exam.exam_date,
                )
            )

        if date_is_excluded(project, exam.exam_date):
            issues.append(
                ValidationIssue(
                    code="unsatisfied_constraint",
                    severity="error",
                    message="Scheduled exams cannot use excluded dates.",
                    related_course_code=exam.course_code,
                    related_date=exam.exam_date,
                )
            )

    for fixed_exam in project.fixed_exams:
        matching_exam = next((exam for exam in exams if exam.course_code == fixed_exam.course_code), None)
        if matching_exam and matching_exam.exam_date != fixed_exam.exam_date:
            issues.append(
                ValidationIssue(
                    code="unsatisfied_constraint",
                    severity="error",
                    message="Locked fixed exams must remain on their assigned dates.",
                    related_course_code=fixed_exam.course_code,
                    related_date=matching_exam.exam_date,
                )
            )

    for index, exam in enumerate(exams):
        course = course_lookup.get(exam.course_code)
        if course is None:
            continue
        for other_exam in exams[index + 1 :]:
            other_course = course_lookup.get(other_exam.course_code)
            if other_course is None:
                continue
            issues.extend(pair_constraint_issues(project, course, exam.exam_date, other_course, other_exam.exam_date))

    return issues


def validate_project(project: ScheduleProject) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    window = project.moed_a_window
    if window.end_date < window.start_date:
        issues.append(
            ValidationIssue(
                code="invalid_window",
                severity="error",
                message="Moed A end date must be on or after the start date.",
            )
        )

    seen_course_codes: set[str] = set()
    course_lookup = {course.course_code: course for course in project.courses}

    for excluded_range in project.excluded_ranges:
        if excluded_range.start_date < window.start_date or excluded_range.end_date > window.end_date:
            issues.append(
                ValidationIssue(
                    code="excluded_outside_window",
                    severity="error",
                    message="Excluded dates must stay inside the Moed A window.",
                    related_date=excluded_range.start_date,
                )
            )

    for fixed_exam in project.fixed_exams:
        if fixed_exam.exam_date < window.start_date or fixed_exam.exam_date > window.end_date:
            issues.append(
                ValidationIssue(
                    code="fixed_exam_outside_window",
                    severity="error",
                    message="Fixed exams must stay inside the Moed A window.",
                    related_course_code=fixed_exam.course_code,
                    related_date=fixed_exam.exam_date,
                )
            )
        if date_is_excluded(project, fixed_exam.exam_date):
            issues.append(
                ValidationIssue(
                    code="unsatisfied_constraint",
                    severity="error",
                    message="Fixed exams cannot be placed on excluded dates.",
                    related_course_code=fixed_exam.course_code,
                    related_date=fixed_exam.exam_date,
                )
            )

    for course in project.courses:
        if course.course_code in seen_course_codes:
            issues.append(
                ValidationIssue(
                    code="duplicate_course_code",
                    severity="error",
                    message="Each course code must be unique.",
                    related_course_code=course.course_code,
                )
            )
        seen_course_codes.add(course.course_code)

        prerequisite_code = course.prerequisite_course_code
        if prerequisite_code and prerequisite_code not in course_lookup:
            issues.append(
                ValidationIssue(
                    code="missing_prerequisite_target",
                    severity="error",
                    message="Prerequisite course code must match another course in the project.",
                    related_course_code=course.course_code,
                )
            )

    return issues


def build_preview_solution(request: ManualMoveRequest) -> tuple[list[ScheduledExam], list[ValidationIssue], ScheduleSolution | None]:
    issues = validate_project(request.project)
    move_issues: list[ValidationIssue] = []
    target_solution = next(
        (solution for solution in request.project.solutions if solution.solution_id == request.solution_id),
        None,
    )

    if target_solution is None:
        move_issues.append(
            ValidationIssue(
                code="manual_move_conflict",
                severity="error",
                message="Selected solution does not exist.",
                related_course_code=request.course_code,
            )
        )
        return [], issues + move_issues, None

    updated_exams: list[ScheduledExam] = []
    moved_exam_found = False
    for exam in target_solution.exams:
        if exam.course_code == request.course_code:
            moved_exam_found = True
            updated_exams.append(exam.model_copy(update={"exam_date": request.new_date, "source": "manual"}))
        else:
            updated_exams.append(exam)

    if not moved_exam_found:
        move_issues.append(
            ValidationIssue(
                code="manual_move_conflict",
                severity="error",
                message="Selected course is not present in the target solution.",
                related_course_code=request.course_code,
            )
        )

    window = request.project.moed_a_window

    if request.new_date < window.start_date or request.new_date > window.end_date:
        move_issues.append(
            ValidationIssue(
                code="manual_move_conflict",
                severity="error",
                message="Manual move must stay inside the Moed A window.",
                related_course_code=request.course_code,
                related_date=request.new_date,
            )
        )

    if date_is_excluded(request.project, request.new_date):
        move_issues.append(
            ValidationIssue(
                code="manual_move_conflict",
                severity="error",
                message="Manual move cannot use an excluded date.",
                related_course_code=request.course_code,
                related_date=request.new_date,
            )
        )

    for fixed_exam in request.project.fixed_exams:
        if fixed_exam.course_code == request.course_code and fixed_exam.exam_date != request.new_date:
            move_issues.append(
                ValidationIssue(
                    code="manual_move_conflict",
                    severity="error",
                    message="Locked fixed exams cannot be moved away from their assigned date.",
                    related_course_code=request.course_code,
                    related_date=request.new_date,
                )
            )

    move_issues.extend(validate_solution_exams(request.project, updated_exams))

    preview_solution = ScheduleSolution(
        solution_id=target_solution.solution_id,
        score=score_solution(request.project, updated_exams),
        exams=updated_exams,
        issues=issues + move_issues,
    )

    return updated_exams, issues + move_issues, preview_solution


def validate_manual_move(request: ManualMoveRequest) -> dict:
    updated_exams, issues, preview_solution = build_preview_solution(request)

    if preview_solution is None:
        return {"valid": False, "issues": [issue.model_dump() for issue in issues]}

    return {
        "valid": len([issue for issue in issues if issue.severity == "error"]) == 0,
        "issues": [issue.model_dump() for issue in issues],
        "updated_solution": {
            "solution_id": preview_solution.solution_id,
            "score": preview_solution.score,
            "exams": [exam.model_dump(mode="json") for exam in updated_exams],
        },
    }


def explain_manual_move(request: ManualMoveRequest) -> dict:
    updated_exams, issues, preview_solution = build_preview_solution(request)

    if preview_solution is None:
        return {"valid": False, "issues": [issue.model_dump() for issue in issues]}

    return {
        "valid": len([issue for issue in issues if issue.severity == "error"]) == 0,
        "issues": [issue.model_dump() for issue in issues],
        "updated_solution": {
            "solution_id": preview_solution.solution_id,
            "score": preview_solution.score,
            "exams": [exam.model_dump(mode="json") for exam in updated_exams],
        },
    }
