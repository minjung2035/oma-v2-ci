/* Disposable launchd experiment, never a production death or authority oracle.
 * Private observation/adversarial ABI: apple-oss-distributions/xnu at
 * f6217f891ac0bb64f3d375211650a4c1ff8ca1ea:
 * bsd/sys/proc_info_private.h (PID flavor 20, 40-byte coalition IDs),
 * osfmk/mach/coalition.h (resource-usage task counter prefix),
 * bsd/kern/sys_coalition.c (bounded MIN(bufsize, sizeof(cru)) copy-out),
 * libsyscall/wrappers/spawn/spawn_private.h (explicit coalition attribute).
 * No coalition control syscall or private entitlement. Numeric signals only
 * clean up fresh unreaped direct children; scope control uses kernel tokens. */
#define _DARWIN_C_SOURCE 1
#include <sys/types.h>
#include <sys/wait.h>
#include <libproc.h>
#include <dlfcn.h>
#include <spawn.h>
#include <signal.h>
#include <mach/mach.h>
#include <bsm/libbsm.h>
#include <sandbox.h>
#include <unistd.h>
#include <errno.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#ifndef PROBE_VARIANT
#define PROBE_VARIANT 1
#endif
struct coalition_ids { uint64_t ids[2], reserved[3]; };
struct task_counts { uint64_t started, exited; };
struct process_identity {
  uint8_t uuid[16]; uint64_t unique, parent_unique;
  int32_t version, parent_version; uint64_t reserved[2];
};
_Static_assert(sizeof(struct process_identity) == 56, "pinned unique process result size");
_Static_assert(sizeof(struct coalition_ids) == 40, "pinned coalition result size");
_Static_assert(sizeof(struct task_counts) == 16, "pinned task counter prefix size");
static const char *self_image;
extern char **environ;
static void require(int condition, const char *message) {
  if (!condition) { perror(message); exit(2); }
}
static void identity(FILE *output, pid_t pid) {
  struct process_identity unique = {0};
  struct proc_bsdinfo bsd = {0};
  errno = 0;
  int bytes = proc_pidinfo(pid, 17, 0, &unique, sizeof unique), saved = bytes == (int)sizeof unique ? 0 : errno;
  int bsd_bytes = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &bsd, sizeof bsd);
  fprintf(output, "{\"pid\":%d,\"uniqueBytes\":%d,\"uniqueErrno\":%d,\"unique\":\"%" PRIu64 "\","
    "\"version\":%d,\"bsdBytes\":%d,\"status\":%u}", pid, bytes, saved, unique.unique,
    unique.version, bsd_bytes, bsd.pbi_status);
}
static int sandboxed;
static void describe(FILE *output) {
  struct coalition_ids ids = {0};
  errno = 0;
  int size = proc_pidinfo(getpid(), 20, 0, &ids, sizeof ids), saved = size == (int)sizeof ids ? 0 : errno;
  fprintf(output, "{\"variant\":%d,\"sandboxed\":%s,\"pid\":%d,\"parent\":%d,\"group\":%d,\"session\":%d,"
    "\"coalitionBytes\":%d,\"coalitionErrno\":%d,\"resource\":\"%" PRIu64 "\",\"jetsam\":\"%" PRIu64 "\",\"identity\":",
    PROBE_VARIANT, sandboxed ? "true" : "false", getpid(), getppid(), getpgrp(), getsid(0), size, saved, ids.ids[0], ids.ids[1]);
  identity(output, getpid()); fputc('}', output);
}
static void publish(const char *name, int observation) {
  char temporary[256], final[256];
  require(snprintf(temporary, sizeof temporary, "%s.%d.tmp", name, getpid()) > 0, "temporary name");
  require(snprintf(final, sizeof final, "%s.json", name) > 0, "observation name");
  FILE *file = fopen(temporary, "wx"); require(file != NULL, "observation open");
  if (observation) describe(file); else fputs("true", file);
  require(fclose(file) == 0 && rename(temporary, final) == 0, "observation publish");
}
static void close_descriptors(void) {
  struct proc_fdinfo entries[128];
  int bytes = proc_pidinfo(getpid(), PROC_PIDLISTFDS, 0, entries, sizeof entries);
  require(bytes >= 0 && bytes < (int)sizeof entries && bytes % sizeof entries[0] == 0, "owned descriptor table");
  for (size_t at = 0; at < (size_t)bytes / sizeof entries[0]; ++at)
    require(close(entries[at].proc_fd) == 0, "close inherited descriptor");
}
static int exists(const char *name) { return access(name, F_OK) == 0; }
typedef int (*set_coalition)(const posix_spawnattr_t *, uint64_t, int, int);
static void admission_attempt(FILE *output, const char *name, uint64_t id, set_coalition setter) {
  posix_spawnattr_t attributes;
  require(posix_spawnattr_init(&attributes) == 0, "admission attributes");
  require(posix_spawnattr_setflags(&attributes, POSIX_SPAWN_START_SUSPENDED | POSIX_SPAWN_CLOEXEC_DEFAULT) == 0,
    "admission suspended flags");
  /* Pinned private ABI: resource type 0, undefined task role 0.
   * This is an adversarial test of admission, not a production launch API. */
  int attribute_status = id == 0 ? 0 : setter == NULL ? ENOSYS : setter(&attributes, id, 0, 0);
  char *arguments[] = { (char *)self_image, "describe", NULL };
  pid_t child = 0;
  int spawn_status = attribute_status == 0 ? posix_spawn(&child, self_image, NULL, &attributes, arguments, environ) : -1;
  require(posix_spawnattr_destroy(&attributes) == 0, "admission destroy attributes");
  struct coalition_ids ids = {0};
  int stopped = 0, bytes = 0, saved = 0, status = 0, joined = 0;
  if (spawn_status == 0) {
    pid_t waited;
    do { waited = waitpid(child, &status, WUNTRACED); } while (waited < 0 && errno == EINTR);
    require(waited == child, "admission initial child wait");
    stopped = WIFSTOPPED(status);
    if (stopped) {
      errno = 0;
      bytes = proc_pidinfo(child, 20, 0, &ids, sizeof ids);
      saved = bytes == (int)sizeof ids ? 0 : errno;
      /* The successful spawn's child has not been reaped or released. */
      require(kill(child, SIGKILL) == 0 || errno == ESRCH, "admission owned child cleanup");
      do { waited = waitpid(child, &status, 0); } while (waited < 0 && errno == EINTR);
      require(waited == child, "admission child join");
    }
    require(WIFEXITED(status) || WIFSIGNALED(status), "admission terminal child status");
    joined = 1;
  } else child = 0;
  fprintf(output, "{\"name\":\"%s\",\"requestedResource\":\"%" PRIu64 "\",\"attributeStatus\":%d,"
    "\"spawnStatus\":%d,\"pid\":%d,\"stopped\":%s,\"coalitionBytes\":%d,\"coalitionErrno\":%d,"
    "\"actualResource\":\"%" PRIu64 "\",\"joined\":%s,\"waitStatus\":%d}",
    name, id, attribute_status, spawn_status, child, stopped ? "true" : "false", bytes, saved,
    ids.ids[0], joined ? "true" : "false", status);
}
static void admission(void) {
  FILE *request = fopen("admission-request", "r"); require(request != NULL, "admission request");
  char text[32], *end;
  require(fscanf(request, "%31s", text) == 1 && fgetc(request) == '\n' && fgetc(request) == EOF, "admission request content");
  require(fclose(request) == 0, "admission request close");
  errno = 0; uint64_t other = strtoull(text, &end, 10);
  require(errno == 0 && text[0] >= '1' && text[0] <= '9' && *end == 0 && other > 0, "admission other resource");
  struct coalition_ids ids = {0};
  require(getuid() != 0 && proc_pidinfo(getpid(), 20, 0, &ids, sizeof ids) == (int)sizeof ids &&
    ids.ids[0] > 0 && ids.ids[0] != other, "admission distinct ordinary-user coalitions");
  set_coalition setter = (set_coalition)dlsym(RTLD_DEFAULT, "posix_spawnattr_setcoalition_np");
  FILE *output = fopen("admission.tmp", "wx"); require(output != NULL, "admission observation");
  fprintf(output, "{\"privateInterface\":true,\"available\":%s,\"uid\":%u,\"callerResource\":\"%" PRIu64 "\",\"attempts\":[",
    setter == NULL ? "false" : "true", (unsigned)getuid(), ids.ids[0]);
  admission_attempt(output, "inherited", 0, setter); fputc(',', output);
  admission_attempt(output, "explicit-own", ids.ids[0], setter); fputc(',', output);
  admission_attempt(output, "explicit-other", other, setter); fputs("]}", output);
  require(fclose(output) == 0 && rename("admission.tmp", "admission.json") == 0, "admission publish");
}
static void apply_profile(void) {
  FILE *file = fopen("profile.sb", "rb"); require(file != NULL, "profile open");
  require(fseek(file, 0, SEEK_END) == 0, "profile length");
  long length = ftell(file); require(length > 0 && length <= 1024 * 1024, "bounded profile length");
  rewind(file);
  char *text = malloc((size_t)length + 1); require(text != NULL, "profile allocation");
  require(fread(text, 1, (size_t)length, file) == (size_t)length && fgetc(file) == EOF, "complete profile read");
  require(fclose(file) == 0 && memchr(text, 0, (size_t)length) == NULL, "profile framing");
  text[length] = 0;
  char *error = NULL;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  int code = sandbox_init(text, 0, &error);
  if (error != NULL) { fprintf(stderr, "lifetime profile: %s\n", error); sandbox_free_error(error); }
#pragma clang diagnostic pop
  free(text);
  require(code == 0, "apply production Seatbelt profile");
  sandboxed = 1;
}
static void service_probe(void) {
  FILE *input = fopen("service-target", "r"); require(input != NULL, "service target open");
  char target[256];
  require(fscanf(input, "%255s", target) == 1 && fgetc(input) == '\n' && fgetc(input) == EOF, "service target content");
  require(fclose(input) == 0, "service target close");
  char *arguments[] = { "launchctl", "kickstart", target, NULL };
  pid_t child = 0;
  int code = posix_spawn(&child, "/bin/launchctl", NULL, NULL, arguments, environ);
  int status = 0, joined = 0, numeric_cleanup = 0;
  if (code == 0) {
    struct timespec start, now;
    require(clock_gettime(CLOCK_MONOTONIC, &start) == 0, "service start clock");
    for (;;) {
      pid_t waited = waitpid(child, &status, WNOHANG);
      if (waited == child) { joined = 1; break; }
      require(waited == 0 || (waited < 0 && errno == EINTR), "service child observation");
      require(clock_gettime(CLOCK_MONOTONIC, &now) == 0, "service deadline clock");
      if (now.tv_sec - start.tv_sec >= 5) {
        numeric_cleanup = 1;
        require(kill(child, SIGKILL) == 0 || errno == ESRCH, "service owned child deadline cleanup");
        do { waited = waitpid(child, &status, 0); } while (waited < 0 && errno == EINTR);
        require(waited == child, "service deadline child join");
        joined = 1; break;
      }
      usleep(1000);
    }
    require(WIFEXITED(status) || WIFSIGNALED(status), "service terminal child status");
  } else child = 0;
  FILE *output = fopen("service-admission.tmp", "wx"); require(output != NULL, "service observation open");
  fprintf(output, "{\"sandboxApplied\":%s,\"target\":\"%s\",\"spawnStatus\":%d,\"childPid\":%d,"
    "\"waitStatus\":%d,\"joined\":%s,\"numericCleanupUsed\":%s}",
    sandboxed ? "true" : "false", target, code, child, status, joined ? "true" : "false", numeric_cleanup ? "true" : "false");
  require(fclose(output) == 0 && rename("service-admission.tmp", "service-admission.json") == 0, "service observation publish");
}
static void hold(const char *role, int prune) {
  if (strcmp(role, "detached") == 0) { apply_profile(); service_probe(); }
  if (prune) close_descriptors();
  publish(role, 1);
  struct timespec start, now, pause = { .tv_nsec = 25000000 };
  require(clock_gettime(CLOCK_MONOTONIC, &start) == 0, "actor start clock");
  int acknowledged = 0, admission_done = 0, late_forked = 0;
  for (;;) {
    if (!acknowledged && exists("ping")) {
      if (strcmp(role, "detached") == 0) {
        pid_t late = fork(); require(late >= 0, "ownerless late fork");
        if (late == 0) { hold("late", 0); _exit(0); }
      }
      char ack[128]; require(snprintf(ack, sizeof ack, "%s.ack", role) > 0, "ack name");
      publish(ack, 0); acknowledged = 1;
    }
    if (!admission_done && strcmp(role, "leader") == 0 && exists("admission-request")) {
      admission(); admission_done = 1;
    }
    if (!late_forked && strcmp(role, "late") == 0 && exists("fork-after-snapshot")) {
      pid_t late = fork(); require(late >= 0, "post-snapshot fork");
      if (late == 0) { hold("after-snapshot", 0); _exit(0); }
      late_forked = 1;
    }
    if (exists("release")) break;
    require(clock_gettime(CLOCK_MONOTONIC, &now) == 0, "actor deadline clock");
    /* Cleanup remains bounded if the observation controller is killed. */
    if (now.tv_sec - start.tv_sec >= 40) break;
    while (nanosleep(&pause, &pause) != 0) require(errno == EINTR, "actor sleep");
    pause = (struct timespec){ .tv_nsec = 25000000 };
  }
}
static void usage(const char *text) {
  errno = 0; char *end;
  uint64_t id = strtoull(text, &end, 10);
  require(errno == 0 && text[0] >= '0' && text[0] <= '9' && *end == 0 && id > 0, "coalition ID");
  typedef int (*read_usage)(uint64_t, void *, size_t);
  read_usage read_counts = (read_usage)dlsym(RTLD_DEFAULT, "coalition_info_resource_usage");
  struct task_counts counts = {0};
  errno = 0;
  int code = read_counts == NULL ? -1 : read_counts(id, &counts, sizeof counts);
  int saved = read_counts == NULL ? ENOSYS : code == 0 ? 0 : errno;
  printf("{\"available\":%s,\"returnCode\":%d,\"errno\":%d,\"started\":\"%" PRIu64 "\",\"exited\":\"%" PRIu64 "\"}\n",
    read_counts == NULL ? "false" : "true", code, saved, counts.started, counts.exited);
}
static void signal_member(pid_t pid, const char *text) {
  errno = 0; char *end;
  uint64_t expected = strtoull(text, &end, 10);
  require(getuid() != 0 && errno == 0 && text[0] >= '1' && text[0] <= '9' && *end == 0 && expected > 0,
    "ordinary-user member control arguments");
  struct process_identity before = {0}, after = {0};
  struct coalition_ids ids = {0};
  audit_token_t token = {{0}};
  mach_port_name_t name = MACH_PORT_NULL;
  mach_msg_type_number_t count = TASK_AUDIT_TOKEN_COUNT;
  int membership_bytes = 0, membership_errno = 0, after_bytes = 0, after_errno = 0;
  int name_status = -1, info_status = -1, release_status = -1, signal_status = -1;
  errno = 0;
  int before_bytes = proc_pidinfo(pid, 17, 0, &before, sizeof before);
  int before_errno = before_bytes == (int)sizeof before ? 0 : errno;
  if (before_bytes == (int)sizeof before && before.unique != 0 && before.version != 0) {
    errno = 0;
    membership_bytes = proc_pidinfo(pid, 20, 0, &ids, sizeof ids);
    membership_errno = membership_bytes == (int)sizeof ids ? 0 : errno;
    if (membership_bytes == (int)sizeof ids && ids.ids[0] == expected) {
      /* The port comes from the kernel PID lookup, not from an untrusted peer. */
      name_status = task_name_for_pid(mach_task_self(), pid, &name);
      if (name_status == KERN_SUCCESS && MACH_PORT_VALID(name)) {
        info_status = task_info(name, TASK_AUDIT_TOKEN, (task_info_t)&token, &count);
        release_status = mach_port_deallocate(mach_task_self(), name);
      }
      errno = 0;
      after_bytes = proc_pidinfo(pid, 17, 0, &after, sizeof after);
      after_errno = after_bytes == (int)sizeof after ? 0 : errno;
    }
  }
  /* The generation sandwich correlates membership with the kernel token.
   * The SDK then checks that generation at the signal effect. No saved PID
   * control, invented sender identity, or target cooperation is involved. */
  int correlated = before_bytes == (int)sizeof before && after_bytes == (int)sizeof after &&
    before.unique != 0 && before.unique == after.unique && before.version != 0 && before.version == after.version &&
    membership_bytes == (int)sizeof ids && ids.ids[0] == expected &&
    name_status == KERN_SUCCESS && info_status == KERN_SUCCESS && release_status == KERN_SUCCESS &&
    count == TASK_AUDIT_TOKEN_COUNT && audit_token_to_pid(token) == pid &&
    audit_token_to_euid(token) == geteuid() && token.val[7] == (uint32_t)before.version;
  if (correlated) signal_status = proc_signal_with_audittoken(&token, SIGKILL);
  printf("{\"controllerPid\":%d,\"controllerUid\":%u,\"targetPid\":%d,\"expectedResource\":\"%" PRIu64 "\","
    "\"before\":{\"bytes\":%d,\"errno\":%d,\"unique\":\"%" PRIu64 "\",\"version\":%d},"
    "\"membership\":{\"bytes\":%d,\"errno\":%d,\"resource\":\"%" PRIu64 "\"},"
    "\"taskNameStatus\":%d,\"taskInfoStatus\":%d,\"namePortReleaseStatus\":%d,\"auditCount\":%u,"
    "\"auditPid\":%d,\"auditUid\":%u,\"auditPidVersion\":%u,"
    "\"after\":{\"bytes\":%d,\"errno\":%d,\"unique\":\"%" PRIu64 "\",\"version\":%d},"
    "\"correlated\":%s,\"signalStatus\":%d}\n",
    getpid(), (unsigned)geteuid(), pid, expected, before_bytes, before_errno, before.unique, before.version,
    membership_bytes, membership_errno, ids.ids[0], name_status, info_status, release_status, count,
    audit_token_to_pid(token), (unsigned)audit_token_to_euid(token), token.val[7],
    after_bytes, after_errno, after.unique, after.version, correlated ? "true" : "false", signal_status);
}
static void candidates(const char *text) {
  errno = 0; char *end;
  uint64_t expected = strtoull(text, &end, 10);
  require(errno == 0 && text[0] >= '1' && text[0] <= '9' && *end == 0 && expected > 0, "candidate coalition ID");
  errno = 0;
  int estimate = proc_listallpids(NULL, 0), saved = errno;
  int capacity = estimate > 0 ? (estimate < 65472 ? estimate + 64 : 65536) : 0;
  pid_t *pids = capacity > 0 ? malloc((size_t)capacity * sizeof *pids) : NULL;
  require(capacity == 0 || pids != NULL, "bounded candidate allocation");
  int listed = 0, unreadable = 0;
  if (pids != NULL) {
    errno = 0;
    /* The wrapper returns a PID count, not bytes. Enumeration is only hints;
     * a full buffer or an empty scan can never establish a closed scope. */
    listed = proc_listallpids(pids, (int)((size_t)capacity * sizeof *pids));
    saved = errno;
  }
  printf("{\"hintOnly\":true,\"resource\":\"%" PRIu64 "\",\"capacity\":%d,\"listed\":%d,\"errno\":%d,"
    "\"saturated\":%s,\"candidatePids\":[", expected, capacity, listed, saved,
    capacity > 0 && listed >= capacity ? "true" : "false");
  int emitted = 0;
  for (int index = 0; index < listed && index < capacity; index++) {
    if (pids[index] <= 1) continue;
    struct coalition_ids ids = {0};
    int bytes = proc_pidinfo(pids[index], 20, 0, &ids, sizeof ids);
    if (bytes != (int)sizeof ids) { unreadable++; continue; }
    if (ids.ids[0] == expected) {
      printf("%s%d", emitted ? "," : "", pids[index]); emitted++;
    }
  }
  printf("],\"unreadable\":%d}\n", unreadable);
  free(pids);
}
int main(int argc, char **argv) {
  require(argc >= 2, "actor mode");
  self_image = argv[0];
  if (strcmp(argv[1], "describe") == 0) { describe(stdout); putchar('\n'); return 0; }
  if (strcmp(argv[1], "inspect") == 0) {
    require(argc == 3, "inspect arguments");
    errno = 0; char *end; long pid = strtol(argv[2], &end, 10);
    require(errno == 0 && *end == 0 && pid > 1 && pid <= INT32_MAX, "inspection PID");
    identity(stdout, (pid_t)pid); putchar('\n'); return 0;
  }
  if (strcmp(argv[1], "signal-member") == 0) {
    require(argc == 4, "member control arguments");
    errno = 0; char *end; long pid = strtol(argv[2], &end, 10);
    require(errno == 0 && *end == 0 && pid > 1 && pid <= INT32_MAX, "member candidate PID");
    signal_member((pid_t)pid, argv[3]); return 0;
  }
  if (strcmp(argv[1], "usage") == 0) { require(argc == 3, "usage arguments"); usage(argv[2]); return 0; }
  if (strcmp(argv[1], "candidates") == 0) { require(argc == 3, "candidate arguments"); candidates(argv[2]); return 0; }
  require(argc == 3 && chdir(argv[2]) == 0, "private observation directory");
  if (strcmp(argv[1], "once") == 0) { publish("once", 1); return 0; }
  if (strcmp(argv[1], "hold") == 0) { hold("other", 1); return 0; }
  require(strcmp(argv[1], "scope") == 0, "scope mode");
  pid_t ordinary = fork(); require(ordinary >= 0, "ordinary fork");
  if (ordinary == 0) { hold("ordinary", 1); _exit(0); }
  pid_t intermediate = fork(); require(intermediate >= 0, "detached fork");
  if (intermediate == 0) {
    require(setsid() >= 0, "detached setsid");
    pid_t detached = fork(); require(detached >= 0, "detached double fork");
    if (detached == 0) { hold("detached", 1); _exit(0); }
    _exit(0);
  }
  int status; pid_t joined;
  do { joined = waitpid(intermediate, &status, 0); } while (joined < 0 && errno == EINTR);
  require(joined == intermediate && WIFEXITED(status) && WEXITSTATUS(status) == 0, "join intermediate");
  hold("leader", 0);
  do { joined = waitpid(ordinary, &status, 0); } while (joined < 0 && errno == EINTR);
  require(joined == ordinary && WIFEXITED(status), "join ordinary");
  return 0;
}
