import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import type { DateRange } from "react-day-picker";
import type { ColumnDef } from "@tanstack/react-table";
import {
  ArrowUpDown,
  BookOpen,
  CalendarCheck,
  CalendarDays,
  CalendarIcon,
  Check,
  ChevronsUpDown,
  CircleDashed,
  FolderKanban,
  Lock,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Trash,
  X,
} from "lucide-react";

import {
  deleteRemoteSetup,
  downloadCourseTemplate,
  explainMoveProject,
  getStoredAuthToken,
  getStoredAuthUserId,
  importCoursesSpreadsheet,
  listRemoteSavedSetups,
  loadRemoteSetup,
  loadRemoteSetupCourses,
  loadRemoteSetupFixedExams,
  loginToBackend,
  manualMoveProject,
  saveRemoteSetup,
  solveProject,
  updateRemoteSetupSolutions,
  validateProject,
} from "./api";
import { createEmptyProject } from "./types";
import { buildCalendarDays } from "./utils/calendarUtils";
import type {
  CourseDepartment,
  CourseImportResponse,
  CourseInput,
  ExcludedDateRange,
  FixedExam,
  ImportMode,
  MoedWindow,
  RemoteSavedSetupSummary,
  ScheduleProject,
  ValidationIssue,
} from "./types";
import { loadProject, saveProject } from "./storage/localProject";
import { getExamMoveKey, getPreviewKey } from "./utils/examKeys";
import type { PreviewResponse } from "./utils/workspaceUtils";
import { formatDisplayDate } from "./utils/dateHelpers";
import { cn } from "./lib/utils";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Calendar } from "./components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "./components/ui/command";
import { DataTable } from "./components/ui/data-table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./components/ui/dropdown-menu";
import { Form, FormField, FormItem, FormMessage } from "./components/ui/form";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./components/ui/popover";
import { Sidebar } from "./components/ui/sidebar";
import { Tabs, TabsContent } from "./components/ui/tabs";
import { MasterCalendar } from "./components/workspace/MasterCalendar";
import { ConflictDrawer } from "./components/workspace/ConflictDrawer";

type SetupStep = "setup" | "excluded" | "fixed" | "courses";
type AppRoute = "setup" | "schedule";

type CourseDraft = {
  course_code: string;
  course_name: string;
  semester_number: number;
  high_failure_rate: boolean;
  department: CourseDepartment;
  prerequisite_course_codes: string[];
};

type FixedDraft = {
  course_code: string;
  course_name: string;
  exam_date: string;
  department: CourseDepartment;
  prerequisite_course_codes: string[];
};

function prettifyPath(path: string): string {
  return path
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function formatApiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const rawMessage = error.message?.trim();
  if (!rawMessage) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(rawMessage) as {
      detail?: Array<{ msg?: string; loc?: Array<string | number> }> | string;
    };

    if (!parsed.detail) {
      return rawMessage;
    }

    if (typeof parsed.detail === "string") {
      return parsed.detail;
    }

    const messages = parsed.detail
      .map((entry) => {
        const message = entry.msg?.replace(/^Value error,\s*/i, "") ?? "Invalid value.";
        if (!entry.loc || entry.loc.length === 0) {
          return message;
        }

        const path = entry.loc
          .filter((part) => part !== "body" && part !== "project")
          .map((part) => String(part))
          .join(" > ");

        return path ? `${prettifyPath(path)}: ${message}` : message;
      })
      .filter(Boolean);

    if (messages.length > 0) {
      return messages.join(" | ");
    }
  } catch {
    return rawMessage;
  }

  return rawMessage;
}

function addDays(dateText: string, days: number) {
  const nextDate = new Date(`${dateText}T00:00:00`);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate.toISOString().slice(0, 10);
}

function getMoedLabel(moedNumber: number) {
  return `Moed ${String.fromCharCode(64 + moedNumber)}`;
}

function getIssueKey(issue: ValidationIssue): string {
  return [issue.code, issue.related_course_code ?? "", issue.related_date ?? "", issue.message].join("|");
}

function parseBoundedInteger(value: string, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function inferSemesterFromCourseCode(courseCode: string): number {
  const digits = courseCode.replace(/\D/g, "");
  if (!digits) {
    return 1;
  }

  const numericCode = Number(digits);
  if (!Number.isFinite(numericCode) || numericCode <= 0) {
    return 1;
  }

  if (numericCode >= 100 && numericCode < 200) {
    return 1;
  }

  if (numericCode >= 200 && numericCode < 300) {
    const suffix = numericCode % 10;
    return [0, 5, 6, 7, 8, 9].includes(suffix) ? 4 : 3;
  }

  if (numericCode >= 300 && numericCode < 400) {
    const suffix = numericCode % 10;
    return [0, 5, 6, 7, 8, 9].includes(suffix) ? 6 : 5;
  }

  if (numericCode >= 400 && numericCode < 500) {
    const suffix = numericCode % 10;
    return [0, 5, 6, 7, 8, 9].includes(suffix) ? 8 : 7;
  }

  return 1;
}

function buildMoedWindows(targetCount: number, currentWindows: MoedWindow[]) {
  const emptyWindow = createEmptyProject().moed_windows[0];
  const nextWindows: MoedWindow[] = [];

  for (let index = 0; index < targetCount; index += 1) {
    const existingWindow = currentWindows[index];
    if (existingWindow) {
      nextWindows.push({ ...existingWindow, moed_number: index + 1 });
      continue;
    }

    const previousWindow = nextWindows[index - 1];
    if (!previousWindow) {
      nextWindows.push({ ...emptyWindow, moed_number: 1 });
      continue;
    }

    const nextStart = addDays(previousWindow.end_date, 1);
    nextWindows.push({
      moed_number: index + 1,
      start_date: nextStart,
      end_date: addDays(nextStart, 30),
      same_semester_gap_days: previousWindow.same_semester_gap_days,
      prerequisite_gap_days: previousWindow.prerequisite_gap_days,
      high_failure_gap_days: previousWindow.high_failure_gap_days,
    });
  }

  return nextWindows;
}

function formatRangeLabel(range: DateRange | undefined) {
  if (!range?.from) {
    return "Pick date range";
  }
  if (!range.to) {
    return format(range.from, "PPP");
  }
  return `${format(range.from, "PPP")} - ${format(range.to, "PPP")}`;
}

function MultiSelectCombobox({
  options,
  values,
  placeholder,
  onChange,
}: {
  options: string[];
  values: string[];
  placeholder: string;
  onChange: (nextValues: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="w-full justify-between">
            <span className="truncate">{values.length > 0 ? `${values.length} selected` : placeholder}</span>
            <ChevronsUpDown className="h-4 w-4 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
          <Command>
            <CommandInput placeholder="Search course code..." />
            <CommandList>
              <CommandEmpty>No course found.</CommandEmpty>
              <CommandGroup>
                {options.map((option) => {
                  const selected = values.includes(option);
                  return (
                    <CommandItem
                      key={option}
                      value={option}
                      onSelect={() => {
                        onChange(selected ? values.filter((value) => value !== option) : [...values, option]);
                      }}
                    >
                      <Check className={cn("mr-2 h-4 w-4", selected ? "opacity-100" : "opacity-0")} />
                      {option}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {values.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {values.map((value) => (
            <Badge key={value} variant="secondary" className="gap-1">
              {value}
              <button
                type="button"
                aria-label={`Remove ${value}`}
                onClick={() => onChange(values.filter((entry) => entry !== value))}
                className="rounded px-1 text-slate-500 hover:bg-slate-200"
              >
                x
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SingleSelectCombobox({
  value,
  placeholder,
  options,
  onChange,
}: {
  value: CourseDepartment;
  placeholder: string;
  options: Array<{ label: string; value: CourseDepartment }>;
  onChange: (next: CourseDepartment) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeLabel = options.find((option) => option.value === value)?.label ?? placeholder;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between">
          {activeLabel}
          <ChevronsUpDown className="h-4 w-4 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="Filter department..." />
          <CommandList>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.label}
                  value={option.label}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === option.value ? "opacity-100" : "opacity-0")} />
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function App() {
  const [project, setProject] = useState<ScheduleProject>(() => loadProject());
  const [collapsedYears, setCollapsedYears] = useState<Record<string, boolean>>({});
  const [busyAction, setBusyAction] = useState<"validate" | "solve" | "manual-move" | "import-courses" | null>(null);
  const [setupStatus, setSetupStatus] = useState("Draft in progress.");
  const [actionStatus, setActionStatus] = useState("Ready.");
  const [collapsedSidebar, setCollapsedSidebar] = useState(false);
  const [activeRoute, setActiveRoute] = useState<AppRoute>("setup");
  const [activeStep, setActiveStep] = useState<SetupStep>("setup");
  const [selectedScheduleSolutionId, setSelectedScheduleSolutionId] = useState<string | null>(null);
  const [selectedScheduleMoedNumber, setSelectedScheduleMoedNumber] = useState<number>(1);
  const [selectedScheduleExamKey, setSelectedScheduleExamKey] = useState<string | null>(null);
  const [selectedSchedulePreviewDate, setSelectedSchedulePreviewDate] = useState<string | null>(null);
  const [scheduleDepartmentFilter, setScheduleDepartmentFilter] = useState<"all" | "sw" | "is">("all");
  const [excludedDraftRange, setExcludedDraftRange] = useState<DateRange | undefined>();
  const [excludedReason, setExcludedReason] = useState("");
  const [fixedDraft, setFixedDraft] = useState<FixedDraft>({
    course_code: "",
    course_name: "",
    exam_date: "",
    department: null,
    prerequisite_course_codes: [],
  });
  const [courseDraft, setCourseDraft] = useState<CourseDraft>({
    course_code: "",
    course_name: "",
    semester_number: 1,
    high_failure_rate: false,
    department: null,
    prerequisite_course_codes: [],
  });
  const [editingCourseIndex, setEditingCourseIndex] = useState<number | null>(null);
  const [solveAbortController, setSolveAbortController] = useState<AbortController | null>(null);
  const [schedulePreviewResponses, setSchedulePreviewResponses] = useState<Record<string, PreviewResponse>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showConflictDrawer, setShowConflictDrawer] = useState(true);
  const [activeConflict, setActiveConflict] = useState<ValidationIssue | null>(null);
  const [authUserId, setAuthUserId] = useState<string | null>(() => getStoredAuthUserId());
  const [remoteSavedSetups, setRemoteSavedSetups] = useState<RemoteSavedSetupSummary[]>([]);

  const isSolveInProgress = busyAction === "solve";

  useEffect(() => {
    saveProject(project);
  }, [project]);

  useEffect(() => {
    if (!getStoredAuthToken()) {
      return;
    }

    if (!authUserId) {
      setAuthUserId(getStoredAuthUserId());
    }

    void (async () => {
      try {
        const setups = await listRemoteSavedSetups();
        setRemoteSavedSetups(setups);
      } catch {
        setActionStatus("Saved setup service is unavailable or not authenticated.");
      }
    })();
  }, [authUserId]);

  const remoteSetupsByYear = useMemo(() => {
    return remoteSavedSetups.reduce<Record<string, RemoteSavedSetupSummary[]>>((groups, setup) => {
      const yearKey = String(setup.year);
      if (!groups[yearKey]) {
        groups[yearKey] = [];
      }
      groups[yearKey].push(setup);
      return groups;
    }, {});
  }, [remoteSavedSetups]);

  const sortedRemoteYears = useMemo(
    () => Object.keys(remoteSetupsByYear).sort((left, right) => Number(right) - Number(left)),
    [remoteSetupsByYear],
  );

  const allCourseCodes = useMemo(
    () => Array.from(new Set(project.courses.map((course) => course.course_code))).sort(),
    [project.courses],
  );

  const selectedScheduleSolution = useMemo(
    () => project.solutions.find((solution) => solution.solution_id === selectedScheduleSolutionId) ?? project.solutions[0] ?? null,
    [project.solutions, selectedScheduleSolutionId],
  );
  const selectedScheduleExam = useMemo(
    () =>
      selectedScheduleSolution && selectedScheduleExamKey
        ? selectedScheduleSolution.exams.find((exam) => getExamMoveKey(selectedScheduleSolution.solution_id, exam.course_code, exam.moed_number) === selectedScheduleExamKey) ?? null
        : null,
    [selectedScheduleSolution, selectedScheduleExamKey],
  );

  const selectedScheduleOriginalDate = useMemo(() => {
    if (!selectedScheduleSolution || !selectedScheduleExam) {
      return null;
    }

    return (
      selectedScheduleSolution.original_exams?.find(
        (exam) => exam.course_code === selectedScheduleExam.course_code && exam.moed_number === selectedScheduleExam.moed_number,
      )?.exam_date ?? selectedScheduleExam.exam_date
    );
  }, [selectedScheduleExam, selectedScheduleSolution]);

  const courseByCode = useMemo(() => {
    const map = Object.fromEntries(project.courses.map((course) => [course.course_code, course])) as Record<string, CourseInput>;
    if (Object.keys(map).length > 0) {
      return map;
    }

    for (const solution of project.solutions) {
      for (const exam of solution.exams) {
        if (map[exam.course_code]) {
          continue;
        }

        map[exam.course_code] = {
          course_code: exam.course_code,
          course_name: exam.course_code,
          semester_number: inferSemesterFromCourseCode(exam.course_code),
          high_failure_rate: false,
          department: null,
          prerequisite_course_codes: [],
        };
      }
    }

    return map;
  }, [project.courses, project.solutions]);

  const courseNameByCode = useMemo(
    () => Object.fromEntries(Object.values(courseByCode).map((course) => [course.course_code, course.course_name])),
    [courseByCode],
  );

  const scheduleSemesterRows = useMemo(
    () => Array.from(new Set(Object.values(courseByCode).map((course) => course.semester_number))).sort((left, right) => left - right),
    [courseByCode],
  );

  const scheduleCalendarDays = useMemo(
    () => buildCalendarDays(project, selectedScheduleMoedNumber),
    [project, selectedScheduleMoedNumber],
  );

  const selectedScheduleMoedWindow = useMemo(
    () => project.moed_windows.find((window) => window.moed_number === selectedScheduleMoedNumber) ?? null,
    [project.moed_windows, selectedScheduleMoedNumber],
  );

  const selectedScheduleConflictIssues = useMemo(() => {
    if (!selectedScheduleSolution || !selectedScheduleMoedWindow) {
      return [] as ValidationIssue[];
    }

    return selectedScheduleSolution.issues.filter((issue) => {
      if (issue.related_date) {
        return selectedScheduleMoedWindow.start_date <= issue.related_date && issue.related_date <= selectedScheduleMoedWindow.end_date;
      }

      if (!issue.related_course_code) {
        return true;
      }

      return selectedScheduleSolution.exams.some(
        (exam) =>
          exam.course_code === issue.related_course_code
          && exam.moed_number === selectedScheduleMoedNumber,
      );
    });
  }, [selectedScheduleMoedNumber, selectedScheduleMoedWindow, selectedScheduleSolution]);

  useEffect(() => {
    if (project.solutions.length === 0) {
      setSelectedScheduleSolutionId(null);
      setSelectedScheduleExamKey(null);
      setSelectedSchedulePreviewDate(null);
      return;
    }

    if (!selectedScheduleSolutionId || !project.solutions.some((solution) => solution.solution_id === selectedScheduleSolutionId)) {
      setSelectedScheduleSolutionId(project.solutions[0].solution_id);
    }
  }, [project.solutions, selectedScheduleSolutionId]);

  useEffect(() => {
    if (selectedScheduleExam && selectedScheduleExam.moed_number !== selectedScheduleMoedNumber) {
      setSelectedScheduleExamKey(null);
      setSelectedSchedulePreviewDate(null);
    }
  }, [selectedScheduleExam, selectedScheduleMoedNumber]);

  useEffect(() => {
    const availableMoeds = project.moed_windows.map((window) => window.moed_number);
    if (!availableMoeds.includes(selectedScheduleMoedNumber)) {
      setSelectedScheduleMoedNumber(availableMoeds[0] ?? 1);
    }
  }, [project.moed_windows, selectedScheduleMoedNumber]);

  useEffect(() => {
    setSchedulePreviewResponses({});
    if (!selectedScheduleExam) {
      setSelectedSchedulePreviewDate(null);
      return;
    }
    setSelectedSchedulePreviewDate(selectedScheduleExam.exam_date);
  }, [selectedScheduleExam?.course_code, selectedScheduleExam?.moed_number, selectedScheduleExam?.exam_date]);

  useEffect(() => {
    if (selectedScheduleConflictIssues.length === 0) {
      setActiveConflict(null);
      return;
    }

    if (activeConflict && selectedScheduleConflictIssues.some((issue) => getIssueKey(issue) === getIssueKey(activeConflict))) {
      return;
    }

    setActiveConflict(selectedScheduleConflictIssues[0]);
  }, [activeConflict, selectedScheduleConflictIssues]);

  useEffect(() => {
    if (!selectedScheduleSolution || !selectedScheduleExam || busyAction === "solve") {
      return;
    }

    const selectedCourse = courseByCode[selectedScheduleExam.course_code];
    if (!selectedCourse) {
      return;
    }

    const targetDates = scheduleCalendarDays.filter((dateText) => dateText !== selectedScheduleExam.exam_date);
    if (targetDates.length === 0) {
      return;
    }

    const abortController = new AbortController();
    setPreviewLoading(true);

    void (async () => {
      const previewEntries = await Promise.all(
        targetDates.map(async (dateText) => {
          const key = getPreviewKey(
            selectedScheduleSolution.solution_id,
            selectedScheduleExam.course_code,
            selectedScheduleExam.moed_number,
            dateText,
          );

          try {
            const response = await explainMoveProject(
              project,
              selectedScheduleSolution.solution_id,
              selectedScheduleExam.course_code,
              selectedScheduleExam.moed_number,
              dateText,
            );
            return [key, response as PreviewResponse] as const;
          } catch {
            return null;
          }
        }),
      );

      if (abortController.signal.aborted) {
        return;
      }

      setSchedulePreviewResponses(Object.fromEntries(previewEntries.filter((entry): entry is readonly [string, PreviewResponse] => entry !== null)));
      setPreviewLoading(false);
    })();

    return () => {
      abortController.abort();
      setPreviewLoading(false);
    };
  }, [
    busyAction,
    courseByCode,
    project,
    scheduleCalendarDays,
    selectedScheduleExam,
    selectedScheduleSolution,
  ]);

  const completion = useMemo(() => {
    const checks = [
      Boolean(project.project_name.trim().length > 0 && project.moed_windows.length > 0),
      project.excluded_ranges.length > 0,
      project.fixed_exams.length > 0,
      project.courses.length > 0,
    ];
    const done = checks.filter(Boolean).length;
    return {
      done,
      total: checks.length,
      percentage: Math.round((done / checks.length) * 100),
    };
  }, [project]);

  const sidebarItems = useMemo(
    () => [
      {
        key: "setup",
        title: "Setup",
        icon: FolderKanban,
        complete: completion.done === completion.total,
        children: [
          {
            key: "setup",
            title: "Initial Setup",
            icon: Sparkles,
            complete: Boolean(project.project_name.trim().length > 0 && project.moed_windows.length > 0),
          },
          {
            key: "excluded",
            title: "Excluded Dates",
            icon: CalendarDays,
            complete: project.excluded_ranges.length > 0,
          },
          {
            key: "fixed",
            title: "Fixed Exams",
            icon: Lock,
            complete: project.fixed_exams.length > 0,
          },
          {
            key: "courses",
            title: "Courses",
            icon: BookOpen,
            complete: project.courses.length > 0,
          },
        ],
      },
      {
        key: "schedule",
        title: "Schedule",
        icon: CalendarCheck,
        complete: project.solutions.length > 0,
        disabled: project.solutions.length === 0,
      },
    ],
    [completion.done, completion.total, project.courses.length, project.excluded_ranges.length, project.fixed_exams.length, project.project_name, project.moed_windows.length, project.solutions.length],
  );

  const courseColumns = useMemo<ColumnDef<CourseInput>[]>(
    () => [
      {
        accessorKey: "course_code",
        header: ({ column }) => (
          <Button type="button" variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>Code <ArrowUpDown className="h-3.5 w-3.5" /></Button>
        ),
      },
      {
        accessorKey: "course_name",
        header: ({ column }) => (
          <Button type="button" variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>Name <ArrowUpDown className="h-3.5 w-3.5" /></Button>
        ),
      },
      {
        accessorKey: "semester_number",
        header: "Semester",
      },
      {
        accessorKey: "department",
        header: "Department",
        cell: ({ row }) => row.original.department ?? "ALL",
      },
      {
        accessorKey: "high_failure_rate",
        header: "High Failure",
        cell: ({ row }) =>
          row.original.high_failure_rate ? (
            <Badge variant="destructive" className="bg-red-100 text-red-700">Yes</Badge>
          ) : (
            <Badge variant="secondary">No</Badge>
          ),
      },
      {
        accessorKey: "prerequisite_course_codes",
        header: "Prerequisites",
        cell: ({ row }) => (row.original.prerequisite_course_codes.length > 0 ? row.original.prerequisite_course_codes.join(", ") : "-"),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="opacity-70 hover:opacity-100">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  const index = project.courses.findIndex((course) => course.course_code === row.original.course_code && course.course_name === row.original.course_name);
                  if (index >= 0) {
                    setEditingCourseIndex(index);
                    setCourseDraft({ ...project.courses[index] });
                    setActiveRoute("setup");
                    setActiveStep("courses");
                  }
                }}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-red-600 focus:text-red-700"
                onSelect={() => {
                  if (isSolveInProgress) {
                    return;
                  }
                  setProject((current) => ({
                    ...current,
                    courses: current.courses.filter((course) => !(course.course_code === row.original.course_code && course.course_name === row.original.course_name)),
                    solutions: [],
                    issues: [],
                  }));
                }}
              >
                <Trash className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [isSolveInProgress, project.courses],
  );

  function patchProject(patch: Partial<ScheduleProject>) {
    if (isSolveInProgress) {
      setActionStatus("Cannot edit setup while generating solutions. Terminate generation first.");
      return;
    }
    setProject((current) => ({ ...current, ...patch, solutions: [], issues: [] }));
    setSetupStatus("Setup changes saved locally.");
  }

  async function handleLogin() {
    const userId = window.prompt("User ID", "orad")?.trim();
    if (!userId) {
      return;
    }

    const password = window.prompt("Password", "") ?? "";
    if (!password) {
      return;
    }

    try {
      const response = await loginToBackend(userId, password);
      setAuthUserId(response.user_id);
      const setups = await listRemoteSavedSetups();
      setRemoteSavedSetups(setups);
      setActionStatus(`Authenticated as ${response.user_id}.`);
    } catch (error) {
      setActionStatus(formatApiErrorMessage(error, "Login failed."));
    }
  }

  async function refreshRemoteSavedSetups() {
    try {
      const setups = await listRemoteSavedSetups();
      setRemoteSavedSetups(setups);
    } catch (error) {
      setActionStatus(formatApiErrorMessage(error, "Failed to refresh saved setups."));
    }
  }

  async function handleSaveSetupToDatabase() {
    try {
      const saved = await saveRemoteSetup(project, project.remote_setup_id, selectedScheduleSolutionId ?? null);
      setProject((current) => ({ ...current, remote_setup_id: saved.setup_id }));
      await refreshRemoteSavedSetups();
      setActionStatus(`Saved setup '${saved.project_name}' to database.`);
    } catch (error) {
      setActionStatus(formatApiErrorMessage(error, "Failed to save setup to database."));
    }
  }

  async function handleLoadSetupFromDatabase(setupId: string) {
    if (isSolveInProgress) {
      setActionStatus("Cannot load setup while generation is running.");
      return;
    }

    try {
      const payload = await loadRemoteSetup(setupId);
      setProject({
        ...payload.project,
        remote_setup_id: payload.metadata.setup_id,
      });
      setActiveRoute("setup");
      setActiveStep("setup");
      setActionStatus(`Loaded '${payload.metadata.project_name}' from database.`);
    } catch (error) {
      setActionStatus(formatApiErrorMessage(error, "Failed to load setup from database."));
    }
  }

  async function handleDeleteSetupFromDatabase(setupId: string) {
    try {
      await deleteRemoteSetup(setupId);
      if (project.remote_setup_id === setupId) {
        setProject((current) => ({ ...current, remote_setup_id: null }));
      }
      await refreshRemoteSavedSetups();
      setActionStatus("Deleted setup from database.");
    } catch (error) {
      setActionStatus(formatApiErrorMessage(error, "Failed to delete setup from database."));
    }
  }

  function promptImportMode(): ImportMode | null {
    const selected = window.prompt(
      "Import mode? Type one: replace | append | merge",
      "replace",
    )?.trim().toLowerCase();

    if (!selected) {
      return null;
    }
    if (selected === "replace" || selected === "append" || selected === "merge") {
      return selected;
    }

    setActionStatus("Invalid import mode. Use replace, append, or merge.");
    return null;
  }

  function promptRemoteSetupSelection(actionLabel: string): string | null {
    if (remoteSavedSetups.length === 0) {
      setActionStatus("No remote saved setups available.");
      return null;
    }

    const optionsText = remoteSavedSetups
      .map((setup, index) => `${index + 1}. ${setup.project_name} (${setup.year})`)
      .join("\n");

    const rawSelection = window.prompt(`${actionLabel}\n${optionsText}\n\nType setup number:`, "1")?.trim();
    if (!rawSelection) {
      return null;
    }

    const index = Number(rawSelection) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= remoteSavedSetups.length) {
      setActionStatus("Invalid setup selection.");
      return null;
    }

    return remoteSavedSetups[index].setup_id;
  }

  function applyCoursesImportMode(existing: CourseInput[], incoming: CourseInput[], mode: ImportMode): CourseInput[] {
    if (mode === "replace") {
      return incoming;
    }
    if (mode === "append") {
      return [...existing, ...incoming];
    }

    const merged = new Map(existing.map((course) => [course.course_code, course]));
    for (const course of incoming) {
      merged.set(course.course_code, course);
    }
    return Array.from(merged.values());
  }

  function applyFixedExamsImportMode(existing: FixedExam[], incoming: FixedExam[], mode: ImportMode): FixedExam[] {
    if (mode === "replace") {
      return incoming;
    }
    if (mode === "append") {
      return [...existing, ...incoming];
    }

    const merged = new Map(existing.map((exam) => [exam.course_code, exam]));
    for (const exam of incoming) {
      merged.set(exam.course_code, exam);
    }
    return Array.from(merged.values());
  }

  async function handleImportCoursesFromSavedSetup() {
    const setupId = promptRemoteSetupSelection("Select saved setup to import courses from");
    if (!setupId) {
      return;
    }

    const mode = promptImportMode();
    if (!mode) {
      return;
    }

    try {
      const incomingCourses = await loadRemoteSetupCourses(setupId);
      const nextCourses = applyCoursesImportMode(project.courses, incomingCourses, mode);
      patchProject({ courses: nextCourses });
      setActionStatus(`Imported ${incomingCourses.length} courses using ${mode} mode.`);
    } catch (error) {
      setActionStatus(formatApiErrorMessage(error, "Failed to import courses from saved setup."));
    }
  }

  async function handleImportFixedExamsFromSavedSetup() {
    const setupId = promptRemoteSetupSelection("Select saved setup to import fixed exams from");
    if (!setupId) {
      return;
    }

    const mode = promptImportMode();
    if (!mode) {
      return;
    }

    try {
      const incomingFixedExams = await loadRemoteSetupFixedExams(setupId);
      const nextFixedExams = applyFixedExamsImportMode(project.fixed_exams, incomingFixedExams, mode);
      patchProject({ fixed_exams: nextFixedExams });
      setActionStatus(`Imported ${incomingFixedExams.length} fixed exams using ${mode} mode.`);
    } catch (error) {
      setActionStatus(formatApiErrorMessage(error, "Failed to import fixed exams from saved setup."));
    }
  }

  async function handleSaveSelectedSolutionToDatabase() {
    if (!project.remote_setup_id) {
      setActionStatus("Save this setup to database first.");
      return;
    }
    if (!selectedScheduleSolutionId) {
      setActionStatus("Select a solution before saving solution updates.");
      return;
    }

    try {
      await updateRemoteSetupSolutions(project.remote_setup_id, project.solutions, selectedScheduleSolutionId);
      await refreshRemoteSavedSetups();
      setActionStatus("Saved solution updates to database.");
    } catch (error) {
      setActionStatus(formatApiErrorMessage(error, "Failed to save solution updates."));
    }
  }

  async function handleValidate() {
    setBusyAction("validate");
    setActionStatus("Checking project rules...");
    try {
      const validatedProject = await validateProject(project);
      setProject(validatedProject);
      setActionStatus("Validation finished.");
    } catch (error) {
      setActionStatus(formatApiErrorMessage(error, "Validation failed."));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSolve() {
    const abortController = new AbortController();
    setBusyAction("solve");
    setSolveAbortController(abortController);
    setActionStatus("Generating schedule options...");
    try {
      const solved = await solveProject(project, { signal: abortController.signal });
      const solutions = solved.solutions as ScheduleProject["solutions"];
      const solveIssues = solved.issues as ValidationIssue[];
      setProject((current) => ({
        ...current,
        solutions,
        issues: solveIssues,
      }));
      if (solutions.length > 0) {
        setActiveRoute("schedule");
        setActionStatus(`Generated ${solutions.length} option(s).`);
      } else {
        const issueMessages = Array.from(
          new Set(
            solveIssues
              .map((issue) => issue.message.trim())
              .filter((message) => message.length > 0),
          ),
        );
        const reasonText = issueMessages.length > 0
          ? issueMessages.join(" | ")
          : "No feasible schedule was found for the current constraints.";
        setActionStatus(`No options generated. ${reasonText}`);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setActionStatus("Generation terminated.");
      } else {
        setActionStatus(formatApiErrorMessage(error, "Solve failed."));
      }
    } finally {
      setBusyAction(null);
      setSolveAbortController(null);
    }
  }

  function handleTerminateSolve() {
    solveAbortController?.abort();
  }

  async function handleManualMove(exam: { course_code: string; moed_number: number; exam_date: string }, nextDate: string) {
    if (!selectedScheduleSolution) {
      return;
    }

    setBusyAction("manual-move");
    setActionStatus(`Moving ${exam.course_code} to ${formatDisplayDate(nextDate)}...`);

    try {
      const response = await manualMoveProject(project, selectedScheduleSolution.solution_id, exam.course_code, exam.moed_number, nextDate);
      if (!response.updated_solution) {
        const issueText = response.issues.map((issue) => issue.message).join(" | ");
        setActionStatus(issueText || "Manual move could not be applied.");
        return;
      }

      setProject((current) => ({
        ...current,
        solutions: current.solutions.map((solution) =>
          solution.solution_id === response.updated_solution?.solution_id
            ? {
                ...solution,
                score: response.updated_solution.score,
                exams: response.updated_solution.exams,
                diagnostics: response.updated_solution.diagnostics,
                issues: response.issues,
              }
            : solution,
        ),
        issues: response.issues,
      }));

      setSelectedSchedulePreviewDate(nextDate);
      setSchedulePreviewResponses({});
      setActionStatus(`Moved ${exam.course_code} to ${formatDisplayDate(nextDate)}.`);
    } catch (error) {
      setActionStatus(formatApiErrorMessage(error, "Manual move failed."));
    } finally {
      setBusyAction(null);
    }
  }

  function openCourseEditorFromExam(exam: { course_code: string }) {
    const index = project.courses.findIndex((course) => course.course_code === exam.course_code);
    const fallback = courseByCode[exam.course_code];

    if (index >= 0) {
      setEditingCourseIndex(index);
      setCourseDraft({ ...project.courses[index] });
    } else {
      setEditingCourseIndex(null);
      setCourseDraft({
        course_code: exam.course_code,
        course_name: fallback?.course_name ?? exam.course_code,
        semester_number: fallback?.semester_number ?? 1,
        high_failure_rate: fallback?.high_failure_rate ?? false,
        department: fallback?.department ?? null,
        prerequisite_course_codes: fallback?.prerequisite_course_codes ?? [],
      });
    }

    setActiveRoute("setup");
    setActiveStep("courses");
    setSetupStatus(`Editing course ${exam.course_code}.`);
  }

  function lockExamFromCalendar(exam: { course_code: string; exam_date: string }) {
    if (isSolveInProgress) {
      return;
    }

    const course = courseByCode[exam.course_code];
    const lockedExam: FixedExam = {
      course_code: exam.course_code,
      course_name: course?.course_name ?? exam.course_code,
      exam_date: exam.exam_date,
      locked: true,
      department: course?.department ?? null,
      prerequisite_course_codes: course?.prerequisite_course_codes ?? [],
    };

    setProject((current) => ({
      ...current,
      fixed_exams: [...current.fixed_exams.filter((fixedExam) => fixedExam.course_code !== exam.course_code), lockedExam],
    }));
    setActionStatus(`Locked ${exam.course_code} on ${formatDisplayDate(exam.exam_date)}.`);
  }

  function unlockExamFromCalendar(exam: { course_code: string }) {
    if (isSolveInProgress) {
      return;
    }

    setProject((current) => ({
      ...current,
      fixed_exams: current.fixed_exams.filter((fixedExam) => fixedExam.course_code !== exam.course_code),
    }));
    setActionStatus(`Unlocked ${exam.course_code}.`);
  }

  function editExamDateFromCalendar(exam: { course_code: string; moed_number: number; exam_date: string }) {
    if (isSolveInProgress) {
      return;
    }

    const nextDateInput = window.prompt(`Enter new date for ${exam.course_code} (DD-MM-YYYY):`, formatDisplayDate(exam.exam_date))?.trim();
    if (!nextDateInput) {
      return;
    }

    const normalized = /^\d{2}-\d{2}-\d{4}$/.test(nextDateInput)
      ? `${nextDateInput.slice(6, 10)}-${nextDateInput.slice(3, 5)}-${nextDateInput.slice(0, 2)}`
      : nextDateInput;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || normalized === exam.exam_date) {
      return;
    }

    void handleManualMove(exam, normalized);
  }

  function isExamLocked(exam: { course_code: string; exam_date: string }) {
    return project.fixed_exams.some((fixedExam) => fixedExam.course_code === exam.course_code && fixedExam.exam_date === exam.exam_date);
  }

  async function handleCourseImport(file: File) {
    setBusyAction("import-courses");
    setActionStatus(`Importing courses from ${file.name}...`);

    try {
      const result: CourseImportResponse = await importCoursesSpreadsheet(file);
      patchProject({ courses: result.courses, fixed_exams: result.fixed_exams });
      setActionStatus(
        `Imported ${result.imported_count} course(s) and ${result.fixed_exams_imported_count} fixed exam(s) from ${file.name}.`,
      );
    } catch (error) {
      if (Array.isArray(error)) {
        setActionStatus((error as ValidationIssue[]).map((issue) => issue.message).join(" | "));
      } else {
        setActionStatus(formatApiErrorMessage(error, "Course import failed."));
      }
    } finally {
      setBusyAction(null);
    }
  }

  async function handleTemplateDownload() {
    setActionStatus("Downloading template...");

    try {
      const blob = await downloadCourseTemplate();
      const objectUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = objectUrl;
      anchor.download = "course-import-template.xlsx";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(objectUrl);

      setActionStatus("Template downloaded.");
    } catch (error) {
      setActionStatus(formatApiErrorMessage(error, "Course template download failed."));
    }
  }

  function addExcludedRange() {
    if (!excludedDraftRange?.from || !excludedDraftRange.to || excludedReason.trim().length === 0) {
      setActionStatus("Select a date range and reason before adding an excluded range.");
      return;
    }

    const nextRange: ExcludedDateRange = {
      start_date: format(excludedDraftRange.from, "yyyy-MM-dd"),
      end_date: format(excludedDraftRange.to, "yyyy-MM-dd"),
      reason: excludedReason.trim(),
    };

    patchProject({ excluded_ranges: [...project.excluded_ranges, nextRange] });
    setExcludedDraftRange(undefined);
    setExcludedReason("");
  }

  function addFixedExam() {
    if (!fixedDraft.course_code.trim() || !fixedDraft.course_name.trim() || !fixedDraft.exam_date) {
      setActionStatus("Course code, name, and exam date are required for fixed exams.");
      return;
    }

    const nextFixedExam: FixedExam = {
      ...fixedDraft,
      course_code: fixedDraft.course_code.trim(),
      course_name: fixedDraft.course_name.trim(),
      locked: true,
    };

    patchProject({ fixed_exams: [...project.fixed_exams, nextFixedExam] });
    setFixedDraft({
      course_code: "",
      course_name: "",
      exam_date: "",
      department: null,
      prerequisite_course_codes: [],
    });
  }

  function saveCourseDraft() {
    if (!courseDraft.course_code.trim() || !courseDraft.course_name.trim()) {
      setActionStatus("Course code and course name are required.");
      return;
    }

    if (editingCourseIndex === null) {
      patchProject({ courses: [...project.courses, { ...courseDraft, course_code: courseDraft.course_code.trim(), course_name: courseDraft.course_name.trim() }] });
    } else {
      patchProject({
        courses: project.courses.map((course, index) => (index === editingCourseIndex ? { ...courseDraft } : course)),
      });
    }

    setEditingCourseIndex(null);
    setCourseDraft({
      course_code: "",
      course_name: "",
      semester_number: 1,
      high_failure_rate: false,
      department: null,
      prerequisite_course_codes: [],
    });
  }

  function handleNewSetup() {
    if (isSolveInProgress) {
      setActionStatus("Cannot reset while generation is running.");
      return;
    }

    const emptyProject = createEmptyProject();
    setProject(emptyProject);
    setActiveRoute("setup");
    setActiveStep("setup");

    setEditingCourseIndex(null);
    setExcludedDraftRange(undefined);
    setExcludedReason("");
    setFixedDraft({
      course_code: "",
      course_name: "",
      exam_date: "",
      department: null,
      prerequisite_course_codes: [],
    });
    setCourseDraft({
      course_code: "",
      course_name: "",
      semester_number: 1,
      high_failure_rate: false,
      department: null,
      prerequisite_course_codes: [],
    });

    setSelectedScheduleSolutionId(null);
    setSelectedScheduleMoedNumber(1);
    setSelectedScheduleExamKey(null);
    setSelectedSchedulePreviewDate(null);
    setSchedulePreviewResponses({});
    setActiveConflict(null);

    setSetupStatus("Started a new setup draft.");
    setActionStatus("New setup created.");
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <Sidebar
        collapsed={collapsedSidebar}
        title="Exam Optimizer"
        subtitle="Workspace navigation"
        items={sidebarItems}
        active={activeRoute}
        activeChild={activeStep}
        onToggle={() => setCollapsedSidebar((current) => !current)}
        onSelect={(key) => {
          if (!isSolveInProgress) {
            setActiveRoute(key as AppRoute);
          }
        }}
        onSelectChild={(key) => {
          if (isSolveInProgress) {
            return;
          }
          setActiveRoute("setup");
          setActiveStep(key as SetupStep);
        }}
      />

      <div className={cn("relative overflow-x-hidden", collapsedSidebar ? "ml-20" : "ml-72")}>
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 p-6 pb-36">
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => void refreshRemoteSavedSetups()}>Refresh Saved Setups</Button>
            <Button type="button" variant="outline" onClick={() => void handleLogin()}>
              {authUserId ? `Logged in: ${authUserId}` : "Login"}
            </Button>
          </div>

          {activeRoute === "setup" ? (
            <fieldset disabled={isSolveInProgress} className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px] disabled:opacity-70">
              <div className="space-y-4">
                <Card className="border-slate-300/70 bg-white/80">
                  <CardContent className="p-4">
                    <div className="space-y-2">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Active workspace</p>
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-indigo-600" />
                        <p className="h-9 min-w-[240px] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700">
                          {project.project_name}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Tabs value={activeStep} onValueChange={(next) => setActiveStep(next as SetupStep)}>
                  <TabsContent value="setup" className="mt-0">
                    <Card>
                      <CardHeader className="flex flex-row items-start justify-between gap-3">
                        <div>
                          <CardTitle>Initial Setup</CardTitle>
                          <CardDescription>Define Moed windows and spacing constraints.</CardDescription>
                        </div>
                        <Button
                          type="button"
                          onClick={handleNewSetup}
                          className="bg-emerald-600 text-white transition-colors hover:bg-emerald-500"
                        >
                          New Setup
                        </Button>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        <Form className="grid gap-4 md:grid-cols-2">
                          <FormField>
                            <FormItem>
                              <Label>Project Name</Label>
                              <Input
                                value={project.project_name}
                                onChange={(event) => patchProject({ project_name: event.target.value })}
                                placeholder="Project name"
                              />
                            </FormItem>
                          </FormField>
                          <FormField>
                            <FormItem>
                              <Label>Moed Count</Label>
                              <Input
                                type="number"
                                min={1}
                                max={3}
                                value={project.moed_windows.length}
                                onChange={(event) => patchProject({ moed_windows: buildMoedWindows(Math.max(1, Math.min(3, Number(event.target.value) || 1)), project.moed_windows) })}
                              />
                            </FormItem>
                          </FormField>
                        </Form>

                        <div className="grid gap-4 xl:grid-cols-3">
                          {project.moed_windows.map((window, index) => (
                            <Card key={`moed-${window.moed_number}`} className="border-slate-200">
                              <CardHeader className="pb-3">
                                <CardTitle className="text-sm">{getMoedLabel(window.moed_number)}</CardTitle>
                              </CardHeader>
                              <CardContent className="space-y-3">
                                <FormItem>
                                  <Label>Start Date</Label>
                                  <Input
                                    type="date"
                                    value={window.start_date}
                                    onChange={(event) =>
                                      patchProject({
                                        moed_windows: project.moed_windows.map((candidate, candidateIndex) =>
                                          candidateIndex === index ? { ...candidate, start_date: event.target.value } : candidate,
                                        ),
                                      })
                                    }
                                  />
                                </FormItem>
                                <FormItem>
                                  <Label>End Date</Label>
                                  <Input
                                    type="date"
                                    value={window.end_date}
                                    onChange={(event) =>
                                      patchProject({
                                        moed_windows: project.moed_windows.map((candidate, candidateIndex) =>
                                          candidateIndex === index ? { ...candidate, end_date: event.target.value } : candidate,
                                        ),
                                      })
                                    }
                                  />
                                </FormItem>
                                <div className="space-y-2">
                                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Gaps (days)</p>
                                  <div className="grid grid-cols-3 gap-2">
                                  <FormItem>
                                    <Label className="text-xs">Same Sem</Label>
                                    <Input
                                      type="number"
                                      min={0}
                                      value={window.same_semester_gap_days}
                                      onChange={(event) =>
                                        patchProject({
                                          moed_windows: project.moed_windows.map((candidate, candidateIndex) =>
                                            candidateIndex === index
                                              ? {
                                                  ...candidate,
                                                  same_semester_gap_days: parseBoundedInteger(event.target.value, 0, 30, candidate.same_semester_gap_days),
                                                }
                                              : candidate,
                                          ),
                                        })
                                      }
                                    />
                                  </FormItem>
                                  <FormItem>
                                    <Label className="text-xs">Prereq</Label>
                                    <Input
                                      type="number"
                                      min={0}
                                      value={window.prerequisite_gap_days}
                                      onChange={(event) =>
                                        patchProject({
                                          moed_windows: project.moed_windows.map((candidate, candidateIndex) =>
                                            candidateIndex === index
                                              ? {
                                                  ...candidate,
                                                  prerequisite_gap_days: parseBoundedInteger(event.target.value, 0, 30, candidate.prerequisite_gap_days),
                                                }
                                              : candidate,
                                          ),
                                        })
                                      }
                                    />
                                  </FormItem>
                                  <FormItem>
                                    <Label className="text-xs">High Fail</Label>
                                    <Input
                                      type="number"
                                      min={0}
                                      value={window.high_failure_gap_days}
                                      onChange={(event) =>
                                        patchProject({
                                          moed_windows: project.moed_windows.map((candidate, candidateIndex) =>
                                            candidateIndex === index
                                              ? {
                                                  ...candidate,
                                                  high_failure_gap_days: parseBoundedInteger(event.target.value, 0, 30, candidate.high_failure_gap_days),
                                                }
                                              : candidate,
                                          ),
                                        })
                                      }
                                    />
                                  </FormItem>
                                </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="excluded" className="mt-0">
                    <Card>
                      <CardHeader>
                        <CardTitle>Excluded Dates</CardTitle>
                        <CardDescription>Block unavailable periods using an integrated date range picker.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        <Form className="grid gap-4 lg:grid-cols-[2fr_2fr_auto]">
                          <FormField>
                            <FormItem>
                              <Label>Date Range</Label>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button type="button" variant="outline" className="w-full justify-start text-left font-normal">
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {formatRangeLabel(excludedDraftRange)}
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                  <Calendar mode="range" selected={excludedDraftRange} onSelect={setExcludedDraftRange} numberOfMonths={2} />
                                </PopoverContent>
                              </Popover>
                            </FormItem>
                          </FormField>
                          <FormField>
                            <FormItem>
                              <Label>Reason</Label>
                              <Input value={excludedReason} onChange={(event) => setExcludedReason(event.target.value)} placeholder="Holiday, ceremony, maintenance..." />
                            </FormItem>
                          </FormField>
                          <div className="flex items-end">
                            <Button type="button" onClick={addExcludedRange}>Add Range</Button>
                          </div>
                        </Form>

                        <div className="grid gap-3">
                          {project.excluded_ranges.length === 0 ? <FormMessage>No excluded ranges added yet.</FormMessage> : null}
                          {project.excluded_ranges.map((range, index) => (
                            <div key={`${range.start_date}-${index}`} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                              <div>
                                <p className="text-sm font-medium">{formatDisplayDate(range.start_date)} to {formatDisplayDate(range.end_date)}</p>
                                <p className="text-xs text-slate-500">{range.reason}</p>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => patchProject({ excluded_ranges: project.excluded_ranges.filter((_, candidateIndex) => candidateIndex !== index) })}
                              >
                                <Trash className="h-4 w-4 text-red-600" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="fixed" className="mt-0">
                    <Card>
                      <CardHeader>
                        <CardTitle>Fixed Exams</CardTitle>
                        <CardDescription>Lock required exams with modern date and combobox inputs.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        <Form className="grid gap-4 lg:grid-cols-3">
                          <FormField>
                            <FormItem>
                              <Label>Course Code</Label>
                              <Input value={fixedDraft.course_code} onChange={(event) => setFixedDraft((current) => ({ ...current, course_code: event.target.value }))} />
                            </FormItem>
                          </FormField>
                          <FormField>
                            <FormItem>
                              <Label>Course Name</Label>
                              <Input value={fixedDraft.course_name} onChange={(event) => setFixedDraft((current) => ({ ...current, course_name: event.target.value }))} />
                            </FormItem>
                          </FormField>
                          <FormField>
                            <FormItem>
                              <Label>Exam Date</Label>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <Button type="button" variant="outline" className="w-full justify-start text-left font-normal">
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {fixedDraft.exam_date ? formatDisplayDate(fixedDraft.exam_date) : "Pick date"}
                                  </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                  <Calendar
                                    mode="single"
                                    selected={fixedDraft.exam_date ? new Date(`${fixedDraft.exam_date}T00:00:00`) : undefined}
                                    onSelect={(date) =>
                                      setFixedDraft((current) => ({
                                        ...current,
                                        exam_date: date ? format(date, "yyyy-MM-dd") : "",
                                      }))
                                    }
                                  />
                                </PopoverContent>
                              </Popover>
                            </FormItem>
                          </FormField>
                          <FormField className="lg:col-span-2">
                            <FormItem>
                              <Label>Prerequisite Course Codes</Label>
                              <MultiSelectCombobox
                                options={allCourseCodes}
                                values={fixedDraft.prerequisite_course_codes}
                                placeholder="Select prerequisites"
                                onChange={(nextValues) => setFixedDraft((current) => ({ ...current, prerequisite_course_codes: nextValues }))}
                              />
                            </FormItem>
                          </FormField>
                          <FormField>
                            <FormItem>
                              <Label>Department</Label>
                              <SingleSelectCombobox
                                value={fixedDraft.department}
                                placeholder="All departments"
                                options={[
                                  { label: "All departments", value: null },
                                  { label: "SW", value: "SW" },
                                  { label: "IS", value: "IS" },
                                ]}
                                onChange={(next) => setFixedDraft((current) => ({ ...current, department: next }))}
                              />
                            </FormItem>
                          </FormField>
                        </Form>

                        <div className="flex flex-wrap gap-2">
                          <Button type="button" onClick={addFixedExam}>Add Fixed Exam</Button>
                          <Button type="button" variant="secondary" onClick={() => void handleImportFixedExamsFromSavedSetup()}>
                            Import Fixed Exams From Saved Setup
                          </Button>
                        </div>

                        <div className="grid gap-3">
                          {project.fixed_exams.length === 0 ? <FormMessage>No fixed exams yet.</FormMessage> : null}
                          {project.fixed_exams.map((exam, index) => (
                            <div key={`${exam.course_code}-${index}`} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                              <div>
                                <p className="text-sm font-medium">{exam.course_code} - {exam.course_name}</p>
                                <p className="text-xs text-slate-500">{formatDisplayDate(exam.exam_date)} | Department: {exam.department ?? "ALL"} | Prerequisites: {exam.prerequisite_course_codes.join(", ") || "-"}</p>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => patchProject({ fixed_exams: project.fixed_exams.filter((_, candidateIndex) => candidateIndex !== index) })}
                              >
                                <Trash className="h-4 w-4 text-red-600" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  </TabsContent>

                  <TabsContent value="courses" className="mt-0">
                    <Card>
                      <CardHeader>
                        <CardTitle>Courses</CardTitle>
                        <CardDescription>High-density course data with search, sorting, pagination, and streamlined row actions.</CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button type="button" variant="secondary" onClick={() => void handleTemplateDownload()}>
                            Download Template
                          </Button>
                          <Button type="button" variant="secondary" onClick={() => void handleImportCoursesFromSavedSetup()}>
                            Import Courses From Saved Setup
                          </Button>
                          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50">
                            <span>{busyAction === "import-courses" ? "Importing..." : "Import Courses"}</span>
                            <input
                              type="file"
                              accept=".xlsx"
                              className="hidden"
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.currentTarget.value = "";
                                if (file) {
                                  void handleCourseImport(file);
                                }
                              }}
                            />
                          </label>
                        </div>
                        <p className="text-xs text-slate-500">
                          Note: keep or delete the EXAMPLE row in each sheet. Rows that start with EXAMPLE are ignored during import.
                        </p>

                        <Form className="grid gap-4 xl:grid-cols-6">
                          <FormField className="xl:col-span-1">
                            <FormItem>
                              <Label>Course Code</Label>
                              <Input value={courseDraft.course_code} onChange={(event) => setCourseDraft((current) => ({ ...current, course_code: event.target.value }))} />
                            </FormItem>
                          </FormField>
                          <FormField className="xl:col-span-2">
                            <FormItem>
                              <Label>Course Name</Label>
                              <Input value={courseDraft.course_name} onChange={(event) => setCourseDraft((current) => ({ ...current, course_name: event.target.value }))} />
                            </FormItem>
                          </FormField>
                          <FormField>
                            <FormItem>
                              <Label>Semester</Label>
                              <Input
                                type="number"
                                min={1}
                                max={8}
                                value={courseDraft.semester_number}
                                onChange={(event) => setCourseDraft((current) => ({ ...current, semester_number: Number(event.target.value) || 1 }))}
                              />
                            </FormItem>
                          </FormField>
                          <FormField>
                            <FormItem>
                              <Label>Department</Label>
                              <SingleSelectCombobox
                                value={courseDraft.department}
                                placeholder="All departments"
                                options={[
                                  { label: "All departments", value: null },
                                  { label: "SW", value: "SW" },
                                  { label: "IS", value: "IS" },
                                ]}
                                onChange={(next) => setCourseDraft((current) => ({ ...current, department: next }))}
                              />
                            </FormItem>
                          </FormField>
                          <FormField>
                            <FormItem>
                              <Label>High Failure</Label>
                              <Button
                                type="button"
                                variant={courseDraft.high_failure_rate ? "destructive" : "secondary"}
                                onClick={() => setCourseDraft((current) => ({ ...current, high_failure_rate: !current.high_failure_rate }))}
                                className="w-full"
                              >
                                {courseDraft.high_failure_rate ? "Yes" : "No"}
                              </Button>
                            </FormItem>
                          </FormField>
                          <FormField className="xl:col-span-5">
                            <FormItem>
                              <Label>Prerequisite Course Codes</Label>
                              <MultiSelectCombobox
                                options={allCourseCodes}
                                values={courseDraft.prerequisite_course_codes}
                                placeholder="Select prerequisites"
                                onChange={(nextValues) => setCourseDraft((current) => ({ ...current, prerequisite_course_codes: nextValues }))}
                              />
                            </FormItem>
                          </FormField>
                          <div className="space-y-2 xl:col-span-1">
                            <Label className="invisible">Actions</Label>
                            <div className="flex items-end gap-2">
                              <Button type="button" onClick={saveCourseDraft}>{editingCourseIndex === null ? "Add Course" : "Update Course"}</Button>
                            {editingCourseIndex !== null ? (
                              <Button
                                type="button"
                                variant="secondary"
                                onClick={() => {
                                  setEditingCourseIndex(null);
                                  setCourseDraft({
                                    course_code: "",
                                    course_name: "",
                                    semester_number: 1,
                                    high_failure_rate: false,
                                    department: null,
                                    prerequisite_course_codes: [],
                                  });
                                }}
                              >
                                Cancel
                              </Button>
                            ) : null}
                            </div>
                          </div>
                        </Form>

                        <DataTable
                          columns={courseColumns}
                          data={project.courses}
                          searchPlaceholder="Search code, name, prerequisite..."
                          actionBarSelector="#action-controls"
                        />
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              </div>

              <div className="space-y-4">
                <Card className="border-slate-300/70 bg-white/80">
                  <CardContent className="p-4">
                    <div className="min-w-[230px] space-y-2">
                      <div className="flex items-center justify-between text-sm text-slate-600">
                        <span>Completion</span>
                        <span>{completion.percentage}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-200">
                        <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${completion.percentage}%` }} />
                      </div>
                      <p className="text-xs text-slate-500">{completion.done} of {completion.total} setup stages completed</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-slate-300 bg-violet-50/60">
                  <CardHeader className="pb-2">
                    <CardTitle>Current Entry</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="rounded-lg border border-slate-200 bg-white/60 p-3">
                      <p className="text-xs uppercase text-slate-500">Workspace status</p>
                      <p className="font-semibold text-indigo-900">{setupStatus}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      <div className="rounded border border-slate-200 bg-white p-2">
                        <p className="text-xs text-slate-500">Year folder</p>
                        <p className="font-medium">{project.moed_windows[0]?.start_date.slice(0, 4) || "-"}</p>
                      </div>
                      <div className="rounded border border-slate-200 bg-white p-2">
                        <p className="text-xs text-slate-500">Saved setups</p>
                        <p className="font-medium">{remoteSavedSetups.length}</p>
                      </div>
                      <div className="rounded border border-slate-200 bg-white p-2">
                        <p className="text-xs text-slate-500">Courses</p>
                        <p className="font-medium">{project.courses.length}</p>
                      </div>
                      <div className="rounded border border-slate-200 bg-white p-2">
                        <p className="text-xs text-slate-500">Solutions</p>
                        <p className="font-medium">{project.solutions.length}</p>
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Button type="button" className="w-full" onClick={() => void handleSaveSetupToDatabase()}>
                        Save Setup In Database Year Folder
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle>Saved Setups (Database)</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {sortedRemoteYears.length === 0 ? <FormMessage>No database saved setups yet.</FormMessage> : null}
                    {sortedRemoteYears.map((yearKey) => (
                      <div key={yearKey} className="rounded-lg border border-slate-200">
                        <button
                          type="button"
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm"
                          onClick={() => setCollapsedYears((current) => ({ ...current, [yearKey]: !(current[yearKey] ?? false) }))}
                        >
                          <span>{yearKey}</span>
                          <span>{remoteSetupsByYear[yearKey].length} setup{remoteSetupsByYear[yearKey].length === 1 ? "" : "s"} {collapsedYears[yearKey] ? "+" : "-"}</span>
                        </button>
                        {!collapsedYears[yearKey]
                          ? remoteSetupsByYear[yearKey].map((setup) => (
                              <div key={setup.setup_id} className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-sm">
                                <button type="button" className="text-left" onClick={() => void handleLoadSetupFromDatabase(setup.setup_id)}>
                                  <p className="font-medium">{setup.project_name}</p>
                                </button>
                                <Button type="button" size="icon" variant="ghost" onClick={() => void handleDeleteSetupFromDatabase(setup.setup_id)}>
                                  <Trash className="h-4 w-4 text-red-600" />
                                </Button>
                              </div>
                            ))
                          : null}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </fieldset>
          ) : null}

          {activeRoute === "schedule" ? (
            <Card>
              <CardHeader>
                <CardTitle>Schedule Options</CardTitle>
                <CardDescription>Review generated schedules and return to Setup anytime from the sidebar.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {project.solutions.length === 0 ? <FormMessage>No generated options yet. Click Generate Options to create schedules.</FormMessage> : null}
                {selectedScheduleSolution ? (
                  <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">Master Calendar</p>
                        <p className="text-xs text-slate-500">Restored calendar view for {selectedScheduleSolution.solution_id}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="solution-segmented-control" aria-label="Solution options">
                          {project.solutions.map((solution, index) => (
                            <button
                              key={`solution-segment-${solution.solution_id}`}
                              type="button"
                              className={cn(
                                "solution-segment",
                                selectedScheduleSolution.solution_id === solution.solution_id ? "active" : "",
                              )}
                              onClick={() => setSelectedScheduleSolutionId(solution.solution_id)}
                            >
                              {`Sol ${index + 1}`}
                            </button>
                          ))}
                        </div>
                        {project.moed_windows.map((window) => (
                          <Button
                            key={`schedule-moed-${window.moed_number}`}
                            type="button"
                            size="sm"
                            variant={selectedScheduleMoedNumber === window.moed_number ? "default" : "outline"}
                            onClick={() => setSelectedScheduleMoedNumber(window.moed_number)}
                          >
                            {getMoedLabel(window.moed_number)}
                          </Button>
                        ))}
                      </div>
                    </div>
                    <MasterCalendar
                      project={project}
                      solution={selectedScheduleSolution}
                      calendarDays={scheduleCalendarDays}
                      selectedMoedNumber={selectedScheduleMoedNumber}
                      semesterRows={scheduleSemesterRows}
                      courseNameByCode={courseNameByCode}
                      courseByCode={courseByCode}
                      selectedExam={selectedScheduleExam}
                      selectedPreviewDate={selectedSchedulePreviewDate}
                      previewResponses={schedulePreviewResponses}
                      previewLoading={previewLoading}
                      showChanges={false}
                      departmentFilter={scheduleDepartmentFilter}
                      activeConflict={activeConflict}
                      onSelectExam={(exam) => {
                        setSelectedScheduleExamKey(getExamMoveKey(selectedScheduleSolution.solution_id, exam.course_code, exam.moed_number));
                        setSelectedSchedulePreviewDate(exam.exam_date);
                      }}
                      onSelectPreviewDate={setSelectedSchedulePreviewDate}
                      onDepartmentFilterChange={setScheduleDepartmentFilter}
                      interactionsEnabled={busyAction !== "solve" && busyAction !== "manual-move"}
                      onExamDoubleClick={(exam) => openCourseEditorFromExam(exam)}
                      onExamLock={(exam) => lockExamFromCalendar(exam)}
                      onExamUnlock={(exam) => unlockExamFromCalendar(exam)}
                      onExamEditDate={(exam) => editExamDateFromCalendar(exam)}
                      isExamLocked={(exam) => isExamLocked(exam)}
                      onDropExam={(exam, targetDate) => {
                        if (targetDate === exam.exam_date) {
                          return;
                        }
                        void handleManualMove(exam, targetDate);
                      }}
                    />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <div
            id="action-status"
            className={cn(
              "fixed bottom-3 z-40 max-w-[48vw] rounded-xl border border-slate-200/80 bg-white/90 px-4 py-3 shadow-lg backdrop-blur-md",
              collapsedSidebar ? "left-24" : "left-80"
            )}
          >
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <CircleDashed className="h-4 w-4" />
              <span>{actionStatus}</span>
            </div>
          </div>

          <div id="action-controls" className="fixed bottom-3 right-6 z-50 flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white/92 px-3 py-2 shadow-lg backdrop-blur-md">
            {activeRoute === "setup" ? (
              <>
                <Button type="button" variant="secondary" onClick={() => void handleValidate()} disabled={busyAction !== null}>
                  {busyAction === "validate" ? "Validating..." : "Validate Draft"}
                </Button>
                <Button type="button" onClick={() => void handleSolve()} disabled={busyAction !== null}>
                  {busyAction === "solve" ? "Generating..." : "Generate Options"}
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busyAction !== null}
                  onClick={() => setShowConflictDrawer((current) => !current)}
                >
                  {showConflictDrawer ? "Hide Conflicts" : "Conflicts"}
                </Button>
                <Button type="button" onClick={() => void handleSolve()} disabled={busyAction !== null}>
                  {busyAction === "solve" ? "Optimizing..." : "Optimize"}
                </Button>
                <Button type="button" variant="secondary" onClick={() => void handleSaveSelectedSolutionToDatabase()} disabled={busyAction !== null}>
                  Save Solution To Database
                </Button>
              </>
            )}
            {busyAction === "solve" ? (
              <Button type="button" variant="destructive" onClick={handleTerminateSolve}>
                <X className="mr-1 h-4 w-4" />
                Terminate
              </Button>
            ) : null}
          </div>

          {activeRoute === "schedule" && selectedScheduleSolution && showConflictDrawer ? (
            <div className="conflict-bubble-popover">
              <ConflictDrawer
                selectedExam={selectedScheduleExam}
                selectedMoedNumber={selectedScheduleMoedNumber}
                originalExamDate={selectedScheduleOriginalDate}
                conflictIssues={selectedScheduleConflictIssues}
                activeConflict={activeConflict}
                onSelectConflict={setActiveConflict}
                onClose={() => setShowConflictDrawer(false)}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default App;
