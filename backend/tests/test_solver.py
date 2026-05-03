from app.models.schedule import ConstraintConfig, CourseInput, DateRange, ExcludedDateRange, FixedExam, ScheduleProject, ScheduledExam, SolveRequest
from app.services.solver import solve_project
from app.models.schedule import ManualMoveRequest
from app.services.validation import explain_manual_move, validate_manual_move, validate_project, validate_solution_exams


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
                prerequisite_course_code="ALG1",
            ),
        ],
    )

    result = solve_project(SolveRequest(project=project, max_solutions=3))

    assert result["issues"] == []
    assert len(result["solutions"]) >= 1
    assert {exam["course_code"] for exam in result["solutions"][0]["exams"]} == {"ALG1", "CALC1", "ALG2"}


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


def test_validate_project_rejects_fixed_exam_on_excluded_date() -> None:
    project = ScheduleProject(
        project_name="Invalid fixed exam",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-10"),
        excluded_ranges=[
            ExcludedDateRange(start_date="2026-06-04", end_date="2026-06-04", reason="Holiday"),
        ],
        fixed_exams=[
            FixedExam(course_code="PHY1", exam_date="2026-06-04", locked=True, reason="Faculty locked"),
        ],
        courses=[
            CourseInput(course_code="PHY1", course_name="Physics 1", semester_number=1),
        ],
    )

    issues = validate_project(project)

    assert any(issue.code == "unsatisfied_constraint" for issue in issues)
    assert any(issue.related_course_code == "PHY1" for issue in issues)


def test_solve_project_prefers_not_to_place_adjacent_semesters_on_same_day() -> None:
    project = ScheduleProject(
        project_name="Adjacent semester preference",
        moed_a_window=DateRange(start_date="2026-06-01", end_date="2026-06-10"),
        courses=[
            CourseInput(course_code="SEM5", course_name="Semester 5 Course", semester_number=5),
            CourseInput(course_code="SEM6", course_name="Semester 6 Course", semester_number=6),
        ],
    )

    result = solve_project(SolveRequest(project=project, max_solutions=1))

    assert result["issues"] == []
    exams_by_code = {exam["course_code"]: exam["exam_date"] for exam in result["solutions"][0]["exams"]}
    assert exams_by_code["SEM5"] != exams_by_code["SEM6"]


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