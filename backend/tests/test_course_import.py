from io import BytesIO

from openpyxl import Workbook

from app.services.course_import import CourseImportError, import_courses_from_excel


def build_workbook_bytes(rows: list[list[object]], headers: list[str] | None = None) -> bytes:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.append(headers or ["Course ID", "Course Name", "Semester", "Is High Failure", "Prerequisites"])
    for row in rows:
        worksheet.append(row)

    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def test_import_courses_from_excel_parses_valid_template() -> None:
    content = build_workbook_bytes(
        [
            ["ALG1", "Algebra 1", 1, "yes", ""],
            ["ALG2", "Algebra 2", 2, "no", "ALG1"],
        ]
    )

    result = import_courses_from_excel(content)

    assert result.imported_count == 2
    assert result.courses[0].course_code == "ALG1"
    assert result.courses[0].high_failure_rate is True
    assert result.courses[1].prerequisite_course_code == "ALG1"


def test_import_courses_from_excel_rejects_invalid_headers() -> None:
    content = build_workbook_bytes([["ALG1", "Algebra 1", 1, "yes", ""]], headers=["Wrong", "Course Name", "Semester", "Is High Failure", "Prerequisites"])

    try:
        import_courses_from_excel(content)
    except CourseImportError as error:
        assert any("Template headers must be" in issue.message for issue in error.issues)
    else:
        raise AssertionError("Expected CourseImportError for invalid headers.")


def test_import_courses_from_excel_rejects_invalid_high_failure_value() -> None:
    content = build_workbook_bytes([["ALG1", "Algebra 1", 1, "maybe", ""]])

    try:
        import_courses_from_excel(content)
    except CourseImportError as error:
        assert any("Row 2: Is High Failure must be one of yes/no, true/false, or 1/0." == issue.message for issue in error.issues)
    else:
        raise AssertionError("Expected CourseImportError for invalid high-failure value.")


def test_import_courses_from_excel_rejects_missing_prerequisite_target() -> None:
    content = build_workbook_bytes([["ALG2", "Algebra 2", 2, "no", "ALG1"]])

    try:
        import_courses_from_excel(content)
    except CourseImportError as error:
        assert any(issue.code == "missing_prerequisite_target" for issue in error.issues)
    else:
        raise AssertionError("Expected CourseImportError for missing prerequisite target.")


def test_import_courses_from_excel_rejects_duplicate_course_codes() -> None:
    content = build_workbook_bytes(
        [
            ["ALG1", "Algebra 1", 1, "yes", ""],
            ["ALG1", "Linear Algebra", 1, "no", ""],
        ]
    )

    try:
        import_courses_from_excel(content)
    except CourseImportError as error:
        assert any(issue.code == "duplicate_course_code" for issue in error.issues)
    else:
        raise AssertionError("Expected CourseImportError for duplicate course codes.")


def test_import_courses_from_excel_rejects_empty_workbook() -> None:
    content = build_workbook_bytes([])

    try:
        import_courses_from_excel(content)
    except CourseImportError as error:
        assert any("does not contain any course rows" in issue.message for issue in error.issues)
    else:
        raise AssertionError("Expected CourseImportError for empty workbook.")