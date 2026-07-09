from datetime import date

from fastapi import HTTPException

from app.api.routes.projects import solve_schedule_project
from app.models.schedule import ConstraintConfig, CourseInput, DateRange, ExcludedDateRange, FixedExam, ScheduleProject, ScheduledExam, SolveRequest
from app.services.solver import solve_project
from app.models.schedule import ManualMoveRequest
from app.services.validation import (
    explain_manual_move,
    gap_days,
    ideal_gap_target_days,
    iter_allowed_dates,
    pair_requires_prerequisite_gap,
    score_solution,
    validate_manual_move,
    validate_project,
    validate_solution_exams,
)


def test_solve_project_returns_solutions_for_feasible_input() -> None:
    project = ScheduleProject(
        project_name="Feasible",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-10"),
        courses=[
            CourseInput(course_code="ALG1", course_name="Algebra 1", semester_number=1, high_failure_rate=True),
            CourseInput(course_code="CALC1", course_name="Calculus 1", semester_number=1),
            CourseInput(
                course_code="ALG2",
                course_name="Algebra 2",
                semester_number=2,
                prerequisite_course_codes=["ALG1"],
            ),
        ],
    )

    result = solve_project(SolveRequest(project=project, max_solutions=3))

    assert result["issues"] == []
    assert len(result["solutions"]) >= 1
    assert {exam["course_code"] for exam in result["solutions"][0]["exams"]} == {"ALG1", "CALC1", "ALG2"}


def test_solve_project_generates_variants_that_differ_from_base_solution() -> None:
    project = ScheduleProject(
        project_name="Variant diversity",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-20"),
        courses=[
            CourseInput(course_code="S1A", course_name="Semester 1 A", semester_number=1),
            CourseInput(course_code="S1B", course_name="Semester 1 B", semester_number=1),
            CourseInput(course_code="S2A", course_name="Semester 2 A", semester_number=2),
            CourseInput(course_code="S3A", course_name="Semester 3 A", semester_number=3),
            CourseInput(course_code="S4A", course_name="Semester 4 A", semester_number=4),
            CourseInput(course_code="S5A", course_name="Semester 5 A", semester_number=5),
        ],
    )

    result = solve_project(SolveRequest(project=project, max_solutions=5))

    assert result["issues"] == []
    assert len(result["solutions"]) >= 2

    base_dates = {exam["course_code"]: exam["exam_date"] for exam in result["solutions"][0]["exams"]}
    for variant in result["solutions"][1:]:
        changed_course_count = sum(
            1 for exam in variant["exams"] if base_dates[exam["course_code"]] != exam["exam_date"]
        )
        assert changed_course_count >= 1


def test_solve_project_accepts_custom_variant_strategy_timing() -> None:
    project = ScheduleProject(
        project_name="Custom timing",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-12"),
        courses=[
            CourseInput(course_code="ALG1", course_name="Algebra 1", semester_number=1),
            CourseInput(course_code="ALG2", course_name="Algebra 2", semester_number=2),
            CourseInput(course_code="ALG3", course_name="Algebra 3", semester_number=3),
        ],
    )

    result = solve_project(
        SolveRequest(
            project=project,
            max_solutions=4,
            base_solution_time_seconds=20,
            variant_solution_time_seconds=3,
            diversity_mode="balanced",
            variant_min_changed_exams=1,
        )
    )

    assert result["issues"] == []
    assert len(result["solutions"]) >= 1


def test_pair_requires_prerequisite_gap_supports_multiple_prerequisites() -> None:
    dependent_course = CourseInput(
        course_code="ALG3",
        course_name="Advanced Algebra",
        semester_number=3,
        prerequisite_course_codes=["ALG1", "CALC1"],
    )
    prerequisite_course = CourseInput(course_code="CALC1", course_name="Calculus 1", semester_number=2)

    assert pair_requires_prerequisite_gap(dependent_course, prerequisite_course) is True


def test_solve_project_reports_no_feasible_schedule_when_constraints_conflict() -> None:
    project = ScheduleProject(
        project_name="Infeasible",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-04"),
        courses=[
            CourseInput(course_code="S1A", course_name="Semester 1 A", semester_number=1),
            CourseInput(course_code="S1B", course_name="Semester 1 B", semester_number=1),
            CourseInput(course_code="S1C", course_name="Semester 1 C", semester_number=1),
        ],
    )

    result = solve_project(SolveRequest(project=project, max_solutions=2))

    assert result["solutions"] == []
    assert any(issue["code"] == "no_feasible_schedule" for issue in result["issues"])


def test_solve_schedule_project_serializes_blocking_issue_dates() -> None:
    project = ScheduleProject(
        project_name="Invalid excluded date",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-10"),
        excluded_ranges=[
            ExcludedDateRange(start_date="2026-05-19", end_date="2026-05-19", reason="Outside window"),
        ],
    )

    try:
        solve_schedule_project(SolveRequest(project=project, max_solutions=1))
    except HTTPException as error:
        assert error.status_code == 422
        assert error.detail == [
            {
                "code": "excluded_outside_window",
                "severity": "error",
                "message": "Excluded dates must stay inside the Moed A window.",
                "related_course_code": None,
                "related_date": "2026-05-19",
            }
        ]
    else:
        raise AssertionError("Expected solve_schedule_project to reject excluded dates outside the window.")


def test_validate_project_rejects_fixed_exam_on_excluded_date() -> None:
    project = ScheduleProject(
        project_name="Invalid fixed exam",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-10"),
        excluded_ranges=[
            ExcludedDateRange(start_date="2026-06-04", end_date="2026-06-04", reason="Holiday"),
        ],
        fixed_exams=[
            FixedExam(course_code="PHY1", course_name="Physics 1", exam_date="2026-06-04", locked=True, reason="Faculty locked"),
        ],
        courses=[
            CourseInput(course_code="PHY1", course_name="Physics 1", semester_number=1),
        ],
    )

    issues = validate_project(project)

    assert any(issue.code == "unsatisfied_constraint" for issue in issues)
    assert any(issue.related_course_code == "PHY1" for issue in issues)


def test_validate_project_rejects_missing_fixed_exam_prerequisite_target() -> None:
    project = ScheduleProject(
        project_name="Invalid fixed exam prerequisite",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-10"),
        fixed_exams=[
            FixedExam(
                course_code="PHY1",
                course_name="Physics 1",
                prerequisite_course_codes=["MATH0"],
                exam_date="2026-06-04",
                locked=True,
            ),
        ],
        courses=[
            CourseInput(course_code="PHY1", course_name="Physics 1", semester_number=1),
        ],
    )

    issues = validate_project(project)

    assert any(issue.code == "missing_prerequisite_target" for issue in issues)
    assert any(issue.related_course_code == "PHY1" for issue in issues)


def test_validate_project_allows_course_prerequisite_to_reference_fixed_exam() -> None:
    project = ScheduleProject(
        project_name="Course prerequisite fixed target",
        moed_a_window=DateRange(start_date="2026-06-15", end_date="2026-07-15"),
        fixed_exams=[
            FixedExam(course_code="51222", course_name="Fixed prerequisite", exam_date="2026-06-20", locked=True),
        ],
        courses=[
            CourseInput(course_code="51224", course_name="Dependent course", semester_number=3, prerequisite_course_codes=["51222"]),
        ],
    )

    issues = validate_project(project)

    assert not any(issue.code == "missing_prerequisite_target" and issue.related_course_code == "51224" for issue in issues)


def test_validate_solution_exams_rejects_course_fixed_prerequisite_gap_violation() -> None:
    project = ScheduleProject(
        project_name="Course fixed prerequisite gap",
        moed_a_window=DateRange(start_date="2026-06-15", end_date="2026-07-15"),
        fixed_exams=[
            FixedExam(course_code="51222", course_name="Fixed prerequisite", exam_date="2026-06-20", locked=True),
        ],
        courses=[
            CourseInput(course_code="51224", course_name="Dependent course", semester_number=3, prerequisite_course_codes=["51222"]),
        ],
    )

    issues = validate_solution_exams(
        project,
        [
            ScheduledExam(course_code="51224", exam_date="2026-06-22", source="solver"),
        ],
    )

    assert any(
        issue.code == "unsatisfied_constraint"
        and "Prerequisite-linked fixed and scheduled exams need at least 3 free day(s)." in issue.message
        for issue in issues
    )


def test_solve_project_rejects_infeasible_course_fixed_prerequisite_gap() -> None:
    project = ScheduleProject(
        project_name="Infeasible fixed prerequisite gap",
        moed_a_window=DateRange(start_date="2026-06-19", end_date="2026-06-22"),
        fixed_exams=[
            FixedExam(course_code="51222", course_name="Fixed prerequisite", exam_date="2026-06-19", locked=True),
        ],
        courses=[
            CourseInput(course_code="51224", course_name="Dependent course", semester_number=3, prerequisite_course_codes=["51222"]),
        ],
    )

    result = solve_project(SolveRequest(project=project, max_solutions=1))

    assert result["solutions"] == []
    assert any(issue["code"] == "no_feasible_schedule" for issue in result["issues"])


def test_solve_project_enforces_gap_between_adjacent_semesters() -> None:
    project = ScheduleProject(
        project_name="Adjacent semester gap",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-10"),
        courses=[
            CourseInput(course_code="SEM5", course_name="Semester 5 Course", semester_number=5),
            CourseInput(course_code="SEM6", course_name="Semester 6 Course", semester_number=6),
        ],
    )

    result = solve_project(SolveRequest(project=project, max_solutions=1))

    assert result["issues"] == []
    exams_by_code = {exam["course_code"]: exam["exam_date"] for exam in result["solutions"][0]["exams"]}
    assert abs((date.fromisoformat(exams_by_code["SEM5"]) - date.fromisoformat(exams_by_code["SEM6"])).days) <= 2


def test_solve_project_allows_same_day_for_separate_departments() -> None:
    project = ScheduleProject(
        project_name="Department split same day",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-01"),
        courses=[
            CourseInput(course_code="SW1", course_name="Software 1", semester_number=5, department="SW"),
            CourseInput(course_code="IS1", course_name="Information Systems 1", semester_number=6, department="IS"),
        ],
    )

    result = solve_project(SolveRequest(project=project, max_solutions=1))

    assert result["issues"] == []
    assert [exam["exam_date"] for exam in result["solutions"][0]["exams"]] == ["2026-06-01", "2026-06-01"]


def test_solve_project_treats_blank_department_as_shared_for_gap_constraints() -> None:
    project = ScheduleProject(
        project_name="Shared department gap",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-02"),
        courses=[
            CourseInput(course_code="ALL1", course_name="Shared Course", semester_number=5),
            CourseInput(course_code="SW1", course_name="Software 1", semester_number=6, department="SW"),
        ],
    )

    result = solve_project(SolveRequest(project=project, max_solutions=1))

    assert result["issues"] == []
    assert len(result["solutions"]) >= 1


def test_solve_project_never_uses_saturday_dates() -> None:
    project = ScheduleProject(
        project_name="Saturday blocked",
        moed_a_window=DateRange(start_date="2026-06-05", end_date="2026-06-08"),
        courses=[
            CourseInput(course_code="SEM1", course_name="Semester 1", semester_number=1),
            CourseInput(course_code="SEM2", course_name="Semester 2", semester_number=2),
        ],
    )

    result = solve_project(SolveRequest(project=project, max_solutions=1))

    assert result["issues"] == []
    assert all(date.fromisoformat(exam["exam_date"]).weekday() != 5 for exam in result["solutions"][0]["exams"])


def test_solve_project_prefers_non_friday_dates_when_feasible() -> None:
    project = ScheduleProject(
        project_name="Friday preference",
        moed_a_window=DateRange(start_date="2026-06-04", end_date="2026-06-07"),
        courses=[
            CourseInput(course_code="ONLY1", course_name="Only Course", semester_number=1),
        ],
    )

    result = solve_project(SolveRequest(project=project, max_solutions=1))

    assert result["issues"] == []
    assert result["solutions"][0]["exams"][0]["exam_date"] != "2026-06-05"


def test_solve_project_allows_one_friday_per_department() -> None:
    project = ScheduleProject(
        project_name="Friday per department",
        moed_a_window=DateRange(start_date="2026-06-05", end_date="2026-06-05"),
        courses=[
            CourseInput(course_code="SW1", course_name="Software 1", semester_number=1, department="SW"),
            CourseInput(course_code="IS1", course_name="Information Systems 1", semester_number=1, department="IS"),
        ],
    )

    result = solve_project(SolveRequest(project=project, max_solutions=1))

    assert result["issues"] == []
    assert len(result["solutions"]) == 1
    assert [exam["exam_date"] for exam in result["solutions"][0]["exams"]] == ["2026-06-05", "2026-06-05"]


def test_solve_project_blocks_second_friday_for_same_department() -> None:
    project = ScheduleProject(
        project_name="Friday same department blocked",
        moed_a_window=DateRange(start_date="2026-06-05", end_date="2026-06-05"),
        courses=[
            CourseInput(course_code="SW1", course_name="Software 1", semester_number=1, department="SW"),
            CourseInput(course_code="SW2", course_name="Software 2", semester_number=3, department="SW"),
        ],
    )

    result = solve_project(SolveRequest(project=project, max_solutions=1))

    assert result["solutions"] == []
    assert any(issue["code"] == "no_feasible_schedule" for issue in result["issues"])


def test_solve_project_blocks_second_friday_when_shared_department_course_uses_it() -> None:
    project = ScheduleProject(
        project_name="Friday shared course blocks departments",
        moed_a_window=DateRange(start_date="2026-06-05", end_date="2026-06-05"),
        courses=[
            CourseInput(course_code="ALL1", course_name="Shared Course", semester_number=1),
            CourseInput(course_code="SW1", course_name="Software 1", semester_number=3, department="SW"),
        ],
    )

    result = solve_project(SolveRequest(project=project, max_solutions=1))

    assert result["solutions"] == []
    assert any(issue["code"] == "no_feasible_schedule" for issue in result["issues"])


def test_validate_solution_exams_rejects_adjacent_semesters_with_less_than_two_day_gap() -> None:
    project = ScheduleProject(
        project_name="Adjacent semester validation",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-10"),
        courses=[
            CourseInput(course_code="SEM1", course_name="Semester 1", semester_number=1),
            CourseInput(course_code="SEM2", course_name="Semester 2", semester_number=2),
        ],
    )

    issues = validate_solution_exams(
        project,
        [
            ScheduledExam(course_code="SEM1", exam_date="2026-06-01", source="solver"),
            ScheduledExam(course_code="SEM2", exam_date="2026-06-02", source="solver"),
        ],
    )

    assert not any("back-to-back semesters need at least" in issue.message for issue in issues)


def test_validate_solution_exams_rejects_saturday_exam() -> None:
    project = ScheduleProject(
        project_name="Saturday validation",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-10"),
        courses=[
            CourseInput(course_code="SEM1", course_name="Semester 1", semester_number=1),
        ],
    )

    issues = validate_solution_exams(
        project,
        [
            ScheduledExam(course_code="SEM1", exam_date="2026-06-06", source="solver"),
        ],
    )

    assert any("cannot be placed on Saturdays" in issue.message for issue in issues)


def test_validate_solution_exams_rejects_multiple_fridays_for_same_department() -> None:
    project = ScheduleProject(
        project_name="Friday validation by department",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-15"),
        courses=[
            CourseInput(course_code="SW1", course_name="Software 1", semester_number=1, department="SW"),
            CourseInput(course_code="SW2", course_name="Software 2", semester_number=3, department="SW"),
        ],
    )

    issues = validate_solution_exams(
        project,
        [
            ScheduledExam(course_code="SW1", exam_date="2026-06-05", source="solver"),
            ScheduledExam(course_code="SW2", exam_date="2026-06-12", source="solver"),
        ],
    )

    assert any("Department SW can have at most one Friday exam" in issue.message for issue in issues)


def test_validate_solution_exams_counts_blank_department_as_both_on_friday() -> None:
    project = ScheduleProject(
        project_name="Friday validation shared department",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-15"),
        courses=[
            CourseInput(course_code="ALL1", course_name="Shared Course", semester_number=1),
            CourseInput(course_code="IS1", course_name="Information Systems 1", semester_number=3, department="IS"),
        ],
    )

    issues = validate_solution_exams(
        project,
        [
            ScheduledExam(course_code="ALL1", exam_date="2026-06-05", source="solver"),
            ScheduledExam(course_code="IS1", exam_date="2026-06-12", source="solver"),
        ],
    )

    assert any("Department IS can have at most one Friday exam" in issue.message for issue in issues)


def test_score_solution_penalizes_friday_and_prefers_interleaved_same_semester_gaps() -> None:
    project = ScheduleProject(
        project_name="Scoring preferences",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-15"),
        courses=[
            CourseInput(course_code="S7A", course_name="Semester 7 A", semester_number=7),
            CourseInput(course_code="S7B", course_name="Semester 7 B", semester_number=7),
            CourseInput(course_code="S8A", course_name="Semester 8 A", semester_number=8),
            CourseInput(course_code="S8B", course_name="Semester 8 B", semester_number=8),
        ],
    )

    friday_schedule = [
        ScheduledExam(course_code="S7A", exam_date="2026-06-05", source="solver"),
    ]
    non_friday_schedule = [
        ScheduledExam(course_code="S7A", exam_date="2026-06-04", source="solver"),
    ]
    clustered_schedule = [
        ScheduledExam(course_code="S7A", exam_date="2026-06-01", source="solver"),
        ScheduledExam(course_code="S7B", exam_date="2026-06-08", source="solver"),
        ScheduledExam(course_code="S8A", exam_date="2026-06-09", source="solver"),
        ScheduledExam(course_code="S8B", exam_date="2026-06-15", source="solver"),
    ]
    interleaved_schedule = [
        ScheduledExam(course_code="S7A", exam_date="2026-06-01", source="solver"),
        ScheduledExam(course_code="S8A", exam_date="2026-06-04", source="solver"),
        ScheduledExam(course_code="S7B", exam_date="2026-06-10", source="solver"),
        ScheduledExam(course_code="S8B", exam_date="2026-06-15", source="solver"),
    ]

    assert score_solution(project, non_friday_schedule) > score_solution(project, friday_schedule)
    assert score_solution(project, interleaved_schedule) > score_solution(project, clustered_schedule)


def test_ideal_gap_target_uses_constrained_subset() -> None:
    project = ScheduleProject(
        project_name="Ideal gap month",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-12"),
        courses=[
            CourseInput(course_code="S1A", course_name="Semester 1 A", semester_number=1),
            CourseInput(course_code="S1B", course_name="Semester 1 B", semester_number=1),
            CourseInput(course_code="FREE", course_name="Independent Course", semester_number=8, department="IS"),
        ],
    )

    assert ideal_gap_target_days(project) == 5


def test_score_solution_prefers_gaps_closer_to_ideal_for_constrained_pairs() -> None:
    project = ScheduleProject(
        project_name="Ideal gap scoring",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-12"),
        courses=[
            CourseInput(course_code="S1A", course_name="Semester 1 A", semester_number=1),
            CourseInput(course_code="S1B", course_name="Semester 1 B", semester_number=1),
            CourseInput(course_code="FREE", course_name="Independent Course", semester_number=8, department="IS"),
        ],
    )

    near_ideal_schedule = [
        ScheduledExam(course_code="S1A", exam_date="2026-06-01", source="solver"),
        ScheduledExam(course_code="FREE", exam_date="2026-06-06", source="solver"),
        ScheduledExam(course_code="S1B", exam_date="2026-06-11", source="solver"),
    ]
    far_from_ideal_schedule = [
        ScheduledExam(course_code="S1A", exam_date="2026-06-01", source="solver"),
        ScheduledExam(course_code="FREE", exam_date="2026-06-02", source="solver"),
        ScheduledExam(course_code="S1B", exam_date="2026-06-05", source="solver"),
    ]

    assert score_solution(project, far_from_ideal_schedule) > score_solution(project, near_ideal_schedule)


def test_score_solution_prefers_earlier_semester_start_dates() -> None:
    project = ScheduleProject(
        project_name="Semester early start scoring",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-20"),
        courses=[
            CourseInput(course_code="S2A", course_name="Semester 2 A", semester_number=2),
            CourseInput(course_code="S2B", course_name="Semester 2 B", semester_number=2),
            CourseInput(course_code="S3A", course_name="Semester 3 A", semester_number=3),
            CourseInput(course_code="S3B", course_name="Semester 3 B", semester_number=3),
        ],
    )

    early_start_schedule = [
        ScheduledExam(course_code="S2A", exam_date="2026-06-02", source="solver"),
        ScheduledExam(course_code="S2B", exam_date="2026-06-06", source="solver"),
        ScheduledExam(course_code="S3A", exam_date="2026-06-03", source="solver"),
        ScheduledExam(course_code="S3B", exam_date="2026-06-07", source="solver"),
    ]
    late_start_schedule = [
        ScheduledExam(course_code="S2A", exam_date="2026-06-12", source="solver"),
        ScheduledExam(course_code="S2B", exam_date="2026-06-16", source="solver"),
        ScheduledExam(course_code="S3A", exam_date="2026-06-13", source="solver"),
        ScheduledExam(course_code="S3B", exam_date="2026-06-17", source="solver"),
    ]

    assert score_solution(project, early_start_schedule) > score_solution(project, late_start_schedule)


def test_score_solution_prefers_compact_semester_spans() -> None:
    project = ScheduleProject(
        project_name="Semester compactness scoring",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-25"),
        courses=[
            CourseInput(course_code="S2A", course_name="Semester 2 A", semester_number=2),
            CourseInput(course_code="S2B", course_name="Semester 2 B", semester_number=2),
            CourseInput(course_code="S2C", course_name="Semester 2 C", semester_number=2),
            CourseInput(course_code="S5A", course_name="Semester 5 A", semester_number=5),
        ],
    )

    compact_schedule = [
        ScheduledExam(course_code="S2A", exam_date="2026-06-02", source="solver"),
        ScheduledExam(course_code="S2B", exam_date="2026-06-04", source="solver"),
        ScheduledExam(course_code="S2C", exam_date="2026-06-06", source="solver"),
        ScheduledExam(course_code="S5A", exam_date="2026-06-05", source="solver"),
    ]
    wide_span_schedule = [
        ScheduledExam(course_code="S2A", exam_date="2026-06-02", source="solver"),
        ScheduledExam(course_code="S2B", exam_date="2026-06-14", source="solver"),
        ScheduledExam(course_code="S2C", exam_date="2026-06-22", source="solver"),
        ScheduledExam(course_code="S5A", exam_date="2026-06-05", source="solver"),
    ]

    assert score_solution(project, compact_schedule) > score_solution(project, wide_span_schedule)


def test_score_solution_penalizes_semester_without_exam_in_first_week() -> None:
    project = ScheduleProject(
        project_name="Semester first-week start",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-25"),
        courses=[
            CourseInput(course_code="S2A", course_name="Semester 2 A", semester_number=2),
            CourseInput(course_code="S2B", course_name="Semester 2 B", semester_number=2),
            CourseInput(course_code="S3A", course_name="Semester 3 A", semester_number=3),
            CourseInput(course_code="S3B", course_name="Semester 3 B", semester_number=3),
        ],
    )

    starts_in_week_one = [
        ScheduledExam(course_code="S2A", exam_date="2026-06-03", source="solver"),
        ScheduledExam(course_code="S2B", exam_date="2026-06-08", source="solver"),
        ScheduledExam(course_code="S3A", exam_date="2026-06-02", source="solver"),
        ScheduledExam(course_code="S3B", exam_date="2026-06-09", source="solver"),
    ]
    starts_after_week_one = [
        ScheduledExam(course_code="S2A", exam_date="2026-06-15", source="solver"),
        ScheduledExam(course_code="S2B", exam_date="2026-06-18", source="solver"),
        ScheduledExam(course_code="S3A", exam_date="2026-06-14", source="solver"),
        ScheduledExam(course_code="S3B", exam_date="2026-06-19", source="solver"),
    ]

    assert score_solution(project, starts_in_week_one) > score_solution(project, starts_after_week_one)


def test_score_solution_allows_single_adjacent_same_day_prerequisite_pair() -> None:
    project = ScheduleProject(
        project_name="Single adjacent prerequisite same-day",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-10"),
        moed_windows=[
            {
                "start_date": "2026-06-01",
                "end_date": "2026-06-10",
                "same_semester_gap_days": 3,
                "prerequisite_gap_days": 0,
                "high_failure_gap_days": 3,
            }
        ],
        courses=[
            CourseInput(course_code="S2A", course_name="Semester 2 A", semester_number=2),
            CourseInput(course_code="S3A", course_name="Semester 3 A", semester_number=3, prerequisite_course_codes=["S2A"]),
            CourseInput(course_code="S4A", course_name="Semester 4 A", semester_number=4),
        ],
    )

    prerequisite_pair_same_day = [
        ScheduledExam(course_code="S2A", exam_date="2026-06-02", source="solver"),
        ScheduledExam(course_code="S3A", exam_date="2026-06-02", source="solver"),
        ScheduledExam(course_code="S4A", exam_date="2026-06-05", source="solver"),
    ]
    non_prerequisite_adjacent_same_day = [
        ScheduledExam(course_code="S2A", exam_date="2026-06-02", source="solver"),
        ScheduledExam(course_code="S3A", exam_date="2026-06-05", source="solver"),
        ScheduledExam(course_code="S4A", exam_date="2026-06-05", source="solver"),
    ]

    assert score_solution(project, prerequisite_pair_same_day) > score_solution(project, non_prerequisite_adjacent_same_day)


def test_solve_project_prefers_solution_closer_to_ideal_gap() -> None:
    project = ScheduleProject(
        project_name="Ideal gap solver preference",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-12"),
        courses=[
            CourseInput(course_code="S1A", course_name="Semester 1 A", semester_number=1),
            CourseInput(course_code="S1B", course_name="Semester 1 B", semester_number=1),
            CourseInput(course_code="FREE", course_name="Independent Course", semester_number=8, department="IS"),
        ],
    )

    result = solve_project(SolveRequest(project=project, max_solutions=1))

    assert result["issues"] == []
    scheduled_dates = [date.fromisoformat(exam["exam_date"]) for exam in result["solutions"][0]["exams"]]
    assert max(scheduled_dates) <= date(2026, 6, 9)


def test_solve_project_uses_last_week_of_month_window() -> None:
    project = ScheduleProject(
        project_name="Month window spread",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-30"),
        courses=[
            CourseInput(course_code="SW1", course_name="Software 1", semester_number=1, department="SW"),
            CourseInput(course_code="IS1", course_name="Information Systems 1", semester_number=3, department="IS"),
            CourseInput(course_code="SW2", course_name="Software 2", semester_number=5, department="SW"),
            CourseInput(course_code="IS2", course_name="Information Systems 2", semester_number=7, department="IS"),
            CourseInput(course_code="ALL1", course_name="Shared 1", semester_number=2),
            CourseInput(course_code="ALL2", course_name="Shared 2", semester_number=4),
        ],
    )

    result = solve_project(SolveRequest(project=project, max_solutions=1))

    assert result["issues"] == []
    latest_exam = max(date.fromisoformat(exam["exam_date"]) for exam in result["solutions"][0]["exams"])
    assert latest_exam <= date(2026, 6, 20)


def test_gap_days_uses_free_day_semantics() -> None:
    assert gap_days(date(2026, 6, 9), date(2026, 6, 12)) == 2
    assert gap_days(date(2026, 6, 9), date(2026, 6, 10)) == 0
    assert gap_days(date(2026, 6, 9), date(2026, 6, 9)) == 0


def test_schedule_project_allows_zero_prerequisite_gap() -> None:
    project = ScheduleProject(
        project_name="Zero prerequisite gap",
        moed_windows=[
            {
                "start_date": "2026-06-01",
                "end_date": "2026-06-03",
                "same_semester_gap_days": 3,
                "prerequisite_gap_days": 0,
                "high_failure_gap_days": 3,
            }
        ],
        courses=[
            CourseInput(course_code="ALG1", course_name="Algebra 1", semester_number=1),
            CourseInput(course_code="ALG2", course_name="Algebra 2", semester_number=2, prerequisite_course_codes=["ALG1"]),
        ],
    )

    assert project.moed_windows[0].prerequisite_gap_days == 0


def test_schedule_project_allows_zero_same_semester_and_high_failure_gap() -> None:
    project = ScheduleProject(
        project_name="Zero same-semester and high-failure gap",
        moed_windows=[
            {
                "start_date": "2026-06-01",
                "end_date": "2026-06-03",
                "same_semester_gap_days": 0,
                "prerequisite_gap_days": 0,
                "high_failure_gap_days": 0,
            }
        ],
        courses=[
            CourseInput(course_code="S1A", course_name="Semester 1 A", semester_number=1),
            CourseInput(course_code="S1B", course_name="Semester 1 B", semester_number=1),
            CourseInput(course_code="HF1", course_name="High Failure 1", semester_number=2, high_failure_rate=True),
            CourseInput(course_code="S3A", course_name="Semester 3 A", semester_number=3),
        ],
    )

    assert project.moed_windows[0].same_semester_gap_days == 0
    assert project.moed_windows[0].high_failure_gap_days == 0


def test_solve_project_allows_same_day_when_all_window_gaps_are_zero() -> None:
    project = ScheduleProject(
        project_name="Zero all gaps same-day",
        moed_windows=[
            {
                "start_date": "2026-06-01",
                "end_date": "2026-06-01",
                "same_semester_gap_days": 0,
                "prerequisite_gap_days": 0,
                "high_failure_gap_days": 0,
            }
        ],
        courses=[
            CourseInput(course_code="S1A", course_name="Semester 1 A", semester_number=1),
            CourseInput(course_code="S1B", course_name="Semester 1 B", semester_number=1),
        ],
    )

    result = solve_project(SolveRequest(project=project, max_solutions=1))

    assert result["issues"] == []
    assert len(result["solutions"]) == 1
    assert [exam["exam_date"] for exam in result["solutions"][0]["exams"]] == ["2026-06-01", "2026-06-01"]


def test_solve_project_allows_same_day_for_prerequisite_when_gap_is_zero() -> None:
    project = ScheduleProject(
        project_name="Zero prerequisite same-day",
        moed_windows=[
            {
                "start_date": "2026-06-01",
                "end_date": "2026-06-01",
                "same_semester_gap_days": 3,
                "prerequisite_gap_days": 0,
                "high_failure_gap_days": 3,
            }
        ],
        courses=[
            CourseInput(course_code="ALG1", course_name="Algebra 1", semester_number=1),
            CourseInput(course_code="ALG2", course_name="Algebra 2", semester_number=2, prerequisite_course_codes=["ALG1"]),
        ],
    )

    result = solve_project(SolveRequest(project=project, max_solutions=1))

    assert result["issues"] == []
    assert len(result["solutions"]) == 1
    assert [exam["exam_date"] for exam in result["solutions"][0]["exams"]] == ["2026-06-01", "2026-06-01"]


def test_solve_project_avoids_many_adjacent_same_day_pairs() -> None:
    project = ScheduleProject(
        project_name="Adjacent same-day avoidance",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-02"),
        courses=[
            CourseInput(course_code="S1", course_name="Semester 1", semester_number=1),
            CourseInput(course_code="S3", course_name="Semester 3", semester_number=3),
            CourseInput(course_code="S2", course_name="Semester 2", semester_number=2),
            CourseInput(course_code="S4", course_name="Semester 4", semester_number=4),
        ],
    )

    result = solve_project(SolveRequest(project=project, max_solutions=1))

    assert result["issues"] == []
    exams_by_date: dict[str, list[int]] = {}
    for exam in result["solutions"][0]["exams"]:
        semester = next(course.semester_number for course in project.courses if course.course_code == exam["course_code"])
        exams_by_date.setdefault(exam["exam_date"], []).append(semester)

    assert len(exams_by_date) == 2

    adjacent_same_day_pair_count = 0
    for semesters in exams_by_date.values():
        semester_set = set(semesters)
        for semester in semester_set:
            if semester + 1 in semester_set:
                adjacent_same_day_pair_count += 1

    assert adjacent_same_day_pair_count <= 1


def test_validate_project_allows_fixed_exam_prerequisite_to_reference_fixed_exam() -> None:
    project = ScheduleProject(
        project_name="Fixed exam prerequisite target",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-10"),
        fixed_exams=[
            FixedExam(course_code="PHY1", course_name="Physics 1", exam_date="2026-06-01", locked=True),
            FixedExam(
                course_code="PHY2",
                course_name="Physics 2",
                prerequisite_course_codes=["PHY1"],
                exam_date="2026-06-08",
                locked=True,
            ),
        ],
        courses=[
            CourseInput(course_code="PHY1", course_name="Physics 1", semester_number=1),
            CourseInput(course_code="PHY2", course_name="Physics 2", semester_number=2),
        ],
    )

    issues = validate_project(project)

    assert not any(issue.code == "missing_prerequisite_target" and issue.related_course_code == "PHY2" for issue in issues)


def test_validate_project_rejects_fixed_exam_prerequisite_gap_violation() -> None:
    project = ScheduleProject(
        project_name="Fixed exam prerequisite gap",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-10"),
        fixed_exams=[
            FixedExam(course_code="PHY1", course_name="Physics 1", exam_date="2026-06-01", locked=True),
            FixedExam(
                course_code="PHY2",
                course_name="Physics 2",
                prerequisite_course_codes=["PHY1"],
                exam_date="2026-06-03",
                locked=True,
            ),
        ],
        courses=[
            CourseInput(course_code="PHY1", course_name="Physics 1", semester_number=1),
            CourseInput(course_code="PHY2", course_name="Physics 2", semester_number=2),
        ],
    )

    issues = validate_project(project)

    assert any(issue.code == "unsatisfied_constraint" and issue.related_course_code == "PHY2" for issue in issues)


def test_iter_allowed_dates_supports_multiple_moed_windows() -> None:
    project = ScheduleProject(
        project_name="Multiple moeds",
        moed_windows=[
            {"start_date": "2026-06-01", "end_date": "2026-06-02"},
            {"start_date": "2026-06-10", "end_date": "2026-06-11"},
        ],
        excluded_ranges=[
            ExcludedDateRange(start_date="2026-06-10", end_date="2026-06-10", reason="Holiday"),
        ],
    )

    assert iter_allowed_dates(project) == [date(2026, 6, 1), date(2026, 6, 2), date(2026, 6, 11)]


def test_configurable_high_failure_gap_changes_solver_feasibility() -> None:
    project = ScheduleProject(
        project_name="High failure configurable",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-03"),
        constraint_config=ConstraintConfig(
            same_semester_gap_days=3,
            adjacent_semester_gap_days=1,
            prerequisite_gap_days=3,
            high_failure_gap_days=3,
        ),
        courses=[
            CourseInput(course_code="HF1", course_name="High Failure 1", semester_number=4, high_failure_rate=True),
            CourseInput(course_code="SEM2", course_name="Semester 2", semester_number=2),
        ],
    )

    default_result = solve_project(SolveRequest(project=project, max_solutions=2))
    relaxed_project = ScheduleProject(
        project_name=project.project_name,
        moed_windows=[
            {
                "start_date": "2026-06-01",
                "end_date": "2026-06-03",
                "same_semester_gap_days": 3,
                "prerequisite_gap_days": 3,
                "high_failure_gap_days": 1,
            }
        ],
        courses=project.courses,
        constraint_config=project.constraint_config,
    )
    relaxed_result = solve_project(SolveRequest(project=relaxed_project, max_solutions=2))

    assert default_result["solutions"] == []
    assert any(issue["code"] == "no_feasible_schedule" for issue in default_result["issues"])
    assert len(relaxed_result["solutions"]) >= 1


def test_validate_solution_exams_uses_configured_high_failure_gap() -> None:
    project = ScheduleProject(
        project_name="Gap validation",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-10"),
        constraint_config=ConstraintConfig(
            same_semester_gap_days=3,
            adjacent_semester_gap_days=2,
            prerequisite_gap_days=3,
            high_failure_gap_days=3,
        ),
        courses=[
            CourseInput(course_code="HF1", course_name="High Failure 1", semester_number=4, high_failure_rate=True),
            CourseInput(course_code="SEM2", course_name="Semester 2", semester_number=2),
        ],
    )

    issues = validate_solution_exams(
        project,
        [
            ScheduledExam(course_code="HF1", exam_date="2026-06-01", source="solver"),
            ScheduledExam(course_code="SEM2", exam_date="2026-06-03", source="solver"),
        ],
    )

    assert any("two preceding semesters" in issue.message for issue in issues)


def test_validate_solution_exams_does_not_apply_high_failure_gap_outside_preceding_two_semesters() -> None:
    project = ScheduleProject(
        project_name="High failure preceding semesters only",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-10"),
        constraint_config=ConstraintConfig(
            same_semester_gap_days=3,
            adjacent_semester_gap_days=2,
            prerequisite_gap_days=3,
            high_failure_gap_days=3,
        ),
        courses=[
            CourseInput(course_code="HF1", course_name="High Failure 1", semester_number=4, high_failure_rate=True),
            CourseInput(course_code="SEM1", course_name="Semester 1", semester_number=1),
        ],
    )

    issues = validate_solution_exams(
        project,
        [
            ScheduledExam(course_code="HF1", exam_date="2026-06-01", source="solver"),
            ScheduledExam(course_code="SEM1", exam_date="2026-06-03", source="solver"),
        ],
    )

    assert not any("two preceding semesters" in issue.message for issue in issues)


def test_validate_manual_move_recalculates_score_for_preview_solution() -> None:
    project = ScheduleProject(
        project_name="Manual move scoring",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-10"),
        courses=[
            CourseInput(course_code="S1A", course_name="Semester 1 A", semester_number=1),
            CourseInput(course_code="S1B", course_name="Semester 1 B", semester_number=1),
        ],
        solutions=[
            {
                "solution_id": "solution-1",
                "score": 15,
                "exams": [
                    {"course_code": "S1A", "exam_date": "2026-06-01", "source": "solver"},
                    {"course_code": "S1B", "exam_date": "2026-06-05", "source": "solver"},
                ],
                "issues": [],
            }
        ],
    )

    response = validate_manual_move(
        ManualMoveRequest(
            project=project,
            solution_id="solution-1",
            course_code="S1B",
            new_date="2026-06-08",
        )
    )

    assert response["valid"] is True
    assert response["updated_solution"]["score"] != 15


def test_explain_manual_move_reports_invalid_preview() -> None:
    project = ScheduleProject(
        project_name="Preview invalid move",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-10"),
        courses=[
            CourseInput(course_code="S1A", course_name="Semester 1 A", semester_number=1),
            CourseInput(course_code="S1B", course_name="Semester 1 B", semester_number=1),
        ],
        solutions=[
            {
                "solution_id": "solution-1",
                "score": 12,
                "exams": [
                    {"course_code": "S1A", "exam_date": "2026-06-01", "source": "solver"},
                    {"course_code": "S1B", "exam_date": "2026-06-05", "source": "solver"},
                ],
                "issues": [],
            }
        ],
    )

    response = explain_manual_move(
        ManualMoveRequest(
            project=project,
            solution_id="solution-1",
            course_code="S1B",
            new_date="2026-06-02",
        )
    )

    assert response["valid"] is False
    assert any(issue["code"] == "unsatisfied_constraint" for issue in response["issues"])