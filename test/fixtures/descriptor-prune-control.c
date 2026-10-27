/* Real Darwin execution only, using the production public-API launch leaf.
 * Compare one fixture-owned process across exec, never arbitrary scope death. */
#if !defined(__APPLE__)
#error "Descriptor inheritance control requires the real Darwin target"
#endif
#include "launch-fds.h"
#include <sys/resource.h>
#include <sys/stat.h>
#include <inttypes.h>
extern char **environ;
static int observe(int argc, char **argv) {
  if (argc != 6) return 2;
  uintmax_t pid = strtoumax(argv[2], NULL, 10);
  uintmax_t device = strtoumax(argv[3], NULL, 10), inode = strtoumax(argv[4], NULL, 10);
  int expect_kept = strcmp(argv[5], "none") != 0;
  struct stat info;
  int kept = fstat(6, &info) == 0 && (uintmax_t)info.st_dev == device && (uintmax_t)info.st_ino == inode;
  kept = kept && fstat(8, &info) == 0 && (uintmax_t)info.st_dev == device && (uintmax_t)info.st_ino == inode;
  int flags6 = fcntl(6, F_GETFD), flags8 = fcntl(8, F_GETFD);
  int absent = flags6 < 0 && fcntl(6, F_GETFD) < 0 && errno == EBADF;
  absent = absent && flags8 < 0 && fcntl(8, F_GETFD) < 0 && errno == EBADF;
  int inheritable = flags6 >= 0 && flags8 >= 0 && !(flags6 & FD_CLOEXEC) && !(flags8 & FD_CLOEXEC);
  int extra = fcntl(64, F_GETFD), outside = extra >= 0;
  if (extra < 0 && errno != EBADF) return 2;
  int lower = fcntl(3, F_GETFD), low_closed = lower < 0 && errno == EBADF;
  if (lower < 0 && errno != EBADF) return 2;
  int same_pid = (uintmax_t)getpid() == pid;
  int stdio = fstat(0, &info) == 0 && fstat(1, &info) == 0 && fstat(2, &info) == 0;
  struct rlimit limit;
  if (getrlimit(RLIMIT_NOFILE, &limit) != 0 || limit.rlim_cur != 16 || limit.rlim_max != 16) return 2;
  printf("{\"kept\":%s,\"outsideSoftLimitOpen\":%s,\"lowClosed\":%s,\"inheritable\":%s,\"samePid\":%s,\"stdioInherited\":%s,\"hardLimit\":16}\n",
    kept ? "true" : "false", outside ? "true" : "false", low_closed ? "true" : "false",
    inheritable ? "true" : "false", same_pid ? "true" : "false", stdio ? "true" : "false");
  return (expect_kept ? kept && inheritable : absent) && !outside && low_closed && same_pid && stdio ? 0 : 3;
}
int main(int argc, char **argv) {
  if (argc > 1 && strcmp(argv[1], "--observe") == 0) return observe(argc, argv);
  if (argc != 3) return 2;
  int canary = open(argv[1], O_RDONLY | O_CLOEXEC);
  if (canary < 0) return 2;
  struct stat wanted;
  if (fstat(canary, &wanted) != 0 || dup2(canary, 6) != 6 || dup2(canary, 8) != 8 || dup2(canary, 64) != 64) return 2;
  if (canary != 3 && dup2(canary, 3) != 3) return 2;
  for (int fd = 0; fd < 3; ++fd) if (fcntl(fd, F_SETFD, FD_CLOEXEC) != 0) return 2;
  for (int fd = 6; fd <= 8; fd += 2) if (fcntl(fd, F_SETFD, FD_CLOEXEC) != 0) return 2;
  struct rlimit limit;
  if (getrlimit(RLIMIT_NOFILE, &limit) != 0) return 2;
  limit.rlim_cur = limit.rlim_max = 16;
  if (setrlimit(RLIMIT_NOFILE, &limit) != 0) return 2;
  char pid[32], device[32], inode[32];
  snprintf(pid, sizeof(pid), "%ju", (uintmax_t)getpid());
  snprintf(device, sizeof(device), "%ju", (uintmax_t)wanted.st_dev);
  snprintf(inode, sizeof(inode), "%ju", (uintmax_t)wanted.st_ino);
  char *next[] = { argv[0], "--observe", pid, device, inode, argv[2], NULL };
  if (strcmp(argv[2], "negative-control") == 0) {
    /* Deliberate raw-exec leak: the same target must see the still-open FD64
     * above both lowered limits. This is a real kernel negative control. */
    for (int fd = 0; fd < 3; ++fd) if (fcntl(fd, F_SETFD, 0) != 0) return 2;
    if (fcntl(6, F_SETFD, 0) != 0 || fcntl(8, F_SETFD, 0) != 0) return 2;
    execve(argv[0], next, environ);
    return 2;
  }
  struct oma_fd_policy policy = { NULL, 0 };
  if (strcmp(argv[2], "none") != 0) policy = oma_parse_kept_fds(argv[2]);
  oma_exec_with_fds(argv[0], next, environ, policy);
}
