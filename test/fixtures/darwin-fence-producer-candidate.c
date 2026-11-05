/* Experimental creator provenance only; not a Society lease implementation.
 * This program only creates a NEW no-reuse wildcard socket. It never accepts
 * a caller's socket or claims that matching socket metadata proves creation. */
#define _DARWIN_C_SOURCE 1
#include <mach/mach.h>
#include <mach/task_special_ports.h>
#include <sys/socket.h>
#include <sys/proc_info.h>
#include <sys/ptrace.h>
#include <netinet/in.h>
#include <libproc.h>
#include <errno.h>
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

extern int fileport_makeport(int, mach_port_t *);
static void require(int okay, const char *operation) {
  if (!okay) { perror(operation); exit(70); }
}
static void kernel(kern_return_t status, const char *operation) {
  if (status) { fprintf(stderr, "%s=%d\n", operation, status); exit(71); }
}
struct publication { mach_msg_header_t head; uint8_t identity[32]; uint64_t socket, generation; uint32_t port; uint32_t info_size, socket_offset, generation_offset; };
_Static_assert(sizeof(struct publication) == 88, "fixed publication layout");
int main(int argc, char **argv) {
  if ((argc != 3 && (argc != 4 || strcmp(argv[3], "bootstrap-peer"))) || getuid() == 0 || strlen(argv[1]) != 64) return 64;
  struct publication message = {0};
  for (unsigned i = 0; i < 32; ++i) {
    unsigned value; char pair[3] = { argv[1][2*i], argv[1][2*i+1], 0 };
    if (strspn(pair, "0123456789abcdef") != 2 || sscanf(pair, "%x", &value) != 1) return 64;
    message.identity[i] = (uint8_t)value;
  }
  char *end = NULL; errno = 0; unsigned long port = strtoul(argv[2], &end, 10);
  if (errno || !*argv[2] || *end || port > 65535) return 64;
  require(ptrace(PT_DENY_ATTACH, 0, NULL, 0) == 0, "deny tracing");
  mach_port_t destination = MACH_PORT_NULL;
  if (argc == 4) {
    kernel(task_get_bootstrap_port(mach_task_self(), &destination), "private spawn peer");
  } else {
  mach_port_array_t inherited = NULL; mach_msg_type_number_t count = 0;
  kernel(mach_ports_lookup(mach_task_self(), &inherited, &count), "peer lookup");
  if (count != 3 || !MACH_PORT_VALID(inherited[2])) return 65;
  destination = inherited[2];
  for (unsigned i = 0; i < 2; ++i) if (MACH_PORT_VALID(inherited[i]))
    kernel(mach_port_deallocate(mach_task_self(), inherited[i]), "unused inherited capability");
  kernel(vm_deallocate(mach_task_self(), (vm_address_t)inherited, count * sizeof(*inherited)), "peer array");
  }
  int fd = socket(AF_INET6, SOCK_DGRAM, 0), one = 1;
  require(fd >= 0, "socket");
  require(setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &one, sizeof one) == 0, "v6-only");
  struct sockaddr_in6 address = { .sin6_len=sizeof address, .sin6_family=AF_INET6, .sin6_port=htons((uint16_t)port) };
  if (bind(fd, (struct sockaddr *)&address, sizeof address)) {
    int saved = errno; close(fd); printf("{\"created\":false,\"errno\":%d}\n", saved); return 0;
  }
  socklen_t length = sizeof address;
  require(getsockname(fd, (struct sockaddr *)&address, &length) == 0, "bound name");
  message.port = ntohs(address.sin6_port);
  struct sockaddr_in6 peer = address; peer.sin6_addr = in6addr_loopback;
  require(connect(fd, (struct sockaddr *)&peer, sizeof peer) == 0, "connect own port");
  int deny = 2;
  require(setsockopt(fd, SOL_SOCKET, 0x1081, &deny, sizeof deny) == 0, "deny out");
  require(shutdown(fd, SHUT_RDWR) == 0, "shutdown");
  require(disconnectx(fd, SAE_ASSOCID_ANY, SAE_CONNID_ANY) == 0, "disconnect");
  struct socket_fdinfo info = {0};
  require(proc_pidfdinfo(getpid(), fd, PROC_PIDFDSOCKETINFO, &info, sizeof info) == sizeof info, "own socket instance");
  message.info_size = sizeof info;
  message.socket_offset = offsetof(struct socket_fdinfo, psi.soi_so);
  message.generation_offset = offsetof(struct socket_fdinfo, psi.soi_proto.pri_in.insi_gencnt);
  message.socket = info.psi.soi_so; message.generation = info.psi.soi_proto.pri_in.insi_gencnt;
  require(message.socket && message.generation, "nonzero socket instance");
  mach_port_t file = MACH_PORT_NULL;
  require(fileport_makeport(fd, &file) == 0, "fileport");
  require(close(fd) == 0, "drop original socket");
  message.head.msgh_bits = MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, MACH_MSG_TYPE_MOVE_SEND);
  message.head.msgh_size = sizeof message; message.head.msgh_remote_port = destination;
  message.head.msgh_local_port = file; message.head.msgh_id = 0x4f4d4170;
  kernel(mach_msg(&message.head, MACH_SEND_MSG | MACH_SEND_TIMEOUT, sizeof message, 0, MACH_PORT_NULL, 1000, MACH_PORT_NULL), "publish created instance");
  kernel(mach_port_deallocate(mach_task_self(), destination), "peer release");
  /* No socket reference remains here. The observer may test last-close while
   * this fixed producer is still alive. FD3 is a private lifetime pipe only. */
  puts("{\"created\":true,\"producerRetainsSocket\":false}"); fflush(stdout);
  char ignored; ssize_t received;
  do { received = read(3, &ignored, 1); } while (received > 0 || (received < 0 && errno == EINTR));
  require(received == 0, "lifetime pipe EOF");
  return 0;
}
