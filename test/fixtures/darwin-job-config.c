/* Portable execution of the production byte decoder, not a Darwin kernel test. */
#include "config.h"
static void strings(char **values) {
  for (char **at = values; *at != NULL; ++at) {
    printf("%zu:", strlen(*at)); fwrite(*at, 1, strlen(*at), stdout); putchar('\n');
  }
  putchar('\n');
}
int main(void) {
  struct oma_job_config config = oma_job_read(STDIN_FILENO);
  printf("%d %d\n", config.stages, config.trace);
  for (uint32_t i = 0; i < config.fd_count; ++i) printf("%u ", config.slots[i]);
  putchar('\n');
  if (config.has_peer) { for (int i = 0; i < 8; ++i) printf("%u ", config.peer[i]); putchar('\n'); }
  strings(config.argv); strings(config.env); oma_job_free(config);
  return 0;
}
