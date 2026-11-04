/* Kernel option-freeze experiment only; not a Society lease implementation. */
#include <sys/socket.h>
#include <netinet/in.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
static void checked(int valid, const char *operation) {
  if (!valid) { perror(operation); exit(70); }
}
static void excluded(const struct sockaddr_in *address) {
  int other = socket(AF_INET, SOCK_DGRAM, 0), one = 1;
  checked(other >= 0, "contender socket");
  checked(setsockopt(other, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one) == 0, "contender reuseaddr");
  checked(setsockopt(other, SOL_SOCKET, SO_REUSEPORT, &one, sizeof one) == 0, "contender reuseport");
  errno = 0; int result = bind(other, (const struct sockaddr *)address, sizeof *address), saved = errno;
  checked(result == -1 && saved == EADDRINUSE, "contender remains excluded");
  checked(close(other) == 0, "contender close");
}
static void frozen(int fd, const struct sockaddr_in *address) {
  const int options[] = { SO_REUSEADDR, SO_REUSEPORT, SO_REUSESHAREUID };
  int one = 1;
  for (unsigned i = 0; i < sizeof options / sizeof options[0]; ++i) {
    errno = 0; int result = setsockopt(fd, SOL_SOCKET, options[i], &one, sizeof one), saved = errno;
    checked(result == -1 && saved == EINVAL, "reuse option frozen"); excluded(address);
  }
  struct so_np_extensions escape = { .npx_flags = SONPX_SETOPTSHUT, .npx_mask = SONPX_SETOPTSHUT };
  errno = 0; int result = setsockopt(fd, SOL_SOCKET, SO_NP_EXTENSIONS, &escape, sizeof escape), saved = errno;
  checked(result == -1 && saved == EINVAL, "post-shutdown extension frozen"); excluded(address);
}
int main(void) {
  checked(getuid() > 0, "ordinary uid");
  int fd = socket(AF_INET, SOCK_DGRAM, 0); checked(fd >= 0, "candidate socket");
  struct sockaddr_in address = { .sin_len = sizeof address, .sin_family = AF_INET, .sin_addr.s_addr = htonl(INADDR_ANY) };
  checked(bind(fd, (struct sockaddr *)&address, sizeof address) == 0, "candidate bind");
  socklen_t length = sizeof address; checked(getsockname(fd, (struct sockaddr *)&address, &length) == 0, "candidate address");
  struct sockaddr_in peer = address; peer.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  checked(connect(fd, (struct sockaddr *)&peer, sizeof peer) == 0, "candidate connect");
  checked(shutdown(fd, SHUT_RDWR) == 0, "freeze both directions"); frozen(fd, &address);
  struct sockaddr disconnect = { .sa_len = sizeof disconnect, .sa_family = AF_UNSPEC };
  checked(connect(fd, &disconnect, sizeof disconnect) == 0, "disconnect frozen socket"); frozen(fd, &address);
  checked(connect(fd, (struct sockaddr *)&peer, sizeof peer) == 0, "reconnect frozen socket"); frozen(fd, &address);
  int alias = dup(fd); checked(alias >= 0 && close(fd) == 0, "retain only duplicate"); frozen(alias, &address);
  checked(close(alias) == 0, "last reference close");
  int next = socket(AF_INET, SOCK_DGRAM, 0); checked(next >= 0, "next owner socket");
  checked(bind(next, (struct sockaddr *)&address, sizeof address) == 0 && close(next) == 0, "last close releases binding");
  printf("{\"uid\":%u,\"phases\":4,\"frozenMutations\":16,\"contendersExcluded\":16,\"lastCloseReleased\":true}\n", getuid());
  return 0;
}
