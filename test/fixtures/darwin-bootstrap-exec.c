/* Controlled pre-exec experiment, not a production launcher or authority proof.
 * task special/registered ports use SDK Mach APIs. Treating registered ports
 * as libxpc's bootstrap seed is implementation behavior, not a public contract.
 * Unlike posix_spawn/fork, direct exec runs no intervening XPC atfork hook. */
#define _DARWIN_C_SOURCE 1
#include <mach/mach.h>
#include <mach/task_special_ports.h>
#include <libproc.h>
#include <sandbox.h>
#include <dns_sd.h>
#include <netdb.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/stat.h>
#include <pthread.h>
#include <unistd.h>
#include <errno.h>
#include <inttypes.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

extern char **environ;
struct snapshot { mach_port_t bootstrap, registered[3]; mach_msg_type_number_t count; };
struct coalition_ids { uint64_t ids[2], reserved[3]; };
_Static_assert(sizeof(struct coalition_ids) == 40, "pinned observation-only coalition result");
static void require(int condition, const char *message) {
  if (!condition) { perror(message); exit(2); }
}
static void mach_success(kern_return_t result, const char *operation) {
  if (result != KERN_SUCCESS) { fprintf(stderr, "%s: Mach status %d\n", operation, result); exit(2); }
}
static struct snapshot snapshot(void) {
  struct snapshot value = {0};
  mach_port_array_t ports = NULL;
  mach_success(task_get_bootstrap_port(mach_task_self(), &value.bootstrap), "read bootstrap port");
  mach_success(mach_ports_lookup(mach_task_self(), &ports, &value.count), "read registered ports");
  require(value.count <= 3, "bounded registered port array");
  for (mach_msg_type_number_t i = 0; i < value.count; ++i) value.registered[i] = ports[i];
  if (value.count) mach_success(vm_deallocate(mach_task_self(), (vm_address_t)ports,
    value.count * sizeof(*ports)), "release registered port array");
  return value;
}
static void print_snapshot(FILE *output, const struct snapshot *value) {
  fprintf(output, "{\"bootstrap\":%u,\"registered\":[", value->bootstrap);
  for (mach_msg_type_number_t i = 0; i < value->count; ++i)
    fprintf(output, "%s%u", i ? "," : "", value->registered[i]);
  fputs("]}", output);
}
static int contains(const mach_port_t *ports, size_t count, mach_port_t port) {
  for (size_t i = 0; i < count; ++i) if (ports[i] == port) return 1;
  return 0;
}
static void release_snapshot(const struct snapshot *value, const mach_port_t *dropped, size_t count) {
  const mach_port_t ports[] = { value->bootstrap, value->registered[0], value->registered[1], value->registered[2] };
  for (size_t i = 0; i < sizeof ports / sizeof ports[0]; ++i)
    if (MACH_PORT_VALID(ports[i]) && !contains(dropped, count, ports[i]))
      mach_success(mach_port_deallocate(mach_task_self(), ports[i]), "release snapshot send right");
}
static void apply_profile(const char *path) {
  FILE *input = fopen(path, "rb"); require(input != NULL, "profile open");
  require(fseek(input, 0, SEEK_END) == 0, "profile length");
  long length = ftell(input); require(length > 0 && length <= 1024 * 1024, "bounded profile length");
  rewind(input);
  char *profile = malloc((size_t)length + 1); require(profile != NULL, "profile allocation");
  require(fread(profile, 1, (size_t)length, input) == (size_t)length && fgetc(input) == EOF, "complete profile read");
  require(fclose(input) == 0 && memchr(profile, 0, (size_t)length) == NULL, "profile framing");
  profile[length] = 0;
  char *error = NULL;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  int status = sandbox_init(profile, 0, &error);
  if (error != NULL) { fprintf(stderr, "production profile: %s\n", error); sandbox_free_error(error); }
#pragma clang diagnostic pop
  free(profile);
  require(status == 0, "apply production Seatbelt profile");
}
/* Diagnostic calls under the inherited label, never a resolver fallback.
 * Keep raw connect, DNS-SD IPC and libc lookup failures separate. */
struct unix_observation { int created, socket_errno, connected, connect_errno; };
static void observe_unix(const char *endpoint, struct unix_observation *result) {
  struct sockaddr_un address = {0};
  size_t length = strlen(endpoint);
  require(length < sizeof address.sun_path, "diagnostic Unix endpoint length");
  address.sun_len = sizeof address; address.sun_family = AF_UNIX;
  memcpy(address.sun_path, endpoint, length + 1);
  errno = 0;
  int descriptor = socket(AF_UNIX, SOCK_STREAM, 0);
  result->created = descriptor >= 0;
  result->socket_errno = descriptor < 0 ? errno : 0;
  result->connected = -1;
  if (descriptor >= 0) {
    errno = 0;
    result->connected = connect(descriptor, (const struct sockaddr *)&address, sizeof address);
    result->connect_errno = result->connected < 0 ? errno : 0;
    require(close(descriptor) == 0, "close diagnostic Unix socket");
  }
}
static void print_unix(FILE *output, const struct unix_observation *value) {
  fprintf(output, "{\"created\":%s,\"errno\":%d,\"connectAttempted\":%s,\"connectResult\":%d,\"connectErrno\":%d}",
    value->created ? "true" : "false", value->socket_errno, value->created ? "true" : "false",
    value->connected, value->connect_errno);
}
struct path_observation { int result, error; const char *kind; };
static void observe_path(const char *path, struct path_observation *value) {
  struct stat metadata;
  errno = 0;
  value->result = lstat(path, &metadata);
  value->error = value->result < 0 ? errno : 0;
  value->kind = value->result < 0 ? NULL : S_ISLNK(metadata.st_mode) ? "symlink" :
    S_ISSOCK(metadata.st_mode) ? "socket" : S_ISDIR(metadata.st_mode) ? "directory" : "other";
}
static void print_path(FILE *output, const struct path_observation *value) {
  fprintf(output, "{\"result\":%d,\"errno\":%d,\"kind\":", value->result, value->error);
  if (value->kind == NULL) fputs("null", output);
  else fprintf(output, "\"%s\"", value->kind);
  fputs("}", output);
}
static int observe_dns(const char *report_path, const char *listed, const char *unlisted) {
  struct snapshot ports = snapshot();
  struct unix_observation dns_socket = {0}, canonical_socket = {0}, listed_socket = {0}, unlisted_socket = {0};
  struct path_observation var_alias, dns_alias, dns_canonical;
  observe_path("/var", &var_alias);
  observe_path("/var/run/mDNSResponder", &dns_alias);
  observe_path("/private/var/run/mDNSResponder", &dns_canonical);
  observe_unix("/var/run/mDNSResponder", &dns_socket);
  observe_unix("/private/var/run/mDNSResponder", &canonical_socket);
  observe_unix(listed, &listed_socket);
  observe_unix(unlisted, &unlisted_socket);
  DNSServiceRef service = NULL;
  DNSServiceErrorType dns_status = DNSServiceCreateConnection(&service);
  if (service != NULL) DNSServiceRefDeallocate(service);
  struct addrinfo hints = {0}, *addresses = NULL;
  hints.ai_family = AF_UNSPEC; hints.ai_socktype = SOCK_STREAM;
  errno = 0;
  int gai_status = getaddrinfo("example.com", "443", &hints, &addresses), gai_errno = errno;
  unsigned ipv4 = 0, ipv6 = 0;
  for (const struct addrinfo *item = gai_status == 0 ? addresses : NULL; item != NULL; item = item->ai_next) {
    if (item->ai_family == AF_INET) ++ipv4;
    if (item->ai_family == AF_INET6) ++ipv6;
  }
  if (gai_status == 0 && addresses != NULL) freeaddrinfo(addresses);
  FILE *output = fopen(report_path, "wx"); require(output != NULL, "exclusive DNS report");
  fprintf(output, "{\"phase\":\"native-dns\",\"pid\":%d,\"uid\":%u,"
    "\"hostname\":\"example.com\",\"endpoint\":\"/var/run/mDNSResponder\",\"ports\":", getpid(), (unsigned)getuid());
  print_snapshot(output, &ports);
  fputs(",\"socket\":", output); print_unix(output, &dns_socket);
  fputs(",\"unixAllowlist\":{\"listed\":", output); print_unix(output, &listed_socket);
  fputs(",\"unlisted\":", output); print_unix(output, &unlisted_socket);
  fputs("},\"canonicalEndpoint\":\"/private/var/run/mDNSResponder\",\"canonicalSocket\":", output);
  print_unix(output, &canonical_socket);
  fputs(",\"pathMetadata\":{\"varAlias\":", output); print_path(output, &var_alias);
  fputs(",\"dnsAlias\":", output); print_path(output, &dns_alias);
  fputs(",\"dnsCanonical\":", output); print_path(output, &dns_canonical);
  fprintf(output, "},\"dnssd\":{\"createResult\":%d},\"getaddrinfo\":{\"result\":%d,\"errno\":%d,\"ipv4\":%u,\"ipv6\":%u}}\n",
    dns_status, gai_status, gai_errno, ipv4, ipv6);
  require(fclose(output) == 0, "complete DNS report");
  release_snapshot(&ports, NULL, 0);
  return 0;
}
/* Isolated libc controls: no preceding DNS-SD calls or replacement resolver.
 * Keep service and execution context explicit; the original DNS observation
 * above remains unchanged and retains any failure. */
struct resolver_observation {
  const char *service;
  int result, error;
  unsigned ipv4, ipv6;
};
static void *resolve_once(void *opaque) {
  struct resolver_observation *value = opaque;
  struct addrinfo hints = {0}, *addresses = NULL;
  hints.ai_family = AF_UNSPEC; hints.ai_socktype = SOCK_STREAM;
  errno = 0;
  value->result = getaddrinfo("example.com", value->service, &hints, &addresses);
  value->error = errno;
  for (const struct addrinfo *item = value->result == 0 ? addresses : NULL; item != NULL; item = item->ai_next) {
    if (item->ai_family == AF_INET) ++value->ipv4;
    if (item->ai_family == AF_INET6) ++value->ipv6;
  }
  if (value->result == 0 && addresses != NULL) freeaddrinfo(addresses);
  return NULL;
}
static int observe_resolver(const char *report_path, const char *context, const char *service) {
  int threaded = strcmp(context, "thread") == 0;
  require(threaded || strcmp(context, "main") == 0, "closed resolver context");
  require(strcmp(service, "none") == 0 || strcmp(service, "443") == 0, "closed resolver service");
  struct snapshot ports = snapshot();
  struct resolver_observation value = { .service = strcmp(service, "none") == 0 ? NULL : "443" };
  if (threaded) {
    pthread_t thread;
    int status = pthread_create(&thread, NULL, resolve_once, &value);
    if (status != 0) { fprintf(stderr, "resolver pthread_create: status %d\n", status); _Exit(2); }
    status = pthread_join(thread, NULL);
    if (status != 0) { fprintf(stderr, "resolver pthread_join: status %d\n", status); _Exit(2); }
  } else resolve_once(&value);
  FILE *output = fopen(report_path, "wx"); require(output != NULL, "exclusive isolated resolver report");
  fprintf(output, "{\"phase\":\"native-resolver\",\"pid\":%d,\"uid\":%u,\"hostname\":\"example.com\","
    "\"context\":\"%s\",\"service\":%s,\"globalBootstrap\":%u,\"ports\":",
    getpid(), (unsigned)getuid(), context, value.service == NULL ? "null" : "\"443\"", bootstrap_port);
  print_snapshot(output, &ports);
  fprintf(output, ",\"getaddrinfo\":{\"result\":%d,\"errno\":%d,\"ipv4\":%u,\"ipv6\":%u}}\n",
    value.result, value.error, value.ipv4, value.ipv6);
  require(fclose(output) == 0, "complete isolated resolver report");
  release_snapshot(&ports, NULL, 0);
  return 0;
}
/* Executed after the sandboxed pruning helper execs this same controlled
 * image. An ordinary program can try these SDK calls; no new grant is used. */
static int restore_registered(char **argv) {
  struct snapshot before = snapshot();
  mach_port_t seed = before.count ? before.registered[0] : MACH_PORT_NULL;
  int attempted = MACH_PORT_VALID(seed);
  kern_return_t status = attempted ? task_set_bootstrap_port(mach_task_self(), seed) : KERN_INVALID_RIGHT;
  struct snapshot after = snapshot();
  FILE *output = fopen(argv[2], "wx"); require(output != NULL, "exclusive restoration report");
  fprintf(output, "{\"pid\":%d,\"uid\":%u,\"phase\":\"restore-registered-seed\",\"seed\":%u,"
    "\"attempted\":%s,\"setStatus\":", getpid(), (unsigned)getuid(), seed, attempted ? "true" : "false");
  if (attempted) fprintf(output, "%d", status); else fputs("null", output);
  fputs(",\"before\":", output); print_snapshot(output, &before);
  fputs(",\"after\":", output); print_snapshot(output, &after); fputs("}\n", output);
  require(fclose(output) == 0, "complete restoration report");
  release_snapshot(&before, NULL, 0); release_snapshot(&after, NULL, 0);
  if (!attempted) return 125;
  if (status != KERN_SUCCESS) return 126;
  execve(argv[3], &argv[3], environ);
  fprintf(stderr, "restored direct exec refused: errno %d\n", errno);
  return 126;
}
int main(int argc, char **argv) {
  require(getuid() != 0, "ordinary user required");
  if (argc == 5 && strcmp(argv[1], "observe-dns") == 0) return observe_dns(argv[2], argv[3], argv[4]);
  if (argc == 5 && strcmp(argv[1], "observe-resolver") == 0) return observe_resolver(argv[2], argv[3], argv[4]);
  require(argc >= 6, "mode profile report cwd executable [args]");
  if (strcmp(argv[1], "restore-registered-seed") == 0) return restore_registered(argv);
  const char *mode = argv[1];
  int clear_bootstrap = strcmp(mode, "inherited") != 0;
  int clear_registered = strcmp(mode, "bootstrap-and-xpc") == 0;
  require(!clear_bootstrap || clear_registered || strcmp(mode, "bootstrap-only") == 0, "closed experiment mode");
  require(chdir(argv[4]) == 0, "owned experiment cwd");
  apply_profile(argv[2]);
  struct snapshot before = snapshot();
  if (clear_bootstrap)
    mach_success(task_set_bootstrap_port(mach_task_self(), MACH_PORT_NULL), "clear task bootstrap port");
  if (clear_registered)
    mach_success(mach_ports_register(mach_task_self(), NULL, 0), "clear registered seed ports");
  mach_port_t dropped[4]; size_t dropped_count = 0;
  const mach_port_t old_ports[] = { before.bootstrap, before.registered[0], before.registered[1], before.registered[2] };
  for (size_t i = 0; clear_bootstrap && i < (clear_registered ? 4U : 1U); ++i) {
    mach_port_t port = old_ports[i];
    if (!MACH_PORT_VALID(port) || contains(dropped, dropped_count, port)) continue;
    require(port != mach_task_self(), "bootstrap rights cannot name the task itself");
    mach_port_urefs_t references = 0;
    mach_success(mach_port_get_refs(mach_task_self(), port, MACH_PORT_RIGHT_SEND, &references), "read owned send references");
    require(references > 0 && references <= INT_MAX, "bounded owned send references");
    mach_success(mach_port_mod_refs(mach_task_self(), port, MACH_PORT_RIGHT_SEND, -(mach_port_delta_t)references),
      "drop owned bootstrap send references");
    dropped[dropped_count++] = port;
  }
  struct snapshot after = snapshot();
  struct coalition_ids coalition = {0};
  errno = 0;
  int bytes = proc_pidinfo(getpid(), 20, 0, &coalition, sizeof coalition);
  int saved = bytes == (int)sizeof coalition ? 0 : errno;
  FILE *output = fopen(argv[3], "wx"); require(output != NULL, "exclusive observation report");
  fprintf(output, "{\"mode\":\"%s\",\"pid\":%d,\"uid\":%u,\"sandboxApplied\":true,"
    "\"coalitionBytes\":%d,\"coalitionErrno\":%d,\"resource\":\"%" PRIu64 "\",\"before\":",
    mode, getpid(), (unsigned)getuid(), bytes, saved, coalition.ids[0]);
  print_snapshot(output, &before); fputs(",\"after\":", output); print_snapshot(output, &after);
  fputs(",\"droppedSendRights\":[", output);
  for (size_t i = 0; i < dropped_count; ++i) fprintf(output, "%s%u", i ? "," : "", dropped[i]);
  fputs("],\"preExecObservation\":true}\n", output);
  require(fclose(output) == 0, "complete observation report");
  release_snapshot(&before, dropped, dropped_count);
  release_snapshot(&after, NULL, 0);
  execve(argv[5], &argv[5], environ);
  fprintf(stderr, "direct exec refused: errno %d\n", errno);
  return 126;
}
