/* Controlled Mach gate/bootstrap handoff; no production execution backend. */
#define _DARWIN_C_SOURCE 1
#include <mach/mach.h>
#include <mach/task_special_ports.h>
#include <bsm/libbsm.h>
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

enum { INIT = 0x4f4d4120, ACK, SEED, READY, GO, FIN, CLOSED, TARGET = 0x4f4d4128, TARGET_GO };
static FILE *trace;
static uint32_t expected[8], rejected;
static volatile sig_atomic_t child_pid, expired;
static audit_token_t target_token;
extern char **environ;
struct unique_process { uint8_t uuid[16]; uint64_t unique, parent; int32_t version, parent_version; uint64_t reserved[2]; };
_Static_assert(sizeof(struct unique_process) == 56, "pinned read-only generation ABI");
static void failed_child(void) {
  alarm(0);
  pid_t owned = (pid_t)child_pid; child_pid = 0;
  if (owned > 0) {
    // This remains our unreaped direct child. No saved PID is reacquired.
    if (kill(owned, SIGKILL) < 0 && errno != ESRCH) perror("failed child kill");
    int status, waited;
    do { waited = waitpid(owned, &status, 0); } while (waited < 0 && errno == EINTR);
    if (waited != owned) perror("failed child join");
  }
}
static void require(int condition, const char *message) {
  if (!condition) { perror(message); failed_child(); exit(2); }
}
static void mach_ok(kern_return_t status, const char *message) {
  if (status) { fprintf(stderr, "%s: %d\n", message, status); failed_child(); exit(2); }
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
    require(!expired && host_live(), "original Host generation is not live");
    if (memcmp(trailer->msgh_audit.val, expected, sizeof expected)) {
      ++rejected;
      fprintf(trace, "{\"phase\":\"rejected\",\"id\":%d,\"senderPid\":%u,\"senderVersion\":%u}\n",
        message->msgh_id, trailer->msgh_audit.val[5], trailer->msgh_audit.val[7]);
      mach_msg_destroy(message); continue;
    }
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
static int stopped_target(pid_t child, const char *stage) {
  int previous = audit_token_to_pidversion(target_token);
  for (;;) {
    require(!expired && host_live(), "Host/deadline changed during suspended target observation");
    siginfo_t event = {0};
    int result = waitid(P_PID, (id_t)child, &event, WSTOPPED | WEXITED | WNOHANG | WNOWAIT);
    if (result < 0 && errno == EINTR) continue;
    require(result == 0, "observe unreaped target event");
    if (event.si_pid == 0) { usleep(1000); continue; }
    if (event.si_pid != child || event.si_code != CLD_STOPPED) {
      fprintf(trace, "{\"phase\":\"terminal-before-stop\",\"stage\":\"%s\",\"pid\":%d,\"code\":%d,\"status\":%d}\n",
        stage, event.si_pid, event.si_code, event.si_status);
      require(0, "target ended before a suspended observation");
    }
    mach_port_t target_name = MACH_PORT_NULL; audit_token_t observed = {{0}};
    mach_msg_type_number_t count = TASK_AUDIT_TOKEN_COUNT;
    mach_ok(task_name_for_pid(mach_task_self(), child, &target_name), "target task name capability");
    mach_ok(task_info(target_name, TASK_AUDIT_TOKEN, (task_info_t)&observed, &count), "actual target audit token");
    mach_ok(mach_port_deallocate(mach_task_self(), target_name), "return target task name capability");
    require(count == TASK_AUDIT_TOKEN_COUNT && audit_token_to_pid(observed) == child &&
      audit_token_to_euid(observed) == getuid() && audit_token_to_pidversion(observed) != 0, "suspended target generation");
    // WNOWAIT leaves P_LWAITED clear. SETEXEC's kernel stop does not clear
    // that bit or promise a SIGCHLD wake. A new pidVersion distinguishes the
    // next mapped image from an old, not-yet-resumed stop. No event is death.
    if (audit_token_to_pidversion(observed) == previous) { usleep(1000); continue; }
    target_token = observed;
    fprintf(trace, "{\"phase\":\"suspended\",\"stage\":\"%s\",\"childPid\":%d,\"stopSignal\":%d,\"pidVersion\":%d}\n",
      stage, child, event.si_status, audit_token_to_pidversion(observed));
    return W_STOPCODE(event.si_status);
  }
}
static void send_control(mach_port_t destination, int id, pid_t child, int status) {
  struct { mach_msg_header_t header; uint32_t words[12]; } message = {0};
  message.header.msgh_bits = MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, 0);
  message.header.msgh_size = sizeof message.header + (id == READY || id == TARGET ? 12 : 4) * sizeof(uint32_t);
  message.header.msgh_remote_port = destination; message.header.msgh_id = id;
  message.words[0] = 1; message.words[1] = rejected; message.words[2] = (uint32_t)child; message.words[3] = (uint32_t)status;
  if (id == READY || id == TARGET) memcpy(&message.words[4], &target_token, sizeof target_token);
  // Failure terminates this controlled helper; kernel process teardown owns
  // all of its references. No unknown send becomes a successful gate step.
  mach_ok(mach_msg(&message.header, MACH_SEND_MSG | MACH_SEND_TIMEOUT, message.header.msgh_size, 0, MACH_PORT_NULL, 1000, MACH_PORT_NULL),
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
  const int slots[] = { 0, 1, 2, 7, 3 }; int descriptors[5];
  posix_spawn_file_actions_t files;
  require(posix_spawn_file_actions_init(&files) == 0, "target file actions");
  for (int index = 0; index < 5; ++index) {
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
  struct sigaction action = {0}; action.sa_handler = deadline;
  require(sigemptyset(&action.sa_mask) == 0 && sigaction(SIGALRM, &action, NULL) == 0, "job deadline handler");
  pid_t child = 0;
  posix_spawnattr_t attributes;
  require(posix_spawnattr_init(&attributes) == 0 &&
    posix_spawnattr_setflags(&attributes, POSIX_SPAWN_START_SUSPENDED | POSIX_SPAWN_CLOEXEC_DEFAULT) == 0, "suspended target attributes");
  int spawned = posix_spawn(&child, argv[11], &files, &attributes, &argv[11], environ);
  if (spawned == 0 && child > 0) child_pid = child;
  require(posix_spawnattr_destroy(&attributes) == 0, "return target attributes");
  require(posix_spawn_file_actions_destroy(&files) == 0, "return file actions");
  for (int index = 0; index < 5; ++index) require(close(descriptors[index]) == 0, "return helper FD source");
  require(spawned == 0 && child > 0, "controlled job child spawn"); alarm(30);
  int stop_status = stopped_target(child, "launcher");
  send_control(host, READY, child, stop_status);
  (void)receive(receiver, GO, 0);
  require(proc_signal_with_audittoken(&target_token, SIGCONT) == 0, "release exact target generation");
  fprintf(trace, "{\"phase\":\"released\",\"stage\":\"launcher\",\"hostPid\":%u,\"hostVersion\":%u,\"rejected\":%u}\n", expected[5], expected[7], rejected);
  stop_status = stopped_target(child, "target");
  send_control(host, TARGET, child, stop_status);
  (void)receive(receiver, TARGET_GO, 0);
  require(proc_signal_with_audittoken(&target_token, SIGCONT) == 0, "release exact final target generation");
  fprintf(trace, "{\"phase\":\"released\",\"stage\":\"target\",\"hostPid\":%u,\"hostVersion\":%u,\"rejected\":%u}\n", expected[5], expected[7], rejected);
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
