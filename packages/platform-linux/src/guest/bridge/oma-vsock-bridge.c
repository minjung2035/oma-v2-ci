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
#include <fcntl.h>
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

struct direction {
  char bytes[BUFFER_BYTES];
  size_t offset, length;
  int eof, ended;
};

/* Each direction keeps one bounded buffer. A blocked destination pauses only
 * its own source; the opposite direction can still drain and make progress.
 * Pass EOF on only after every byte read from that source has been written. */
static int relay(int a, int b) {
  const int sockets[2] = { a, b };
  struct direction flow[2] = {0};
  for (int side = 0; side < 2; side++) {
    int flags = fcntl(sockets[side], F_GETFL);
    if (flags < 0 || fcntl(sockets[side], F_SETFL, flags | O_NONBLOCK) < 0) return -1;
  }
  while (!flow[0].ended || !flow[1].ended) {
    struct pollfd fds[2];
    for (int side = 0; side < 2; side++) {
      short events = 0;
      if (!flow[side].eof && flow[side].length == 0) events |= POLLIN;
      if (flow[1 - side].length > 0) events |= POLLOUT;
      fds[side] = (struct pollfd){ events ? sockets[side] : -1, events, 0 };
    }
    if (poll(fds, 2, -1) < 0) { if (errno == EINTR) continue; return -1; }
    if ((fds[0].revents | fds[1].revents) & POLLNVAL) return -1;
    for (int side = 0; side < 2; side++) {
      struct direction *current = &flow[side];
      int from = sockets[side], to = sockets[1 - side];
      if (current->length > 0 && (fds[1 - side].revents & (POLLOUT | POLLERR | POLLHUP))) {
        ssize_t written = send(to, current->bytes + current->offset, current->length, MSG_NOSIGNAL);
        if (written < 0) {
          if (errno != EINTR && errno != EAGAIN && errno != EWOULDBLOCK) return -1;
        } else {
          if (written == 0) return -1;
          current->offset += (size_t)written;
          current->length -= (size_t)written;
          if (current->length == 0) current->offset = 0;
        }
      }
      if (!current->eof && current->length == 0 && (fds[side].revents & (POLLIN | POLLHUP | POLLERR))) {
        ssize_t got = read(from, current->bytes, sizeof current->bytes);
        if (got < 0) {
          if (errno != EINTR && errno != EAGAIN && errno != EWOULDBLOCK) return -1;
        } else if (got == 0) current->eof = 1;
        else current->length = (size_t)got;
      }
      if (current->eof && current->length == 0 && !current->ended) {
        shutdown(to, SHUT_WR);
        current->ended = 1;
      }
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
