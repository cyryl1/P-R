import picomatch from 'picomatch';
import type { Rule, RulesFile, Severity } from '@pr-reviewer/shared';
import type { DiffFile } from '../diff/index.js';
import type { GhPr } from '../gh/client.js';

export type DeterministicResult = {
  ruleId: string;
  kind: 'deterministic';
  status: 'pass' | 'fail' | 'na';
  note: string;
  severity: Severity;
};

export type CheckContext = {
  pr: GhPr;
  files: DiffFile[];
  rules: RulesFile;
};

const matches = (path: string, patterns: string[]) =>
  patterns.some((pattern) => picomatch.isMatch(path, pattern));

function result(
  rule: Exclude<Rule, { type: 'llm' }>,
  status: DeterministicResult['status'],
  note: string,
): DeterministicResult {
  return {
    ruleId: rule.id,
    kind: 'deterministic',
    status,
    note,
    severity: rule.severity,
  };
}

export function runCheck(
  context: CheckContext,
  rule: Exclude<Rule, { type: 'llm' }>,
): DeterministicResult {
  const { pr, files } = context;
  switch (rule.type) {
    case 'require_tests': {
      const relevant = files.filter((file) => matches(file.path, rule.when_paths));
      if (relevant.length === 0)
        return result(rule, 'na', 'No changed files require tests.');
      const tests = files.filter((file) => matches(file.path, rule.test_paths));
      return tests.length > 0
        ? result(rule, 'pass', `Test changes found in ${tests.length} file(s).`)
        : result(rule, 'fail', 'Logic changed without a matching test file.');
    }
    case 'max_changed_lines': {
      const considered = files.filter(
        (file) => !matches(file.path, context.rules.review.ignore_paths),
      );
      const changed = considered.reduce(
        (total, file) => total + file.additions + file.deletions,
        0,
      );
      return changed <= rule.limit
        ? result(rule, 'pass', `${changed} changed lines, limit ${rule.limit}.`)
        : result(rule, 'fail', `${changed} changed lines, limit ${rule.limit}.`);
    }
    case 'forbid_paths': {
      const forbidden = files.filter((file) => matches(file.path, rule.paths));
      return forbidden.length === 0
        ? result(rule, 'pass', 'No forbidden paths changed.')
        : result(
            rule,
            'fail',
            `Forbidden paths changed: ${forbidden.map((file) => file.path).join(', ')}.`,
          );
    }
    case 'require_description': {
      const length = pr.body.trim().length;
      return length >= rule.min_length
        ? result(rule, 'pass', `Description has ${length} characters.`)
        : result(
            rule,
            'fail',
            `Description has ${length} characters; requires ${rule.min_length}.`,
          );
    }
    case 'require_linked_issue': {
      const linked =
        pr.closingIssuesReferences.length > 0 || /(^|\s)#\d+\b/.test(pr.body);
      return linked
        ? result(rule, 'pass', 'A linked issue was found.')
        : result(rule, 'fail', 'No linked issue was found.');
    }
  }
}

export function runDeterministicChecks(
  context: CheckContext,
): DeterministicResult[] {
  return context.rules.rules
    .filter(
      (rule): rule is Exclude<Rule, { type: 'llm' }> =>
        rule.enabled !== false && rule.type !== 'llm',
    )
    .map((rule) => runCheck(context, rule));
}
