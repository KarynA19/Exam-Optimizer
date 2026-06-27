from __future__ import annotations

from datetime import date, timedelta

from app.models.schedule import CourseInput, DepartmentCode, ManualMoveRequest, MoedWindow, ScheduleProject, ScheduledExam, ScheduleSolution, SolutionDiagnostics, ValidationIssue


FRIDAY_EXAM_PENALTY = 100
SAME_SEMESTER_GAP_WEIGHT = 10
ADJACENT_SEMESTER_NON_PREREQ_SAME_DAY_PENALTY = 200
ADJACENT_SAME_DAY_PAIR_EXCESS_PENALTY = 240
IDEAL_GAP_DEVIATION_WEIGHT = 40
SAME_SEMESTER_OVER_WEEK_PENALTY = 70
EARLY_EXAM_WEIGHT = 5
MAX_RECOMMENDED_GAP_DAYS = 7
SAME_PARITY_SAME_DAY_PENALTY = 70
SEMESTER_LATE_START_PENALTY = 30
SEMESTER_SPAN_PENALTY = 28
SEMESTER_MISSING_FIRST_WEEK_PENALTY = 280
SEMESTER_START_SPREAD_PENALTY = 160
SEMESTER_START_AFTER_WEEK_ONE_PENALTY = 140
DEPARTMENTS: tuple[DepartmentCode, ...] = ("SW", "IS")


def course_departments(course: CourseInput) -> tuple[DepartmentCode, ...]:
    return (course.department,) if course.department is not None else DEPARTMENTS


def courses_share_department(first_course: CourseInput, second_course: CourseInput) -> bool:
    return any(department in course_departments(second_course) for department in course_departments(first_course))


def date_is_excluded(project: ScheduleProject, target_date: date) -> bool:
    return any(excluded_range.start_date <= target_date <= excluded_range.end_date for excluded_range in project.excluded_ranges)


def date_is_saturday(target_date: date) -> bool:
    return target_date.weekday() == 5


def date_is_friday(target_date: date) -> bool:
    return target_date.weekday() == 4


def date_is_schedulable(project: ScheduleProject, target_date: date) -> bool:
    return not date_is_excluded(project, target_date) and not date_is_saturday(target_date)


def date_in_any_window(project: ScheduleProject, target_date: date) -> bool:
    return any(window.start_date <= target_date <= window.end_date for window in project.moed_windows)


def moed_window_for_date(project: ScheduleProject, target_date: date) -> MoedWindow | None:
    return next((window for window in project.moed_windows if window.start_date <= target_date <= window.end_date), None)


def moed_number_for_date(project: ScheduleProject, target_date: date) -> int | None:
    window = moed_window_for_date(project, target_date)
    return window.moed_number if window is not None else None


def range_in_any_window(project: ScheduleProject, start_date: date, end_date: date) -> bool:
    return any(window.start_date <= start_date and end_date <= window.end_date for window in project.moed_windows)


def project_window_bounds(project: ScheduleProject) -> tuple[date, date]:
    first_window = project.moed_windows[0]
    last_window = project.moed_windows[-1]
    return first_window.start_date, last_window.end_date


def iter_allowed_dates(project: ScheduleProject) -> list[date]:
    allowed_dates: list[date] = []
    for window in project.moed_windows:
        current_date = window.start_date
        while current_date <= window.end_date:
            if date_is_schedulable(project, current_date):
                allowed_dates.append(current_date)
            current_date += timedelta(days=1)
    return allowed_dates


def gap_days(first_date: date, second_date: date) -> int:
    return max(0, abs((first_date - second_date).days) - 1)


def pair_requires_same_semester_gap(first_course: CourseInput, second_course: CourseInput) -> bool:
    return first_course.semester_number == second_course.semester_number and courses_share_department(first_course, second_course)


def pair_requires_prerequisite_gap(first_course: CourseInput, second_course: CourseInput) -> bool:
    if not courses_share_department(first_course, second_course):
        return False

    prerequisite_pair = (
        second_course.course_code in first_course.prerequisite_course_codes
        or first_course.course_code in second_course.prerequisite_course_codes
    )
    back_to_back_semesters = abs(first_course.semester_number - second_course.semester_number) == 1
    return prerequisite_pair and back_to_back_semesters


def pair_requires_high_failure_gap(first_course: CourseInput, second_course: CourseInput) -> bool:
    if not courses_share_department(first_course, second_course):
        return False

    if first_course.high_failure_rate:
        if second_course.semester_number in {
            first_course.semester_number - 1,
            first_course.semester_number - 2,
        }:
            return True

    if second_course.high_failure_rate:
        if first_course.semester_number in {
            second_course.semester_number - 1,
            second_course.semester_number - 2,
        }:
            return True

    return False


def pair_prefers_adjacent_semester_spacing(first_course: CourseInput, second_course: CourseInput) -> bool:
    return abs(first_course.semester_number - second_course.semester_number) == 1 and courses_share_department(
        first_course,
        second_course,
    )


def pair_requires_adjacent_semester_gap(first_course: CourseInput, second_course: CourseInput) -> bool:
    return pair_prefers_adjacent_semester_spacing(first_course, second_course)


def pair_participates_in_ideal_gap_objective(first_course: CourseInput, second_course: CourseInput) -> bool:
    return (
        pair_requires_same_semester_gap(first_course, second_course)
        or pair_requires_adjacent_semester_gap(first_course, second_course)
        or pair_requires_prerequisite_gap(first_course, second_course)
        or pair_requires_high_failure_gap(first_course, second_course)
    )


def ideal_gap_target_days(project: ScheduleProject) -> int:
    if len(project.courses) < 2:
        return 1

    allowed_dates = iter_allowed_dates(project)
    if len(allowed_dates) < 2:
        return 1

    available_gap_days = max(len(allowed_dates) - 1, 1)
    return max(1, available_gap_days // (len(project.courses) - 1))


def global_spacing_deviation(project: ScheduleProject, exams: list[ScheduledExam]) -> int:
    allowed_dates = iter_allowed_dates(project)
    if len(allowed_dates) < 2 or len(exams) < 2:
        return 0

    exam_count_by_date: dict[date, int] = {}
    for exam in exams:
        exam_count_by_date[exam.exam_date] = exam_count_by_date.get(exam.exam_date, 0) + 1

    total_exams = len(exams)
    total_days = len(allowed_dates)
    cumulative_exams = 0
    total_deviation = 0

    for day_index, allowed_date in enumerate(allowed_dates, start=1):
        cumulative_exams += exam_count_by_date.get(allowed_date, 0)
        expected_scaled = day_index * total_exams
        actual_scaled = cumulative_exams * total_days
        total_deviation += abs(actual_scaled - expected_scaled)

    return total_deviation


def build_solution_diagnostics(project: ScheduleProject, exams: list[ScheduledExam]) -> SolutionDiagnostics:
    target_gap_days = ideal_gap_target_days(project)
    spacing_deviation = global_spacing_deviation(project, exams)
    spacing_score = -(spacing_deviation * project.constraint_config.global_spacing_weight)
    return SolutionDiagnostics(
        target_gap_days=target_gap_days,
        spacing_deviation=spacing_deviation,
        spacing_score=spacing_score,
    )


def pair_required_gap_days(
    project: ScheduleProject,
    first_course: CourseInput,
    first_date: date,
    second_course: CourseInput,
    second_date: date,
) -> int:
    first_window = moed_window_for_date(project, first_date)
    second_window = moed_window_for_date(project, second_date)
    if first_window is None or second_window is None or first_window.moed_number != second_window.moed_number:
        return 0

    min_gap = 0

    if pair_requires_same_semester_gap(first_course, second_course):
        min_gap = max(min_gap, first_window.same_semester_gap_days)
    if pair_requires_prerequisite_gap(first_course, second_course):
        min_gap = max(min_gap, first_window.prerequisite_gap_days)
    if pair_requires_high_failure_gap(first_course, second_course):
        min_gap = max(min_gap, first_window.high_failure_gap_days)

    return min_gap


def score_solution(project: ScheduleProject, exams: list[ScheduledExam]) -> int:
    course_lookup = {course.course_code: course for course in project.courses}
    total_score = 0
    ideal_gap = ideal_gap_target_days(project)
    sorted_exams = sorted(exams, key=lambda exam: (exam.exam_date, exam.course_code))
    project_start_date, _ = project_window_bounds(project)

    total_score -= global_spacing_deviation(project, exams) * project.constraint_config.global_spacing_weight

    for exam in exams:
        if date_is_friday(exam.exam_date):
            total_score -= FRIDAY_EXAM_PENALTY
        total_score -= gap_days(project_start_date, exam.exam_date) * EARLY_EXAM_WEIGHT

    for index in range(1, len(sorted_exams)):
        distance = gap_days(sorted_exams[index - 1].exam_date, sorted_exams[index].exam_date)
        total_score -= abs(distance - ideal_gap) * IDEAL_GAP_DEVIATION_WEIGHT

    exams_by_semester: dict[int, list[ScheduledExam]] = {}
    for exam in exams:
        course = course_lookup.get(exam.course_code)
        if course is None:
            continue
        exams_by_semester.setdefault(course.semester_number, []).append(exam)

    first_week_last_date = project_start_date + timedelta(days=6)
    semester_start_dates: list[date] = []
    for semester_exams in exams_by_semester.values():
        if not semester_exams:
            continue
        semester_dates = [semester_exam.exam_date for semester_exam in semester_exams]
        earliest_semester_date = min(semester_dates)
        latest_semester_date = max(semester_dates)
        semester_start_dates.append(earliest_semester_date)

        total_score -= gap_days(project_start_date, earliest_semester_date) * SEMESTER_LATE_START_PENALTY
        total_score -= gap_days(earliest_semester_date, latest_semester_date) * SEMESTER_SPAN_PENALTY
        if earliest_semester_date > first_week_last_date:
            total_score -= SEMESTER_MISSING_FIRST_WEEK_PENALTY
            total_score -= gap_days(first_week_last_date, earliest_semester_date) * SEMESTER_START_AFTER_WEEK_ONE_PENALTY

    if semester_start_dates:
        earliest_start = min(semester_start_dates)
        latest_start = max(semester_start_dates)
        total_score -= gap_days(earliest_start, latest_start) * SEMESTER_START_SPREAD_PENALTY

    adjacent_same_day_pair_count = 0

    for index, exam in enumerate(exams):
        course = course_lookup.get(exam.course_code)
        if course is None:
            continue

        for other_exam in exams[index + 1 :]:
            other_course = course_lookup.get(other_exam.course_code)
            if other_course is None:
                continue

            distance = gap_days(exam.exam_date, other_exam.exam_date)
            current_window = moed_window_for_date(project, exam.exam_date)
            other_window = moed_window_for_date(project, other_exam.exam_date)
            in_same_window = current_window is not None and other_window is not None and current_window.moed_number == other_window.moed_number
            if in_same_window and pair_requires_same_semester_gap(course, other_course):
                if distance > MAX_RECOMMENDED_GAP_DAYS:
                    total_score -= (distance - MAX_RECOMMENDED_GAP_DAYS) * SAME_SEMESTER_OVER_WEEK_PENALTY
            elif in_same_window and pair_requires_prerequisite_gap(course, other_course):
                total_score += distance * (current_window.prerequisite_gap_days if in_same_window and current_window else 1)
            elif in_same_window and pair_requires_high_failure_gap(course, other_course):
                total_score += distance * ((current_window.high_failure_gap_days if in_same_window and current_window else 1) + 1)

            if pair_prefers_adjacent_semester_spacing(course, other_course) and distance == 0:
                adjacent_same_day_pair_count += 1
                if not pair_requires_prerequisite_gap(course, other_course):
                    total_score -= ADJACENT_SEMESTER_NON_PREREQ_SAME_DAY_PENALTY

            if (
                course.semester_number != other_course.semester_number
                and course.semester_number % 2 == other_course.semester_number % 2
                and distance == 0
            ):
                total_score -= SAME_PARITY_SAME_DAY_PENALTY

    total_score -= max(0, adjacent_same_day_pair_count - 1) * ADJACENT_SAME_DAY_PAIR_EXCESS_PENALTY

    return total_score


def friday_department_issues(project: ScheduleProject, exams: list[ScheduledExam]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    course_lookup = {course.course_code: course for course in project.courses}

    for window in project.moed_windows:
        friday_exams = [exam for exam in exams if exam.moed_number == window.moed_number and date_is_friday(exam.exam_date)]
        for department in DEPARTMENTS:
            matching_exams = [
                exam
                for exam in friday_exams
                if (course := course_lookup.get(exam.course_code)) is not None and department in course_departments(course)
            ]
            if len(matching_exams) <= 1:
                continue

            for exam in matching_exams:
                issues.append(
                    ValidationIssue(
                        code="unsatisfied_constraint",
                        severity="error",
                        message=f"Department {department} can have at most one Friday exam during {window.moed_number}.",
                        related_course_code=exam.course_code,
                        related_date=exam.exam_date,
                    )
                )

    return issues


def pair_constraint_issues(
    project: ScheduleProject,
    moved_course: CourseInput,
    moved_date: date,
    other_course: CourseInput,
    other_date: date,
) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    distance = gap_days(moved_date, other_date)
    moved_window = moed_window_for_date(project, moved_date)
    other_window = moed_window_for_date(project, other_date)
    if moved_window is None or other_window is None or moved_window.moed_number != other_window.moed_number:
        return issues

    same_semester_gap = moved_window.same_semester_gap_days
    prerequisite_gap = moved_window.prerequisite_gap_days
    high_failure_gap = moved_window.high_failure_gap_days

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
                message=(
                    f"High-failure courses must stay at least {high_failure_gap} days away "
                    "from exams in their two preceding semesters."
                ),
                related_course_code=other_course.course_code,
                related_date=other_date,
            )
        )

    return issues


def validate_solution_exams(project: ScheduleProject, exams: list[ScheduledExam]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    course_lookup = {course.course_code: course for course in project.courses}
    fixed_exam_lookup = {fixed_exam.course_code: fixed_exam for fixed_exam in project.fixed_exams}
    fixed_exams_by_prerequisite_code: dict[str, list] = {}
    for fixed_exam in project.fixed_exams:
        for prerequisite_code in fixed_exam.prerequisite_course_codes:
            fixed_exams_by_prerequisite_code.setdefault(prerequisite_code, []).append(fixed_exam)

    for exam in exams:
        if not date_in_any_window(project, exam.exam_date):
            issues.append(
                ValidationIssue(
                    code="unsatisfied_constraint",
                    severity="error",
                    message="Scheduled exams must stay inside the Moed A window.",
                    related_course_code=exam.course_code,
                    related_date=exam.exam_date,
                )
            )
        else:
            inferred_moed_number = moed_number_for_date(project, exam.exam_date)
            if inferred_moed_number is not None and exam.moed_number != inferred_moed_number:
                issues.append(
                    ValidationIssue(
                        code="unsatisfied_constraint",
                        severity="error",
                        message="Scheduled exam must remain in its assigned Moed window.",
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

        if date_is_saturday(exam.exam_date):
            issues.append(
                ValidationIssue(
                    code="unsatisfied_constraint",
                    severity="error",
                    message="Scheduled exams cannot be placed on Saturdays.",
                    related_course_code=exam.course_code,
                    related_date=exam.exam_date,
                )
            )

    for fixed_exam in project.fixed_exams:
        fixed_exam_moed_number = moed_number_for_date(project, fixed_exam.exam_date)
        matching_exam = next(
            (
                exam
                for exam in exams
                if exam.course_code == fixed_exam.course_code and exam.moed_number == fixed_exam_moed_number
            ),
            None,
        )
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

        exam_window = moed_window_for_date(project, exam.exam_date)
        if exam_window is None:
            continue

        for prerequisite_code in course.prerequisite_course_codes:
            prerequisite_fixed_exam = fixed_exam_lookup.get(prerequisite_code)
            if prerequisite_fixed_exam is None:
                continue
            prerequisite_fixed_exam_window = moed_window_for_date(project, prerequisite_fixed_exam.exam_date)
            if prerequisite_fixed_exam_window is None or prerequisite_fixed_exam_window.moed_number != exam_window.moed_number:
                continue

            distance = gap_days(exam.exam_date, prerequisite_fixed_exam.exam_date)
            if distance < exam_window.prerequisite_gap_days:
                issues.append(
                    ValidationIssue(
                        code="unsatisfied_constraint",
                        severity="error",
                        message=(
                            "Prerequisite-linked fixed and scheduled exams need at least "
                            f"{exam_window.prerequisite_gap_days} free day(s)."
                        ),
                        related_course_code=exam.course_code,
                        related_date=exam.exam_date,
                    )
                )

        for dependent_fixed_exam in fixed_exams_by_prerequisite_code.get(exam.course_code, []):
            dependent_fixed_exam_window = moed_window_for_date(project, dependent_fixed_exam.exam_date)
            if dependent_fixed_exam_window is None or dependent_fixed_exam_window.moed_number != exam_window.moed_number:
                continue

            distance = gap_days(exam.exam_date, dependent_fixed_exam.exam_date)
            if distance < exam_window.prerequisite_gap_days:
                issues.append(
                    ValidationIssue(
                        code="unsatisfied_constraint",
                        severity="error",
                        message=(
                            "Prerequisite-linked fixed and scheduled exams need at least "
                            f"{exam_window.prerequisite_gap_days} free day(s)."
                        ),
                        related_course_code=exam.course_code,
                        related_date=exam.exam_date,
                    )
                )

    issues.extend(friday_department_issues(project, exams))

    return issues


def validate_project(project: ScheduleProject) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []

    seen_course_codes: set[str] = set()
    course_lookup = {course.course_code: course for course in project.courses}
    fixed_exam_lookup = {fixed_exam.course_code: fixed_exam for fixed_exam in project.fixed_exams}

    for excluded_range in project.excluded_ranges:
        if not range_in_any_window(project, excluded_range.start_date, excluded_range.end_date):
            issues.append(
                ValidationIssue(
                    code="excluded_outside_window",
                    severity="error",
                    message="Excluded dates must stay inside the Moed A window.",
                    related_date=excluded_range.start_date,
                )
            )

    for fixed_exam in project.fixed_exams:
        if not date_in_any_window(project, fixed_exam.exam_date):
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
        if date_is_saturday(fixed_exam.exam_date):
            issues.append(
                ValidationIssue(
                    code="unsatisfied_constraint",
                    severity="error",
                    message="Fixed exams cannot be placed on Saturdays.",
                    related_course_code=fixed_exam.course_code,
                    related_date=fixed_exam.exam_date,
                )
            )
        missing_prerequisite_codes = [
            prerequisite_code
            for prerequisite_code in fixed_exam.prerequisite_course_codes
            if prerequisite_code not in course_lookup and prerequisite_code not in fixed_exam_lookup
        ]
        if missing_prerequisite_codes:
            issues.append(
                ValidationIssue(
                    code="missing_prerequisite_target",
                    severity="error",
                    message=(
                        "Fixed exam prerequisite course codes must match other courses or fixed exams in the project: "
                        f"{', '.join(missing_prerequisite_codes)}."
                    ),
                    related_course_code=fixed_exam.course_code,
                )
            )

    for fixed_exam in project.fixed_exams:
        current_window = moed_window_for_date(project, fixed_exam.exam_date)
        if current_window is None:
            continue
        for prerequisite_code in fixed_exam.prerequisite_course_codes:
            prerequisite_exam = fixed_exam_lookup.get(prerequisite_code)
            if prerequisite_exam is None:
                continue
            prerequisite_window = moed_window_for_date(project, prerequisite_exam.exam_date)
            if prerequisite_window is None or prerequisite_window.moed_number != current_window.moed_number:
                continue

            distance = gap_days(fixed_exam.exam_date, prerequisite_exam.exam_date)
            if distance < current_window.prerequisite_gap_days:
                issues.append(
                    ValidationIssue(
                        code="unsatisfied_constraint",
                        severity="error",
                        message=(
                            "Fixed exams linked by prerequisites must keep at least "
                            f"{current_window.prerequisite_gap_days} free day(s) in the same Moed."
                        ),
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

        missing_prerequisite_codes = [
            prerequisite_code
            for prerequisite_code in course.prerequisite_course_codes
            if prerequisite_code not in course_lookup and prerequisite_code not in fixed_exam_lookup
        ]
        if missing_prerequisite_codes:
            issues.append(
                ValidationIssue(
                    code="missing_prerequisite_target",
                    severity="error",
                    message=(
                        "Prerequisite course codes must match other courses or fixed exams in the project: "
                        f"{', '.join(missing_prerequisite_codes)}."
                    ),
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
        if exam.course_code == request.course_code and exam.moed_number == request.moed_number:
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

    if not date_in_any_window(request.project, request.new_date):
        move_issues.append(
            ValidationIssue(
                code="manual_move_conflict",
                severity="error",
                message="Manual move must stay inside the Moed A window.",
                related_course_code=request.course_code,
                related_date=request.new_date,
            )
        )

    target_moed_number = moed_number_for_date(request.project, request.new_date)
    if target_moed_number is not None and target_moed_number != request.moed_number:
        move_issues.append(
            ValidationIssue(
                code="manual_move_conflict",
                severity="error",
                message="Manual move must stay inside the selected Moed window.",
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
        fixed_exam_moed_number = moed_number_for_date(request.project, fixed_exam.exam_date)
        if fixed_exam.course_code == request.course_code and fixed_exam_moed_number == request.moed_number and fixed_exam.exam_date != request.new_date:
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
        diagnostics=build_solution_diagnostics(request.project, updated_exams),
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
            "diagnostics": preview_solution.diagnostics.model_dump(mode="json"),
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
            "diagnostics": preview_solution.diagnostics.model_dump(mode="json"),
        },
    }
