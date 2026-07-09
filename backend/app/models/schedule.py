from __future__ import annotations

from datetime import date, timedelta
from typing import Literal

from pydantic import AliasChoices, BaseModel, Field, field_validator, model_validator

IssueSeverity = Literal["error", "warning"]
DepartmentCode = Literal["SW", "IS"]
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


class MoedWindow(DateRange):
    moed_number: int = Field(default=1, ge=1, le=3)
    same_semester_gap_days: int = Field(default=3, ge=0, le=30)
    prerequisite_gap_days: int = Field(default=3, ge=0, le=30)
    high_failure_gap_days: int = Field(default=3, ge=0, le=30)


def normalize_prerequisite_course_codes(value: object) -> list[str]:
    if value is None or value == "":
        return []

    if isinstance(value, str):
        raw_values = value.replace(";", ",").split(",")
    elif isinstance(value, list):
        raw_values = value
    else:
        raw_values = [value]

    normalized: list[str] = []
    for raw_value in raw_values:
        text = str(raw_value).strip()
        if not text:
            continue
        if len(text) > 30:
            raise ValueError("Each prerequisite course code must be at most 30 characters.")
        if text not in normalized:
            normalized.append(text)

    return normalized


class FixedExam(BaseModel):
    course_code: str = Field(min_length=1, max_length=30)
    course_name: str = Field(min_length=1, max_length=160)
    semester_number: int | None = Field(default=None, ge=1, le=8)
    prerequisite_course_codes: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("prerequisite_course_codes", "prerequisite_course_code"),
    )
    exam_date: date
    locked: bool = True
    reason: str | None = Field(default=None, max_length=200)
    department: DepartmentCode | None = None

    @field_validator("department", mode="before")
    @classmethod
    def normalize_department(cls, value: object) -> DepartmentCode | None:
        if value is None:
            return None

        text = str(value).strip().upper()
        if not text:
            return None
        if text in {"SW", "IS"}:
            return text
        raise ValueError("Department must be empty, SW, or IS.")

    @field_validator("prerequisite_course_codes", mode="before")
    @classmethod
    def normalize_prerequisite_course_codes_field(cls, value: object) -> list[str]:
        return normalize_prerequisite_course_codes(value)


class CourseInput(BaseModel):
    course_code: str = Field(min_length=1, max_length=30)
    course_name: str = Field(min_length=1, max_length=160)
    semester_number: int = Field(ge=1, le=12)
    high_failure_rate: bool = False
    department: DepartmentCode | None = None
    prerequisite_course_codes: list[str] = Field(
        default_factory=list,
        validation_alias=AliasChoices("prerequisite_course_codes", "prerequisite_course_code"),
    )

    @field_validator("department", mode="before")
    @classmethod
    def normalize_department(cls, value: object) -> DepartmentCode | None:
        if value is None:
            return None

        text = str(value).strip().upper()
        if not text:
            return None
        if text in {"SW", "IS"}:
            return text
        raise ValueError("Department must be empty, SW, or IS.")

    @field_validator("prerequisite_course_codes", mode="before")
    @classmethod
    def normalize_prerequisite_course_codes(cls, value: object) -> list[str]:
        return normalize_prerequisite_course_codes(value)


class ScheduledExam(BaseModel):
    course_code: str
    moed_number: int = Field(default=1, ge=1, le=3)
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
    adjacent_semester_gap_days: int = Field(default=2, ge=1, le=30)
    prerequisite_gap_days: int = Field(default=3, ge=0, le=30)
    high_failure_gap_days: int = Field(default=3, ge=1, le=30)
    global_spacing_weight: int = Field(default=4, ge=0, le=50)


class SolutionDiagnostics(BaseModel):
    target_gap_days: int = Field(default=1, ge=1)
    spacing_deviation: int = Field(default=0, ge=0)
    spacing_score: int = 0


class ScheduleSolution(BaseModel):
    solution_id: str
    score: int = 0
    exams: list[ScheduledExam] = Field(default_factory=list)
    issues: list[ValidationIssue] = Field(default_factory=list)
    diagnostics: SolutionDiagnostics = Field(default_factory=SolutionDiagnostics)


class ScheduleProject(BaseModel):
    project_name: str = Field(min_length=1, max_length=120)
    moed_windows: list[MoedWindow] = Field(
        default_factory=lambda: [MoedWindow(start_date=date(2026, 6, 15), end_date=date(2026, 7, 15), moed_number=1)],
        min_length=1,
        max_length=3,
        validation_alias=AliasChoices("moed_windows", "moed_a_window"),
    )
    constraint_config: ConstraintConfig = Field(default_factory=ConstraintConfig)
    excluded_ranges: list[ExcludedDateRange] = Field(default_factory=list)
    fixed_exams: list[FixedExam] = Field(default_factory=list)
    courses: list[CourseInput] = Field(default_factory=list)
    solutions: list[ScheduleSolution] = Field(default_factory=list)
    issues: list[ValidationIssue] = Field(default_factory=list)

    @field_validator("moed_windows", mode="before")
    @classmethod
    def normalize_moed_windows(cls, value: object) -> list[object]:
        if value is None:
            return value

        if isinstance(value, dict):
            return [
                {
                    **value,
                    "moed_number": 1,
                    "same_semester_gap_days": value.get("same_semester_gap_days", 3),
                    "prerequisite_gap_days": value.get("prerequisite_gap_days", 3),
                    "high_failure_gap_days": value.get("high_failure_gap_days", 3),
                }
            ]

        normalized_value = list(value) if isinstance(value, list) else [value]
        normalized_windows: list[object] = []
        for index, raw_window in enumerate(normalized_value, start=1):
            if isinstance(raw_window, MoedWindow):
                normalized_windows.append(raw_window.model_copy(update={"moed_number": index}))
            elif isinstance(raw_window, DateRange):
                normalized_windows.append(
                    {
                        "start_date": raw_window.start_date,
                        "end_date": raw_window.end_date,
                        "moed_number": index,
                        "same_semester_gap_days": 3,
                        "prerequisite_gap_days": 3,
                        "high_failure_gap_days": 3,
                    }
                )
            elif isinstance(raw_window, dict):
                normalized_windows.append(
                    {
                        **raw_window,
                        "moed_number": index,
                        "same_semester_gap_days": raw_window.get("same_semester_gap_days", 3),
                        "prerequisite_gap_days": raw_window.get("prerequisite_gap_days", 3),
                        "high_failure_gap_days": raw_window.get("high_failure_gap_days", 3),
                    }
                )
            else:
                normalized_windows.append(raw_window)

        return normalized_windows

    @model_validator(mode="after")
    def validate_moed_windows(self) -> "ScheduleProject":
        sorted_windows = sorted(self.moed_windows, key=lambda window: (window.start_date, window.end_date))
        normalized_windows: list[MoedWindow] = []

        for index, window in enumerate(sorted_windows, start=1):
            normalized_windows.append(window.model_copy(update={"moed_number": index}))

        for index, window in enumerate(normalized_windows[:-1]):
            next_window = normalized_windows[index + 1]
            required_next_start = window.end_date + timedelta(days=1)
            if next_window.start_date < required_next_start:
                raise ValueError("Moed windows cannot overlap.")

        self.moed_windows = normalized_windows
        return self


class SolveRequest(BaseModel):
    project: ScheduleProject
    max_solutions: int = Field(default=5, ge=1, le=20)
    base_solution_time_seconds: int = Field(default=30, ge=5, le=180)
    variant_solution_time_seconds: int = Field(default=5, ge=1, le=60)
    diversity_mode: Literal["balanced", "high_diversity"] = "high_diversity"
    variant_min_changed_exams: int | None = Field(default=None, ge=1, le=20)


class ManualMoveRequest(BaseModel):
    project: ScheduleProject
    solution_id: str
    course_code: str
    moed_number: int = Field(default=1, ge=1, le=3)
    new_date: date


class CourseImportResponse(BaseModel):
    imported_count: int = Field(ge=0)
    courses: list[CourseInput] = Field(default_factory=list)
    fixed_exams_imported_count: int = Field(default=0, ge=0)
    fixed_exams: list[FixedExam] = Field(default_factory=list)
