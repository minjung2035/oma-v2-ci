#define _GNU_SOURCE
#include <sys/socket.h>
#include <sys/types.h>
#include <stddef.h>
#include <stdint.h>
#include <unistd.h>
#include <fcntl.h>
#include <string.h>
_Static_assert(sizeof(struct msghdr) == 56, "recvmsg ABI size");
_Static_assert(offsetof(struct msghdr, msg_iov) == 16, "recvmsg iov offset");
_Static_assert(offsetof(struct msghdr, msg_control) == 32, "recvmsg control offset");
_Static_assert(offsetof(struct msghdr, msg_controllen) == 40, "recvmsg control length offset");
_Static_assert(offsetof(struct msghdr, msg_flags) == 48, "recvmsg flags offset");
_Static_assert(sizeof(struct cmsghdr) == 16, "ancillary ABI size");
_Static_assert(sizeof(struct iovec) == 16, "iovec ABI size");
_Static_assert(sizeof(struct ucred) == 12, "credentials ABI size");
int main(int argc, char **argv) {
  if (argc != 2) return 11;
  char byte = 'x'; struct iovec vector = { .iov_base = &byte, .iov_len = 1 };
  union { char bytes[CMSG_SPACE(64 * sizeof(int))]; struct cmsghdr alignment; } control;
  memset(&control, 0, sizeof(control));
  struct msghdr message = { .msg_iov = &vector, .msg_iovlen = 1, .msg_control = control.bytes };
  struct cmsghdr *header = (struct cmsghdr *)control.bytes; header->cmsg_level = SOL_SOCKET;
  int fd = -1;
  if (strcmp(argv[1], "rights") == 0) {
    fd = open("/dev/null", O_RDONLY | O_CLOEXEC); if (fd < 0) return 12;
    int rights[64]; for (unsigned n = 0; n < 64; n++) rights[n] = fd;
    message.msg_controllen = CMSG_SPACE(sizeof(rights)); header->cmsg_len = CMSG_LEN(sizeof(rights)); header->cmsg_type = SCM_RIGHTS;
    memcpy(CMSG_DATA(header), rights, sizeof(rights));
  } else {
    struct ucred forged = { .pid = 1, .uid = getuid(), .gid = getgid() };
    message.msg_controllen = CMSG_SPACE(sizeof(forged)); header->cmsg_len = CMSG_LEN(sizeof(forged)); header->cmsg_type = SCM_CREDENTIALS;
    memcpy(CMSG_DATA(header), &forged, sizeof(forged));
  }
  ssize_t sent = sendmsg(3, &message, MSG_NOSIGNAL); if (fd >= 0) close(fd);
  return sent == 1 ? 0 : 13;
}
