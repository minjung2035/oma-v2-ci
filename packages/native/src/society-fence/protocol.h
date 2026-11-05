#ifndef OMA_SOCIETY_FENCE_PROTOCOL_H
#define OMA_SOCIETY_FENCE_PROTOCOL_H
#include <mach/mach.h>
#include <stdint.h>
#define OMA_FENCE_QUERY 0x4f4d5371
#define OMA_FENCE_REPLY 0x4f4d5372
#define OMA_FENCE_HANDOFF 0x4f4d5373U
#define OMA_FENCE_ENROLL 0x4f4d5374
#define OMA_FENCE_ENROLLED 0x4f4d5375
#define OMA_FENCE_CHANNEL 0x4f4d5376
#define OMA_FENCE_CHANNEL_REPLY 0x4f4d5377
struct oma_fence_publication {
  mach_msg_header_t head;
  uint8_t identity[32];
  uint64_t socket, generation;
  uint32_t port, info_size, socket_offset, generation_offset;
};
struct oma_fence_answer { struct oma_fence_publication publication; uint8_t nonce[16]; };
struct oma_fence_enrollment {
  mach_msg_header_t head;
  mach_msg_body_t body;
  mach_msg_port_descriptor_t proof;
  uint8_t nonce[16];
  uint64_t coalition;
  char boot[40];
};
struct oma_fence_channel_answer {
  mach_msg_header_t head;
  mach_msg_body_t body;
  mach_msg_port_descriptor_t endpoint;
  struct oma_fence_publication publication;
  uint8_t nonce[16];
};
_Static_assert(sizeof(struct oma_fence_publication)==88,"fixed socket publication");
_Static_assert(sizeof(struct oma_fence_answer)==104,"fixed discovery answer");
_Static_assert(sizeof(struct oma_fence_enrollment)==104,"fixed scope enrollment");
_Static_assert(sizeof(struct oma_fence_channel_answer)==144,"fixed scope endpoint answer");
#endif
