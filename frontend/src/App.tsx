import { useEffect, useRef, useState } from "react";

import { explainMoveProject, importCoursesSpreadsheet, manualMoveProject, solveProject, validateProject } from "./api";
import { EditableSimpleList } from "./components/common/EditableSimpleList";
import { IssueList } from "./components/common/IssueList";
import { SectionTitle } from "./components/common/SectionTitle";
import { CourseForm } from "./components/forms/CourseForm";
import { ExcludedRangeForm } from "./components/forms/ExcludedRangeForm";
import { FixedExamForm } from "./components/forms/FixedExamForm";
import { ComparisonDashboard } from "./components/workspace/ComparisonDashboard";
import { ConflictDrawer } from "./components/workspace/ConflictDrawer";
import { DependencyGraph } from "./components/workspace/DependencyGraph";
import { MasterCalendar } from "./components/workspace/MasterCalendar";
import { SolutionCard } from "./components/workspace/SolutionCard";
import { deleteSetupEntry, loadProject, loadSetupLibrary, saveProject, upsertSetupEntry } from "./storage/localProject";
import { createEmptyProject } from "./types";
import type {
  CourseInput,
  CourseImportResponse,
  ExcludedDateRange,
  FixedExam,
  SavedSetupEntry,
  SavedSetupLibrary,
  ScheduleProject,
  ScheduleSolution,
  ScheduledExam,
  ValidationIssue,
} from "./types";
import { buildCalendarDays } from "./utils/calendarUtils";
import { getExamMoveKey, getPreviewKey, hasExamChanged } from "./utils/examKeys";
import {
  buildDependencyEdges,
  getPreviewStatus,
  type PreviewResponse,
} from "./utils/workspaceUtils";

type SetupStep = "project" | "excluded" | "fixed" | "courses";
type AppRoute = "/setup" | "/schedule";

function readRouteFromLocation(): { route: AppRoute; section: SetupStep | null } {
  const route: AppRoute = window.location.pathname === "/schedule" ? "/schedule" : "/setup";
  const hash = window.location.hash.replace("#", "");
  const section = ["project", "excluded", "fixed", "courses"].includes(hash) ? (hash as SetupStep) : null;
  return { route, section };
}

function getConflictKey(issue: ValidationIssue): string {
  return [issue.code, issue.related_course_code ?? "", issue.related_date ?? "", issue.message].join("|");
}

const SETUP_STEPS: Array<{ id: SetupStep; title: string; subtitle: string }> = [
  {
    id: "project",
    title: "Initial Setup",
    subtitle: "Define the Moed A window, project name, and scheduling gaps.",
  },
  {
    id: "excluded",
    title: "Excluded Dates",
    subtitle: "Block holidays or unavailable spans.",
  },
  {
    id: "fixed",
    title: "Fixed Exams",
    subtitle: "Lock courses that already have confirmed exam dates.",
  },
  {
    id: "courses",
    title: "Courses",
    subtitle: "Add courses manually or replace the current list from the Excel template.",
  },
];

function App() {
  const initialLocation = readRouteFromLocation();
  const [project, setProject] = useState<ScheduleProject>(() => loadProject());
  const [setupLibrary, setSetupLibrary] = useState<SavedSetupLibrary>(() => loadSetupLibrary());
  const [status, setStatus] = useState<string>("Draft saved locally.");
  const [busyAction, setBusyAction] = useState<"validate" | "solve" | "manual-move" | "import-courses" | null>(null);
  const [editingExcludedIndex, setEditingExcludedIndex] = useState<number | null>(null);
  const [editingFixedExamIndex, setEditingFixedExamIndex] = useState<number | null>(null);
  const [editingCourseIndex, setEditingCourseIndex] = useState<number | null>(null);
  const [courseImportIssues, setCourseImportIssues] = useState<ValidationIssue[]>([]);
  const [moveDrafts, setMoveDrafts] = useState<Record<string, string>>({});
  const [movingExamKey, setMovingExamKey] = useState<string | null>(null);
  const [selectedSolutionId, setSelectedSolutionId] = useState<string | null>(null);
  const [selectedExamKey, setSelectedExamKey] = useState<string | null>(null);
  const [selectedPreviewDate, setSelectedPreviewDate] = useState<string | null>(null);
  const [previewResponses, setPreviewResponses] = useState<Record<string, PreviewResponse>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showChanges, setShowChanges] = useState(false);
  const [graphFocusCourseCode, setGraphFocusCourseCode] = useState<string | null>(null);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<"calendar" | "compare" | "graph">("calendar");
  const [activeRoute, setActiveRoute] = useState<AppRoute>(initialLocation.route);
  const [activeSetupSection, setActiveSetupSection] = useState<SetupStep | null>(initialLocation.section);
  const [setupExpanded, setSetupExpanded] = useState<boolean>(initialLocation.route === "/setup");
  const [collapsedSetupYears, setCollapsedSetupYears] = useState<Record<string, boolean>>({});
  const [selectedCourseFileName, setSelectedCourseFileName] = useState<string>("");
  const [coursesListCollapsed, setCoursesListCollapsed] = useState(false);
  const [selectedConflictKey, setSelectedConflictKey] = useState<string | null>(null);
  const courseImportInputRef = useRef<HTMLInputElement | null>(null);
  const setupSectionRefs = useRef<Partial<Record<SetupStep, HTMLElement | null>>>({});

  const courseNameByCode = Object.fromEntries(project.courses.map((course) => [course.course_code, course.course_name]));
  const courseByCode = Object.fromEntries(project.courses.map((course) => [course.course_code, course]));
  const calendarDays = buildCalendarDays(project);
  const calendarDayKey = calendarDays.join("|");
  const semesterRows = Array.from(new Set(project.courses.map((course) => course.semester_number))).sort((left, right) => left - right);
  const activeSolution = project.solutions.find((solution) => solution.solution_id === selectedSolutionId) ?? project.solutions[0] ?? null;
  const selectedExam = activeSolution && selectedExamKey
    ? activeSolution.exams.find((exam) => getExamMoveKey(activeSolution.solution_id, exam.course_code) === selectedExamKey) ?? null
    : null;
  const selectedCourse = selectedExam ? courseByCode[selectedExam.course_code] : null;
  const dependencyEdges = buildDependencyEdges(project);
  const allSavedSetups = Object.values(setupLibrary).flat();
  const currentSavedSetup = project.setup_entry_id
    ? allSavedSetups.find((entry) => entry.entry_id === project.setup_entry_id) ?? null
    : null;
  const hasInitialSetup = Boolean(project.setup_entry_id);
  const sortedSetupYears = Object.keys(setupLibrary).sort((left, right) => Number(right) - Number(left));
  const [isEditingInitialSetup, setIsEditingInitialSetup] = useState<boolean>(() => !project.setup_entry_id);

  useEffect(() => {
    if (window.location.pathname === "/") {
      window.history.replaceState({}, "", "/setup");
      setActiveRoute("/setup");
    }

    const handlePopState = () => {
      const nextLocation = readRouteFromLocation();
      setActiveRoute(nextLocation.route);
      setActiveSetupSection(nextLocation.section);
      setSetupExpanded(nextLocation.route === "/setup");
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (activeRoute !== "/setup") {
      return;
    }

    if (activeSetupSection) {
      setupSectionRefs.current[activeSetupSection]?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [activeRoute, activeSetupSection]);

  useEffect(() => {
    saveProject(project);
  }, [project]);

  useEffect(() => {
    if (project.solutions.length === 0) {
      setSelectedSolutionId(null);
      setSelectedExamKey(null);
      setSelectedPreviewDate(null);
      return;
    }

    if (!selectedSolutionId || !project.solutions.some((solution) => solution.solution_id === selectedSolutionId)) {
      setSelectedSolutionId(project.solutions[0].solution_id);
    }
  }, [project.solutions, selectedSolutionId]);

  useEffect(() => {
    setPreviewResponses({});
  }, [selectedSolutionId, selectedExamKey, project.solutions]);

  useEffect(() => {
    setSelectedPreviewDate(null);
    setSelectedConflictKey(null);
  }, [selectedSolutionId, project.solutions]);

  useEffect(() => {
    if (!activeSolution || !selectedExam) {
      return;
    }

    let ignore = false;
    setPreviewLoading(true);

    Promise.all(
      calendarDays.map(async (dateText) => {
        const previewKey = getPreviewKey(activeSolution.solution_id, selectedExam.course_code, dateText);
        const response = await explainMoveProject(project, activeSolution.solution_id, selectedExam.course_code, dateText);
        return [previewKey, response] as const;
      }),
    )
      .then((results) => {
        if (!ignore) {
          setPreviewResponses(Object.fromEntries(results));
        }
      })
      .catch((error) => {
        if (!ignore) {
          setStatus(error instanceof Error ? error.message : "Move preview failed.");
        }
      })
      .finally(() => {
        if (!ignore) {
          setPreviewLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [activeSolution, calendarDayKey, project, selectedExam]);

  function patchProject(patch: Partial<ScheduleProject>) {
    setProject((current) => ({ ...current, ...patch, solutions: [], issues: [] }));
    setStatus("Draft updated locally.");
  }

  function buildSavedSetupEntry(): SavedSetupEntry {
    const startYear = Number(project.moed_a_window.start_date.slice(0, 4));
    const savedAt = new Date().toISOString();

    return {
      entry_id: project.setup_entry_id ?? `setup-${savedAt}`,
      year: Number.isFinite(startYear) ? startYear : new Date().getFullYear(),
      project_name: project.project_name,
      moed_a_window: { ...project.moed_a_window },
      constraint_config: { ...project.constraint_config },
      saved_at: savedAt,
    };
  }

  function handleSaveInitialSetup() {
    const savedEntry = buildSavedSetupEntry();
    const nextLibrary = upsertSetupEntry(savedEntry);

    setSetupLibrary(nextLibrary);
    setProject((current) => ({
      ...current,
      setup_entry_id: savedEntry.entry_id,
      initial_setup_saved_at: savedEntry.saved_at,
      solutions: [],
      issues: [],
    }));
    setIsEditingInitialSetup(false);
    setStatus(`Saved initial setup under ${savedEntry.year}.`);
  }

  function handleUseSavedSetup(entry: SavedSetupEntry) {
    const emptyProject = createEmptyProject();

    setProject({
      ...emptyProject,
      project_name: entry.project_name,
      moed_a_window: { ...entry.moed_a_window },
      constraint_config: { ...entry.constraint_config },
      setup_entry_id: entry.entry_id,
      initial_setup_saved_at: entry.saved_at,
    });
    setEditingExcludedIndex(null);
    setEditingFixedExamIndex(null);
    setEditingCourseIndex(null);
    setSelectedSolutionId(null);
    setSelectedExamKey(null);
    setSelectedPreviewDate(null);
    setGraphFocusCourseCode(null);
    setCourseImportIssues([]);
    setIsEditingInitialSetup(false);
    navigateTo("/setup", "project");
    setStatus(`Loaded saved setup from ${entry.year}.`);
  }

  function handleDeleteSavedSetup(entry: SavedSetupEntry) {
    const nextLibrary = deleteSetupEntry(entry.entry_id);
    setSetupLibrary(nextLibrary);

    if (project.setup_entry_id === entry.entry_id) {
      setProject((current) => ({
        ...current,
        setup_entry_id: null,
        initial_setup_saved_at: null,
        solutions: [],
        issues: [],
      }));
      setIsEditingInitialSetup(true);
      navigateTo("/setup", "project");
      setStatus(`Deleted saved setup ${entry.project_name}. The current entry is now unsaved.`);
      return;
    }

    setStatus(`Deleted saved setup ${entry.project_name}.`);
  }

  function navigateTo(route: AppRoute, section?: SetupStep | null) {
    const nextUrl = route === "/setup" && section ? `${route}#${section}` : route;
    if (`${window.location.pathname}${window.location.hash}` !== nextUrl) {
      window.history.pushState({}, "", nextUrl);
    }

    setActiveRoute(route);
    setActiveSetupSection(route === "/setup" ? (section ?? null) : null);
    setSetupExpanded(route === "/setup");
  }

  function formatFixedExamItem(exam: FixedExam): string {
    const prerequisiteText = exam.prerequisite_course_codes.length > 0 ? exam.prerequisite_course_codes.join(", ") : "None";

    return `${exam.course_code} - ${exam.course_name} - Prerequisites: ${prerequisiteText} - ${exam.exam_date}`;
  }

  function resetSetupEditors() {
    setEditingExcludedIndex(null);
    setEditingFixedExamIndex(null);
    setEditingCourseIndex(null);
  }

  function saveExcludedRange(range: ExcludedDateRange) {
    patchProject({
      excluded_ranges:
        editingExcludedIndex === null
          ? [...project.excluded_ranges, range]
          : project.excluded_ranges.map((currentRange, index) =>
              index === editingExcludedIndex ? range : currentRange,
            ),
    });
    setEditingExcludedIndex(null);
  }

  function removeExcludedRange(indexToRemove: number) {
    patchProject({
      excluded_ranges: project.excluded_ranges.filter((_, index) => index !== indexToRemove),
    });
    setEditingExcludedIndex(null);
  }

  function saveFixedExam(exam: FixedExam) {
    patchProject({
      fixed_exams:
        editingFixedExamIndex === null
          ? [...project.fixed_exams, exam]
          : project.fixed_exams.map((currentExam, index) =>
              index === editingFixedExamIndex ? exam : currentExam,
            ),
    });
    setEditingFixedExamIndex(null);
  }

  function removeFixedExam(indexToRemove: number) {
    patchProject({
      fixed_exams: project.fixed_exams.filter((_, index) => index !== indexToRemove),
    });
    setEditingFixedExamIndex(null);
  }

  function saveCourse(course: CourseInput) {
    setCourseImportIssues([]);
    patchProject({
      courses:
        editingCourseIndex === null
          ? [...project.courses, course]
          : project.courses.map((currentCourse, index) => (index === editingCourseIndex ? course : currentCourse)),
    });
    setEditingCourseIndex(null);
  }

  function summarizeCourseImportIssues(issues: ValidationIssue[]): string {
    const [firstIssue] = issues;
    if (!firstIssue) {
      return "Course import failed.";
    }

    return issues.length === 1
      ? `Course import failed: ${firstIssue.message}`
      : `Course import failed: ${firstIssue.message} (${issues.length} issues found)`;
  }

  function removeCourse(indexToRemove: number) {
    setCourseImportIssues([]);
    patchProject({
      courses: project.courses.filter((_, index) => index !== indexToRemove),
    });
    setEditingCourseIndex(null);
  }

  function resetCourseList() {
    setCourseImportIssues([]);
    setSelectedCourseFileName("");
    patchProject({ courses: [] });
    setEditingCourseIndex(null);
    setSelectedSolutionId(null);
    setSelectedExamKey(null);
    setSelectedPreviewDate(null);
    setGraphFocusCourseCode(null);
    setStatus("Course list reset.");
  }

  async function handleCourseImport(file: File) {
    setBusyAction("import-courses");
    setCourseImportIssues([]);
    setSelectedCourseFileName(file.name);
    setStatus(`Importing courses from ${file.name}...`);

    try {
      const result: CourseImportResponse = await importCoursesSpreadsheet(file);

      patchProject({ courses: result.courses });
      resetSetupEditors();
      setSelectedSolutionId(null);
      setSelectedExamKey(null);
      setSelectedPreviewDate(null);
      setGraphFocusCourseCode(null);
      setStatus(`Imported ${result.imported_count} courses from ${file.name}.`);
    } catch (error) {
      if (Array.isArray(error)) {
        const issues = error as ValidationIssue[];
        setCourseImportIssues(issues);
        setStatus(summarizeCourseImportIssues(issues));
      } else {
        setStatus(error instanceof Error ? error.message : "Course import failed.");
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function handleValidate() {
    setBusyAction("validate");
    setStatus("Checking project rules...");
    try {
      const validatedProject = await validateProject(project);
      setProject((current) => ({
        ...validatedProject,
        setup_entry_id: current.setup_entry_id,
        initial_setup_saved_at: current.initial_setup_saved_at,
      }));
      setStatus("Validation finished.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Validation failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSolve() {
    setBusyAction("solve");
    setStatus("Generating schedule options...");
    try {
      const solved = await solveProject(project);
      const nextSolutions = (solved.solutions as ScheduleProject["solutions"]).map((solution) => ({
        ...solution,
        original_exams: solution.original_exams ?? solution.exams.map((exam) => ({ ...exam })),
        original_score: solution.original_score ?? solution.score,
      }));

      setProject((current) => ({
        ...current,
        solutions: nextSolutions,
        issues: solved.issues as ValidationIssue[],
      }));
      setSelectedSolutionId(nextSolutions[0]?.solution_id ?? null);
      setSelectedExamKey(null);
      setGraphFocusCourseCode(null);
      setStatus("Solver response received.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Solve failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleManualMove(solution: ScheduleSolution, exam: ScheduledExam, explicitDate?: string) {
    const moveKey = getExamMoveKey(solution.solution_id, exam.course_code);
    const newDate = explicitDate ?? moveDrafts[moveKey] ?? exam.exam_date;

    if (newDate === exam.exam_date) {
      setStatus(`Select a new date for ${exam.course_code} before moving it.`);
      return;
    }

    setBusyAction("manual-move");
    setMovingExamKey(moveKey);
    setStatus(`Validating manual move for ${exam.course_code}...`);

    try {
      const response = await manualMoveProject(project, solution.solution_id, exam.course_code, newDate);

      setProject((current) => ({
        ...current,
        solutions: current.solutions.map((currentSolution) => {
          if (currentSolution.solution_id !== solution.solution_id) {
            return currentSolution;
          }

          const preservedOriginalExams = currentSolution.original_exams ?? currentSolution.exams.map((currentExam) => ({ ...currentExam }));
          const preservedOriginalScore = currentSolution.original_score ?? currentSolution.score;

          if (response.valid && response.updated_solution) {
            return {
              ...currentSolution,
              ...response.updated_solution,
              issues: response.issues,
              original_exams: preservedOriginalExams,
              original_score: preservedOriginalScore,
            };
          }

          return {
            ...currentSolution,
            issues: response.issues,
            original_exams: preservedOriginalExams,
            original_score: preservedOriginalScore,
          };
        }),
      }));

      setMoveDrafts((current) => ({
        ...current,
        [moveKey]: newDate,
      }));
      setSelectedPreviewDate(newDate);
      setStatus(
        response.valid
          ? `Moved ${exam.course_code} to ${newDate}.`
          : `Move rejected for ${exam.course_code}. Review the reported issues.`,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Manual move failed.");
    } finally {
      setBusyAction(null);
      setMovingExamKey(null);
    }
  }

  function handleResetSolution(solutionId: string) {
    setProject((current) => ({
      ...current,
      solutions: current.solutions.map((solution) => {
        if (solution.solution_id !== solutionId || !solution.original_exams) {
          return solution;
        }

        return {
          ...solution,
          exams: solution.original_exams.map((exam) => ({ ...exam })),
          score: solution.original_score ?? solution.score,
          issues: [],
        };
      }),
    }));
    setSelectedPreviewDate(null);
    setSelectedConflictKey(null);
    setStatus(`Reset ${solutionId} back to its original solver schedule.`);
  }

  const previewResponse = activeSolution && selectedExam && selectedPreviewDate
    ? previewResponses[getPreviewKey(activeSolution.solution_id, selectedExam.course_code, selectedPreviewDate)]
    : undefined;
  const previewStatus = activeSolution && selectedExam && selectedPreviewDate
    ? getPreviewStatus(activeSolution, selectedPreviewDate, selectedExam, previewResponse)
    : "idle";
  const previewIssues = previewResponse?.issues ?? [];
  const activeConflict = previewIssues.find((issue) => getConflictKey(issue) === selectedConflictKey) ?? previewIssues[0] ?? null;

  useEffect(() => {
    if (previewIssues.length === 0) {
      setSelectedConflictKey(null);
      return;
    }

    setSelectedConflictKey((current) => {
      if (current && previewIssues.some((issue) => getConflictKey(issue) === current)) {
        return current;
      }

      return getConflictKey(previewIssues[0]);
    });
  }, [previewIssues]);

  function handleFocusConflict(issue: ValidationIssue) {
    if (!activeSolution) {
      return;
    }

    setSelectedConflictKey(getConflictKey(issue));

    const targetCourseCode = issue.related_course_code ?? selectedExam?.course_code ?? null;
    const targetExam = targetCourseCode
      ? activeSolution.exams.find((exam) => exam.course_code === targetCourseCode) ?? null
      : null;

    if (targetExam) {
      setSelectedExamKey(getExamMoveKey(activeSolution.solution_id, targetExam.course_code));
      setSelectedPreviewDate(issue.related_date ?? targetExam.exam_date);
      setGraphFocusCourseCode(targetExam.course_code);
      return;
    }

    if (issue.related_date) {
      setSelectedPreviewDate(issue.related_date);
    }
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar panel">
        <div className="sidebar-branding">
          <strong>Exam Optimizer</strong>
          <span>Workspace navigation</span>
        </div>

        <nav className="sidebar-nav" aria-label="Primary navigation">
          <div className="sidebar-group">
            <button
              type="button"
              className={activeRoute === "/setup" ? "sidebar-link active" : "sidebar-link"}
              onClick={() => {
                setSetupExpanded(true);
                navigateTo("/setup");
              }}
            >
              <span>Setup</span>
              <span className="sidebar-caret">{setupExpanded ? "-" : "+"}</span>
            </button>

            {setupExpanded ? (
              <div className="sidebar-sublinks">
                {SETUP_STEPS.map((step) => (
                  <button
                    key={step.id}
                    type="button"
                    className={activeRoute === "/setup" && activeSetupSection === step.id ? "sidebar-sublink active" : "sidebar-sublink"}
                    disabled={!hasInitialSetup && step.id !== "project"}
                    onClick={() => navigateTo("/setup", step.id)}
                  >
                    {step.title}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            className={activeRoute === "/schedule" ? "sidebar-link active" : "sidebar-link"}
            onClick={() => navigateTo("/schedule")}
          >
            <span>Schedule</span>
          </button>
        </nav>
      </aside>

      <main className="content-shell workspace-grid">
        {activeRoute === "/setup" ? (
          <div className="setup-route-layout route-panel">
          <section className="panel setup-panel setup-main-panel">
            <div className="setup-shell-header compact-shell-header">
              <SectionTitle title="Setup" subtitle="Start with one saved initial setup entry. Once it is saved, keep the summary at the top and continue with excluded dates, fixed exams, and courses." />
            </div>

            <section
              className="setup-step-panel setup-category-panel"
              ref={(element) => {
                setupSectionRefs.current.project = element;
              }}
            >
              <SectionTitle title={SETUP_STEPS[0].title} subtitle={SETUP_STEPS[0].subtitle} />
              <div className="setup-step-content compact-step-content">
                {hasInitialSetup && !isEditingInitialSetup ? (
                  <div className="saved-entry-summary">
                    <div className="saved-entry-summary-header">
                      <div>
                        <strong>{project.project_name}</strong>
                        <p className="field-hint">Saved under {currentSavedSetup?.year ?? project.moed_a_window.start_date.slice(0, 4)} and ready for the rest of setup.</p>
                      </div>
                      <div className="row-actions">
                        <button type="button" className="secondary-button" onClick={() => setIsEditingInitialSetup(true)}>
                          Edit entry
                        </button>
                        <button type="button" onClick={handleSaveInitialSetup}>
                          Update saved setup
                        </button>
                      </div>
                    </div>
                    <div className="setup-summary-grid">
                      <div>
                        <span>Name</span>
                        <strong>{project.project_name}</strong>
                      </div>
                      <div>
                        <span>Window</span>
                        <strong>{project.moed_a_window.start_date} to {project.moed_a_window.end_date}</strong>
                      </div>
                      <div>
                        <span>Gaps</span>
                        <strong>
                          {project.constraint_config.same_semester_gap_days} / {project.constraint_config.prerequisite_gap_days} / {project.constraint_config.high_failure_gap_days} days
                        </strong>
                      </div>
                      <div>
                        <span>Saved</span>
                        <strong>{project.initial_setup_saved_at ? new Date(project.initial_setup_saved_at).toLocaleString() : "Draft"}</strong>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <label>
                      <span>Project name</span>
                      <input
                        value={project.project_name}
                        onChange={(event) => patchProject({ project_name: event.target.value })}
                      />
                    </label>
                    <div className="field-row compact-field-row">
                      <label>
                        <span>Start date</span>
                        <input
                          type="date"
                          value={project.moed_a_window.start_date}
                          onChange={(event) =>
                            patchProject({
                              moed_a_window: { ...project.moed_a_window, start_date: event.target.value },
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>End date</span>
                        <input
                          type="date"
                          value={project.moed_a_window.end_date}
                          onChange={(event) =>
                            patchProject({
                              moed_a_window: { ...project.moed_a_window, end_date: event.target.value },
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="field-row field-row-triple compact-field-row">
                      <label>
                        <span>Same semester gap</span>
                        <input
                          type="number"
                          min="1"
                          max="30"
                          value={project.constraint_config.same_semester_gap_days}
                          onChange={(event) =>
                            patchProject({
                              constraint_config: {
                                ...project.constraint_config,
                                same_semester_gap_days: Number(event.target.value),
                              },
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>Prerequisite gap</span>
                        <input
                          type="number"
                          min="1"
                          max="30"
                          value={project.constraint_config.prerequisite_gap_days}
                          onChange={(event) =>
                            patchProject({
                              constraint_config: {
                                ...project.constraint_config,
                                prerequisite_gap_days: Number(event.target.value),
                              },
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>High-failure gap</span>
                        <input
                          type="number"
                          min="1"
                          max="30"
                          value={project.constraint_config.high_failure_gap_days}
                          onChange={(event) =>
                            patchProject({
                              constraint_config: {
                                ...project.constraint_config,
                                high_failure_gap_days: Number(event.target.value),
                              },
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="button-row initial-entry-actions">
                      <button type="button" onClick={handleSaveInitialSetup}>
                        {hasInitialSetup ? "Update initial setup" : "Save initial setup"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </section>

            {hasInitialSetup ? (
              <>
            <div className="setup-shell-header locked-summary-header">
              <div className="setup-summary-row">
                <span>{project.excluded_ranges.length} excluded ranges</span>
                <span>{project.fixed_exams.length} fixed exams</span>
                <span>{project.courses.length} courses</span>
                <span>{project.solutions.length} solutions</span>
              </div>
            </div>

            <div className="setup-sections-grid">
            <section
              className="setup-step-panel setup-category-panel"
              ref={(element) => {
                setupSectionRefs.current.excluded = element;
              }}
            >
              <SectionTitle title={SETUP_STEPS[1].title} subtitle={SETUP_STEPS[1].subtitle} />
              <div className="setup-step-content compact-step-content">
                <ExcludedRangeForm
                  key={editingExcludedIndex === null ? "new-excluded-range" : `edit-excluded-range-${editingExcludedIndex}`}
                  initialValue={editingExcludedIndex === null ? undefined : project.excluded_ranges[editingExcludedIndex]}
                  onSubmit={saveExcludedRange}
                  onCancel={editingExcludedIndex === null ? undefined : () => setEditingExcludedIndex(null)}
                />
                <EditableSimpleList
                  items={project.excluded_ranges.map((range) => `${range.start_date} to ${range.end_date} - ${range.reason}`)}
                  emptyMessage="No blocked dates yet."
                  onEdit={setEditingExcludedIndex}
                  onRemove={removeExcludedRange}
                />
              </div>
            </section>

            <section
              className="setup-step-panel setup-category-panel"
              ref={(element) => {
                setupSectionRefs.current.fixed = element;
              }}
            >
              <SectionTitle title={SETUP_STEPS[2].title} subtitle={SETUP_STEPS[2].subtitle} />
              <div className="setup-step-content compact-step-content">
                <FixedExamForm
                  key={editingFixedExamIndex === null ? "new-fixed-exam" : `edit-fixed-exam-${editingFixedExamIndex}`}
                  initialValue={editingFixedExamIndex === null ? undefined : project.fixed_exams[editingFixedExamIndex]}
                  onSubmit={saveFixedExam}
                  onCancel={editingFixedExamIndex === null ? undefined : () => setEditingFixedExamIndex(null)}
                />
                <EditableSimpleList
                  items={project.fixed_exams.map((exam) => formatFixedExamItem(exam))}
                  emptyMessage="No fixed exams yet."
                  onEdit={setEditingFixedExamIndex}
                  onRemove={removeFixedExam}
                />
              </div>
            </section>

            <section
              className="setup-step-panel setup-category-panel"
              ref={(element) => {
                setupSectionRefs.current.courses = element;
              }}
            >
              <SectionTitle title={SETUP_STEPS[3].title} subtitle={SETUP_STEPS[3].subtitle} />
              <div className="setup-step-content compact-step-content">
                <div className="stack-form import-panel compact-import-panel">
                  <div className="file-input-row">
                    <div>
                      <span className="file-input-label">Excel course template</span>
                      <p className="field-hint">Expected columns: Course ID, Course Name, Semester, Is High Failure, Prerequisites. Import replaces the current course list.</p>
                    </div>
                    <div className="file-input-controls">
                      <input
                        ref={courseImportInputRef}
                        className="file-input-hidden"
                        type="file"
                        accept=".xlsx"
                        disabled={busyAction !== null}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.currentTarget.value = "";
                          if (file) {
                            void handleCourseImport(file);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busyAction !== null}
                        onClick={() => courseImportInputRef.current?.click()}
                      >
                        {busyAction === "import-courses" ? "Importing..." : "Choose file"}
                      </button>
                      <span className="file-input-name">{selectedCourseFileName || "No file selected"}</span>
                    </div>
                  </div>
                  {courseImportIssues.length > 0 ? <IssueList issues={courseImportIssues} compact /> : null}
                </div>
                <CourseForm
                  key={editingCourseIndex === null ? "new-course" : `edit-course-${editingCourseIndex}`}
                  initialValue={editingCourseIndex === null ? undefined : project.courses[editingCourseIndex]}
                  onSubmit={saveCourse}
                  onCancel={editingCourseIndex === null ? undefined : () => setEditingCourseIndex(null)}
                />
                <div className="list-section-header compact-list-header">
                  <div>
                    <strong>Current course list</strong>
                    <p className="field-hint">{project.courses.length} courses in the current draft.</p>
                  </div>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={busyAction !== null || project.courses.length === 0}
                      onClick={resetCourseList}
                    >
                      Reset list
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setCoursesListCollapsed((current) => !current)}
                    >
                      {coursesListCollapsed ? "Expand list" : "Collapse list"}
                    </button>
                  </div>
                </div>
                {!coursesListCollapsed ? (
                  <div className="table-wrap compact-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Name</th>
                          <th>Semester</th>
                          <th>High failure</th>
                          <th>Prerequisite</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {project.courses.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="empty-row">
                              No courses added yet.
                            </td>
                          </tr>
                        ) : (
                          project.courses.map((course, index) => (
                            <tr key={`${course.course_code}-${index}`}>
                              <td>{course.course_code}</td>
                              <td>{course.course_name}</td>
                              <td>{course.semester_number}</td>
                              <td>{course.high_failure_rate ? "Yes" : "No"}</td>
                              <td>{course.prerequisite_course_codes.length > 0 ? course.prerequisite_course_codes.join(", ") : "-"}</td>
                              <td>
                                <div className="row-actions">
                                  <button type="button" className="secondary-button" onClick={() => setEditingCourseIndex(index)}>
                                    Edit
                                  </button>
                                  <button type="button" className="danger-button" onClick={() => removeCourse(index)}>
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          <div className="setup-flow-footer">
            <div className="button-row setup-actions">
              <button onClick={handleValidate} disabled={busyAction !== null}>
                {busyAction === "validate" ? "Validating..." : "Validate draft"}
              </button>
              <button className="accent-button" onClick={handleSolve} disabled={busyAction !== null}>
                {busyAction === "solve" ? "Solving..." : "Generate options"}
              </button>
            </div>
          </div>
              </>
            ) : (
              <div className="setup-locked-state">
                <p className="empty-state">Save the initial setup entry first. After that, excluded dates, fixed exams, and courses will unlock here.</p>
              </div>
            )}
          </section>
          <aside className="setup-side-rail">
            <section className="panel setup-side-panel">
              <SectionTitle title="Current Entry" subtitle="The initial setup is stored separately so it can become a reusable yearly template later." />
              <div className="status-card compact-status-card neutral-status-card">
                <span className="status-label">Workspace status</span>
                <strong>{status}</strong>
              </div>
              <div className="setup-summary-grid side-summary-grid">
                <div>
                  <span>Year folder</span>
                  <strong>{project.moed_a_window.start_date.slice(0, 4)}</strong>
                </div>
                <div>
                  <span>Saved setups</span>
                  <strong>{allSavedSetups.length}</strong>
                </div>
                <div>
                  <span>Courses</span>
                  <strong>{project.courses.length}</strong>
                </div>
                <div>
                  <span>Solutions</span>
                  <strong>{project.solutions.length}</strong>
                </div>
              </div>
            </section>

            <section className="panel setup-side-panel">
              <SectionTitle title="Saved Setups" subtitle="Grouped by year now so future file-based folders can mirror the same structure." />
              {sortedSetupYears.length === 0 ? (
                <p className="empty-state">No saved initial setups yet.</p>
              ) : (
                <div className="saved-setup-library">
                  {sortedSetupYears.map((yearKey) => (
                    <section key={yearKey} className="year-folder-group">
                      <button
                        type="button"
                        className="year-folder-toggle"
                        onClick={() =>
                          setCollapsedSetupYears((current) => ({
                            ...current,
                            [yearKey]: !(current[yearKey] ?? false),
                          }))
                        }
                      >
                        <span>{yearKey}</span>
                        <span>
                          {setupLibrary[yearKey].length} setup{setupLibrary[yearKey].length === 1 ? "" : "s"} {collapsedSetupYears[yearKey] ? "+" : "-"}
                        </span>
                      </button>
                      {!collapsedSetupYears[yearKey] ? (
                        <div className="year-folder-list">
                          {setupLibrary[yearKey].map((entry) => (
                            <div key={entry.entry_id} className="saved-setup-item">
                              <button
                                type="button"
                                className={entry.entry_id === project.setup_entry_id ? "saved-setup-button active" : "saved-setup-button"}
                                onClick={() => handleUseSavedSetup(entry)}
                              >
                                <strong>{entry.project_name}</strong>
                                <span>{entry.moed_a_window.start_date} to {entry.moed_a_window.end_date}</span>
                              </button>
                              <button
                                type="button"
                                className="saved-setup-delete"
                                aria-label={`Delete ${entry.project_name}`}
                                onClick={() => handleDeleteSavedSetup(entry)}
                              >
                                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                                  <path d="M3.5 4.5h9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                                  <path d="M6 4.5v-1A1.5 1.5 0 0 1 7.5 2h1A1.5 1.5 0 0 1 10 3.5v1" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                                  <path d="M5 6.5v5.5A1.5 1.5 0 0 0 6.5 13.5h3A1.5 1.5 0 0 0 11 12V6.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                                  <path d="M7 7.5v4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                                  <path d="M9 7.5v4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </section>
                  ))}
                </div>
              )}
            </section>
          </aside>
          </div>
        ) : null}

        {activeRoute === "/schedule" ? (
          <>
        <section className="panel panel-wide route-panel">
          <div className="workspace-tabs">
            <button
              type="button"
              className={activeWorkspaceTab === "calendar" ? "solution-tab active" : "solution-tab"}
              onClick={() => setActiveWorkspaceTab("calendar")}
            >
              Calendar
            </button>
            <button
              type="button"
              className={activeWorkspaceTab === "compare" ? "solution-tab active" : "solution-tab"}
              onClick={() => setActiveWorkspaceTab("compare")}
            >
              Compare
            </button>
            <button
              type="button"
              className={activeWorkspaceTab === "graph" ? "solution-tab active" : "solution-tab"}
              onClick={() => setActiveWorkspaceTab("graph")}
            >
              Graph
            </button>
          </div>

          <div className="workspace-tab-panel">
            {activeWorkspaceTab === "calendar" ? (
              <>
                <SectionTitle title="Master Calendar" subtitle="Primary solution view with semester rows, Moed days, and move-preview overlays." />
                {project.solutions.length === 0 || !activeSolution ? (
                  <p className="empty-state">Generate schedules to unlock the master calendar.</p>
                ) : (
                  <>
                    <div className="calendar-toolbar">
                      <div className="solution-tabs">
                        {project.solutions.map((solution) => (
                          <button
                            key={solution.solution_id}
                            type="button"
                            className={solution.solution_id === activeSolution.solution_id ? "solution-tab active" : "solution-tab"}
                            onClick={() => {
                              setSelectedSolutionId(solution.solution_id);
                              setSelectedExamKey(null);
                              setGraphFocusCourseCode(null);
                            }}
                          >
                            {solution.solution_id}
                          </button>
                        ))}
                      </div>
                      <div className="calendar-actions">
                        <button type="button" className="secondary-button" onClick={() => setShowChanges((current) => !current)}>
                          {showChanges ? "Hide changes" : "Show changes"}
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={!activeSolution.original_exams || !activeSolution.exams.some((exam) => hasExamChanged(activeSolution, exam.course_code))}
                          onClick={() => handleResetSolution(activeSolution.solution_id)}
                        >
                          Reset to optimal
                        </button>
                      </div>
                    </div>

                    <div className="calendar-layout">
                      <MasterCalendar
                        project={project}
                        solution={activeSolution}
                        calendarDays={calendarDays}
                        semesterRows={semesterRows}
                        courseNameByCode={courseNameByCode}
                        courseByCode={courseByCode}
                        selectedExam={selectedExam}
                        selectedPreviewDate={selectedPreviewDate}
                        previewResponses={previewResponses}
                        previewLoading={previewLoading}
                        showChanges={showChanges}
                        activeConflict={activeConflict}
                        onSelectExam={(exam) => {
                          setSelectedConflictKey(null);
                          setSelectedExamKey(getExamMoveKey(activeSolution.solution_id, exam.course_code));
                          setSelectedPreviewDate(exam.exam_date);
                          setGraphFocusCourseCode(exam.course_code);
                        }}
                        onSelectPreviewDate={(date) => {
                          setSelectedConflictKey(null);
                          setSelectedPreviewDate(date);
                        }}
                      />
                      <ConflictDrawer
                        solution={activeSolution}
                        selectedExam={selectedExam}
                        selectedCourse={selectedCourse}
                        selectedPreviewDate={selectedPreviewDate}
                        previewResponse={previewResponse}
                        previewStatus={previewStatus}
                        activeConflict={activeConflict}
                        onSelectConflict={handleFocusConflict}
                        onApplyMove={() => {
                          if (selectedExam && selectedPreviewDate) {
                            void handleManualMove(activeSolution, selectedExam, selectedPreviewDate);
                          }
                        }}
                        onClearSelection={() => {
                          setSelectedConflictKey(null);
                          setSelectedExamKey(null);
                          setSelectedPreviewDate(null);
                        }}
                        busy={busyAction === "manual-move"}
                      />
                    </div>
                  </>
                )}
              </>
            ) : null}

            {activeWorkspaceTab === "compare" ? (
              <>
                <SectionTitle title="Comparison Dashboard" subtitle="Compare generated and manually edited solutions side by side." />
                {project.solutions.length === 0 ? (
                  <p className="empty-state">No solutions available for comparison.</p>
                ) : (
                  <ComparisonDashboard solutions={project.solutions} activeSolutionId={activeSolution?.solution_id ?? null} onSelectSolution={setSelectedSolutionId} />
                )}
              </>
            ) : null}

            {activeWorkspaceTab === "graph" ? (
              <>
                <SectionTitle title="Dependency Graph" subtitle="See why a course is hard to move by following semester and prerequisite links." />
                {project.courses.length === 0 ? (
                  <p className="empty-state">Add courses to see the constraint graph.</p>
                ) : (
                  <DependencyGraph
                    courses={project.courses}
                    solution={activeSolution}
                    edges={dependencyEdges}
                    focusCourseCode={graphFocusCourseCode}
                    changedCourseCodes={activeSolution ? activeSolution.exams.filter((exam) => hasExamChanged(activeSolution, exam.course_code)).map((exam) => exam.course_code) : []}
                    onSelectCourse={(courseCode) => setGraphFocusCourseCode(courseCode || null)}
                  />
                )}
              </>
            ) : null}
          </div>
        </section>

        <section className="panel panel-wide route-panel">
          <SectionTitle title="Solution Details" subtitle="Secondary detail table with direct date input controls for the active solution." />
          {activeSolution ? (
            <SolutionCard
              solution={activeSolution}
              courseNameByCode={courseNameByCode}
              courseByCode={courseByCode}
              moveDrafts={moveDrafts}
              movingExamKey={movingExamKey}
              disabled={busyAction !== null}
              showChanges={showChanges}
              onDraftChange={(solutionId, courseCode, nextDate) => {
                setMoveDrafts((current) => ({
                  ...current,
                  [getExamMoveKey(solutionId, courseCode)]: nextDate,
                }));
              }}
              onMove={handleManualMove}
            />
          ) : (
            <p className="empty-state">No active solution selected.</p>
          )}
        </section>

        <section className="panel panel-wide route-panel">
          <SectionTitle title="Issues" subtitle="Validation and solver feedback will appear here." />
          <IssueList issues={project.issues} />
        </section>
          </>
        ) : null}
      </main>
    </div>
  );
}

export default App;
