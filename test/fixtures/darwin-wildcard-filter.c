/* Separate wildcard namespace + immutable metadata experiment. Only own
 * sockets and ff01 node-local membership on lo0; no payload is transmitted. */
#define main rejected_multicast_namespace_main
#include "darwin-multicast-fence.c"
#undef main
#include <libproc.h>
#include <sys/proc_info.h>

static void inspect_own(int fd, const char *name) {
  struct socket_fdinfo info = {0};
  int size = proc_pidfdinfo(getpid(), fd, PROC_PIDFDSOCKETINFO, &info, sizeof info);
  result("own-socket-info", size < 0 ? size : size == (int)sizeof info ? 0 : -1);
  printf("{\"kind\":\"socket\",\"phase\":\"%s\",\"size\":%d,\"expectedSize\":%zu,\"socket\":\"%llu\",\"generation\":\"%llu\",\"state\":%u}\n",
    name, size, sizeof info, (unsigned long long)info.psi.soi_so,
    (unsigned long long)info.psi.soi_proto.pri_in.insi_gencnt, info.psi.soi_state);
}
static void own_phase(int fd, const struct sockaddr_in6 *initial, const char *name) {
  struct sockaddr_in6 address = {0}; socklen_t length = sizeof address;
  int status = getsockname(fd, (struct sockaddr *)&address, &length); result("own-name", status);
  printf("{\"kind\":\"phase\",\"name\":\"%s\",\"sameAddress\":%s,\"samePort\":%s}\n", name,
    !status && !memcmp(&address.sin6_addr, &initial->sin6_addr, sizeof address.sin6_addr) ? "true" : "false",
    !status && address.sin6_port == initial->sin6_port ? "true" : "false");
  contender(initial, "wildcard-contender");
  struct sockaddr_in6 specific = *initial; specific.sin6_addr = in6addr_loopback;
  contender(&specific, "loopback-contender");
  struct sockaddr_in6 different = *initial; different.sin6_port = 0;
  contender(&different, "different-port-positive"); inspect_own(fd, name);
}
static void preexisting_specific(unsigned reuse) {
  int first = socket(AF_INET6, SOCK_DGRAM, 0), next = socket(AF_INET6, SOCK_DGRAM, 0), one = 1;
  if (first < 0 || next < 0) exit(70);
  result("specific-v6-only", setsockopt(first, IPPROTO_IPV6, IPV6_V6ONLY, &one, sizeof one));
  result("wildcard-v6-only", setsockopt(next, IPPROTO_IPV6, IPV6_V6ONLY, &one, sizeof one));
  if (reuse & 1) result("specific-initial-reuseaddr", setsockopt(first, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one));
  if (reuse & 2) result("specific-initial-reuseport", setsockopt(first, SOL_SOCKET, SO_REUSEPORT, &one, sizeof one));
  struct sockaddr_in6 address = { .sin6_len = sizeof address, .sin6_family = AF_INET6, .sin6_addr = IN6ADDR_LOOPBACK_INIT };
  int status = bind(first, (struct sockaddr *)&address, sizeof address); result("preexisting-specific-bind", status);
  socklen_t length = sizeof address;
  if (!status && !getsockname(first, (struct sockaddr *)&address, &length)) {
    address.sin6_addr = in6addr_any;
    errno = 0; status = bind(next, (struct sockaddr *)&address, sizeof address); int saved = status < 0 ? errno : 0;
    printf("{\"kind\":\"preexisting-specific\",\"reuse\":%u,\"wildcardBind\":%d,\"errno\":%d}\n", reuse, status, saved);
  }
  result("specific-close", close(first)); result("wildcard-close", close(next));
}
int main(void) {
  if (!getuid()) return 70;
  setvbuf(stdout, NULL, _IONBF, 0);
  for (unsigned reuse = 0; reuse < 4; reuse++) preexisting_specific(reuse);
  int fd = socket(AF_INET6, SOCK_DGRAM, 0), one = 1;
  if (fd < 0) { result("socket", fd); return 70; }
  result("v6-only", setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &one, sizeof one));
  struct sockaddr_in6 address = { .sin6_len = sizeof address, .sin6_family = AF_INET6 };
  int bound = bind(fd, (struct sockaddr *)&address, sizeof address); result("bind-wildcard", bound);
  if (bound) { result("close", close(fd)); puts("{\"kind\":\"complete\",\"setup\":false}"); return 0; }
  socklen_t length = sizeof address; result("initial-name", getsockname(fd, (struct sockaddr *)&address, &length));
  own_phase(fd, &address, "bound");
  const unsigned loopback = if_nametoindex("lo0");
  struct sockaddr_in6 group = { .sin6_len = sizeof group, .sin6_family = AF_INET6, .sin6_scope_id = loopback };
  arc4random_buf(group.sin6_addr.s6_addr + 2, 14); group.sin6_addr.s6_addr[0] = 0xff; group.sin6_addr.s6_addr[1] = 1;
  struct group_req membership = { .gr_interface = loopback }; memcpy(&membership.gr_group, &group, sizeof group);
  int joined = setsockopt(fd, IPPROTO_IPV6, MCAST_JOIN_GROUP, &membership, sizeof membership); result("join-node-local-filter-group", joined);
  struct sockaddr_storage sources[4] = {0}, observed[4] = {0};
  for (unsigned i = 0; i < 4; i++) {
    struct sockaddr_in6 source = { .sin6_len = sizeof source, .sin6_family = AF_INET6 };
    source.sin6_addr.s6_addr[0] = 0x20; source.sin6_addr.s6_addr[1] = 1;
    source.sin6_addr.s6_addr[2] = 0x0d; source.sin6_addr.s6_addr[3] = 0xb8; source.sin6_addr.s6_addr[7] = (unsigned char)i;
    arc4random_buf(source.sin6_addr.s6_addr + 8, 8); memcpy(&sources[i], &source, sizeof source);
  }
  if (!joined) result("set-full-identity-filter", setsourcefilter(fd, loopback, (struct sockaddr *)&group, sizeof group, MCAST_INCLUDE, 4, sources));
  struct sockaddr_in6 peer = address; peer.sin6_addr = in6addr_loopback;
  result("connect-own-loopback", connect(fd, (struct sockaddr *)&peer, sizeof peer));
  int deny = 2; result("private-deny-out", setsockopt(fd, SOL_SOCKET, 0x1081, &deny, sizeof deny));
  result("shutdown", shutdown(fd, SHUT_RDWR));
  result("disconnectx", disconnectx(fd, SAE_ASSOCID_ANY, SAE_CONNID_ANY)); own_phase(fd, &address, "frozen-disconnected");
  uint32_t mode = 0, count = 4;
  int metadata = getsourcefilter(fd, loopback, (struct sockaddr *)&group, sizeof group, &mode, &count, observed);
  result("read-full-identity-filter", metadata);
  printf("{\"kind\":\"identity\",\"mode\":%u,\"count\":%u,\"sameSources\":%s}\n", mode, count,
    !metadata && count == 4 && !memcmp(sources, observed, sizeof sources) ? "true" : "false");
  result("mutate-full-identity-filter", setsourcefilter(fd, loopback, (struct sockaddr *)&group, sizeof group, MCAST_INCLUDE, 0, sources));
  result("mutate-reuseaddr", setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one));
  result("mutate-reuseport", setsockopt(fd, SOL_SOCKET, SO_REUSEPORT, &one, sizeof one));
  result("reconnect", connect(fd, (struct sockaddr *)&peer, sizeof peer)); own_phase(fd, &address, "after-reconnect-attempt");
  /* A specific-address bind succeeded beside the wildcard holder. Test
   * whether that independent file description can copy all observable tag
   * and frozen-state fields. Never mistake duplicate state for provenance. */
  int forged = socket(AF_INET6, SOCK_DGRAM, 0);
  if (forged >= 0) {
    result("alias-v6-only", setsockopt(forged, IPPROTO_IPV6, IPV6_V6ONLY, &one, sizeof one));
    result("alias-reuseaddr-on", setsockopt(forged, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one));
    result("alias-reuseport-on", setsockopt(forged, SOL_SOCKET, SO_REUSEPORT, &one, sizeof one));
    struct sockaddr_in6 specific = address; specific.sin6_addr = in6addr_loopback;
    int alias_bound = bind(forged, (struct sockaddr *)&specific, sizeof specific); result("alias-specific-bind", alias_bound);
    if (!alias_bound) {
      result("alias-join-same-group", setsockopt(forged, IPPROTO_IPV6, MCAST_JOIN_GROUP, &membership, sizeof membership));
      result("alias-copy-full-identity", setsourcefilter(forged, loopback, (struct sockaddr *)&group, sizeof group, MCAST_INCLUDE, 4, sources));
      result("alias-connect", connect(forged, (struct sockaddr *)&peer, sizeof peer));
      int zero = 0;
      result("alias-reuseaddr-off", setsockopt(forged, SOL_SOCKET, SO_REUSEADDR, &zero, sizeof zero));
      result("alias-reuseport-off", setsockopt(forged, SOL_SOCKET, SO_REUSEPORT, &zero, sizeof zero));
      result("alias-deny-out", setsockopt(forged, SOL_SOCKET, 0x1081, &deny, sizeof deny));
      result("alias-shutdown", shutdown(forged, SHUT_RDWR));
      result("alias-disconnectx", disconnectx(forged, SAE_ASSOCID_ANY, SAE_CONNID_ANY));
      own_phase(forged, &address, "independent-alias");
      mode = 0; count = 4; memset(observed, 0, sizeof observed);
      metadata = getsourcefilter(forged, loopback, (struct sockaddr *)&group, sizeof group, &mode, &count, observed);
      result("alias-read-full-identity", metadata);
      printf("{\"kind\":\"alias-identity\",\"mode\":%u,\"count\":%u,\"sameSources\":%s}\n", mode, count,
        !metadata && count == 4 && !memcmp(sources, observed, sizeof sources) ? "true" : "false");
    }
    result("independent-alias-close", close(forged));
  }
  int alias = dup(fd); result("duplicate", alias); result("close-original", close(fd));
  if (alias >= 0) { own_phase(alias, &address, "duplicate-only"); result("last-close", close(alias)); }
  contender(&address, "after-last-close-positive"); puts("{\"kind\":\"complete\",\"setup\":true}"); return 0;
}
