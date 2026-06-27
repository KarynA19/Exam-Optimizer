from __future__ import annotations

from pydantic import BaseModel
from fastapi import APIRouter, Depends

from app.models.schedule import CourseInput, FixedExam, ScheduleProject, ScheduleSolution
from app.services.auth import require_authenticated_user
from app.services.saved_setup_store import (
    delete_setup,
    get_setup,
    get_setup_courses,
    get_setup_fixed_exams,
    list_setups,
    save_setup,
    update_solutions,
)

router = APIRouter(tags=["saved-setups"])


class SavedSetupMetadata(BaseModel):
    setup_id: str
    project_name: str
    year: int
    saved_at: str | None = None
    updated_at: str | None = None
    saved_solution_id: str | None = None


class SavedSetupPayload(BaseModel):
    metadata: SavedSetupMetadata
    project: ScheduleProject


class SaveSetupRequest(BaseModel):
    project: ScheduleProject
    setup_id: str | None = None
    saved_solution_id: str | None = None


class UpdateSolutionsRequest(BaseModel):
    solutions: list[ScheduleSolution]
    saved_solution_id: str | None = None


@router.get("/saved-setups", response_model=list[SavedSetupMetadata])
def get_saved_setups(owner_id: str = Depends(require_authenticated_user)) -> list[SavedSetupMetadata]:
    return [SavedSetupMetadata.model_validate(item) for item in list_setups(owner_id)]


@router.post("/saved-setups", response_model=SavedSetupMetadata)
def save_saved_setup(
    request: SaveSetupRequest,
    owner_id: str = Depends(require_authenticated_user),
) -> SavedSetupMetadata:
    saved = save_setup(owner_id, request.project, request.setup_id, request.saved_solution_id)
    return SavedSetupMetadata.model_validate(saved)


@router.get("/saved-setups/{setup_id}", response_model=SavedSetupPayload)
def load_saved_setup(setup_id: str, owner_id: str = Depends(require_authenticated_user)) -> SavedSetupPayload:
    saved_payload = get_setup(owner_id, setup_id)
    return SavedSetupPayload(
        metadata=SavedSetupMetadata.model_validate(saved_payload["metadata"]),
        project=saved_payload["project"],
    )


@router.delete("/saved-setups/{setup_id}")
def remove_saved_setup(setup_id: str, owner_id: str = Depends(require_authenticated_user)) -> dict[str, str]:
    delete_setup(owner_id, setup_id)
    return {"status": "deleted"}


@router.put("/saved-setups/{setup_id}/solutions", response_model=SavedSetupMetadata)
def update_saved_setup_solutions(
    setup_id: str,
    request: UpdateSolutionsRequest,
    owner_id: str = Depends(require_authenticated_user),
) -> SavedSetupMetadata:
    updated = update_solutions(owner_id, setup_id, request.solutions, request.saved_solution_id)
    return SavedSetupMetadata.model_validate(updated)


@router.get("/saved-setups/{setup_id}/courses", response_model=list[CourseInput])
def import_courses_from_saved_setup(setup_id: str, owner_id: str = Depends(require_authenticated_user)) -> list[CourseInput]:
    return get_setup_courses(owner_id, setup_id)


@router.get("/saved-setups/{setup_id}/fixed-exams", response_model=list[FixedExam])
def import_fixed_exams_from_saved_setup(setup_id: str, owner_id: str = Depends(require_authenticated_user)) -> list[FixedExam]:
    return get_setup_fixed_exams(owner_id, setup_id)
