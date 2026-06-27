from __future__ import annotations

import os
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from pymongo import MongoClient

from app.models.schedule import CourseInput, FixedExam, ScheduleProject, ScheduleSolution

_MONGO_CLIENT: MongoClient | None = None


def _collection():
    global _MONGO_CLIENT

    if _MONGO_CLIENT is None:
        mongo_uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
        _MONGO_CLIENT = MongoClient(mongo_uri, serverSelectionTimeoutMS=5000)

    database_name = os.getenv("MONGODB_DATABASE", "exam_optimizer")
    collection = _MONGO_CLIENT[database_name]["saved_setups"]
    collection.create_index([("setup_id", 1), ("owner_id", 1)], unique=True)
    collection.create_index([("owner_id", 1), ("updated_at", -1)])
    return collection


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _metadata_from_doc(doc: dict) -> dict:
    return {
        "setup_id": doc["setup_id"],
        "project_name": doc.get("project_name", "Saved Setup"),
        "year": doc.get("year", datetime.now(timezone.utc).year),
        "saved_at": doc.get("saved_at"),
        "updated_at": doc.get("updated_at"),
        "saved_solution_id": doc.get("saved_solution_id"),
    }


def save_setup(owner_id: str, project: ScheduleProject, setup_id: str | None, saved_solution_id: str | None) -> dict:
    collection = _collection()
    current_time = _now_iso()
    target_setup_id = setup_id or uuid4().hex
    project_data = project.model_dump(mode="json")

    moed_windows = project_data.get("moed_windows", [])
    inferred_year = datetime.now(timezone.utc).year
    if moed_windows:
        first_start = str(moed_windows[0].get("start_date", ""))
        if len(first_start) >= 4 and first_start[:4].isdigit():
            inferred_year = int(first_start[:4])

    collection.update_one(
        {"setup_id": target_setup_id, "owner_id": owner_id},
        {
            "$set": {
                "owner_id": owner_id,
                "setup_id": target_setup_id,
                "project_name": project.project_name,
                "year": inferred_year,
                "saved_solution_id": saved_solution_id,
                "updated_at": current_time,
                "project": project_data,
            },
            "$setOnInsert": {
                "saved_at": current_time,
            },
        },
        upsert=True,
    )

    saved_doc = collection.find_one({"setup_id": target_setup_id, "owner_id": owner_id})
    if saved_doc is None:
        raise HTTPException(status_code=500, detail="Failed to save setup.")

    return _metadata_from_doc(saved_doc)


def list_setups(owner_id: str) -> list[dict]:
    collection = _collection()
    cursor = collection.find({"owner_id": owner_id}).sort("updated_at", -1)
    return [_metadata_from_doc(doc) for doc in cursor]


def get_setup(owner_id: str, setup_id: str) -> dict:
    collection = _collection()
    saved_doc = collection.find_one({"setup_id": setup_id, "owner_id": owner_id})
    if saved_doc is None:
        raise HTTPException(status_code=404, detail="Saved setup not found.")

    project = ScheduleProject.model_validate(saved_doc["project"])
    return {
        "metadata": _metadata_from_doc(saved_doc),
        "project": project,
    }


def delete_setup(owner_id: str, setup_id: str) -> None:
    collection = _collection()
    result = collection.delete_one({"setup_id": setup_id, "owner_id": owner_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Saved setup not found.")


def update_solutions(owner_id: str, setup_id: str, solutions: list[ScheduleSolution], saved_solution_id: str | None) -> dict:
    collection = _collection()
    result = collection.update_one(
        {"setup_id": setup_id, "owner_id": owner_id},
        {
            "$set": {
                "project.solutions": [solution.model_dump(mode="json") for solution in solutions],
                "saved_solution_id": saved_solution_id,
                "updated_at": _now_iso(),
            }
        },
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Saved setup not found.")

    saved_doc = collection.find_one({"setup_id": setup_id, "owner_id": owner_id})
    if saved_doc is None:
        raise HTTPException(status_code=404, detail="Saved setup not found.")

    return _metadata_from_doc(saved_doc)


def get_setup_courses(owner_id: str, setup_id: str) -> list[CourseInput]:
    setup_payload = get_setup(owner_id, setup_id)
    project: ScheduleProject = setup_payload["project"]
    return project.courses


def get_setup_fixed_exams(owner_id: str, setup_id: str) -> list[FixedExam]:
    setup_payload = get_setup(owner_id, setup_id)
    project: ScheduleProject = setup_payload["project"]
    return project.fixed_exams
