import { useState } from "react";

import type { CourseInput } from "../../types";

export function CourseForm({
  initialValue,
  onSubmit,
  onCancel,
}: {
  initialValue?: CourseInput;
  onSubmit: (course: CourseInput) => void;
  onCancel?: () => void;
}) {
  const [courseCode, setCourseCode] = useState(initialValue?.course_code ?? "");
  const [courseName, setCourseName] = useState(initialValue?.course_name ?? "");
  const [semesterNumber, setSemesterNumber] = useState(String(initialValue?.semester_number ?? 1));
  const [highFailureRate, setHighFailureRate] = useState(initialValue?.high_failure_rate ?? false);
  const [prerequisiteCourseCode, setPrerequisiteCourseCode] = useState(initialValue?.prerequisite_course_code ?? "");

  return (
    <form
      className="stack-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          course_code: courseCode,
          course_name: courseName,
          semester_number: Number(semesterNumber),
          high_failure_rate: highFailureRate,
          prerequisite_course_code: prerequisiteCourseCode || null,
        });
        setCourseCode("");
        setCourseName("");
        setSemesterNumber("1");
        setHighFailureRate(false);
        setPrerequisiteCourseCode("");
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
          <span>Semester</span>
          <input
            type="number"
            min="1"
            max="12"
            value={semesterNumber}
            onChange={(event) => setSemesterNumber(event.target.value)}
            required
          />
        </label>
      </div>
      <div className="field-row">
        <label>
          <span>Prerequisite course code</span>
          <input value={prerequisiteCourseCode} onChange={(event) => setPrerequisiteCourseCode(event.target.value)} />
        </label>
        <label className="toggle-field">
          <span>High failure rate</span>
          <input type="checkbox" checked={highFailureRate} onChange={(event) => setHighFailureRate(event.target.checked)} />
        </label>
      </div>
      <div className="button-row button-row-inline">
        <button type="submit">{initialValue ? "Save course" : "Add course"}</button>
        {onCancel ? (
          <button type="button" className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
