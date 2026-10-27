/* Actual POSIX descriptor mutations, using the production mechanics. No
 * sandbox_init replacement and no Darwin support claim on a Linux kernel. */
#include "launch-fds.h"
#include <sys/resource.h>
#include <sys/stat.h>
int main(int argc, char **argv) {
  if (argc != 3) return 2;
  int canary = open(argv[1], O_RDONLY | O_CLOEXEC);
  if (canary < 0) return 2;
  struct stat wanted, actual;
  if (fstat(canary, &wanted) != 0 || dup2(canary, 6) != 6 || dup2(canary, 8) != 8 || dup2(canary, 64) != 64) return 2;
  if (fcntl(6, F_SETFD, FD_CLOEXEC) != 0 || fcntl(8, F_SETFD, FD_CLOEXEC) != 0) return 2;
  struct rlimit limit;
  if (getrlimit(RLIMIT_NOFILE, &limit) != 0) return 2;
  limit.rlim_cur = 16;
  if (setrlimit(RLIMIT_NOFILE, &limit) != 0) return 2;
  if (strcmp(argv[2], "negative-control") != 0) {
    struct oma_fd_policy policy = oma_parse_kept_fds(argv[2]);
    oma_close_except_kept(policy); free(policy.fds);
  }
  int kept = fstat(6, &actual) == 0 && actual.st_dev == wanted.st_dev && actual.st_ino == wanted.st_ino;
  kept = kept && fstat(8, &actual) == 0 && actual.st_dev == wanted.st_dev && actual.st_ino == wanted.st_ino;
  int extra = fcntl(64, F_GETFD), outside = extra >= 0;
  if (extra < 0 && errno != EBADF) return 2;
  int lower = fcntl(3, F_GETFD), lowClosed = lower < 0 && errno == EBADF;
  int flags6 = fcntl(6, F_GETFD), flags8 = fcntl(8, F_GETFD);
  int inheritable = flags6 >= 0 && flags8 >= 0 && !(flags6 & FD_CLOEXEC) && !(flags8 & FD_CLOEXEC);
  printf("{\"kept\":%s,\"outsideSoftLimitOpen\":%s,\"lowClosed\":%s,\"inheritable\":%s}\n",
    kept ? "true" : "false", outside ? "true" : "false", lowClosed ? "true" : "false", inheritable ? "true" : "false");
  return kept && !outside && lowClosed && inheritable ? 0 : 3;
}
