/* X1 kernel-object surface probe, run inside the Resident sandbox's bwrap flags.
 *
 * The Resident sandbox is (src/sandbox.ts residentArgv):
 *   bwrap --unshare-all --new-session --die-with-parent --cap-drop ALL
 *         --seccomp <fd> ... (the vsock filter refuses only socket/socketpair AF_VSOCK)
 *
 * This probe asks, from inside such a sandbox, which kernel objects that are
 * NOT confined by a namespace are still reachable. No side effects on the host:
 * it only reads/queries, never loads a module, never writes a host file.
 *
 * Each line printed is "NAME: result" so the driver can classify.
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <linux/keyctl.h>

typedef int key_serial_t;

static long sys_add_key(const char *type, const char *desc, const void *payload, size_t plen, key_serial_t ring) {
  return syscall(SYS_add_key, type, desc, payload, plen, ring);
}
static long sys_keyctl(int op, unsigned long a2, unsigned long a3, unsigned long a4, unsigned long a5) {
  return syscall(SYS_keyctl, op, a2, a3, a4, a5);
}

int main(void) {
  /* 1. keyring: can we add a key to the user keyring? user keyring is NOT
   * isolated by a user namespace unless the userns is a new keyring owner. */
  {
    long serial = sys_add_key("user", "oma-adv-x1-probe", "x", 1, KEY_SPEC_USER_KEYRING);
    if (serial > 0) {
      printf("keyring_add_user: OK serial=%ld (revoking)\n", serial);
      /* revoke immediately to avoid leaving state */
      sys_keyctl(KEYCTL_REVOKE, (unsigned long)serial, 0, 0, 0);
      sys_keyctl(KEYCTL_UNLINK, (unsigned long)serial, (unsigned long)KEY_SPEC_USER_KEYRING, 0, 0);
    } else {
      printf("keyring_add_user: errno=%d (%s)\n", errno, strerror(errno));
    }
  }
  /* 1b. session keyring read: can we enumerate the uid session keyring? */
  {
    long r = sys_keyctl(KEYCTL_DESCRIBE, (unsigned long)KEY_SPEC_USER_SESSION_KEYRING, 0, 0, 0);
    printf("keyring_describe_user_session: %s (errno=%d)\n", r >= 0 ? "OK" : "DENIED", r >= 0 ? 0 : errno);
  }

  /* 2. /proc/sys reachable and writable? Try reading a well-known one, then
   * attempt (but do NOT commit anything harmful) opening for write. */
  {
    int rf = open("/proc/sys/kernel/hostname", O_RDONLY);
    printf("procsys_read_hostname: %s (errno=%d)\n", rf >= 0 ? "OK" : "DENIED", rf >= 0 ? 0 : errno);
    if (rf >= 0) close(rf);
    /* Attempt to open a writable sysctl for writing (do not write). */
    int wf = open("/proc/sys/kernel/core_pattern", O_WRONLY);
    if (wf >= 0) { printf("procsys_open_write_core_pattern: OPENED (not written)\n"); close(wf); }
    else printf("procsys_open_write_core_pattern: DENIED errno=%d (%s)\n", errno, strerror(errno));
  }

  /* 3. userfaultfd: a classic use-after-free primitive / kernel attack surface. */
  {
    long uf = syscall(SYS_userfaultfd, O_CLOEXEC);
    if (uf >= 0) { printf("userfaultfd: OK fd=%ld\n", uf); close((int)uf); }
    else printf("userfaultfd: DENIED errno=%d (%s)\n", errno, strerror(errno));
  }

  /* 4. perf_event_open: broad kernel surface. */
  {
    struct perf_event_attr { unsigned int type; unsigned int size; unsigned long long config; } attr;
    memset(&attr, 0, sizeof attr);
    attr.size = sizeof attr;
    long pf = syscall(SYS_perf_event_open, &attr, 0, -1, -1, 0);
    if (pf >= 0) { printf("perf_event_open: OK fd=%ld\n", pf); close((int)pf); }
    else printf("perf_event_open: DENIED errno=%d (%s)\n", errno, strerror(errno));
  }

  /* 5. bpf(2): can we call bpf at all? */
  {
    long bf = syscall(SYS_bpf, 0 /*BPF_MAP_CREATE*/, NULL, 0);
    /* EFAULT means the call was permitted (bad args); EPERM means blocked. */
    printf("bpf_call: errno=%d (%s)\n", errno, strerror(errno));
    if (bf >= 0) close((int)bf);
  }

  /* 6. io_uring setup: can we create an io_uring at all (base for op abuse)? */
  {
    /* io_uring_setup(entries, params) */
    struct io_uring_params { unsigned int a[16]; unsigned long long b[8]; } p;
    memset(&p, 0, sizeof p);
    long ur = syscall(SYS_io_uring_setup, 8, &p);
    if (ur >= 0) { printf("io_uring_setup: OK fd=%ld\n", ur); close((int)ur); }
    else printf("io_uring_setup: DENIED errno=%d (%s)\n", errno, strerror(errno));
  }

  /* 7. mount(2) / new mounts: --unshare-all gives a private mount ns; can we
   * mount a fresh tmpfs (would need CAP_SYS_ADMIN in the userns)? */
  {
    long mr = syscall(SYS_mount, "none", "/tmp/oma-adv-x1-mnt", "tmpfs", 0, "");
    printf("mount_tmpfs: %s errno=%d (%s)\n", mr == 0 ? "OK(unexpected)" : "DENIED", errno, strerror(errno));
  }

  /* 8. can we open a host device beyond the --dev minimal set? Try /dev/kmsg,
   * /dev/mem, and list /dev to see what the minimal devtmpfs exposes. */
  {
    const char *devs[] = {"/dev/kmsg", "/dev/mem", "/dev/kvm", "/dev/net/tun", NULL};
    for (int i = 0; devs[i]; i++) {
      int df = open(devs[i], O_RDONLY);
      if (df >= 0) { printf("dev_open %s: OPENED\n", devs[i]); close(df); }
      else printf("dev_open %s: errno=%d (%s)\n", devs[i], errno, strerror(errno));
    }
  }

  return 0;
}
