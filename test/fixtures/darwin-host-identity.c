/* Independent public-API ABI check, not a reboot or process-death proof. */
#include <gethostuuid.h>
#include <stdio.h>
#include <time.h>
#include <uuid/uuid.h>

int main(void) {
  uuid_t first, second;
  const struct timespec timeout = { .tv_sec = 1, .tv_nsec = 0 };
  if (gethostuuid(first, &timeout) || gethostuuid(second, &timeout)) {
    perror("gethostuuid"); return 70;
  }
  if (uuid_is_null(first) || uuid_compare(first, second)) return 71;
  for (unsigned i = 0; i < sizeof(first); ++i) printf("%02x", first[i]);
  putchar('\n'); return 0;
}
