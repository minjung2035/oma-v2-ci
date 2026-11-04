/* Bounded private launch framing only; the TS owner supplies frozen policy.
 * This decoder performs no filesystem lookup or workload effect. */
#ifndef OMA_JOB_CONFIG_H
#define OMA_JOB_CONFIG_H
#include <stdint.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

struct oma_job_config { uint32_t fd_count, *slots; int stages, trace; char **argv, **env; };
struct oma_job_cursor { const unsigned char *at, *end; };
static _Noreturn void oma_job_refused(void) {
  fputs("invalid private job configuration\n", stderr); _exit(125);
}
static uint32_t oma_job_word(struct oma_job_cursor *cursor) {
  if ((size_t)(cursor->end - cursor->at) < 4) oma_job_refused();
  const unsigned char *p = cursor->at; cursor->at += 4;
  return (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24;
}
static void oma_job_read_exact(int fd, unsigned char *bytes, size_t count) {
  while (count) {
    ssize_t used = read(fd, bytes, count);
    /* Interrupts, including the helper setup alarm, refuse the partial frame. */
    if (used <= 0) oma_job_refused();
    bytes += used; count -= (size_t)used;
  }
}
static char *oma_job_string(struct oma_job_cursor *cursor) {
  uint32_t size = oma_job_word(cursor);
  if (size > (size_t)(cursor->end - cursor->at) || memchr(cursor->at, 0, size) != NULL) oma_job_refused();
  char *value = calloc((size_t)size + 1, 1); if (value == NULL) oma_job_refused();
  memcpy(value, cursor->at, size); cursor->at += size; return value;
}
static struct oma_job_config oma_job_read(int fd) {
  unsigned char header[32]; oma_job_read_exact(fd, header, sizeof header);
  if (memcmp(header, "OMAJOB1\0", 8)) oma_job_refused();
  struct oma_job_cursor cursor = { header + 8, header + sizeof header };
  uint32_t size = oma_job_word(&cursor), argc = oma_job_word(&cursor), envc = oma_job_word(&cursor);
  struct oma_job_config result = {0}; result.fd_count = oma_job_word(&cursor);
  result.stages = (int)oma_job_word(&cursor); result.trace = (int)oma_job_word(&cursor);
  if (size < sizeof header || size > 262144 || argc < 1 || argc > 16384 || envc > 4096 ||
      result.fd_count < 3 || result.fd_count > 128 || (result.stages != 1 && result.stages != 2) ||
      (result.trace != 0 && result.trace != 1)) oma_job_refused();
  unsigned char *body = malloc(size - sizeof header); if (body == NULL) oma_job_refused();
  oma_job_read_exact(fd, body, size - sizeof header);
  unsigned char extra; if (read(fd, &extra, 1) != 0 || close(fd) != 0) oma_job_refused();
  cursor.at = body; cursor.end = body + size - sizeof header;
  result.slots = calloc(result.fd_count, sizeof *result.slots);
  result.argv = calloc((size_t)argc + 1, sizeof *result.argv); result.env = calloc((size_t)envc + 1, sizeof *result.env);
  if (result.slots == NULL || result.argv == NULL || result.env == NULL) oma_job_refused();
  unsigned int standard = 0;
  for (uint32_t i = 0; i < result.fd_count; ++i) {
    uint32_t slot = oma_job_word(&cursor); if (slot > 65535) oma_job_refused();
    for (uint32_t j = 0; j < i; ++j) if (result.slots[j] == slot) oma_job_refused();
    result.slots[i] = slot; if (slot < 3) standard |= 1U << slot;
  }
  if (standard != 7) oma_job_refused();
  for (uint32_t i = 0; i < argc; ++i) result.argv[i] = oma_job_string(&cursor);
  if (result.argv[0][0] != '/') oma_job_refused();
  for (uint32_t i = 0; i < envc; ++i) {
    result.env[i] = oma_job_string(&cursor);
    char *separator = strchr(result.env[i], '=');
    if (separator == NULL || separator == result.env[i]) oma_job_refused();
    for (uint32_t j = 0; j < i; ++j)
      if (!strncmp(result.env[j], result.env[i], (size_t)(separator - result.env[i]) + 1)) oma_job_refused();
  }
  if (cursor.at != cursor.end) oma_job_refused();
  free(body); return result;
}
static void oma_job_free(struct oma_job_config config) {
  for (char **at = config.argv; *at != NULL; ++at) free(*at);
  for (char **at = config.env; *at != NULL; ++at) free(*at);
  free(config.argv); free(config.env); free(config.slots);
}
#endif
