import type { ScheduledExam, ValidationIssue } from "../../types";
import { formatDisplayDate } from "../../utils/dateHelpers";

function getConflictKey(issue: ValidationIssue): string {
  return [issue.code, issue.related_course_code ?? "", issue.related_date ?? "", issue.message].join("|");
}

export function ConflictDrawer({
  selectedExam,
  selectedMoedNumber,
  originalExamDate,
  conflictIssues,
  activeConflict,
  onSelectConflict,
  onClose,
}: {
  selectedExam: ScheduledExam | null;
  selectedMoedNumber: number;
  originalExamDate: string | null;
  conflictIssues: ValidationIssue[];
  activeConflict: ValidationIssue | null;
  onSelectConflict: (issue: ValidationIssue) => void;
  onClose: () => void;
}) {
  const issues = [...conflictIssues].sort((left, right) => {
    const leftDate = left.related_date ?? selectedExam?.exam_date ?? "9999-12-31";
    const rightDate = right.related_date ?? selectedExam?.exam_date ?? "9999-12-31";
    if (leftDate !== rightDate) {
      return leftDate.localeCompare(rightDate);
    }

    const leftCourse = left.related_course_code ?? "";
    const rightCourse = right.related_course_code ?? "";
    return leftCourse.localeCompare(rightCourse);
  });
  const highSeverityIssues = issues.filter((issue) => issue.severity === "error");
  const mediumSeverityIssues = issues.filter((issue) => issue.severity === "warning");
  const defaultIssueKey = issues[0] ? getConflictKey(issues[0]) : null;
  const highSeverityCount = issues.filter((issue) => issue.severity === "error").length;
  const mediumSeverityCount = issues.filter((issue) => issue.severity === "warning").length;

  function renderIssueGroup(groupLabel: string, groupIssues: ValidationIssue[], severityClass: "severity-error" | "severity-warning") {
    if (groupIssues.length === 0) {
      return null;
    }

    return (
      <section className="conflict-group" key={groupLabel}>
        <h4 className={severityClass}>{groupLabel}</h4>
        <div className="conflict-list">
          {groupIssues.map((issue, index) => {
            const issueKey = getConflictKey(issue);
            const isActive = activeConflict ? issueKey === getConflictKey(activeConflict) : issueKey === defaultIssueKey && index === 0;

            return (
              <button
                key={`${issueKey}-${index}`}
                type="button"
                className={[
                  "conflict-item",
                  issue.severity === "error" ? "severity-error" : "severity-warning",
                  isActive ? "active" : "",
                ].filter(Boolean).join(" ")}
                onClick={() => onSelectConflict(issue)}
              >
                <div className="conflict-item-header">
                  <strong>{issue.related_course_code ?? selectedExam?.course_code ?? "General"}</strong>
                  <span>{issue.related_date ? formatDisplayDate(issue.related_date) : selectedExam ? formatDisplayDate(selectedExam.exam_date) : "-"}</span>
                </div>
                <p>{issue.message}</p>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <aside className="conflict-bubble-panel">
      <div className="conflict-bubble-header">
        <div>
          <h3>Conflicts</h3>
          <p className="drawer-eyebrow">
            {`Moed ${String.fromCharCode(64 + selectedMoedNumber)}`}
            {selectedExam ? ` | ${selectedExam.course_code}` : ""}
          </p>
        </div>
        <button type="button" className="secondary-button conflict-close-button" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="conflict-legend">
        <span><i className="conflict-dot high" />High Severity {highSeverityCount}</span>
        <span><i className="conflict-dot medium" />Medium Severity {mediumSeverityCount}</span>
        <span><i className="conflict-dot active" />Conflict Active</span>
      </div>

      {selectedExam ? (
        <div className="drawer-grid">
          <div>
            <span>Current date</span>
            <strong>{formatDisplayDate(selectedExam.exam_date)}</strong>
          </div>
          <div>
            <span>Original date</span>
            <strong>{formatDisplayDate(originalExamDate ?? selectedExam.exam_date)}</strong>
          </div>
        </div>
      ) : null}

      {issues.length > 0 ? (
        <div className="conflict-groups">
          {renderIssueGroup("High Severity", highSeverityIssues, "severity-error")}
          {renderIssueGroup("Medium Severity", mediumSeverityIssues, "severity-warning")}
        </div>
      ) : (
        <p className="empty-state">No conflicts for this moed.</p>
      )}
    </aside>
  );
}
