/* Controlled compatibility experiment, never a production bootstrap server.
 * Only three exact OS lookups may produce a new reply. Incoming XPC objects
 * are never forwarded. Private libxpc signatures: Chromium 45.0.2454.85,
 * sandbox/mac/xpc_private_stubs.sig. Their current ABI is NOT qualified.
 * Joining this direct child is not an arbitrary-descendant death proof. */
#define _DARWIN_C_SOURCE 1
#include <mach/mach.h>
#include <mach/task_special_ports.h>
#include <servers/bootstrap.h>
#include <bsm/audit.h>
#include <dlfcn.h>
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

/* The local SDK snapshot omits XPC headers. Resolve the opaque operations
 * explicitly; missing symbols refuse before starting the controlled child. */
typedef void *object;
static object (*dictionary)(const char *const *, const object *, size_t);
static object (*reply_for)(object);
static object (*value_for)(object, const char *);
static const void *(*object_type)(object);
static uint64_t (*integer_for)(object, const char *);
static const char *(*string_for)(object, const char *);
static void (*set_integer)(object, const char *, int64_t);
static void (*set_port)(object, const char *, mach_port_t);
static void (*audit_for)(object, audit_token_t *);
static int (*receive_request)(mach_port_t, object *);
static int (*send_reply)(object);
static void (*release_object)(object);
static const void *dictionary_type, *unsigned_type, *string_type;
static FILE *trace;
static mach_port_t endpoint, original;
static atomic_int stopping;
static volatile sig_atomic_t child_pid, expired;
extern char **environ;

static void require(int condition, const char *operation) {
  if (!condition) { perror(operation); exit(2); }
}
static void mach_success(kern_return_t result, const char *operation) {
  if (result != KERN_SUCCESS) { fprintf(stderr, "%s: Mach %d\n", operation, result); exit(2); }
}
static void *symbol(const char *name) {
  void *result = dlsym(RTLD_DEFAULT, name);
  if (!result) { fprintf(stderr, "private compatibility symbol unavailable: %s\n", name); exit(2); }
  return result;
}
#define RESOLVE(target, name) do { *(void **)(&(target)) = symbol(name); } while (0)
static void json_string(const char *value) {
  if (!value) { fputs("null", trace); return; }
  fputc('"', trace);
  for (size_t i = 0; value[i] && i < 256; ++i) {
    unsigned char byte = (unsigned char)value[i];
    if (byte == '"' || byte == '\\') fprintf(trace, "\\%c", byte);
    else if (byte < 32 || byte >= 127) fprintf(trace, "\\u%04x", byte);
    else fputc(byte, trace);
  }
  fputc('"', trace);
}
static int unsigned_field(object request, const char *name, uint64_t expected) {
  object entry = value_for(request, name);
  return entry && object_type(entry) == unsigned_type && integer_for(request, name) == expected;
}
static int allowed_name(const char *name) {
  return name && (!strcmp(name, "com.apple.logd") || !strcmp(name, "com.apple.system.logger") ||
    !strcmp(name, "com.apple.system.opendirectoryd.libinfo"));
}
static void *serve(void *unused) {
  (void)unused;
  while (!atomic_load(&stopping)) {
    object request = NULL;
    int status = receive_request(endpoint, &request);
    if (status || !request) {
      flockfile(trace);
      fprintf(trace, "{\"phase\":\"receive\",\"status\":%d,\"stopping\":%s}\n", status,
        atomic_load(&stopping) ? "true" : "false");
      funlockfile(trace);
      if (request) release_object(request);
      break;
    }
    if (object_type(request) != dictionary_type) { release_object(request); break; }
    const char *name = string_for(request, "name");
    object name_object = value_for(request, "name");
    int selected = name_object && object_type(name_object) == string_type &&
      unsigned_field(request, "subsystem", 5) && unsigned_field(request, "routine", 207) &&
      unsigned_field(request, "type", 7) && unsigned_field(request, "handle", 0) &&
      unsigned_field(request, "flags", 0) && allowed_name(name);
    /* targetpid is an int64 in the historical producer. This prototype does
     * not honor it: every accepted request is a new ordinary global lookup. */
    audit_token_t sender = {{0}}; audit_for(request, &sender);
    mach_port_t result = MACH_PORT_NULL;
    int lookup = selected ? bootstrap_look_up(original, name, &result) : BOOTSTRAP_NOT_PRIVILEGED;
    if (lookup == KERN_SUCCESS && (!MACH_PORT_VALID(result) || result == original)) lookup = BOOTSTRAP_NOT_PRIVILEGED;
    object reply = reply_for(request);
    int sent = -1;
    if (reply) {
      set_integer(reply, "error", lookup);
      if (lookup == KERN_SUCCESS && MACH_PORT_VALID(result)) set_port(reply, "port", result);
      sent = send_reply(reply);
      release_object(reply);
    }
    flockfile(trace);
    fprintf(trace, "{\"phase\":\"request\",\"senderPid\":%u,\"subsystem\":%llu,\"routine\":%llu,"
      "\"type\":%llu,\"handle\":%llu,\"name\":", sender.val[5],
      (unsigned long long)integer_for(request, "subsystem"), (unsigned long long)integer_for(request, "routine"),
      (unsigned long long)integer_for(request, "type"), (unsigned long long)integer_for(request, "handle"));
    json_string(name);
    fprintf(trace, ",\"selected\":%s,\"lookup\":%d,\"replyCreated\":%s,\"replyStatus\":%d}\n",
      selected ? "true" : "false", lookup, reply ? "true" : "false", sent);
    funlockfile(trace);
    /* The source ABI does not establish set_mach_send's ownership contract.
     * Do not decrement the acquired name here. Parent exit reclaims any
     * remaining references; no per-request reference-return proof is claimed. */
    release_object(request);
  }
  return NULL;
}
static void deadline(int signal_number) {
  (void)signal_number; expired = 1;
  if (child_pid > 0) (void)kill((pid_t)child_pid, SIGKILL);
}
int main(int argc, char **argv) {
  require(getuid() > 0 && argc >= 4, "ordinary UID: trace executable [arguments]");
  RESOLVE(dictionary, "xpc_dictionary_create"); RESOLVE(reply_for, "xpc_dictionary_create_reply");
  RESOLVE(value_for, "xpc_dictionary_get_value"); RESOLVE(object_type, "xpc_get_type");
  RESOLVE(integer_for, "xpc_dictionary_get_uint64"); RESOLVE(string_for, "xpc_dictionary_get_string");
  RESOLVE(set_integer, "xpc_dictionary_set_int64"); RESOLVE(set_port, "xpc_dictionary_set_mach_send");
  RESOLVE(audit_for, "xpc_dictionary_get_audit_token"); RESOLVE(receive_request, "xpc_pipe_receive");
  RESOLVE(send_reply, "xpc_pipe_routine_reply"); RESOLVE(release_object, "xpc_release");
  dictionary_type = symbol("_xpc_type_dictionary"); unsigned_type = symbol("_xpc_type_uint64");
  string_type = symbol("_xpc_type_string");
  object initialized = dictionary(NULL, NULL, 0); require(initialized != NULL, "initialize original XPC task");
  release_object(initialized);
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
  fprintf(trace, "{\"phase\":\"ready\",\"pid\":%d,\"uid\":%u,\"original\":%u,\"proxy\":%u,\"privateApi\":true}\n",
    getpid(), (unsigned)getuid(), original, endpoint);
  sigset_t alarms; require(sigemptyset(&alarms) == 0 && sigaddset(&alarms, SIGALRM) == 0 &&
    sigprocmask(SIG_BLOCK, &alarms, NULL) == 0, "proxy alarm mask");
  struct sigaction action = {0}; action.sa_handler = deadline;
  require(sigemptyset(&action.sa_mask) == 0 && sigaction(SIGALRM, &action, NULL) == 0, "proxy alarm handler");
  pthread_t server; require(pthread_create(&server, NULL, serve, NULL) == 0, "proxy receiver thread");
  mach_success(task_set_bootstrap_port(task, endpoint), "child bootstrap seed");
  mach_success(mach_ports_register(task, &endpoint, 1), "child registered seed");
  pid_t child = 0;
  int spawned = posix_spawn(&child, argv[2], NULL, NULL, &argv[2], environ);
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
  mach_success(mach_port_mod_refs(task, endpoint, MACH_PORT_RIGHT_RECEIVE, -1), "close proxy receive right");
  require(pthread_join(server, NULL) == 0, "proxy receiver join");
  mach_success(mach_port_deallocate(task, endpoint), "return proxy send reference");
  fprintf(trace, "{\"phase\":\"terminal\",\"childPid\":%d,\"waitStatus\":%d,\"timedOut\":%s,\"joined\":true}\n",
    child, result, expired ? "true" : "false");
  require(fclose(trace) == 0, "complete proxy trace");
  return WIFEXITED(result) ? WEXITSTATUS(result) : 128 + WTERMSIG(result);
}
