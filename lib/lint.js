// Packages
const { lint, load } = require("@commitlint/core");

// Ours
const config = require("./config");
const format = require("./format");
const checkComments = require("./comments");

/**
 * Runs commitlint against all commits of the pull request and sets an appropriate
 * status check
 */
async function commitlint(context) {
  // 1. Extract necessary info
  const pull = context.issue();
  const { sha } = context.payload.pull_request.head;
  const repo = context.repo();

  // GH API
  const { paginate, issues, repos, pullRequests } = context.github;

  // Hold this PR info
  const statusInfo = { ...repo, sha, context: "commitlint" };

  // Pending
  await repos.createStatus({
    ...statusInfo,
    state: "pending",
    description: "Waiting for the status to be reported"
  });

  // Paginate all PR commits
  return paginate(pullRequests.getCommits(pull), async ({ data }) => {
    // empty summary
    const report = { valid: true, commits: [] };
    const { rules } = await load(config);

    // Keep counters
    let errorsCount = 0;
    let warnsCount = 0;

    // custom cleaning
    const cleanMessage = msg => {
      return msg.replace(/^[A-Z]*\-[0-9]*.-./, "");
    };

    // Iterates over all commits
    for (const d of data) {
      const { valid, errors, warnings } = await lint(
        cleanMessage(d.commit.message),
        rules
      );
      if (!valid) {
        report.valid = false;
      }

      if (errors.length > 0 || warnings.length > 0) {
        // Update counts
        errorsCount += errors.length;
        warnsCount += warnings.length;

        report.commits.push({ sha: d.sha, errors, warnings });
      }
    }

    // Final status
    await repos.createStatus({
      ...statusInfo,
      state: report.valid ? "success" : "failure",
      description: `found ${errorsCount} problems, ${warnsCount} warnings`
    });

    // Get commit
    const comment = await checkComments(issues, pull);

    // Write a comment with the details (if any)
    if (errorsCount > 0 || warnsCount > 0) {
      const message = format(report.commits);
      if (comment) {
        // edits previous bot comment if found
        await issues.editComment({ ...pull, id: comment.id, body: message });
      } else {
        // if no previous comment create a new one
        await issues.createComment({ ...pull, body: message });
      }
    } else {
      if (comment) {
        // edits previous bot comment if found
        await issues.deleteComment({ ...pull, comment_id: comment.id });
      }
    }
  });
}

module.exports = commitlint;
