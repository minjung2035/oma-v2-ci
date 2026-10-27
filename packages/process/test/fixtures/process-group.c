/* Observes this actual POSIX child only. It creates no descendants, so its
 * exit/close can never stand in for arbitrary-descendant or scope death. */
#include <unistd.h>
#include <sys/stat.h>
#include <inttypes.h>
#include <stdio.h>
#include <string.h>

int main(int argc, char **argv) {
  if (argc != 2) return 2;
  int descriptor = strcmp(argv[1], "descriptor") == 0;
  int waiting = strcmp(argv[1], "wait") == 0;
  if (!descriptor && !waiting && strcmp(argv[1], "observe") != 0) return 2;
  struct stat info;
  if (descriptor && fstat(3, &info) != 0) return 2;
  pid_t session = getsid(0);
  if (session < 0) return 2;
  printf("{\"pid\":%jd,\"group\":%jd,\"session\":%jd", (intmax_t)getpid(), (intmax_t)getpgrp(), (intmax_t)session);
  if (descriptor) printf(",\"device\":\"%ju\",\"inode\":\"%ju\"", (uintmax_t)info.st_dev, (uintmax_t)info.st_ino);
  printf("}\n");
  if (fflush(stdout) != 0) return 2;
  if (waiting) for (;;) pause();
  return 0;
}
