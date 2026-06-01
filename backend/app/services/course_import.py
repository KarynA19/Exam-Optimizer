from __future__ import annotations

from datetime import date
from io import BytesIO

from openpyxl import Workbook, load_workbook
from pydantic import ValidationError

from app.models.schedule import CourseImportResponse, CourseInput, DateRange, ScheduleProject, ValidationIssue
from app.services.validation import validate_project

EXPECTED_HEADERS = [
    "course id",
    "course name",
    "semester",
    "is high failure",
    "prerequisites",
    "department",
]

DISPLAY_HEADERS = [
    "Course ID",
    "Course Name",
    "Semester",
    "Is High Failure",
    "Prerequisites",
    "Department",
]

TRUTHY_VALUES = {"1", "true", "yes", "y"}
FALSY_VALUES = {"0", "false", "no", "n", ""}


class CourseImportError(Exception):
    def __init__(self, issues: list[ValidationIssue]):
        super().__init__(issues[0].message if issues else "Course import failed.")
        self.issues = issues


def _normalize_header(value: object) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _cell_text(value: object) -> str:
    return str(value or "").strip()


def _build_issue(message: str, row_number: int | None = None, course_code: str | None = None) -> ValidationIssue:
    row_prefix = f"Row {row_number}: " if row_number is not None else ""
    return ValidationIssue(
        code="invalid_import_file",
        severity="error",
        message=f"{row_prefix}{message}",
        related_course_code=course_code or None,
    )


def _build_header_issue(actual_headers: list[str], actual_header_labels: list[str]) -> ValidationIssue:
    mismatches: list[str] = []
    for index, (expected, actual) in enumerate(zip(EXPECTED_HEADERS, actual_headers, strict=False), start=1):
        if expected == actual:
            continue
        column_name = chr(64 + index)
        actual_label = actual_header_labels[index - 1] or "blank"
        mismatches.append(f"Column {column_name} should be '{DISPLAY_HEADERS[index - 1]}' but is '{actual_label}'")

    if not mismatches:
        mismatches.append("the first row does not match the expected template")

    expected_order = ", ".join(f"{chr(65 + index)}: {header}" for index, header in enumerate(DISPLAY_HEADERS))
    return _build_issue(f"Template headers must match exactly. Expected {expected_order}. Mismatch: {'; '.join(mismatches)}.")


def _build_duplicate_course_issues(row_numbers_by_code: dict[str, list[int]]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for course_code, row_numbers in row_numbers_by_code.items():
        if len(row_numbers) < 2:
            continue
        joined_rows = ", ".join(str(row_number) for row_number in row_numbers)
        for row_number in row_numbers:
            issues.append(
                ValidationIssue(
                    code="duplicate_course_code",
                    severity="error",
                    message=f"Row {row_number}: Course ID '{course_code}' appears more than once in the file (rows {joined_rows}).",
                    related_course_code=course_code,
                )
            )
    return issues


def _build_missing_prerequisite_issues(courses: list[CourseInput], row_numbers_by_code: dict[str, list[int]]) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    available_codes = set(row_numbers_by_code)
    for course in courses:
        missing_codes = [
            prerequisite_code for prerequisite_code in course.prerequisite_course_codes if prerequisite_code not in available_codes
        ]
        if not missing_codes:
            continue

        row_number = row_numbers_by_code.get(course.course_code, [None])[0]
        issues.append(
            ValidationIssue(
                code="missing_prerequisite_target",
                severity="error",
                message=(
                    f"Row {row_number}: Prerequisites references {', '.join(repr(code) for code in missing_codes)}, "
                    "but those Course ID values do not exist in this file."
                )
                if row_number is not None
                else (
                    f"Prerequisites references {', '.join(repr(code) for code in missing_codes)}, "
                    "but those Course ID values do not exist in this file."
                ),
                related_course_code=course.course_code,
            )
        )
    return issues


def _contextualize_validation_issues(
    issues: list[ValidationIssue],
    row_numbers_by_code: dict[str, list[int]],
) -> list[ValidationIssue]:
    contextualized: list[ValidationIssue] = []
    for issue in issues:
        row_number = row_numbers_by_code.get(issue.related_course_code or "", [None])[0]
        if row_number is None:
            contextualized.append(issue)
            continue
        contextualized.append(
            issue.model_copy(
                update={
                    "message": f"Row {row_number}: {issue.message}",
                }
            )
        )
    return contextualized


def _parse_semester(value: object) -> int:
    if isinstance(value, bool):
        raise ValueError("Semester must be a number between 1 and 12.")
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)

    text = _cell_text(value)
    if not text:
        raise ValueError("Semester is required.")

    try:
        return int(text)
    except ValueError as error:
        raise ValueError("Semester must be a number between 1 and 12.") from error


def _parse_high_failure(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in {0, 1}:
        return bool(value)
    if isinstance(value, float) and value in {0.0, 1.0}:
        return bool(int(value))

    normalized = _cell_text(value).lower()
    if normalized in TRUTHY_VALUES:
        return True
    if normalized in FALSY_VALUES:
        return False

    raise ValueError("Is High Failure must be one of yes/no, true/false, or 1/0.")


def _parse_department(value: object) -> str | None:
    text = _cell_text(value).upper()
    if not text:
        return None
    if text in {"SW", "IS"}:
        return text
    raise ValueError("Department must be empty, SW, or IS.")


def export_course_template_excel() -> bytes:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "Courses"
    worksheet.append(DISPLAY_HEADERS)

    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def import_courses_from_excel(content: bytes) -> CourseImportResponse:
    try:
        workbook = load_workbook(filename=BytesIO(content), data_only=True)
    except Exception as error:  # pragma: no cover - exact openpyxl error type is not stable
        raise CourseImportError([_build_issue("Uploaded file is not a valid .xlsx workbook.")]) from error

    worksheet = workbook.worksheets[0]
    actual_header_labels = [_cell_text(worksheet.cell(row=1, column=column).value) for column in range(1, 7)]
    actual_headers = [_normalize_header(header) for header in actual_header_labels]

    if actual_headers != EXPECTED_HEADERS:
        raise CourseImportError([_build_header_issue(actual_headers, actual_header_labels)])

    issues: list[ValidationIssue] = []
    courses: list[CourseInput] = []
    row_numbers_by_code: dict[str, list[int]] = {}

    for row_number in range(2, worksheet.max_row + 1):
        raw_values = [worksheet.cell(row=row_number, column=column).value for column in range(1, 7)]
        if all(_cell_text(value) == "" for value in raw_values):
            continue

        course_code = _cell_text(raw_values[0])
        course_name = _cell_text(raw_values[1])
        prerequisite_codes = _cell_text(raw_values[4])

        try:
            semester_number = _parse_semester(raw_values[2])
            high_failure_rate = _parse_high_failure(raw_values[3])
            department = _parse_department(raw_values[5])
            courses.append(
                CourseInput(
                    course_code=course_code,
                    course_name=course_name,
                    semester_number=semester_number,
                    high_failure_rate=high_failure_rate,
                    department=department,
                    prerequisite_course_codes=prerequisite_codes,
                )
            )
            row_numbers_by_code.setdefault(course_code, []).append(row_number)
        except ValueError as error:
            issues.append(_build_issue(str(error), row_number=row_number, course_code=course_code or None))
        except ValidationError as error:
            for validation_error in error.errors():
                issues.append(_build_issue(validation_error["msg"], row_number=row_number, course_code=course_code or None))

    if not courses and not issues:
        issues.append(_build_issue("The workbook does not contain any course rows."))

    issues.extend(_build_duplicate_course_issues(row_numbers_by_code))
    issues.extend(_build_missing_prerequisite_issues(courses, row_numbers_by_code))

    if issues:
        raise CourseImportError(issues)

    validation_project = ScheduleProject(
        project_name="Imported Courses",
        moed_windows=[DateRange(start_date=date(2026, 1, 1), end_date=date(2026, 1, 1))],
        courses=courses,
    )
    validation_issues = validate_project(validation_project)

    if validation_issues:
        raise CourseImportError(_contextualize_validation_issues(validation_issues, row_numbers_by_code))

    return CourseImportResponse(imported_count=len(courses), courses=courses)