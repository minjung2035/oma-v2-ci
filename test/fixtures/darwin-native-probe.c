/* SDK-level observations, never a production authority or death oracle. */
#define _DARWIN_C_SOURCE 1
#include <sys/types.h>
#include <sys/event.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <sys/file.h>
#include <sys/wait.h>
#include <sys/proc_info.h>
#include <mach/message.h>
#include <dirent.h>
#include <stddef.h>
#include <fcntl.h>
#include <unistd.h>
#include <signal.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* The production FFI readers reject a different ABI; bind their offsets to
 * each actual runner SDK rather than assuming the layout from a header copy. */
_Static_assert(sizeof(struct proc_bsdinfo) == 136, "proc_bsdinfo size");
_Static_assert(offsetof(struct proc_bsdinfo, pbi_pid) == 12, "proc PID offset");
_Static_assert(offsetof(struct proc_bsdinfo, pbi_ppid) == 16, "proc parent offset");
_Static_assert(offsetof(struct proc_bsdinfo, pbi_start_tvsec) == 120, "proc start seconds offset");
_Static_assert(offsetof(struct proc_bsdinfo, pbi_start_tvusec) == 128, "proc start micros offset");
_Static_assert(offsetof(struct dirent, d_reclen) == 16, "dirent record size offset");
_Static_assert(offsetof(struct dirent, d_namlen) == 18, "dirent name size offset");
_Static_assert(offsetof(struct dirent, d_name) == 21, "dirent name offset");
_Static_assert(sizeof(struct stat) == 144, "64-bit inode stat size");
_Static_assert(sizeof(time_t) == 8 && sizeof(long) == 8, "64-bit stat timespec fields");
_Static_assert(sizeof(dev_t) == 4 && sizeof(mode_t) == 2 && sizeof(nlink_t) == 2, "stat scalar widths");
_Static_assert(sizeof(ino_t) == 8 && sizeof(off_t) == 8 && sizeof(blkcnt_t) == 8, "stat large scalar widths");
_Static_assert(offsetof(struct stat, st_dev) == 0, "stat device offset");
_Static_assert(offsetof(struct stat, st_mode) == 4, "stat mode offset");
_Static_assert(offsetof(struct stat, st_nlink) == 6, "stat links offset");
_Static_assert(offsetof(struct stat, st_ino) == 8, "stat inode offset");
_Static_assert(offsetof(struct stat, st_uid) == 16, "stat UID offset");
_Static_assert(offsetof(struct stat, st_gid) == 20, "stat GID offset");
_Static_assert(offsetof(struct stat, st_rdev) == 24, "stat special device offset");
_Static_assert(offsetof(struct stat, st_atimespec) == 32, "stat atime offset");
_Static_assert(offsetof(struct stat, st_mtimespec) == 48, "stat mtime offset");
_Static_assert(offsetof(struct stat, st_ctimespec) == 64, "stat ctime offset");
_Static_assert(offsetof(struct stat, st_birthtimespec) == 80, "stat birthtime offset");
_Static_assert(offsetof(struct stat, st_size) == 96, "stat size offset");
_Static_assert(offsetof(struct stat, st_blocks) == 104, "stat blocks offset");
_Static_assert(offsetof(struct stat, st_blksize) == 112, "stat blocksize offset");
_Static_assert(AT_SYMLINK_NOFOLLOW == 0x20, "stat no-follow flag");

static void require(int condition, const char *label) {
  if (!condition) { perror(label); exit(2); }
}
#include "descriptor-capabilities.h"
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
static void send_descriptor(int transport, int fd) {
  union { struct cmsghdr alignment; unsigned char bytes[CMSG_SPACE(sizeof(int))]; } control = {0};
  char marker = 'f'; struct iovec vector = { &marker, 1 };
  struct msghdr message = {0}; message.msg_iov = &vector; message.msg_iovlen = 1;
  message.msg_control = control.bytes; message.msg_controllen = sizeof control.bytes;
  struct cmsghdr *header = CMSG_FIRSTHDR(&message); require(header != NULL, "rights header");
  header->cmsg_level = SOL_SOCKET; header->cmsg_type = SCM_RIGHTS; header->cmsg_len = CMSG_LEN(sizeof fd);
  memcpy(CMSG_DATA(header), &fd, sizeof fd);
  require(sendmsg(transport, &message, 0) == 1, "send rights");
}
static int receive_descriptor(int transport) {
  union { struct cmsghdr alignment; unsigned char bytes[CMSG_SPACE(sizeof(int))]; } control = {0};
  char marker = 0; struct iovec vector = { &marker, 1 };
  struct msghdr message = {0}; message.msg_iov = &vector; message.msg_iovlen = 1;
  message.msg_control = control.bytes; message.msg_controllen = sizeof control.bytes;
  require(recvmsg(transport, &message, 0) == 1 && !(message.msg_flags & MSG_CTRUNC), "receive rights");
  struct cmsghdr *header = CMSG_FIRSTHDR(&message);
  require(marker == 'f' && header != NULL && header->cmsg_level == SOL_SOCKET && header->cmsg_type == SCM_RIGHTS &&
    header->cmsg_len == CMSG_LEN(sizeof(int)), "received rights shape");
  int fd = -1; memcpy(&fd, CMSG_DATA(header), sizeof fd); require(fd >= 0, "received descriptor"); return fd;
}
static void transferred_auth_probe(void) {
  int transfer[2], hold[2];
  require(socketpair(AF_UNIX, SOCK_STREAM, 0, transfer) == 0 && pipe(hold) == 0, "transfer channels");
  int server = socket(AF_UNIX, SOCK_STREAM, 0); require(server >= 0, "transfer listener");
  struct sockaddr_un address = {0}; address.sun_family = AF_UNIX; strcpy(address.sun_path, "transfer.sock");
  require(bind(server, (struct sockaddr *)&address, sizeof address) == 0 && listen(server, 2) == 0, "transfer listen");
  /* Holder and connector are siblings. The holder existed before the socket
   * was connected and received it solely through SCM_RIGHTS, not fork. */
  pid_t holder = fork(); require(holder >= 0, "unrelated holder");
  if (holder == 0) {
    close(transfer[0]); close(server); close(hold[0]); close(hold[1]);
    int client = receive_descriptor(transfer[1]); close(transfer[1]);
    require(write(client, "h", 1) == 1, "holder message");
    char marker; while (read(client, &marker, 1) < 0 && errno == EINTR) {}
    close(client); _exit(0);
  }
  pid_t connector = fork(); require(connector >= 0, "transfer connector");
  if (connector == 0) {
    close(transfer[1]); close(server); close(hold[1]);
    int client = socket(AF_UNIX, SOCK_STREAM, 0);
    require(client >= 0 && connect(client, (struct sockaddr *)&address, sizeof address) == 0, "transfer connect");
    send_descriptor(transfer[0], client); close(transfer[0]);
    char marker; while (read(hold[0], &marker, 1) < 0 && errno == EINTR) {}
    close(hold[0]); close(client); _exit(0);
  }
  close(transfer[0]); close(transfer[1]); close(hold[0]);
  int accepted = accept(server, NULL, NULL); require(accepted >= 0, "accept transferred socket");
  char marker = 0; require(read(accepted, &marker, 1) == 1 && marker == 'h', "actual unrelated sender");
  pid_t live_peer = 0, dead_peer = 0; socklen_t length = sizeof live_peer;
  int live_error = getsockopt(accepted, SOL_LOCAL, LOCAL_PEERPID, &live_peer, &length) == 0 ? 0 : errno;
  close(hold[1]); require(waitpid(connector, NULL, 0) == connector, "reap transferred connector");
  length = sizeof dead_peer;
  int dead_error = getsockopt(accepted, SOL_LOCAL, LOCAL_PEERPID, &dead_peer, &length) == 0 ? 0 : errno;
  printf(",\"socketTransfer\":{\"holderIsConnectorDescendant\":false,\"messageFromHolder\":true,\"liveConnectorPeerErrno\":%d,\"liveConnectorPeerIsConnector\":%s,\"liveConnectorPeerIsHolder\":%s,\"deadConnectorPeerErrno\":%d,\"deadConnectorPeerIsConnector\":%s,\"deadConnectorPeerIsHolder\":%s,\"holderAlive\":%s}",
    live_error, live_error == 0 && live_peer == connector ? "true" : "false", live_error == 0 && live_peer == holder ? "true" : "false",
    dead_error, dead_error == 0 && dead_peer == connector ? "true" : "false", dead_error == 0 && dead_peer == holder ? "true" : "false",
    kill(holder, 0) == 0 ? "true" : "false");
  shutdown(accepted, SHUT_RDWR); close(accepted); close(server);
  require(waitpid(holder, NULL, 0) == holder, "reap transferred holder");
}
/* A byte stream can already contain one sender's request when another process
 * receives the descriptor. Record the credential independently before/after
 * reading that first byte; current endpoint ownership is not per-byte origin. */
static void queued_auth_probe(void) {
  int transfer[2], ready[2], hold[2];
  require(socketpair(AF_UNIX, SOCK_STREAM, 0, transfer) == 0 && pipe(ready) == 0 && pipe(hold) == 0, "queued channels");
  int server = socket(AF_UNIX, SOCK_STREAM, 0); require(server >= 0, "queued listener");
  struct sockaddr_un address = {0}; address.sun_family = AF_UNIX; strcpy(address.sun_path, "queued.sock");
  require(bind(server, (struct sockaddr *)&address, sizeof address) == 0 && listen(server, 2) == 0, "queued listen");
  pid_t holder = fork(); require(holder >= 0, "queued holder");
  if (holder == 0) {
    close(server); close(transfer[0]); close(ready[0]); close(hold[0]); close(hold[1]);
    int client = receive_descriptor(transfer[1]); close(transfer[1]);
    require(write(client, "h", 1) == 1 && write(ready[1], "r", 1) == 1, "queued holder wrote"); close(ready[1]);
    char marker; while (read(client, &marker, 1) < 0 && errno == EINTR) {}
    close(client); _exit(0);
  }
  pid_t connector = fork(); require(connector >= 0, "queued connector");
  if (connector == 0) {
    close(server); close(transfer[1]); close(ready[0]); close(ready[1]); close(hold[1]);
    int client = socket(AF_UNIX, SOCK_STREAM, 0);
    require(client >= 0 && connect(client, (struct sockaddr *)&address, sizeof address) == 0, "queued connect");
    require(write(client, "c", 1) == 1, "request queued before transfer");
    send_descriptor(transfer[0], client); close(transfer[0]);
    char marker; while (read(hold[0], &marker, 1) < 0 && errno == EINTR) {}
    close(hold[0]); close(client); _exit(0);
  }
  close(transfer[0]); close(transfer[1]); close(ready[1]); close(hold[0]);
  int accepted = accept(server, NULL, NULL); require(accepted >= 0, "queued accept");
  char marker; require(read(ready[0], &marker, 1) == 1 && marker == 'r', "both writers completed"); close(ready[0]);
  pid_t before = 0, after = 0; socklen_t length = sizeof before;
  int before_error = getsockopt(accepted, SOL_LOCAL, LOCAL_PEERPID, &before, &length) == 0 ? 0 : errno;
  /* LOCAL_PEERTOKEN is another endpoint observation, not per-message origin.
   * Keep its raw SDK audit token before/after reading the connector's byte. */
  audit_token_t token_before = {0}, token_after = {0};
  socklen_t token_before_length = sizeof token_before, token_after_length = sizeof token_after;
  int token_before_error = getsockopt(accepted, SOL_LOCAL, LOCAL_PEERTOKEN, &token_before, &token_before_length) == 0 ? 0 : errno;
  char first = 0, second = 0;
  require(read(accepted, &first, 1) == 1 && first == 'c', "first queued byte is connector request");
  length = sizeof after;
  int after_error = getsockopt(accepted, SOL_LOCAL, LOCAL_PEERPID, &after, &length) == 0 ? 0 : errno;
  int token_after_error = getsockopt(accepted, SOL_LOCAL, LOCAL_PEERTOKEN, &token_after, &token_after_length) == 0 ? 0 : errno;
  require(read(accepted, &second, 1) == 1 && second == 'h', "second queued byte is holder write");
  printf(",\"queuedTransfer\":{\"firstByteFromConnector\":true,\"secondByteFromHolder\":true,\"bothWritersAlive\":%s,\"beforeReadErrno\":%d,\"beforeReadPeerIsConnector\":%s,\"beforeReadPeerIsHolder\":%s,\"afterFirstReadErrno\":%d,\"afterFirstReadPeerIsConnector\":%s,\"afterFirstReadPeerIsHolder\":%s",
    kill(connector, 0) == 0 && kill(holder, 0) == 0 ? "true" : "false", before_error,
    before_error == 0 && before == connector ? "true" : "false", before_error == 0 && before == holder ? "true" : "false",
    after_error, after_error == 0 && after == connector ? "true" : "false", after_error == 0 && after == holder ? "true" : "false");
  printf(",\"beforeReadPeerTokenErrno\":%d,\"beforeReadPeerTokenBytes\":%u,\"beforeReadPeerToken\":[", token_before_error, (unsigned int)token_before_length);
  for (size_t i = 0; i < sizeof token_before.val / sizeof token_before.val[0]; i++) printf("%s%u", i == 0 ? "" : ",", token_before.val[i]);
  printf("],\"afterFirstReadPeerTokenErrno\":%d,\"afterFirstReadPeerTokenBytes\":%u,\"afterFirstReadPeerToken\":[", token_after_error, (unsigned int)token_after_length);
  for (size_t i = 0; i < sizeof token_after.val / sizeof token_after.val[0]; i++) printf("%s%u", i == 0 ? "" : ",", token_after.val[i]);
  printf("]}");
  close(hold[1]); require(waitpid(connector, NULL, 0) == connector, "queued connector reap");
  shutdown(accepted, SHUT_RDWR); close(accepted); close(server);
  require(waitpid(holder, NULL, 0) == holder, "queued holder reap");
}
int main(int argc, char **argv) {
  if (descriptor_exec_target(argc, argv)) return 0;
  const char *names[] = { "process", "files", "auth", "socket-transfer", "queued-transfer", "file-descriptors" };
  void (*probes[])(void) = { process_probe, file_probe, auth_probe, transferred_auth_probe, queued_auth_probe };
  require(argc == 2, "one independent probe case required");
  int selected = -1;
  for (int i = 0; i < 6; ++i) if (strcmp(argv[1], names[i]) == 0) selected = i;
  require(selected >= 0, "unknown probe case");
  setbuf(stdout, NULL);
  if (selected == 1) {
    int outside = open("outside", O_CREAT | O_EXCL | O_WRONLY, 0600);
    require(outside >= 0, "outside"); close(outside);
  }
  printf("{\"case\":\"%s\"", names[selected]);
  if (selected == 0) putchar(',');
  if (selected == 5) descriptor_capabilities_probe(argv[0]); else probes[selected]();
  puts("}"); return 0;
}
