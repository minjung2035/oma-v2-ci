/* Controlled bootstrap Mach compatibility experiment, not a production server.
 * 0x400000cf/236 bytes was observed on both target SDK/OS pairs. Its private
 * wire ABI and the proposed SDK-style reply are not qualified by declarations.
 * Only fixed OS service ports can be returned; no request is ever forwarded.
 * The name scan grants no caller identity, role or arbitrary-descendant proof. */
#define _DARWIN_C_SOURCE 1
#include <mach/mach.h>
#include <mach/task_special_ports.h>
#include <mach/mig_errors.h>
#include <servers/bootstrap.h>
#include <pthread.h>
#include <signal.h>
#include <spawn.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>
#include <errno.h>
#include <fcntl.h>

static FILE *trace;
static mach_port_t endpoint, original;
static atomic_int stopping;
static int deny_all;
static volatile sig_atomic_t child_pid, expired;
extern char **environ;
static void require(int condition, const char *operation) {
  if (!condition) { perror(operation); exit(2); }
}
static void mach_success(kern_return_t result, const char *operation) {
  if (result != KERN_SUCCESS) { fprintf(stderr, "%s: Mach %d\n", operation, result); exit(2); }
}
static void json_string(const char *value) {
  if (!value) { fputs("null", trace); return; }
  fputc('"', trace);
  for (size_t i = 0; value[i] && i < 128; ++i) {
    unsigned char byte = (unsigned char)value[i];
    if (byte == '"' || byte == '\\') fprintf(trace, "\\%c", byte);
    else if (byte < 32 || byte >= 127) fprintf(trace, "\\u%04x", byte);
    else fputc(byte, trace);
  }
  fputc('"', trace);
}
static const char *selected_service(const unsigned char *bytes, size_t size) {
  const char *allowed[] = {"com.apple.logd", "com.apple.system.logger", "com.apple.system.opendirectoryd.libinfo"};
  const char *selected = NULL;
  for (size_t n = 0; n < sizeof allowed / sizeof allowed[0]; ++n) {
    size_t length = strlen(allowed[n]);
    for (size_t i = sizeof(mach_msg_header_t); i + length < size; ++i) {
      if (!memcmp(bytes + i, allowed[n], length + 1)) {
        if (selected && strcmp(selected, allowed[n])) return NULL;
        selected = allowed[n];
      }
    }
  }
  /* This intentionally ignores other body fields. Even a malformed request
   * can receive only one of these already-permitted fixed ports, never a
   * different lookup, a bootstrap right, a forwarded operation or file data. */
  return selected;
}
static void observed_service(const unsigned char *bytes, size_t size, char output[128]) {
  const char prefix[] = "com.apple.";
  output[0] = 0;
  for (size_t i = sizeof(mach_msg_header_t); i + sizeof prefix < size; ++i) {
    if (memcmp(bytes + i, prefix, sizeof prefix - 1)) continue;
    size_t n = 0;
    while (i + n < size && n < 127) {
      unsigned char value = bytes[i + n];
      if (!value) { memcpy(output, bytes + i, n); output[n] = 0; return; }
      if (!((value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z') ||
          (value >= '0' && value <= '9') || value == '.' || value == '_' || value == '-')) break;
      ++n;
    }
  }
}
struct port_reply {
  mach_msg_header_t header;
  mach_msg_body_t body;
  mach_msg_port_descriptor_t port;
  NDR_record_t ndr;
  kern_return_t status;
};
static int answer(mach_msg_size_t size, const mach_msg_audit_trailer_t *observed) {
  if (size < sizeof(mach_msg_header_t) || size > 65536) return 0;
  mach_msg_size_t capacity = ((size + 3) & ~3U) + sizeof(mach_msg_audit_trailer_t);
  mach_msg_header_t *request = calloc(1, capacity);
  if (!request) return 0;
  kern_return_t received = mach_msg(request, MACH_RCV_MSG | MACH_RCV_TIMEOUT |
    MACH_RCV_TRAILER_TYPE(MACH_MSG_TRAILER_FORMAT_0) | MACH_RCV_TRAILER_ELEMENTS(MACH_RCV_TRAILER_AUDIT),
    0, capacity, endpoint, 0, MACH_PORT_NULL);
  if (received != KERN_SUCCESS) { free(request); return 0; }
  const char *name = !deny_all && request->msgh_id == 0x400000cf ? selected_service((unsigned char *)request, request->msgh_size) : NULL;
  char seen[128]; observed_service((unsigned char *)request, request->msgh_size, seen);
  mach_port_t result = MACH_PORT_NULL;
  int lookup = name ? bootstrap_look_up(original, name, &result) : BOOTSTRAP_NOT_PRIVILEGED;
  if (lookup == KERN_SUCCESS && (!MACH_PORT_VALID(result) || result == original || result == endpoint)) {
    if (MACH_PORT_VALID(result)) (void)mach_port_deallocate(mach_task_self(), result);
    result = MACH_PORT_NULL; lookup = BOOTSTRAP_NOT_PRIVILEGED;
  }
  mach_msg_type_name_t disposition = MACH_MSGH_BITS_REMOTE(request->msgh_bits);
  kern_return_t sent = -1;
  mach_msg_size_t reply_bytes = 0;
  if (request->msgh_id == 0x400000cf && MACH_PORT_VALID(request->msgh_remote_port) &&
      disposition == MACH_MSG_TYPE_MOVE_SEND_ONCE) {
    union { struct port_reply port; mig_reply_error_t error; } reply = {0};
    mach_msg_header_t *header = &reply.error.Head;
    header->msgh_bits = MACH_MSGH_BITS(disposition, 0);
    header->msgh_remote_port = request->msgh_remote_port;
    request->msgh_remote_port = MACH_PORT_NULL; /* Transfer the one received reply reference. */
    header->msgh_id = request->msgh_id + 100;
    if (lookup == KERN_SUCCESS) {
      header->msgh_bits |= MACH_MSGH_BITS_COMPLEX; header->msgh_size = sizeof reply.port;
      reply.port.body.msgh_descriptor_count = 1;
      reply.port.port.name = result; reply.port.port.disposition = MACH_MSG_TYPE_MOVE_SEND;
      reply.port.port.type = MACH_MSG_PORT_DESCRIPTOR;
      reply.port.ndr = NDR_record; reply.port.status = 0; result = MACH_PORT_NULL;
    } else {
      header->msgh_size = sizeof reply.error; reply.error.NDR = NDR_record; reply.error.RetCode = lookup;
    }
    reply_bytes = header->msgh_size;
    sent = mach_msg(header, MACH_SEND_MSG | MACH_SEND_TIMEOUT, reply_bytes, 0, MACH_PORT_NULL, 0, MACH_PORT_NULL);
    if (sent != KERN_SUCCESS) mach_msg_destroy(header);
  }
  if (MACH_PORT_VALID(result)) (void)mach_port_deallocate(mach_task_self(), result);
  flockfile(trace);
  fprintf(trace, "{\"phase\":\"mach-request\",\"senderPid\":%u,\"id\":%d,\"size\":%u,\"selected\":%s,\"name\":",
    observed->msgh_audit.val[5], request->msgh_id, request->msgh_size, name ? "true" : "false");
  json_string(name);
  fputs(",\"observedName\":", trace); json_string(seen[0] ? seen : NULL);
  fprintf(trace, ",\"lookup\":%d,\"replyStatus\":%d,\"replyBytes\":%u,\"replyDisposition\":%u}\n",
    lookup, sent, reply_bytes, disposition);
  funlockfile(trace);
  mach_msg_destroy(request); free(request); return 1;
}
static void *serve(void *unused) {
  (void)unused;
  while (!atomic_load(&stopping)) {
    mach_port_seqno_t sequence = 0; mach_msg_size_t size = 0; mach_msg_id_t id = 0;
    mach_msg_audit_trailer_t trailer = {0}; mach_msg_type_number_t trailer_size = sizeof trailer;
    kern_return_t peek = mach_port_peek(mach_task_self(), endpoint,
      MACH_RCV_TRAILER_TYPE(MACH_MSG_TRAILER_FORMAT_0) | MACH_RCV_TRAILER_ELEMENTS(MACH_RCV_TRAILER_AUDIT),
      &sequence, &size, &id, (mach_msg_trailer_info_t)&trailer, &trailer_size);
    if (peek == KERN_FAILURE) { usleep(1000); continue; }
    flockfile(trace);
    fprintf(trace, "{\"phase\":\"mach-peek\",\"status\":%d,\"id\":%d,\"size\":%u,\"senderPid\":%u}\n",
      peek, id, size, trailer.msgh_audit.val[5]);
    funlockfile(trace);
    if (peek != KERN_SUCCESS || !answer(size, &trailer)) break;
  }
  return NULL;
}
static void deadline(int signal_number) {
  (void)signal_number; expired = 1;
  if (child_pid > 0) (void)kill((pid_t)child_pid, SIGKILL);
}
int main(int argc, char **argv) {
  require(getuid() > 0 && argc >= 4, "ordinary UID: trace executable [arguments]");
  deny_all = strcmp(argv[2], "--deny-all") == 0;
  int executable_index = deny_all ? 3 : 2;
  require(argc > executable_index, "proxy target executable");
  trace = fopen(argv[1], "wx"); require(trace != NULL, "exclusive proxy trace");
  require(fcntl(fileno(trace), F_SETFD, FD_CLOEXEC) == 0, "private trace close on exec");
  require(setvbuf(trace, NULL, _IOLBF, 0) == 0, "trace buffering");
  mach_port_t task = mach_task_self(); mach_port_array_t registered = NULL; mach_msg_type_number_t count = 0;
  mach_success(task_get_bootstrap_port(task, &original), "original bootstrap");
  mach_success(mach_ports_lookup(task, &registered, &count), "original registered ports");
  mach_port_t warmed = MACH_PORT_NULL;
  int warm_status = bootstrap_look_up(original, "com.apple.logd", &warmed);
  fprintf(trace, "{\"phase\":\"host-lookup\",\"status\":%d}\n", warm_status);
  mach_success(mach_port_allocate(task, MACH_PORT_RIGHT_RECEIVE, &endpoint), "proxy receive right");
  mach_success(mach_port_insert_right(task, endpoint, endpoint, MACH_MSG_TYPE_MAKE_SEND), "proxy send right");
  fprintf(trace, "{\"phase\":\"ready\",\"pid\":%d,\"uid\":%u,\"original\":%u,\"proxy\":%u,\"privateAbi\":true,\"denyAll\":%s}\n",
    getpid(), (unsigned)getuid(), original, endpoint, deny_all ? "true" : "false");
  sigset_t alarms; require(sigemptyset(&alarms) == 0 && sigaddset(&alarms, SIGALRM) == 0 &&
    sigprocmask(SIG_BLOCK, &alarms, NULL) == 0, "proxy alarm mask");
  struct sigaction action = {0}; action.sa_handler = deadline;
  require(sigemptyset(&action.sa_mask) == 0 && sigaction(SIGALRM, &action, NULL) == 0, "proxy alarm handler");
  pthread_t server; require(pthread_create(&server, NULL, serve, NULL) == 0, "proxy receiver thread");
  mach_success(task_set_bootstrap_port(task, endpoint), "child bootstrap seed");
  mach_success(mach_ports_register(task, &endpoint, 1), "child registered seed");
  pid_t child = 0;
  int spawned = posix_spawn(&child, argv[executable_index], NULL, NULL, &argv[executable_index], environ);
  kern_return_t restored = task_set_bootstrap_port(task, original), registered_again = mach_ports_register(task, registered, count);
  flockfile(trace); fprintf(trace, "{\"phase\":\"spawn\",\"status\":%d,\"childPid\":%d,\"restored\":%d,\"registered\":%d}\n",
    spawned, child, restored, registered_again); funlockfile(trace);
  require(spawned == 0 && child > 0, "controlled proxy child spawn"); child_pid = child;
  if (restored != KERN_SUCCESS || registered_again != KERN_SUCCESS) (void)kill(child, SIGKILL);
  require(pthread_sigmask(SIG_UNBLOCK, &alarms, NULL) == 0, "proxy child deadline");
  alarm(30);
  siginfo_t terminal = {0}; int waited;
  do { waited = waitid(P_PID, (id_t)child, &terminal, WEXITED | WNOWAIT); } while (waited < 0 && errno == EINTR);
  require(waited == 0 && terminal.si_pid == child, "owned proxy child terminal observation");
  require(pthread_sigmask(SIG_BLOCK, &alarms, NULL) == 0, "proxy alarm disarm barrier"); alarm(0); child_pid = 0;
  int result; do { waited = waitpid(child, &result, 0); } while (waited < 0 && errno == EINTR);
  require(waited == child, "proxy child join");
  atomic_store(&stopping, 1);
  require(pthread_join(server, NULL) == 0, "proxy receiver join");
  mach_success(mach_port_mod_refs(task, endpoint, MACH_PORT_RIGHT_RECEIVE, -1), "close proxy receive right");
  mach_success(mach_port_deallocate(task, endpoint), "return proxy send reference");
  fprintf(trace, "{\"phase\":\"terminal\",\"childPid\":%d,\"waitStatus\":%d,\"timedOut\":%s,\"joined\":true}\n",
    child, result, expired ? "true" : "false");
  require(fclose(trace) == 0, "complete proxy trace");
  return WIFEXITED(result) ? WEXITSTATUS(result) : 128 + WTERMSIG(result);
}
