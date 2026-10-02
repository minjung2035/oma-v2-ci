/* X1 --new-session / controlling-tty probe.
 * Under bwrap --new-session (setsid), the sandboxed process should have no
 * controlling terminal, so TIOCSTI keystroke injection into the launcher's tty
 * is not possible. Reports whether /dev/tty is openable (a controlling tty) and
 * whether TIOCSTI on stdin is refused.
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <string.h>
#include <sys/ioctl.h>
#include <termios.h>

int main(void) {
  int t = open("/dev/tty", O_RDWR);
  if (t < 0) printf("dev_tty: no controlling tty (errno=%d %s)\n", errno, strerror(errno));
  else { printf("dev_tty: OPENED (has controlling tty)\n"); close(t); }
  char c = 'x';
  int r = ioctl(0, TIOCSTI, &c);
  printf("tiocsti_stdin: %s (errno=%d %s)\n", r == 0 ? "INJECTED(unexpected)" : "refused", errno, strerror(errno));
  return 0;
}
