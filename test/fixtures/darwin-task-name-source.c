/* Controlled expected-peer capability candidate. No role or privileged RPC. */
#include <mach/mach.h>
#include <mach/task_special_ports.h>
#include <mach_debug/ipc_info.h>
#include <libproc.h>
#include <stdint.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <spawn.h>
#include <unistd.h>
#define main oma_seatbelt_entry
#include "../../packages/platform-mac/src/seatbelt/main.c"
#undef main

static void checked(int condition, const char *message) {
  if (!condition) { perror(message); exit(70); }
}
static void return_ports(mach_port_array_t ports, mach_msg_type_number_t count) {
  for (mach_msg_type_number_t i = 0; i < count; ++i)
    if (MACH_PORT_VALID(ports[i])) checked(mach_port_deallocate(mach_task_self(), ports[i]) == KERN_SUCCESS, "return port");
  if (count) checked(vm_deallocate(mach_task_self(), (vm_address_t)ports, count * sizeof(*ports)) == KERN_SUCCESS, "return port array");
}
static void record_name(mach_port_t source, pid_t pid) {
  ipc_info_object_type_t type = IPC_OTYPE_UNKNOWN; mach_vm_address_t ignored = 0;
  kern_return_t kind = mach_port_kobject(mach_task_self(), source, &type, &ignored);
  audit_token_t token = {{0}}; mach_msg_type_number_t words = TASK_AUDIT_TOKEN_COUNT;
  kern_return_t audit = kind == KERN_SUCCESS && type == IPC_OTYPE_TASK_NAME ?
    task_info(source, TASK_AUDIT_TOKEN, (task_info_t)&token, &words) : KERN_INVALID_RIGHT;
  unsigned char generation[56] = {0}; errno = 0;
  int bytes = proc_pidinfo(pid, 17, 0, generation, sizeof generation), saved = errno;
  uint32_t version = 0; if (bytes == sizeof generation) memcpy(&version, generation + 32, sizeof version);
  printf("{\"kobjectStatus\":%d,\"kobjectType\":%u,\"auditStatus\":%d,\"auditWords\":%u,\"generationBytes\":%d,\"generationErrno\":%d,\"pidVersion\":%u,\"token\":[",
    kind, type, audit, words, bytes, saved, version);
  for (unsigned i = 0; i < 8; ++i) printf("%s%u", i ? "," : "", token.val[i]);
  printf("]}\n"); fflush(stdout);
}
static void probe(pid_t unrelated, int forged) {
  mach_port_array_t ports = NULL; mach_msg_type_number_t count = 0;
  checked(mach_ports_lookup(mach_task_self(), &ports, &count) == KERN_SUCCESS && count >= 2, "inherited source ports");
  mach_port_t source = ports[1], fake = MACH_PORT_NULL;
  if (forged == 2) {
    checked(task_name_for_pid(mach_task_self(), getpid(), &fake) == KERN_SUCCESS, "own name counterexample"); source = fake;
  } else if (forged == 1) {
    checked(mach_port_allocate(mach_task_self(), MACH_PORT_RIGHT_RECEIVE, &fake) == KERN_SUCCESS &&
      mach_port_insert_right(mach_task_self(), fake, fake, MACH_MSG_TYPE_MAKE_SEND) == KERN_SUCCESS, "fake user-space port");
    source = fake;
  }
  ipc_info_object_type_t type = 0; mach_vm_address_t ignored = 0;
  kern_return_t kind = mach_port_kobject(mach_task_self(), source, &type, &ignored);
  if (kind != KERN_SUCCESS || type != IPC_OTYPE_TASK_NAME) {
    printf("{\"kind\":\"rejected\",\"kobjectStatus\":%d,\"kobjectType\":%u,\"queryAttempted\":false}\n", kind, type);
  } else {
    audit_token_t token = {{0}}; mach_msg_type_number_t words = TASK_AUDIT_TOKEN_COUNT;
    kern_return_t audit = task_info(source, TASK_AUDIT_TOKEN, (task_info_t)&token, &words);
    mach_port_t bootstrap = MACH_PORT_NULL;
    kern_return_t special = task_get_special_port(source, TASK_BOOTSTRAP_PORT, &bootstrap);
    if (special == KERN_SUCCESS && MACH_PORT_VALID(bootstrap)) checked(mach_port_deallocate(mach_task_self(), bootstrap) == KERN_SUCCESS, "return unexpected bootstrap");
    mach_port_array_t foreign = NULL; mach_msg_type_number_t foreign_count = 0;
    kern_return_t lookup = mach_ports_lookup(source, &foreign, &foreign_count);
    if (lookup == KERN_SUCCESS) return_ports(foreign, foreign_count);
    struct task_dyld_info dyld = {0}; mach_msg_type_number_t dyld_count = TASK_DYLD_INFO_COUNT;
    kern_return_t inspect = task_info(source, TASK_DYLD_INFO, (task_info_t)&dyld, &dyld_count);
    mach_port_t foreign_name = MACH_PORT_NULL;
    kern_return_t acquisition = task_name_for_pid(mach_task_self(), unrelated, &foreign_name);
    if (acquisition == KERN_SUCCESS && MACH_PORT_VALID(foreign_name)) checked(mach_port_deallocate(mach_task_self(), foreign_name) == KERN_SUCCESS, "return unrelated name");
    uint64_t own[5] = {0}, host[5] = {0}; errno = 0;
    int own_bytes = proc_pidinfo(getpid(), 20, 0, own, sizeof own), own_errno = errno; errno = 0;
    int host_bytes = proc_pidinfo((pid_t)token.val[5], 20, 0, host, sizeof host), host_errno = errno;
    printf("{\"kind\":\"name\",\"pid\":%d,\"kobjectStatus\":%d,\"kobjectType\":%u,\"auditStatus\":%d,\"auditWords\":%u,\"bootstrapStatus\":%d,\"registeredPortsStatus\":%d,\"dyldInfoStatus\":%d,\"unrelatedNameStatus\":%d,\"ownCoalitionBytes\":%d,\"ownCoalitionErrno\":%d,\"ownCoalition\":\"%llu\",\"hostCoalitionBytes\":%d,\"hostCoalitionErrno\":%d,\"hostCoalition\":\"%llu\",\"token\":[",
      getpid(), kind, type, audit, words, special, lookup, inspect, acquisition, own_bytes, own_errno,
      (unsigned long long)own[0], host_bytes, host_errno, (unsigned long long)host[0]);
    for (unsigned i = 0; i < 8; ++i) printf("%s%u", i ? "," : "", token.val[i]);
    printf("]}\n");
  }
  if (MACH_PORT_VALID(fake)) {
    if (forged == 1) checked(mach_port_mod_refs(mach_task_self(), fake, MACH_PORT_RIGHT_RECEIVE, -1) == KERN_SUCCESS, "return fake receiver");
    checked(mach_port_deallocate(mach_task_self(), fake) == KERN_SUCCESS, "return fake send reference");
  }
  return_ports(ports, count); fflush(stdout);
}
int main(int argc, char **argv) {
  if (argc == 3 && !strcmp(argv[1], "--hold")) {
    pid_t pid = (pid_t)atoi(argv[2]); mach_port_t source = MACH_PORT_NULL;
    checked(pid > 1 && task_name_for_pid(mach_task_self(), pid, &source) == KERN_SUCCESS, "held source name");
    record_name(source, pid);
    char release; ssize_t bytes; do { bytes = read(STDIN_FILENO, &release, 1); } while (bytes < 0 && errno == EINTR);
    checked(bytes == 1, "held source observation release");
    record_name(source, pid);
    checked(mach_port_deallocate(mach_task_self(), source) == KERN_SUCCESS, "return held source"); return 0;
  }
  if (argc >= 3 && (!strcmp(argv[1], "--query") || !strcmp(argv[1], "--forged") || !strcmp(argv[1], "--self"))) {
    probe((pid_t)atoi(argv[2]), !strcmp(argv[1], "--forged") ? 1 : !strcmp(argv[1], "--self") ? 2 : 0); return 0;
  }
  if (argc == 6 && !strcmp(argv[1], "--after-sandbox")) {
    probe((pid_t)atoi(argv[2]), 0);
    char *node[] = { argv[3], "-e", argv[5], argv[4], argv[2], NULL };
    posix_spawnattr_t attributes;
    checked(posix_spawnattr_init(&attributes) == 0 && posix_spawnattr_setflags(&attributes, POSIX_SPAWN_SETEXEC) == 0, "Node setexec attributes");
    int result = posix_spawn(NULL, node[0], NULL, &attributes, node, environ);
    errno = result; checked(0, "Node setexec");
  }
  checked(argc >= 10, "eight source token words");
  audit_token_t expected = {{0}}, observed = {{0}};
  for (unsigned i = 0; i < 8; ++i) {
    char *end; errno = 0; unsigned long long word = strtoull(argv[i + 1], &end, 10);
    checked(!errno && *argv[i + 1] && !*end && word <= UINT32_MAX, "source token word"); expected.val[i] = (uint32_t)word;
  }
  mach_port_t host = MACH_PORT_NULL; mach_msg_type_number_t words = TASK_AUDIT_TOKEN_COUNT;
  checked(task_name_for_pid(mach_task_self(), (pid_t)expected.val[5], &host) == KERN_SUCCESS &&
    task_info(host, TASK_AUDIT_TOKEN, (task_info_t)&observed, &words) == KERN_SUCCESS && words == TASK_AUDIT_TOKEN_COUNT &&
    memcmp(&expected, &observed, sizeof expected) == 0, "actual source task-name token");
  mach_port_array_t inherited = NULL; mach_msg_type_number_t inherited_count = 0;
  checked(mach_ports_lookup(mach_task_self(), &inherited, &inherited_count) == KERN_SUCCESS && inherited_count >= 1, "inherited discard seed");
  mach_port_t registered[] = { inherited[0], host };
  checked(mach_ports_register(mach_task_self(), registered, 2) == KERN_SUCCESS, "register inert source candidate");
  return_ports(inherited, inherited_count); checked(mach_port_deallocate(mach_task_self(), host) == KERN_SUCCESS, "return source local copy");
  argv[8] = argv[0]; return oma_seatbelt_entry(argc - 8, argv + 8);
}
