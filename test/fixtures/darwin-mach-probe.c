/* Actual SDK/kernel observations, never a production authorization oracle. */
#define _DARWIN_C_SOURCE 1
#include <mach/mach.h>
#include <mach/message.h>
#include <bsm/libbsm.h>
#include <servers/bootstrap.h>
#include <libproc.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#include <signal.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

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

static mach_port_t owned_port(void) {
  mach_port_t receive = MACH_PORT_NULL;
  kernel_ok(mach_port_allocate(mach_task_self(), MACH_PORT_RIGHT_RECEIVE, &receive), "receive port");
  kernel_ok(mach_port_insert_right(mach_task_self(), receive, receive,
    MACH_MSG_TYPE_MAKE_SEND), "send right");
  return receive;
}
static mach_port_t owned_rendezvous(char service[BOOTSTRAP_MAX_NAME_LEN]) {
  int length = snprintf(service, BOOTSTRAP_MAX_NAME_LEN, "com.oma.native-probe.%d.%08x", getpid(), arc4random());
  require(length > 0 && length < BOOTSTRAP_MAX_NAME_LEN, "bounded unique service name");
  mach_port_t receive = MACH_PORT_NULL;
  kernel_ok(bootstrap_check_in(bootstrap_port, service, &receive), "check in owned rendezvous receiver");
  kernel_ok(mach_port_insert_right(mach_task_self(), receive, receive, MACH_MSG_TYPE_MAKE_SEND),
    "retain owned rendezvous send right");
  return receive;
}
static void close_owned_port(mach_port_t receive) {
  kernel_ok(mach_port_deallocate(mach_task_self(), receive), "release owned send right");
  kernel_ok(mach_port_mod_refs(mach_task_self(), receive, MACH_PORT_RIGHT_RECEIVE, -1),
    "release owned receive right");
}
static void send_request(mach_port_t destination, uint32_t sequence, pid_t claimed) {
  request_t request = {0};
  request.header.msgh_bits = MACH_MSGH_BITS_REMOTE(MACH_MSG_TYPE_COPY_SEND);
  request.header.msgh_size = sizeof request;
  request.header.msgh_remote_port = destination;
  request.header.msgh_id = 0x4f4d4101;
  request.sequence = sequence;
  request.claimed_pid = claimed;
  kernel_ok(mach_msg(&request.header, MACH_SEND_MSG | MACH_SEND_TIMEOUT,
    sizeof request, 0, MACH_PORT_NULL, 5000, MACH_PORT_NULL), "queue actual message");
}
static void receive_request(mach_port_t receive, request_t *request, mach_msg_audit_trailer_t *trailer) {
  received_t received = {0};
  mach_msg_header_t *header = (mach_msg_header_t *)received.bytes;
  // Chromium's MachPortRendezvousServerBase initializes both fields before
  // receiving and validates the kernel trailer separately from the payload.
  header->msgh_size = sizeof received;
  header->msgh_local_port = receive;
  kernel_ok(mach_msg(header, MACH_RCV_MSG | MACH_RCV_TIMEOUT |
    MACH_RCV_TRAILER_TYPE(MACH_MSG_TRAILER_FORMAT_0) |
    MACH_RCV_TRAILER_ELEMENTS(MACH_RCV_TRAILER_AUDIT),
    0, sizeof received, receive, 5000, MACH_PORT_NULL), "receive kernel audit trailer");
  require(header->msgh_size == sizeof(request_t) && header->msgh_id == 0x4f4d4101 &&
    !(header->msgh_bits & MACH_MSGH_BITS_COMPLEX), "received message shape");
  memcpy(request, received.bytes, sizeof *request);
  size_t offset = (header->msgh_size + 3u) & ~(size_t)3u;
  require(offset + sizeof *trailer <= sizeof received, "bounded audit trailer");
  memcpy(trailer, received.bytes + offset, sizeof *trailer);
  require(trailer->msgh_trailer_type == MACH_MSG_TRAILER_FORMAT_0 &&
    trailer->msgh_trailer_size >= sizeof *trailer &&
    trailer->msgh_trailer_size <= sizeof received - offset, "actual audit trailer shape");
}
static void self_probe(const char *name) {
  mach_port_t receive = owned_port();
  send_request(receive, 1, getpid());
  observe_queue(receive, "self-after-send");
  request_t request;
  mach_msg_audit_trailer_t trailer;
  receive_request(receive, &request, &trailer);
  require(request.sequence == 1 && request.claimed_pid == getpid() &&
    audit_token_to_pid(trailer.msgh_audit) == getpid() &&
    audit_token_to_euid(trailer.msgh_audit) == geteuid(), "self audit identity and body");
  close_owned_port(receive);
  printf("{\"case\":\"%s\",\"machSelf\":{\"pid\":%d,\"auditPid\":%d,\"auditEuid\":%u}}\n",
    name, getpid(), audit_token_to_pid(trailer.msgh_audit),
    (unsigned int)audit_token_to_euid(trailer.msgh_audit));
}

static void send_from_child(const char *service, uint32_t sequence, pid_t claimed, int ready, int finish) {
  mach_port_t destination = MACH_PORT_NULL;
  kernel_ok(bootstrap_look_up(bootstrap_port, (char *)service, &destination), "lookup owned rendezvous endpoint");
  require(MACH_PORT_VALID(destination), "rendezvous right shape");
  mach_port_type_t type = 0;
  kernel_ok(mach_port_type(mach_task_self(), destination, &type), "observe rendezvous right type");
  fprintf(stderr, "sender: pid=%d task=%u port=%u type=%u sequence=%u\n", getpid(),
    mach_task_self(), destination, type, sequence);
  send_request(destination, sequence, claimed);
  kernel_ok(mach_port_deallocate(mach_task_self(), destination), "release rendezvous send right");
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
static void rendezvous_probe(const char *name, int exit_before_receive) {
  // The endpoint is discovered as in Chromium's macOS rendezvous. Its random
  // name grants no authority: each queued sender still needs a kernel trailer.
  char service[BOOTSTRAP_MAX_NAME_LEN];
  mach_port_t receive = owned_rendezvous(service);
  int first_ready[2], finish[2];
  require(pipe(first_ready) == 0 && pipe(finish) == 0, "first sender fixture pipes");
  pid_t connector = fork(); require(connector >= 0, "first sender fork");
  if (connector == 0) {
    close(first_ready[0]); close(finish[1]);
    send_from_child(service, 1, getpid(), first_ready[1], finish[0]);
  }
  close(first_ready[1]);
  char marker = 0;
  require(read(first_ready[0], &marker, 1) == 1, "first message queued"); close(first_ready[0]);
  observe_queue(receive, "after-first-send");
  int second_ready[2]; require(pipe(second_ready) == 0, "second sender fixture pipe");
  pid_t holder = fork(); require(holder >= 0, "independent second sender fork");
  if (holder == 0) {
    close(second_ready[0]); close(finish[1]);
    /* The body deliberately claims the first sender. The trailer must be
     * obtained from the kernel, independently of this untrusted field. */
    send_from_child(service, 2, connector, second_ready[1], finish[0]);
  }
  close(second_ready[1]); close(finish[0]);
  require(read(second_ready[0], &marker, 1) == 1, "second message queued"); close(second_ready[0]);
  int both_alive = kill(connector, 0) == 0 && kill(holder, 0) == 0;
  require(both_alive, "senders remain alive until explicit completion");
  observe_queue(receive, "both-messages-queued");
  if (exit_before_receive) {
    close(finish[1]); wait_success(connector); wait_success(holder);
  }
  printf("{\"case\":\"%s\",\"%s\":{\"sendersAliveWhenQueued\":true,\"joinedBeforeReceive\":%s,\"connectorPid\":%d,\"holderPid\":%d,\"messages\":[",
    name, exit_before_receive ? "machRendezvousExit" : "machRendezvousLive",
    exit_before_receive ? "true" : "false", connector, holder);
  for (uint32_t index = 1; index <= 2; index++) {
    request_t request;
    mach_msg_audit_trailer_t trailer;
    receive_request(receive, &request, &trailer);
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
  close_owned_port(receive);
  putchar('\n');
}
static int wait_owned(pid_t *child, int *status, double seconds) {
  struct timespec start, current;
  if (*child <= 0 || clock_gettime(CLOCK_MONOTONIC, &start) != 0) return -1;
  const pid_t owned = *child;
  for (;;) {
    pid_t answer = waitpid(owned, status, WNOHANG);
    if (answer == owned) {
      if (!WIFEXITED(*status) && !WIFSIGNALED(*status)) return -1;
      *child = 0;
      return 1;
    }
    if (answer < 0 && errno != EINTR) {
      if (errno == ECHILD) *child = 0;
      return -1;
    }
    if (clock_gettime(CLOCK_MONOTONIC, &current) != 0) return -1;
    double elapsed = (double)(current.tv_sec - start.tv_sec) +
      (double)(current.tv_nsec - start.tv_nsec) / 1000000000.0;
    if (elapsed >= seconds) return 0;
    usleep(1000);
  }
}
static int end_owned(pid_t *child, int *status) {
  if (*child <= 0) return 0;
  const pid_t owned = *child;
  int failed = kill(owned, SIGKILL) != 0 && errno != ESRCH;
  pid_t joined;
  do { joined = waitpid(owned, status, 0); } while (joined < 0 && errno == EINTR);
  if (joined == owned || (joined < 0 && errno == ECHILD)) *child = 0;
  return failed || joined != owned ? -1 : 0;
}
struct token_control_answer {
  pid_t controller_pid;
  uid_t controller_uid;
  int zero_status;
  int wrong_version_status;
  int kill_status;
};
static int read_control_answer(int fd, struct token_control_answer *answer) {
  size_t done = 0;
  while (done < sizeof *answer) {
    ssize_t count = read(fd, (char *)answer + done, sizeof *answer - done);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return -1;
    done += (size_t)count;
  }
  return 0;
}
static void token_control_probe(const char *name) {
  // SDK libproc.h marks this interface private/unstable. This experiment
  // tests a target generation, never a sender role or complete scope death.
  require(getuid() != 0 && geteuid() != 0, "ordinary UID required for this control experiment");
  char service[BOOTSTRAP_MAX_NAME_LEN];
  mach_port_t receive = owned_rendezvous(service);
  int ready[2], finish[2], answers[2] = {-1, -1};
  require(pipe(ready) == 0 && pipe(finish) == 0, "owned target pipes");
  pid_t target = fork(); require(target >= 0, "owned target fork");
  if (target == 0) {
    close(ready[0]); close(finish[1]);
    send_from_child(service, 1, getpid(), ready[1], finish[0]);
  }
  const pid_t target_pid = target;
  close(ready[1]); ready[1] = -1;
  close(finish[0]); finish[0] = -1;
  char marker;
  require(read(ready[0], &marker, 1) == 1, "target queued its actual kernel identity");
  close(ready[0]); ready[0] = -1;
  request_t request;
  mach_msg_audit_trailer_t trailer;
  receive_request(receive, &request, &trailer);
  require(request.sequence == 1 && request.claimed_pid == target_pid &&
    audit_token_to_pid(trailer.msgh_audit) == target_pid &&
    audit_token_to_euid(trailer.msgh_audit) == geteuid() && trailer.msgh_audit.val[7] > 0,
    "control token must be the owned child's actual kernel trailer");
  pid_t controller = 0;
  int result = 2, target_status = 0, controller_status = 0;
  int exited_before_cleanup = 0, numeric_cleanup = 0;
  struct token_control_answer answer = {0};
  if (pipe(answers) != 0) { perror("controller result pipe"); goto cleanup; }
  controller = fork();
  if (controller < 0) { controller = 0; perror("nonparent controller fork"); goto cleanup; }
  if (controller == 0) {
    close(answers[0]);
    // Hold supervision EOF through the last SDK call even if the parent dies.
    audit_token_t genuine = trailer.msgh_audit, wrong = genuine;
    // Negative input only: a different, nonzero generation of the same PID.
    wrong.val[7] = wrong.val[7] == UINT32_MAX ? wrong.val[7] - 1 : wrong.val[7] + 1;
    struct token_control_answer reply = {getpid(), geteuid(), 0, 0, 0};
    reply.zero_status = proc_signal_with_audittoken(&genuine, 0);
    reply.wrong_version_status = proc_signal_with_audittoken(&wrong, SIGSTOP);
    reply.kill_status = proc_signal_with_audittoken(&genuine, SIGKILL);
    ssize_t sent;
    do { sent = write(answers[1], &reply, sizeof reply); } while (sent < 0 && errno == EINTR);
    _exit(sent == (ssize_t)sizeof reply ? 0 : 2);
  }
  const pid_t controller_pid = controller;
  close(answers[1]); answers[1] = -1;
  if (wait_owned(&controller, &controller_status, 3) != 1 ||
      !WIFEXITED(controller_status) || WEXITSTATUS(controller_status) != 0 ||
      read_control_answer(answers[0], &answer) != 0 ||
      answer.controller_pid != controller_pid || answer.controller_uid != geteuid()) {
    fprintf(stderr, "nonparent controller did not return its actual result\n"); goto cleanup;
  }
  int joined = wait_owned(&target, &target_status, 2);
  if (joined < 0) { perror("owned target observation"); goto cleanup; }
  exited_before_cleanup = joined == 1;
  if (!exited_before_cleanup) {
    // Fixture cleanup only: the direct parent still owns this unreaped PID.
    // Never promote this to recovery control of a saved integer.
    numeric_cleanup = 1;
    if (end_owned(&target, &target_status) != 0) { perror("owned target cleanup"); goto cleanup; }
  }
  printf("{\"case\":\"%s\",\"machTokenControl\":{\"scope\":\"owned-child-generation-only\",\"controllerContext\":\"sibling-fork-no-profile-applied\",\"sdkInterfacePrivate\":true,\"kernelTokenReceived\":true,\"ownerPid\":%d,\"ownerUid\":%u,\"controllerPid\":%d,\"controllerUid\":%u,\"targetPid\":%d,\"targetUid\":%u,\"targetPidVersion\":%u,\"zeroSignalStatus\":%d,\"wrongVersionStatus\":%d,\"killStatus\":%d,\"exitedBeforeCleanup\":%s,\"numericCleanupUsed\":%s,\"targetExitCode\":",
    name, getpid(), (unsigned int)geteuid(), answer.controller_pid, (unsigned int)answer.controller_uid,
    target_pid, (unsigned int)audit_token_to_euid(trailer.msgh_audit), (unsigned int)trailer.msgh_audit.val[7],
    answer.zero_status, answer.wrong_version_status, answer.kill_status,
    exited_before_cleanup ? "true" : "false", numeric_cleanup ? "true" : "false");
  if (WIFEXITED(target_status)) printf("%d", WEXITSTATUS(target_status)); else printf("null");
  printf(",\"targetSignal\":");
  if (WIFSIGNALED(target_status)) printf("%d", WTERMSIG(target_status)); else printf("null");
  printf(",\"unreapedPidControl\":true,\"ownedChildrenJoined\":true}}\n");
  result = 0;
cleanup:
  if (end_owned(&controller, &controller_status) != 0) result = 2;
  if (end_owned(&target, &target_status) != 0) result = 2;
  for (size_t i = 0; i < 2; i++) {
    if (ready[i] >= 0) close(ready[i]);
    if (finish[i] >= 0) close(finish[i]);
    if (answers[i] >= 0) close(answers[i]);
  }
  close_owned_port(receive);
  if (result != 0) exit(result);
}
int main(int argc, char **argv) {
  require(argc == 2, "one independent case required");
  if (strcmp(argv[1], "mach-self") == 0) { self_probe(argv[1]); return 0; }
  if (strcmp(argv[1], "mach-token-control") == 0) { token_control_probe(argv[1]); return 0; }
  int exited = strcmp(argv[1], "mach-rendezvous-exit") == 0;
  require(exited || strcmp(argv[1], "mach-rendezvous-live") == 0, "unknown Mach probe case");
  rendezvous_probe(argv[1], exited);
  return 0;
}
