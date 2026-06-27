import { useState } from "react";

import type { FixedExam } from "../../types";

type DepartmentOption = "ALL" | "SW" | "IS";

function parsePrerequisiteCourseCodes(value: string): string[] {
  return value
    .replace(/;/g, ",")
    .split(",")
    .map((entry: string) => entry.trim())
    .filter((entry: string) => entry.length > 0);
}

export function FixedExamForm({
  initialValue,
  onSubmit,
  onCancel,
}: {
  initialValue?: FixedExam;
  onSubmit: (exam: FixedExam) => void;
  onCancel?: () => void;
}) {
  const [courseCode, setCourseCode] = useState(initialValue?.course_code ?? "");
  const [courseName, setCourseName] = useState(initialValue?.course_name ?? "");
  const [prerequisiteCourseCodes, setPrerequisiteCourseCodes] = useState(
    initialValue?.prerequisite_course_codes.join(", ") ?? "",
  );
  const [examDate, setExamDate] = useState(initialValue?.exam_date ?? "");
  const [department, setDepartment] = useState<DepartmentOption>(initialValue?.department ?? "ALL");

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          course_code: courseCode,
          course_name: courseName,
          prerequisite_course_codes: parsePrerequisiteCourseCodes(prerequisiteCourseCodes),
          exam_date: examDate,
          locked: true,
          department: department === "ALL" ? null : department,
        });
        setCourseCode("");
        setCourseName("");
        setPrerequisiteCourseCodes("");
        setExamDate("");
        setDepartment("ALL");
      }}
    >
      <div className="field-row field-row-triple">
        <label>
          <span>Course code</span>
          <input value={courseCode} onChange={(event) => setCourseCode(event.target.value)} required />
        </label>
        <label>
          <span>Course name</span>
          <input value={courseName} onChange={(event) => setCourseName(event.target.value)} required />
        </label>
        <label>
          <span>Exam date</span>
          <input type="date" value={examDate} onChange={(event) => setExamDate(event.target.value)} required />
        </label>
      </div>
      <div className="field-row">
        <label>
          <span>Prerequisite course codes</span>
          <input
            value={prerequisiteCourseCodes}
            onChange={(event) => setPrerequisiteCourseCodes(event.target.value)}
            placeholder="ALG1, CALC1"
          />
        </label>
        <label>
          <span>Department</span>
          <select value={department} onChange={(event) => setDepartment(event.target.value as DepartmentOption)}>
            <option value="ALL">All departments</option>
            <option value="SW">SW</option>
            <option value="IS">IS</option>
          </select>
        </label>
      </div>
      <div className="button-row button-row-inline">
        <button type="submit">{initialValue ? "Save fixed exam" : "Add fixed exam"}</button>
        {onCancel ? (
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
