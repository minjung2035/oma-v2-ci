/* Own-socket namespace/metadata experiment. No production lease or packets. */
#define _DARWIN_C_SOURCE 1
#include <sys/socket.h>
#include <netinet/in.h>
#include <net/if.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void result(const char *operation, int status) {
  int saved = status < 0 ? errno : 0;
  printf("{\"kind\":\"call\",\"operation\":\"%s\",\"result\":%d,\"errno\":%d}\n", operation, status, saved);
}
static void contender(const struct sockaddr_in6 *address, const char *name) {
  int fd = socket(AF_INET6, SOCK_DGRAM, 0), one = 1;
  if (fd < 0) { result("contender-socket", fd); return; }
  int status = setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
  if (!status) status = setsockopt(fd, SOL_SOCKET, SO_REUSEPORT, &one, sizeof one);
  if (!status) status = bind(fd, (const struct sockaddr *)address, sizeof *address);
  result(name, status); result("contender-close", close(fd));
}
static void phase(int fd, const struct sockaddr_in6 *initial, const char *name) {
  struct sockaddr_in6 address = {0}; socklen_t length = sizeof address;
  int status = getsockname(fd, (struct sockaddr *)&address, &length);
  result("getsockname", status);
  printf("{\"kind\":\"phase\",\"name\":\"%s\",\"sameAddress\":%s,\"samePort\":%s,\"port\":%u}\n", name,
    !status && !memcmp(&address.sin6_addr, &initial->sin6_addr, sizeof address.sin6_addr) ? "true" : "false",
    !status && address.sin6_port == initial->sin6_port ? "true" : "false", ntohs(address.sin6_port));
  contender(initial, "same-name-contender");
  struct sockaddr_in6 different = *initial; different.sin6_addr.s6_addr[15] ^= 1;
  contender(&different, "different-name-positive");
}
int main(int argc, char **argv) {
  if (argc != 2 || (strcmp(argv[1], "public") && strcmp(argv[1], "restricted")) || !getuid()) return 70;
  setvbuf(stdout, NULL, _IONBF, 0);
  int fd = socket(AF_INET6, SOCK_DGRAM, 0), one = 1;
  if (fd < 0) { result("socket", fd); return 70; }
  result("v6-only", setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &one, sizeof one));
  const unsigned loopback = if_nametoindex("lo0");
  struct sockaddr_in6 address = { .sin6_len = sizeof address, .sin6_family = AF_INET6, .sin6_scope_id = loopback };
  arc4random_buf(address.sin6_addr.s6_addr + 2, 14); address.sin6_addr.s6_addr[0] = 0xff; address.sin6_addr.s6_addr[1] = 1;
  int bound = bind(fd, (struct sockaddr *)&address, sizeof address); result("bind-node-local-multicast", bound);
  if (bound) { result("close", close(fd)); puts("{\"kind\":\"complete\",\"setup\":false}"); return 0; }
  socklen_t length = sizeof address; result("initial-name", getsockname(fd, (struct sockaddr *)&address, &length));
  phase(fd, &address, "bound");
  struct group_req membership = { .gr_interface = loopback };
  struct sockaddr_in6 group = address; group.sin6_port = 0; memcpy(&membership.gr_group, &group, sizeof group);
  int joined = setsockopt(fd, IPPROTO_IPV6, MCAST_JOIN_GROUP, &membership, sizeof membership); result("join-own-loopback-group", joined);
  struct sockaddr_storage sources[4] = {0}, observed[4] = {0};
  for (unsigned i = 0; i < 4; i++) {
    struct sockaddr_in6 source = { .sin6_len = sizeof source, .sin6_family = AF_INET6 };
    source.sin6_addr.s6_addr[0] = 0x20; source.sin6_addr.s6_addr[1] = 1;
    source.sin6_addr.s6_addr[2] = 0x0d; source.sin6_addr.s6_addr[3] = 0xb8; source.sin6_addr.s6_addr[7] = (unsigned char)i;
    arc4random_buf(source.sin6_addr.s6_addr + 8, 8); memcpy(&sources[i], &source, sizeof source);
  }
  if (!joined) result("set-full-identity-filter", setsourcefilter(fd, loopback, (struct sockaddr *)&group, sizeof group, MCAST_INCLUDE, 4, sources));
  struct sockaddr_in6 peer = { .sin6_len = sizeof peer, .sin6_family = AF_INET6, .sin6_port = address.sin6_port, .sin6_addr = IN6ADDR_LOOPBACK_INIT };
  result("connect-own-loopback", connect(fd, (struct sockaddr *)&peer, sizeof peer));
  if (!strcmp(argv[1], "restricted")) {
    /* Private selector, explicit comparison only; not a public SDK claim. */
    int deny = 2; result("private-deny-out", setsockopt(fd, SOL_SOCKET, 0x1081, &deny, sizeof deny));
  }
  result("shutdown", shutdown(fd, SHUT_RDWR)); phase(fd, &address, "shutdown");
  result("disconnectx", disconnectx(fd, SAE_ASSOCID_ANY, SAE_CONNID_ANY)); phase(fd, &address, "disconnected");
  result("mutate-reuseaddr", setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one));
  result("mutate-reuseport", setsockopt(fd, SOL_SOCKET, SO_REUSEPORT, &one, sizeof one));
  uint32_t mode = 0, count = 4;
  int metadata = getsourcefilter(fd, loopback, (struct sockaddr *)&group, sizeof group, &mode, &count, observed);
  result("read-full-identity-filter", metadata);
  printf("{\"kind\":\"identity\",\"mode\":%u,\"count\":%u,\"sameSources\":%s}\n", mode, count,
    !metadata && count == 4 && !memcmp(sources, observed, sizeof sources) ? "true" : "false");
  result("mutate-full-identity-filter", setsourcefilter(fd, loopback, (struct sockaddr *)&group, sizeof group, MCAST_INCLUDE, 0, sources));
  result("reconnect", connect(fd, (struct sockaddr *)&peer, sizeof peer)); phase(fd, &address, "reconnected");
  int alias = dup(fd); result("duplicate", alias);
  result("close-original", close(fd));
  if (alias >= 0) { phase(alias, &address, "duplicate-only"); result("last-close", close(alias)); }
  contender(&address, "after-last-close-positive"); puts("{\"kind\":\"complete\",\"setup\":true}"); return 0;
}
