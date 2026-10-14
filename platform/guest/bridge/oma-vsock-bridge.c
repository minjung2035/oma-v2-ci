/* oma-vsock-bridge: one host connection to one guest service (MAC-202).
 *
 * systemd accepts the connection on a reserved vsock port (ListenStream=
 * vsock::700 or vsock::701 with Accept=yes; binding a port below 1024 takes
 * CAP_NET_BIND_SERVICE, which only systemd holds in the guest) and starts one
 * instance of this program per connection with the connected socket as fd 3
 * (sd_listen_fds protocol: LISTEN_FDS=1, LISTEN_PID=<this pid>).
 *
 * This program checks that the peer is the host (CID 2) and relays bytes, both
 * ways, to the guest service's unix socket named on the command line. It reads
 * nothing it relays. Node cannot wrap an AF_VSOCK descriptor in a stream, so
 * the services speak unix sockets and this is the only code that touches vsock
 * in the guest -- the same division vfkit makes on the host side.
 *
 * The same shape as systemd-socket-proxyd, plus the one check it lacks: a
 * connection from any CID but the host's is closed unread. The kernel is built
 * without the vsock loopback transport (MAC-204), so that check is the second
 * line, not the only one.
 *
 * Exit status: 0 relayed and closed, 2 usage, 3 peer refused, 4 service
 * unreachable, 5 relay failed. */
#define _GNU_SOURCE
#include <errno.h>
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <linux/vm_sockets.h>

#ifndef OMA_ALLOWED_CID
#define OMA_ALLOWED_CID VMADDR_CID_HOST /* 2 */
#endif
#define LISTEN_FD 3
#define BUFFER_BYTES 65536

static int listened_fd_ok(void) {
  const char *fds = getenv("LISTEN_FDS"), *pid = getenv("LISTEN_PID");
  if (fds == NULL || pid == NULL || strcmp(fds, "1") != 0) return 0;
  char *end = NULL;
  long owner = strtol(pid, &end, 10);
  return end != NULL && *end == '\0' && owner == (long)getpid();
}

/* 1: the host; 0: another peer; -1: the peer could not be identified. */
static int peer_is_host(int fd) {
  struct sockaddr_vm peer;
  socklen_t length = sizeof peer;
  memset(&peer, 0, sizeof peer);
  if (getpeername(fd, (struct sockaddr *)&peer, &length) != 0 || length < sizeof peer || peer.svm_family != AF_VSOCK) return -1;
  return peer.svm_cid == OMA_ALLOWED_CID ? 1 : 0;
}

static int connect_service(const char *path) {
  struct sockaddr_un address;
  if (strlen(path) >= sizeof address.sun_path) return -1;
  int fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (fd < 0) return -1;
  memset(&address, 0, sizeof address);
  address.sun_family = AF_UNIX;
  strcpy(address.sun_path, path);
  if (connect(fd, (struct sockaddr *)&address, sizeof address) != 0) { close(fd); return -1; }
  return fd;
}

/* Writes all of `count` bytes, retrying short writes and EINTR. */
static int write_all(int fd, const char *bytes, size_t count) {
  while (count > 0) {
    ssize_t written = write(fd, bytes, count);
    if (written < 0) { if (errno == EINTR) continue; return -1; }
    bytes += written; count -= (size_t)written;
  }
  return 0;
}

/* Relays until both directions have ended. A direction ends at EOF, which is
 * passed on as a half-close so the other side sees the end of its input. */
static int relay(int a, int b) {
  static char buffer[BUFFER_BYTES];
  int open_ab = 1, open_ba = 1;
  while (open_ab || open_ba) {
    struct pollfd fds[2] = { { open_ab ? a : -1, POLLIN, 0 }, { open_ba ? b : -1, POLLIN, 0 } };
    if (poll(fds, 2, -1) < 0) { if (errno == EINTR) continue; return -1; }
    for (int side = 0; side < 2; side++) {
      int from = side == 0 ? a : b, to = side == 0 ? b : a;
      int *open = side == 0 ? &open_ab : &open_ba;
      if (!*open || (fds[side].revents & (POLLIN | POLLHUP | POLLERR)) == 0) continue;
      ssize_t got = read(from, buffer, sizeof buffer);
      if (got < 0) { if (errno == EINTR || errno == EAGAIN) continue; return -1; }
      if (got == 0) { *open = 0; shutdown(to, SHUT_WR); continue; }
      if (write_all(to, buffer, (size_t)got) != 0) return -1;
    }
  }
  return 0;
}

int main(int argc, char **argv) {
  if (argc != 2 || !listened_fd_ok()) { fprintf(stderr, "usage: oma-vsock-bridge <unix-socket> (as a socket-activated instance)\n"); return 2; }
  int host = peer_is_host(LISTEN_FD);
  if (host != 1) {
    fprintf(stderr, host == 0 ? "oma-vsock-bridge: refused a connection that is not from the host\n"
                              : "oma-vsock-bridge: refused a connection whose peer could not be identified\n");
    close(LISTEN_FD);
    return 3;
  }
  int service = connect_service(argv[1]);
  if (service < 0) { fprintf(stderr, "oma-vsock-bridge: the guest service is not reachable\n"); close(LISTEN_FD); return 4; }
  int status = relay(LISTEN_FD, service) == 0 ? 0 : 5;
  close(service); close(LISTEN_FD);
  return status;
}
