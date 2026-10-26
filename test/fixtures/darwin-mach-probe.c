/* Actual SDK/kernel observations, never a production authorization oracle. */
#define _DARWIN_C_SOURCE 1
#include <mach/mach.h>
#include <mach/message.h>
#include <bsm/libbsm.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#include <signal.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void require(int condition, const char *label) {
  if (!condition) { perror(label); exit(2); }
}
static void kernel_ok(kern_return_t result, const char *label) {
  if (result != KERN_SUCCESS) {
    fprintf(stderr, "%s: %d (%s)\n", label, result, mach_error_string(result));
    exit(2);
  }
}
typedef struct {
  mach_msg_header_t header;
  uint32_t sequence;
  int32_t claimed_pid;
} request_t;
typedef union {
  mach_msg_header_t alignment;
  unsigned char bytes[sizeof(request_t) + MAX_TRAILER_SIZE];
} received_t;

static void observe_queue(mach_port_t receive, const char *phase) {
  mach_port_status_t status = {0};
  mach_msg_type_number_t count = MACH_PORT_RECEIVE_STATUS_COUNT;
  kernel_ok(mach_port_get_attributes(mach_task_self(), receive, MACH_PORT_RECEIVE_STATUS,
    (mach_port_info_t)&status, &count), "observe actual receive queue");
  fprintf(stderr, "%s: pid=%d task=%u receive=%u queued=%u sendRights=%u\n", phase,
    getpid(), mach_task_self(), receive, (unsigned int)status.mps_msgcount,
    (unsigned int)status.mps_srights);
}

static void send_from_child(uint32_t sequence, pid_t claimed, int ready, int finish) {
  mach_port_array_t ports = NULL;
  mach_msg_type_number_t count = 0;
  kernel_ok(mach_ports_lookup(mach_task_self(), &ports, &count), "lookup inherited send right");
  require(count > 0 && MACH_PORT_VALID(ports[0]), "inherited port shape");
  mach_port_type_t type = 0;
  kernel_ok(mach_port_type(mach_task_self(), ports[0], &type), "observe inherited right type");
  fprintf(stderr, "sender: pid=%d task=%u port=%u type=%u sequence=%u\n", getpid(),
    mach_task_self(), ports[0], type, sequence);
  request_t request = {0};
  request.header.msgh_bits = MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, 0);
  request.header.msgh_size = sizeof request;
  request.header.msgh_remote_port = ports[0];
  request.header.msgh_id = 0x4f4d4101;
  request.sequence = sequence;
  request.claimed_pid = claimed;
  kernel_ok(mach_msg(&request.header, MACH_SEND_MSG | MACH_SEND_TIMEOUT,
    sizeof request, 0, MACH_PORT_NULL, 5000, MACH_PORT_NULL), "queue child message");
  for (mach_msg_type_number_t i = 0; i < count; i++)
    if (MACH_PORT_VALID(ports[i])) kernel_ok(mach_port_deallocate(mach_task_self(), ports[i]), "release inherited right");
  kernel_ok(vm_deallocate(mach_task_self(), (vm_address_t)(uintptr_t)ports,
    count * sizeof *ports), "release inherited port array");
  require(write(ready, "r", 1) == 1, "child queued");
  close(ready);
  char marker;
  ssize_t result;
  do { result = read(finish, &marker, 1); } while (result < 0 && errno == EINTR);
  require(result == 0, "child completion EOF");
  close(finish);
  _exit(0);
}
static void wait_success(pid_t child) {
  int status = 0;
  require(waitpid(child, &status, 0) == child && WIFEXITED(status) && WEXITSTATUS(status) == 0,
    "join actual sender");
}
static void queued_probe(const char *name, int exit_before_receive) {
  mach_port_t receive = MACH_PORT_NULL;
  kernel_ok(mach_port_allocate(mach_task_self(), MACH_PORT_RIGHT_RECEIVE, &receive), "receive port");
  kernel_ok(mach_port_insert_right(mach_task_self(), receive, receive,
    MACH_MSG_TYPE_MAKE_SEND), "send right");
  kernel_ok(mach_ports_register(mach_task_self(), &receive, 1), "register owned send right");
  int ready[2], finish[2];
  require(pipe(ready) == 0 && pipe(finish) == 0, "private fixture pipes");
  pid_t connector = fork(); require(connector >= 0, "first sender fork");
  if (connector == 0) {
    close(ready[0]); close(finish[1]);
    send_from_child(1, getpid(), ready[1], finish[0]);
  }
  char marker = 0;
  require(read(ready[0], &marker, 1) == 1, "first message queued");
  observe_queue(receive, "after-first-send");
  pid_t holder = fork(); require(holder >= 0, "independent second sender fork");
  if (holder == 0) {
    close(ready[0]); close(finish[1]);
    /* The body deliberately claims the first sender. The trailer must be
     * obtained from the kernel, independently of this untrusted field. */
    send_from_child(2, connector, ready[1], finish[0]);
  }
  close(ready[1]); close(finish[0]);
  require(read(ready[0], &marker, 1) == 1, "second message queued"); close(ready[0]);
  int both_alive = kill(connector, 0) == 0 && kill(holder, 0) == 0;
  require(both_alive, "senders remain alive until explicit completion");
  observe_queue(receive, "before-unregister");
  kernel_ok(mach_ports_register(mach_task_self(), NULL, 0), "remove owned registered rights");
  observe_queue(receive, "after-unregister");
  if (exit_before_receive) {
    close(finish[1]); wait_success(connector); wait_success(holder);
  }
  printf("{\"case\":\"%s\",\"%s\":{\"sendersAliveWhenQueued\":true,\"joinedBeforeReceive\":%s,\"connectorPid\":%d,\"holderPid\":%d,\"messages\":[",
    name, exit_before_receive ? "machQueuedExit" : "machQueuedLive",
    exit_before_receive ? "true" : "false", connector, holder);
  for (uint32_t index = 1; index <= 2; index++) {
    received_t received = {0};
    mach_msg_header_t *header = (mach_msg_header_t *)received.bytes;
    kernel_ok(mach_msg(header, MACH_RCV_MSG | MACH_RCV_TIMEOUT |
      MACH_RCV_TRAILER_TYPE(MACH_MSG_TRAILER_FORMAT_0) |
      MACH_RCV_TRAILER_ELEMENTS(MACH_RCV_TRAILER_AUDIT),
      0, sizeof received, receive, 5000, MACH_PORT_NULL), "receive kernel audit trailer");
    require(header->msgh_size == sizeof(request_t) && header->msgh_id == 0x4f4d4101 &&
      !(header->msgh_bits & MACH_MSGH_BITS_COMPLEX), "received message shape");
    request_t request; memcpy(&request, received.bytes, sizeof request);
    size_t offset = (header->msgh_size + 3u) & ~(size_t)3u;
    require(offset + sizeof(mach_msg_audit_trailer_t) <= sizeof received, "bounded audit trailer");
    mach_msg_audit_trailer_t trailer;
    memcpy(&trailer, received.bytes + offset, sizeof trailer);
    require(trailer.msgh_trailer_type == MACH_MSG_TRAILER_FORMAT_0 &&
      trailer.msgh_trailer_size >= sizeof trailer &&
      trailer.msgh_trailer_size <= sizeof received - offset, "actual audit trailer shape");
    pid_t sender = audit_token_to_pid(trailer.msgh_audit);
    pid_t expected = index == 1 ? connector : holder;
    require(request.sequence == index && request.claimed_pid == connector && sender == expected &&
      audit_token_to_euid(trailer.msgh_audit) == geteuid(),
      "message origin must follow kernel sender, including forged body");
    printf("%s{\"sequence\":%u,\"claimedPid\":%d,\"auditPid\":%d,\"auditEuid\":%u,\"token\":[",
      index == 1 ? "" : ",", index, request.claimed_pid, sender,
      (unsigned int)audit_token_to_euid(trailer.msgh_audit));
    for (size_t i = 0; i < sizeof trailer.msgh_audit.val / sizeof trailer.msgh_audit.val[0]; i++)
      printf("%s%u", i == 0 ? "" : ",", trailer.msgh_audit.val[i]);
    printf("]}");
  }
  printf("]}}");
  if (!exit_before_receive) {
    require(kill(connector, 0) == 0 && kill(holder, 0) == 0, "senders live through both receives");
    close(finish[1]); wait_success(connector); wait_success(holder);
  }
  kernel_ok(mach_port_deallocate(mach_task_self(), receive), "release owned send right");
  kernel_ok(mach_port_mod_refs(mach_task_self(), receive, MACH_PORT_RIGHT_RECEIVE, -1),
    "release owned receive right");
  putchar('\n');
}
int main(int argc, char **argv) {
  require(argc == 2, "one independent case required");
  int exited = strcmp(argv[1], "mach-queued-exit") == 0;
  require(exited || strcmp(argv[1], "mach-queued-live") == 0, "unknown Mach probe case");
  queued_probe(argv[1], exited);
  return 0;
}
