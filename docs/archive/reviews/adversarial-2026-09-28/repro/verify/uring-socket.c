/* Verification for X-01: the Resident seccomp filter (src/runtime/vsock-seccomp.ts)
 * matches only the socket()/socketpair() system call numbers. io_uring's
 * IORING_OP_SOCKET (Linux >= 5.19) makes a socket without either call.
 * Prints: "<socket() result> <io_uring result>". No connection is made; the
 * socket, if made, is closed at once. */
#include <errno.h>
#include <linux/io_uring.h>
#include <stdio.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <unistd.h>
#include <stdlib.h>
#include <linux/vm_sockets.h>

#ifndef AF_VSOCK
#define AF_VSOCK 40
#endif

static const char *name(int e) { return e == EPERM ? "EPERM" : e == EAFNOSUPPORT ? "EAFNOSUPPORT" : e == ENOSYS ? "ENOSYS" : strerror(e); }

int main(int argc, char **argv) {
  int direct = socket(AF_VSOCK, SOCK_STREAM, 0);
  if (direct >= 0) { printf("made "); close(direct); } else printf("%s ", name(errno));

  struct io_uring_params p; memset(&p, 0, sizeof p);
  int ring = (int)syscall(__NR_io_uring_setup, 4, &p);
  if (ring < 0) { printf("setup:%s\n", name(errno)); return 0; }
  size_t sq_len = p.sq_off.array + p.sq_entries * sizeof(unsigned);
  size_t cq_len = p.cq_off.cqes + p.cq_entries * sizeof(struct io_uring_cqe);
  char *sq = mmap(0, sq_len, PROT_READ | PROT_WRITE, MAP_SHARED | MAP_POPULATE, ring, IORING_OFF_SQ_RING);
  char *cq = mmap(0, cq_len, PROT_READ | PROT_WRITE, MAP_SHARED | MAP_POPULATE, ring, IORING_OFF_CQ_RING);
  struct io_uring_sqe *sqes = mmap(0, p.sq_entries * sizeof(struct io_uring_sqe), PROT_READ | PROT_WRITE,
    MAP_SHARED | MAP_POPULATE, ring, IORING_OFF_SQES);
  if (sq == MAP_FAILED || cq == MAP_FAILED || sqes == MAP_FAILED) { printf("mmap:%s\n", name(errno)); return 0; }
  unsigned *tail = (unsigned *)(sq + p.sq_off.tail), *mask = (unsigned *)(sq + p.sq_off.ring_mask);
  unsigned *array = (unsigned *)(sq + p.sq_off.array);
  unsigned index = *tail & *mask;
  struct io_uring_sqe *sqe = &sqes[index]; memset(sqe, 0, sizeof *sqe);
  sqe->opcode = IORING_OP_SOCKET; sqe->fd = AF_VSOCK; sqe->off = SOCK_STREAM; sqe->len = 0;
  array[index] = index;
  __atomic_store_n(tail, *tail + 1, __ATOMIC_RELEASE);
  if (syscall(__NR_io_uring_enter, ring, 1, 1, IORING_ENTER_GETEVENTS, NULL, 0) < 0) { printf("enter:%s\n", name(errno)); return 0; }
  unsigned *chead = (unsigned *)(cq + p.cq_off.head), *cmask = (unsigned *)(cq + p.cq_off.ring_mask);
  struct io_uring_cqe *cqe = &((struct io_uring_cqe *)(cq + p.cq_off.cqes))[*chead & *cmask];
  if (cqe->res < 0) { printf("%s\n", name(-cqe->res)); return 0; }
  if (argc > 1) {
    /* connect() is not filtered: reach a listener outside the sandbox on the local CID. */
    struct sockaddr_vm to; memset(&to, 0, sizeof to);
    to.svm_family = AF_VSOCK; to.svm_cid = VMADDR_CID_LOCAL; to.svm_port = (unsigned)atoi(argv[1]);
    if (connect(cqe->res, (struct sockaddr *)&to, sizeof to) == 0) {
      char reply[64] = {0}; ssize_t n = read(cqe->res, reply, sizeof reply - 1);
      printf("made connected:%s\n", n > 0 ? reply : "(nothing)");
    } else printf("made connect:%s\n", name(errno));
  } else printf("made\n");
  close(cqe->res);
  return 0;
}
