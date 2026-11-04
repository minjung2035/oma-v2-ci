/* Controlled Mach gate/bootstrap handoff; no production execution backend. */
#define _DARWIN_C_SOURCE 1
#include <mach/mach.h>
#include <mach/task_special_ports.h>
#include <servers/bootstrap.h>
#include <libproc.h>
#include <spawn.h>
#include <signal.h>
#include <sys/wait.h>
#include <sys/fileport.h>
#include <unistd.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>

enum { INIT = 0x4f4d4120, ACK, SEED, READY, GO, FIN, CLOSED };
static FILE *trace;
static uint32_t expected[8], rejected;
static volatile sig_atomic_t child_pid, expired;
extern char **environ;
struct unique_process { uint8_t uuid[16]; uint64_t unique, parent; int32_t version, parent_version; uint64_t reserved[2]; };
_Static_assert(sizeof(struct unique_process) == 56, "pinned read-only generation ABI");
static void require(int condition, const char *message) {
  if (!condition) { perror(message); exit(2); }
}
static void mach_ok(kern_return_t status, const char *message) {
  if (status) { fprintf(stderr, "%s: %d\n", message, status); exit(2); }
}
static void deadline(int number) {
  (void)number; expired = 1;
  if (child_pid > 0) (void)kill((pid_t)child_pid, SIGKILL);
}
static int host_live(void) {
  struct unique_process before = {0}, after = {0}; struct proc_bsdinfo bsd = {0};
  return proc_pidinfo((pid_t)expected[5], 17, 0, &before, sizeof before) == sizeof before &&
    proc_pidinfo((pid_t)expected[5], PROC_PIDTBSDINFO, 0, &bsd, sizeof bsd) == sizeof bsd &&
    proc_pidinfo((pid_t)expected[5], 17, 0, &after, sizeof after) == sizeof after &&
    before.unique != 0 && before.unique == after.unique && before.version == after.version &&
    (uint32_t)before.version == expected[7] && bsd.pbi_pid == expected[5] && bsd.pbi_status != 5;
}
static mach_port_t receive(mach_port_t receiver, int id, int wants_right) {
  for (;;) {
    union { uint64_t alignment; unsigned char bytes[4096]; } buffer = {0};
    mach_msg_header_t *message = (mach_msg_header_t *)buffer.bytes;
    mach_ok(mach_msg(message, MACH_RCV_MSG | MACH_RCV_TIMEOUT |
      MACH_RCV_TRAILER_TYPE(MACH_MSG_TRAILER_FORMAT_0) | MACH_RCV_TRAILER_ELEMENTS(MACH_RCV_TRAILER_AUDIT),
      0, sizeof buffer, receiver, 10000, MACH_PORT_NULL), "job control receive");
    size_t trailer_at = (message->msgh_size + 3U) & ~3U;
    require(trailer_at + sizeof(mach_msg_audit_trailer_t) <= sizeof buffer, "bounded audit trailer");
    mach_msg_audit_trailer_t *trailer = (mach_msg_audit_trailer_t *)(buffer.bytes + trailer_at);
    require(trailer->msgh_trailer_type == MACH_MSG_TRAILER_FORMAT_0 &&
      trailer->msgh_trailer_size == sizeof *trailer, "complete kernel audit trailer");
    if (memcmp(trailer->msgh_audit.val, expected, sizeof expected)) {
      ++rejected;
      fprintf(trace, "{\"phase\":\"rejected\",\"id\":%d,\"senderPid\":%u,\"senderVersion\":%u}\n",
        message->msgh_id, trailer->msgh_audit.val[5], trailer->msgh_audit.val[7]);
      mach_msg_destroy(message); continue;
    }
    require(host_live(), "original Host generation is not live");
    uint32_t value = 0;
    if (message->msgh_size == sizeof *message + sizeof value) memcpy(&value, message + 1, sizeof value);
    int valid = message->msgh_id == id && message->msgh_size == sizeof *message + sizeof value && value == 1 &&
      !(message->msgh_bits & MACH_MSGH_BITS_COMPLEX) &&
      (wants_right ? MACH_MSGH_BITS_REMOTE(message->msgh_bits) == MACH_MSG_TYPE_PORT_SEND && MACH_PORT_VALID(message->msgh_remote_port)
                   : MACH_MSGH_BITS_REMOTE(message->msgh_bits) == 0 && message->msgh_remote_port == MACH_PORT_NULL);
    mach_port_t right = valid && wants_right ? message->msgh_remote_port : MACH_PORT_NULL;
    if (right) message->msgh_remote_port = MACH_PORT_NULL;
    mach_msg_destroy(message);
    require(valid, "trusted Host protocol poisoned");
    return right;
  }
}
static void send_control(mach_port_t destination, int id, pid_t child, int status) {
  struct { mach_msg_header_t header; uint32_t words[4]; } message = {0};
  message.header.msgh_bits = MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, 0);
  message.header.msgh_size = sizeof message; message.header.msgh_remote_port = destination; message.header.msgh_id = id;
  message.words[0] = 1; message.words[1] = rejected; message.words[2] = (uint32_t)child; message.words[3] = (uint32_t)status;
  // Failure terminates this controlled helper; kernel process teardown owns
  // all of its references. No unknown send becomes a successful gate step.
  mach_ok(mach_msg(&message.header, MACH_SEND_MSG | MACH_SEND_TIMEOUT, sizeof message, 0, MACH_PORT_NULL, 1000, MACH_PORT_NULL),
    "job control send");
}
int main(int argc, char **argv) {
  require(getuid() > 0 && argc >= 12, "service trace eight Host token words executable [args]");
  trace = fopen(argv[2], "wx"); require(trace != NULL && setvbuf(trace, NULL, _IOLBF, 0) == 0, "private job trace");
  require(fcntl(fileno(trace), F_SETFD, FD_CLOEXEC) == 0, "private job trace close on exec");
  for (int index = 0; index < 8; ++index) {
    char *end; errno = 0; unsigned long long word = strtoull(argv[3 + index], &end, 10);
    require(!errno && argv[3 + index][0] >= '0' && argv[3 + index][0] <= '9' && !*end && word <= UINT32_MAX, "Host token word");
    expected[index] = (uint32_t)word;
  }
  require(expected[5] > 1 && expected[5] <= INT32_MAX && expected[7] != 0 && expected[1] == getuid(), "expected ordinary Host identity");
  mach_port_t receiver = MACH_PORT_NULL;
  mach_ok(bootstrap_check_in(bootstrap_port, argv[1], &receiver), "check in declared job service");
  mach_port_t host = receive(receiver, INIT, 1); send_control(host, ACK, 0, 0);
  const int slots[] = { 0, 1, 2, 7 }; int descriptors[4];
  posix_spawn_file_actions_t files;
  require(posix_spawn_file_actions_init(&files) == 0, "target file actions");
  for (int index = 0; index < 4; ++index) {
    mach_port_t file = receive(receiver, 0x4f4d4130 + index, 1);
    int received = fileport_makefd(file); require(received >= 0, "import Host fileport");
    mach_ok(mach_port_deallocate(mach_task_self(), file), "return imported fileport SEND reference");
    int flags = fcntl(received, F_GETFD);
    require(flags >= 0 && (flags & FD_CLOEXEC) != 0, "import is close on exec");
    descriptors[index] = fcntl(received, F_DUPFD_CLOEXEC, 64);
    require(descriptors[index] >= 64 && close(received) == 0, "retain non-overlapping file action source");
    require(posix_spawn_file_actions_adddup2(&files, descriptors[index], slots[index]) == 0, "exact target FD slot");
    fprintf(trace, "{\"phase\":\"fileport\",\"slot\":%d,\"closeOnExec\":true}\n", slots[index]);
  }
  mach_port_t sink = receive(receiver, SEED, 1);
  require(sink != receiver && sink != host && sink != bootstrap_port, "distinct bootstrap sink");
  mach_ok(task_set_bootstrap_port(mach_task_self(), sink), "job child bootstrap seed");
  mach_ok(mach_ports_register(mach_task_self(), &sink, 1), "job child registered seed");
  send_control(host, READY, 0, 0);
  (void)receive(receiver, GO, 0);
  fprintf(trace, "{\"phase\":\"released\",\"hostPid\":%u,\"hostVersion\":%u,\"rejected\":%u}\n", expected[5], expected[7], rejected);
  struct sigaction action = {0}; action.sa_handler = deadline;
  require(sigemptyset(&action.sa_mask) == 0 && sigaction(SIGALRM, &action, NULL) == 0, "job deadline handler");
  pid_t child = 0;
  int spawned = posix_spawn(&child, argv[11], &files, NULL, &argv[11], environ);
  require(posix_spawn_file_actions_destroy(&files) == 0, "return file actions");
  for (int index = 0; index < 4; ++index) require(close(descriptors[index]) == 0, "return helper FD source");
  require(spawned == 0 && child > 0, "controlled job child spawn"); child_pid = child; alarm(30);
  siginfo_t terminal = {0}; int waited;
  do { waited = waitid(P_PID, (id_t)child, &terminal, WEXITED | WNOWAIT); } while (waited < 0 && errno == EINTR);
  require(waited == 0 && terminal.si_pid == child, "job unreaped child terminal");
  sigset_t alarms; require(sigemptyset(&alarms) == 0 && sigaddset(&alarms, SIGALRM) == 0 &&
    sigprocmask(SIG_BLOCK, &alarms, NULL) == 0, "job alarm barrier"); alarm(0); child_pid = 0;
  int status; do { waited = waitpid(child, &status, 0); } while (waited < 0 && errno == EINTR);
  require(waited == child, "job child join");
  fprintf(trace, "{\"phase\":\"terminal\",\"childPid\":%d,\"waitStatus\":%d,\"timedOut\":%s,\"joined\":true}\n",
    child, status, expired ? "true" : "false");
  send_control(host, FIN, child, status); (void)receive(receiver, CLOSED, 0);
  mach_ok(mach_port_mod_refs(mach_task_self(), receiver, MACH_PORT_RIGHT_RECEIVE, -1), "job receiver close");
  mach_ok(mach_port_deallocate(mach_task_self(), host), "job Host reference return");
  mach_ok(mach_port_deallocate(mach_task_self(), sink), "job sink reference return");
  require(fclose(trace) == 0, "job trace close");
  return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
}
