/* SDK-level observations, never a production authority or death oracle. */
#define _DARWIN_C_SOURCE 1
#include <sys/types.h>
#include <sys/event.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <unistd.h>
#include <signal.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void require(int condition, const char *label) {
  if (!condition) { perror(label); exit(2); }
}
static void process_probe(void) {
  int queue = kqueue(); require(queue >= 0, "kqueue");
  struct kevent change, answer;
  EV_SET(&change, getpid(), EVFILT_PROC, EV_ADD | EV_RECEIPT, NOTE_EXIT | NOTE_FORK | NOTE_TRACK, 0, NULL);
  int n = kevent(queue, &change, 1, &answer, 1, NULL);
  require(n == 1, "kevent receipt");
  int track_error = (answer.flags & EV_ERROR) ? (int)answer.data : 0;
  close(queue);
  int ready[2], finish[2]; require(pipe(ready) == 0 && pipe(finish) == 0, "pipe");
  pid_t leader = fork(); require(leader >= 0, "fork leader");
  if (leader == 0) {
    close(ready[0]); close(finish[1]);
    require(setpgid(0, 0) == 0, "setpgid");
    pid_t escaped = fork(); require(escaped >= 0, "fork escape");
    if (escaped == 0) {
      require(setsid() >= 0, "setsid");
      pid_t own = getpid(); require(write(ready[1], &own, sizeof own) == sizeof own, "escape ready");
      close(ready[1]);
      char byte; while (read(finish[0], &byte, 1) < 0 && errno == EINTR) {}
      _exit(0);
    }
    close(ready[1]); close(finish[0]);
    for (;;) pause();
  }
  close(ready[1]); close(finish[0]);
  pid_t escaped = 0;
  require(read(ready[0], &escaped, sizeof escaped) == sizeof escaped && escaped > 1, "read escape");
  close(ready[0]); require(kill(-leader, SIGKILL) == 0, "kill group");
  require(waitpid(leader, NULL, 0) == leader, "reap leader");
  int alive = kill(escaped, 0) == 0;
  /* The fixture owns a private completion pipe. EOF cleans the escaped child;
   * production cannot assume arbitrary programs preserve such a descriptor. */
  close(finish[1]);
  printf("\"process\":{\"noteTrackErrno\":%d,\"escapedSurvivedGroupKill\":%s}", track_error, alive ? "true" : "false");
}
static void file_probe(void) {
  require(mkdir("root", 0700) == 0, "mkdir root");
  int root = open("root", O_RDONLY | O_DIRECTORY | O_CLOEXEC); require(root >= 0, "open root");
  int lock_result = flock(root, LOCK_EX | LOCK_NB), lock_error = lock_result == 0 ? 0 : errno;
  int fd = openat(root, "file", O_CREAT | O_EXCL | O_RDWR | O_NOFOLLOW, 0600); require(fd >= 0, "create file");
  require(write(fd, "exact", 5) == 5 && fsync(fd) == 0 && fchmod(fd, 0) == 0, "write file"); close(fd);
  int pin = openat(root, "file", O_EVTONLY | O_NOFOLLOW | O_CLOEXEC);
  int pin_error = pin < 0 ? errno : 0, repair_error = 0;
  if (pin >= 0) { if (fchmod(pin, 0600) != 0) repair_error = errno; close(pin); }
  /* Isolate later namespace observations from the permission-pin failure. */
  require(fchmodat(root, "file", 0600, 0) == 0, "fixture permissions");
  require(mkfifoat(root, "fifo", 0600) == 0, "fifo");
  int fifo = openat(root, "fifo", O_EVTONLY | O_NONBLOCK | O_NOFOLLOW | O_CLOEXEC);
  struct stat info; int fifo_pin = fifo >= 0 && fstat(fifo, &info) == 0 && S_ISFIFO(info.st_mode);
  if (fifo >= 0) close(fifo);
  require(symlinkat("../outside", root, "escape") == 0, "symlink");
  int beneath_error = 0;
#ifdef O_RESOLVE_BENEATH
  int escaped = openat(root, "../outside", O_RDONLY | O_RESOLVE_BENEATH | O_NOFOLLOW_ANY);
  beneath_error = escaped < 0 ? errno : 0; if (escaped >= 0) close(escaped);
#else
  beneath_error = ENOTSUP;
#endif
  int nofollow_error = 0;
#ifdef O_NOFOLLOW_ANY
  int linked = openat(root, "escape", O_RDONLY | O_NOFOLLOW_ANY);
  nofollow_error = linked < 0 ? errno : 0; if (linked >= 0) close(linked);
#else
  nofollow_error = ENOTSUP;
#endif
  require(rename("root", "moved") == 0 && mkdir("root", 0700) == 0, "root swap");
  int held = openat(root, "file", O_RDONLY | O_NOFOLLOW); struct stat old, replacement;
  int held_root = held >= 0 && fstat(root, &old) == 0 && stat("root", &replacement) == 0 && old.st_ino != replacement.st_ino;
  if (held >= 0) close(held);
  int sync_error = fsync(root) == 0 ? 0 : errno;
  int publish = linkat(root, "file", root, "published", 0);
  int duplicate = linkat(root, "file", root, "published", 0), duplicate_error = duplicate < 0 ? errno : 0;
  close(root);
  printf(",\"files\":{\"directoryLockErrno\":%d,\"mode000PinErrno\":%d,\"repairErrno\":%d,\"fifoEventPin\":%s,\"beneathEscapeErrno\":%d,\"symlinkErrno\":%d,\"heldRootAfterSwap\":%s,\"directoryFlushErrno\":%d,\"linkPublished\":%s,\"duplicateLinkErrno\":%d}",
    lock_error, pin_error, repair_error, fifo_pin ? "true" : "false", beneath_error, nofollow_error,
    held_root ? "true" : "false", sync_error, publish == 0 ? "true" : "false", duplicate_error);
}
static void auth_probe(void) {
  int server = socket(AF_UNIX, SOCK_STREAM, 0); require(server >= 0, "socket");
  struct sockaddr_un address = {0}; address.sun_family = AF_UNIX; strcpy(address.sun_path, "peer.sock");
  require(bind(server, (struct sockaddr *)&address, sizeof address) == 0 && listen(server, 2) == 0, "listen");
  int ready[2]; require(pipe(ready) == 0, "auth pipe");
  pid_t connector = fork(); require(connector >= 0, "connector fork");
  if (connector == 0) {
    close(ready[0]); close(server);
    int client = socket(AF_UNIX, SOCK_STREAM, 0);
    require(client >= 0 && connect(client, (struct sockaddr *)&address, sizeof address) == 0, "connect");
    pid_t holder = fork(); require(holder >= 0, "holder fork");
    if (holder == 0) {
      pid_t own = getpid(); require(write(ready[1], &own, sizeof own) == sizeof own, "holder ready"); close(ready[1]);
      char byte; while (read(client, &byte, 1) < 0 && errno == EINTR) {} close(client); _exit(0);
    }
    close(client); close(ready[1]); _exit(0);
  }
  close(ready[1]); int accepted = accept(server, NULL, NULL); require(accepted >= 0, "accept");
  pid_t holder = 0, peer = 0; socklen_t length = sizeof peer;
  require(read(ready[0], &holder, sizeof holder) == sizeof holder, "holder identity"); close(ready[0]);
  require(waitpid(connector, NULL, 0) == connector, "reap connector");
  int result = getsockopt(accepted, SOL_LOCAL, LOCAL_PEERPID, &peer, &length), peer_error = result == 0 ? 0 : errno;
  uid_t uid = 0; gid_t gid = 0; int uid_error = getpeereid(accepted, &uid, &gid) == 0 ? 0 : errno;
  printf(",\"auth\":{\"peerPidErrno\":%d,\"peerUidErrno\":%d,\"peerIsOriginalConnector\":%s,\"peerIsCurrentHolder\":%s,\"holderAlive\":%s}", peer_error, uid_error,
    result == 0 && peer == connector ? "true" : "false", result == 0 && peer == holder ? "true" : "false", kill(holder, 0) == 0 ? "true" : "false");
  shutdown(accepted, SHUT_RDWR); close(accepted); close(server);
}
int main(void) {
  setbuf(stdout, NULL);
  int outside = open("outside", O_CREAT | O_EXCL | O_WRONLY, 0600); require(outside >= 0, "outside"); close(outside);
  printf("{"); process_probe(); file_probe(); auth_probe(); puts("}"); return 0;
}
