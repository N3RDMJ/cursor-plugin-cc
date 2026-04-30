/**
 * Sample git diffs used by review/CLI tests.
 */

export const SIMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index 1111111..2222222 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 export function foo() {
+  console.log("debug");
   return 42;
 }
`;

export const MULTI_FILE_DIFF = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-export const a = 1;
+export const a = 2;
diff --git a/src/b.ts b/src/b.ts
index 3333333..4444444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1 +1 @@
-export const b = "old";
+export const b = "new";
`;
