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
static void oma_close_except_kept(struct oma_fd_policy policy) {
  if (policy.count == 0) oma_fd_refused("missing explicit policy");
  for (size_t i = 0; i < policy.count; ++i) {
    int flags = fcntl(policy.fds[i], F_GETFD);
    if (flags < 0 || fcntl(policy.fds[i], F_SETFD, flags & ~FD_CLOEXEC) != 0)
      oma_fd_refused("retained channel is unavailable");
  }
  int last = policy.fds[policy.count - 1];
  /* A soft descriptor limit is not the highest open FD. closefrom covers
   * even descriptors opened before that limit was lowered. */
  closefrom(last + 1);
  size_t next = 0;
  for (int fd = 3; fd <= last; ++fd) {
    if (next < policy.count && policy.fds[next] == fd) { ++next; continue; }
    if (close(fd) != 0 && errno != EBADF) oma_fd_refused("descriptor close is unobserved");
  }
}
#endif
