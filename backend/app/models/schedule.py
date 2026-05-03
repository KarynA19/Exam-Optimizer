from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field, model_validator

IssueSeverity = Literal["error", "warning"]
IssueCode = Literal[
    "invalid_window",
    "excluded_outside_window",
    "fixed_exam_outside_window",
    "duplicate_course_code",
    "invalid_import_file",
    "missing_prerequisite_target",
    "manual_move_conflict",
    "no_feasible_schedule",
    "unsatisfied_constraint",
]


class DateRange(BaseModel):
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def validate_range(self) -> "DateRange":
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        return self


class ExcludedDateRange(DateRange):
    reason: str = Field(min_length=1, max_length=120)


class FixedExam(BaseModel):
    course_code: str = Field(min_length=1, max_length=30)
    exam_date: date
    locked: bool = True
    reason: str | None = Field(default=None, max_length=200)


class CourseInput(BaseModel):
    course_code: str = Field(min_length=1, max_length=30)
    course_name: str = Field(min_length=1, max_length=160)
    semester_number: int = Field(ge=1, le=12)
    high_failure_rate: bool = False
    prerequisite_course_code: str | None = Field(default=None, max_length=30)


class ScheduledExam(BaseModel):
    course_code: str
    exam_date: date
    source: Literal["solver", "fixed", "manual"] = "solver"


class ValidationIssue(BaseModel):
    code: IssueCode
    severity: IssueSeverity
    message: str
    related_course_code: str | None = None
    related_date: date | None = None


class ConstraintConfig(BaseModel):
    same_semester_gap_days: int = Field(default=3, ge=1, le=30)
    prerequisite_gap_days: int = Field(default=3, ge=1, le=30)
    high_failure_gap_days: int = Field(default=3, ge=1, le=30)


class ScheduleSolution(BaseModel):
    solution_id: str
    score: int = 0
    exams: list[ScheduledExam] = Field(default_factory=list)
    issues: list[ValidationIssue] = Field(default_factory=list)


class ScheduleProject(BaseModel):
    project_name: str = Field(min_length=1, max_length=120)
    moed_a_window: DateRange
    constraint_config: ConstraintConfig = Field(default_factory=ConstraintConfig)
    excluded_ranges: list[ExcludedDateRange] = Field(default_factory=list)
    fixed_exams: list[FixedExam] = Field(default_factory=list)
    courses: list[CourseInput] = Field(default_factory=list)
    solutions: list[ScheduleSolution] = Field(default_factory=list)
    issues: list[ValidationIssue] = Field(default_factory=list)


class SolveRequest(BaseModel):
    project: ScheduleProject
    max_solutions: int = Field(default=5, ge=1, le=20)


class ManualMoveRequest(BaseModel):
    project: ScheduleProject
    solution_id: str
    course_code: str
    new_date: date


class CourseImportResponse(BaseModel):
    imported_count: int = Field(ge=0)
    courses: list[CourseInput] = Field(default_factory=list)
