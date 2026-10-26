export const diffCases = {
  multiHunk: `diff --git a/src/multi.ts b/src/multi.ts
index 0000000..1111111 100644
--- a/src/multi.ts
+++ b/src/multi.ts
@@ -1,3 +1,3 @@
 first
-old
+new
 second
@@ -20,1 +21,2 @@
 twenty
+twenty one
`,
  added: `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,2 @@
+export const answer = 42;
+
`,
  deleted: `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index 1111111..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-export const old = true;
-
`,
  renamed: `diff --git a/src/before.ts b/src/after.ts
similarity index 100%
rename from src/before.ts
rename to src/after.ts
`,
  binary: `diff --git a/assets/logo.png b/assets/logo.png
index 0000000..1111111 100644
Binary files a/assets/logo.png and b/assets/logo.png differ
`,
  noNewline: `diff --git a/README.md b/README.md
index 0000000..1111111 100644
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-before
\\ No newline at end of file
+after
\\ No newline at end of file
`,
};

export const ghPrFixture = {
  number: 42,
  title: 'Avoid duplicate invoice creation',
  body: 'Closes #41',
  author: { login: 'octocat' },
  url: 'https://github.com/acme/billing/pull/42',
  baseRefName: 'main',
  headRefName: 'fix/invoices',
  headRefOid: '0123456789abcdef',
  isDraft: false,
  additions: 2,
  deletions: 1,
  files: [{ path: 'src/invoices.ts', additions: 2, deletions: 1, changeType: 'MODIFIED' }],
  closingIssuesReferences: [{ number: 41, url: 'https://github.com/acme/billing/issues/41' }],
  state: 'OPEN',
};

export const ghSearchFixture = [{
  number: 42,
  title: 'Avoid duplicate invoice creation',
  repository: { nameWithOwner: 'acme/billing' },
  url: 'https://github.com/acme/billing/pull/42',
  author: { login: 'octocat' },
  isDraft: false,
  updatedAt: '2026-10-25T10:00:00Z',
}];
