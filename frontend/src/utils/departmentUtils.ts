import type { CourseInput } from "../types";

export type DepartmentVisualKey = "all" | "sw" | "is";

export function getDepartmentVisualKey(course: Pick<CourseInput, "department"> | null | undefined): DepartmentVisualKey {
  if (course?.department === "SW") {
    return "sw";
  }
  if (course?.department === "IS") {
    return "is";
  }
  return "all";
}

export function getDepartmentLabel(course: Pick<CourseInput, "department"> | null | undefined): string {
  if (course?.department === "SW") {
    return "SW Department";
  }
  if (course?.department === "IS") {
    return "IS Department";
  }
  return "All Departments";
}

export function getDepartmentShortLabel(course: Pick<CourseInput, "department"> | null | undefined): string {
  if (course?.department === "SW") {
    return "SW";
  }
  if (course?.department === "IS") {
    return "IS";
  }
  return "ALL";
}

export function getDepartmentClassName(course: Pick<CourseInput, "department"> | null | undefined): string {
  return `department-${getDepartmentVisualKey(course)}`;
}