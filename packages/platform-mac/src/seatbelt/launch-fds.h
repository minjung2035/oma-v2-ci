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
#include <spawn.h>
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
/* Darwin has no public closefrom. SETEXEC replaces this image without a new
 * PID; CLOEXEC_DEFAULT closes every FD except explicit file actions, including
 * FDs above a subsequently lowered soft or hard limit. The kernel also clears
 * CLOEXEC for addinherit_np actions. No descriptor-number scan is sufficient. */
static inline _Noreturn void oma_exec_with_fds(const char *executable, char *const argv[],
    char *const env[], struct oma_fd_policy policy) {
  posix_spawn_file_actions_t actions;
  int status = posix_spawn_file_actions_init(&actions);
  if (status != 0) oma_fd_refused(strerror(status));
  posix_spawnattr_t attributes;
  status = posix_spawnattr_init(&attributes);
  if (status != 0) {
    posix_spawn_file_actions_destroy(&actions);
    oma_fd_refused(strerror(status));
  }
  const char *stage = "spawn attributes";
  int selected_fd = -1;
  status = posix_spawnattr_setflags(&attributes,
    POSIX_SPAWN_SETEXEC | POSIX_SPAWN_CLOEXEC_DEFAULT);
  /* Standard streams are explicit too. A missing required stream or retained
   * channel causes kernel refusal; it must never fall back to unrestricted exec. */
  for (int fd = 0; status == 0 && fd < 3; ++fd) {
    stage = "stdio inheritance"; selected_fd = fd;
    status = posix_spawn_file_actions_addinherit_np(&actions, fd);
  }
  for (size_t i = 0; status == 0 && i < policy.count; ++i) {
    stage = "channel inheritance"; selected_fd = policy.fds[i];
    status = posix_spawn_file_actions_addinherit_np(&actions, policy.fds[i]);
  }
  if (status == 0) {
    stage = "posix_spawn"; selected_fd = -1;
    status = posix_spawn(NULL, executable, &actions, &attributes, argv, env);
  }
  int attribute_status = posix_spawnattr_destroy(&attributes);
  int action_status = posix_spawn_file_actions_destroy(&actions);
  /* Successful SETEXEC cannot return. Preserve the primary API error. */
  if (status == 0) status = attribute_status != 0 ? attribute_status : action_status;
  errno = status != 0 ? status : EIO;
  fprintf(stderr, "Seatbelt target exec (%s, fd %d): %s\n", stage, selected_fd, strerror(errno));
  _exit(125);
}
#endif
#endif
