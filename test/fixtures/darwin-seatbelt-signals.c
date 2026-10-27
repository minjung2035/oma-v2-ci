/* Signal-label observations only, not a production sandbox or death oracle.
 * Both targets remain this process's unreaped children until every signal is
 * finished: even an unexpected child exit cannot turn a PID into an outsider.
 * The permissive profile isolates signal identity; it contains no real tool. */
#define _DARWIN_C_SOURCE 1
#include <sandbox.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#include <signal.h>
#include <poll.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const char profile[] = "(version 1)(allow default)(deny signal (require-not (target same-sandbox)))";
static const char nested_profile[] = "(version 1)(allow default)(deny process-fork)";
struct target { pid_t pid; int control, ready, ack; };
struct apply_result { int code, error; };
struct signal_result { int code, error, delivered; };
static int signal_ack = -1;
static void require(int condition, const char *label) {
  if (!condition) { perror(label); exit(2); }
}
static void receive(int fd, void *bytes, size_t length) {
  size_t at = 0;
  while (at < length) {
    ssize_t count = read(fd, (char *)bytes + at, length - at);
    if (count < 0 && errno == EINTR) continue;
    require(count > 0, "signal probe receive");
    at += (size_t)count;
  }
}
static void send_bytes(int fd, const void *bytes, size_t length) {
  size_t at = 0;
  while (at < length) {
    ssize_t count = write(fd, (const char *)bytes + at, length - at);
    if (count < 0 && errno == EINTR) continue;
    require(count > 0, "signal probe send");
    at += (size_t)count;
  }
}
static struct apply_result apply(const char *text) {
  char *error = NULL;
  errno = 0;
  /* Same public, deprecated SDK entrypoint as the production launcher. */
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
  int code = sandbox_init(text, 0, &error), saved = errno;
  if (error != NULL) { fprintf(stderr, "signal probe sandbox: %s\n", error); sandbox_free_error(error); }
#pragma clang diagnostic pop
  return (struct apply_result){ code, code == 0 ? 0 : saved };
}
static void acknowledge(int number) {
  (void)number;
  int saved = errno;
  (void)write(signal_ack, "s", 1);
  errno = saved;
}
static struct target spawn_target(int apply_independently, const struct target *previous) {
  int ready[2], control[2], ack[2];
  require(pipe(ready) == 0 && pipe(control) == 0 && pipe(ack) == 0, "target pipes");
  pid_t pid = fork(); require(pid >= 0, "target fork");
  if (pid == 0) {
    close(ready[0]); close(control[1]); close(ack[0]);
    if (previous != NULL) { close(previous->control); close(previous->ready); close(previous->ack); }
    signal_ack = ack[1];
    struct sigaction action = {0};
    action.sa_handler = acknowledge;
    require(sigemptyset(&action.sa_mask) == 0 && sigaction(SIGUSR1, &action, NULL) == 0, "target handler");
    if (apply_independently) require(apply(profile).code == 0, "independent sandbox");
    send_bytes(ready[1], "r", 1);
    for (;;) {
      char command;
      ssize_t count = read(control[0], &command, 1);
      if (count < 0 && errno == EINTR) continue;
      require(count >= 0, "target control");
      if (count == 0) break;
      require(command == 'n', "target nested command");
      struct apply_result result = apply(nested_profile);
      send_bytes(ready[1], &result, sizeof result);
    }
    close(control[0]); close(ready[1]); close(ack[1]); _exit(0);
  }
  close(ready[1]); close(control[0]); close(ack[1]);
  char marker; receive(ready[0], &marker, 1); require(marker == 'r', "target ready");
  return (struct target){ pid, control[1], ready[0], ack[0] };
}
static int available(int fd, int timeout) {
  struct pollfd item = { .fd = fd, .events = POLLIN };
  int result;
  do { result = poll(&item, 1, timeout); } while (result < 0 && errno == EINTR);
  require(result >= 0, "signal acknowledgement poll");
  if (result > 0) require((item.revents & POLLIN) != 0, "signal acknowledgement channel");
  return result;
}
static struct signal_result signal_target(const struct target *target) {
  int status;
  require(waitpid(target->pid, &status, WNOHANG) == 0, "target alive before signal");
  require(available(target->ack, 0) == 0, "no unrelated acknowledgement");
  errno = 0;
  int code = kill(target->pid, SIGUSR1), error = code == 0 ? 0 : errno;
  if (code == 0) {
    require(available(target->ack, 1000) == 1, "signal actually delivered");
    char marker; receive(target->ack, &marker, 1); require(marker == 's', "signal acknowledgement");
  } else require(available(target->ack, 0) == 0, "refused signal not delivered");
  require(waitpid(target->pid, &status, WNOHANG) == 0, "target alive after signal");
  return (struct signal_result){ code, error, code == 0 };
}
static void finish(struct target *target) {
  close(target->control);
  int status; pid_t joined;
  do { joined = waitpid(target->pid, &status, 0); } while (joined < 0 && errno == EINTR);
  require(joined == target->pid && WIFEXITED(status) && WEXITSTATUS(status) == 0, "owned target joined");
  close(target->ready); close(target->ack);
}
static void print_signal(const char *name, struct signal_result result) {
  printf("\"%s\":{\"returnCode\":%d,\"errno\":%d,\"delivered\":%s}",
    name, result.code, result.error, result.delivered ? "true" : "false");
}
int main(int argc, char **argv) {
  require(argc == 2 && strcmp(argv[1], "seatbelt-signals") == 0, "one independent signal case required");
  struct target independent = spawn_target(1, NULL);
  require(apply(profile).code == 0, "fresh controller sandbox");
  struct target inherited = spawn_target(0, &independent);
  struct signal_result control = signal_target(&inherited);
  require(control.delivered, "inherited positive signal control");
  struct signal_result fresh = signal_target(&independent);
  send_bytes(inherited.control, "n", 1);
  struct apply_result nested; receive(inherited.ready, &nested, sizeof nested);
  struct signal_result after_nested = signal_target(&inherited);
  finish(&independent); finish(&inherited);
  printf("{\"case\":\"seatbelt-signals\",\"seatbeltSignals\":{");
  print_signal("inherited", control); putchar(','); print_signal("fresh", fresh);
  printf(",\"nestedApplyReturnCode\":%d,\"nestedApplyErrno\":%d,", nested.code, nested.error);
  print_signal("afterNested", after_nested);
  puts(",\"unreapedPidControl\":true,\"ownedChildrenJoined\":true}}");
  return 0;
}
