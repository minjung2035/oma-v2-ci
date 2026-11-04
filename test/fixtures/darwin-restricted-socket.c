/* New composition experiment, not the rejected shutdown-only candidate.
 * SO_RESTRICTIONS is a PRIVATE XNU selector, absent from the public SDK.
 * Values: f6217f891ac0bb64f3d375211650a4c1ff8ca1ea bsd/sys/socket_private.h.
 * No production code or entitlement is added by this fixture. */
#define main rejected_shutdown_only_main
#include "darwin-shutdown-socket.c"
#undef main
#define OMA_SO_RESTRICTIONS 0x1081
#define OMA_SO_RESTRICT_DENY_OUT 0x2
int main(void) {
  checked(getuid() > 0, "ordinary uid");
  int fd = socket(AF_INET, SOCK_DGRAM, 0); checked(fd >= 0, "candidate socket");
  struct sockaddr_in address = { .sin_len = sizeof address, .sin_family = AF_INET, .sin_addr.s_addr = htonl(INADDR_ANY) };
  checked(bind(fd, (struct sockaddr *)&address, sizeof address) == 0, "candidate bind");
  socklen_t length = sizeof address; checked(getsockname(fd, (struct sockaddr *)&address, &length) == 0, "candidate address");
  struct sockaddr_in peer = address; peer.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  checked(connect(fd, (struct sockaddr *)&peer, sizeof peer) == 0, "candidate connect");
  int restriction = OMA_SO_RESTRICT_DENY_OUT;
  checked(setsockopt(fd, SOL_SOCKET, OMA_SO_RESTRICTIONS, &restriction, sizeof restriction) == 0, "deny future connect");
  checked(shutdown(fd, SHUT_RDWR) == 0, "freeze options");
  checked(disconnectx(fd, SAE_ASSOCID_ANY, SAE_CONNID_ANY) == 0, "disconnect without outbound connect");
  frozen(fd, &address);
  errno = 0; int result = connect(fd, (struct sockaddr *)&peer, sizeof peer), saved = errno;
  checked(result == -1 && saved == EPERM, "ordinary reconnect denied"); frozen(fd, &address);
  sa_endpoints_t endpoints = { .sae_dstaddr = (struct sockaddr *)&peer, .sae_dstaddrlen = sizeof peer };
  errno = 0; result = connectx(fd, &endpoints, SAE_ASSOCID_ANY, 0, NULL, 0, NULL, NULL); saved = errno;
  checked(result == -1 && saved == EPERM, "extended reconnect denied"); frozen(fd, &address);
  int alias = dup(fd); checked(alias >= 0 && close(fd) == 0, "retain only duplicate"); frozen(alias, &address);
  checked(close(alias) == 0, "last reference close");
  int next = socket(AF_INET, SOCK_DGRAM, 0); checked(next >= 0, "next owner socket");
  checked(bind(next, (struct sockaddr *)&address, sizeof address) == 0 && close(next) == 0, "last close releases binding");
  printf("{\"uid\":%u,\"phases\":4,\"frozenMutations\":16,\"contendersExcluded\":16,\"reconnectDenied\":2,\"lastCloseReleased\":true}\n", getuid());
  return 0;
}
