/* X1 keyring quota-exhaustion probe (self-cleaning, single process).
 *
 * Adds "user" keys to the shared per-uid keyring until the kernel refuses
 * (EDQUOT), reports how many it took, then revokes+unlinks every key it added.
 * This shows a Resident can consume the uid-wide keyring quota that the broker,
 * Principal and other Residents share. Bounded by KEY_SPEC and a hard cap, and
 * it always cleans up its own keys before exiting.
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <unistd.h>
#include <sys/syscall.h>
#include <linux/keyctl.h>

typedef int key_serial_t;
static long add_key(const char *type, const char *desc, const void *p, size_t n, key_serial_t r) {
  return syscall(SYS_add_key, type, desc, p, n, r);
}
static long keyctl(int op, unsigned long a, unsigned long b, unsigned long c, unsigned long d) {
  return syscall(SYS_keyctl, op, a, b, c, d);
}

#define CAP 4096
int main(void) {
  long serials[CAP];
  int n = 0, last_errno = 0;
  for (; n < CAP; n++) {
    char name[64]; snprintf(name, sizeof name, "oma-adv-x1-quota-%d", n);
    long s = add_key("user", name, "x", 1, KEY_SPEC_USER_KEYRING);
    if (s < 0) { last_errno = errno; break; }
    serials[n] = s;
  }
  printf("added=%d stopped_errno=%d (%s)\n", n, last_errno, strerror(last_errno));
  for (int i = 0; i < n; i++) {
    keyctl(KEYCTL_REVOKE, (unsigned long)serials[i], 0, 0, 0);
    keyctl(KEYCTL_UNLINK, (unsigned long)serials[i], (unsigned long)KEY_SPEC_USER_KEYRING, 0, 0);
  }
  printf("revoked=%d\n", n);
  return 0;
}
