/* Actual Darwin metadata setup, never a replacement metadata observer. */
#if !defined(__APPLE__)
#error This fixture requires public Darwin metadata APIs
#endif
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/acl.h>
#include <membership.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
#include <sys/attr.h>
#include <stdint.h>

int main(int argc, char **argv) {
    if (argc != 3) return 125;
    if (!strcmp(argv[1], "flags")) {
        if (lchflags(argv[2], UF_HIDDEN) != 0) { perror("fixture lchflags"); return 1; }
        return 0;
    }
    acl_t acl = acl_init(1);
    if (acl == NULL) { perror("fixture acl_init"); return 1; }
    int status = 0;
    if (!strcmp(argv[1], "acl")) {
        acl_entry_t entry;
        acl_permset_t permissions;
        uuid_t owner;
        if (mbr_uid_to_uuid(getuid(), owner) != 0 || acl_create_entry(&acl, &entry) != 0 ||
            acl_set_tag_type(entry, ACL_EXTENDED_ALLOW) != 0 || acl_set_qualifier(entry, owner) != 0 ||
            acl_get_permset(entry, &permissions) != 0 || acl_add_perm(permissions, ACL_READ_DATA) != 0)
            status = 1;
    } else if (!strcmp(argv[1], "empty-acl-flags")) {
        acl_flagset_t flags;
        if (acl_get_flagset_np(acl, &flags) != 0 || acl_add_flag_np(flags, ACL_FLAG_NO_INHERIT) != 0)
            status = 1;
    } else status = 125;
    if (status == 0 && acl_set_link_np(argv[2], ACL_TYPE_EXTENDED, acl) != 0) {
        perror("fixture acl_set_link_np"); status = 1;
    }
    if (status == 0) {
        /* The public ACL readback shares libc's statx path. getattrlist below
         * observes the raw security attribute through a separate kernel path. */
        char *requested = acl_to_text(acl, NULL);
        if (requested == NULL) { perror("fixture requested ACL text"); status = 1; }
        else {
            printf("requested ACL: %s\n", requested);
            if (acl_free(requested) != 0) status = 1;
        }
        errno = 0;
        acl_t stored = acl_get_link_np(argv[2], ACL_TYPE_EXTENDED);
        if (stored == NULL) printf("readback ACL: unavailable (errno %d)\n", errno);
        else {
            char *text = acl_to_text(stored, NULL);
            if (text == NULL) { perror("fixture readback ACL text"); status = 1; }
            else {
                printf("readback ACL: %s\n", text);
                if (acl_free(text) != 0) status = 1;
            }
            if (acl_free(stored) != 0) status = 1;
        }
        struct attrlist attributes = { .bitmapcount = ATTR_BIT_MAP_COUNT,
            .commonattr = ATTR_CMN_EXTENDED_SECURITY };
        uint32_t buffer[128] = { 0 };
        if (getattrlist(argv[2], &attributes, buffer, sizeof(buffer),
                FSOPT_NOFOLLOW | FSOPT_REPORT_FULLSIZE) != 0) {
            perror("fixture raw security readback"); status = 1;
        } else {
            attrreference_t reference;
            uint32_t used = buffer[0];
            if (used < sizeof(uint32_t) + sizeof(reference) || used > sizeof(buffer)) status = 1;
            else {
                memcpy(&reference, (char *)buffer + sizeof(uint32_t), sizeof(reference));
                size_t start = sizeof(uint32_t) + (size_t)reference.attr_dataoffset;
                if (reference.attr_dataoffset < 0 || start > used || reference.attr_length > used - start)
                    status = 1;
                else {
                    printf("raw security (%u bytes):", reference.attr_length);
                    for (size_t i = 0; i < reference.attr_length; ++i)
                        printf("%02x", ((unsigned char *)buffer)[start + i]);
                    putchar('\n');
                }
            }
        }
    }
    if (acl_free(acl) != 0) status = 1;
    return status;
}
