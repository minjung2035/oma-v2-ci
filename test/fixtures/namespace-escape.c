/* An actual hostile descendant: double fork, new session, no inherited FD,
 * no stdio or RPC liveness. Only namespace-init death can contain this one. */
#include <unistd.h>
#include <stdlib.h>
#include <stdio.h>
#include <fcntl.h>
#include <sys/types.h>
int main(int argc, char **argv) {
  if (argc != 2) return 11;
  pid_t first = fork(); if (first < 0) return 12; if (first > 0) return 0;
  if (setsid() < 0) _exit(13);
  pid_t second = fork(); if (second < 0) _exit(14); if (second > 0) _exit(0);
  for (int fd = 0; fd < 1024; fd++) close(fd);
  int out = open(argv[1], O_CREAT | O_EXCL | O_WRONLY, 0600); if (out < 0) _exit(15);
  if (dprintf(out, "%d %d\n", getpid(), getsid(0)) <= 0 || fsync(out) != 0) _exit(16);
  close(out);
  for (;;) pause();
}
