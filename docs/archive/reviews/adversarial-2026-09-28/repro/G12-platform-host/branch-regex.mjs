// Probe the BRANCH regex used by MacGit.bundle (project.ts) for argv-injection
// or path escape. We can't import the private regex, so we re-derive the test
// by checking which names MacGit.bundle would reject. We test the regex source
// as copied from project.ts:35 and assert dangerous inputs are rejected.
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!\/)[A-Za-z0-9._/-]{1,200}(?<!\/)(?<!\.lock)$/;
let pass = 0, fail = 0;
const rejects = (name) => { const bad = !BRANCH.test(name); if (bad) pass++; else fail++; console.log(bad ? "REJECT" : "ACCEPT!!", JSON.stringify(name)); };
const accepts = (name) => { const good = BRANCH.test(name); if (good) pass++; else fail++; console.log(good ? "ACCEPT" : "REJECT!!", JSON.stringify(name)); };

// Dangerous: leading dash (option injection into git), traversal, absolute,
// newline, space, control, semicolons, refspec chars.
rejects("--upload-pack=touch /tmp/x");
rejects("-oProxyCommand=x");
rejects("../../etc/passwd");
rejects("/etc/passwd");
rejects("a/../b");
rejects("a//b");
rejects("branch\nname");
rejects("branch name");
rejects("a;rm -rf /");
rejects("a\u0000b");
rejects("a:b");
rejects("a\\b");
rejects("refs/heads/x^{commit}");
rejects("x.lock");
rejects("trailing/");
rejects("a".repeat(201));
// Legit names accepted.
accepts("main");
accepts("feature/x-y_z.1");
accepts("release/2.0");

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
