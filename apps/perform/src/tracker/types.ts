import type { Result } from "@praha/byethrow";
import type { Issue, IssueId, IssueStateName } from "../domain/issue.js";
import type { TrackerError } from "../domain/tracker-errors.js";

export type Tracker = Readonly<{
  fetchCandidateIssues: () => Promise<Result.Result<ReadonlyArray<Issue>, TrackerError>>;
  fetchIssuesByStates: (
    states: ReadonlyArray<IssueStateName>,
  ) => Promise<Result.Result<ReadonlyArray<Issue>, TrackerError>>;
  fetchIssueStatesByIds: (
    ids: ReadonlyArray<IssueId>,
  ) => Promise<Result.Result<ReadonlyArray<Issue>, TrackerError>>;
  createComment: (
    issueId: IssueId,
    body: string,
  ) => Promise<Result.Result<void, TrackerError>>;
  updateIssueState: (
    issue: Issue,
    state: IssueStateName,
  ) => Promise<Result.Result<void, TrackerError>>;
}>;
