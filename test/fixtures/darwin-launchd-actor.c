/* Disposable launchd experiment, never a production death or authority oracle.
 * Private read-only ABI: apple-oss-distributions/xnu at
 * f6217f891ac0bb64f3d375211650a4c1ff8ca1ea:
 * bsd/sys/proc_info_private.h (PID flavor 20, 40-byte coalition IDs),
 * osfmk/mach/coalition.h (resource-usage task counter prefix), and
 * bsd/kern/sys_coalition.c (bounded MIN(bufsize, sizeof(cru)) copy-out).
 * No coalition control syscall and no signal to a numeric PID is used. */
#define _DARWIN_C_SOURCE 1
#include <sys/types.h>
#include <sys/wait.h>
#include <libproc.h>
#include <dlfcn.h>
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
static void describe(FILE *output) {
  struct coalition_ids ids = {0};
  errno = 0;
  int size = proc_pidinfo(getpid(), 20, 0, &ids, sizeof ids), saved = size == (int)sizeof ids ? 0 : errno;
  fprintf(output, "{\"variant\":%d,\"pid\":%d,\"parent\":%d,\"group\":%d,\"session\":%d,"
    "\"coalitionBytes\":%d,\"coalitionErrno\":%d,\"resource\":\"%" PRIu64 "\",\"jetsam\":\"%" PRIu64 "\",\"identity\":",
    PROBE_VARIANT, getpid(), getppid(), getpgrp(), getsid(0), size, saved, ids.ids[0], ids.ids[1]);
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
static void hold(const char *role, int prune) {
  if (prune) close_descriptors();
  publish(role, 1);
  struct timespec start, now, pause = { .tv_nsec = 25000000 };
  require(clock_gettime(CLOCK_MONOTONIC, &start) == 0, "actor start clock");
  int acknowledged = 0;
  for (;;) {
    if (!acknowledged && exists("ping")) {
      char ack[128]; require(snprintf(ack, sizeof ack, "%s.ack", role) > 0, "ack name");
      publish(ack, 0); acknowledged = 1;
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
int main(int argc, char **argv) {
  require(argc >= 2, "actor mode");
  if (strcmp(argv[1], "describe") == 0) { describe(stdout); putchar('\n'); return 0; }
  if (strcmp(argv[1], "inspect") == 0) {
    require(argc == 3, "inspect arguments");
    errno = 0; char *end; long pid = strtol(argv[2], &end, 10);
    require(errno == 0 && *end == 0 && pid > 1 && pid <= INT32_MAX, "inspection PID");
    identity(stdout, (pid_t)pid); putchar('\n'); return 0;
  }
  if (strcmp(argv[1], "usage") == 0) { require(argc == 3, "usage arguments"); usage(argv[2]); return 0; }
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
