/* Controlled candidate only. No process outside this fixture is inspected. */
#define _DARWIN_C_SOURCE 1
#include <mach/mach.h>
#include <mach/mach_vm.h>
#include <mach/task_special_ports.h>
#include <sys/ptrace.h>
#include <sys/wait.h>
#include <sys/syscall.h>
#include <unistd.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static volatile uint64_t canary = UINT64_C(0x6f6d612d70726f62);
static void require(int ok, const char *what) { if (!ok) { perror(what); exit(2); } }
static int join_child(pid_t child) {
  int status = 0; pid_t result;
  do { result = waitpid(child, &status, 0); } while (result < 0 && errno == EINTR);
  require(result == child, "join own child"); return status;
}
int main(int argc, char **argv) {
  require((argc == 2 || (argc == 3 && !strcmp(argv[2], "mach-only"))) &&
    (!strcmp(argv[1], "ordinary") || !strcmp(argv[1], "guard")), "mode");
  setvbuf(stdout, NULL, _IONBF, 0); alarm(15);
  mach_port_t before = MACH_PORT_NULL, after = MACH_PORT_NULL;
  kern_return_t got_before = task_get_task_access_port(mach_task_self(), &before), set = KERN_NOT_SUPPORTED;
  int denied = -2, deny_errno = 0;
  if (!strcmp(argv[1], "guard")) {
    set = task_set_task_access_port(mach_task_self(), MACH_PORT_DEAD);
    errno = 0; denied = ptrace(PT_DENY_ATTACH, 0, 0, 0); deny_errno = errno;
  }
  kern_return_t got_after = task_get_task_access_port(mach_task_self(), &after);
  printf("{\"kind\":\"supervisor\",\"mode\":\"%s\",\"accessBefore\":%d,\"accessAfter\":%d,"
    "\"beforeNull\":%s,\"afterDead\":%s,\"set\":%d,\"deny\":%d,\"denyErrno\":%d}\n",
    argv[1], got_before, got_after, before == MACH_PORT_NULL ? "true" : "false",
    after == MACH_PORT_DEAD ? "true" : "false", set, denied, deny_errno);
  if (MACH_PORT_VALID(before)) require(mach_port_deallocate(mach_task_self(), before) == KERN_SUCCESS, "release before");
  if (MACH_PORT_VALID(after)) require(mach_port_deallocate(mach_task_self(), after) == KERN_SUCCESS, "release after");
  pid_t own = getpid(), attacker = fork(); require(attacker >= 0, "fork own Mach observer");
  if (!attacker) {
    mach_port_t control = MACH_PORT_NULL, read = MACH_PORT_NULL, inspect = MACH_PORT_NULL;
    kern_return_t c = task_for_pid(mach_task_self(), own, &control);
    /* Observation-only SDK syscall selectors; no production ABI adoption. */
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    errno = 0; int r = (int)syscall(SYS_task_read_for_pid, mach_task_self(), own, &read), read_errno = errno;
    errno = 0; int i = (int)syscall(SYS_task_inspect_for_pid, mach_task_self(), own, &inspect), inspect_errno = errno;
#pragma clang diagnostic pop
    uint64_t observed = 0; mach_vm_size_t count = 0;
    mach_port_t selected = MACH_PORT_VALID(control) ? control : read;
    kern_return_t memory = MACH_PORT_VALID(selected) ? mach_vm_read_overwrite(selected,
      (mach_vm_address_t)(uintptr_t)&canary, sizeof observed, (mach_vm_address_t)(uintptr_t)&observed, &count) : KERN_INVALID_RIGHT;
    printf("{\"kind\":\"mach\",\"control\":%d,\"read\":%d,\"readErrno\":%d,\"inspect\":%d,\"inspectErrno\":%d,\"memory\":%d,\"bytes\":%llu,\"canaryRead\":%s}\n",
      c, r, read_errno, i, inspect_errno, memory, (unsigned long long)count, observed == canary && count == sizeof observed ? "true" : "false");
    if (MACH_PORT_VALID(control)) mach_port_deallocate(mach_task_self(), control);
    if (MACH_PORT_VALID(read)) mach_port_deallocate(mach_task_self(), read);
    if (MACH_PORT_VALID(inspect)) mach_port_deallocate(mach_task_self(), inspect);
    _exit(0);
  }
  int mach_status = join_child(attacker); require(WIFEXITED(mach_status) && WEXITSTATUS(mach_status) == 0, "Mach observer exit");
  if (argc == 3) {
    printf("{\"kind\":\"joined\",\"attachAttempted\":false,\"attachExit\":0,\"attachSignal\":0,\"canaryIntact\":%s}\n",
      canary == UINT64_C(0x6f6d612d70726f62) ? "true" : "false");
    return 0;
  }
  attacker = fork(); require(attacker >= 0, "fork own attach observer");
  if (!attacker) {
    errno = 0; int attached = ptrace(PT_ATTACHEXC, own, 0, 0), attached_errno = errno, detached = -2;
    if (!attached) {
      int status = 0; pid_t observed;
      do { observed = waitpid(own, &status, WUNTRACED); } while (observed < 0 && errno == EINTR);
      require(observed == own && WIFSTOPPED(status), "join fixture attach stop");
      detached = ptrace(PT_DETACH, own, (caddr_t)1, 0);
      require(!detached, "detach own fixture supervisor");
    }
    printf("{\"kind\":\"attach\",\"result\":%d,\"errno\":%d,\"detached\":%d}\n", attached, attached_errno, detached);
    _exit(0);
  }
  int attach_status = join_child(attacker);
  printf("{\"kind\":\"joined\",\"attachExit\":%d,\"attachSignal\":%d,\"canaryIntact\":%s}\n",
    WIFEXITED(attach_status) ? WEXITSTATUS(attach_status) : -1, WIFSIGNALED(attach_status) ? WTERMSIG(attach_status) : 0,
    canary == UINT64_C(0x6f6d612d70726f62) ? "true" : "false");
  return 0;
}
