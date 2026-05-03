from fastapi import APIRouter, File, HTTPException, UploadFile

from app.models.schedule import CourseImportResponse, ManualMoveRequest, ScheduleProject, SolveRequest, ValidationIssue
from app.services.course_import import CourseImportError, import_courses_from_excel
from app.services.solver import solve_project
from app.services.validation import explain_manual_move, validate_manual_move, validate_project

router = APIRouter(tags=["projects"])


@router.post("/projects/validate", response_model=ScheduleProject)
def validate_schedule_project(project: ScheduleProject) -> ScheduleProject:
    issues = validate_project(project)
    return project.model_copy(update={"issues": issues})


@router.post("/projects/solve")
def solve_schedule_project(request: SolveRequest) -> dict:
    issues = validate_project(request.project)
    blocking_issues = [issue for issue in issues if issue.severity == "error"]
    if blocking_issues:
        raise HTTPException(status_code=422, detail=[issue.model_dump() for issue in blocking_issues])
    return solve_project(request)


@router.post("/projects/manual-move")
def validate_schedule_move(request: ManualMoveRequest) -> dict:
    return validate_manual_move(request)


@router.post("/projects/explain-move")
def explain_schedule_move(request: ManualMoveRequest) -> dict:
    return explain_manual_move(request)


@router.post("/projects/import-courses", response_model=CourseImportResponse)
async def import_project_courses(file: UploadFile = File(...)) -> CourseImportResponse:
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        issue = ValidationIssue(
            code="invalid_import_file",
            severity="error",
            message="Please upload a .xlsx file that matches the course import template.",
        )
        raise HTTPException(status_code=422, detail=[issue.model_dump(mode="json")])

    content = await file.read()

    try:
        return import_courses_from_excel(content)
    except CourseImportError as error:
        raise HTTPException(status_code=422, detail=[issue.model_dump(mode="json") for issue in error.issues]) from error
