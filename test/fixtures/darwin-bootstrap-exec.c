/* Controlled pre-exec experiment, not a production launcher or authority proof.
 * task special/registered ports use SDK Mach APIs. Treating registered ports
 * as libxpc's bootstrap seed is implementation behavior, not a public contract.
 * Unlike posix_spawn/fork, direct exec runs no intervening XPC atfork hook. */
#define _DARWIN_C_SOURCE 1
#include <mach/mach.h>
#include <mach/task_special_ports.h>
#include <libproc.h>
#include <sandbox.h>
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
  require(argc >= 6 && getuid() != 0, "mode profile report cwd executable [args] as ordinary user");
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
