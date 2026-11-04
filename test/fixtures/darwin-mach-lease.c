/* Physical lease-candidate observation only. Never consumes the OWNER message
 * or grants a role. The owning test remains alive across keeper replacement. */
#include <mach/mach.h>
#include <servers/bootstrap.h>
#include <stdio.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc != 2) return 64;
  mach_port_t receive = MACH_PORT_NULL;
  kern_return_t result = bootstrap_check_in(bootstrap_port, argv[1], &receive);
  if (result != KERN_SUCCESS) { fprintf(stderr, "check_in=%d\n", result); return 65; }
  for (int attempt = 0; attempt < 3000; ++attempt) {
    mach_port_seqno_t sequence = 0;
    mach_msg_size_t size = 0;
    mach_msg_id_t id = 0;
    mach_msg_audit_trailer_t trailer = {0};
    mach_msg_type_number_t count = sizeof trailer;
    result = mach_port_peek(mach_task_self(), receive,
      MACH_RCV_TRAILER_TYPE(MACH_MSG_TRAILER_FORMAT_0) |
      MACH_RCV_TRAILER_ELEMENTS(MACH_RCV_TRAILER_AUDIT),
      &sequence, &size, &id, (mach_msg_trailer_info_t)&trailer, &count);
    if (result == KERN_SUCCESS) {
      /* Unlike mach_msg receive copyout, peek retains the queued trailer's
       * original minimum-size header. Its returned byte count bounds AUDIT. */
      if (count != sizeof trailer || trailer.msgh_trailer_type != MACH_MSG_TRAILER_FORMAT_0) {
        fprintf(stderr, "peek trailer count=%u type=%u stored-size=%u\n", count, trailer.msgh_trailer_type, trailer.msgh_trailer_size);
        return 66;
      }
      printf("{\"pid\":%d,\"sequence\":%u,\"size\":%u,\"id\":%d,\"returnedTrailerBytes\":%u,\"storedTrailerBytes\":%u,\"token\":[",
        getpid(), sequence, size, id, count, trailer.msgh_trailer_size);
      for (unsigned i = 0; i < 8; ++i) printf("%s%u", i ? "," : "", trailer.msgh_audit.val[i]);
      printf("]}\n"); fflush(stdout);
      for (;;) pause();
    }
    if (result != KERN_FAILURE) { fprintf(stderr, "peek=%d\n", result); return 67; }
    usleep(10000);
  }
  fprintf(stderr, "no queued OWNER message\n"); return 68;
}
