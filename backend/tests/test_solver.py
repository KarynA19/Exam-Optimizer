from datetime import date

from fastapi import HTTPException

from app.api.routes.projects import solve_schedule_project
from app.models.schedule import ConstraintConfig, CourseInput, DateRange, ExcludedDateRange, FixedExam, ScheduleProject, ScheduledExam, SolveRequest
from app.services.solver import solve_project
from app.models.schedule import ManualMoveRequest
from app.services.validation import (
    explain_manual_move,
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
    assert abs((date.fromisoformat(exams_by_code["SEM5"]) - date.fromisoformat(exams_by_code["SEM6"])).days) >= 2


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

    assert any("back-to-back semesters need at least a 2-day gap" in issue.message for issue in issues)


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


def test_configurable_high_failure_gap_changes_solver_feasibility() -> None:
    project = ScheduleProject(
        project_name="High failure configurable",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-03"),
        courses=[
            CourseInput(course_code="HF1", course_name="High Failure 1", semester_number=1, high_failure_rate=True),
            CourseInput(course_code="SEM2", course_name="Semester 2", semester_number=2),
        ],
    )

    default_result = solve_project(SolveRequest(project=project, max_solutions=2))
    relaxed_project = project.model_copy(
        update={
            "constraint_config": ConstraintConfig(
                same_semester_gap_days=3,
                adjacent_semester_gap_days=2,
                prerequisite_gap_days=3,
                high_failure_gap_days=2,
            )
        }
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
            CourseInput(course_code="HF1", course_name="High Failure 1", semester_number=1, high_failure_rate=True),
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

    assert any("at least 3 days away" in issue.message for issue in issues)


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
    assert response["updated_solution"]["score"] > 15


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