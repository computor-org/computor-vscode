// Shared rendering of the per-assignment test-run and submission budgets.
//
// The student tree, the tutor tree and the details webview all showed these
// counters and each got them subtly wrong in the same way: they rendered only
// when a *count* was present, so a student saw "(0)" until their first run and
// never learned a limit existed until it refused them. The rule is the
// opposite — show the pair whenever a *limit* exists, from zero usage onward.
//
// The limit itself is resolved server-side (submission group override → course
// content → course default), so both DTO levels are read here with the group
// as an override only.

/** Anything carrying a usage count and its cap. */
export interface BudgetSource {
    result_count?: number | null;
    submission_count?: number | null;
    max_test_runs?: number | null;
    max_submissions?: number | null;
}

export interface GroupBudgetSource {
    count?: number | null;
    max_submissions?: number | null;
    max_test_runs?: number | null;
}

export interface Budget {
    used: number;
    max: number | null;
    /** True once the budget is spent — nothing further is allowed. */
    exhausted: boolean;
}

const build = (used: number | null | undefined, max: number | null | undefined): Budget => {
    const count = used ?? 0;
    const limit = typeof max === 'number' ? max : null;
    return { used: count, max: limit, exhausted: limit !== null && count >= limit };
};

/** Test-run budget for a course content, group override winning. */
export function testBudget(
    courseContent: BudgetSource | null | undefined,
    submissionGroup?: GroupBudgetSource | null,
): Budget {
    const max = submissionGroup?.max_test_runs ?? courseContent?.max_test_runs;
    return build(courseContent?.result_count, max);
}

/** Submission budget for a course content, group override winning. */
export function submissionBudget(
    courseContent: BudgetSource | null | undefined,
    submissionGroup?: GroupBudgetSource | null,
): Budget {
    const max = submissionGroup?.max_submissions ?? courseContent?.max_submissions;
    const used = submissionGroup?.count ?? courseContent?.submission_count;
    return build(used, max);
}

/** Dense tree-row form: `(0/2)` when capped, `(0)` when not. */
export function formatBudgetCompact(budget: Budget): string {
    return budget.max === null ? `(${budget.used})` : `(${budget.used}/${budget.max})`;
}

/** Tooltip form: `0 of 2`, or a bare `0` when uncapped. */
export function formatBudgetLong(budget: Budget): string {
    return budget.max === null ? `${budget.used}` : `${budget.used} of ${budget.max}`;
}
