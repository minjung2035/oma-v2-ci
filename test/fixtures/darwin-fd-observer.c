/* Read-only FD oracle for an intentionally inherited, fixture-owned canary.
 * It opens no files and treats metadata failure as unknown, never absence. */
#include <sys/stat.h>
#include <unistd.h>
#include <errno.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
static uintmax_t number(const char *value) {
  for (const char *at = value; *at != 0; ++at)
    if (*at < '0' || *at > '9') { fputs("invalid FD oracle identity\n", stderr); exit(2); }
  char *end = NULL; errno = 0;
  uintmax_t result = strtoumax(value, &end, 10);
  if (errno != 0 || value[0] == 0 || end == NULL || *end != 0) { fputs("invalid FD oracle identity\n", stderr); exit(2); }
  return result;
}
int main(int argc, char **argv) {
  if (argc != 3) return 2;
  uintmax_t device = number(argv[1]), inode = number(argv[2]);
  int limit = getdtablesize(), leaked = 0;
  if (limit < 3) return 2;
  for (int fd = 3; fd < limit; ++fd) {
    struct stat info;
    if (fstat(fd, &info) == 0) {
      if ((uintmax_t)info.st_dev == device && (uintmax_t)info.st_ino == inode) leaked = 1;
    } else if (errno != EBADF) { perror("FD observation is unknown"); return 2; }
  }
  printf("{\"leaked\":%s,\"checkedTo\":%d}\n", leaked ? "true" : "false", limit);
  return leaked ? 3 : 0;
}
