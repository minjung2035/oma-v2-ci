/* Descriptor-table mechanics only. The trusted TS owner chooses which
 * channels may cross exec; this code grants no role, scope or file access. */
#ifndef OMA_LAUNCH_FDS_H
#define OMA_LAUNCH_FDS_H
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#if defined(__APPLE__)
#include <libproc.h>
#include <sys/proc_info.h>
#endif
struct oma_fd_policy { int *fds; size_t count; };
static _Noreturn void oma_fd_refused(const char *reason) {
  fprintf(stderr, "Seatbelt descriptor policy: %s\n", reason);
  _exit(125);
}
static struct oma_fd_policy oma_parse_kept_fds(const char *text) {
  if (*text == 0) oma_fd_refused("empty list");
  size_t count = 1;
  for (const char *at = text; *at != 0; ++at) if (*at == ',') ++count;
  if (count > SIZE_MAX / sizeof(int)) oma_fd_refused("list overflows");
  struct oma_fd_policy result = { calloc(count, sizeof(int)), 0 };
  if (result.fds == NULL) oma_fd_refused("allocation failed");
  const char *at = text;
  for (;;) {
    if (*at < '1' || *at > '9') oma_fd_refused("noncanonical descriptor");
    int fd = 0;
    do {
      int digit = *at++ - '0';
      if (fd > (INT_MAX - 1 - digit) / 10) oma_fd_refused("descriptor overflows");
      fd = fd * 10 + digit;
    } while (*at >= '0' && *at <= '9');
    if (fd < 4 || (result.count != 0 && fd <= result.fds[result.count - 1]))
      oma_fd_refused("reserved, repeated or unordered descriptor");
    result.fds[result.count++] = fd;
    if (*at == 0) return result;
    if (*at++ != ',') oma_fd_refused("invalid separator");
  }
}
#if defined(__APPLE__)
/* This fixed launcher creates no threads or asynchronous FD owners. Enumerate
 * actual descriptors, not RLIMIT_NOFILE: an inherited FD may exceed both the
 * current soft and hard limits. No descriptor can be created between pruning
 * and the final execve. The Node host never runs this table mutation. */
static inline int oma_fd_kept(int fd, struct oma_fd_policy policy) {
  if (fd >= 0 && fd < 3) return 1;
  size_t first = 0, last = policy.count;
  while (first < last) {
    size_t middle = first + (last - first) / 2;
    if (policy.fds[middle] < fd) first = middle + 1;
    else last = middle;
  }
  return first < policy.count && policy.fds[first] == fd;
}
static inline _Noreturn void oma_exec_with_fds(const char *executable, char *const argv[],
    char *const env[], struct oma_fd_policy policy) {
  struct proc_taskinfo task;
  errno = 0;
  if (proc_pidinfo(getpid(), PROC_PIDTASKINFO, 0, &task, sizeof(task)) != (int)sizeof(task) ||
      task.pti_threadnum != 1) {
    if (errno == 0) errno = EBUSY;
    perror("Seatbelt target exec requires one launcher thread"); _exit(125);
  }
  for (size_t i = 0; i < policy.count + 3; ++i) {
    int fd = i < 3 ? (int)i : policy.fds[i - 3];
    int flags = fcntl(fd, F_GETFD);
    if (flags < 0 || fcntl(fd, F_SETFD, flags & ~FD_CLOEXEC) < 0) {
      perror("Seatbelt target exec retained descriptor"); _exit(125);
    }
  }
  errno = 0;
  int required = proc_pidinfo(getpid(), PROC_PIDLISTFDS, 0, NULL, 0);
  if (required <= 0 || required > INT_MAX - (int)sizeof(struct proc_fdinfo)) {
    if (errno == 0) errno = required <= 0 ? EIO : EOVERFLOW;
    perror("Seatbelt target exec descriptor inventory"); _exit(125);
  }
  int capacity = required + (int)sizeof(struct proc_fdinfo);
  struct proc_fdinfo *entries;
  int used;
  for (;;) {
    entries = malloc((size_t)capacity);
    if (entries == NULL) { perror("Seatbelt descriptor allocation"); _exit(125); }
    errno = 0;
    used = proc_pidinfo(getpid(), PROC_PIDLISTFDS, 0, entries, capacity);
    if (used <= 0 || used > capacity || used % sizeof(*entries) != 0) {
      if (errno == 0) errno = EIO;
      perror("Seatbelt target exec descriptor observation"); _exit(125);
    }
    if (used < capacity) break;
    free(entries);
    if (capacity > INT_MAX / 2) { errno = EOVERFLOW; perror("Seatbelt descriptor inventory"); _exit(125); }
    capacity *= 2;
  }
  for (size_t i = 0; i < (size_t)used / sizeof(*entries); ++i) {
    int fd = entries[i].proc_fd;
    if (!oma_fd_kept(fd, policy) && close(fd) != 0) {
      perror("Seatbelt target exec descriptor close"); _exit(125);
    }
  }
  free(entries);
  execve(executable, argv, env);
  perror("Seatbelt target exec");
  _exit(125);
}
#endif
#endif
