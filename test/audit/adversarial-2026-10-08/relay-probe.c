/* Exact production relay over Unix socketpairs; no native VM/vsock qualification. */
#define main oma_bridge_main
#include "../../../platform/guest/bridge/oma-vsock-bridge.c"
#undef main
#include <sys/wait.h>
#include <signal.h>
#include <time.h>

static long cpu_ticks(pid_t pid) {
  char path[100], line[4096];
  snprintf(path, sizeof path, "/proc/%ld/stat", (long)pid);
  FILE *file = fopen(path, "r");
  if (!file || !fgets(line, sizeof line, file)) return -1;
  fclose(file);
  char *cursor = strrchr(line, ')');
  if (!cursor) return -1;
  cursor += 2;
  int field = 3;
  long ticks = 0;
  for (char *token = strtok(cursor, " "); token; token = strtok(NULL, " "), field++)
    if (field == 14 || field == 15) ticks += strtol(token, NULL, 10);
  return ticks;
}

int main(void) {
  int a[2], b[2];
  if (socketpair(AF_UNIX, SOCK_STREAM, 0, a) || socketpair(AF_UNIX, SOCK_STREAM, 0, b)) return 2;
  pid_t pid = fork();
  if (pid < 0) return 2;
  if (pid == 0) {
    close(a[1]); close(b[1]);
    _exit(relay(a[0], b[0]) == 0 ? 0 : 5);
  }
  close(a[0]); close(b[0]);
  struct timespec interval = { .tv_sec = 0, .tv_nsec = 400000000 };
  long begin = cpu_ticks(pid);
  nanosleep(&interval, NULL);
  long idle = cpu_ticks(pid);
  close(a[1]);
  nanosleep(&interval, NULL);
  long closed = cpu_ticks(pid);
  printf("{\"windowMs\":400,\"ticksPerSecond\":%ld,\"idleTicks\":%ld,\"afterPeerClosedTicks\":%ld}\n",
    sysconf(_SC_CLK_TCK), idle - begin, closed - idle);
  close(b[1]);
  kill(pid, SIGKILL);
  waitpid(pid, NULL, 0);
  return (idle - begin <= 2 && closed - idle >= 10) ? 0 : 1;
}
