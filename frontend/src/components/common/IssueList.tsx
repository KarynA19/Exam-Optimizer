import type { ValidationIssue } from "../../types";

export function IssueList({ issues, compact = false }: { issues: ValidationIssue[]; compact?: boolean }) {
  if (issues.length === 0) {
    return <p className="empty-state">No issues reported.</p>;
  }

  return (
    <ul className={compact ? "issue-list compact" : "issue-list"}>
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`} className={issue.severity === "error" ? "issue-error" : "issue-warning"}>
          <strong>{issue.severity.toUpperCase()}</strong>
          <span>{issue.message}</span>
        </li>
      ))}
    </ul>
  );
}
